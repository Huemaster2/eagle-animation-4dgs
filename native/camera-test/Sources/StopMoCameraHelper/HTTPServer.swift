import Foundation
import Network

// Minimal HTTP/1.1 server on 127.0.0.1 for the StopMo app. One request per connection,
// except MJPEG live view which keeps the connection open and streams frames.

struct HTTPRequest {
    let method: String
    let path: String
    let query: [String: String]
    let headers: [String: String]
    let body: Data
}

final class HTTPResponder {
    let connection: NWConnection
    private var closed = false

    init(_ c: NWConnection) { connection = c }

    func send(status: Int, contentType: String, body: Data, extraHeaders: [String: String] = [:]) {
        guard !closed else { return }
        let reason = [200: "OK", 400: "Bad Request", 401: "Unauthorized", 404: "Not Found", 409: "Conflict", 500: "Internal Server Error"][status] ?? "OK"
        var head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\n"
        head += "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\nAccess-Control-Expose-Headers: *\r\nCache-Control: no-store\r\nConnection: close\r\n"
        for (k, v) in extraHeaders { head += "\(k): \(v)\r\n" }
        head += "\r\n"
        var out = Data(head.utf8)
        out.append(body)
        closed = true
        connection.send(content: out, completion: .contentProcessed { [connection] _ in connection.cancel() })
    }

    func json(_ status: Int, _ object: Any, extraHeaders: [String: String] = [:]) {
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
        send(status: status, contentType: "application/json", body: data, extraHeaders: extraHeaders)
    }

    func error(_ status: Int, _ message: String) { json(status, ["error": message]) }
}

/// Streams the latest live-view JPEG as multipart/x-mixed-replace (works directly in an <img>).
final class MJPEGStream {
    let connection: NWConnection
    private var lastSent: UInt64 = 0
    private var timer: DispatchSourceTimer?
    private let frame: () -> (UInt64, Data?)
    var onClose: (() -> Void)?

    init(_ c: NWConnection, frame: @escaping () -> (UInt64, Data?)) {
        connection = c
        self.frame = frame
    }

    func start() {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=stopmoframe\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(head.utf8), completion: .contentProcessed { _ in })
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        t.schedule(deadline: .now(), repeating: .milliseconds(25))
        t.setEventHandler { [weak self] in self?.tick() }
        timer = t
        t.resume()
    }

    private func tick() {
        let (n, jpeg) = frame()
        guard let jpeg, n != lastSent else { return }
        lastSent = n
        var part = Data("--stopmoframe\r\nContent-Type: image/jpeg\r\nContent-Length: \(jpeg.count)\r\n\r\n".utf8)
        part.append(jpeg)
        part.append(Data("\r\n".utf8))
        connection.send(content: part, completion: .contentProcessed { [weak self] err in
            if err != nil { self?.stop() }
        })
    }

    func stop() {
        timer?.cancel()
        timer = nil
        connection.cancel()
        onClose?()
    }
}

final class HTTPServer {
    private let listener: NWListener
    private let queue = DispatchQueue(label: "stopmo.http")
    var handler: ((HTTPRequest, HTTPResponder) -> Void)?
    var streamHandler: ((HTTPRequest, NWConnection) -> Bool)?   // returns true if it took over the connection
    var onReady: ((UInt16) -> Void)?

    init() throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        params.allowLocalEndpointReuse = true
        listener = try NWListener(using: params)
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            if case .ready = state, let port = self?.listener.port?.rawValue { self?.onReady?(port) }
            if case .failed(let e) = state { FileHandle.standardError.write(Data("listener failed: \(e)\n".utf8)); exit(2) }
        }
        listener.newConnectionHandler = { [weak self] c in self?.accept(c) }
        listener.start(queue: queue)
    }

    private func accept(_ c: NWConnection) {
        c.start(queue: queue)
        receive(c, buffer: Data())
    }

    private func receive(_ c: NWConnection, buffer: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, done, err in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }
            if let req = Self.parse(buf) {
                if self.streamHandler?(req, c) == true { return }
                let r = HTTPResponder(c)
                DispatchQueue.main.async { self.handler?(req, r) }
                return
            }
            if done || err != nil || buf.count > 4 << 20 { c.cancel(); return }
            self.receive(c, buffer: buf)
        }
    }

    static func parse(_ buf: Data) -> HTTPRequest? {
        guard let headEnd = buf.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        guard let head = String(data: buf.subdata(in: buf.startIndex..<headEnd.lowerBound), encoding: .utf8) else { return nil }
        var lines = head.components(separatedBy: "\r\n")
        let first = lines.removeFirst().split(separator: " ")
        guard first.count >= 2 else { return nil }
        var headers: [String: String] = [:]
        for l in lines {
            if let i = l.firstIndex(of: ":") {
                headers[l[..<i].lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
            }
        }
        let bodyStart = headEnd.upperBound
        let length = Int(headers["content-length"] ?? "0") ?? 0
        guard buf.count - bodyStart >= length else { return nil }
        let body = buf.subdata(in: bodyStart..<(bodyStart + length))
        let target = String(first[1])
        let comps = URLComponents(string: "http://x" + target)
        var query: [String: String] = [:]
        // Form encoding (URLSearchParams) sends spaces as '+', which URLComponents leaves alone;
        // without this "Application Support" arrived as "Application+Support"
        for pair in (comps?.percentEncodedQuery ?? "").split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let decode = { (s: Substring) in String(s).replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? String(s) }
            guard let name = kv.first.map(decode), !name.isEmpty else { continue }
            query[name] = kv.count > 1 ? decode(kv[1]) : ""
        }
        return HTTPRequest(method: String(first[0]), path: comps?.path ?? target, query: query, headers: headers, body: body)
    }
}

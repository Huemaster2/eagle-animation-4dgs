import Foundation
import Network
import StopMoCamera

// stopmo-camera-helper: runs the Canon 5D Mark II camera engine (ImageCaptureCore + Canon
// EOS PTP) for the StopMo app. Listens on 127.0.0.1, prints one READY line with port and
// token on stdout, and serves a small API modelled on Toucan Camera Server's.
//
//   GET  /status                          helper + camera status (no token needed)
//   GET  /cameras                         [{id, name}] when a camera is ready
//   PUT  /cameras/{id}/connect            remote mode + live view
//   PUT  /cameras/{id}/disconnect         stop live view
//   GET  /cameras/{id}/liveview?token=    MJPEG stream
//   GET  /cameras/{id}/liveview/frame     latest live-view JPEG (header x-frame-counter)
//   POST /cameras/{id}/capture?raw_dir=&base_name=&save=both|mac|card
//        -> image/jpeg preview, header x-stopmo-files: JSON array of saved files with checks
//   GET  /cameras/{id}/parameters         Toucan-style parameter list (image quality)
//   PUT  /cameras/{id}/parameters         {"type": "image_quality", "value": "0|1|2"}

setvbuf(stdout, nil, _IOLBF, 0)

let token = ProcessInfo.processInfo.environment["STOPMO_CAMERA_TOKEN"] ?? UUID().uuidString
let logDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
    .appendingPathComponent("Logs/StopMo", isDirectory: true)
try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)

let cam = CameraController(captureDir: logDir, logName: "camera-helper.log")
cam.onLog = { line in print("LOG \(line)") }
let cameraId = "canon-eos-ptp"

func authorized(_ req: HTTPRequest) -> Bool {
    req.headers["authorization"] == "Bearer \(token)" || req.query["token"] == token
}

let server: HTTPServer
do {
    server = try HTTPServer()
} catch {
    print("FATAL could not open listener: \(error)")
    exit(1)
}

var streams: [ObjectIdentifier: MJPEGStream] = [:]
let streamsLock = NSLock()

cam.onStatus = { text, connected in
    print("STATUS \(connected ? 1 : 0) \(text)")
    // A live-view window opened while the camera was asleep gets its picture once the body is ready
    guard connected else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
        streamsLock.lock(); let watching = !streams.isEmpty; streamsLock.unlock()
        if watching && cam.isReady && !cam.isLiveViewOn { cam.prepareForShooting { _ in } }
    }
}

server.streamHandler = { req, conn in
    guard req.method == "GET", req.path == "/cameras/\(cameraId)/liveview" else { return false }
    guard authorized(req) else { return false }
    let s = MJPEGStream(conn) { (cam.liveFrameCounter.value, cam.latestLiveJPEG.value) }
    let key = ObjectIdentifier(s)
    streamsLock.lock(); streams[key] = s; streamsLock.unlock()
    s.onClose = { streamsLock.lock(); streams[key] = nil; streamsLock.unlock() }
    DispatchQueue.main.async {
        if cam.isReady && !cam.isLiveViewOn { cam.prepareForShooting { _ in } }
    }
    s.start()
    return true
}

server.handler = { req, res in
    if req.method == "OPTIONS" { res.send(status: 200, contentType: "text/plain", body: Data()); return }
    if req.path == "/status" {
        var s = cam.statusSnapshot()
        s["helper"] = "stopmo-camera-helper"
        s["version"] = 1
        res.json(200, s)
        return
    }
    guard authorized(req) else { res.error(401, "missing or wrong token"); return }

    let base = "/cameras/\(cameraId)"
    switch (req.method, req.path) {
    case ("GET", "/cameras"):
        res.json(200, cam.isReady ? [["id": cameraId, "name": cam.modelName ?? "Canon EOS"]] : [])

    case ("PUT", base + "/connect"), ("POST", base + "/connect"):
        guard cam.isReady else { res.error(409, "camera not connected"); return }
        cam.prepareForShooting { err in
            if let err { res.error(500, err.localizedDescription) } else { res.json(200, ["ok": true]) }
        }

    case ("GET", base + "/liveview/frame"):
        // One live-view JPEG, never a shutter release: used for view snapshots while posing
        guard cam.isLiveViewOn, let jpeg = cam.latestLiveJPEG.value else { res.error(409, "live view is not running"); return }
        res.send(status: 200, contentType: "image/jpeg", body: jpeg, extraHeaders: ["x-frame-counter": String(cam.liveFrameCounter.value)])

    case ("PUT", base + "/disconnect"), ("POST", base + "/disconnect"):
        cam.stopLiveView()
        res.json(200, ["ok": true])

    case ("POST", base + "/capture"):
        guard cam.isReady else { res.error(409, "camera not connected"); return }
        let rawDir = req.query["raw_dir"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("stopmo-captures", isDirectory: true)
        let baseName = req.query["base_name"].flatMap { $0.isEmpty ? nil : $0 }
        let target = req.query["save"].flatMap { SaveTarget(name: $0) }
        cam.capture(into: rawDir, baseName: baseName, target: target) { result in
            switch result {
            case .success(let r):
                let filesJSON = (try? JSONEncoder().encode(r.files)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                let headers = ["x-stopmo-files": filesJSON, "x-stopmo-seconds": String(format: "%.2f", r.seconds)]
                if let preview = r.preview {
                    res.send(status: 200, contentType: "image/jpeg", body: preview, extraHeaders: headers)
                } else {
                    res.json(500, ["error": "capture produced no displayable image", "files": filesJSON], extraHeaders: headers)
                }
            case .failure(let e):
                res.error(500, e.localizedDescription)
            }
        }

    case ("GET", base + "/parameters"):
        let options = RawQuality.allCases.map { ["label": $0.title, "value": String($0.rawValue)] }
        res.json(200, [[
            "type": "image_quality",
            "kind": "select",
            "current": cam.currentQuality.map { String($0.rawValue) as Any } ?? NSNull(),
            "options": options,
        ]])

    case ("PUT", base + "/parameters"):
        guard let obj = try? JSONSerialization.jsonObject(with: req.body) as? [String: Any],
              obj["type"] as? String == "image_quality",
              let raw = (obj["value"] as? String).flatMap(Int.init) ?? (obj["value"] as? Int),
              let q = RawQuality(rawValue: raw) else { res.error(400, "unsupported parameter"); return }
        cam.setQualityAsync(q) { err in
            if let err { res.error(500, err.localizedDescription) } else { res.json(200, ["ok": true]) }
        }

    default:
        res.error(404, "not found")
    }
}

server.onReady = { port in
    print("STOPMO_CAMERA_READY {\"port\":\(port),\"token\":\"\(token)\"}")
}

// The app owns us: exit when it closes our stdin, after handing the camera back.
FileHandle.standardInput.readabilityHandler = { h in
    if h.availableData.isEmpty {
        h.readabilityHandler = nil
        DispatchQueue.main.async {
            cam.shutdown()
            exit(0)
        }
    }
}
signal(SIGTERM, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { cam.shutdown(); exit(0) }
term.resume()

server.start()
cam.start()
cam.startKeepAlive()
RunLoop.main.run()

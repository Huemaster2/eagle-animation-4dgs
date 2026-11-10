import Foundation

// MARK: - PTP / Canon EOS protocol constants
//
// Sources: ISO 15740 (PTP) and the Canon EOS vendor extension as implemented
// in libgphoto2 (camlibs/ptp2). Codes are documented here so the Stage 1 log
// is readable without a reference.

enum PTPOp {
    static let getDeviceInfo: UInt16          = 0x1001
    static let getObjectHandles: UInt16       = 0x1007
    static let getObjectInfo: UInt16          = 0x1008
    static let getObject: UInt16              = 0x1009
    static let getThumb: UInt16               = 0x100A
    static let getPartialObject: UInt16       = 0x101B

    static let eosSetDevicePropValueEx: UInt16 = 0x9110
    static let eosRemoteRelease: UInt16       = 0x910F   // older EOS bodies (5D Mk II era)
    static let eosSetRemoteMode: UInt16       = 0x9114
    static let eosSetEventMode: UInt16        = 0x9115
    static let eosGetEvent: UInt16            = 0x9116
    static let eosTransferComplete: UInt16    = 0x9117
    static let eosPCHDDCapacity: UInt16       = 0x911A
    static let eosRemoteReleaseOn: UInt16     = 0x9128   // newer EOS bodies
    static let eosRemoteReleaseOff: UInt16    = 0x9129
    static let eosGetViewFinderData: UInt16   = 0x9153
}

enum PTPResp {
    static let ok: UInt16            = 0x2001
    static let generalError: UInt16  = 0x2002
    static let deviceBusy: UInt16    = 0x2019
    static let eosNotReady: UInt16   = 0xA102
}

enum EOSEvent {
    static let objectAddedEx: UInt32          = 0xC181
    static let storageInfoChanged: UInt32     = 0xC185
    static let requestObjectTransfer: UInt32  = 0xC186
    static let propValueChanged: UInt32       = 0xC189
    static let availListChanged: UInt32       = 0xC18A
}

enum EOSProp {
    static let aperture: UInt32         = 0xD101
    static let shutterSpeed: UInt32     = 0xD102
    static let iso: UInt32              = 0xD103
    static let expCompensation: UInt32  = 0xD104
    static let autoExposureMode: UInt32 = 0xD105
    static let focusMode: UInt32        = 0xD108   // 3 = manual (lens switch on MF)
    static let whiteBalance: UInt32     = 0xD109
    static let captureDestination: UInt32 = 0xD11C
    static let imageFormat: UInt32      = 0xD120
    static let evfOutputDevice: UInt32  = 0xD1B0   // 1 = camera LCD, 2 = PC
    static let evfMode: UInt32          = 0xD1B3

    static func name(_ p: UInt32) -> String {
        switch p {
        case aperture: return "Aperture"
        case shutterSpeed: return "ShutterSpeed"
        case iso: return "ISO"
        case expCompensation: return "ExposureComp"
        case autoExposureMode: return "ExposureMode"
        case whiteBalance: return "WhiteBalance"
        case focusMode: return "FocusMode"
        case captureDestination: return "CaptureDestination"
        case imageFormat: return "ImageFormat"
        case evfOutputDevice: return "EVFOutputDevice"
        case evfMode: return "EVFMode"
        default: return "0x" + String(p, radix: 16, uppercase: true)
        }
    }
}

func hex<T: BinaryInteger>(_ v: T, width: Int = 4) -> String {
    let s = String(v, radix: 16, uppercase: true)
    return "0x" + String(repeating: "0", count: max(0, width - s.count)) + s
}

// MARK: - Little-endian helpers

extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ v: T) {
        var x = v.littleEndian
        Swift.withUnsafeBytes(of: &x) { append(contentsOf: $0) }
    }
}

func le16(_ d: Data, _ off: Int) -> UInt16? {
    let i = d.startIndex + off
    guard off >= 0, i + 2 <= d.endIndex else { return nil }
    return UInt16(d[i]) | (UInt16(d[i + 1]) << 8)
}

func le32(_ d: Data, _ off: Int) -> UInt32? {
    let i = d.startIndex + off
    guard off >= 0, i + 4 <= d.endIndex else { return nil }
    return UInt32(d[i]) | (UInt32(d[i + 1]) << 8) | (UInt32(d[i + 2]) << 16) | (UInt32(d[i + 3]) << 24)
}

struct ByteReader {
    let data: Data
    var pos = 0
    init(_ d: Data) { data = Data(d) }   // re-base indices at 0
    var remaining: Int { data.count - pos }

    mutating func u8() -> UInt8? {
        guard remaining >= 1 else { return nil }
        defer { pos += 1 }
        return data[pos]
    }
    mutating func u16() -> UInt16? {
        guard let v = le16(data, pos) else { return nil }
        pos += 2; return v
    }
    mutating func u32() -> UInt32? {
        guard let v = le32(data, pos) else { return nil }
        pos += 4; return v
    }
    /// PTP string: UInt8 character count (incl. terminating NUL), then UTF-16LE.
    mutating func ptpString() -> String? {
        guard let n = u8() else { return nil }
        if n == 0 { return "" }
        var units: [UInt16] = []
        for _ in 0..<n {
            guard let c = u16() else { return nil }
            units.append(c)
        }
        while units.last == 0 { units.removeLast() }
        return String(decoding: units, as: UTF16.self)
    }
    mutating func u16Array() -> [UInt16]? {
        guard let n = u32(), n < 65_536 else { return nil }
        var a: [UInt16] = []
        a.reserveCapacity(Int(n))
        for _ in 0..<n {
            guard let v = u16() else { return nil }
            a.append(v)
        }
        return a
    }
}

// MARK: - Containers

struct PTPResponse {
    let code: UInt16
    let params: [UInt32]
    let data: Data
    var ok: Bool { code == PTPResp.ok }
}

enum PTP {
    /// Operation request container (type 1).
    static func command(code: UInt16, tid: UInt32, params: [UInt32]) -> Data {
        var d = Data()
        d.appendLE(UInt32(12 + 4 * params.count))
        d.appendLE(UInt16(1))
        d.appendLE(code)
        d.appendLE(tid)
        for p in params { d.appendLE(p) }
        return d
    }

    /// Data container (type 2) — only used if raw out-data turns out to be rejected.
    static func dataContainer(code: UInt16, tid: UInt32, payload: Data) -> Data {
        var d = Data()
        d.appendLE(UInt32(12 + payload.count))
        d.appendLE(UInt16(2))
        d.appendLE(code)
        d.appendLE(tid)
        d.append(payload)
        return d
    }

    /// Parses a response container (type 3). Returns nil if the blob isn't one.
    static func parseResponse(_ d: Data) -> (code: UInt16, params: [UInt32])? {
        guard d.count >= 12,
              let len = le32(d, 0), Int(len) <= d.count, len >= 12,
              le16(d, 4) == 3,
              let code = le16(d, 6) else { return nil }
        var params: [UInt32] = []
        var off = 12
        while off + 4 <= Int(len), let p = le32(d, off) { params.append(p); off += 4 }
        return (code, params)
    }

    /// Removes a data-container header if ImageCaptureCore left one on.
    static func stripDataContainer(_ d: Data) -> Data {
        guard d.count >= 12, let len = le32(d, 0), Int(len) == d.count, le16(d, 4) == 2 else { return d }
        return d.subdata(in: (d.startIndex + 12)..<d.endIndex)
    }

    /// Canon EOS SetDevicePropValueEx payload: [size=12][prop][value].
    static func eosPropPayload(prop: UInt32, value: UInt32) -> Data {
        var d = Data()
        d.appendLE(UInt32(12)); d.appendLE(prop); d.appendLE(value)
        return d
    }
}

// MARK: - DeviceInfo

struct PTPDeviceInfo {
    var vendorExtensionID: UInt32 = 0
    var vendorExtensionDesc = ""
    var operations: [UInt16] = []
    var events: [UInt16] = []
    var properties: [UInt16] = []
    var manufacturer = ""
    var model = ""
    var deviceVersion = ""
    var serial = ""

    static func parse(_ d: Data) -> PTPDeviceInfo? {
        var r = ByteReader(d)
        var info = PTPDeviceInfo()
        guard r.u16() != nil,
              let vid = r.u32(), r.u16() != nil,
              let vdesc = r.ptpString(), r.u16() != nil,
              let ops = r.u16Array(), let evs = r.u16Array(), let props = r.u16Array(),
              r.u16Array() != nil, r.u16Array() != nil else { return nil }
        info.vendorExtensionID = vid
        info.vendorExtensionDesc = vdesc
        info.operations = ops
        info.events = evs
        info.properties = props
        info.manufacturer = r.ptpString() ?? ""
        info.model = r.ptpString() ?? ""
        info.deviceVersion = r.ptpString() ?? ""
        info.serial = r.ptpString() ?? ""
        return info
    }

    func supports(_ op: UInt16) -> Bool { operations.contains(op) }
}

// MARK: - ObjectInfo (only the fields Stage 1 needs)

struct PTPObjectInfo {
    var format: UInt16 = 0
    var compressedSize: UInt32 = 0
    var imageWidth: UInt32 = 0
    var imageHeight: UInt32 = 0
    var filename = ""

    static func parse(_ d: Data) -> PTPObjectInfo? {
        let b = Data(d)
        guard b.count >= 53 else { return nil }
        var o = PTPObjectInfo()
        o.format = le16(b, 4) ?? 0
        o.compressedSize = le32(b, 8) ?? 0
        o.imageWidth = le32(b, 26) ?? 0
        o.imageHeight = le32(b, 30) ?? 0
        var r = ByteReader(b)
        r.pos = 52
        o.filename = r.ptpString() ?? ""
        return o
    }
}

// MARK: - Canon EOS events and live-view frames

struct CanonEvent {
    let type: UInt32
    let payload: Data
}

enum CanonEOS {
    /// GetEvent data is a list of records: [UInt32 size][UInt32 type][payload], ended by size 8 / type 0.
    static func parseEvents(_ d: Data) -> [CanonEvent] {
        let b = Data(d)
        var out: [CanonEvent] = []
        var off = 0
        while off + 8 <= b.count {
            guard let size = le32(b, off), let type = le32(b, off + 4) else { break }
            if size < 8 || off + Int(size) > b.count { break }
            if type == 0 && size == 8 { break }
            out.append(CanonEvent(type: type, payload: b.subdata(in: (off + 8)..<(off + Int(size)))))
            off += Int(size)
        }
        return out
    }

    /// GetViewFinderData returns records too; type 1 is the JPEG. Falls back to scanning for SOI/EOI.
    static func extractJPEG(_ d: Data) -> Data? {
        let b = Data(d)
        var off = 0
        while off + 8 <= b.count {
            guard let size = le32(b, off), let type = le32(b, off + 4) else { break }
            if size < 8 || off + Int(size) > b.count { break }
            if type == 1 {
                let j = b.subdata(in: (off + 8)..<(off + Int(size)))
                if j.count > 2, j[0] == 0xFF, j[1] == 0xD8 { return j }
            }
            off += Int(size)
        }
        // Fallback: first FF D8 FF … last FF D9
        let bytes = [UInt8](b)
        guard bytes.count > 4 else { return nil }
        var start: Int?
        for i in 0..<(bytes.count - 2) where bytes[i] == 0xFF && bytes[i + 1] == 0xD8 && bytes[i + 2] == 0xFF {
            start = i; break
        }
        guard let s = start else { return nil }
        var end = bytes.count
        var i = bytes.count - 2
        while i > s {
            if bytes[i] == 0xFF && bytes[i + 1] == 0xD9 { end = i + 2; break }
            i -= 1
        }
        return Data(bytes[s..<end])
    }
}

/// Canon exposure codes as the camera's own display writes them. The code is an exact power of two
/// in stops; the label is the nearest value on the maker's ladder (1/128 s is written 1/125).
enum EOSExposure {
    private static func snap(_ v: Double, _ ladder: [Double]) -> Double {
        ladder.min(by: { abs(log($0) - log(v)) < abs(log($1) - log(v)) }) ?? v
    }

    private static func seconds(_ v: Double) -> String {
        v == v.rounded() ? "\(Int(v))\"" : String(format: "%.1f\"", v)
    }

    private static let slowLadder: [Double] = [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.5, 1.6, 2, 2.5, 3, 3.2, 4, 5, 6, 6.3, 8, 10, 13, 15, 20, 25, 30]
    private static let fastLadder: [Double] = [
        1.3, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30, 40, 45, 50, 60, 80, 90, 100, 125, 160, 180, 200, 250, 320, 350, 400, 500, 640, 750, 800,
        1000, 1250, 1500, 1600, 2000, 2500, 3000, 3200, 4000, 5000, 6400, 8000,
    ]

    /// 0x38 is 1 s and every 8 codes is a stop.
    static func shutterLabel(_ code: UInt32) -> String? {
        if code == 0x0C { return "Bulb" }
        guard code >= 0x10, code <= 0xA8 else { return nil }
        let t = pow(2.0, (56.0 - Double(code)) / 8.0)
        if t >= 0.3 { return seconds(snap(t, slowLadder)) }
        let n = snap(1.0 / t, fastLadder)
        return n == n.rounded() ? "1/\(Int(n))" : String(format: "1/%.1f", n)
    }

    private static let apertureLadder: [Double] = [
        1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32, 36, 40, 45, 51, 57, 64,
    ]

    /// 0x08 is f/1.0 and every 16 codes is a stop.
    static func apertureLabel(_ code: UInt32) -> String? {
        guard code >= 0x08, code <= 0x68 else { return nil }
        let f = snap(pow(2.0, (Double(code) - 8.0) / 16.0), apertureLadder)
        return f == f.rounded() ? "f/\(Int(f))" : String(format: "f/%.1f", f)
    }

    private static let isoLadder: [Double] = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600]

    /// 0x40 is ISO 50 and every 8 codes is a stop; 0 is the camera's own Auto ISO.
    static func isoLabel(_ code: UInt32) -> String? {
        if code == 0x00 { return "Auto" }
        guard code >= 0x40, code <= 0x98 else { return nil }
        return "ISO \(Int(snap(50.0 * pow(2.0, (Double(code) - 64.0) / 8.0), isoLadder)))"
    }
}

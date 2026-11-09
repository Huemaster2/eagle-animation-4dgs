import AppKit
import Foundation
import ImageCaptureCore
import ImageIO

// Talks to a Canon EOS body through Apple's ImageCaptureCore.
//
// Why ImageCaptureCore: on macOS 14.1+ the system daemon `ptpcamerad` claims PTP cameras,
// which forces libgphoto2 to run as root. ImageCaptureCore cooperates with ptpcamerad and
// offers PTP pass-through, so we can send Canon's vendor commands (live view, remote release,
// event polling) from a normal double-clickable app.
//
// Threading: ImageCaptureCore objects are touched on the main thread. Every PTP transaction
// runs on `ptpQueue` (serial) and blocks that queue until the camera answers, so commands
// never overlap.

enum SaveTarget: Int {
    case cardAndMac = 0   // camera writes to CF card, we copy the file to the Mac
    case macOnly = 1      // camera keeps image in RAM and hands it to the Mac (no card writes)
}

enum CamError: LocalizedError {
    case notConnected
    case timeout(UInt16)
    case transport(UInt16, String)
    case badResponse(UInt16, Int)
    case refused(String, UInt16)
    case noImageArrived
    case writeFailed(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: return "No camera session is open."
        case .timeout(let op): return "Camera did not answer \(hex(op)) in time."
        case .transport(let op, let m): return "USB/ImageCapture error on \(hex(op)): \(m)"
        case .badResponse(let op, let n): return "Unreadable response to \(hex(op)) (\(n) bytes)."
        case .refused(let what, let rc): return "\(what) refused by camera (response \(hex(rc)))."
        case .noImageArrived: return "Shutter fired (or was asked to) but no image arrived from the camera."
        case .writeFailed(let m): return "Could not save image: \(m)"
        }
    }
}

final class Locked<T> {
    private var v: T
    private let l = NSLock()
    init(_ v: T) { self.v = v }
    var value: T {
        get { l.lock(); defer { l.unlock() }; return v }
        set { l.lock(); v = newValue; l.unlock() }
    }
}

final class CameraController: NSObject {

    // UI callbacks — always delivered on the main thread.
    var onLog: ((String) -> Void)?
    var onStatus: ((String, Bool) -> Void)?
    var onLiveFrame: ((NSImage, Double, CGSize) -> Void)?
    var onCaptured: ((URL, String) -> Void)?
    var onBusy: ((Bool) -> Void)?

    let captureDir: URL
    private let logFile: URL

    private let browser = ICDeviceBrowser()
    private let ptpQueue = DispatchQueue(label: "stopmo.ptp", qos: .userInitiated)
    private let cameraRef = Locked<ICCameraDevice?>(nil)
    private let sessionOpen = Locked(false)
    private let ready = Locked(false)
    private let liveViewOn = Locked(false)
    private var tidCounter = Locked<UInt32>(1)

    private(set) var deviceInfo: PTPDeviceInfo?
    private var canonModeOn = false
    private var originalCaptureDest: UInt32?
    private(set) var propValues: [UInt32: UInt32] = [:]
    var saveTarget: SaveTarget = .cardAndMac

    /// If the camera rejects SetDevicePropValueEx, try `defaults write com.stopmo.stage1 wrapOutData -bool YES`.
    private let wrapOutData = UserDefaults.standard.bool(forKey: "wrapOutData")

    // Live view stats
    private var lvFrames = 0
    private var lvWindowStart = Date()
    private var lvFPS: Double = 0
    private var lvTicks = 0
    private var lvFailures = 0
    private(set) var lastLiveViewSize: CGSize = .zero

    // Native (ImageCaptureCore) capture
    private var nativePending = false
    private var nativeDone: ((URL?) -> Void)?
    private var nativeFrameNumber = 0

    private(set) var hotplugEvents: [String] = []

    var camera: ICCameraDevice? { cameraRef.value }
    var isReady: Bool { ready.value && sessionOpen.value }
    var isLiveViewOn: Bool { liveViewOn.value }

    override init() {
        let pics = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
        captureDir = pics.appendingPathComponent("StopMo", isDirectory: true).appendingPathComponent("Camera_Test", isDirectory: true)
        logFile = captureDir.appendingPathComponent("stage1_log.txt")
        super.init()
        try? FileManager.default.createDirectory(at: captureDir, withIntermediateDirectories: true)
    }

    // MARK: Logging

    func log(_ s: String) {
        let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current,
                                                formatOptions: [.withTime, .withColonSeparatorInTime, .withFractionalSeconds])
        let line = "[\(stamp)] \(s)"
        if let d = (line + "\n").data(using: .utf8) {
            if let h = try? FileHandle(forWritingTo: logFile) {
                h.seekToEndOfFile(); h.write(d); try? h.close()
            } else {
                try? d.write(to: logFile)
            }
        }
        DispatchQueue.main.async { self.onLog?(line) }
    }

    private func status(_ s: String, _ connected: Bool) {
        DispatchQueue.main.async { self.onStatus?(s, connected) }
    }

    private func busy(_ b: Bool) {
        DispatchQueue.main.async { self.onBusy?(b) }
    }

    // MARK: Discovery

    func start() {
        log("StopMo Stage 1 starting. macOS \(ProcessInfo.processInfo.operatingSystemVersionString), \(machineArch())")
        log("Captures and logs go to: \(captureDir.path)")
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(
            rawValue: ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue)
        browser.requestControlAuthorization { status in
            self.log("Camera control authorisation: \(status.rawValue)")
        }
        browser.requestContentsAuthorization { status in
            self.log("Camera contents authorisation: \(status.rawValue)")
        }
        browser.start()
        status("Looking for a camera… (plug in the 5D Mark II and switch it on)", false)
    }

    func connect(_ cam: ICCameraDevice) {
        cameraRef.value = cam
        cam.delegate = self
        status("Opening session with \(cam.name ?? "camera")…", false)
        log("Opening session with \(cam.name ?? "?")")
        cam.requestOpenSession()
        // Some cameras never send deviceDidBecomeReady if the card is huge; don't wait forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self, self.sessionOpen.value, !self.ready.value, self.camera === cam else { return }
            self.log("Camera hasn't finished listing its card after 30 s — continuing anyway.")
            self.markReady(cam)
        }
    }

    func reconnect() {
        if let cam = camera {
            handleDisconnect(reason: "Manual reconnect")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.connect(cam) }
        } else if let first = browser.devices?.compactMap({ $0 as? ICCameraDevice }).first {
            connect(first)
        } else {
            log("No camera visible to macOS. Check the cable, the power switch, and that EOS Utility / Image Capture are closed.")
        }
    }

    private func markReady(_ cam: ICCameraDevice) {
        guard !ready.value else { return }
        ready.value = true
        status("Connected: \(cam.name ?? "camera")", true)
        log("Camera ready. ImageCaptureCore capabilities: \(cam.capabilities.joined(separator: ", "))")
        ptpQueue.async { self.readDeviceInfoSync() }
    }

    private func handleDisconnect(reason: String) {
        log("Disconnected: \(reason)")
        hotplugEvents.append("\(Date()): disconnect (\(reason))")
        liveViewOn.value = false
        sessionOpen.value = false
        ready.value = false
        canonModeOn = false
        deviceInfo = nil
        if let cam = cameraRef.value { cam.delegate = nil }
        cameraRef.value = nil
        status("Camera disconnected — plug it back in; it will reconnect automatically.", false)
    }

    /// Called on quit: hand the camera back in a sane state.
    func shutdown() {
        let done = DispatchSemaphore(value: 0)
        liveViewOn.value = false
        ptpQueue.async {
            if self.canonModeOn {
                _ = try? self.setEOSPropSync(EOSProp.evfOutputDevice, 1)
                if let orig = self.originalCaptureDest { _ = try? self.setEOSPropSync(EOSProp.captureDestination, orig) }
                _ = try? self.ptp(PTPOp.eosSetEventMode, [0], timeout: 2)
                _ = try? self.ptp(PTPOp.eosSetRemoteMode, [0], timeout: 2)
            }
            done.signal()
        }
        _ = done.wait(timeout: .now() + 4)
        camera?.requestCloseSession()
    }

    // MARK: PTP transport (call only on ptpQueue)

    @discardableResult
    func ptp(_ code: UInt16, _ params: [UInt32] = [], out: Data? = nil, timeout: TimeInterval = 20) throws -> PTPResponse {
        dispatchPrecondition(condition: .onQueue(ptpQueue))
        guard let cam = cameraRef.value, sessionOpen.value else { throw CamError.notConnected }

        let tid: UInt32 = { let t = tidCounter.value; tidCounter.value = t &+ 1; return t }()
        let cmd = PTP.command(code: code, tid: tid, params: params)
        var outPayload = out
        if let o = out, wrapOutData { outPayload = PTP.dataContainer(code: code, tid: tid, payload: o) }

        let sem = DispatchSemaphore(value: 0)
        let result = Locked<(Data, Data, Error?)>((Data(), Data(), nil))
        DispatchQueue.main.async {
            cam.requestSendPTPCommand(cmd, outData: outPayload) { data, response, error in
                result.value = (data, response, error)
                sem.signal()
            }
        }
        if sem.wait(timeout: .now() + timeout) == .timedOut { throw CamError.timeout(code) }

        var (dataBlob, respBlob, err) = result.value
        if let err { throw CamError.transport(code, err.localizedDescription) }
        // Be tolerant about which blob is which.
        if PTP.parseResponse(respBlob) == nil, PTP.parseResponse(dataBlob) != nil { swap(&dataBlob, &respBlob) }
        guard let r = PTP.parseResponse(respBlob) else { throw CamError.badResponse(code, respBlob.count) }
        return PTPResponse(code: r.code, params: r.params, data: PTP.stripDataContainer(dataBlob))
    }

    @discardableResult
    func setEOSPropSync(_ prop: UInt32, _ value: UInt32) throws -> PTPResponse {
        let r = try ptp(PTPOp.eosSetDevicePropValueEx, out: PTP.eosPropPayload(prop: prop, value: value))
        log("Set \(EOSProp.name(prop)) = \(hex(value)) → \(hex(r.code))")
        return r
    }

    // MARK: Device info and Canon remote mode

    func readDeviceInfoSync() {
        do {
            let r = try ptp(PTPOp.getDeviceInfo)
            guard r.ok, let info = PTPDeviceInfo.parse(r.data) else {
                log("GetDeviceInfo failed: \(hex(r.code)), \(r.data.count) bytes")
                return
            }
            deviceInfo = info
            log("Model: \(info.manufacturer) \(info.model), firmware \(info.deviceVersion), vendor ext \(hex(info.vendorExtensionID, width: 8)) \"\(info.vendorExtensionDesc)\"")
            log("Supports: live view data \(info.supports(PTPOp.eosGetViewFinderData)), RemoteRelease(0x910F) \(info.supports(PTPOp.eosRemoteRelease)), RemoteReleaseOn(0x9128) \(info.supports(PTPOp.eosRemoteReleaseOn)), GetEvent \(info.supports(PTPOp.eosGetEvent)); \(info.operations.count) operations total")
            log("All operations: " + info.operations.map { hex($0) }.joined(separator: " "))
        } catch {
            log("GetDeviceInfo error: \(error.localizedDescription)")
        }
    }

    func enableCanonModeSync() throws {
        if canonModeOn { return }
        let a = try ptp(PTPOp.eosSetRemoteMode, [1])
        log("SetRemoteMode(1) → \(hex(a.code))")
        guard a.ok else { throw CamError.refused("Remote mode", a.code) }
        let b = try ptp(PTPOp.eosSetEventMode, [1])
        log("SetEventMode(1) → \(hex(b.code))")
        canonModeOn = true
        // First GetEvent returns a dump of every property value.
        _ = try? pollEventsSync()
        originalCaptureDest = propValues[EOSProp.captureDestination]
        logExposureState()
    }

    @discardableResult
    func pollEventsSync() throws -> [CanonEvent] {
        let r = try ptp(PTPOp.eosGetEvent, timeout: 10)
        guard r.ok else { return [] }
        let events = CanonEOS.parseEvents(r.data)
        for e in events where e.type == EOSEvent.propValueChanged {
            if let p = le32(e.payload, 0), let v = le32(e.payload, 4) { propValues[p] = v }
        }
        return events
    }

    func logExposureState() {
        let keys = [EOSProp.autoExposureMode, EOSProp.aperture, EOSProp.shutterSpeed, EOSProp.iso,
                    EOSProp.expCompensation, EOSProp.whiteBalance, EOSProp.imageFormat, EOSProp.captureDestination]
        let parts = keys.map { k in "\(EOSProp.name(k))=\(propValues[k].map { hex($0) } ?? "?")" }
        log("Camera settings (raw Canon codes): " + parts.joined(separator: ", "))
    }

    // MARK: Live view

    func startLiveView() {
        busy(true)
        ptpQueue.async {
            defer { self.busy(false) }
            do {
                try self.startLiveViewSync()
                self.scheduleLiveViewTick()
            } catch {
                self.log("Live view failed to start: \(error.localizedDescription)")
            }
        }
    }

    func stopLiveView() {
        liveViewOn.value = false
        ptpQueue.async {
            _ = try? self.setEOSPropSync(EOSProp.evfOutputDevice, 1)
            self.log("Live view stopped")
        }
    }

    func startLiveViewSync() throws {
        try enableCanonModeSync()
        _ = try? setEOSPropSync(EOSProp.evfMode, 1)              // not every body has this; ignore errors
        let r = try setEOSPropSync(EOSProp.evfOutputDevice, 2)   // 2 = send live view to the PC
        guard r.ok else { throw CamError.refused("Live view", r.code) }
        lvFrames = 0; lvFailures = 0; lvWindowStart = Date()
        liveViewOn.value = true
        log("Live view requested; waiting for first frame (camera needs ~1 s to raise the mirror)")
    }

    private func scheduleLiveViewTick(after delay: TimeInterval = 0) {
        ptpQueue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.liveViewTick() }
    }

    private func liveViewTick() {
        guard liveViewOn.value, cameraRef.value != nil else { return }
        _ = fetchLiveViewFrameSync()
        lvTicks += 1
        if lvTicks % 20 == 0 { _ = try? pollEventsSync() }   // keeps the camera's event queue drained
        if lvFailures > 40 {
            log("Live view: 40 failures in a row — stopping. See log above.")
            liveViewOn.value = false
            return
        }
        scheduleLiveViewTick(after: 0.01)
    }

    /// Fetches one frame and pushes it to the UI. Returns true if a frame was decoded.
    @discardableResult
    func fetchLiveViewFrameSync() -> Bool {
        do {
            let r = try ptp(PTPOp.eosGetViewFinderData, [0x0010_0000], timeout: 5)
            if r.ok, let jpg = CanonEOS.extractJPEG(r.data), let img = NSImage(data: jpg) {
                lvFailures = 0
                lvFrames += 1
                let elapsed = Date().timeIntervalSince(lvWindowStart)
                if elapsed >= 1 {
                    lvFPS = Double(lvFrames) / elapsed
                    lvFrames = 0; lvWindowStart = Date()
                }
                let size = img.representations.first.map { CGSize(width: $0.pixelsWide, height: $0.pixelsHigh) } ?? img.size
                lastLiveViewSize = size
                let fps = lvFPS
                DispatchQueue.main.async { self.onLiveFrame?(img, fps, size) }
                return true
            }
            if r.code == PTPResp.eosNotReady || r.code == PTPResp.deviceBusy {
                Thread.sleep(forTimeInterval: 0.05)
            } else {
                lvFailures += 1
                if lvFailures % 10 == 1 { log("Live view frame: response \(hex(r.code)), \(r.data.count) bytes") }
            }
        } catch {
            lvFailures += 1
            if lvFailures % 10 == 1 { log("Live view frame error: \(error.localizedDescription)") }
        }
        return false
    }

    // MARK: Capture via Canon PTP (primary path)

    func captureCanon() {
        busy(true)
        ptpQueue.async {
            defer { self.busy(false) }
            do {
                let urls = try self.captureCanonSync()
                for u in urls {
                    let s = self.imageSummary(u)
                    DispatchQueue.main.async { self.onCaptured?(u, s) }
                }
            } catch {
                self.log("Capture failed: \(error.localizedDescription)")
            }
        }
    }

    /// Fires the shutter and downloads every file the camera produces (JPEG and/or CR2).
    func captureCanonSync() throws -> [URL] {
        try enableCanonModeSync()

        switch saveTarget {
        case .macOnly:
            try? setEOSPropSync(EOSProp.captureDestination, 4)                      // 4 = keep in camera RAM
            _ = try? ptp(PTPOp.eosPCHDDCapacity, [0x04FF_FFFF, 0x1000, 1])          // tell camera the Mac has space
        case .cardAndMac:
            if let orig = originalCaptureDest, propValues[EOSProp.captureDestination] != orig {
                try? setEOSPropSync(EOSProp.captureDestination, orig)
            }
        }

        _ = try? pollEventsSync()                 // flush anything stale
        let frameNumber = nextFrameNumber()
        let t0 = Date()

        if deviceInfo?.supports(PTPOp.eosRemoteReleaseOn) == true {
            let on = try ptp(PTPOp.eosRemoteReleaseOn, [3, 0])
            let off = try ptp(PTPOp.eosRemoteReleaseOff, [3])
            log("RemoteReleaseOn(3) → \(hex(on.code)), Off → \(hex(off.code))")
            guard on.ok else { throw CamError.refused("Shutter release", on.code) }
        } else {
            let r = try ptp(PTPOp.eosRemoteRelease)
            log("RemoteRelease → \(hex(r.code)) params \(r.params.map { hex($0) })")
            guard r.ok else { throw CamError.refused("Shutter release", r.code) }
            if let p = r.params.first, p != 0 {
                log("Camera reported release problem \(p). Usual causes: lens on AF and can't focus, no card, card full, or camera busy.")
                throw CamError.refused("Shutter release (camera status \(p))", r.code)
            }
        }

        // Wait for the camera to announce the new file(s). RAW+JPEG gives two.
        var handles: [(UInt32, Bool)] = []    // (handle, needsTransferComplete)
        var lastNew = Date()
        while Date().timeIntervalSince(t0) < 25 {
            for e in try pollEventsSync() where e.type == EOSEvent.objectAddedEx || e.type == EOSEvent.requestObjectTransfer {
                if let h = le32(e.payload, 0), !handles.contains(where: { $0.0 == h }) {
                    handles.append((h, e.type == EOSEvent.requestObjectTransfer))
                    lastNew = Date()
                    log("Camera announced object \(hex(h, width: 8)) via event \(hex(e.type, width: 4))")
                }
            }
            if !handles.isEmpty && Date().timeIntervalSince(lastNew) > 0.8 { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard !handles.isEmpty else { throw CamError.noImageArrived }
        log(String(format: "Shutter-to-announce: %.2f s", Date().timeIntervalSince(t0)))

        var urls: [URL] = []
        for (h, needsComplete) in handles {
            var name = "IMG.JPG"
            var expected: UInt32 = 0
            if let infoResp = try? ptp(PTPOp.getObjectInfo, [h]), infoResp.ok, let oi = PTPObjectInfo.parse(infoResp.data) {
                if !oi.filename.isEmpty { name = oi.filename }
                expected = oi.compressedSize
                log("Object \(hex(h, width: 8)): \(oi.filename), \(oi.compressedSize) bytes, \(oi.imageWidth)×\(oi.imageHeight)")
            }
            let td = Date()
            let obj = try ptp(PTPOp.getObject, [h], timeout: 120)
            guard obj.ok else { log("GetObject \(hex(h, width: 8)) → \(hex(obj.code))"); continue }
            if needsComplete || saveTarget == .macOnly { _ = try? ptp(PTPOp.eosTransferComplete, [h]) }
            if expected > 0 && UInt32(obj.data.count) != expected {
                log("WARNING: received \(obj.data.count) bytes but camera said \(expected)")
            }
            let url = try writeNoOverwrite(obj.data, originalName: name, frameNumber: frameNumber)
            log(String(format: "Saved %@ (%.1f MB in %.2f s)", url.lastPathComponent,
                       Double(obj.data.count) / 1_048_576, Date().timeIntervalSince(td)))
            urls.append(url)
        }
        return urls
    }

    // MARK: Capture via ImageCaptureCore (fallback path, used before Canon mode is on)

    func captureNative(completion: ((URL?) -> Void)? = nil) {
        DispatchQueue.main.async {
            guard let cam = self.camera, self.isReady else {
                self.log("Native capture: camera not ready"); completion?(nil); return
            }
            if !cam.capabilities.contains("ICCameraDeviceCanTakePicture") {
                self.log("Native capture: macOS says this camera doesn't support remote capture through ImageCaptureCore. Trying anyway.")
            }
            self.nativePending = true
            self.nativeDone = completion
            self.nativeFrameNumber = self.nextFrameNumber()
            if !cam.tetheredCaptureEnabled { cam.requestEnableTethering() }
            self.log("Native capture: requestTakePicture()")
            cam.requestTakePicture()
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
                if self.nativePending {
                    self.nativePending = false
                    self.log("Native capture: no new file reported within 25 s")
                    self.nativeDone?(nil); self.nativeDone = nil
                }
            }
        }
    }

    private func downloadNative(_ file: ICCameraFile) {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let opts: [ICDownloadOption: Any] = [.downloadsDirectoryURL: tmp]
        log("Native capture: downloading \(file.name ?? "?") (\(file.fileSize) bytes)")
        _ = file.requestDownload(options: opts) { filename, error in
            DispatchQueue.main.async {
                var saved: URL?
                if let error {
                    self.log("Native download failed: \(error.localizedDescription)")
                } else if let filename {
                    let src = tmp.appendingPathComponent(filename)
                    if let data = try? Data(contentsOf: src) {
                        saved = try? self.writeNoOverwrite(data, originalName: filename, frameNumber: self.nativeFrameNumber)
                    }
                    try? FileManager.default.removeItem(at: tmp)
                }
                if let saved {
                    self.log("Native capture saved \(saved.lastPathComponent)")
                    self.onCaptured?(saved, self.imageSummary(saved))
                }
                self.nativeDone?(saved); self.nativeDone = nil
            }
        }
    }

    // MARK: Files — never overwrite

    func nextFrameNumber() -> Int {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: captureDir.path)) ?? []
        let nums = names.compactMap { n -> Int? in
            guard n.hasPrefix("Test_") else { return nil }
            return Int(n.dropFirst(5).prefix(while: { $0.isNumber }))
        }
        return (nums.max() ?? 0) + 1
    }

    func writeNoOverwrite(_ data: Data, originalName: String, frameNumber: Int) throws -> URL {
        var ext = (originalName as NSString).pathExtension.uppercased()
        if ext.isEmpty { ext = "JPG" }
        try FileManager.default.createDirectory(at: captureDir, withIntermediateDirectories: true)
        var n = frameNumber
        while true {
            let url = captureDir.appendingPathComponent(String(format: "Test_%03d.%@", n, ext))
            if !FileManager.default.fileExists(atPath: url.path) {
                do {
                    try data.write(to: url, options: [.withoutOverwriting])
                    return url
                } catch {
                    throw CamError.writeFailed(error.localizedDescription)
                }
            }
            n += 1
        }
    }

    func imageDimensions(_ url: URL) -> (Int, Int)? {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (w, h)
    }

    /// CR2 = TIFF little-endian header ("II*\0") with "CR" at byte 8.
    func isCR2Signature(_ url: URL) -> Bool {
        guard let h = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? h.close() }
        let head = h.readData(ofLength: 12)
        return head.count == 12 && head.prefix(4) == Data([0x49, 0x49, 0x2A, 0x00]) && head[8] == 0x43 && head[9] == 0x52
    }

    func imageSummary(_ url: URL) -> String {
        let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.intValue ?? 0
        let mb = String(format: "%.1f MB", Double(size) / 1_048_576)
        let sig = url.pathExtension.uppercased() == "CR2" ? (isCR2Signature(url) ? ", CR2 signature OK" : ", BAD CR2 signature") : ""
        if let (w, h) = imageDimensions(url) { return "\(url.lastPathComponent) — \(w)×\(h) decoded by macOS RAW/image decoder, \(mb)\(sig)" }
        return "\(url.lastPathComponent) — \(mb) (could not decode)\(sig)"
    }

    // MARK: Stage 1 automated test

    func runStage1Test(completion: @escaping (URL) -> Void) {
        busy(true)
        let wasLive = liveViewOn.value
        liveViewOn.value = false
        ptpQueue.async {
            var lines: [String] = []
            var passCount = 0, failCount = 0
            func check(_ ok: Bool, _ name: String, _ detail: String = "") {
                lines.append("\(ok ? "PASS" : "FAIL")  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
                if ok { passCount += 1 } else { failCount += 1 }
                self.log("TEST \(ok ? "PASS" : "FAIL"): \(name) \(detail)")
            }
            func note(_ s: String) { lines.append("      \(s)") }

            lines.append("StopMo Stage 1 camera report — \(Date())")
            lines.append("Mac: macOS \(ProcessInfo.processInfo.operatingSystemVersionString), \(machineArch())")
            lines.append("")

            // 1. Detection
            guard let cam = self.cameraRef.value, self.isReady else {
                check(false, "Camera detected and session open", "no camera — check cable/power")
                self.finishReport(lines, completion); return
            }
            check(true, "Camera detected and session open",
                  "\(cam.name ?? "?") USB \(hex(cam.usbVendorID)):\(hex(cam.usbProductID))")

            // 2. Device info
            if self.deviceInfo == nil { self.readDeviceInfoSync() }
            if let info = self.deviceInfo {
                check(info.model.contains("5D Mark II"), "Model is EOS 5D Mark II", "\(info.model), firmware \(info.deviceVersion)")
                check(info.supports(PTPOp.eosGetViewFinderData), "Camera offers PC live view (0x9153)")
                check(info.supports(PTPOp.eosRemoteRelease) || info.supports(PTPOp.eosRemoteReleaseOn), "Camera offers remote release")
            } else {
                check(false, "Read PTP device info")
            }

            // 3. Native capture (only meaningful before Canon remote mode is switched on)
            if !self.canonModeOn {
                let sem = DispatchSemaphore(value: 0)
                var nativeURL: URL?
                self.captureNative { url in nativeURL = url; sem.signal() }
                _ = sem.wait(timeout: .now() + 30)
                if let u = nativeURL {
                    check(true, "macOS-native capture (fallback path)", self.imageSummary(u))
                } else {
                    lines.append("INFO  macOS-native capture not available — fine, the Canon path below is the primary one")
                }
            }

            // 4. Canon remote mode
            do {
                try self.enableCanonModeSync()
                check(true, "Canon remote mode")
                note("Settings: " + [EOSProp.autoExposureMode, EOSProp.aperture, EOSProp.shutterSpeed, EOSProp.iso, EOSProp.imageFormat]
                        .map { "\(EOSProp.name($0))=\(self.propValues[$0].map { hex($0) } ?? "?")" }.joined(separator: ", "))
            } catch {
                check(false, "Canon remote mode", error.localizedDescription)
                self.finishReport(lines, completion); return
            }

            // 5. Live view for 8 seconds
            do {
                try self.startLiveViewSync()
                self.liveViewOn.value = false   // we drive frames manually during the test
                let start = Date()
                var frames = 0
                var firstFrameAt: TimeInterval?
                while Date().timeIntervalSince(start) < 8 {
                    if self.fetchLiveViewFrameSync() {
                        frames += 1
                        if firstFrameAt == nil { firstFrameAt = Date().timeIntervalSince(start) }
                    }
                }
                let fps = Double(frames) / max(0.1, 8 - (firstFrameAt ?? 0))
                check(frames > 10, "Live view frames received",
                      String(format: "%d frames, ~%.1f fps, %d×%d, first frame after %.1f s",
                             frames, fps, Int(self.lastLiveViewSize.width), Int(self.lastLiveViewSize.height), firstFrameAt ?? -1))
            } catch {
                check(false, "Live view", error.localizedDescription)
            }

            // 6. Three captures with live view running, verifying full resolution
            var captureTimes: [Double] = []
            for i in 1...3 {
                let t = Date()
                do {
                    let urls = try self.captureCanonSync()
                    captureTimes.append(Date().timeIntervalSince(t))
                    for u in urls {
                        let dims = self.imageDimensions(u)
                        let full = dims.map { $0.0 >= 5616 && $0.1 >= 3744 } ?? false
                        let isRaw = u.pathExtension.uppercased() == "CR2"
                        let rawOK = !isRaw || self.isCR2Signature(u)
                        check(full && rawOK, "Capture \(i): full-resolution \(isRaw ? "CR2 RAW" : "JPEG") saved and decoded", self.imageSummary(u))
                        DispatchQueue.main.async { self.onCaptured?(u, self.imageSummary(u)) }
                    }
                } catch {
                    check(false, "Capture \(i)", error.localizedDescription)
                }
                // live view should come back between captures
                var resumed = false
                let t2 = Date()
                while Date().timeIntervalSince(t2) < 4 && !resumed { resumed = self.fetchLiveViewFrameSync() }
                check(resumed, "Live view resumed after capture \(i)")
            }
            if !captureTimes.isEmpty {
                note(String(format: "Capture round-trip (shutter → file on Mac): %@ s",
                            captureTimes.map { String(format: "%.2f", $0) }.joined(separator: ", ")))
            }

            // 7. No-overwrite rule
            let probe = self.captureDir.appendingPathComponent("Test_001.CR2")
            if FileManager.default.fileExists(atPath: probe.path) {
                let before = (try? Data(contentsOf: probe))?.count ?? -1
                let u = try? self.writeNoOverwrite(Data([0]), originalName: "x.CR2", frameNumber: 1)
                let after = (try? Data(contentsOf: probe))?.count ?? -1
                check(before == after && u != probe, "Existing frames are never overwritten", "test write went to \(u?.lastPathComponent ?? "?")")
                if let u { try? FileManager.default.removeItem(at: u) }
            }

            lines.append("")
            if !self.hotplugEvents.isEmpty {
                lines.append("Hot-plug events this session:")
                self.hotplugEvents.forEach { lines.append("      \($0)") }
            }
            lines.append("MANUAL CHECK: unplug the USB cable, wait for 'disconnected', plug back in — the status should return to 'Connected' without restarting the app.")
            lines.append("")
            lines.append("Result: \(passCount) passed, \(failCount) failed")

            if wasLive || self.canonModeOn {
                self.liveViewOn.value = true
                self.scheduleLiveViewTick()
            }
            self.finishReport(lines, completion)
        }
    }

    private func finishReport(_ lines: [String], _ completion: @escaping (URL) -> Void) {
        let url = captureDir.appendingPathComponent("stage1_report.txt")
        try? lines.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
        log("Report written to \(url.path)")
        busy(false)
        DispatchQueue.main.async { completion(url) }
    }
}

// MARK: - ImageCaptureCore delegates

extension CameraController: ICDeviceBrowserDelegate {
    func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        log("Device appeared: \(device.name ?? "?") USB \(hex(device.usbVendorID)):\(hex(device.usbProductID)) transport \(device.transportType ?? "?")")
        guard let cam = device as? ICCameraDevice else { return }
        hotplugEvents.append("\(Date()): connect \(cam.name ?? "?")")
        if camera == nil { connect(cam) }
    }

    func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        if device === camera { handleDisconnect(reason: "camera unplugged or switched off") }
    }
}

extension CameraController: ICCameraDeviceDelegate {
    func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
        if let error {
            log("Could not open camera session: \(error.localizedDescription). Is EOS Utility, Image Capture or Photos using the camera?")
            status("Camera found but busy — close other camera apps, then click Reconnect", false)
            cameraRef.value = nil
            return
        }
        sessionOpen.value = true
        log("Session open — waiting for camera to finish listing its card")
        status("Connected — reading camera…", true)
    }

    func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        markReady(device)
    }

    func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        sessionOpen.value = false
        log("Session closed\(error.map { ": \($0.localizedDescription)" } ?? "")")
    }

    func didRemove(_ device: ICDevice) {
        if device === camera { handleDisconnect(reason: "device removed") }
    }

    func device(_ device: ICDevice, didEncounterError error: Error?) {
        log("Camera error: \(error?.localizedDescription ?? "unknown")")
    }

    func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {
        guard nativePending else { return }
        for case let f as ICCameraFile in items {
            nativePending = false
            downloadNative(f)
            break
        }
    }

    func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
    func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: Error?) {}
    func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem, error: Error?) {}
    func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
    func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
    func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {}
    func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {
        log("Camera access restriction removed")
    }
    func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {
        log("Camera access restricted by macOS — check System Settings › Privacy & Security")
    }
}

func machineArch() -> String {
    var sys = utsname()
    uname(&sys)
    return withUnsafePointer(to: &sys.machine) {
        $0.withMemoryRebound(to: CChar.self, capacity: 256) { String(cString: $0) }
    }
}

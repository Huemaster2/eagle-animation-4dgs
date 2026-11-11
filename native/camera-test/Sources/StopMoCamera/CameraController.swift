import CoreGraphics
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

/// Canon EOS ImageFormat (0xD120): n entries of [0x10, type, size, compression].
/// type 1 = JPEG, 6 = RAW; size 0 = Large; compression 2/3 = JPEG normal/fine, 4 = RAW.
public enum RawQuality: Int, CaseIterable {
    case rawOnly = 0, rawPlusLargeFineJPEG = 1, largeFineJPEG = 2

    public var title: String {
        switch self {
        case .rawOnly: return "RAW (CR2) only"
        case .rawPlusLargeFineJPEG: return "RAW + Large Fine JPEG"
        case .largeFineJPEG: return "Large Fine JPEG only"
        }
    }

    public var values: [UInt32] {
        switch self {
        case .rawOnly: return [1, 0x10, 6, 0, 4]
        case .rawPlusLargeFineJPEG: return [2, 0x10, 6, 0, 4, 0x10, 1, 0, 3]
        case .largeFineJPEG: return [1, 0x10, 1, 0, 3]
        }
    }
}

public func describeImageFormat(_ values: [UInt32]) -> String {
    guard let n = values.first, n > 0 else { return "unknown" }
    var parts: [String] = []
    var i = 1
    for _ in 0..<n {
        guard i + 3 < values.count else { break }
        let type = values[i + 1], size = values[i + 2], comp = values[i + 3]
        let sizeName = [0: "Large", 1: "Medium", 2: "Small", 0xe: "S1", 0xf: "S2", 0x10: "S3"][Int(size)] ?? "size \(size)"
        if type == 6 {
            parts.append(size == 0 ? "RAW (CR2)" : "sRAW (\(sizeName))")
        } else if type == 1 {
            parts.append("\(sizeName) JPEG \(comp == 3 ? "Fine" : "Normal")")
        } else {
            parts.append("type \(type)")
        }
        i += Int(values[i] / 4)
    }
    return parts.joined(separator: " + ")
}

public enum SaveTarget: Int {
    case cardAndMac = 0   // camera writes to CF card, we copy the file to the Mac
    case macOnly = 1      // camera keeps image in RAM and hands it to the Mac (no card writes)
    case cardOnly = 2     // originals stay on the card; only the preview comes over for the timeline

    public init?(name: String) {
        switch name.lowercased() {
        case "both", "card_and_mac": self = .cardAndMac
        case "mac", "mac_only": self = .macOnly
        case "card", "card_only": self = .cardOnly
        default: return nil
        }
    }
}

public enum CamError: LocalizedError {
    case notConnected
    case timeout(UInt16)
    case transport(UInt16, String)
    case badResponse(UInt16, Int)
    case refused(String, UInt16)
    case noImageArrived
    case autofocusNoRelease
    case writeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .notConnected: return "No camera session is open."
        case .timeout(let op): return "Camera did not answer \(hex(op)) in time."
        case .transport(let op, let m): return "USB/ImageCapture error on \(hex(op)): \(m)"
        case .badResponse(let op, let n): return "Unreadable response to \(hex(op)) (\(n) bytes)."
        case .refused(let what, let rc): return "\(what) refused by camera (response \(hex(rc)))."
        case .noImageArrived: return "The camera accepted the shutter command but sent no photo. If it did not click: autofocus could not lock (lens on AF with the cap on, subject too close or too dark) — switch the lens to MF. If it did click: check the card is in, unlocked and not full."
        case .autofocusNoRelease: return "No photo: the lens is on AF and the camera did not fire, so autofocus could not lock. Switch the lens to MF (recommended for stop motion) or give it something to focus on."
        case .writeFailed(let m): return "Could not save image: \(m)"
        }
    }
}

public final class Locked<T> {
    private var v: T
    private let l = NSLock()
    public init(_ v: T) { self.v = v }
    public var value: T {
        get { l.lock(); defer { l.unlock() }; return v }
        set { l.lock(); v = newValue; l.unlock() }
    }
}

public final class CameraController: NSObject {

    // UI callbacks — always delivered on the main thread.
    public var onLog: ((String) -> Void)?
    public var onStatus: ((String, Bool) -> Void)?
    public var onLiveFrame: ((Data, Double, CGSize) -> Void)?
    public var onCaptured: ((URL, String) -> Void)?
    public var onBusy: ((Bool) -> Void)?

    public let captureDir: URL
    private let logFile: URL

    private let browser = ICDeviceBrowser()
    private let ptpQueue = DispatchQueue(label: "stopmo.ptp", qos: .userInitiated)
    private let cameraRef = Locked<ICCameraDevice?>(nil)
    private let sessionOpen = Locked(false)
    private let ready = Locked(false)
    private let liveViewOn = Locked(false)
    private let capturing = Locked(false)
    private var tidCounter = Locked<UInt32>(1)

    private(set) var deviceInfo: PTPDeviceInfo?
    private var canonModeOn = false
    private var originalCaptureDest: UInt32?
    private(set) var propValues: [UInt32: UInt32] = [:]
    private(set) var imageFormatValues: [UInt32] = []
    /// Values the body says it will accept for a property, as it reports them in its own event stream
    private(set) var propLists: [UInt32: [UInt32]] = [:]
    private(set) var lastObjectSizes: [String: UInt64] = [:]

    // Helper-facing state
    public let latestLiveJPEG = Locked<Data?>(nil)
    public let liveFrameCounter = Locked<UInt64>(0)
    private var activeDestination: (dir: URL, baseName: String?)?
    private var captureRecords: [CaptureFile] = []
    // Files ImageCaptureCore reports as new on the card (handle, name, size). With the card as destination
    // the 5D Mark II writes the photo but sends no ObjectAdded PTP event, so this is how the new file is found.
    private let cardAdditions = Locked<[(UInt32, String, UInt32)]>([])
    private let watchCardAdditions = Locked(false)
    private var capturePreview: Data?
    private let lastError = Locked<String?>(nil)
    private var lastActivity = Date()
    public var saveTarget: SaveTarget = .cardAndMac

    /// If the camera rejects SetDevicePropValueEx, try `defaults write com.stopmo.stage1 wrapOutData -bool YES`.
    private let wrapOutData = UserDefaults.standard.bool(forKey: "wrapOutData")

    // Live view stats
    private var lvFrames = 0
    private var lvWindowStart = Date()
    private var lvFPS: Double = 0
    private var lvTicks = 0
    private var lvFailures = 0
    private var lvChainActive = false
    private(set) var lastLiveViewSize: CGSize = .zero

    // Native (ImageCaptureCore) capture
    private var nativePending = false
    private var nativeDone: ((URL?) -> Void)?
    private var nativeFrameNumber = 0

    private(set) var hotplugEvents: [String] = []

    var camera: ICCameraDevice? { cameraRef.value }
    public var isReady: Bool { ready.value && sessionOpen.value }
    public var isLiveViewOn: Bool { liveViewOn.value }
    /// True while the shutter and the file transfer have the camera: live view pauses on its own then.
    public var isCapturing: Bool { capturing.value }

    public init(captureDir: URL? = nil, logName: String = "stage1_log.txt") {
        let pics = FileManager.default.urls(for: .picturesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory())
        self.captureDir = captureDir ?? pics.appendingPathComponent("StopMo", isDirectory: true).appendingPathComponent("Camera_Test", isDirectory: true)
        logFile = self.captureDir.appendingPathComponent(logName)
        super.init()
        try? FileManager.default.createDirectory(at: self.captureDir, withIntermediateDirectories: true)
    }

    // MARK: Logging

    public func log(_ s: String) {
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

    public func start() {
        log("StopMo Stage 1 starting. macOS \(ProcessInfo.processInfo.operatingSystemVersionString), \(machineArch())")
        log("Captures and logs go to: \(captureDir.path)")
        browser.delegate = self
        browser.browsedDeviceTypeMask = ICDeviceTypeMask(
            rawValue: ICDeviceTypeMask.camera.rawValue | ICDeviceLocationTypeMask.local.rawValue)!
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

    public func reconnect() {
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
    public func shutdown() {
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
    /// Every object handle on the card, or nil if the camera will not list them right now.
    func cardHandlesSync() -> Set<UInt32>? {
        guard let r = try? ptp(PTPOp.getObjectHandles, [0xFFFF_FFFF, 0, 0], timeout: 15), r.ok, let count = le32(r.data, 0) else { return nil }
        var out = Set<UInt32>()
        var i = 0
        while i < Int(count), let h = le32(r.data, 4 + i * 4) {
            out.insert(h)
            i += 1
        }
        return out
    }

    /// Exposure time in seconds from the Canon shutter-speed code (0x38 = 1 s, 8 codes per stop); 0 when unknown or bulb.
    var exposureSeconds: Double {
        guard let code = propValues[EOSProp.shutterSpeed], code >= 0x10, code <= 0xA0 else { return 0 }
        return pow(2.0, (56.0 - Double(code)) / 8.0)
    }

    func pollEventsSync() throws -> [CanonEvent] {
        let r = try ptp(PTPOp.eosGetEvent, timeout: 10)
        guard r.ok else { return [] }
        let events = CanonEOS.parseEvents(r.data)
        for e in events where e.type == EOSEvent.propValueChanged {
            if let p = le32(e.payload, 0), let v = le32(e.payload, 4) { propValues[p] = v }
            if le32(e.payload, 0) == EOSProp.imageFormat {
                var vals: [UInt32] = []
                var off = 4
                while let v = le32(e.payload, off) { vals.append(v); off += 4 }
                imageFormatValues = vals
            }
        }
        // The camera lists what each dial will accept: property, data type, count, then the values
        for e in events where e.type == EOSEvent.availListChanged {
            guard let p = le32(e.payload, 0), let count = le32(e.payload, 8), count > 0, count <= 512 else { continue }
            var vals: [UInt32] = []
            var off = 12
            for _ in 0..<count {
                guard let v = le32(e.payload, off) else { break }
                vals.append(v)
                off += 4
            }
            if !vals.isEmpty { propLists[p] = vals }
        }
        return events
    }

    @discardableResult
    func setEOSPropValuesSync(_ prop: UInt32, _ values: [UInt32]) throws -> PTPResponse {
        var payload = Data()
        payload.appendLE(UInt32(8 + 4 * values.count))
        payload.appendLE(prop)
        for v in values { payload.appendLE(v) }
        let r = try ptp(PTPOp.eosSetDevicePropValueEx, out: payload)
        log("Set \(EOSProp.name(prop)) = \(values.map { hex($0) }) → \(hex(r.code))")
        return r
    }

    /// Switches the body's recording quality over USB and confirms it from the camera's own event report.
    func setQualitySync(_ q: RawQuality) throws -> Bool {
        try enableCanonModeSync()
        let r = try setEOSPropValuesSync(EOSProp.imageFormat, q.values)
        guard r.ok else { throw CamError.refused("Image quality change", r.code) }
        for _ in 0..<20 {
            _ = try? pollEventsSync()
            if Array(imageFormatValues.prefix(q.values.count)) == q.values { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        let confirmed = Array(imageFormatValues.prefix(q.values.count)) == q.values
        log("Camera now records: \(describeImageFormat(imageFormatValues))\(confirmed ? "" : " (camera did not confirm the change)")")
        return confirmed
    }

    /// Exposure dials the body exposes over USB, each with the values it says it will accept.
    public static let exposureProps: [(type: String, prop: UInt32, label: (UInt32) -> String?)] = [
        ("shutter_speed", EOSProp.shutterSpeed, EOSExposure.shutterLabel),
        ("aperture", EOSProp.aperture, EOSExposure.apertureLabel),
        ("iso", EOSProp.iso, EOSExposure.isoLabel),
    ]

    public func exposureParametersAsync(completion: @escaping ([[String: Any]]) -> Void) {
        ptpQueue.async {
            _ = try? self.pollEventsSync()
            var out: [[String: Any]] = []
            for spec in CameraController.exposureProps {
                guard let current = self.propValues[spec.prop], let currentLabel = spec.label(current) else { continue }
                var options: [[String: String]] = (self.propLists[spec.prop] ?? []).compactMap { code in
                    guard let l = spec.label(code) else { return nil }
                    return ["label": l, "value": String(code)]
                }
                if !options.contains(where: { $0["value"] == String(current) }) {
                    options.insert(["label": currentLabel, "value": String(current)], at: 0)
                }
                out.append(["type": spec.type, "kind": "select", "current": String(current), "options": options])
            }
            DispatchQueue.main.async { completion(out) }
        }
    }

    /// Hands the body back its own controls: in PC mode a Canon locks its dials and shows "busy".
    /// The session stays open, so the next command takes remote control again.
    public func releaseToBodyAsync(completion: @escaping (Error?) -> Void) {
        let wasLive = liveViewOn.value
        liveViewOn.value = false
        ptpQueue.async {
            if self.canonModeOn {
                if wasLive { _ = try? self.setEOSPropSync(EOSProp.evfOutputDevice, 1) }
                if let orig = self.originalCaptureDest { _ = try? self.setEOSPropSync(EOSProp.captureDestination, orig) }
                _ = try? self.ptp(PTPOp.eosSetEventMode, [0], timeout: 2)
                _ = try? self.ptp(PTPOp.eosSetRemoteMode, [0], timeout: 2)
                self.canonModeOn = false
                self.log("Released the camera: its own dials work again until the next command from here")
            }
            DispatchQueue.main.async { completion(nil) }
        }
    }

    /// Turns a dial over USB and confirms it from the camera's own event report.
    public func setExposureAsync(prop: UInt32, code: UInt32, completion: @escaping (Error?) -> Void) {
        ptpQueue.async {
            do {
                try self.enableCanonModeSync()
                let r = try self.setEOSPropSync(prop, code)
                guard r.ok else { throw CamError.refused("\(EOSProp.name(prop)) change", r.code) }
                for _ in 0..<20 {
                    _ = try? self.pollEventsSync()
                    if self.propValues[prop] == code { break }
                    Thread.sleep(forTimeInterval: 0.1)
                }
                let confirmed = self.propValues[prop] == code
                self.log("\(EOSProp.name(prop)) is now \(hex(self.propValues[prop] ?? 0))\(confirmed ? "" : " (the camera did not take the change: check the mode dial is on M)")")
                DispatchQueue.main.async {
                    completion(confirmed ? nil : CamError.refused("\(EOSProp.name(prop)) change (the camera did not take it: check the mode dial)", 0))
                }
            } catch {
                DispatchQueue.main.async { completion(error) }
            }
        }
    }

    public func setQuality(_ q: RawQuality) {
        busy(true)
        ptpQueue.async {
            defer { self.busy(false) }
            do { _ = try self.setQualitySync(q) } catch { self.log("Quality change failed: \(error.localizedDescription)") }
        }
    }

    func logExposureState() {
        let keys = [EOSProp.autoExposureMode, EOSProp.aperture, EOSProp.shutterSpeed, EOSProp.iso,
                    EOSProp.expCompensation, EOSProp.whiteBalance, EOSProp.imageFormat, EOSProp.captureDestination]
        let parts = keys.map { k in "\(EOSProp.name(k))=\(propValues[k].map { hex($0) } ?? "?")" }
        log("Camera settings (raw Canon codes): " + parts.joined(separator: ", "))
        log("Recording quality: \(describeImageFormat(imageFormatValues))")
    }

    // MARK: Live view

    public func startLiveView() {
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

    public func stopLiveView() {
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

    fileprivate func scheduleLiveViewTickInternal() {
        // Only one fetch chain at a time, or every frame would be asked for twice
        if lvChainActive { return }
        scheduleLiveViewTick()
    }

    private func scheduleLiveViewTick(after delay: TimeInterval = 0) {
        lvChainActive = true
        ptpQueue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.liveViewTick() }
    }

    private func liveViewTick() {
        guard liveViewOn.value, cameraRef.value != nil else { lvChainActive = false; return }
        _ = fetchLiveViewFrameSync()
        lvTicks += 1
        if lvTicks % 20 == 0 { _ = try? pollEventsSync() }   // keeps the camera's event queue drained
        if lvFailures > 40 {
            log("Live view: 40 failures in a row — stopping. See log above.")
            liveViewOn.value = false
            lvChainActive = false
            return
        }
        scheduleLiveViewTick(after: 0.01)
    }

    /// Fetches one frame and pushes it to the UI. Returns true if a frame was decoded.
    @discardableResult
    func fetchLiveViewFrameSync() -> Bool {
        do {
            let r = try ptp(PTPOp.eosGetViewFinderData, [0x0010_0000], timeout: 5)
            if r.ok, let jpg = CanonEOS.extractJPEG(r.data), let size = jpegPixelSize(jpg) {
                lvFailures = 0
                lvFrames += 1
                let elapsed = Date().timeIntervalSince(lvWindowStart)
                if elapsed >= 1 {
                    lvFPS = Double(lvFrames) / elapsed
                    lvFrames = 0; lvWindowStart = Date()
                }
                lastLiveViewSize = size
                latestLiveJPEG.value = jpg
                liveFrameCounter.value &+= 1
                let fps = lvFPS
                DispatchQueue.main.async { self.onLiveFrame?(jpg, fps, size) }
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

    public func captureCanon() {
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
        captureRecords = []
        capturePreview = nil

        switch saveTarget {
        case .macOnly:
            try? setEOSPropSync(EOSProp.captureDestination, 4)                      // 4 = keep in camera RAM
            _ = try? ptp(PTPOp.eosPCHDDCapacity, [0x04FF_FFFF, 0x1000, 1])          // tell camera the Mac has space
        case .cardAndMac, .cardOnly:
            if propValues[EOSProp.captureDestination] != 1 {
                try? setEOSPropSync(EOSProp.captureDestination, 1)                  // 1 = memory card
            }
        }
        if !lensIsManualFocus {
            log("Lens is on AF: the camera will not fire if autofocus cannot lock")
        }

        _ = try? pollEventsSync()                 // flush anything stale
        cardAdditions.value = []
        watchCardAdditions.value = saveTarget != .macOnly
        defer { watchCardAdditions.value = false }
        // The 5D Mark II sometimes saves a photo to the card without announcing it (seen about one shot in four).
        // Listing the card before and after finds that photo instead of losing it.
        let handlesBefore: Set<UInt32>? = saveTarget == .macOnly ? nil : cardHandlesSync()
        let exposure = exposureSeconds
        let waitLimit = 25 + 2 * exposure      // long exposures plus the camera's noise-reduction frame
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
        var eventSizes: [UInt32: UInt32] = [:]
        var eventNames: [UInt32: String] = [:]
        var lastNew = Date()
        var seenEvents: [UInt32: Int] = [:]
        var storageChangedAt: Date?
        var lastListing = Date.distantPast
        while Date().timeIntervalSince(t0) < waitLimit {
            let batch = try pollEventsSync()
            for e in batch { seenEvents[e.type, default: 0] += 1 }
            if storageChangedAt == nil, batch.contains(where: { $0.type == EOSEvent.storageInfoChanged }) { storageChangedAt = Date() }
            for e in batch where e.type == EOSEvent.objectAddedEx || e.type == EOSEvent.requestObjectTransfer {
                if let h = le32(e.payload, 0), !handles.contains(where: { $0.0 == h }) {
                    handles.append((h, e.type == EOSEvent.requestObjectTransfer))
                    // Event layout (libgphoto2 PTP_ece_OA_*): size at +0x14, file name at +0x20
                    if let size = le32(e.payload, 0x14), size > 0 { eventSizes[h] = size }
                    if e.payload.count > 0x21 {
                        let nameBytes = e.payload.subdata(in: (e.payload.startIndex + 0x20)..<e.payload.endIndex).prefix { $0 != 0 }
                        if let n = String(data: nameBytes, encoding: .ascii), n.contains("."), n.count < 64 { eventNames[h] = n }
                    }
                    lastNew = Date()
                    log("Camera announced object \(hex(h, width: 8)) via event \(hex(e.type, width: 4))")
                }
            }
            // Card captures: fall back to the files ImageCaptureCore saw appear on the card
            for (h, n, size) in cardAdditions.value where !handles.contains(where: { $0.0 == h }) {
                handles.append((h, false))
                if size > 0 { eventSizes[h] = size }
                eventNames[h] = n
                lastNew = Date()
                log("Card reported new file \(n) (\(hex(h, width: 8)))")
            }
            // No announcement: once the card reports a change (or well after the exposure), list it and take what is new
            if handles.isEmpty, let before = handlesBefore {
                let afterStorageChange = storageChangedAt.map { Date().timeIntervalSince($0) > 1.0 } ?? false
                let overdue = Date().timeIntervalSince(t0) > exposure + 6
                let listingDue = Date().timeIntervalSince(lastListing) > (afterStorageChange ? 1.5 : 4.0)
                if (afterStorageChange || overdue) && listingDue {
                    lastListing = Date()
                    if let now = cardHandlesSync() {
                        for h in now.subtracting(before).sorted() {
                            handles.append((h, false))
                            lastNew = Date()
                            log("Found unannounced photo on the card: object \(hex(h, width: 8))")
                        }
                    }
                }
            }
            if !handles.isEmpty && Date().timeIntervalSince(lastNew) > 0.8 { break }
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard !handles.isEmpty else {
            let summary = seenEvents.sorted { $0.key < $1.key }.map { "\(hex($0.key, width: 4))×\($0.value)" }.joined(separator: " ")
            log("No new photo within \(Int(waitLimit)) s (card listing \(handlesBefore == nil ? "unavailable" : "checked")). Camera events seen: \(summary.isEmpty ? "none" : summary). Destination \(propValues[EOSProp.captureDestination].map { hex($0) } ?? "?"), focus mode \(propValues[EOSProp.focusMode].map { hex($0) } ?? "?")")
            if let fm = propValues[EOSProp.focusMode], fm != 3 { throw CamError.autofocusNoRelease }
            throw CamError.noImageArrived
        }
        log(String(format: "Shutter-to-announce: %.2f s", Date().timeIntervalSince(t0)))

        var urls: [URL] = []
        for (h, needsComplete) in handles {
            var name = eventNames[h] ?? "IMG"
            var expected: UInt32 = eventSizes[h] ?? 0
            if let n = eventNames[h] { log("Object \(hex(h, width: 8)) from event: \(n), \(expected) bytes") }
            if let infoResp = try? ptp(PTPOp.getObjectInfo, [h]), infoResp.ok, let oi = PTPObjectInfo.parse(infoResp.data) {
                if !oi.filename.isEmpty { name = oi.filename }
                expected = oi.compressedSize
                log("Object \(hex(h, width: 8)): \(oi.filename), \(oi.compressedSize) bytes, \(oi.imageWidth)×\(oi.imageHeight)")
            }
            if saveTarget == .cardOnly {
                captureRecords.append(try cardOnlyRecord(h, name: name, expected: expected))
                continue
            }
            let td = Date()
            let obj = try ptp(PTPOp.getObject, [h], timeout: 120)
            guard obj.ok else { log("GetObject \(hex(h, width: 8)) → \(hex(obj.code))"); continue }
            if needsComplete || saveTarget == .macOnly { _ = try? ptp(PTPOp.eosTransferComplete, [h]) }
            // An incomplete transfer is never saved as a good photograph
            if expected > 0 && UInt32(obj.data.count) != expected {
                log("INCOMPLETE TRANSFER: received \(obj.data.count) bytes but camera said \(expected) — not saved")
                throw CamError.writeFailed("incomplete transfer of \(name)")
            }
            // The bytes decide the file type, never a guessed name
            let kind = detectImageKind(obj.data)
            if kind == "CR2", !cr2StructureComplete(obj.data) {
                log("CR2 STRUCTURE CHECK FAILED for \(name): RAW data runs past the end of the file — not saved")
                throw CamError.writeFailed("truncated CR2 \(name)")
            }
            name = ((name as NSString).deletingPathExtension) + "." + (kind ?? ((name as NSString).pathExtension.isEmpty ? "DAT" : (name as NSString).pathExtension))
            let url = try writeNoOverwrite(obj.data, originalName: name, frameNumber: frameNumber)
            if expected > 0 { lastObjectSizes[url.lastPathComponent] = UInt64(expected) }
            if kind == "JPG" { capturePreview = obj.data }
            if kind == "CR2", capturePreview == nil { capturePreview = extractCR2Preview(obj.data) }
            let dims = imageDimensions(url)
            captureRecords.append(CaptureFile(
                path: url.path, kind: kind ?? "UNKNOWN", cameraName: name,
                size: UInt64(obj.data.count), expectedSize: expected > 0 ? UInt64(expected) : nil,
                sizeMatches: expected > 0 && UInt32(obj.data.count) == expected,
                signatureOK: kind != nil, structureOK: kind == "CR2" ? true : nil,
                width: dims?.0, height: dims?.1, onCard: false))
            log(String(format: "Saved %@ (%.1f MB in %.2f s)", url.lastPathComponent,
                       Double(obj.data.count) / 1_048_576, Date().timeIntervalSince(td)))
            urls.append(url)
        }
        return urls
    }

    // MARK: Capture via ImageCaptureCore (fallback path, used before Canon mode is on)

    public func captureNative(completion: ((URL?) -> Void)? = nil) {
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
        // Helper captures go to the folder (and base name) the app asked for
        if let dest = activeDestination {
            try FileManager.default.createDirectory(at: dest.dir, withIntermediateDirectories: true)
            let base = dest.baseName ?? (originalName as NSString).deletingPathExtension
            for n in 0..<100_000 {
                let fileName = n == 0 ? "\(base).\(ext)" : "\(base)_\(n).\(ext)"
                let url = dest.dir.appendingPathComponent(fileName)
                if FileManager.default.fileExists(atPath: url.path) { continue }
                do {
                    try data.write(to: url, options: [.withoutOverwriting])
                    return url
                } catch CocoaError.fileWriteFileExists {
                    continue
                } catch {
                    throw CamError.writeFailed(error.localizedDescription)
                }
            }
            throw CamError.writeFailed("no free file name for \(base)")
        }
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

    func detectImageKind(_ d: Data) -> String? {
        let b = [UInt8](d.prefix(12))
        if b.count >= 10, b[0] == 0x49, b[1] == 0x49, b[2] == 0x2A, b[3] == 0, b[8] == 0x43, b[9] == 0x52 { return "CR2" }
        if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF { return "JPG" }
        return nil
    }

    /// Walks the CR2's TIFF IFDs; every image strip (JPEG previews, RAW sensor data) must lie inside the file.
    func cr2StructureComplete(_ d: Data) -> Bool {
        let data = Data(d)
        guard var ifd = le32(data, 4).map(Int.init) else { return false }
        var sawRaw = false
        for index in 0..<8 {
            guard ifd > 0, let count = le16(data, ifd) else { break }
            var offset: UInt32?, length: UInt32?
            for i in 0..<Int(count) {
                let e = ifd + 2 + i * 12
                guard let tag = le16(data, e) else { return false }
                if tag == 0x0111 { offset = le32(data, e + 8) }
                if tag == 0x0117 { length = le32(data, e + 8) }
            }
            if let o = offset, let l = length {
                if UInt64(o) + UInt64(l) > UInt64(data.count) { return false }
                if index == 3 { sawRaw = l > 1_000_000 }
            }
            guard let next = le32(data, ifd + 2 + Int(count) * 12) else { break }
            ifd = Int(next)
        }
        return sawRaw
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

    public func runStage1Test(completion: @escaping (URL) -> Void) {
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

            // 4b. RAW-only recording, set over USB
            let originalFormat = self.imageFormatValues
            note("Recording quality before test: \(describeImageFormat(originalFormat))")
            do {
                let ok = try self.setQualitySync(.rawOnly)
                check(ok, "Camera switched to RAW (CR2) only over USB", describeImageFormat(self.imageFormatValues))
            } catch {
                check(false, "Camera switched to RAW (CR2) only over USB", error.localizedDescription)
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
            for i in 1...5 {
                let t = Date()
                do {
                    let urls = try self.captureCanonSync()
                    captureTimes.append(Date().timeIntervalSince(t))
                    for u in urls {
                        let dims = self.imageDimensions(u)
                        let full = dims.map { $0.0 >= 5616 && $0.1 >= 3744 } ?? false
                        let isRaw = u.pathExtension.uppercased() == "CR2"
                        let rawOK = !isRaw || (self.isCR2Signature(u) && ((try? Data(contentsOf: u)).map(self.cr2StructureComplete) ?? false))
                        let expectedSize = self.lastObjectSizes[u.lastPathComponent]
                        let actualSize = ((try? FileManager.default.attributesOfItem(atPath: u.path))?[.size] as? NSNumber)?.uint64Value
                        let complete = expectedSize != nil && expectedSize == actualSize
                        check(full && rawOK && complete, "Capture \(i): full-resolution \(isRaw ? "CR2 RAW" : "JPEG") saved, complete and decoded",
                              self.imageSummary(u) + (expectedSize.map { ", camera size \($0) bytes \(complete ? "matches" : "MISMATCH")" } ?? ""))
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

// MARK: - API used by the StopMo camera helper

public struct CaptureFile: Codable {
    public let path: String
    public let kind: String
    public let cameraName: String
    public let size: UInt64
    public let expectedSize: UInt64?
    public let sizeMatches: Bool
    public let signatureOK: Bool
    public let structureOK: Bool?
    public let width: Int?
    public let height: Int?
    public let onCard: Bool?
}

public struct CaptureResult {
    public let files: [CaptureFile]
    public let preview: Data?
    public let seconds: Double
}

extension CameraController {
    public var modelName: String? { deviceInfo.map { "\($0.manufacturer.replacingOccurrences(of: " Inc.", with: "")) \($0.model)".trimmingCharacters(in: .whitespaces) } ?? camera?.name }
    public var firmware: String? { deviceInfo?.deviceVersion }
    public var currentQuality: RawQuality? {
        RawQuality.allCases.first { Array(imageFormatValues.prefix($0.values.count)) == $0.values && imageFormatValues.count >= $0.values.count }
    }
    public var liveViewFPS: Double { lvFPS }

    public func statusSnapshot() -> [String: Any] {
        var d: [String: Any] = [
            "connected": camera != nil,
            "ready": isReady,
            "liveView": isLiveViewOn,
            "fps": (lvFPS * 10).rounded() / 10,
        ]
        if let m = modelName { d["model"] = m }
        if let f = firmware { d["firmware"] = f }
        if !imageFormatValues.isEmpty { d["quality"] = describeImageFormat(imageFormatValues) }
        if let q = currentQuality { d["qualityId"] = q.rawValue }
        if let fm = propValues[EOSProp.focusMode] { d["focus"] = fm == 3 ? "MF" : "AF" }
        d["saveTarget"] = ["both", "mac", "card"][saveTarget.rawValue]
        var settings: [String: String] = [:]
        for k in [EOSProp.autoExposureMode, EOSProp.aperture, EOSProp.shutterSpeed, EOSProp.iso, EOSProp.expCompensation, EOSProp.whiteBalance] {
            if let v = propValues[k] { settings[EOSProp.name(k)] = hex(v) }
        }
        d["settingsRaw"] = settings
        // The exposure as the camera's own display writes it
        let exposure = [
            propValues[EOSProp.shutterSpeed].flatMap(EOSExposure.shutterLabel),
            propValues[EOSProp.aperture].flatMap(EOSExposure.apertureLabel),
            propValues[EOSProp.iso].flatMap(EOSExposure.isoLabel),
        ].compactMap { $0 }
        if !exposure.isEmpty { d["exposure"] = exposure.joined(separator: " · ") }
        d["bodyLocked"] = canonModeOn
        if let e = lastError.value { d["lastError"] = e }
        return d
    }

    /// Brings live view back when frames have stopped arriving: the body drops it around a capture or a
    /// mode change, and an <img> on the stream then sits on its last frame for good.
    public func restartLiveView(completion: ((Error?) -> Void)? = nil) {
        ptpQueue.async {
            do {
                try self.enableCanonModeSync()
                _ = try? self.setEOSPropSync(EOSProp.evfOutputDevice, 1)
                Thread.sleep(forTimeInterval: 0.2)
                try self.startLiveViewSync()
                self.scheduleLiveViewTickPublic()
                self.log("Live view restarted: no frames were arriving")
                DispatchQueue.main.async { completion?(nil) }
            } catch {
                self.lastError.value = error.localizedDescription
                self.log("Live view could not be restarted: \(error.localizedDescription)")
                DispatchQueue.main.async { completion?(error) }
            }
        }
    }

    /// Opens remote mode and live view (idempotent).
    public func prepareForShooting(completion: @escaping (Error?) -> Void) {
        ptpQueue.async {
            do {
                try self.enableCanonModeSync()
                if !self.isLiveViewOn {
                    try self.startLiveViewSync()
                }
                self.scheduleLiveViewTickPublic()
                DispatchQueue.main.async { completion(nil) }
            } catch {
                self.lastError.value = error.localizedDescription
                DispatchQueue.main.async { completion(error) }
            }
        }
    }

    public func setQualityAsync(_ q: RawQuality, completion: @escaping (Error?) -> Void) {
        ptpQueue.async {
            do {
                let ok = try self.setQualitySync(q)
                DispatchQueue.main.async { completion(ok ? nil : CamError.refused("Image quality change (not confirmed)", 0)) }
            } catch {
                DispatchQueue.main.async { completion(error) }
            }
        }
    }

    /// Fires the shutter and saves every file the camera sends into `dir` (base name optional),
    /// verified and never overwriting. Live view resumes afterwards if it was on.
    public func capture(into dir: URL, baseName: String?, target: SaveTarget? = nil, completion: @escaping (Result<CaptureResult, Error>) -> Void) {
        ptpQueue.async {
            let t0 = Date()
            if let target { self.saveTarget = target }
            self.activeDestination = (dir, baseName)
            self.capturing.value = true
            defer { self.activeDestination = nil; self.capturing.value = false; self.lastActivity = Date() }
            do {
                _ = try self.captureCanonSync()
                let result = CaptureResult(files: self.captureRecords, preview: self.capturePreview, seconds: Date().timeIntervalSince(t0))
                for f in result.files {
                    self.log("Captured \(f.kind) \(f.path) \(f.size) bytes (camera said \(f.expectedSize.map(String.init) ?? "?"))")
                }
                self.lastError.value = nil
                DispatchQueue.main.async { completion(.success(result)) }
            } catch {
                self.lastError.value = error.localizedDescription
                self.log("Capture failed: \(error.localizedDescription)")
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    /// Canon bodies power off when nobody talks to them; poll events now and then while idle.
    public func startKeepAlive(every seconds: TimeInterval = 15) {
        Timer.scheduledTimer(withTimeInterval: seconds, repeats: true) { [weak self] _ in
            guard let self, self.isReady, !self.isLiveViewOn else { return }
            self.ptpQueue.async { _ = try? self.pollEventsSync() }
        }
    }

    fileprivate func scheduleLiveViewTickPublic() { scheduleLiveViewTickInternal() }
}

// MARK: - Card-only captures

extension CameraController {
    /// True when the camera reports manual focus (lens switch on MF); unknown counts as AF.
    var lensIsManualFocus: Bool { propValues[EOSProp.focusMode] == 3 }

    func readPartial(_ h: UInt32, offset: UInt32, length: UInt32) throws -> Data {
        let r = try ptp(PTPOp.getPartialObject, [h, offset, length], timeout: 60)
        guard r.ok else { throw CamError.refused("Partial read of \(hex(h, width: 8))", r.code) }
        return r.data
    }

    /// Leaves the original on the card, checks its header, and fetches only what the timeline needs to show.
    func cardOnlyRecord(_ h: UInt32, name: String, expected: UInt32) throws -> CaptureFile {
        let ext = (name as NSString).pathExtension.uppercased()
        var kind: String?
        var structureOK: Bool?
        var width: Int?, height: Int?

        if deviceInfo?.supports(PTPOp.getPartialObject) == true {
            let headLen: UInt32 = expected > 0 ? min(expected, 262_144) : 262_144
            let head = try readPartial(h, offset: 0, length: headLen)
            kind = detectImageKind(head)
            if kind == "CR2" {
                let layout = cr2Layout(head, fileSize: UInt64(expected))
                structureOK = layout.complete
                if let (o, l) = layout.preview {
                    let jpeg = try readPartial(h, offset: o, length: l)
                    if jpeg.count == Int(l), jpeg.count > 2, jpeg[jpeg.startIndex] == 0xFF, jpeg[jpeg.startIndex + 1] == 0xD8 {
                        if capturePreview == nil { capturePreview = jpeg }
                        if let size = jpegPixelSize(jpeg) { width = Int(size.width); height = Int(size.height) }
                    }
                }
            } else if kind == "JPG", capturePreview == nil {
                // JPEG-only shooting: the camera JPEG itself is the timeline picture, shown but not stored here
                let full = try ptp(PTPOp.getObject, [h], timeout: 120)
                if full.ok, expected == 0 || full.data.count == Int(expected) {
                    capturePreview = full.data
                    if let size = jpegPixelSize(full.data) { width = Int(size.width); height = Int(size.height) }
                }
            }
        }
        if capturePreview == nil, let thumb = try? ptp(PTPOp.getThumb, [h]), thumb.ok, thumb.data.count > 2 {
            capturePreview = thumb.data
            log("Only the small card thumbnail was available for \(name)")
        }
        log("Kept on card: \(name), \(expected) bytes, signature \(kind ?? "?"), structure \(structureOK.map { $0 ? "OK" : "BAD" } ?? "–")")
        return CaptureFile(
            path: "card:/\(name)", kind: kind ?? ext, cameraName: name,
            size: UInt64(expected), expectedSize: expected > 0 ? UInt64(expected) : nil,
            sizeMatches: false, signatureOK: kind != nil, structureOK: structureOK,
            width: width, height: height, onCard: true)
    }
}

/// Reads CR2 IFDs from the first bytes of a file: every strip must fit in `fileSize`; IFD0's strip is the full-size JPEG preview.
func cr2Layout(_ head: Data, fileSize: UInt64) -> (complete: Bool, preview: (UInt32, UInt32)?) {
    let data = Data(head)
    guard data.count > 16, var ifd = le32(data, 4).map(Int.init) else { return (false, nil) }
    var preview: (UInt32, UInt32)?
    var sawRaw = false
    for index in 0..<8 {
        guard ifd > 0, let count = le16(data, ifd) else { break }
        var offset: UInt32?, length: UInt32?
        for i in 0..<Int(count) {
            let e = ifd + 2 + i * 12
            guard let tag = le16(data, e) else { return (false, preview) }
            if tag == 0x0111 { offset = le32(data, e + 8) }
            if tag == 0x0117 { length = le32(data, e + 8) }
        }
        if let o = offset, let l = length {
            if fileSize > 0, UInt64(o) + UInt64(l) > fileSize { return (false, preview) }
            if index == 0 { preview = (o, l) }
            if index == 3 { sawRaw = l > 1_000_000 }
        }
        guard let next = le32(data, ifd + 2 + Int(count) * 12) else { break }
        ifd = Int(next)
    }
    return (sawRaw, preview)
}

/// CR2 files are TIFF containers whose first IFD holds a full-size JPEG preview.
public func extractCR2Preview(_ d: Data) -> Data? {
    let data = Data(d)
    guard data.count > 16, data.prefix(4) == Data([0x49, 0x49, 0x2A, 0x00]),
          let ifd0 = le32(data, 4).map(Int.init), let count = le16(data, ifd0) else { return nil }
    var offset: UInt32?, length: UInt32?
    for i in 0..<Int(count) {
        let e = ifd0 + 2 + i * 12
        if le16(data, e) == 0x0111 { offset = le32(data, e + 8) }
        if le16(data, e) == 0x0117 { length = le32(data, e + 8) }
    }
    guard let o = offset.map(Int.init), let l = length.map(Int.init), o + l <= data.count, l > 2 else { return nil }
    let jpeg = data.subdata(in: o..<(o + l))
    return jpeg[0] == 0xFF && jpeg[1] == 0xD8 ? jpeg : nil
}

func jpegPixelSize(_ jpeg: Data) -> CGSize? {
    guard let src = CGImageSourceCreateWithData(jpeg as CFData, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
          let w = props[kCGImagePropertyPixelWidth] as? Int, let h = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
    return CGSize(width: w, height: h)
}

extension CameraController: ICDeviceBrowserDelegate {
    public func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        log("Device appeared: \(device.name ?? "?") USB \(hex(device.usbVendorID)):\(hex(device.usbProductID)) transport \(device.transportType ?? "?")")
        guard let cam = device as? ICCameraDevice else { return }
        hotplugEvents.append("\(Date()): connect \(cam.name ?? "?")")
        if camera == nil { connect(cam) }
    }

    public func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        if device === camera { handleDisconnect(reason: "camera unplugged or switched off") }
    }
}

extension CameraController: ICCameraDeviceDelegate {
    public func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
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

    public func deviceDidBecomeReady(withCompleteContentCatalog device: ICCameraDevice) {
        markReady(device)
    }

    public func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        sessionOpen.value = false
        log("Session closed\(error.map { ": \($0.localizedDescription)" } ?? "")")
    }

    public func didRemove(_ device: ICDevice) {
        if device === camera { handleDisconnect(reason: "device removed") }
    }

    public func device(_ device: ICDevice, didEncounterError error: Error?) {
        log("Camera error: \(error?.localizedDescription ?? "unknown")")
    }

    public func cameraDevice(_ camera: ICCameraDevice, didAdd items: [ICCameraItem]) {
        if watchCardAdditions.value {
            var added = cardAdditions.value
            for case let f as ICCameraFile in items where f.ptpObjectHandle != 0 {
                added.append((f.ptpObjectHandle, f.name ?? "IMG", UInt32(clamping: f.fileSize)))
            }
            cardAdditions.value = added
        }
        guard nativePending else { return }
        for case let f as ICCameraFile in items {
            nativePending = false
            downloadNative(f)
            break
        }
    }

    public func cameraDevice(_ camera: ICCameraDevice, didRemove items: [ICCameraItem]) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceiveThumbnail thumbnail: CGImage?, for item: ICCameraItem, error: Error?) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceiveMetadata metadata: [AnyHashable: Any]?, for item: ICCameraItem, error: Error?) {}
    public func cameraDevice(_ camera: ICCameraDevice, didRenameItems items: [ICCameraItem]) {}
    public func cameraDeviceDidChangeCapability(_ camera: ICCameraDevice) {}
    public func cameraDevice(_ camera: ICCameraDevice, didReceivePTPEvent eventData: Data) {}
    public func cameraDeviceDidRemoveAccessRestriction(_ device: ICDevice) {
        log("Camera access restriction removed")
    }
    public func cameraDeviceDidEnableAccessRestriction(_ device: ICDevice) {
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

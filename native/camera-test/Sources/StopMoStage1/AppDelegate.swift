import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let cam = CameraController()

    private let liveView = NSImageView()
    private let statusDot = NSView()
    private let statusLabel = NSTextField(wrappingLabelWithString: "Starting…")
    private let fpsLabel = NSTextField(labelWithString: "")
    private let lastCaptureView = NSImageView()
    private let lastCaptureLabel = NSTextField(wrappingLabelWithString: "No frames captured yet")
    private let spinner = NSProgressIndicator()
    private var logView: NSTextView!
    private var liveButton: NSButton!
    private var captureButton: NSButton!
    private var targetPopup: NSPopUpButton!
    private var qualityPopup: NSPopUpButton!
    private var keyMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMenu()
        buildWindow()
        wireCamera()
        cam.start()
        NSApp.activate(ignoringOtherApps: true)

        // Space bar = capture (when the log isn't focused)
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            guard let self else { return e }
            if e.keyCode == 49, self.window.firstResponder !== self.logView {
                self.capture(nil)
                return nil
            }
            return e
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        cam.shutdown()
    }

    // MARK: UI

    private func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About StopMo Stage 1", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit StopMo Stage 1", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let camItem = NSMenuItem()
        main.addItem(camItem)
        let camMenu = NSMenu(title: "Camera")
        camMenu.addItem(withTitle: "Capture Frame", action: #selector(capture(_:)), keyEquivalent: "\r").target = self
        camMenu.addItem(withTitle: "Toggle Live View", action: #selector(toggleLive(_:)), keyEquivalent: "l").target = self
        camMenu.addItem(withTitle: "Reconnect", action: #selector(reconnect(_:)), keyEquivalent: "r").target = self
        camMenu.addItem(withTitle: "Run Stage 1 Test", action: #selector(runTest(_:)), keyEquivalent: "t").target = self
        camItem.submenu = camMenu
        NSApp.mainMenu = main
    }

    private func button(_ title: String, _ action: Selector) -> NSButton {
        let b = NSButton(title: title, target: self, action: action)
        b.bezelStyle = .rounded
        b.controlSize = .large
        return b
    }

    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1400, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "StopMo — Stage 1 Camera Test"
        window.minSize = NSSize(width: 1000, height: 640)
        window.center()
        window.collectionBehavior.insert(.fullScreenPrimary)

        // Live view
        liveView.imageScaling = .scaleProportionallyUpOrDown
        liveView.wantsLayer = true
        liveView.layer?.backgroundColor = NSColor.black.cgColor
        liveView.translatesAutoresizingMaskIntoConstraints = false
        liveView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        liveView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        // Status row
        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 6
        statusDot.layer?.backgroundColor = NSColor.systemRed.cgColor
        statusDot.translatesAutoresizingMaskIntoConstraints = false
        statusDot.widthAnchor.constraint(equalToConstant: 12).isActive = true
        statusDot.heightAnchor.constraint(equalToConstant: 12).isActive = true
        statusLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        let statusRow = NSStackView(views: [statusDot, statusLabel, spinner])
        statusRow.alignment = .centerY
        statusRow.spacing = 8

        fpsLabel.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        fpsLabel.textColor = .secondaryLabelColor

        // Controls
        captureButton = button("TEST SHUTTER  (Space)", #selector(capture(_:)))
        captureButton.bezelColor = .systemRed
        liveButton = button("Start Live View", #selector(toggleLive(_:)))
        let nativeButton = button("Capture via macOS (fallback)", #selector(captureNative(_:)))
        let reconnectButton = button("Reconnect", #selector(reconnect(_:)))
        let testButton = button("Run Stage 1 Test", #selector(runTest(_:)))
        let folderButton = button("Show Captures Folder", #selector(openFolder(_:)))

        qualityPopup = NSPopUpButton(frame: .zero, pullsDown: false)
        qualityPopup.addItems(withTitles: ["Quality: RAW (CR2) only", "Quality: RAW + Large Fine JPEG", "Quality: Large Fine JPEG only"])
        qualityPopup.target = self
        qualityPopup.action = #selector(qualityChanged(_:))
        qualityPopup.translatesAutoresizingMaskIntoConstraints = false

        targetPopup = NSPopUpButton(frame: .zero, pullsDown: false)
        targetPopup.addItems(withTitles: ["Save to camera card + Mac", "Save to Mac only (no card writes)"])
        targetPopup.target = self
        targetPopup.action = #selector(targetChanged(_:))

        for b in [captureButton!, liveButton!, nativeButton, reconnectButton, testButton, folderButton] {
            b.translatesAutoresizingMaskIntoConstraints = false
        }

        // Last capture
        lastCaptureView.imageScaling = .scaleProportionallyUpOrDown
        lastCaptureView.wantsLayer = true
        lastCaptureView.layer?.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
        lastCaptureView.translatesAutoresizingMaskIntoConstraints = false
        lastCaptureView.heightAnchor.constraint(equalToConstant: 170).isActive = true
        lastCaptureLabel.font = .systemFont(ofSize: 11)
        lastCaptureLabel.textColor = .secondaryLabelColor

        // Log
        let scroll = NSTextView.scrollableTextView()
        logView = (scroll.documentView as! NSTextView)
        logView.isEditable = false
        logView.backgroundColor = NSColor(white: 0.06, alpha: 1)
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        let side = NSStackView(views: [statusRow, fpsLabel, captureButton, liveButton, qualityPopup, targetPopup,
                                       nativeButton, testButton, reconnectButton, folderButton,
                                       lastCaptureView, lastCaptureLabel, scroll])
        side.orientation = .vertical
        side.alignment = .leading
        side.spacing = 10
        side.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        side.translatesAutoresizingMaskIntoConstraints = false
        for v in [captureButton!, liveButton!, qualityPopup!, targetPopup!, nativeButton, testButton, reconnectButton,
                  folderButton, lastCaptureView, scroll] as [NSView] {
            v.widthAnchor.constraint(equalTo: side.widthAnchor, constant: -28).isActive = true
        }
        captureButton.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let content = NSView()
        content.addSubview(liveView)
        content.addSubview(side)
        NSLayoutConstraint.activate([
            liveView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            liveView.topAnchor.constraint(equalTo: content.topAnchor),
            liveView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            liveView.trailingAnchor.constraint(equalTo: side.leadingAnchor),
            side.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            side.topAnchor.constraint(equalTo: content.topAnchor),
            side.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            side.widthAnchor.constraint(equalToConstant: 360),
        ])
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
    }

    private func wireCamera() {
        cam.onLog = { [weak self] line in
            guard let tv = self?.logView else { return }
            let attrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
                .foregroundColor: line.contains("FAIL") || line.contains("failed") || line.contains("error")
                    ? NSColor.systemOrange : NSColor.textColor,
            ]
            tv.textStorage?.append(NSAttributedString(string: line + "\n", attributes: attrs))
            tv.scrollToEndOfDocument(nil)
        }
        cam.onStatus = { [weak self] text, connected in
            self?.statusLabel.stringValue = text
            self?.statusDot.layer?.backgroundColor = (connected ? NSColor.systemGreen : NSColor.systemRed).cgColor
            if !connected {
                self?.liveButton.title = "Start Live View"
                self?.fpsLabel.stringValue = ""
            }
        }
        cam.onLiveFrame = { [weak self] img, fps, size in
            self?.liveView.image = img
            self?.fpsLabel.stringValue = String(format: "Live view %d×%d  %.1f fps", Int(size.width), Int(size.height), fps)
        }
        cam.onCaptured = { [weak self] url, summary in
            self?.lastCaptureView.image = NSImage(contentsOf: url)
            self?.lastCaptureLabel.stringValue = "Last frame: \(summary)"
        }
        cam.onBusy = { [weak self] b in
            if b { self?.spinner.startAnimation(nil) } else { self?.spinner.stopAnimation(nil) }
        }
    }

    // MARK: Actions

    @objc func capture(_ sender: Any?) {
        guard cam.isReady else { NSSound.beep(); return }
        cam.captureCanon()
    }

    @objc func captureNative(_ sender: Any?) {
        cam.captureNative()
    }

    @objc func toggleLive(_ sender: Any?) {
        guard cam.isReady else { NSSound.beep(); return }
        if cam.isLiveViewOn {
            cam.stopLiveView()
            liveButton.title = "Start Live View"
            fpsLabel.stringValue = ""
        } else {
            cam.startLiveView()
            liveButton.title = "Stop Live View"
        }
    }

    @objc func reconnect(_ sender: Any?) { cam.reconnect() }

    @objc func qualityChanged(_ sender: NSPopUpButton) {
        guard cam.isReady, let q = RawQuality(rawValue: sender.indexOfSelectedItem) else { NSSound.beep(); return }
        cam.setQuality(q)
    }

    @objc func targetChanged(_ sender: NSPopUpButton) {
        cam.saveTarget = SaveTarget(rawValue: sender.indexOfSelectedItem) ?? .cardAndMac
        cam.log("Save target: \(sender.titleOfSelectedItem ?? "")")
    }

    @objc func runTest(_ sender: Any?) {
        cam.log("=== Stage 1 test started ===")
        cam.runStage1Test { [weak self] report in
            self?.liveButton.title = (self?.cam.isLiveViewOn ?? false) ? "Stop Live View" : "Start Live View"
            NSWorkspace.shared.open(report)
        }
    }

    @objc func openFolder(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting([cam.captureDir])
    }
}

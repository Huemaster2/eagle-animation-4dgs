// swift-tools-version:5.9
// Stage 1 camera test for the stop-motion app.
// Builds with Xcode 15+ or the Xcode Command Line Tools on macOS 13+.
import PackageDescription

let package = Package(
    name: "StopMoStage1",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "StopMoStage1",
            path: "Sources/StopMoStage1",
            linkerSettings: [
                .linkedFramework("ImageCaptureCore"),
                .linkedFramework("AppKit"),
                .linkedFramework("ImageIO"),
            ]
        )
    ]
)

// swift-tools-version:5.9
// StopMo camera engine for the Canon EOS 5D Mark II (ImageCaptureCore + Canon EOS PTP).
//  - StopMoCamera: shared library (no UI)
//  - StopMoStage1: standalone camera test app
//  - stopmo-camera-helper: headless helper bundled inside the StopMo app
import PackageDescription

let package = Package(
    name: "StopMoCamera",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "StopMoStage1", targets: ["StopMoStage1"]),
        .executable(name: "stopmo-camera-helper", targets: ["StopMoCameraHelper"]),
    ],
    targets: [
        .target(
            name: "StopMoCamera",
            path: "Sources/StopMoCamera",
            linkerSettings: [.linkedFramework("ImageCaptureCore"), .linkedFramework("ImageIO")]
        ),
        .executableTarget(
            name: "StopMoStage1",
            dependencies: ["StopMoCamera"],
            path: "Sources/StopMoStage1",
            linkerSettings: [.linkedFramework("AppKit")]
        ),
        .executableTarget(
            name: "StopMoCameraHelper",
            dependencies: ["StopMoCamera"],
            path: "Sources/StopMoCameraHelper",
            linkerSettings: [.linkedFramework("Network")]
        ),
    ]
)

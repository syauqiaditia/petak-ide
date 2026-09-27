// swift-tools-version:5.5
import PackageDescription
let package = Package(
    name: "FixtureSwift",
    targets: [
        .executableTarget(name: "x", path: "Sources/x")
    ]
)

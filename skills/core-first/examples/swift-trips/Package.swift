// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Trips",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "TripCore", targets: ["TripCore"]),
        .executable(name: "trip", targets: ["TripCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.0.0"),
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.5.0"),
    ],
    targets: [
        .target(name: "TripCore", dependencies: [.product(name: "GRDB", package: "GRDB.swift")]),
        .executableTarget(name: "TripCLI", dependencies: [
            "TripCore",
            .product(name: "ArgumentParser", package: "swift-argument-parser"),
        ]),
        // The app shell. In a real project this is the Xcode app target;
        // here it is a library so the recipe compiles with swift build.
        .target(name: "TripUI", dependencies: ["TripCore"]),
        .testTarget(name: "TripCoreTests", dependencies: ["TripCore"]),
    ]
)

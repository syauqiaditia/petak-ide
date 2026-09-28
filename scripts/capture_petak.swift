import Cocoa
import CoreGraphics
import Foundation

let args = CommandLine.arguments
let outputPath = args.count > 1 ? args[1] : ""

let windowList = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
var found = false
for w in windowList {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    let name = w[kCGWindowName as String] as? String ?? ""
    let wid = w[kCGWindowNumber as String] as? Int ?? 0
    let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    if owner.lowercased().contains("petak") || name.lowercased().contains("petak") {
        print("Found Petak window: ID=\(wid) owner=\(owner) name=\(name) bounds=\(bounds)")
        found = true
        if !outputPath.isEmpty {
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            task.arguments = ["-l\(wid)", outputPath]
            do {
                try task.run()
                task.waitUntilExit()
                print("Captured Petak window \(wid) to: \(outputPath)")
            } catch {
                print("Failed to run screencapture: \(error)")
            }
        }
        break
    }
}

if !found {
    print("No Petak window found. Total windows: \(windowList.count)")
    for w in windowList.prefix(10) {
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        let wid = w[kCGWindowNumber as String] as? Int ?? 0
        let name = w[kCGWindowName as String] as? String ?? ""
        print("Window: ID=\(wid) owner=\(owner) name=\(name)")
    }
}

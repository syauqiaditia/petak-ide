import Cocoa
import CoreGraphics

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

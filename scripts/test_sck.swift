import Foundation
import AppKit
import ScreenCaptureKit

_ = NSApplication.shared

class DummyOutput: NSObject, SCStreamOutput {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        print("GOT_FRAME")
    }
}

var finished = false
let output = DummyOutput()
var streamObj: SCStream?

SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { content, err in
    guard let win = content?.windows.first(where: { w in
        (w.owningApplication?.applicationName ?? "").contains("Simulator")
    }) else {
        print("NO_SIM_WIN")
        finished = true
        return
    }
    print("FOUND_SIM_WIN: \(win.title ?? "")")
    let filter = SCContentFilter(desktopIndependentWindow: win)
    let conf = SCStreamConfiguration()
    conf.width = Int(win.frame.width)
    conf.height = Int(win.frame.height)
    conf.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    conf.capturesAudio = false
    
    do {
        let stream = SCStream(filter: filter, configuration: conf, delegate: nil)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "sck.queue"))
        streamObj = stream
        print("CALLING_START_CAPTURE")
        stream.startCapture { err in
            print("START_CAPTURE_CB: err=\(String(describing: err))")
            finished = true
        }
    } catch {
        print("STREAM_INIT_ERROR: \(error)")
        finished = true
    }
}

let timeout = Date(timeIntervalSinceNow: 5.0)
while !finished && RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1)) {
    if Date() > timeout { break }
}
print("DONE_LOOP finished=\(finished)")

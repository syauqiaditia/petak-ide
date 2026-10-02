#!/usr/bin/env swift
//
// petak_ios_capture.swift
// Petak Fase 4.5: Native macOS Screen Capture & H.264 Encoder for iOS Devices
//
// Supported Modes:
//   1. --mode simulator:
//      - Captures Simulator window via ScreenCaptureKit (macOS 12.3+, hardware accelerated, 60fps)
//      - Falls back automatically to `xcrun simctl io <udid> screenshot` polling (slow fallback)
//        if Screen Recording permission is not granted or window is not found.
//   2. --mode physical:
//      - Captures tethered iPhone screen via CoreMediaIO + AVFoundation (unlock + trust required)
//      - View-only mode (marked in status events)
//   3. --mode fallback:
//      - Direct polling of `simctl io <udid> screenshot` (low fps, e.g. 5-10 fps)
//
// Binary Output Contract (stdout):
//   For each frame packet:
//     [u32 packet_length (big-endian)]
//     [u8  kind: 0=config(SPS/PPS Annex-B), 1=keyframe, 2=delta]
//     [u64 pts_us (big-endian microsecond timestamp)]
//     [payload Annex-B bytes: 00 00 00 01 ...]
//
// Status / Diagnostics Output (stderr):
//   JSON objects per line: {"status":"live"|"fallback"|"disconnected"|"error", ...}
//
// Ponytail Discipline:
//   100% native macOS frameworks (ScreenCaptureKit, AVFoundation, CoreMediaIO, VideoToolbox, CoreMedia).
//   0 third-party dependencies.
//

import Foundation
import AppKit
import CoreMedia
import VideoToolbox
import CoreGraphics
#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(CoreMediaIO)
import CoreMediaIO
#endif

// MARK: - CLI Arguments

struct CaptureConfig {
    var mode: String = "simulator" // "simulator" | "physical" | "fallback"
    var udid: String = ""
    var deviceName: String = ""
    var width: Int = 1179
    var height: Int = 2556
    var fps: Int = 60
}

func parseArguments() -> CaptureConfig {
    var config = CaptureConfig()
    let args = CommandLine.arguments
    var i = 1
    while i < args.count {
        switch args[i] {
        case "--mode":
            if i + 1 < args.count { config.mode = args[i + 1]; i += 1 }
        case "--udid":
            if i + 1 < args.count { config.udid = args[i + 1]; i += 1 }
        case "--name":
            if i + 1 < args.count { config.deviceName = args[i + 1]; i += 1 }
        case "--width":
            if i + 1 < args.count { config.width = Int(args[i + 1]) ?? config.width; i += 1 }
        case "--height":
            if i + 1 < args.count { config.height = Int(args[i + 1]) ?? config.height; i += 1 }
        case "--fps":
            if i + 1 < args.count { config.fps = Int(args[i + 1]) ?? config.fps; i += 1 }
        default:
            break
        }
        i += 1
    }
    return config
}

func emitStatus(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(Data((str + "\n").utf8))
        fflush(stderr)
    }
}

func logStderr(_ msg: String) {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    fflush(stderr)
}

// MARK: - Binary Frame Packet Emitter

class FrameEmitter {
    static let shared = FrameEmitter()
    private let stdoutHandle = FileHandle.standardOutput
    private let writeLock = NSLock()
    private var lastSpsPps: Data?

    /// Emit packet matching contract:
    /// [u32 packet_len][u8 kind][u64 pts_us][payload Annex-B bytes]
    func emit(kind: UInt8, ptsUs: UInt64, payload: Data) {
        writeLock.lock()
        defer { writeLock.unlock() }

        let packetLen = UInt32(1 + 8 + payload.count)
        var header = Data()
        var beLen = packetLen.bigEndian
        header.append(Data(bytes: &beLen, count: 4))
        header.append(kind)
        var bePts = ptsUs.bigEndian
        header.append(Data(bytes: &bePts, count: 8))
        header.append(payload)

        stdoutHandle.write(header)
    }

    func emitConfig(spsPps: Data) {
        if lastSpsPps == spsPps { return }
        lastSpsPps = spsPps
        emit(kind: 0, ptsUs: 0, payload: spsPps)
    }
}

// MARK: - VideoToolbox H.264 Encoder

class H264Encoder {
    private var session: VTCompressionSession?
    private let width: Int32
    private let height: Int32
    private let fps: Int32
    private var isConfigSent = false
    private let startTime = CFAbsoluteTimeGetCurrent()

    init?(width: Int, height: Int, fps: Int) {
        self.width = Int32(width)
        self.height = Int32(height)
        self.fps = Int32(fps)

        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            width: self.width,
            height: self.height,
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: { (outputCallbackRefCon, _, status, flags, sampleBuffer) in
                guard status == noErr, let sampleBuffer = sampleBuffer, let refCon = outputCallbackRefCon else {
                    return
                }
                let encoder = Unmanaged<H264Encoder>.fromOpaque(refCon).takeUnretainedValue()
                encoder.handleCompressedSampleBuffer(sampleBuffer, flags: flags)
            },
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &self.session
        )

        guard status == noErr, let session = self.session else {
            return nil
        }

        // Low latency, realtime, baseline profile for WebCodecs compatibility
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Baseline_AutoLevel)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: NSNumber(value: fps * 2))
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: 4_000_000))
        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    func encode(pixelBuffer: CVPixelBuffer, presentationTime: CMTime) {
        guard let session = self.session else { return }
        let duration = CMTime(value: 1, timescale: self.fps)
        VTCompressionSessionEncodeFrame(
            session,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: duration,
            frameProperties: nil,
            sourceFrameRefcon: nil,
            infoFlagsOut: nil
        )
    }

    private func handleCompressedSampleBuffer(_ sampleBuffer: CMSampleBuffer, flags: VTEncodeInfoFlags) {
        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }

        // Extract SPS / PPS if not yet sent or format updated
        if !isConfigSent {
            var spsCount: Int = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(formatDesc, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &spsCount, nalUnitHeaderLengthOut: nil)

            var configData = Data()
            let naluPrefix = Data([0x00, 0x00, 0x00, 0x01])

            for i in 0..<spsCount {
                var ptr: UnsafePointer<UInt8>?
                var size: Int = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(formatDesc, parameterSetIndex: i, parameterSetPointerOut: &ptr, parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr,
                   let paramPtr = ptr {
                    configData.append(naluPrefix)
                    configData.append(paramPtr, count: size)
                }
            }

            if !configData.isEmpty {
                FrameEmitter.shared.emitConfig(spsPps: configData)
                isConfigSent = true
            }
        }

        // Determine if keyframe
        let isKeyFrame: Bool
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
           let first = attachments.first {
            let notSync = (first[kCMSampleAttachmentKey_NotSync] as? Bool) ?? false
            isKeyFrame = !notSync
        } else {
            isKeyFrame = false
        }

        // Extract NALUs from AVCC block buffer and convert length prefixes to Annex-B (0x00 00 00 01)
        guard let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)

        guard let rawPtr = dataPointer else { return }

        var bufferOffset = 0
        let naluPrefix = Data([0x00, 0x00, 0x00, 0x01])
        var annexBData = Data()

        while bufferOffset < length - 4 {
            var naluLen: UInt32 = 0
            memcpy(&naluLen, rawPtr + bufferOffset, 4)
            naluLen = CFSwapInt32BigToHost(naluLen)
            bufferOffset += 4

            if bufferOffset + Int(naluLen) <= length {
                annexBData.append(naluPrefix)
                annexBData.append(UnsafeRawPointer(rawPtr + bufferOffset).assumingMemoryBound(to: UInt8.self), count: Int(naluLen))
                bufferOffset += Int(naluLen)
            } else {
                break
            }
        }

        if !annexBData.isEmpty {
            let ptsSec = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
            let ptsUs = UInt64(max(0, ptsSec) * 1_000_000)
            let kind: UInt8 = isKeyFrame ? 1 : 2
            FrameEmitter.shared.emit(kind: kind, ptsUs: ptsUs, payload: annexBData)
        }
    }

    deinit {
        if let session = self.session {
            VTCompressionSessionInvalidate(session)
        }
    }
}

// MARK: - 1. iOS Simulator Capture (ScreenCaptureKit)

#if canImport(ScreenCaptureKit)
@available(macOS 12.3, *)
class SimulatorCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var encoder: H264Encoder?
    private let config: CaptureConfig
    private var running = false

    init(config: CaptureConfig) {
        self.config = config
        super.init()
    }

    func start() {
        SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self = self else { return }
            if let error = error {
                emitStatus([
                    "status": "fallback",
                    "reason": "ScreenCaptureKit error: \(error.localizedDescription)",
                    "message": "Screen recording permission not granted or window access restricted; starting simctl screenshot polling fallback"
                ])
                startSimctlScreenshotFallback(config: self.config)
                return
            }

            guard let content = content else {
                emitStatus([
                    "status": "fallback",
                    "reason": "No shareable content available",
                    "message": "Starting simctl screenshot polling fallback"
                ])
                startSimctlScreenshotFallback(config: self.config)
                return
            }

            // Find Simulator window
            let simWindow = content.windows.first { window in
                let owner = window.owningApplication?.applicationName ?? ""
                let title = window.title ?? ""
                return owner == "Simulator" || owner.contains("Simulator") || title.contains("iPhone") || title.contains("iPad")
            }

            guard let window = simWindow else {
                emitStatus([
                    "status": "fallback",
                    "reason": "Simulator window not found on screen",
                    "message": "Simulator window is minimized or not launched. Starting simctl screenshot polling fallback"
                ])
                startSimctlScreenshotFallback(config: self.config)
                return
            }

            let width = Int(window.frame.width)
            let height = Int(window.frame.height)

            guard let enc = H264Encoder(width: width, height: height, fps: self.config.fps) else {
                emitStatus(["status": "error", "message": "Failed to create H264 encoder"])
                exit(1)
            }
            self.encoder = enc

            let filter = SCContentFilter(desktopIndependentWindow: window)
            let streamConfig = SCStreamConfiguration()
            streamConfig.width = width
            streamConfig.height = height
            streamConfig.minimumFrameInterval = CMTime(value: 1, timescale: Int32(self.config.fps))
            streamConfig.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            streamConfig.capturesAudio = false

            do {
                let stream = SCStream(filter: filter, configuration: streamConfig, delegate: self)
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "petak.sck.output", qos: .userInteractive))
                self.stream = stream

                stream.startCapture { err in
                    if let err = err {
                        emitStatus([
                            "status": "fallback",
                            "reason": "SCStream startCapture error: \(err.localizedDescription)",
                            "message": "Switching to simctl screenshot fallback"
                        ])
                        startSimctlScreenshotFallback(config: self.config)
                    } else {
                        self.running = true
                        emitStatus([
                            "status": "live",
                            "width": width,
                            "height": height,
                            "fps": self.config.fps,
                            "captureBackend": "ScreenCaptureKit",
                            "isFallback": false,
                            "viewOnly": false
                        ])
                    }
                }
            } catch {
                emitStatus([
                    "status": "fallback",
                    "reason": "Failed to initialize SCStream: \(error.localizedDescription)",
                    "message": "Switching to simctl screenshot fallback"
                ])
                startSimctlScreenshotFallback(config: self.config)
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        encoder?.encode(pixelBuffer: imageBuffer, presentationTime: pts)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        emitStatus(["status": "disconnected", "reason": "ScreenCaptureKit stream stopped: \(error.localizedDescription)"])
        exit(0)
    }

    func stop() {
        stream?.stopCapture(completionHandler: nil)
        running = false
    }
}
#endif

// MARK: - 2. Physical iPhone Capture (CoreMediaIO / AVFoundation)

#if canImport(AVFoundation) && canImport(CoreMediaIO)
class PhysicalDeviceCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private var session: AVCaptureSession?
    private var encoder: H264Encoder?
    private let config: CaptureConfig

    init(config: CaptureConfig) {
        self.config = config
        super.init()
    }

    func start() {
        // Enable iOS Screen Capture devices in CoreMediaIO DAL
        var prop = CMIOObjectPropertyAddress(
            mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
            mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
            mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain)
        )
        var allow: UInt32 = 1
        CMIOObjectSetPropertyData(
            CMIOObjectID(kCMIOObjectSystemObject),
            &prop, 0, nil,
            UInt32(MemoryLayout<UInt32>.size),
            &allow
        )

        // Give CoreMediaIO a moment to register iOS devices
        Thread.sleep(forTimeInterval: 0.5)

        // Request Camera authorization if notDetermined so macOS permission dialog appears
        let authStatus = AVCaptureDevice.authorizationStatus(for: .video)
        if authStatus == .notDetermined {
            let sema = DispatchSemaphore(value: 0)
            AVCaptureDevice.requestAccess(for: .video) { _ in
                sema.signal()
            }
            _ = sema.wait(timeout: .now() + 5.0)
        }

        let updatedStatus = AVCaptureDevice.authorizationStatus(for: .video)
        if updatedStatus == .denied || updatedStatus == .restricted {
            let msg = "Izin Kamera ditolak. Buka System Settings > Privacy & Security > Camera > nyalakan Petak, lalu restart Petak."
            logStderr("[ios-capture] \(msg)")
            emitStatus([
                "status": "error",
                "message": msg
            ])
            exit(1)
        }

        let session = AVCaptureSession()
        session.sessionPreset = .high

        // Find connected iOS device using DiscoverySession with mediaType: nil / muxed
        var devices: [AVCaptureDevice] = []
        if #available(macOS 14.0, *) {
            let discovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.external, .builtInWideAngleCamera],
                mediaType: nil,
                position: .unspecified
            )
            devices = discovery.devices
        }
        if devices.isEmpty {
            devices = AVCaptureDevice.devices(for: .muxed) + AVCaptureDevice.devices(for: .video)
        }

        let iosDevices = devices.filter { dev in
            let isIosModel = dev.modelID == "iOS Device" || dev.modelID.hasPrefix("iOS")
            let isMuxed = dev.hasMediaType(.muxed)
            let isLikelyIos = isIosModel || isMuxed || dev.localizedName.contains("iPhone") || dev.localizedName.contains("iPad")
            return isLikelyIos
        }

        logStderr("[ios-capture] Found \(devices.count) total devices, \(iosDevices.count) iOS candidate devices.")
        for d in iosDevices {
            logStderr("[ios-capture] Candidate: name='\(d.localizedName)', uniqueID='\(d.uniqueID)', modelID='\(d.modelID)'")
        }

        let targetDevice: AVCaptureDevice?
        if !self.config.udid.isEmpty {
            targetDevice = iosDevices.first { $0.uniqueID == self.config.udid }
                ?? iosDevices.first { $0.modelID == self.config.udid }
                ?? (!self.config.deviceName.isEmpty ? iosDevices.first { $0.localizedName.caseInsensitiveCompare(self.config.deviceName) == .orderedSame } : nil)
                ?? iosDevices.first
        } else if !self.config.deviceName.isEmpty {
            targetDevice = iosDevices.first { $0.localizedName.caseInsensitiveCompare(self.config.deviceName) == .orderedSame }
                ?? iosDevices.first { $0.localizedName.localizedCaseInsensitiveContains(self.config.deviceName) }
                ?? iosDevices.first
        } else {
            targetDevice = iosDevices.first
        }

        guard let device = targetDevice else {
            let msg = "Mirror iPhone butuh kabel USB. Colok iPhone, buka kunci layar, pilih Trust"
            let availableList = devices.map { "\($0.localizedName) (id=\($0.uniqueID), model=\($0.modelID))" }.joined(separator: ", ")
            logStderr("[ios-capture] Error: No suitable iOS device found for udid='\(self.config.udid)', name='\(self.config.deviceName)'. Available: \(availableList)")
            emitStatus([
                "status": "needs_usb",
                "message": msg
            ])
            exit(1)
        }

        do {
            logStderr("[ios-capture] Connecting to '\(device.localizedName)' (uniqueID=\(device.uniqueID))...")
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else {
                let msg = "Cannot add iOS device '\(device.localizedName)' (\(device.uniqueID)) as input to AVCaptureSession"
                logStderr("[ios-capture] \(msg)")
                emitStatus(["status": "error", "message": msg])
                exit(1)
            }
            session.addInput(input)

            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange)
            ]
            let queue = DispatchQueue(label: "petak.avf.output", qos: .userInteractive)
            output.setSampleBufferDelegate(self, queue: queue)

            guard session.canAddOutput(output) else {
                let msg = "Cannot add video output to AVCaptureSession for '\(device.localizedName)'"
                logStderr("[ios-capture] \(msg)")
                emitStatus(["status": "error", "message": msg])
                exit(1)
            }
            session.addOutput(output)

            let dims = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
            let width = Int(dims.width > 0 ? dims.width : 1179)
            let height = Int(dims.height > 0 ? dims.height : 2556)

            self.encoder = H264Encoder(width: width, height: height, fps: self.config.fps)
            self.session = session

            session.startRunning()
            logStderr("[ios-capture] AVCaptureSession started running successfully: \(width)x\(height) @ \(self.config.fps)fps")

            emitStatus([
                "status": "live",
                "width": width,
                "height": height,
                "fps": self.config.fps,
                "captureBackend": "CoreMediaIO/AVFoundation",
                "viewOnly": true,
                "isFallback": false,
                "badge": "view-only",
                "message": "Physical iPhone connected in View-Only mode"
            ])
        } catch {
            let msg = "AVCaptureSession setup failed for device '\(device.localizedName)' (\(device.uniqueID)): \(error.localizedDescription) (Error: \(error))"
            logStderr("[ios-capture] \(msg)")
            emitStatus(["status": "error", "message": msg])
            exit(1)
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        encoder?.encode(pixelBuffer: pixelBuffer, presentationTime: pts)
    }

    func stop() {
        session?.stopRunning()
    }
}
#endif

// MARK: - 3. Slow Fallback: `xcrun simctl io screenshot` Polling

func startSimctlScreenshotFallback(config: CaptureConfig) {
    let pollingFps = min(config.fps, 10) // 5-10 fps budget for slow screenshot polling
    let interval = 1.0 / Double(pollingFps)
    let udid = config.udid.isEmpty ? "booted" : config.udid

    emitStatus([
        "status": "live",
        "width": config.width,
        "height": config.height,
        "fps": pollingFps,
        "captureBackend": "simctl-io-screenshot",
        "isFallback": true,
        "badge": "slow-fallback",
        "message": "Running via simctl io screenshot polling (slow fallback, ~\(pollingFps) fps)"
    ])

    guard let encoder = H264Encoder(width: config.width, height: config.height, fps: pollingFps) else {
        emitStatus(["status": "error", "message": "Failed to create fallback encoder"])
        exit(1)
    }
    activeEncoder = encoder

    var frameCount: Int64 = 0
    let tempPath = "/tmp/petak-sim-fallback-\(udid)-\(ProcessInfo.processInfo.processIdentifier).png"

    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .userInitiated))
    activeTimer = timer
    timer.schedule(deadline: .now(), repeating: interval)

    timer.setEventHandler {
        let task = Process()
        task.launchPath = "/usr/bin/xcrun"
        task.arguments = ["simctl", "io", udid, "screenshot", tempPath]
        task.launch()
        task.waitUntilExit()

        if task.terminationStatus == 0, let imgData = try? Data(contentsOf: URL(fileURLWithPath: tempPath)) {
            if let imageSource = CGImageSourceCreateWithData(imgData as CFData, nil),
               let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) {
                if let pixelBuffer = createPixelBuffer(from: cgImage, width: config.width, height: config.height) {
                    let pts = CMTime(value: frameCount, timescale: Int32(pollingFps))
                    encoder.encode(pixelBuffer: pixelBuffer, presentationTime: pts)
                    frameCount += 1
                }
            }
            try? FileManager.default.removeItem(atPath: tempPath)
        }
    }

    timer.resume()
}

func createPixelBuffer(from image: CGImage, width: Int, height: Int) -> CVPixelBuffer? {
    var pixelBuffer: CVPixelBuffer?
    let attrs: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true
    ]
    let status = CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_32ARGB,
        attrs as CFDictionary,
        &pixelBuffer
    )
    guard status == kCVReturnSuccess, let buffer = pixelBuffer else { return nil }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    let baseAddress = CVPixelBufferGetBaseAddress(buffer)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
        data: baseAddress,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    ) else { return nil }

    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buffer
}

// MARK: - Main Teardown & RunLoop

var sigSource: DispatchSourceSignal?
var activeSimulatorCapture: Any?
var activePhysicalCapture: Any?
var activeTimer: DispatchSourceTimer?
var activeEncoder: H264Encoder?

func setupSignalHandlers() {
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)

    let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    intSource.setEventHandler {
        emitStatus(["status": "disconnected", "reason": "SIGINT received"])
        exit(0)
    }
    intSource.resume()

    let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    termSource.setEventHandler {
        emitStatus(["status": "disconnected", "reason": "SIGTERM received"])
        exit(0)
    }
    termSource.resume()
}

func main() {
    _ = NSApplication.shared
    setupSignalHandlers()
    let config = parseArguments()

    emitStatus(["status": "connecting", "mode": config.mode, "udid": config.udid])

    switch config.mode {
    case "physical":
        #if canImport(AVFoundation) && canImport(CoreMediaIO)
        let phys = PhysicalDeviceCapture(config: config)
        activePhysicalCapture = phys
        phys.start()
        #else
        let msg = "AVFoundation / CoreMediaIO not available on this platform"
        logStderr("[ios-capture] \(msg)")
        emitStatus(["status": "error", "message": msg])
        exit(1)
        #endif

    case "fallback":
        startSimctlScreenshotFallback(config: config)

    case "simulator":
        fallthrough
    default:
        #if canImport(ScreenCaptureKit)
        if #available(macOS 12.3, *) {
            let sim = SimulatorCapture(config: config)
            activeSimulatorCapture = sim
            sim.start()
        } else {
            startSimctlScreenshotFallback(config: config)
        }
        #else
        startSimctlScreenshotFallback(config: config)
        #endif
    }

    RunLoop.main.run()
}

main()

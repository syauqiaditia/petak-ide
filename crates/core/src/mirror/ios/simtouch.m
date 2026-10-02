//
// simtouch.m
// Petak: Native iOS Simulator Touch Helper via SimulatorKit / IndigoHID
//
// Usage:
//   simtouch tap <x> <y> <w> <h> [--udid <udid>]
//   simtouch swipe <x1> <y1> <x2> <y2> <w> <h> [duration_ms] [steps] [--udid <udid>]
//   simtouch button <home|lock|volume_up|volume_down> [--udid <udid>]
//   simtouch key <keycode> [--udid <udid>]
//

#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dlfcn.h>
#import <objc/runtime.h>
#import <stdio.h>
#import <stdlib.h>
#import <string.h>
#import <unistd.h>

#pragma mark - SimulatorKit & CoreSimulator Definitions

@interface SimDevice : NSObject
@property (readonly, copy) NSUUID *UDID;
@property (readonly, copy) NSString *name;
@property (readonly, copy) NSString *stateString;
@property (readonly) unsigned long long state;
@end

@interface SimDeviceSet : NSObject
+ (id)defaultSet;
- (NSArray<SimDevice *> *)devices;
- (NSArray<SimDevice *> *)availableDevices;
@end

@interface NSObject (SimServiceContext)
+ (id)sharedServiceContextForDeveloperDir:(id)developerDir error:(NSError **)error;
- (id)defaultDeviceSetWithError:(NSError **)error;
@end

@interface NSObject (SimDeviceLegacyHIDClient)
- (instancetype)initWithDevice:(id)device error:(NSError **)error;
- (void)sendWithMessage:(void *)message
           freeWhenDone:(BOOL)freeWhenDone
        completionQueue:(dispatch_queue_t)completionQueue
             completion:(void (^)(NSError *error))completion;
@end

typedef void *(*IndigoHIDMessageForMouseNSEventFn)(
    const CGPoint *p1,
    const CGPoint *p2,
    uint32_t target,
    uint32_t eventType,
    uint32_t direction,
    double unused1,
    double unused2,
    double widthPoints,
    double heightPoints
);

typedef void *(*IndigoHIDMessageForButtonFn)(
    uint32_t button,
    uint32_t direction,
    uint32_t target
);

typedef void *(*IndigoHIDMessageForHIDArbitraryFn)(
    uint32_t target,
    uint32_t page,
    uint32_t usage,
    uint32_t operation
);

typedef void *(*IndigoHIDServiceFn)(void);

#pragma mark - Helper Functions

static double clamp01(double v) {
    if (v < 0.0) return 0.0;
    if (v > 1.0) return 1.0;
    return v;
}

static void *loadSimulatorKit(void) {
    static void *handle = NULL;
    if (handle) return handle;

    const char *paths[] = {
        "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        "/Library/Developer/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        "/Applications/Xcode-beta.app/Contents/Developer/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        "/Applications/Xcode.app/Contents/SharedFrameworks/SimulatorKit.framework/SimulatorKit",
        "SimulatorKit.framework/SimulatorKit",
        NULL
    };

    for (int i = 0; paths[i] != NULL; i++) {
        handle = dlopen(paths[i], RTLD_NOW | RTLD_GLOBAL);
        if (handle) break;
    }
    return handle;
}

static void loadCoreSimulator(void) {
    const char *paths[] = {
        "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        "/Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        "/Applications/Xcode-beta.app/Contents/Developer/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        NULL
    };
    for (int i = 0; paths[i] != NULL; i++) {
        if (dlopen(paths[i], RTLD_NOW | RTLD_GLOBAL)) break;
    }
}

static BOOL sendIndigoMessage(id client, void *message) {
    if (!message) return NO;

    SEL sel = @selector(sendWithMessage:freeWhenDone:completionQueue:completion:);
    if (![client respondsToSelector:sel]) {
        free(message);
        fprintf(stderr, "[simtouch] client does not respond to sendWithMessage\n");
        return NO;
    }

    dispatch_semaphore_t sema = dispatch_semaphore_create(0);
    __block NSError *sendError = nil;

    void (^completion)(NSError *) = [^(NSError *err) {
        if (err) {
            sendError = [err retain];
        }
        dispatch_semaphore_signal(sema);
    } copy];

    dispatch_queue_t queue = dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0);
    [client sendWithMessage:message freeWhenDone:YES completionQueue:queue completion:completion];

    long waitRes = dispatch_semaphore_wait(sema, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
    [completion release];

    if (waitRes != 0) {
        fprintf(stderr, "[simtouch] sendWithMessage timed out\n");
        if (sendError) [sendError release];
        return NO;
    }
    if (sendError) {
        fprintf(stderr, "[simtouch] sendWithMessage error: %s\n", [[sendError description] UTF8String]);
        [sendError release];
        return NO;
    }
    return YES;
}

static void warmServices(id client, void *simKitHandle) {
    if (!simKitHandle) return;

    IndigoHIDServiceFn fnCreatePointer = (IndigoHIDServiceFn)dlsym(simKitHandle, "IndigoHIDMessageToCreatePointerService");
    IndigoHIDServiceFn fnCreateMouse = (IndigoHIDServiceFn)dlsym(simKitHandle, "IndigoHIDMessageToCreateMouseService");

    if (fnCreatePointer) {
        void *msg = fnCreatePointer();
        if (msg) {
            sendIndigoMessage(client, msg);
            usleep(20000);
        }
    }
    if (fnCreateMouse) {
        void *msg = fnCreateMouse();
        if (msg) {
            sendIndigoMessage(client, msg);
            usleep(20000);
        }
    }
}

static void *buildMouseMessage(IndigoHIDMessageForMouseNSEventFn fnMouse,
                               const CGPoint *p1,
                               const CGPoint *p2,
                               uint32_t eventType,
                               uint32_t direction,
                               double width,
                               double height) {
    void *msg = NULL;
    for (int retry = 0; retry < 5; retry++) {
        // target 0x32 routes to the touch digitizer
        msg = fnMouse(p1, p2, 0x32, eventType, direction, 1.0, 1.0, width, height);
        if (msg) break;
        usleep(5000);
    }
    return msg;
}

static id resolveSimDevice(NSString *targetUDID) {
    loadCoreSimulator();

    Class SimServiceContextClass = NSClassFromString(@"SimServiceContext");
    id serviceContext = nil;
    if ([SimServiceContextClass respondsToSelector:@selector(sharedServiceContextForDeveloperDir:error:)]) {
        serviceContext = [SimServiceContextClass sharedServiceContextForDeveloperDir:nil error:nil];
    }
    id deviceSet = nil;
    if (serviceContext && [serviceContext respondsToSelector:@selector(defaultDeviceSetWithError:)]) {
        deviceSet = [serviceContext defaultDeviceSetWithError:nil];
    } else {
        Class SimDeviceSetClass = NSClassFromString(@"SimDeviceSet");
        if ([SimDeviceSetClass respondsToSelector:@selector(defaultSet)]) {
            deviceSet = [SimDeviceSetClass defaultSet];
        }
    }

    if (!deviceSet) {
        fprintf(stderr, "[simtouch] Failed to resolve SimDeviceSet (SimServiceContext / SimDeviceSet)\n");
        return nil;
    }

    NSArray *devices = nil;
    if ([deviceSet respondsToSelector:@selector(devices)]) {
        devices = [deviceSet devices];
    } else if ([deviceSet respondsToSelector:@selector(availableDevices)]) {
        devices = [deviceSet availableDevices];
    }

    if (!devices || [devices count] == 0) {
        fprintf(stderr, "[simtouch] No simulator devices found in SimDeviceSet\n");
        return nil;
    }

    for (id dev in devices) {
        NSUUID *uuid = nil;
        if ([dev respondsToSelector:@selector(UDID)]) {
            uuid = [dev UDID];
        }
        NSString *uuidStr = [uuid UUIDString];

        if (targetUDID) {
            if (uuidStr && [uuidStr caseInsensitiveCompare:targetUDID] == NSOrderedSame) {
                return dev;
            }
        } else {
            // Find first booted device: state 3 (Booted) or stateString == "Booted"
            BOOL isBooted = NO;
            if ([dev respondsToSelector:@selector(state)]) {
                if ([dev state] == 3) isBooted = YES;
            }
            if (!isBooted && [dev respondsToSelector:@selector(stateString)]) {
                if ([[dev stateString] isEqualToString:@"Booted"]) isBooted = YES;
            }
            if (isBooted) {
                return dev;
            }
        }
    }

    if (targetUDID) {
        fprintf(stderr, "[simtouch] Device with UDID %s not found\n", [targetUDID UTF8String]);
    } else {
        fprintf(stderr, "[simtouch] No booted simulator device found\n");
    }
    return nil;
}

#pragma mark - Command Handlers

static int handleTap(id client, void *simKitHandle, int argc, const char *argv[], int startIdx) {
    if (startIdx + 4 > argc) {
        fprintf(stderr, "Usage: simtouch tap <x> <y> <w> <h> [--udid <udid>]\n");
        return 1;
    }

    double x = atof(argv[startIdx]);
    double y = atof(argv[startIdx + 1]);
    double w = atof(argv[startIdx + 2]);
    double h = atof(argv[startIdx + 3]);

    if (w <= 0.0) w = 1.0;
    if (h <= 0.0) h = 1.0;

    IndigoHIDMessageForMouseNSEventFn fnMouse =
        (IndigoHIDMessageForMouseNSEventFn)dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent");
    if (!fnMouse) {
        fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForMouseNSEvent not found\n");
        return 1;
    }

    CGPoint pt = CGPointMake(clamp01(x / w), clamp01(y / h));

    // DOWN: eventType 1, direction 1
    void *downMsg = buildMouseMessage(fnMouse, &pt, NULL, 1, 1, w, h);
    if (!downMsg || !sendIndigoMessage(client, downMsg)) {
        fprintf(stderr, "[simtouch] Failed to send touch DOWN\n");
        return 1;
    }

    usleep(50000); // 50ms hold

    // UP: eventType 2, direction 2
    void *upMsg = buildMouseMessage(fnMouse, &pt, NULL, 2, 2, w, h);
    if (!upMsg || !sendIndigoMessage(client, upMsg)) {
        fprintf(stderr, "[simtouch] Failed to send touch UP\n");
        return 1;
    }

    return 0;
}

static int handleSwipe(id client, void *simKitHandle, int argc, const char *argv[], int startIdx) {
    if (startIdx + 6 > argc) {
        fprintf(stderr, "Usage: simtouch swipe <x1> <y1> <x2> <y2> <w> <h> [duration_ms] [steps] [--udid <udid>]\n");
        return 1;
    }

    double x1 = atof(argv[startIdx]);
    double y1 = atof(argv[startIdx + 1]);
    double x2 = atof(argv[startIdx + 2]);
    double y2 = atof(argv[startIdx + 3]);
    double w = atof(argv[startIdx + 4]);
    double h = atof(argv[startIdx + 5]);

    if (w <= 0.0) w = 1.0;
    if (h <= 0.0) h = 1.0;

    int duration_ms = 200;
    int steps = 10;

    if (startIdx + 6 < argc) {
        duration_ms = atoi(argv[startIdx + 6]);
        if (duration_ms <= 0) duration_ms = 200;
    }
    if (startIdx + 7 < argc) {
        steps = atoi(argv[startIdx + 7]);
        if (steps <= 0) steps = 10;
    }

    IndigoHIDMessageForMouseNSEventFn fnMouse =
        (IndigoHIDMessageForMouseNSEventFn)dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent");
    if (!fnMouse) {
        fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForMouseNSEvent not found\n");
        return 1;
    }

    double x1_norm = clamp01(x1 / w);
    double y1_norm = clamp01(y1 / h);
    double x2_norm = clamp01(x2 / w);
    double y2_norm = clamp01(y2 / h);

    CGPoint pt1 = CGPointMake(x1_norm, y1_norm);
    CGPoint pt2 = CGPointMake(x2_norm, y2_norm);

    unsigned int stepUs = (unsigned int)((duration_ms * 1000) / (steps + 2));
    if (stepUs < 8000) stepUs = 8000;

    // DOWN: eventType 1, direction 1
    void *downMsg = buildMouseMessage(fnMouse, &pt1, NULL, 1, 1, w, h);
    if (!downMsg || !sendIndigoMessage(client, downMsg)) {
        fprintf(stderr, "[simtouch] Failed to send swipe DOWN\n");
        return 1;
    }

    usleep(stepUs);

    // Interpolation steps: eventType 6 (dragged), direction 0 (move)
    for (int i = 1; i <= steps; i++) {
        double t = (double)i / (double)steps;
        double cx = x1_norm + (x2_norm - x1_norm) * t;
        double cy = y1_norm + (y2_norm - y1_norm) * t;
        CGPoint cpt = CGPointMake(cx, cy);

        void *moveMsg = buildMouseMessage(fnMouse, &cpt, NULL, 6, 0, w, h);
        if (moveMsg) {
            sendIndigoMessage(client, moveMsg);
        }
        usleep(stepUs);
    }

    // UP: eventType 2, direction 2
    void *upMsg = buildMouseMessage(fnMouse, &pt2, NULL, 2, 2, w, h);
    if (!upMsg || !sendIndigoMessage(client, upMsg)) {
        fprintf(stderr, "[simtouch] Failed to send swipe UP\n");
        return 1;
    }

    return 0;
}

static int handleButton(id client, void *simKitHandle, int argc, const char *argv[], int startIdx) {
    if (startIdx >= argc) {
        fprintf(stderr, "Usage: simtouch button <home|lock|volume_up|volume_down> [--udid <udid>]\n");
        return 1;
    }

    const char *btnName = argv[startIdx];

    IndigoHIDMessageForButtonFn fnButton =
        (IndigoHIDMessageForButtonFn)dlsym(simKitHandle, "IndigoHIDMessageForButton");
    IndigoHIDMessageForHIDArbitraryFn fnHIDArb =
        (IndigoHIDMessageForHIDArbitraryFn)dlsym(simKitHandle, "IndigoHIDMessageForHIDArbitrary");

    if (strcmp(btnName, "home") == 0) {
        if (!fnButton) {
            fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForButton not found\n");
            return 1;
        }
        // Home: arg0 = 0x0, target = 0x33
        void *down = fnButton(0x0, 1, 0x33);
        if (!down || !sendIndigoMessage(client, down)) return 1;
        usleep(100000);
        void *up = fnButton(0x0, 2, 0x33);
        if (!up || !sendIndigoMessage(client, up)) return 1;
        return 0;
    } else if (strcmp(btnName, "lock") == 0 || strcmp(btnName, "power") == 0) {
        if (!fnButton) {
            fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForButton not found\n");
            return 1;
        }
        // Lock: arg0 = 0x1, target = 0x33
        void *down = fnButton(0x1, 1, 0x33);
        if (!down || !sendIndigoMessage(client, down)) return 1;
        usleep(100000);
        void *up = fnButton(0x1, 2, 0x33);
        if (!up || !sendIndigoMessage(client, up)) return 1;
        return 0;
    } else if (strcmp(btnName, "volume_up") == 0) {
        if (!fnHIDArb) {
            fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForHIDArbitrary not found\n");
            return 1;
        }
        // Volume Up: target 0x32, page 0x0C (Consumer), usage 0xE9
        void *down = fnHIDArb(0x32, 0x0C, 0xE9, 1);
        if (!down || !sendIndigoMessage(client, down)) return 1;
        usleep(100000);
        void *up = fnHIDArb(0x32, 0x0C, 0xE9, 2);
        if (!up || !sendIndigoMessage(client, up)) return 1;
        return 0;
    } else if (strcmp(btnName, "volume_down") == 0) {
        if (!fnHIDArb) {
            fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForHIDArbitrary not found\n");
            return 1;
        }
        // Volume Down: target 0x32, page 0x0C (Consumer), usage 0xEA
        void *down = fnHIDArb(0x32, 0x0C, 0xEA, 1);
        if (!down || !sendIndigoMessage(client, down)) return 1;
        usleep(100000);
        void *up = fnHIDArb(0x32, 0x0C, 0xEA, 2);
        if (!up || !sendIndigoMessage(client, up)) return 1;
        return 0;
    } else {
        fprintf(stderr, "[simtouch] Unknown button: %s\n", btnName);
        return 1;
    }
}

static int handleKey(id client, void *simKitHandle, int argc, const char *argv[], int startIdx) {
    if (startIdx >= argc) {
        fprintf(stderr, "Usage: simtouch key <keycode> [--udid <udid>]\n");
        return 1;
    }

    uint32_t keycode = (uint32_t)strtoul(argv[startIdx], NULL, 0);

    IndigoHIDMessageForHIDArbitraryFn fnHIDArb =
        (IndigoHIDMessageForHIDArbitraryFn)dlsym(simKitHandle, "IndigoHIDMessageForHIDArbitrary");
    if (!fnHIDArb) {
        fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForHIDArbitrary not found\n");
        return 1;
    }

    // Keyboard page is 0x07, target 0x32
    void *down = fnHIDArb(0x32, 0x07, keycode, 1);
    if (!down || !sendIndigoMessage(client, down)) {
        fprintf(stderr, "[simtouch] Failed to send key DOWN for %u\n", keycode);
        return 1;
    }

    usleep(50000); // 50ms hold

    void *up = fnHIDArb(0x32, 0x07, keycode, 2);
    if (!up || !sendIndigoMessage(client, up)) {
        fprintf(stderr, "[simtouch] Failed to send key UP for %u\n", keycode);
        return 1;
    }

    return 0;
}

#pragma mark - Main Entrypoint

int main(int argc, const char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "simtouch: Native iOS Simulator Touch Helper\n\n");
        fprintf(stderr, "Commands:\n");
        fprintf(stderr, "  simtouch tap <x> <y> <w> <h> [--udid <udid>]\n");
        fprintf(stderr, "  simtouch swipe <x1> <y1> <x2> <y2> <w> <h> [duration_ms] [steps] [--udid <udid>]\n");
        fprintf(stderr, "  simtouch button <home|lock|volume_up|volume_down> [--udid <udid>]\n");
        fprintf(stderr, "  simtouch key <keycode> [--udid <udid>]\n");
        return 1;
    }

    // Parse --udid flag and collect positional arguments
    NSString *udid = nil;
    const char *posArgs[32];
    int posCount = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--udid") == 0) {
            if (i + 1 < argc) {
                udid = [NSString stringWithUTF8String:argv[i + 1]];
                i++;
            }
        } else {
            if (posCount < 32) {
                posArgs[posCount++] = argv[i];
            }
        }
    }

    if (posCount == 0) {
        fprintf(stderr, "[simtouch] No command specified\n");
        return 1;
    }

    id simDevice = resolveSimDevice(udid);
    if (!simDevice) {
        return 1;
    }

    void *simKitHandle = loadSimulatorKit();
    if (!simKitHandle) {
        fprintf(stderr, "[simtouch] Could not load SimulatorKit.framework\n");
        return 1;
    }

    Class hidClientClass = NSClassFromString(@"_TtC12SimulatorKit24SimDeviceLegacyHIDClient");
    if (!hidClientClass) {
        hidClientClass = NSClassFromString(@"SimDeviceLegacyHIDClient");
    }
    if (!hidClientClass) {
        fprintf(stderr, "[simtouch] SimDeviceLegacyHIDClient class not found\n");
        return 1;
    }

    NSError *initErr = nil;
    id client = [[hidClientClass alloc] initWithDevice:simDevice error:&initErr];
    if (!client) {
        fprintf(stderr, "[simtouch] SimDeviceLegacyHIDClient init failed: %s\n",
                initErr ? [[initErr description] UTF8String] : "unknown");
        return 1;
    }

    warmServices(client, simKitHandle);

    const char *cmd = posArgs[0];
    int status = 0;

    if (strcmp(cmd, "tap") == 0) {
        status = handleTap(client, simKitHandle, posCount, posArgs, 1);
    } else if (strcmp(cmd, "swipe") == 0) {
        status = handleSwipe(client, simKitHandle, posCount, posArgs, 1);
    } else if (strcmp(cmd, "button") == 0) {
        status = handleButton(client, simKitHandle, posCount, posArgs, 1);
    } else if (strcmp(cmd, "key") == 0) {
        status = handleKey(client, simKitHandle, posCount, posArgs, 1);
    } else {
        fprintf(stderr, "[simtouch] Unknown command: %s\n", cmd);
        status = 1;
    }

    [client release];
    return status;
}

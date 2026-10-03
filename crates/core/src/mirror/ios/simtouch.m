//
// simtouch.m
// Petak: Native iOS Simulator Touch Helper via SimulatorKit / IndigoHID
//
// Usage:
//   simtouch daemon [--udid <udid>]
//   simtouch tap <x> <y> <w> <h> [--udid <udid>]
//   simtouch swipe <x1> <y1> <x2> <y2> <w> <h> [duration_ms] [steps] [--udid <udid>]
//   simtouch button <home|lock|volume_up|volume_down> [--udid <udid>]
//   simtouch key <keycode> [--udid <udid>]
//   simtouch text <string> [--udid <udid>]
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

static dispatch_queue_t getSerialQueue(void) {
    static dispatch_queue_t s_queue = NULL;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        s_queue = dispatch_queue_create("id.petak.simtouch.serial", DISPATCH_QUEUE_SERIAL);
    });
    return s_queue;
}

static uint64_t current_time_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)(tv.tv_sec * 1000 + tv.tv_usec / 1000);
}

static void sendIndigoMessageAsync(id client, void *message) {
    if (!message) return;

    SEL sel = @selector(sendWithMessage:freeWhenDone:completionQueue:completion:);
    if (![client respondsToSelector:sel]) {
        free(message);
        fprintf(stderr, "[simtouch] client does not respond to sendWithMessage\n");
        return;
    }

    dispatch_queue_t queue = getSerialQueue();
    [client sendWithMessage:message
               freeWhenDone:YES
            completionQueue:queue
                 completion:^(NSError *err) {
        if (err) {
            fprintf(stderr, "[simtouch] sendIndigoMessageAsync error: %s\n", [[err description] UTF8String]);
        }
    }];
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

static BOOL isDeviceBooted(id dev) {
    if (!dev) return NO;
    if ([dev respondsToSelector:@selector(state)]) {
        if ([dev state] == 3) return YES;
    }
    if ([dev respondsToSelector:@selector(stateString)]) {
        if ([[dev stateString] isEqualToString:@"Booted"]) return YES;
    }
    return NO;
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

    id matchedDevice = nil;
    id firstBootedDevice = nil;

    for (id dev in devices) {
        if (!firstBootedDevice && isDeviceBooted(dev)) {
            firstBootedDevice = dev;
        }

        if (targetUDID) {
            NSUUID *uuid = nil;
            if ([dev respondsToSelector:@selector(UDID)]) {
                uuid = [dev UDID];
            }
            NSString *uuidStr = [uuid UUIDString];
            if (uuidStr && [uuidStr caseInsensitiveCompare:targetUDID] == NSOrderedSame) {
                matchedDevice = dev;
            }
        }
    }

    if (targetUDID) {
        if (matchedDevice && isDeviceBooted(matchedDevice)) {
            return matchedDevice;
        }

        if (firstBootedDevice) {
            NSUUID *bootedUUID = nil;
            if ([firstBootedDevice respondsToSelector:@selector(UDID)]) {
                bootedUUID = [firstBootedDevice UDID];
            }
            fprintf(stderr, "[simtouch] Target UDID %s not booted, falling back to booted simulator %s\n",
                    [targetUDID UTF8String],
                    bootedUUID ? [[bootedUUID UUIDString] UTF8String] : "unknown");
            return firstBootedDevice;
        }

        fprintf(stderr, "[simtouch] Device with UDID %s not found or booted, and no booted simulator available\n", [targetUDID UTF8String]);
        return nil;
    }

    if (firstBootedDevice) {
        return firstBootedDevice;
    }

    fprintf(stderr, "[simtouch] No booted simulator device found\n");
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

    usleep(30000); // 30ms hold (<35ms latency)

    // UP: eventType 2, direction 2
    void *upMsg = buildMouseMessage(fnMouse, &pt, NULL, 2, 2, w, h);
    if (!upMsg || !sendIndigoMessage(client, upMsg)) {
        fprintf(stderr, "[simtouch] Failed to send touch UP\n");
        return 1;
    }

    return 0;
}

static int performSwipe(id client, void *simKitHandle,
                         double x1, double y1, double x2, double y2,
                         double w, double h, int duration_ms, int steps,
                         BOOL asyncDispatch) {
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
    if (!downMsg) {
        fprintf(stderr, "[simtouch] Failed to build swipe DOWN message\n");
        return 1;
    }
    if (asyncDispatch) {
        sendIndigoMessageAsync(client, downMsg);
    } else if (!sendIndigoMessage(client, downMsg)) {
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
            if (asyncDispatch) {
                sendIndigoMessageAsync(client, moveMsg);
            } else {
                sendIndigoMessage(client, moveMsg);
            }
        }
        usleep(stepUs);
    }

    // UP: eventType 2, direction 2
    void *upMsg = buildMouseMessage(fnMouse, &pt2, NULL, 2, 2, w, h);
    if (!upMsg) {
        fprintf(stderr, "[simtouch] Failed to build swipe UP message\n");
        return 1;
    }
    if (asyncDispatch) {
        sendIndigoMessageAsync(client, upMsg);
    } else if (!sendIndigoMessage(client, upMsg)) {
        fprintf(stderr, "[simtouch] Failed to send swipe UP\n");
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

    return performSwipe(client, simKitHandle, x1, y1, x2, y2, w, h, duration_ms, steps, NO);
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

#pragma mark - Keyboard Mapping & Text Input

static BOOL charToHID(char c, uint32_t *outUsage, BOOL *outShift) {
    if (c >= 'a' && c <= 'z') {
        *outUsage = 4 + (uint32_t)(c - 'a');
        *outShift = NO;
        return YES;
    }
    if (c >= 'A' && c <= 'Z') {
        *outUsage = 4 + (uint32_t)(c - 'A');
        *outShift = YES;
        return YES;
    }
    if (c >= '1' && c <= '9') {
        *outUsage = 30 + (uint32_t)(c - '1');
        *outShift = NO;
        return YES;
    }
    if (c == '0') {
        *outUsage = 39;
        *outShift = NO;
        return YES;
    }
    if (c == ' ') {
        *outUsage = 44;
        *outShift = NO;
        return YES;
    }
    // Symbols without shift
    switch (c) {
        case '-': *outUsage = 45; *outShift = NO; return YES;
        case '=': *outUsage = 46; *outShift = NO; return YES;
        case '[': *outUsage = 47; *outShift = NO; return YES;
        case ']': *outUsage = 48; *outShift = NO; return YES;
        case '\\': *outUsage = 49; *outShift = NO; return YES;
        case ';': *outUsage = 51; *outShift = NO; return YES;
        case '\'': *outUsage = 52; *outShift = NO; return YES;
        case '`': *outUsage = 53; *outShift = NO; return YES;
        case ',': *outUsage = 54; *outShift = NO; return YES;
        case '.': *outUsage = 55; *outShift = NO; return YES;
        case '/': *outUsage = 56; *outShift = NO; return YES;

        // Symbols with shift
        case '!': *outUsage = 30; *outShift = YES; return YES;
        case '@': *outUsage = 31; *outShift = YES; return YES;
        case '#': *outUsage = 32; *outShift = YES; return YES;
        case '$': *outUsage = 33; *outShift = YES; return YES;
        case '%': *outUsage = 34; *outShift = YES; return YES;
        case '^': *outUsage = 35; *outShift = YES; return YES;
        case '&': *outUsage = 36; *outShift = YES; return YES;
        case '*': *outUsage = 37; *outShift = YES; return YES;
        case '(': *outUsage = 38; *outShift = YES; return YES;
        case ')': *outUsage = 39; *outShift = YES; return YES;
        case '_': *outUsage = 45; *outShift = YES; return YES;
        case '+': *outUsage = 46; *outShift = YES; return YES;
        case '{': *outUsage = 47; *outShift = YES; return YES;
        case '}': *outUsage = 48; *outShift = YES; return YES;
        case '|': *outUsage = 49; *outShift = YES; return YES;
        case ':': *outUsage = 51; *outShift = YES; return YES;
        case '"': *outUsage = 52; *outShift = YES; return YES;
        case '~': *outUsage = 53; *outShift = YES; return YES;
        case '<': *outUsage = 54; *outShift = YES; return YES;
        case '>': *outUsage = 55; *outShift = YES; return YES;
        case '?': *outUsage = 56; *outShift = YES; return YES;
        case '\n':
        case '\r': *outUsage = 40; *outShift = NO; return YES;
        case '\t': *outUsage = 43; *outShift = NO; return YES;
        default: return NO;
    }
}

static void sendKeyStroke(id client, IndigoHIDMessageForHIDArbitraryFn fnHIDArb, uint32_t usage, BOOL shift) {
    if (!fnHIDArb || !client) return;
    if (shift) {
        void *shiftDown = fnHIDArb(0x32, 0x07, 225, 1);
        if (shiftDown) sendIndigoMessageAsync(client, shiftDown);
        usleep(1000);
    }
    void *keyDown = fnHIDArb(0x32, 0x07, usage, 1);
    if (keyDown) sendIndigoMessageAsync(client, keyDown);
    usleep(5000);
    void *keyUp = fnHIDArb(0x32, 0x07, usage, 2);
    if (keyUp) sendIndigoMessageAsync(client, keyUp);
    if (shift) {
        usleep(1000);
        void *shiftUp = fnHIDArb(0x32, 0x07, 225, 2);
        if (shiftUp) sendIndigoMessageAsync(client, shiftUp);
    }
    usleep(2000); // 2ms hold between keystrokes
}

static int handleText(id client, void *simKitHandle, const char *str) {
    if (!str || !simKitHandle) return 1;
    IndigoHIDMessageForHIDArbitraryFn fnHIDArb =
        (IndigoHIDMessageForHIDArbitraryFn)dlsym(simKitHandle, "IndigoHIDMessageForHIDArbitrary");
    if (!fnHIDArb) {
        fprintf(stderr, "[simtouch] Symbol IndigoHIDMessageForHIDArbitrary not found\n");
        return 1;
    }
    size_t len = strlen(str);
    for (size_t i = 0; i < len; i++) {
        char c = str[i];
        if (c == '\\' && i + 1 < len) {
            char next = str[i + 1];
            if (next == 'n') {
                sendKeyStroke(client, fnHIDArb, 40, NO); // Enter
                i++;
                continue;
            } else if (next == 't') {
                sendKeyStroke(client, fnHIDArb, 43, NO); // Tab
                i++;
                continue;
            } else if (next == '\\') {
                sendKeyStroke(client, fnHIDArb, 49, NO); // Backslash
                i++;
                continue;
            }
        }
        uint32_t usage = 0;
        BOOL shift = NO;
        if (charToHID(c, &usage, &shift)) {
            sendKeyStroke(client, fnHIDArb, usage, shift);
        } else {
            fprintf(stderr, "[simtouch] Unsupported char: %c (0x%02x)\n", c, (unsigned char)c);
        }
    }
    return 0;
}

#pragma mark - Persistent Daemon Loop

static int runDaemon(id client, void *simKitHandle) {
    IndigoHIDMessageForMouseNSEventFn fnMouse =
        (IndigoHIDMessageForMouseNSEventFn)dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent");
    IndigoHIDMessageForHIDArbitraryFn fnHIDArb =
        (IndigoHIDMessageForHIDArbitraryFn)dlsym(simKitHandle, "IndigoHIDMessageForHIDArbitrary");

    fprintf(stderr, "[simtouch] daemon ready\n");
    fflush(stderr);

    uint64_t lastDownMs = 0;
    BOOL isTouchDown = NO;
    CGPoint lastPt = CGPointZero;
    double lastW = 1.0, lastH = 1.0;

    char line[8192];
    while (fgets(line, sizeof(line), stdin)) {
        size_t len = strlen(line);
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
            line[len - 1] = '\0';
            len--;
        }
        if (len == 0) continue;

        if (line[0] == 'd' && line[1] == ' ') {
            double x = 0, y = 0, w = 1, h = 1;
            if (sscanf(line + 2, "%lf %lf %lf %lf", &x, &y, &w, &h) >= 4) {
                if (w <= 0.0) w = 1.0;
                if (h <= 0.0) h = 1.0;
                if (fnMouse) {
                    CGPoint pt = CGPointMake(clamp01(x / w), clamp01(y / h));
                    // Deduplicate / synthesize UP if previous touch was left hanging
                    if (isTouchDown) {
                        void *upMsg = buildMouseMessage(fnMouse, &lastPt, NULL, 2, 2, lastW, lastH);
                        if (upMsg) sendIndigoMessageAsync(client, upMsg);
                        usleep(5000);
                    }
                    void *downMsg = buildMouseMessage(fnMouse, &pt, NULL, 1, 1, w, h);
                    if (downMsg) sendIndigoMessageAsync(client, downMsg);
                    isTouchDown = YES;
                    lastDownMs = current_time_ms();
                    lastPt = pt;
                    lastW = w;
                    lastH = h;
                }
            }
        } else if (line[0] == 'm' && line[1] == ' ') {
            double x = 0, y = 0, w = 1, h = 1;
            if (sscanf(line + 2, "%lf %lf %lf %lf", &x, &y, &w, &h) >= 4) {
                if (w <= 0.0) w = 1.0;
                if (h <= 0.0) h = 1.0;
                if (fnMouse && isTouchDown) {
                    CGPoint pt = CGPointMake(clamp01(x / w), clamp01(y / h));
                    void *moveMsg = buildMouseMessage(fnMouse, &pt, NULL, 6, 0, w, h);
                    if (moveMsg) sendIndigoMessageAsync(client, moveMsg);
                    lastPt = pt;
                    lastW = w;
                    lastH = h;
                }
            }
        } else if (line[0] == 'u' && line[1] == ' ') {
            double x = 0, y = 0, w = 1, h = 1;
            if (sscanf(line + 2, "%lf %lf %lf %lf", &x, &y, &w, &h) >= 4) {
                if (w <= 0.0) w = 1.0;
                if (h <= 0.0) h = 1.0;
                if (fnMouse) {
                    CGPoint pt = CGPointMake(clamp01(x / w), clamp01(y / h));
                    if (isTouchDown) {
                        isTouchDown = NO;
                        uint64_t elapsed = current_time_ms() - lastDownMs;
                        // iOS UIKit requires at least 30ms contact duration to register a tap reliably
                        if (elapsed < 35) {
                            usleep((useconds_t)((35 - elapsed) * 1000));
                        }
                    }
                    void *upMsg = buildMouseMessage(fnMouse, &pt, NULL, 2, 2, w, h);
                    if (upMsg) sendIndigoMessageAsync(client, upMsg);
                }
            }
        } else if (line[0] == 't' && line[1] == ' ') {
            double x = 0, y = 0, w = 1, h = 1;
            if (sscanf(line + 2, "%lf %lf %lf %lf", &x, &y, &w, &h) >= 4) {
                if (w <= 0.0) w = 1.0;
                if (h <= 0.0) h = 1.0;
                if (fnMouse) {
                    CGPoint pt = CGPointMake(clamp01(x / w), clamp01(y / h));
                    void *downMsg = buildMouseMessage(fnMouse, &pt, NULL, 1, 1, w, h);
                    if (downMsg) sendIndigoMessageAsync(client, downMsg);
                    usleep(35000); // 35ms hold for guaranteed UIKit tap recognition
                    void *upMsg = buildMouseMessage(fnMouse, &pt, NULL, 2, 2, w, h);
                    if (upMsg) sendIndigoMessageAsync(client, upMsg);
                }
            }
        } else if (line[0] == 'k' && line[1] == ' ') {
            uint32_t keycode = 0;
            if (sscanf(line + 2, "%u", &keycode) == 1) {
                if (fnHIDArb) {
                    void *down = fnHIDArb(0x32, 0x07, keycode, 1);
                    if (down) sendIndigoMessageAsync(client, down);
                    usleep(5000);
                    void *up = fnHIDArb(0x32, 0x07, keycode, 2);
                    if (up) sendIndigoMessageAsync(client, up);
                }
            }
        } else if (line[0] == 'b' && line[1] == ' ') {
            const char *btn = line + 2;
            const char *bArgv[1] = { btn };
            handleButton(client, simKitHandle, 1, bArgv, 0);
        } else if (strncmp(line, "text ", 5) == 0) {
            const char *textStr = line + 5;
            handleText(client, simKitHandle, textStr);
        } else if (line[0] == 's' && line[1] == ' ') {
            double x1 = 0, y1 = 0, x2 = 0, y2 = 0, w = 1, h = 1;
            int duration_ms = 120, steps = 8;
            int parsed = sscanf(line + 2, "%lf %lf %lf %lf %lf %lf %d %d",
                                &x1, &y1, &x2, &y2, &w, &h, &duration_ms, &steps);
            if (parsed >= 6) {
                if (w <= 0.0) w = 1.0;
                if (h <= 0.0) h = 1.0;
                if (duration_ms <= 0) duration_ms = 120;
                if (steps <= 0) steps = 8;
                dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
                    performSwipe(client, simKitHandle, x1, y1, x2, y2, w, h, duration_ms, steps, YES);
                });
            }
        } else {
            fprintf(stderr, "[simtouch] daemon unknown line: %s\n", line);
        }
    }

    fprintf(stderr, "[simtouch] daemon exiting (stdin EOF)\n");
    return 0;
}

#pragma mark - Main Entrypoint

int main(int argc, const char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "simtouch: Native iOS Simulator Touch Helper\n\n");
        fprintf(stderr, "Commands:\n");
        fprintf(stderr, "  simtouch daemon [--udid <udid>]\n");
        fprintf(stderr, "  simtouch tap <x> <y> <w> <h> [--udid <udid>]\n");
        fprintf(stderr, "  simtouch swipe <x1> <y1> <x2> <y2> <w> <h> [duration_ms] [steps] [--udid <udid>]\n");
        fprintf(stderr, "  simtouch button <home|lock|volume_up|volume_down> [--udid <udid>]\n");
        fprintf(stderr, "  simtouch key <keycode> [--udid <udid>]\n");
        fprintf(stderr, "  simtouch text <string> [--udid <udid>]\n");
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

    if (strcmp(cmd, "daemon") == 0) {
        status = runDaemon(client, simKitHandle);
    } else if (strcmp(cmd, "text") == 0) {
        if (posCount < 2) {
            fprintf(stderr, "Usage: simtouch text <string> [--udid <udid>]\n");
            status = 1;
        } else {
            status = handleText(client, simKitHandle, posArgs[1]);
        }
    } else if (strcmp(cmd, "tap") == 0) {
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

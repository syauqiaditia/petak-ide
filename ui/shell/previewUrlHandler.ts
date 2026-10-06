import { runStore } from '../features/run/runStore.svelte';
import { mirrorStore } from '../features/mirror/mirrorStore.svelte';
import { settingsStore } from '../features/settings/settingsStore.svelte';
import { panelStore } from './panelStore.svelte';

export interface PreviewContext {
  openRun: () => Promise<void>;
  openBuild: () => Promise<void>;
  openLogcat: () => Promise<void>;
  setActiveRailTab: (tab: any) => void;
  setBranchName: (name: string) => void;
}

export function handlePreviewQueryParams(ctx: PreviewContext) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.has('running') || window.location.search.includes('preview-running')) {
    runStore.state = 'running';
    runStore.runId = 101;
    runStore.lastReloadMs = 240;
    runStore.lastReloadOk = true;
    runStore.devtoolsUri = 'http://127.0.0.1:9100?uri=http://127.0.0.1:8181';
    runStore.gradleDaemon = true;
    runStore.outputLines = [
      { id: 1, stream: 'stdout', line: 'Launching lib/main.dart on Pixel 8 in debug mode...' },
      { id: 2, stream: 'stdout', line: 'Running Gradle task assembleDebug...' },
      { id: 3, stream: 'stdout', line: '✓ Built build/app/outputs/flutter-apk/app-debug.apk' },
      { id: 4, stream: 'stdout', line: 'Connecting to VM Service at ws://127.0.0.1:8181/ws' },
      { id: 5, stream: 'stdout', line: 'The Flutter DevTools debugger and profiler is available at: http://127.0.0.1:9100?uri=http://127.0.0.1:8181' },
      { id: 6, stream: 'stdout', line: '⚡ To hot reload changes while running, press "r" or use TitleBar.' },
    ];
  }
  if (params.has('build-error') || window.location.search.includes('tab=build')) {
    runStore.buildErrors = [
      { file: 'lib/features/checkout/CheckoutScreen.kt', line: 48, col: 12, message: 'Unresolved reference: applyVoucher' },
      { file: 'lib/features/cart/CartRepository.kt', line: 102, col: 4, message: 'Type mismatch: inferred type is Double? but Double was expected' },
    ];
  }
  if (params.has('preview') || (window as any).__PETAK_PREVIEW__) {
    runStore.snapshot = {
      emulators: [
        { id: 'Pixel_8_API_35', name: 'Pixel 8', kind: 'android-avd', state: 'running', deviceId: 'emulator-5554', sdk: '35' },
        { id: 'Nexus_5_API_30', name: 'Nexus 5', kind: 'android-avd', state: 'stopped', deviceId: null, sdk: '30' },
        { id: 'iPhone-15-Pro', name: 'iPhone 15 Pro', kind: 'ios-sim', state: 'running', deviceId: 'udid-ios-sim-15', sdk: '17.5' },
        { id: 'iPad-Air-11', name: 'iPad Air 11-inch', kind: 'ios-sim', state: 'stopped', deviceId: null, sdk: '17.5' },
      ],
      physical: [
        { id: '2A151FDH2008W4', name: 'Samsung Galaxy S23', platform: 'android', transport: 'usb', state: 'online' },
        { id: '00008110-001A24621E22801E', name: 'UQi iPhone 14 Pro', platform: 'ios', transport: 'usb', state: 'online' },
      ],
    };
    runStore.devices = [
      { id: 'emulator-5554', name: 'Pixel 8', platform: 'android', kind: 'emulator', state: 'online', sdk: '35' },
      { id: 'udid-ios-sim-15', name: 'iPhone 15 Pro', platform: 'ios', kind: 'emulator', state: 'online', sdk: '17.5' },
      { id: '2A151FDH2008W4', name: 'Samsung Galaxy S23', platform: 'android', kind: 'physical', state: 'online' },
    ];
    runStore.selectedDeviceId = 'emulator-5554';
    ctx.setBranchName('canary/prod/1.9.0');
  }

  if (window.location.search.includes('tab=run')) {
    ctx.openRun();
  } else if (window.location.search.includes('tab=build')) {
    ctx.openBuild();
  } else if (window.location.search.includes('tab=logcat')) {
    ctx.openLogcat();
  } else if (window.location.search.includes('tab=devices')) {
    ctx.setActiveRailTab('devices');
  } else if (window.location.search.includes('tab=git')) {
    ctx.setActiveRailTab('git');
  } else if (window.location.search.includes('tab=mr') || window.location.search.includes('preview-mr')) {
    ctx.setActiveRailTab('mr');
  } else if (window.location.search.includes('tab=tests') || window.location.search.includes('preview-tests')) {
    ctx.setActiveRailTab('tests');
  } else if (window.location.search.includes('tab=toolchains')) {
    ctx.setActiveRailTab('settings');
  }

  if (params.has('mirror') || window.location.search.includes('preview-mirror')) {
    const stateParam = params.get('mirror-state') || 'live';
    const devParam = params.get('mirror-device') || 'Pixel 8 · API 35';
    const isViewOnlyParam = params.get('mirror-viewonly') === 'true' || stateParam === 'view-only';

    panelStore.openRightPanel('mirror');
    (mirrorStore as any).isOpen = true;
    mirrorStore.deviceName = devParam;
    mirrorStore.serial = isViewOnlyParam ? 'udid-ios-sim-15' : 'emulator-5554';
    mirrorStore.isViewOnly = isViewOnlyParam;

    if (stateParam === 'empty') {
      mirrorStore.status = 'empty';
      mirrorStore.deviceName = 'No Device Selected';
      mirrorStore.serial = '';
    } else if (stateParam === 'connecting') {
      mirrorStore.status = 'connecting';
    } else if (stateParam === 'disconnected') {
      mirrorStore.status = 'disconnected';
      mirrorStore.disconnectReason = 'USB connection was lost or emulator exited. Re-plug device to resume stream.';
    } else if (stateParam === 'error') {
      mirrorStore.status = 'error';
      if (params.has('screenrec') || isViewOnlyParam) {
        mirrorStore.errorMessage = 'macOS authorization denied: Screen Recording permission is required to stream iOS Simulator display.';
      } else {
        mirrorStore.errorMessage = 'exit code 1: adb forward failed: device unauthorized. Please check USB debugging prompt on phone.';
      }
    } else if (stateParam === 'view-only') {
      mirrorStore.status = 'view-only';
      mirrorStore.deviceName = 'iPhone 15 Pro · iOS 17.5';
      mirrorStore.isViewOnly = true;
      mirrorStore.fps = 60;
    } else {
      mirrorStore.status = 'live';
      mirrorStore.isViewOnly = false;
      mirrorStore.fps = 59;
      mirrorStore.latencyMs = 38;
    }
  }

  if (params.has('agent') || window.location.search.includes('preview-agent')) {
    panelStore.openRightPanel('agent');
  }

  if (params.has('settings') || window.location.search.includes('preview-settings')) {
    settingsStore.open('agents');
  }
}

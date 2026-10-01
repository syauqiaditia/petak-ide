import { api } from '../../lib/api';
import type { Device } from '../../lib/api';
import { runStore } from '../run/runStore.svelte';
import { panelStore } from '../../shell/panelStore.svelte';
import {
  clampPanelWidth,
  calcFps,
  calcLatency,
  mirrorStateMachine,
} from './logic';
import type {
  MirrorUiState,
  MirrorStatus,
  InputEvent,
  NavKey,
  MirrorInfo,
} from './types';

class MirrorStore {
  // Persistence & UI state
  get isOpen(): boolean {
    return panelStore.activeRightPanel === 'mirror';
  }
  width = $state<number>(
    typeof localStorage !== 'undefined' && localStorage.getItem('petak.mirror.width')
      ? clampPanelWidth(Number(localStorage.getItem('petak.mirror.width')))
      : 380
  );
  autoShowOnRun = $state<boolean>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('petak.mirror.auto_show_on_run') !== 'false'
      : true
  );

  // Connection & lifecycle status
  status = $state<MirrorUiState>('empty');
  serial = $state<string>('');
  deviceName = $state<string>('No Device');
  deviceWidth = $state<number>(1080);
  deviceHeight = $state<number>(2400);
  codec = $state<string>('h264');
  isViewOnly = $state<boolean>(false);
  errorMessage = $state<string>('');
  disconnectReason = $state<string>('');
  isFocused = $state<boolean>(false);
  screenshotToast = $state<string | null>(null);

  // Real telemetry
  fps = $state<number>(0);
  latencyMs = $state<number | null>(null);

  // Frame callbacks (set by DeviceCanvas component when mounted)
  private onFrameCallback: ((buf: ArrayBuffer) => void) | null = null;
  lastConfigPacket = $state<ArrayBuffer | null>(null);
  lastKeyPacket = $state<ArrayBuffer | null>(null);
  private frameTimestamps: number[] = [];
  private pendingInputTimestamp: number | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRunSerial: string | null = null;

  constructor() {
    if (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('petak.mirror.open') === 'true' &&
      !panelStore.activeRightPanel
    ) {
      panelStore.openRightPanel('mirror');
    }
    // If opened on load, initialize device target
    if (this.isOpen) {
      this.status = 'picker';
    }

    // Listen to mirror-status events (e.g. needs_usb, failed, etc.)
    api.onMirrorStatus?.((payload) => {
      if (!payload || !payload.status) return;
      const current = this.activeRunSerial || this.serial;
      if (!current) return;
      if (
        payload.serial === current ||
        payload.serial === this.serial ||
        payload.serial === this.activeRunSerial
      ) {
        this.handleMirrorStatus(payload.status);
      }
    });

    // Listen to mirror-frame events (forwarded from core video stream)
    api.onMirrorFrame?.((payload) => {
      if (!payload) return;
      const current = this.activeRunSerial || this.serial;
      if (!current) return;
      if (payload.serial === current || payload.serial === this.serial || payload.serial === this.activeRunSerial) {
        const raw = payload.data;
        let buf: ArrayBuffer;
        if (typeof raw === 'string') {
          const bin = atob(raw);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            u8[i] = bin.charCodeAt(i);
          }
          buf = u8.buffer;
        } else if (raw instanceof Uint8Array) {
          buf = (raw.buffer as ArrayBuffer).slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        } else if (Array.isArray(raw)) {
          buf = new Uint8Array(raw).buffer as ArrayBuffer;
        } else {
          buf = new Uint8Array(raw as any).buffer as ArrayBuffer;
        }
        this.handleBinaryFrame(buf);
      }
    });
  }

  setWidth(newWidth: number) {
    this.width = clampPanelWidth(newWidth);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.width', String(this.width));
    }
  }

  setAutoShowOnRun(value: boolean) {
    this.autoShowOnRun = value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.auto_show_on_run', String(value));
    }
  }

  registerFrameCallback(cb: (buf: ArrayBuffer) => void) {
    this.onFrameCallback = cb;
    if (this.lastConfigPacket) {
      try {
        cb(this.lastConfigPacket);
      } catch (e) {
        console.warn('[mirrorStore] replay lastConfigPacket error:', e);
      }
    }
    if (this.lastKeyPacket) {
      try {
        cb(this.lastKeyPacket);
      } catch (e) {
        console.warn('[mirrorStore] replay lastKeyPacket error:', e);
      }
    }
  }

  unregisterFrameCallback() {
    this.onFrameCallback = null;
  }

  recordFrameRendered() {
    const now = performance.now();
    this.frameTimestamps.push(now);
    // Keep only timestamps within last 1.2s
    const threshold = now - 1200;
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < threshold) {
      this.frameTimestamps.shift();
    }
    this.fps = calcFps(this.frameTimestamps, now);

    if (this.pendingInputTimestamp !== null) {
      const lat = calcLatency(this.pendingInputTimestamp, now);
      if (lat !== null) {
        this.latencyMs = lat;
        this.pendingInputTimestamp = null;
      }
    }
  }

  recordInputSent() {
    this.pendingInputTimestamp = performance.now();
  }

  get selectedDevice() {
    return runStore.devices.find((d) => d.id === this.serial) || runStore.selectedDevice || null;
  }

  syncDevice() {
    const dev = runStore.selectedDevice;
    if (dev) {
      this.serial = dev.id;
      this.deviceName = dev.name;
      this.isViewOnly = dev.platform === 'ios' && dev.kind === 'physical';
    } else {
      const savedSerial = typeof localStorage !== 'undefined'
        ? localStorage.getItem('petak.mirror.last_serial')
        : null;
      if (savedSerial) {
        this.serial = savedSerial;
        this.deviceName = savedSerial;
      } else {
        this.serial = '';
        this.deviceName = 'No Device Selected';
      }
    }
  }

  async showDevicePicker() {
    // Switch device should immediately show picker without throwing or killing background emulator
    this.status = 'picker';
    const prevSerial = this.activeRunSerial || this.serial;
    this.activeRunSerial = null;
    this.serial = '';
    this.deviceName = 'Pilih Device';
    if (prevSerial) {
      api.mirrorStop(prevSerial).catch(() => {});
    }
  }

  async toggle() {
    if (this.isOpen) {
      await this.close();
    } else {
      await this.open();
    }
  }

  async open(targetSerial?: string) {
    panelStore.openRightPanel('mirror');
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.open', 'true');
    }

    // UQi lifecycle rule: If session already live/connecting and no specific new target, keep streaming seamlessly
    if (
      !targetSerial &&
      this.activeRunSerial &&
      (this.status === 'live' || this.status === 'view-only' || this.status === 'connecting')
    ) {
      return;
    }

    if (targetSerial) {
      if (this.activeRunSerial && this.activeRunSerial !== targetSerial) {
        await this.stopDevice(this.activeRunSerial);
      }
      this.serial = targetSerial;
      this.deviceName = targetSerial;
      await this.start(targetSerial);
      return;
    }

    // Requirement: When Mirror button is pressed, show device picker first
    const autoSingle =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('petak.mirror.auto_single') === 'true';
    const runnableDevices = runStore.devices.filter((d) => d.state === 'online');
    if (autoSingle && runnableDevices.length === 1) {
      await this.start(runnableDevices[0].id);
    } else {
      this.status = 'picker';
    }
  }

  async close() {
    panelStore.closeRightPanel('mirror');
    this.isFocused = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.open', 'false');
    }
    // UQi lifecycle revision: Close (X) / Esc / Toggle Hide ONLY hides the panel.
    // Do NOT stop mirror stream or kill emulator on hide.
  }

  async stopDevice(targetSerial?: string) {
    const s = targetSerial || this.activeRunSerial || this.serial;
    await this.stop();
    if (s) {
      const dev = runStore.devices.find((d) => d.id === s);
      const isAvd =
        s.startsWith('emulator-') ||
        dev?.kind === 'emulator' ||
        (dev as any)?.kind === 'avd' ||
        dev?.platform === 'android';
      if (isAvd) {
        try {
          await api.avdStop(s);
        } catch (err) {
          console.warn('[mirrorStore] avdStop error on stopDevice:', err);
        }
      }
    }
  }

  async start(serialToStart?: string) {
    const targetSerial = serialToStart || this.serial;
    if (!targetSerial) {
      this.status = 'picker';
      return;
    }

    this.serial = targetSerial;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.last_serial', targetSerial);
    }

    // Check device type
    const dev = runStore.devices.find((d) => d.id === targetSerial) || runStore.selectedDevice;
    if (dev) {
      this.deviceName = dev.name;
      this.isViewOnly = dev.platform === 'ios';
    }

    this.status = 'connecting';
    this.errorMessage = '';
    this.disconnectReason = '';
    this.frameTimestamps = [];
    this.fps = 0;
    this.latencyMs = null;
    this.activeRunSerial = targetSerial;

    try {
      const info: MirrorInfo = await api.mirrorStart(
        targetSerial,
        (buf: ArrayBuffer) => {
          this.handleBinaryFrame(buf);
        },
        (status: MirrorStatus) => {
          this.handleMirrorStatus(status);
        }
      );

      if (info) {
        if (info.width && info.height) {
          this.deviceWidth = info.width;
          this.deviceHeight = info.height;
        }
        if (info.codec) {
          this.codec = info.codec;
        }
        if (info.name) {
          this.deviceName = info.name;
        }
      }
    } catch (err: any) {
      console.warn('[mirrorStore] mirrorStart error:', err);
      // In dev/preview or when command fails:
      if (this.activeRunSerial === targetSerial) {
        this.status = 'error';
        const raw = err?.message || (typeof err === 'object' && err?.message ? err.message : String(err || 'Failed to start mirror session'));
        this.errorMessage = raw;
      }
    }
  }

  async stop() {
    const s = this.activeRunSerial || this.serial || 'all';
    this.activeRunSerial = null;
    this.frameTimestamps = [];
    this.fps = 0;
    this.latencyMs = null;
    this.unregisterFrameCallback();
    this.lastConfigPacket = null;
    this.lastKeyPacket = null;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }

    if (s) {
      try {
        await api.mirrorStop(s);
      } catch (err) {
        // Idempotent stop warning
        console.warn('[mirrorStore] mirrorStop error:', err);
      }
    }
    this.status = 'empty';
  }

  async reconnect() {
    await this.stop();
    await this.start(this.serial);
  }

  handleBinaryFrame(buf: ArrayBuffer) {
    if (this.status === 'connecting' || this.status === 'disconnected') {
      this.status = this.isViewOnly ? 'view-only' : 'live';
    }
    const bytes = new Uint8Array(buf);
    if (bytes.length > 0 && bytes[0] === 0) {
      this.lastConfigPacket = buf;
    } else if (bytes.length > 0 && bytes[0] === 1) {
      this.lastKeyPacket = buf;
    }
    if (this.onFrameCallback) {
      this.onFrameCallback(buf);
    }
  }

  handleMirrorStatus(status: MirrorStatus) {
    const rawState = (status.state || '').toLowerCase();
    switch (rawState) {
      case 'connecting':
        this.status = 'connecting';
        break;
      case 'live':
        this.status = this.isViewOnly ? 'view-only' : 'live';
        if (status.width && status.height) {
          this.deviceWidth = status.width;
          this.deviceHeight = status.height;
        }
        break;
      case 'rotated':
        if (status.width && status.height) {
          this.deviceWidth = status.width;
          this.deviceHeight = status.height;
        }
        this.status = this.isViewOnly ? 'view-only' : 'live';
        break;
      case 'disconnected':
        this.status = 'disconnected';
        this.disconnectReason = status.reason || 'Device disconnected or USB detached';
        this.fps = 0;
        break;
      case 'needs_usb':
        this.status = 'error';
        this.errorMessage =
          status.message ||
          'needs_usb: iPhone Fisik membutuhkan kabel USB langsung ke Mac (tidak mendukung Wi-Fi / ncm).';
        this.fps = 0;
        break;
      case 'failed':
      case 'error':
        this.status = 'error';
        this.errorMessage = status.message || 'Mirroring session failed or encountered an error';
        this.fps = 0;
        break;
      default:
        if (rawState.includes('fail') || rawState.includes('error')) {
          this.status = 'error';
          this.errorMessage = status.message || rawState;
          this.fps = 0;
        }
        break;
    }
  }

  async sendInput(ev: InputEvent) {
    if (!this.serial) return;
    if (this.status !== 'live') {
      if (this.fps > 0 || this.frameTimestamps.length > 0) {
        this.status = this.isViewOnly ? 'view-only' : 'live';
      } else {
        return;
      }
    }
    if (this.isViewOnly && (ev.t === 'touch' || ev.t === 'key' || ev.t === 'text' || ev.t === 'scroll')) {
      return;
    }

    if (ev.t === 'touch' && ev.action === 'down') {
      this.recordInputSent();
    }

    try {
      await api.mirrorInput(this.serial, ev);
    } catch (err) {
      console.warn('[mirrorStore] mirrorInput error:', err);
    }
  }

  sendNav(key: NavKey) {
    return this.sendInput({ t: 'nav', key });
  }

  rotate() {
    return this.sendInput({ t: 'rotate' });
  }

  async takeScreenshot() {
    if (!this.serial) return;
    try {
      const savedPath = await api.mirrorScreenshot(this.serial, null);
      this.showToast(`Screenshot saved: ${savedPath || '/tmp/petak-screencap.png'}`);
    } catch (err: any) {
      this.showToast(`Screenshot failed: ${err?.message || err}`);
    }
  }

  showToast(msg: string) {
    this.screenshotToast = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.screenshotToast = null;
    }, 2800);
  }
}

export const mirrorStore = new MirrorStore();

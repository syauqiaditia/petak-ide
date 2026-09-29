import { api } from '../../lib/api';
import type { Device } from '../../lib/api';
import { runStore } from '../run/runStore.svelte';
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
  isOpen = $state<boolean>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('petak.mirror.open') === 'true'
      : false
  );
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
  private frameTimestamps: number[] = [];
  private pendingInputTimestamp: number | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRunSerial: string | null = null;

  constructor() {
    // If opened on load, initialize device target
    if (this.isOpen) {
      this.syncDevice();
    }
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

  async toggle() {
    if (this.isOpen) {
      await this.close();
    } else {
      await this.open();
    }
  }

  async open(targetSerial?: string) {
    this.isOpen = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.open', 'true');
    }

    if (targetSerial) {
      this.serial = targetSerial;
      this.deviceName = targetSerial;
    } else {
      this.syncDevice();
    }

    if (this.serial) {
      await this.start(this.serial);
    } else {
      this.status = 'empty';
    }
  }

  async close() {
    this.isOpen = false;
    this.isFocused = false;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.mirror.open', 'false');
    }
    await this.stop();
  }

  async start(serialToStart?: string) {
    const targetSerial = serialToStart || this.serial;
    if (!targetSerial) {
      this.status = 'empty';
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
        this.errorMessage = String(err?.message || err || 'Failed to start mirror session');
      }
    }
  }

  async stop() {
    const s = this.activeRunSerial || this.serial;
    this.activeRunSerial = null;
    this.frameTimestamps = [];
    this.fps = 0;
    this.latencyMs = null;

    if (s) {
      try {
        await api.mirrorStop(s);
      } catch (err) {
        // Idempotent stop warning
        console.warn('[mirrorStore] mirrorStop error:', err);
      }
    }
    this.status = mirrorStateMachine(this.status, { type: 'STOP' });
  }

  async reconnect() {
    await this.stop();
    await this.start(this.serial);
  }

  handleBinaryFrame(buf: ArrayBuffer) {
    if (this.status === 'connecting') {
      this.status = this.isViewOnly ? 'view-only' : 'live';
    }
    if (this.onFrameCallback) {
      this.onFrameCallback(buf);
    }
  }

  handleMirrorStatus(status: MirrorStatus) {
    switch (status.state) {
      case 'Connecting':
        this.status = 'connecting';
        break;
      case 'Live':
        this.status = this.isViewOnly ? 'view-only' : 'live';
        if (status.width && status.height) {
          this.deviceWidth = status.width;
          this.deviceHeight = status.height;
        }
        break;
      case 'Rotated':
        if (status.width && status.height) {
          this.deviceWidth = status.width;
          this.deviceHeight = status.height;
        }
        this.status = this.isViewOnly ? 'view-only' : 'live';
        break;
      case 'Disconnected':
        this.status = 'disconnected';
        this.disconnectReason = status.reason || 'Device disconnected or USB detached';
        this.fps = 0;
        break;
      case 'Error':
        this.status = 'error';
        this.errorMessage = status.message;
        this.fps = 0;
        break;
    }
  }

  async sendInput(ev: InputEvent) {
    if (!this.serial || this.status !== 'live') return;
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

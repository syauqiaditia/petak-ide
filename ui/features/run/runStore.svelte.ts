import {
  api,
  type RunConfig,
  type RunConfigFile,
  type Device,
  type Avd,
  type AppState,
  type OutputStream,
  type BuildError,
  type RunEvent,
  type UnlistenFn,
} from '../../lib/api';
import {
  initialRunLogicState,
  reduceRunEvent,
  type OutputItem,
} from './logic';

class RunStore {
  root = $state<string>('');

  // Configurations
  configs = $state<RunConfig[]>([]);
  selectedConfigName = $state<string>('');

  get selectedConfig(): RunConfig | null {
    return this.configs.find((c) => c.name === this.selectedConfigName) || (this.configs.length > 0 ? this.configs[0] : null);
  }

  // Devices & AVDs
  devices = $state<Device[]>([]);
  selectedDeviceId = $state<string>('');
  avds = $state<Avd[]>([]);
  avdsLoading = $state<boolean>(false);

  get selectedDevice(): Device | null {
    return this.devices.find((d) => d.id === this.selectedDeviceId) || (this.devices.length > 0 ? this.devices[0] : null);
  }

  // Run lifecycle & state
  runId = $state<number | null>(null);
  state = $state<AppState>('stopped');
  appId = $state<string | null>(null);
  devtoolsUri = $state<string | null>(null);
  vmServiceUri = $state<string | null>(null);
  pid = $state<number | null>(null);
  lastReloadMs = $state<number | null>(null);
  lastReloadOk = $state<boolean | null>(null);

  // Diagnostics & Output
  buildErrors = $state<BuildError[]>([]);
  outputLines = $state<OutputItem[]>([]);

  // Gradle daemon
  gradleDaemon = $state<boolean>(false);

  // Settings & In-flight indicators
  hotReloadOnSave = $state<boolean>(false);
  isStarting = $state<boolean>(false);
  isReloading = $state<boolean>(false);
  isSyncing = $state<boolean>(false);

  // Listeners
  private unlistenRunEvent: UnlistenFn | null = null;
  private unlistenDevices: UnlistenFn | null = null;
  private unlistenGradleDaemon: UnlistenFn | null = null;
  private initialized = false;

  async init(folderPath: string) {
    if (!folderPath) return;
    this.root = folderPath;

    try {
      if (await api.testEnv('PETAK_NO_RUNSTORE')) return;
    } catch (_) {}

    // Load configs
    try {
      const file: RunConfigFile = await api.runConfigsLoad(folderPath);
      if (file && Array.isArray(file.configs)) {
        this.configs = file.configs;
        if (file.selected && file.configs.some((c) => c.name === file.selected)) {
          this.selectedConfigName = file.selected;
        } else if (file.configs.length > 0) {
          this.selectedConfigName = file.configs[0].name;
        }
      }
    } catch (e) {
      console.warn('[runStore] Failed to load run configs:', e);
    }

    // Load devices & start watch
    try {
      if (await api.testEnv('PETAK_NO_DEVICES')) return;
      await api.devicesWatch();
      const list = await api.devicesList();
      this.updateDevices(list);
    } catch (e) {
      console.warn('[runStore] Failed to watch/list devices:', e);
    }

    // Load AVDs
    this.refreshAvds();

    // Check Gradle daemon status on demand (not polling)
    this.checkGradleStatus();

    // Register event listeners once
    if (!this.initialized) {
      this.initialized = true;

      try {
        this.unlistenRunEvent = await api.onRunEvent((payload) => {
          this.handleRunEvent(payload.event);
        });
      } catch (e) {
        console.warn('[runStore] Failed to listen to run-event:', e);
      }

      try {
        this.unlistenDevices = await api.onDevicesChanged((devices) => {
          this.updateDevices(devices);
        });
      } catch (e) {
        console.warn('[runStore] Failed to listen to devices-changed:', e);
      }

      try {
        this.unlistenGradleDaemon = await api.onGradleDaemon((payload) => {
          this.gradleDaemon = payload.running;
        });
      } catch (e) {
        console.warn('[runStore] Failed to listen to gradle-daemon:', e);
      }
    }
  }

  updateDevices(list: Device[]) {
    this.devices = list || [];
    // If selectedDeviceId is missing or not in current list, pick first available
    if (this.devices.length > 0) {
      if (!this.selectedDeviceId || !this.devices.some((d) => d.id === this.selectedDeviceId)) {
        // Prefer online device
        const online = this.devices.find((d) => d.state === 'online');
        this.selectedDeviceId = online ? online.id : this.devices[0].id;
      }
    } else {
      this.selectedDeviceId = '';
    }
  }

  async refreshAvds() {
    this.avdsLoading = true;
    try {
      const list = await api.avdList();
      this.avds = list || [];
    } catch (e) {
      console.warn('[runStore] Failed to load AVD list:', e);
    } finally {
      this.avdsLoading = false;
    }
  }

  handleRunEvent(event: RunEvent) {
    const current = {
      state: this.state,
      runId: this.runId,
      appId: this.appId,
      devtoolsUri: this.devtoolsUri,
      vmServiceUri: this.vmServiceUri,
      pid: this.pid,
      lastReloadMs: this.lastReloadMs,
      lastReloadOk: this.lastReloadOk,
      buildErrors: this.buildErrors,
      outputLines: this.outputLines,
    };

    const next = reduceRunEvent(current, event);
    this.state = next.state;
    this.appId = next.appId;
    this.devtoolsUri = next.devtoolsUri;
    this.vmServiceUri = next.vmServiceUri;
    this.pid = next.pid;
    this.lastReloadMs = next.lastReloadMs;
    this.lastReloadOk = next.lastReloadOk;
    this.buildErrors = next.buildErrors;
    this.outputLines = next.outputLines;

    if (event.type === 'appStarted') {
      const devId = this.selectedDeviceId;
      if (devId) {
        api.logcatStart(devId, this.appId || undefined).catch((e) => {
          console.warn('[runStore] Failed to auto-start logcat:', e);
        });
      }
    } else if (event.type === 'stopped') {
      this.runId = null;
      this.pid = null;
      api.logcatStop().catch((e) => {
        console.warn('[runStore] Failed to auto-stop logcat:', e);
      });
    }
  }

  async selectConfig(name: string) {
    this.selectedConfigName = name;
    if (this.root && this.configs.length > 0) {
      try {
        await api.runConfigsSave(this.root, {
          selected: name,
          configs: this.configs,
        });
      } catch (e) {
        console.warn('[runStore] Failed to save selected run config:', e);
      }
    }
  }

  selectDevice(id: string) {
    const prevId = this.selectedDeviceId;
    this.selectedDeviceId = id;
    if (prevId !== id) {
      api.logcatStop().catch(() => {});
      if (this.state === 'running' && id) {
        api.logcatStart(id, this.appId || undefined).catch((e) => {
          console.warn('[runStore] Failed to restart logcat on device switch:', e);
        });
      }
    }
  }

  async startRun() {
    const config = this.selectedConfig;
    const device = this.selectedDevice;
    if (!config || !device || !this.root) return;

    this.isStarting = true;
    this.state = 'building';
    this.buildErrors = [];
    this.outputLines = [];
    this.devtoolsUri = null;
    this.appId = null;

    try {
      const id = await api.runStart(this.root, config, device.id);
      this.runId = id;
    } catch (e: any) {
      this.state = 'stopped';
      this.runId = null;
      const msg = typeof e === 'string' ? e : e?.message || 'Failed to start run';
      this.buildErrors = [
        ...this.buildErrors,
        {
          file: '',
          line: 0,
          col: null,
          message: msg,
        },
      ];
      this.outputLines = [
        ...this.outputLines,
        {
          id: Date.now(),
          stream: 'stderr',
          line: `[Error starting run] ${msg}`,
        },
      ];
    } finally {
      this.isStarting = false;
    }
  }

  async reload(full: boolean = false) {
    if (!this.runId || (this.state !== 'running' && this.state !== 'reloading')) return;

    this.isReloading = true;
    this.state = 'reloading';
    try {
      const res = await api.runReload(this.runId, full);
      this.lastReloadMs = res.ms;
      this.lastReloadOk = res.ok;
      this.state = 'running';
      this.outputLines = [
        ...this.outputLines,
        {
          id: Date.now(),
          stream: 'stdout',
          line: `⚡ ${full ? 'Hot restart' : 'Hot reload'} completed in ${res.ms}ms${res.message ? `: ${res.message}` : ''}`,
        },
      ];
    } catch (e: any) {
      this.state = 'running';
      const msg = typeof e === 'string' ? e : e?.message || 'Reload failed';
      this.outputLines = [
        ...this.outputLines,
        {
          id: Date.now(),
          stream: 'stderr',
          line: `❌ Reload failed: ${msg}`,
        },
      ];
    } finally {
      this.isReloading = false;
    }
  }

  async stopRun() {
    if (!this.runId) {
      this.state = 'stopped';
      api.logcatStop().catch(() => {});
      return;
    }

    try {
      await api.runStop(this.runId);
    } catch (e) {
      console.warn('[runStore] Failed to stop run:', e);
    } finally {
      this.state = 'stopped';
      this.runId = null;
      this.pid = null;
      api.logcatStop().catch(() => {});
    }
  }

  async startEmulator(avdName: string) {
    try {
      await api.emulatorStart(avdName, false);
      // Wait a moment then refresh devices
      setTimeout(() => {
        api.devicesList().then((list) => this.updateDevices(list)).catch(() => {});
      }, 1500);
    } catch (e: any) {
      console.error('[runStore] Failed to start emulator:', e);
    }
  }

  async syncGradle() {
    if (!this.root || this.isSyncing) return;
    this.isSyncing = true;
    try {
      const out = await api.gradleSync(this.root);
      this.outputLines = [
        ...this.outputLines,
        {
          id: Date.now(),
          stream: 'stdout',
          line: `[Gradle Sync] ${out}`,
        },
      ];
      await this.checkGradleStatus();
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message || 'Gradle sync failed';
      this.outputLines = [
        ...this.outputLines,
        {
          id: Date.now(),
          stream: 'stderr',
          line: `[Gradle Sync Error] ${msg}`,
        },
      ];
    } finally {
      this.isSyncing = false;
    }
  }

  async checkGradleStatus() {
    if (!this.root) return;
    try {
      const running = await api.gradleStatus(this.root);
      this.gradleDaemon = running;
    } catch (e) {
      // ignore
    }
  }

  async stopGradle() {
    if (!this.root) return;
    try {
      await api.gradleStop(this.root);
      this.gradleDaemon = false;
    } catch (e) {
      console.warn('[runStore] Failed to stop Gradle daemon:', e);
    }
  }

  async openDevTools() {
    if (this.devtoolsUri) {
      try {
        await api.openUrl(this.devtoolsUri);
      } catch (e) {
        console.error('[runStore] Failed to open DevTools URL:', e);
      }
    }
  }

  clearOutput() {
    this.outputLines = [];
  }

  clearBuildErrors() {
    this.buildErrors = [];
  }

  setHotReloadOnSave(val: boolean) {
    this.hotReloadOnSave = val;
  }

  destroy() {
    api.logcatStop().catch(() => {});
    if (this.unlistenRunEvent) {
      this.unlistenRunEvent();
      this.unlistenRunEvent = null;
    }
    if (this.unlistenDevices) {
      this.unlistenDevices();
      this.unlistenDevices = null;
    }
    if (this.unlistenGradleDaemon) {
      this.unlistenGradleDaemon();
      this.unlistenGradleDaemon = null;
    }
    this.initialized = false;
  }
}

export const runStore = new RunStore();

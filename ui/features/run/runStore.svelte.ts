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
  type DevicesSnapshot,
} from '../../lib/api';
import {
  initialRunLogicState,
  reduceRunEvent,
  type OutputItem,
} from './logic';
import { pruneDeviceSelection, clearBootingForOnline } from './deviceLogic';
import type { RunUiState } from './runStateMachine';

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
  snapshot = $state<DevicesSnapshot | null>(null);
  avds = $state<Avd[]>([]);
  avdsLoading = $state<boolean>(false);
  emulatorStatuses = $state<Record<string, { state: 'stopped' | 'booting' | 'running' | 'failed'; error?: string }>>({});

  get selectedDevice(): Device | null {
    return this.devices.find((d) => d.id === this.selectedDeviceId) || (this.devices.length > 0 ? this.devices[0] : null);
  }

  get emulators(): Array<{ id: string; name: string; running?: boolean; deviceId?: string | null; kind?: string }> {
    const result: Array<{ id: string; name: string; running?: boolean; deviceId?: string | null; kind?: string }> = [];
    const seen = new Set<string>();

    if (this.snapshot?.emulators) {
      for (const e of this.snapshot.emulators) {
        const isOnlineInDevs = this.devices.some(
          (d) => (d.id === e.id || d.id === e.deviceId || d.name === e.name) && d.state === 'online'
        );
        const isRunning =
          e.state === 'running' ||
          isOnlineInDevs ||
          this.emulatorStatuses[e.name]?.state === 'running' ||
          (e.deviceId ? this.emulatorStatuses[e.deviceId]?.state === 'running' : false);
        result.push({
          id: e.id,
          name: e.name,
          running: isRunning,
          deviceId: e.deviceId,
          kind: e.kind,
        });
        seen.add(e.id);
        seen.add(e.name);
        if (e.deviceId) seen.add(e.deviceId);
      }
    }

    for (const d of this.devices) {
      const isEmu = d.kind === 'emulator' || (d.id && d.id.startsWith('emulator-'));
      if (isEmu && !seen.has(d.id) && !seen.has(d.name)) {
        result.push({
          id: d.id,
          name: d.name,
          running: d.state === 'online',
          deviceId: d.id,
          kind: d.platform === 'ios' ? 'ios-sim' : 'android-avd',
        });
        seen.add(d.id);
        seen.add(d.name);
      }
    }

    for (const avd of this.avds || []) {
      if (!seen.has(avd.name)) {
        const isOnline = this.devices.some((d) => (d.name === avd.name || d.id === avd.name) && d.state === 'online');
        const st = this.emulatorStatuses[avd.name]?.state;
        result.push({
          id: avd.name,
          name: avd.name,
          running: isOnline || st === 'running',
          kind: 'android-avd',
        });
        seen.add(avd.name);
      }
    }

    return result;
  }

  // Run lifecycle & state
  runId = $state<number | null>(null);
  state = $state<AppState>('stopped');
  uiState = $state<RunUiState>('idle');
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
  private unlistenDeviceReady: UnlistenFn | null = null;
  private unlistenGradleDaemon: UnlistenFn | null = null;
  private initialized = false;
  private isWatchingDevices = false;
  private initPromise: Promise<void> | null = null;
  private currentInitFolder: string | null = null;

  async init(folderPath: string): Promise<void> {
    if (!folderPath) return;
    if (this.currentInitFolder === folderPath && this.initPromise) {
      return this.initPromise;
    }
    this.currentInitFolder = folderPath;
    this.root = folderPath;

    this.initPromise = (async () => {
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

      // Load devices & start watch (only watch once)
      try {
        if (!this.isWatchingDevices) {
          this.isWatchingDevices = true;
          await api.devicesWatch();
        }
        const snap = await api.devicesSnapshot();
        if (snap) {
          this.updateSnapshot(snap);
        } else {
          const list = await api.devicesList();
          this.updateDevices(list);
        }
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
          this.unlistenDevices = await api.onDevicesChanged((payload: any) => {
            if (payload && (payload.emulators || payload.physical)) {
              this.updateSnapshot(payload as DevicesSnapshot);
            } else if (Array.isArray(payload)) {
              this.updateDevices(payload);
            }
          });
        } catch (e) {
          console.warn('[runStore] Failed to listen to devices-changed:', e);
        }

        try {
          this.unlistenDeviceReady = await api.onDeviceReady((ready) => {
            if (ready?.id) {
              this.selectDevice(ready.id);
              // Auto-open mirror on device-ready
              import('../mirror/mirrorStore.svelte').then((m) => {
                m.mirrorStore.open(ready.id).catch(() => {});
              });
            }
          });
        } catch (e) {
          console.warn('[runStore] Failed to listen to device-ready:', e);
        }

        try {
          this.unlistenGradleDaemon = await api.onGradleDaemon((payload) => {
            this.gradleDaemon = payload.running;
          });
        } catch (e) {
          console.warn('[runStore] Failed to listen to gradle-daemon:', e);
        }

        try {
          await api.onEmulatorStatus((event) => {
            this.handleEmulatorStatus(event);
          });
        } catch (e) {
          console.warn('[runStore] Failed to listen to emulator-status:', e);
        }
      }
    })();

    return this.initPromise;
  }

  updateSnapshot(snap: DevicesSnapshot) {
    this.snapshot = snap;
    if (snap?.emulators) {
      const next = { ...this.emulatorStatuses };
      let changed = false;
      for (const emu of snap.emulators) {
        if (emu.state === 'running') {
          if (emu.id && next[emu.id]?.state === 'booting') {
            delete next[emu.id];
            changed = true;
          }
          if (emu.name && next[emu.name]?.state === 'booting') {
            delete next[emu.name];
            changed = true;
          }
          if (emu.deviceId && next[emu.deviceId]?.state === 'booting') {
            delete next[emu.deviceId];
            changed = true;
          }
        }
      }
      if (changed) {
        this.emulatorStatuses = next;
      }
    }
    const devs: Device[] = [];
    for (const emu of snap.emulators || []) {
      if (emu.state === 'running' || emu.state === 'booting') {
        devs.push({
          id: emu.deviceId || emu.id,
          name: emu.name,
          platform: emu.kind === 'ios-sim' ? 'ios' : 'android',
          kind: 'emulator',
          state: emu.state === 'running' ? 'online' : 'booting',
          sdk: emu.sdk,
        });
      }
    }
    for (const phys of snap.physical || []) {
      if (phys.state !== 'offline') {
        devs.push({
          id: phys.id,
          name: phys.name,
          platform: phys.platform,
          kind: 'physical',
          state: 'online',
          sdk: phys.sdk,
        });
      }
    }
    this.updateDevices(devs);
  }

  updateDevices(list: Device[]) {
    this.devices = list || [];
    this.emulatorStatuses = clearBootingForOnline(this.emulatorStatuses, this.devices);
    this.selectedDeviceId = pruneDeviceSelection(this.selectedDeviceId, this.devices);
  }

  async refreshDevices() {
    try {
      const list = await api.devicesRefresh();
      if (Array.isArray(list)) {
        this.updateDevices(list as any);
      }
    } catch {
      try {
        const snap = await api.devicesSnapshot();
        if (snap) {
          this.updateSnapshot(snap);
        } else {
          const list = await api.devicesList();
          this.updateDevices(list);
        }
      } catch {}
    }
  }

  async restartDaemon() {
    this.uiState = 'idle';
    this.state = 'stopped';
    this.runId = null;
    this.pid = null;
    try {
      await api.runRestartDaemon();
    } catch (e) {
      console.warn('[runStore] Failed to restart daemon:', e);
    }
    await this.refreshDevices();
  }

  async restartConnection() {
    this.uiState = 'idle';
    this.state = 'stopped';
    this.runId = null;
    this.pid = null;
    try {
      await api.runRestartConnection();
    } catch (e) {
      console.warn('[runStore] Failed to restart connection:', e);
    }
    await this.refreshDevices();
  }

  async hotRestart() {
    return this.reload(true);
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
      this.uiState = 'running';
      const devId = this.selectedDeviceId;
      if (devId) {
        api.logcatStart(devId, this.appId || undefined).catch((e) => {
          console.warn('[runStore] Failed to auto-start logcat:', e);
        });
      }
    } else if (event.type === 'state') {
      if (event.state === 'running') {
        this.uiState = 'running';
      } else if (event.state === 'stopped') {
        this.uiState = this.buildErrors.length > 0 ? 'error' : 'idle';
        this.runId = null;
        this.pid = null;
        api.logcatStop().catch(() => {});
      } else if (event.state === 'building' || event.state === 'installing') {
        this.uiState = 'starting';
      }
    } else if (event.type === 'buildError') {
      this.uiState = 'error';
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

  async saveConfigs(file: RunConfigFile) {
    this.configs = file.configs;
    if (file.selected) {
      this.selectedConfigName = file.selected;
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
    if (device.state !== 'online') {
      console.warn('[runStore] Cannot run on offline device:', device.id);
      return;
    }

    this.isStarting = true;
    this.uiState = 'starting';
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
      this.uiState = 'error';
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
    this.uiState = 'idle';
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
      this.uiState = 'idle';
      this.runId = null;
      this.pid = null;
      api.logcatStop().catch(() => {});
    }
  }

  resetLogs() {
    this.outputLines = [];
    this.buildErrors = [];
    this.uiState = 'idle';
    this.state = 'stopped';
    this.runId = null;
    this.pid = null;
  }

  handleEmulatorStatus(event: any) {
    if (!event || !event.id) return;
    this.emulatorStatuses = {
      ...this.emulatorStatuses,
      [event.id]: { state: event.state, error: event.error },
    };
    if (event.state === 'running') {
      this.stopAutoPolling();
      this.refreshDevices().then(() => {
        this.selectDevice(event.id);
      }).catch(() => {});
    } else if (event.state === 'failed') {
      this.stopAutoPolling();
      if (event.error) {
        import('../toolchain/toolchainStore.svelte').then((m) => {
          m.toolchainStore.showToast(`Emulator "${event.id}" failed: ${event.error?.slice(0, 120)}`);
        }).catch(() => {});
      }
    }
  }

  private autoPollTimer: any = null;

  startAutoPolling(name: string) {
    if (this.autoPollTimer) {
      clearInterval(this.autoPollTimer);
      this.autoPollTimer = null;
    }
    this.autoPollTimer = setInterval(async () => {
      await this.refreshDevices();
      const status = this.emulatorStatuses[name];
      const onlineDev = this.devices.find(
        (d) => (d.name === name || d.id === name || (status as any)?.deviceId === d.id) && d.state === 'online'
      );
      if (onlineDev || status?.state === 'running' || status?.state === 'failed') {
        this.stopAutoPolling();
        if (onlineDev) {
          const next = { ...this.emulatorStatuses };
          let changed = false;
          if (next[name]?.state === 'booting') {
            delete next[name];
            changed = true;
          }
          if (onlineDev.id && next[onlineDev.id]?.state === 'booting') {
            delete next[onlineDev.id];
            changed = true;
          }
          if (onlineDev.name && next[onlineDev.name]?.state === 'booting') {
            delete next[onlineDev.name];
            changed = true;
          }
          if (changed) {
            this.emulatorStatuses = next;
          }
          if (this.snapshot?.emulators) {
            const emu = this.snapshot.emulators.find(
              (e) => e.name === name || e.id === name || e.deviceId === onlineDev.id
            );
            if (emu && emu.state === 'booting') {
              emu.state = 'running';
            }
          }
          this.selectDevice(onlineDev.id);
        }
      }
    }, 2000);
  }

  stopAutoPolling() {
    if (this.autoPollTimer) {
      clearInterval(this.autoPollTimer);
      this.autoPollTimer = null;
    }
  }

  async avdStart(name: string, cold: boolean = false, wipeData: boolean = false, headless: boolean = true) {
    this.emulatorStatuses = {
      ...this.emulatorStatuses,
      [name]: { state: 'booting' },
    };
    const existingIdx = this.devices.findIndex((d) => d.name === name || d.id === name);
    if (existingIdx !== -1) {
      const nextDevices = [...this.devices];
      nextDevices[existingIdx] = {
        ...nextDevices[existingIdx],
        state: 'booting' as any,
      };
      this.devices = nextDevices;
    } else {
      this.devices = [
        ...this.devices,
        {
          id: name,
          name,
          platform: 'android',
          kind: 'emulator',
          state: 'booting' as any,
        },
      ];
    }
    if (this.snapshot?.emulators) {
      const emu = this.snapshot.emulators.find((e) => e.name === name || e.id === name);
      if (emu) {
        emu.state = 'booting';
      }
    }
    this.startAutoPolling(name);
    try {
      await api.avdStart(name, cold, wipeData, headless);
    } catch (e: any) {
      this.stopAutoPolling();
      const errMsg = e?.message || (typeof e === 'string' ? e : 'Failed to start AVD');
      this.emulatorStatuses = {
        ...this.emulatorStatuses,
        [name]: { state: 'failed', error: errMsg },
      };
      this.devices = this.devices.filter((d) => d.id !== name || (d.state as string) !== 'booting');
      import('../toolchain/toolchainStore.svelte').then((m) => {
        m.toolchainStore.showToast(`AVD "${name}" failed: ${errMsg}`);
      }).catch(() => {});
      throw e;
    }
  }

  async avdStop(name: string) {
    try {
      await api.avdStop(name);
      this.emulatorStatuses = {
        ...this.emulatorStatuses,
        [name]: { state: 'stopped' },
      };
      import('../mirror/mirrorStore.svelte').then((m) => {
        if (m.mirrorStore.serial === name || (m.mirrorStore as any).activeRunSerial === name) {
          m.mirrorStore.stop().catch(() => {});
        }
      }).catch(() => {});
      await this.refreshDevices();
    } catch (e: any) {
      console.error('[runStore] Failed to stop AVD:', e);
      throw e;
    }
  }

  async simBoot(udid: string) {
    this.emulatorStatuses = {
      ...this.emulatorStatuses,
      [udid]: { state: 'booting' },
    };
    try {
      await api.simBoot(udid);
    } catch (e: any) {
      const errMsg = e?.message || (typeof e === 'string' ? e : 'Failed to boot simulator');
      this.emulatorStatuses = {
        ...this.emulatorStatuses,
        [udid]: { state: 'failed', error: errMsg },
      };
      import('../toolchain/toolchainStore.svelte').then((m) => {
        m.toolchainStore.showToast(`Simulator "${udid}" failed: ${errMsg}`);
      }).catch(() => {});
      throw e;
    }
  }

  async simShutdown(udid: string) {
    try {
      await api.simShutdown(udid);
      this.emulatorStatuses = {
        ...this.emulatorStatuses,
        [udid]: { state: 'stopped' },
      };
      await this.refreshDevices();
    } catch (e: any) {
      console.error('[runStore] Failed to shutdown simulator:', e);
      throw e;
    }
  }

  async startEmulator(avdName: string) {
    return this.avdStart(avdName, false);
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
    this.isWatchingDevices = false;
    this.initPromise = null;
    this.currentInitFolder = null;
  }
}

export const runStore = new RunStore();

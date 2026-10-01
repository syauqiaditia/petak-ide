import { api, type Toolchain, type ToolchainConfig, type LspStatusPayload } from '../../lib/api';

export interface LspState {
  lang: string;
  root: string;
  state: 'starting' | 'ready' | 'stopped' | 'crashed' | 'failed' | 'indexing';
  reason?: string | null;
}

export interface ToastInfo {
  message: string;
  actionText?: string;
  onAction?: () => void;
}

class ToolchainStore {
  toolchain = $state<Toolchain | null>(null);
  config = $state<ToolchainConfig>({});
  loading = $state(false);
  lspStates = $state<Record<string, LspState>>({});
  toast = $state<ToastInfo | null>(null);
  settingsModalOpen = $state(false);

  private unlistenStatus: (() => void) | null = null;
  private toastedFailures = new Set<string>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  async init(root?: string) {
    if (!this.unlistenStatus) {
      this.unlistenStatus = await api.onLspStatus((payload: LspStatusPayload) => {
        this.handleLspStatus(payload);
      });
    }
    await this.loadConfig();
    await this.refresh(root || '');
  }

  handleLspStatus(payload: LspStatusPayload) {
    this.lspStates[payload.lang] = {
      lang: payload.lang,
      root: payload.root,
      state: payload.state,
      reason: payload.reason,
    };

    if (payload.state === 'failed' || payload.state === 'crashed') {
      const key = `${payload.lang}:${payload.reason || 'failed'}`;
      if (!this.toastedFailures.has(key)) {
        this.toastedFailures.add(key);
        const reasonStr = payload.reason || `${payload.lang} LSP failed to start`;
        this.showToast(`${payload.lang.toUpperCase()} LSP error: ${reasonStr}`, 'Open Settings', () => {
          this.settingsModalOpen = true;
        });
      }
    } else if (payload.state === 'ready') {
      for (const k of Array.from(this.toastedFailures)) {
        if (k.startsWith(`${payload.lang}:`)) {
          this.toastedFailures.delete(k);
        }
      }
    }
  }

  showToast(message: string, actionText?: string, onAction?: () => void) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = { message, actionText, onAction };
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
    }, 7000);
  }

  clearToast() {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = null;
    this.toastTimer = null;
  }

  async loadConfig() {
    try {
      this.config = await api.toolchainGetConfig();
    } catch (e) {
      console.warn('Failed to load toolchain config', e);
    }
  }

  async saveConfig(newConfig: ToolchainConfig, currentRoot?: string) {
    try {
      await api.toolchainSaveConfig(newConfig);
      this.config = newConfig;
      if (currentRoot) {
        await this.refresh(currentRoot);
      }
    } catch (e) {
      console.error('Failed to save toolchain config', e);
    }
  }

  async refresh(root: string) {
    this.loading = true;
    try {
      this.toolchain = await api.toolchainDetect(root);
    } catch (e) {
      console.error('Failed to detect toolchain', e);
    } finally {
      this.loading = false;
    }
  }

  get currentLspSummary(): { state: 'ready' | 'starting' | 'failed' | 'idle'; label: string; details?: string } {
    const entries = Object.values(this.lspStates);
    if (entries.length === 0) {
      return { state: 'idle', label: 'LSP: Idle' };
    }
    const failed = entries.find((e) => e.state === 'failed' || e.state === 'crashed');
    if (failed) {
      return {
        state: 'failed',
        label: `${failed.lang.toUpperCase()} LSP: Failed`,
        details: failed.reason || undefined,
      };
    }
    const starting = entries.find((e) => e.state === 'starting');
    if (starting) {
      return { state: 'starting', label: `${starting.lang.toUpperCase()} LSP: Starting…` };
    }
    const ready = entries.find((e) => e.state === 'ready');
    if (ready) {
      return { state: 'ready', label: `${ready.lang.toUpperCase()} LSP: Ready` };
    }
    return { state: 'idle', label: 'LSP: Ready' };
  }
}

export const toolchainStore = new ToolchainStore();

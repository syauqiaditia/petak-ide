import { api, type Flow, type FlowStep, type FlowStepStatusKind, type FlowRunResult } from '../../lib/api.ts';

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  appId?: string;
  tags: string[];
  steps: FlowStep[];
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'login-flow-template',
    name: 'Login Flow',
    description: 'Automasi pengujian form autentikasi login (username, password, submit, verifikasi dashboard)',
    appId: 'com.example.app',
    tags: ['auth', 'smoke'],
    steps: [
      { id: 'step-1', action: 'launch', description: 'Buka aplikasi', timeoutMs: 10000 },
      { id: 'step-2', action: 'input', selector: '#input-username', text: 'user@example.com', description: 'Masukkan username' },
      { id: 'step-3', action: 'input', selector: '#input-password', text: 'SecretPassword123!', description: 'Masukkan password' },
      { id: 'step-4', action: 'tap', selector: '#btn-login', description: 'Tekan tombol Login' },
      { id: 'step-5', action: 'assert_visible', selector: '#home-dashboard', description: 'Verifikasi tampilan dashboard utama' },
    ],
  },
  {
    id: 'navigation-flow-template',
    name: 'Navigation Flow',
    description: 'Pengujian alur navigasi halaman, perpindahan tab, dan penekanan tombol back',
    appId: 'com.example.app',
    tags: ['navigation', 'regression'],
    steps: [
      { id: 'step-1', action: 'launch', description: 'Buka aplikasi', timeoutMs: 10000 },
      { id: 'step-2', action: 'tap', selector: '#tab-settings', description: 'Pindah ke tab Settings' },
      { id: 'step-3', action: 'tap', selector: '#item-profile', description: 'Buka menu Profil' },
      { id: 'step-4', action: 'back', description: 'Kembali dengan tombol back' },
      { id: 'step-5', action: 'assert_visible', selector: '#tab-home', description: 'Verifikasi kembali ke halaman awal' },
    ],
  },
];

export function formatStepStatusIcon(status: FlowStepStatusKind | string | undefined | null): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'running':
      return '🔄';
    case 'passed':
      return '✅';
    case 'failed':
      return '❌';
    case 'skipped':
      return '⏭️';
    default:
      return '⏳';
  }
}

export function formatStepStatusLabel(status: FlowStepStatusKind | string | undefined | null): string {
  switch (status) {
    case 'pending':
      return 'Menunggu';
    case 'running':
      return 'Berjalan';
    case 'passed':
      return 'Lolos';
    case 'failed':
      return 'Gagal';
    case 'skipped':
      return 'Dilewati';
    default:
      return 'Menunggu';
  }
}

export function formatDuration(durationMs?: number | null): string {
  if (durationMs == null || durationMs <= 0) {
    return '0ms';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function calculatePassRate(passedSteps: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.round((passedSteps / totalSteps) * 100);
}

export function formatPassRate(passedSteps: number, totalSteps: number): string {
  return `${calculatePassRate(passedSteps, totalSteps)}%`;
}

export function filterFlows(flows: Flow[], query: string): Flow[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return flows;
  return flows.filter((f) => {
    const matchName = f.name?.toLowerCase().includes(q);
    const matchDesc = f.description?.toLowerCase().includes(q);
    const matchApp = f.appId?.toLowerCase().includes(q);
    const matchTags = (f.tags || []).some((t) => t.toLowerCase().includes(q));
    return matchName || matchDesc || matchApp || matchTags;
  });
}

/** Pure store logic without Svelte runes for unit testing */
export class TestStoreLogic {
  flows: Flow[] = [];
  selectedFlow: Flow | null = null;
  isRunning: boolean = false;
  activeRunResult: FlowRunResult | null = null;
  searchQuery: string = '';
  currentRoot: string = '';

  get filteredFlows(): Flow[] {
    return filterFlows(this.flows, this.searchQuery);
  }

  async loadFlows(root?: string, apiInstance = api) {
    if (root !== undefined) this.currentRoot = root;
    try {
      this.flows = await apiInstance.testListFlows(this.currentRoot || undefined);
      if (this.selectedFlow) {
        const found = this.flows.find((f) => f.id === this.selectedFlow?.id);
        this.selectedFlow = found || (this.flows.length > 0 ? this.flows[0] : null);
      } else if (this.flows.length > 0) {
        this.selectedFlow = this.flows[0];
      }
    } catch (err) {
      console.error('Failed to load test flows:', err);
    }
  }

  selectFlow(flow: Flow | null) {
    this.selectedFlow = flow;
  }

  async runFlow(flowId: string, deviceSerial?: string, root?: string, apiInstance = api): Promise<FlowRunResult | null> {
    this.isRunning = true;
    const targetRoot = root !== undefined ? root : this.currentRoot;
    try {
      const result = await apiInstance.testRunFlow(flowId, deviceSerial || undefined, targetRoot || undefined);
      this.activeRunResult = result;
      return result;
    } catch (err: any) {
      console.error('Failed to run flow:', err);
      const errorResult: FlowRunResult = {
        flowId,
        success: false,
        totalSteps: 0,
        passedSteps: 0,
        failedSteps: 1,
        durationMs: 0,
        runner: 'unknown',
        stepResults: [],
        error: err?.message || String(err),
      };
      this.activeRunResult = errorResult;
      return errorResult;
    } finally {
      this.isRunning = false;
    }
  }

  async cancelFlow(flowId: string, apiInstance = api): Promise<boolean> {
    try {
      const ok = await apiInstance.testCancelFlow(flowId);
      this.isRunning = false;
      return ok;
    } catch (err) {
      console.error('Failed to cancel flow:', err);
      return false;
    }
  }

  async createFlow(name: string, appId?: string, steps: FlowStep[] = [], root?: string, apiInstance = api): Promise<Flow> {
    const targetRoot = root !== undefined ? root : this.currentRoot;
    try {
      const newFlow = await apiInstance.testCreateFlow(name, appId || undefined, steps, targetRoot || undefined);
      this.flows = [...this.flows, newFlow];
      this.selectedFlow = newFlow;
      return newFlow;
    } catch (err) {
      console.error('Failed to create flow:', err);
      throw err;
    }
  }
}

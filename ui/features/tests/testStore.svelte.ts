import { api, type Flow, type FlowStep, type FlowRunResult } from '../../lib/api.ts';
import {
  TestStoreLogic,
  FLOW_TEMPLATES,
  formatStepStatusIcon,
  formatStepStatusLabel,
  formatDuration,
  calculatePassRate,
  formatPassRate,
  filterFlows,
} from './testLogic';

export class TestStore {
  flows = $state<Flow[]>([]);
  selectedFlow = $state<Flow | null>(null);
  isRunning = $state<boolean>(false);
  activeRunResult = $state<FlowRunResult | null>(null);
  searchQuery = $state<string>('');
  currentRoot = $state<string>('');

  filteredFlows = $derived(filterFlows(this.flows, this.searchQuery));

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

export const testStore = new TestStore();
export {
  FLOW_TEMPLATES,
  formatStepStatusIcon,
  formatStepStatusLabel,
  formatDuration,
  calculatePassRate,
  formatPassRate,
  filterFlows,
  TestStoreLogic,
};

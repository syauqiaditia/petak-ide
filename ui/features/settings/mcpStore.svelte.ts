import { api, type McpConfig, type McpServerConfig, type McpTestResult } from '../../lib/api';
import {
  calculateActiveMcpCount,
  formatMcpTestResult,
  formatMcpPillLabel,
  parseArgsString,
  formatArgsString,
  parseEnvEntries,
  buildEnvRecord,
  MCP_PRESETS,
  type McpPreset,
} from './mcpLogic';

export class McpStore {
  config = $state<McpConfig>({ mcpServers: {} });
  isLoading = $state<boolean>(false);
  isTesting = $state<Record<string, boolean>>({});
  testResults = $state<Record<string, McpTestResult>>({});
  currentRoot = $state<string>('');

  activeCount = $derived(calculateActiveMcpCount(this.config));

  async loadConfig(root?: string) {
    if (root !== undefined) {
      this.currentRoot = root;
    }
    this.isLoading = true;
    try {
      this.config = await api.agentMcpGetConfig(this.currentRoot || undefined);
    } catch (err) {
      console.error('Failed to load MCP config:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async saveConfig(root?: string) {
    const target = root !== undefined ? root : this.currentRoot;
    try {
      await api.agentMcpSaveConfig(this.config, target || undefined);
    } catch (err) {
      console.error('Failed to save MCP config:', err);
      throw err;
    }
  }

  async toggleServer(name: string, root?: string) {
    const srv = this.config.mcpServers?.[name];
    if (!srv) return;
    srv.disabled = !srv.disabled;
    this.config = {
      ...this.config,
      mcpServers: { ...this.config.mcpServers },
    };
    await this.saveConfig(root);
  }

  async addOrUpdateServer(name: string, server: McpServerConfig, root?: string) {
    if (!this.config.mcpServers) {
      this.config.mcpServers = {};
    }
    this.config = {
      ...this.config,
      mcpServers: {
        ...this.config.mcpServers,
        [name]: server,
      },
    };
    await this.saveConfig(root);
  }

  async removeServer(name: string, root?: string) {
    if (!this.config.mcpServers?.[name]) return;
    const updated = { ...this.config.mcpServers };
    delete updated[name];
    this.config = {
      ...this.config,
      mcpServers: updated,
    };
    if (this.testResults[name]) {
      const res = { ...this.testResults };
      delete res[name];
      this.testResults = res;
    }
    await this.saveConfig(root);
  }

  async testServer(name: string): Promise<McpTestResult | undefined> {
    const srv = this.config.mcpServers?.[name];
    if (!srv) return;
    this.isTesting = { ...this.isTesting, [name]: true };
    try {
      const res = await api.agentMcpTestServer(srv.command, srv.args || [], srv.env || {});
      this.testResults = { ...this.testResults, [name]: res };
      return res;
    } catch (err: any) {
      const errRes: McpTestResult = { ok: false, error: err?.message || String(err) };
      this.testResults = { ...this.testResults, [name]: errRes };
      return errRes;
    } finally {
      this.isTesting = { ...this.isTesting, [name]: false };
    }
  }
}

export const mcpStore = new McpStore();
export {
  calculateActiveMcpCount,
  formatMcpTestResult,
  formatMcpPillLabel,
  parseArgsString,
  formatArgsString,
  parseEnvEntries,
  buildEnvRecord,
  MCP_PRESETS,
  type McpPreset,
};

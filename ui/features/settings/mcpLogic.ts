import { api, type McpConfig, type McpServerConfig, type McpTestResult } from '../../lib/api.ts';

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  config: McpServerConfig;
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Akses berkas lokal workspace via stdio MCP (@modelcontextprotocol/server-filesystem)',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      env: {},
      disabled: false,
      autoApprove: ['read_file', 'list_directory'],
    },
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Knowledge graph & persistensi entitas memori (@modelcontextprotocol/server-memory)',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      disabled: false,
      autoApprove: ['create_entities', 'read_graph'],
    },
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Integrasi GitLab untuk issue, MR, dan CI/CD (@modelcontextprotocol/server-gitlab)',
    config: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gitlab'],
      env: {
        GITLAB_PERSONAL_ACCESS_TOKEN: '',
        GITLAB_API_URL: 'https://gitlab.com/api/v4',
      },
      disabled: false,
      autoApprove: [],
    },
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Kueri dan inspeksi basis data SQLite lokal via uvx (mcp-server-sqlite)',
    config: {
      command: 'uvx',
      args: ['mcp-server-sqlite', '--db-path', './data.db'],
      env: {},
      disabled: false,
      autoApprove: ['read_query'],
    },
  },
  {
    id: 'mobile-mcp',
    name: 'Mobile MCP',
    description: 'Mobile device automation & testing tools via MCP (@mobilenext/mobile-mcp)',
    config: {
      command: 'npx',
      args: ['-y', '@mobilenext/mobile-mcp'],
      env: {},
      disabled: false,
      autoApprove: ['mobile_tap', 'mobile_screenshot', 'mobile_input'],
    },
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Template kosong untuk server MCP khusus (stdio)',
    config: {
      command: '',
      args: [],
      env: {},
      disabled: false,
      autoApprove: [],
    },
  },
];

export function calculateActiveMcpCount(config: McpConfig | null | undefined): number {
  if (!config || !config.mcpServers) return 0;
  return Object.values(config.mcpServers).filter((srv) => !srv.disabled).length;
}

export function formatMcpTestResult(result: McpTestResult | null | undefined): {
  status: 'ok' | 'error' | 'idle';
  label: string;
} {
  if (!result) {
    return { status: 'idle', label: '' };
  }
  if (result.ok) {
    const latency = result.latencyMs != null ? `${result.latencyMs}ms` : 'OK';
    const info = result.serverInfo ? ` (${result.serverInfo})` : '';
    return { status: 'ok', label: `Online: ${latency}${info}` };
  }
  return { status: 'error', label: result.error || 'Koneksi gagal' };
}

export function formatMcpPillLabel(activeCount: number): string {
  return activeCount > 0 ? `MCP (${activeCount})` : 'MCP (Off)';
}

export function parseArgsString(str: string): string[] {
  const trimmed = str.trim();
  if (!trimmed) return [];
  // Parse space-separated or quoted tokens
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }
  return tokens;
}

export function formatArgsString(args: string[] | undefined): string {
  if (!args || args.length === 0) return '';
  return args.join(' ');
}

export function parseEnvEntries(env: Record<string, string> | undefined): Array<{ key: string; value: string }> {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

export function buildEnvRecord(entries: Array<{ key: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of entries) {
    const trimmedKey = item.key.trim();
    if (trimmedKey) {
      result[trimmedKey] = item.value;
    }
  }
  return result;
}

/** Pure store logic without Svelte runes for unit testing */
export class McpStoreLogic {
  config: McpConfig = { mcpServers: {} };
  isLoading: boolean = false;
  isTesting: Record<string, boolean> = {};
  testResults: Record<string, McpTestResult> = {};
  currentRoot: string = '';

  get activeCount(): number {
    return calculateActiveMcpCount(this.config);
  }

  async loadConfig(root?: string, apiInstance = api) {
    if (root !== undefined) this.currentRoot = root;
    this.isLoading = true;
    try {
      this.config = await apiInstance.agentMcpGetConfig(this.currentRoot || undefined);
    } finally {
      this.isLoading = false;
    }
  }

  async saveConfig(root?: string, apiInstance = api) {
    const target = root !== undefined ? root : this.currentRoot;
    await apiInstance.agentMcpSaveConfig(this.config, target || undefined);
  }

  async toggleServer(name: string, root?: string, apiInstance = api) {
    const srv = this.config.mcpServers?.[name];
    if (!srv) return;
    srv.disabled = !srv.disabled;
    this.config = { ...this.config, mcpServers: { ...this.config.mcpServers } };
    await this.saveConfig(root, apiInstance);
  }

  async addOrUpdateServer(name: string, server: McpServerConfig, root?: string, apiInstance = api) {
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
    await this.saveConfig(root, apiInstance);
  }

  async removeServer(name: string, root?: string, apiInstance = api) {
    if (!this.config.mcpServers?.[name]) return;
    const updated = { ...this.config.mcpServers };
    delete updated[name];
    this.config = { ...this.config, mcpServers: updated };
    if (this.testResults[name]) {
      const res = { ...this.testResults };
      delete res[name];
      this.testResults = res;
    }
    await this.saveConfig(root, apiInstance);
  }

  async testServer(name: string, apiInstance = api): Promise<McpTestResult | undefined> {
    const srv = this.config.mcpServers?.[name];
    if (!srv) return;
    this.isTesting = { ...this.isTesting, [name]: true };
    try {
      const res = await apiInstance.agentMcpTestServer(srv.command, srv.args || [], srv.env || {});
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: ACP Approval Dialog & PermissionModal.svelte Verification
// =============================================================================

test('b37 ACP Approval 1: PermissionModal.svelte exists and implements Allow / Deny dialog contracts', () => {
  const modalPath = path.resolve(uiRoot, 'features/agents/PermissionModal.svelte');
  assert.ok(fs.existsSync(modalPath), 'PermissionModal.svelte must exist');

  const modalSrc = fs.readFileSync(modalPath, 'utf8');

  // Verify modal backdrop and dialog elements
  assert.ok(
    modalSrc.includes('class="perm-modal-backdrop"'),
    'PermissionModal must declare modal backdrop'
  );
  assert.ok(
    modalSrc.includes('class="perm-modal"'),
    'PermissionModal must declare dialog window'
  );

  // Verify tool name and command display
  assert.ok(
    modalSrc.includes('class="perm-tool-name"') || modalSrc.includes('toolName'),
    'PermissionModal must display tool name'
  );
  assert.ok(
    modalSrc.includes('class="perm-cmd-box"'),
    'PermissionModal must declare code box for command / arguments'
  );

  // Verify Allow / Deny actions calling api.agentRespondPermission
  assert.ok(
    modalSrc.includes('class="perm-btn perm-btn-allow"') || modalSrc.includes('perm-btn-allow'),
    'PermissionModal must have Allow button'
  );
  assert.ok(
    modalSrc.includes('class="perm-btn perm-btn-deny"') || modalSrc.includes('perm-btn-deny'),
    'PermissionModal must have Deny button'
  );
  assert.ok(
    modalSrc.includes('api.agentRespondPermission(reqId, true)') ||
      modalSrc.includes('api.agentRespondPermission'),
    'PermissionModal must invoke api.agentRespondPermission'
  );
  assert.ok(
    modalSrc.includes('agentsStore.respondPermission'),
    'PermissionModal must update agentsStore state'
  );
});

test('b37 ACP Approval 2: AgentChat.svelte mounts PermissionModal and keeps responsive in-chat card', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf8');

  assert.ok(
    chatSrc.includes("import PermissionModal from './PermissionModal.svelte'"),
    'AgentChat.svelte must import PermissionModal'
  );
  assert.ok(
    chatSrc.includes('<PermissionModal'),
    'AgentChat.svelte must mount <PermissionModal />'
  );
  assert.ok(
    chatSrc.includes('pendingPerm'),
    'AgentChat.svelte must retain pendingPerm reactive state'
  );
});

test('b37 ACP Approval 3: api.ts declares agentRespondPermission and agentListPendingPermissions', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiSrc = fs.readFileSync(apiPath, 'utf8');

  assert.ok(
    apiSrc.includes('agentRespondPermission(requestId: string, allow: boolean): Promise<void>'),
    'api.ts must declare agentRespondPermission binding'
  );
  assert.ok(
    apiSrc.includes('agentListPendingPermissions(): Promise<PendingPermissionRequest[]>'),
    'api.ts must declare agentListPendingPermissions binding'
  );
});

// =============================================================================
// Suite 2: Spacing Tombol Stop Petak Agent & Overflow Guard
// =============================================================================

test('b37 Stop Spacing 1: AgentChat.svelte defines responsive stop button & pills spacing', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf8');

  // Verify pills-right declares padding-right: 6px and flex-shrink: 0
  assert.ok(
    chatSrc.includes('.pills-right {') &&
      chatSrc.includes('padding-right: 6px;') &&
      chatSrc.includes('flex-shrink: 0;'),
    '.pills-right must have padding-right: 6px and flex-shrink: 0'
  );

  // Verify cancel-prompt-btn declares flex-shrink: 0 and proportional padding
  assert.ok(
    chatSrc.includes('.cancel-prompt-btn {') &&
      chatSrc.includes('padding-right: 6px;') &&
      chatSrc.includes('flex-shrink: 0;'),
    '.cancel-prompt-btn must have padding-right: 6px and flex-shrink: 0'
  );

  // Verify composer-pills-row defines overflow: hidden guard
  assert.ok(
    chatSrc.includes('.composer-pills-row {') &&
      chatSrc.includes('overflow: hidden;') &&
      chatSrc.includes('box-sizing: border-box;'),
    '.composer-pills-row must define overflow: hidden guard and border-box'
  );

  // Verify pills-left has min-width: 0 and flex: 1 1 auto for narrow panels
  assert.ok(
    chatSrc.includes('.pills-left {') &&
      chatSrc.includes('min-width: 0;') &&
      chatSrc.includes('flex: 1 1 auto;'),
    '.pills-left must have min-width: 0 and flex: 1 1 auto'
  );
});

// =============================================================================
// Suite 3: LSP Smoothness & Latency Tuning
// =============================================================================

test('b37 LSP Latency 1: sync.ts reduces debounce to 15ms for responsive incremental synchronization', () => {
  const syncPath = path.resolve(uiRoot, 'features/editor/lsp/sync.ts');
  const syncSrc = fs.readFileSync(syncPath, 'utf8');

  assert.ok(
    syncSrc.includes('debounces ~15ms'),
    'sync.ts doc comment must indicate 15ms debounce'
  );
  assert.ok(
    syncSrc.includes('}, 15);'),
    'sync.ts setTimeout must use 15ms debounce interval'
  );
  assert.ok(
    !syncSrc.includes('}, 50);'),
    'sync.ts must no longer use 50ms debounce interval'
  );
});

// =============================================================================
// Suite 4: Persistensi Chat & Referensi (petak_active_chat_history_v1)
// =============================================================================

test('b37 Chat Persistence 1: agents.svelte.ts defines storage key petak_active_chat_history_v1 and methods', () => {
  const agentsPath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const agentsSrc = fs.readFileSync(agentsPath, 'utf8');

  assert.ok(
    agentsSrc.includes('petak_active_chat_history_v1'),
    'agents.svelte.ts must use petak_active_chat_history_v1 storage key'
  );
  assert.ok(
    agentsSrc.includes('loadActiveChatHistory()'),
    'agents.svelte.ts must define loadActiveChatHistory()'
  );
  assert.ok(
    agentsSrc.includes('persistActiveChatHistory()'),
    'agents.svelte.ts must define persistActiveChatHistory()'
  );
  assert.ok(
    agentsSrc.includes('activeFileReferences = $state<FileReference[]>([])'),
    'agents.svelte.ts must declare activeFileReferences state'
  );
  assert.ok(
    agentsSrc.includes('setFileReferences(') &&
      agentsSrc.includes('addFileReference(') &&
      agentsSrc.includes('removeFileReference(') &&
      agentsSrc.includes('clearFileReferences('),
    'agents.svelte.ts must provide file reference mutation methods'
  );
});

test('b37 Chat Persistence 2: roundtrip simulation of petak_active_chat_history_v1 payload', () => {
  const mockStorage = new Map();
  const STORAGE_KEY = 'petak_active_chat_history_v1';

  function saveHistory(chatHistory, fileReferences) {
    const payload = {
      chatHistory,
      fileReferences,
    };
    mockStorage.set(STORAGE_KEY, JSON.stringify(payload));
  }

  function loadHistory() {
    const raw = mockStorage.get(STORAGE_KEY);
    if (!raw) return { chatHistory: {}, fileReferences: [] };
    const parsed = JSON.parse(raw);
    return {
      chatHistory: parsed.chatHistory || {},
      fileReferences: parsed.fileReferences || [],
    };
  }

  // 1. Initial save with chat history and file references
  const initialHistory = {
    default: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Periksa error pada file auth',
        timestamp: 1728390000000,
        metadata: {
          fileReferences: [{ path: 'lib/auth/service.dart', line: 42 }],
        },
      },
      {
        id: 'msg-2',
        role: 'agent',
        content: 'Saya menemukan kesalahan tipe pada baris 42.',
        timestamp: 1728390005000,
      },
    ],
  };
  const initialRefs = [{ path: 'lib/auth/service.dart', line: 42 }];

  saveHistory(initialHistory, initialRefs);

  // 2. Load from storage (reopen simulation)
  const loaded = loadHistory();
  assert.deepEqual(loaded.chatHistory, initialHistory, 'Chat history must roundtrip exactly');
  assert.deepEqual(loaded.fileReferences, initialRefs, 'File references must roundtrip exactly');

  // 3. Verify message structure and metadata integrity
  const userMsg = loaded.chatHistory.default[0];
  assert.equal(userMsg.role, 'user');
  assert.equal(userMsg.metadata.fileReferences[0].path, 'lib/auth/service.dart');
  assert.equal(userMsg.metadata.fileReferences[0].line, 42);

  const agentMsg = loaded.chatHistory.default[1];
  assert.equal(agentMsg.role, 'agent');
  assert.ok(agentMsg.content.includes('kesalahan tipe'));
});

test('b37 Chat Persistence 3: loadSlots does not wipe out restored chat history', () => {
  const agentsPath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const agentsSrc = fs.readFileSync(agentsPath, 'utf8');

  // Must check Object.keys(this.chatHistory).length === 0 before applying DEMO_CHAT_MESSAGES
  assert.ok(
    agentsSrc.includes('if (Object.keys(this.chatHistory).length === 0)'),
    'loadSlots must guard demo chat population so persisted chatHistory is not overwritten'
  );
});

test('b37 Chat Persistence 4: AgentChat syncs fileReferences with agentsStore', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf8');

  assert.ok(
    chatSrc.includes('agentsStore.activeFileReferences = [...fileReferences];') ||
      chatSrc.includes('agentsStore.activeFileReferences = '),
    'AgentChat must synchronize activeFileReferences to agentsStore'
  );
  assert.ok(
    chatSrc.includes('agentsStore.persistActiveChatHistory()'),
    'AgentChat must trigger persistActiveChatHistory on reference mutation'
  );
});

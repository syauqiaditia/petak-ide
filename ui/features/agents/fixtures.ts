import type {
  SlotSummary,
  HermesDetectionResult,
  Proposal,
  PendingPermissionRequest,
  ChatMessage,
  UsageReport,
  TeamConfig,
} from './types';

export const DEMO_HERMES_DETECTION: HermesDetectionResult = {
  installed: true,
  path: '~/.local/bin/hermes',
  version: '0.8.2-phase5',
  check_ok: true,
  profiles: [
    {
      name: 'manager',
      model: 'claude-3-7-sonnet',
      is_active: false,
      kanban: { running: 0, ready: 1, blocked: 0 },
    },
    {
      name: 'techlead',
      model: 'claude-3-7-sonnet',
      is_active: true,
      kanban: { running: 0, ready: 1, blocked: 0 },
    },
    {
      name: 'senior',
      model: 'claude-3-7-sonnet',
      is_active: true,
      kanban: { running: 1, ready: 2, blocked: 0 },
    },
    {
      name: 'senior2',
      model: 'gemini-2.5-pro',
      is_active: false,
      kanban: { running: 0, ready: 1, blocked: 0 },
    },
    {
      name: 'reviewer',
      model: 'gemini-2.5-pro',
      is_active: false,
      kanban: { running: 0, ready: 0, blocked: 0 },
    },
    {
      name: 'designer',
      model: 'claude-3-7-sonnet',
      is_active: false,
      kanban: { running: 0, ready: 1, blocked: 1 },
    },
  ],
};

export const DEMO_TEAM_CONFIG: TeamConfig = {
  version: 1,
  slots: [
    {
      id: 's1',
      label: 'Manager',
      kind: 'hermes',
      command: null,
      hermesProfile: 'manager',
      model: 'claude-3-7-sonnet',
      fallbackModel: 'gemini-2.5-pro',
      permission: 'ask',
      cwd: 'project',
    },
    {
      id: 's2',
      label: 'Techlead',
      kind: 'claude-code',
      command: null,
      hermesProfile: 'techlead',
      model: 'claude-3-7-sonnet',
      fallbackModel: 'claude-3-5-sonnet',
      permission: 'ask',
      cwd: 'project',
    },
    {
      id: 's3',
      label: 'Senior',
      kind: 'hermes',
      command: null,
      hermesProfile: 'senior',
      model: 'claude-3-7-sonnet',
      fallbackModel: 'gemini-2.5-pro',
      permission: 'ask',
      cwd: 'project',
    },
    {
      id: 's4',
      label: 'Senior2',
      kind: 'hermes',
      command: null,
      hermesProfile: 'senior2',
      model: 'gemini-2.5-pro',
      fallbackModel: 'ollama:qwen2.5-coder:32b',
      permission: 'ask',
      cwd: 'project',
    },
    {
      id: 's5',
      label: 'Reviewer',
      kind: 'hermes',
      command: null,
      hermesProfile: 'reviewer',
      model: 'gemini-2.5-pro',
      fallbackModel: null,
      permission: 'auto',
      cwd: 'project',
    },
    {
      id: 's6',
      label: 'Designer',
      kind: 'hermes',
      command: null,
      hermesProfile: 'designer',
      model: 'claude-3-7-sonnet',
      fallbackModel: 'claude-3-5-haiku',
      permission: 'ask',
      cwd: 'project',
    },
  ],
};

export const DEMO_SLOTS: SlotSummary[] = [
  {
    id: 's1',
    label: 'Manager',
    kind: 'hermes',
    status: 'ready',
    session_id: 'sess-hermes-manager-1102',
    active_pid: 14101,
    capabilities: {
      load_session: true,
      supports_set_model: true,
      current_model: 'claude-3-7-sonnet',
      available_models: [
        { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', description: 'Planner model' },
      ],
      supports_usage: true,
    },
    history_len: 2,
    last_activity_secs_ago: 60,
    config: DEMO_TEAM_CONFIG.slots[0],
  },
  {
    id: 's2',
    label: 'Techlead',
    kind: 'claude-code',
    status: 'ready',
    session_id: 'sess-claude-9102',
    active_pid: 14209,
    capabilities: {
      load_session: true,
      supports_set_model: true,
      current_model: 'claude-3-7-sonnet',
      available_models: [
        { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', description: 'Primary model' },
        { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Fallback model' },
      ],
      supports_usage: true,
    },
    history_len: 4,
    last_activity_secs_ago: 12,
    config: DEMO_TEAM_CONFIG.slots[1],
  },
  {
    id: 's3',
    label: 'Senior',
    kind: 'hermes',
    status: 'busy',
    session_id: 'sess-hermes-senior-7719',
    active_pid: 15821,
    capabilities: {
      load_session: false,
      supports_set_model: false,
      current_model: 'claude-3-7-sonnet',
      available_models: [],
      supports_usage: true,
    },
    history_len: 5,
    last_activity_secs_ago: 2,
    config: DEMO_TEAM_CONFIG.slots[2],
  },
  {
    id: 's4',
    label: 'Senior2',
    kind: 'hermes',
    status: 'ready',
    session_id: 'sess-hermes-senior2-3302',
    active_pid: 15830,
    capabilities: {
      load_session: false,
      supports_set_model: false,
      current_model: 'gemini-2.5-pro',
      available_models: [],
      supports_usage: true,
    },
    history_len: 1,
    last_activity_secs_ago: 30,
    config: DEMO_TEAM_CONFIG.slots[3],
  },
  {
    id: 's5',
    label: 'Reviewer',
    kind: 'hermes',
    status: 'ready',
    session_id: 'sess-hermes-reviewer-4401',
    active_pid: null,
    capabilities: {
      load_session: false,
      supports_set_model: false,
      current_model: 'gemini-2.5-pro',
      available_models: [],
      supports_usage: true,
    },
    history_len: 0,
    last_activity_secs_ago: 420,
    config: DEMO_TEAM_CONFIG.slots[4],
  },
  {
    id: 's6',
    label: 'Designer',
    kind: 'hermes',
    status: 'ready',
    session_id: 'sess-hermes-designer-5501',
    active_pid: null,
    capabilities: {
      load_session: false,
      supports_set_model: false,
      current_model: 'claude-3-7-sonnet',
      available_models: [],
      supports_usage: true,
    },
    history_len: 0,
    last_activity_secs_ago: 500,
    config: DEMO_TEAM_CONFIG.slots[5],
  },
];

export const DEMO_PROPOSALS: Proposal[] = [
  {
    id: 'prop-101',
    slotId: 's1',
    sessionId: 'sess-claude-9102',
    path: 'lib/features/discount/discount_service.dart',
    oldContent: `double calculateDiscount(double price, double rate) {\n  return price * rate;\n}\n`,
    newContent: `double calculateDiscount(double price, double rate) {\n  if (price <= 0.0 || rate <= 0.0) return 0.0;\n  final normalizedRate = rate > 1.0 ? rate / 100.0 : rate;\n  return (price * normalizedRate).clamp(0.0, price);\n}\n`,
    status: 'pending',
    timestamp: Date.now() - 35000,
    hunks: [
      {
        old_start: 1,
        old_lines: 3,
        new_start: 1,
        new_lines: 5,
        lines: [
          { kind: 'context', text: 'double calculateDiscount(double price, double rate) {', old_lineno: 1, new_lineno: 1 },
          { kind: 'del', text: '  return price * rate;', old_lineno: 2, new_lineno: null },
          { kind: 'add', text: '  if (price <= 0.0 || rate <= 0.0) return 0.0;', old_lineno: null, new_lineno: 2 },
          { kind: 'add', text: '  final normalizedRate = rate > 1.0 ? rate / 100.0 : rate;', old_lineno: null, new_lineno: 3 },
          { kind: 'add', text: '  return (price * normalizedRate).clamp(0.0, price);', old_lineno: null, new_lineno: 4 },
          { kind: 'context', text: '}', old_lineno: 3, new_lineno: 5 },
        ],
      },
      {
        old_start: 12,
        old_lines: 2,
        new_start: 14,
        new_lines: 3,
        lines: [
          { kind: 'context', text: 'bool isValidVoucher(String code) {', old_lineno: 12, new_lineno: 14 },
          { kind: 'del', text: '  return code.isNotEmpty;', old_lineno: 13, new_lineno: null },
          { kind: 'add', text: '  return code.trim().length >= 4;', old_lineno: null, new_lineno: 15 },
          { kind: 'context', text: '}', old_lineno: 14, new_lineno: 16 },
        ],
      },
    ],
  },
];

export const DEMO_PENDING_PERMISSIONS: PendingPermissionRequest[] = [
  {
    requestId: 'perm-902',
    slotId: 's1',
    sessionId: 'sess-claude-9102',
    toolCall: {
      name: 'terminal',
      command: 'flutter test test/features/discount/discount_test.dart',
      args: { command: 'flutter test test/features/discount/discount_test.dart' },
      reason: 'Menjalankan unit test diskon untuk memverifikasi batas normalisasi rate voucher.',
    },
    createdAt: Date.now() - 15000,
  },
];

export const DEMO_CHAT_MESSAGES: Record<string, ChatMessage[]> = {
  s1: [
    {
      id: 'msg-1',
      timestamp: Date.now() - 120000,
      role: 'user',
      content: 'Tolong perbaiki perhitungan diskon voucher kalau rate lebih dari 100% atau minus.',
    },
    {
      id: 'msg-2',
      timestamp: Date.now() - 95000,
      role: 'agent',
      content:
        'Saya telah menganalisis `lib/features/discount/discount_service.dart`. Masalahnya ada pada rate yang tidak dinormalisasi jika pengguna menginput persentase integer (misal 10 untuk 10%) dan ketiadaan guard untuk nilai negatif. Saya menyusun usulan diff berikut:',
      toolCalls: [
        {
          name: 'fs/read_text_file',
          arguments: { path: 'lib/features/discount/discount_service.dart' },
          output: '3 lines read from discount_service.dart',
          status: 'completed',
        },
      ],
    },
    {
      id: 'msg-3',
      timestamp: Date.now() - 40000,
      role: 'system',
      content: 'Agen mengusulkan perubahan pada berkas `lib/features/discount/discount_service.dart` (1 berkas, 1 hunk). Tinjau di tab Proposed Edits.',
    },
  ],
  s3: [
    {
      id: 'msg-s3-1',
      timestamp: Date.now() - 20000,
      role: 'user',
      content: 'Fix with agent: [Logcat] NullPointerException at LoginViewModel.kt:42',
    },
    {
      id: 'msg-s3-2',
      timestamp: Date.now() - 10000,
      role: 'agent',
      content: 'Sedang membaca konteks stack trace dan kode sekitar baris 42...',
    },
  ],
};

export const DEMO_USAGE_REPORTS: Record<string, UsageReport> = {
  s1: {
    reported: true,
    inputTokens: 24500,
    outputTokens: 3200,
    totalTokens: 27700,
    cost: 0.14,
    contextPercentage: 13.8,
    displayText: 'Context: 27.7k / 200k (14%) · Tokens: 27.7k · Biaya: ~$0.14',
  },
  s2: {
    reported: false,
    displayText: 'tidak melapor',
  },
  s3: {
    reported: false,
    displayText: 'tidak melapor',
  },
};

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock Svelte runes for Node test environment
globalThis.$state = (v) => v;
globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
globalThis.$effect = () => {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Prompt Envelope with Uploaded Files
// =============================================================================

test('b53 Agent File Upload: buildCleanPromptEnvelope injects uploaded file blocks into formattedPrompt', async () => {
  const { buildCleanPromptEnvelope } = await import('../ui/features/agents/agentsLogic.ts');

  const uploadedFiles = [
    {
      path: '/path/to/spec.pdf',
      name: 'spec.pdf',
      text: 'Specification content: feature X requirements.',
      size_bytes: 4096,
      is_binary: false,
    },
    {
      path: '/path/to/notes.docx',
      name: 'notes.docx',
      text: 'Meeting notes from yesterday.',
      size_bytes: 8192,
      is_binary: false,
    },
    {
      path: '/path/to/sample.dart',
      name: 'sample.dart',
      text: 'void main() { print("test"); }',
      size_bytes: 31,
      is_binary: false,
    },
  ];

  const env = buildCleanPromptEnvelope('Tolong rangkum berkas ini', {
    uploadedFiles,
  });

  assert.equal(env.displayContent, 'Tolong rangkum berkas ini');
  assert.ok(
    env.formattedPrompt.includes('[LAMPIRAN BERKAS: spec.pdf (/path/to/spec.pdf)]'),
    'Must include PDF header'
  );
  assert.ok(
    env.formattedPrompt.includes('Specification content: feature X requirements.'),
    'Must include PDF extracted text'
  );
  assert.ok(
    env.formattedPrompt.includes('[LAMPIRAN BERKAS: notes.docx (/path/to/notes.docx)]'),
    'Must include DOCX header'
  );
  assert.ok(
    env.formattedPrompt.includes('Meeting notes from yesterday.'),
    'Must include DOCX text'
  );
  assert.ok(
    env.formattedPrompt.includes('[LAMPIRAN BERKAS: sample.dart (/path/to/sample.dart)]'),
    'Must include Dart file text'
  );
  assert.deepEqual(env.metadata?.uploadedFiles, uploadedFiles);
});

// =============================================================================
// Suite 2: API Bindings in api.ts
// =============================================================================

test('b53 Agent File Upload: api.ts declares pickFiles and extractFileContent bindings', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiSrc = fs.readFileSync(apiPath, 'utf-8');

  assert.ok(
    apiSrc.includes('pickFiles(): Promise<string[]>'),
    'api.ts must declare pickFiles'
  );
  assert.ok(
    apiSrc.includes('extractFileContent(path: string): Promise<UploadedFileContent>'),
    'api.ts must declare extractFileContent'
  );
  assert.ok(
    apiSrc.includes('export interface UploadedFileContent'),
    'api.ts must export UploadedFileContent'
  );
});

// =============================================================================
// Suite 3: AgentChat.svelte Component Elements
// =============================================================================

test('b53 Agent File Upload: AgentChat.svelte contains paperclip button, drag-and-drop zone, and uploaded chips', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');

  assert.ok(
    chatSrc.includes('class="attach-file-btn"') || chatSrc.includes('handlePickFiles'),
    'AgentChat must have attach file button'
  );
  assert.ok(
    chatSrc.includes('ondrop={handleFileDrop}') &&
      chatSrc.includes('ondragover={handleDragOver}'),
    'AgentChat must have drag and drop event listeners'
  );
  assert.ok(
    chatSrc.includes('class="drag-drop-overlay"') || chatSrc.includes('isDraggingFiles'),
    'AgentChat must declare drag-and-drop overlay'
  );
  assert.ok(
    chatSrc.includes('uploaded-chip') && chatSrc.includes('removeUploadedFile'),
    'AgentChat must render uploaded file chips with remove button'
  );
});

// =============================================================================
// Suite 4: Rust Backend Definitions in crates/core and crates/app
// =============================================================================

test('b53 Agent File Upload: Rust crates define extract_file_content and UploadedFileContent', () => {
  const coreFsPath = path.resolve(projectRoot, 'crates/core/src/fs.rs');
  const coreFsSrc = fs.readFileSync(coreFsPath, 'utf-8');

  assert.ok(
    coreFsSrc.includes('pub struct UploadedFileContent'),
    'crates/core/src/fs.rs must define UploadedFileContent'
  );
  assert.ok(
    coreFsSrc.includes('pub fn extract_file_content'),
    'crates/core/src/fs.rs must define extract_file_content'
  );

  const appFsPath = path.resolve(projectRoot, 'crates/app/src/commands/fs.rs');
  const appFsSrc = fs.readFileSync(appFsPath, 'utf-8');

  assert.ok(
    appFsSrc.includes('pub async fn extract_file_content'),
    'crates/app/src/commands/fs.rs must declare extract_file_content command'
  );
  assert.ok(
    appFsSrc.includes('pub async fn pick_files'),
    'crates/app/src/commands/fs.rs must declare pick_files command'
  );
});

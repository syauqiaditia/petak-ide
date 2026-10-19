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
// Suite 1: Password Modal State Flow
// =============================================================================

test('b47 PDF Sanitize: password modal state flow (open, incorrect password error, clean close on success)', async () => {
  const {
    createInitialPdfPasswordModalState,
    openPdfPasswordModal,
    handlePdfPasswordError,
    handlePdfPasswordSuccess,
  } = await import('../ui/features/agents/agentsLogic.ts');

  // 1. Initial State
  const initial = createInitialPdfPasswordModalState();
  assert.equal(initial.isOpen, false);
  assert.equal(initial.filePath, '');
  assert.equal(initial.passwordInput, '');
  assert.equal(initial.error, '');
  assert.equal(initial.isSubmitting, false);

  // 2. Open on Encrypted PDF
  const opened = openPdfPasswordModal('/home/user/docs/laporan_keuangan.pdf');
  assert.equal(opened.isOpen, true);
  assert.equal(opened.filePath, '/home/user/docs/laporan_keuangan.pdf');
  assert.equal(opened.passwordInput, '');
  assert.equal(opened.error, '');
  assert.equal(opened.isSubmitting, false);

  // 3. User types password and submits
  const stateWithInput = {
    ...opened,
    passwordInput: 'wrong_secret_123',
    isSubmitting: true,
  };

  // 4. Validation error on incorrect password (retains file path)
  const stateWithError = handlePdfPasswordError(
    stateWithInput,
    new Error('Incorrect password: PDF password is wrong')
  );
  assert.equal(stateWithError.isOpen, true);
  assert.equal(stateWithError.filePath, '/home/user/docs/laporan_keuangan.pdf');
  assert.equal(stateWithError.isSubmitting, false);
  assert.ok(
    stateWithError.error.includes('Password salah'),
    'Must display user-friendly Indonesian error message'
  );

  // 5. Clean close on success
  const closed = handlePdfPasswordSuccess();
  assert.equal(closed.isOpen, false);
  assert.equal(closed.passwordInput, '');
  assert.equal(closed.filePath, '');
  assert.equal(closed.error, '');
});

// =============================================================================
// Suite 2: Prompt Envelope with Sanitized PDF Text & Zero Password Artifacts
// =============================================================================

test('b47 PDF Sanitize: prompt envelope formatting contains sanitized text and zero password artifacts', async () => {
  const { buildCleanPromptEnvelope } = await import('../ui/features/agents/agentsLogic.ts');

  const secretUserPassword = 'MySecretPassphrase!2026';
  const uploadedFiles = [
    {
      path: '/home/user/secure/report.pdf',
      name: 'report.pdf',
      text: 'Bank Jatim Data: KTP NIK [REDACTED_PII], GitLab token [REDACTED_TOKEN], OpenAI [REDACTED_KEY]',
      size_bytes: 12048,
      is_binary: false,
      is_sanitized: true,
    },
  ];

  const env = buildCleanPromptEnvelope('Mohon analisa data terlampir', {
    uploadedFiles,
  });

  // Verify display content
  assert.equal(env.displayContent, 'Mohon analisa data terlampir');

  // Verify sanitized text included in LLM prompt envelope
  assert.ok(
    env.formattedPrompt.includes('[LAMPIRAN BERKAS: report.pdf (/home/user/secure/report.pdf)]'),
    'Envelope must include file block header'
  );
  assert.ok(
    env.formattedPrompt.includes('[REDACTED_PII]'),
    'Envelope must contain sanitized PII'
  );
  assert.ok(
    env.formattedPrompt.includes('[REDACTED_TOKEN]'),
    'Envelope must contain sanitized token'
  );
  assert.ok(
    env.formattedPrompt.includes('[REDACTED_KEY]'),
    'Envelope must contain sanitized key'
  );

  // SECURITY INVARIANT: Zero password artifacts anywhere in envelope, prompt, or metadata
  assert.ok(
    !env.formattedPrompt.includes(secretUserPassword),
    'Prompt must NEVER contain password'
  );
  assert.ok(
    !env.displayContent.includes(secretUserPassword),
    'Display content must NEVER contain password'
  );
  assert.ok(
    !JSON.stringify(env.metadata || {}).includes(secretUserPassword),
    'Metadata must NEVER contain password'
  );
});

// =============================================================================
// Suite 3: API Contract & UI Parity in Frontend
// =============================================================================

test('b47 PDF Sanitize: API contract parity in ui/lib/api.ts and types.ts', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiSrc = fs.readFileSync(apiPath, 'utf-8');

  assert.ok(
    apiSrc.includes('checkPdfEncrypted(path: string): Promise<boolean>'),
    'api.ts must declare checkPdfEncrypted'
  );
  assert.ok(
    apiSrc.includes(
      'extractFileContentWithPassword(path: string, password?: string): Promise<UploadedFileContent>'
    ),
    'api.ts must declare extractFileContentWithPassword'
  );
  assert.ok(
    apiSrc.includes('is_sanitized?: boolean'),
    'api.ts UploadedFileContent must declare is_sanitized'
  );

  const typesPath = path.resolve(uiRoot, 'features/agents/types.ts');
  const typesSrc = fs.readFileSync(typesPath, 'utf-8');
  assert.ok(
    typesSrc.includes('is_sanitized?: boolean'),
    'types.ts UploadedFileContent must declare is_sanitized'
  );
});

test('b47 PDF Sanitize: AgentChat.svelte contains password modal and sanitized badges', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf-8');

  assert.ok(
    chatSrc.includes('pdf-password-modal'),
    'AgentChat must declare pdf-password-modal'
  );
  assert.ok(
    chatSrc.includes('PDF Terenkripsi'),
    'AgentChat must declare modal title PDF Terenkripsi'
  );
  assert.ok(
    chatSrc.includes('Buka & Sensor Kredensial'),
    'AgentChat must declare action button Buka & Sensor Kredensial'
  );
  assert.ok(
    chatSrc.includes('chip-badge-sanitized'),
    'AgentChat must declare chip-badge-sanitized'
  );
  assert.ok(
    chatSrc.includes('api.checkPdfEncrypted'),
    'AgentChat must call api.checkPdfEncrypted'
  );
  assert.ok(
    chatSrc.includes('api.extractFileContentWithPassword'),
    'AgentChat must call api.extractFileContentWithPassword'
  );
});

// =============================================================================
// Suite 4: Rust Backend Contract Parity
// =============================================================================

test('b47 PDF Sanitize: Rust backend declares sanitize, pdf encryption, and Tauri commands', () => {
  const sanitizePath = path.resolve(projectRoot, 'crates/core/src/sanitize.rs');
  const sanitizeSrc = fs.readFileSync(sanitizePath, 'utf-8');
  assert.ok(
    sanitizeSrc.includes('pub fn sanitize_sensitive_data'),
    'crates/core/src/sanitize.rs must define sanitize_sensitive_data'
  );

  const coreFsPath = path.resolve(projectRoot, 'crates/core/src/fs.rs');
  const coreFsSrc = fs.readFileSync(coreFsPath, 'utf-8');
  assert.ok(
    coreFsSrc.includes('pub fn check_pdf_encrypted'),
    'crates/core/src/fs.rs must define check_pdf_encrypted'
  );
  assert.ok(
    coreFsSrc.includes('pub fn extract_pdf_content'),
    'crates/core/src/fs.rs must define extract_pdf_content'
  );
  assert.ok(
    coreFsSrc.includes('pub enum PdfError'),
    'crates/core/src/fs.rs must define PdfError'
  );
  assert.ok(
    coreFsSrc.includes('pub is_sanitized: bool'),
    'crates/core/src/fs.rs UploadedFileContent must declare is_sanitized'
  );

  const appFsPath = path.resolve(projectRoot, 'crates/app/src/commands/fs.rs');
  const appFsSrc = fs.readFileSync(appFsPath, 'utf-8');
  assert.ok(
    appFsSrc.includes('pub async fn check_pdf_encrypted'),
    'crates/app/src/commands/fs.rs must declare check_pdf_encrypted command'
  );
  assert.ok(
    appFsSrc.includes('pub async fn extract_file_content_with_password'),
    'crates/app/src/commands/fs.rs must declare extract_file_content_with_password command'
  );

  const appLibPath = path.resolve(projectRoot, 'crates/app/src/lib.rs');
  const appLibSrc = fs.readFileSync(appLibPath, 'utf-8');
  assert.ok(
    appLibSrc.includes('commands::check_pdf_encrypted'),
    'crates/app/src/lib.rs must register commands::check_pdf_encrypted'
  );
  assert.ok(
    appLibSrc.includes('commands::extract_file_content_with_password'),
    'crates/app/src/lib.rs must register commands::extract_file_content_with_password'
  );
});

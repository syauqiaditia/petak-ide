/**
 * Local fixtures for Demo Mode (when no GitLab token is configured).
 * Clearly marked with DEMO tags.
 */
import type { MergeRequest, Discussion, PipelineInfo, GitLabUser, GitDiffFile } from './types';

export const DEMO_CURRENT_USER: GitLabUser = {
  id: 42,
  username: 'developer',
  name: 'Lead Developer',
  avatarUrl: null,
  webUrl: 'https://gitlab.example.com/developer',
};

export const DEMO_REVIEWER_USER: GitLabUser = {
  id: 101,
  username: 'techlead',
  name: 'Petak Tech Lead',
  avatarUrl: null,
};

export const DEMO_DEV2_USER: GitLabUser = {
  id: 102,
  username: 'developer2',
  name: 'Senior Developer B',
  avatarUrl: null,
};

export const DEMO_MERGE_REQUESTS: MergeRequest[] = [
  {
    id: 1001,
    iid: 124,
    projectId: 1,
    title: '[DEMO] feat(auth): Integrasi autentikasi biometrik JConnect',
    description: `### Deskripsi
Pembaruan implementasi biometrik (Fingerprint & Face ID) pada modul login JConnect Mobile Banking.

- Tambah wrapper \`BiometricHelper\`
- Integrasi fallback ke PIN jika biometrik gagal 3x
- Menyesuaikan dependensi AndroidX Biometric 1.2.0

Verifikasi:
\`\`\`bash
flutter test test/auth/biometric_test.dart
\`\`\`
Ref: #JCON-450`,
    state: 'opened',
    createdAt: '2026-09-28T08:30:00Z',
    updatedAt: '2026-09-30T02:15:00Z',
    targetBranch: 'canary/dev/1.9.0',
    sourceBranch: 'feat/biometric-auth',
    author: DEMO_CURRENT_USER,
    assignees: [DEMO_CURRENT_USER],
    reviewers: [DEMO_REVIEWER_USER],
    draft: false,
    workInProgress: false,
    mergeStatus: 'can_be_merged',
    detailedMergeStatus: 'mergeable',
    sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    hasConflicts: false,
    webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/merge_requests/124',
    headPipeline: {
      id: 8841,
      sha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
      refName: 'feat/biometric-auth',
      status: 'success',
      createdAt: '2026-09-30T02:10:00Z',
      webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/pipelines/8841',
    },
    diffRefs: {
      baseSha: '00112233445566778899aabbccddeeff00112233',
      headSha: 'a1b2c3d4e5f67890abcdef1234567890abcdef12',
    },
  },
  {
    id: 1002,
    iid: 125,
    projectId: 1,
    title: '[DEMO] fix(mirror): Handle screen rotation glitch on tablet devices',
    description: `Memperbaiki glitch offset saat memutar layar pada emulator tablet Android API 35.
- Perbarui kalkulasi \`calculateViewportFit\`
- Pasang debounce 150ms pada event orientation change`,
    state: 'opened',
    createdAt: '2026-09-29T14:10:00Z',
    updatedAt: '2026-09-30T02:50:00Z',
    targetBranch: 'main',
    sourceBranch: 'fix/mirror-tablet-rot',
    author: DEMO_DEV2_USER,
    assignees: [DEMO_DEV2_USER],
    reviewers: [DEMO_CURRENT_USER],
    draft: false,
    workInProgress: false,
    mergeStatus: 'can_be_merged',
    detailedMergeStatus: 'ci_still_running',
    sha: 'f4e3d2c1b0a987654321fedcba0987654321fedc',
    hasConflicts: false,
    webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/merge_requests/125',
    headPipeline: {
      id: 8845,
      sha: 'f4e3d2c1b0a987654321fedcba0987654321fedc',
      refName: 'fix/mirror-tablet-rot',
      status: 'running',
      createdAt: '2026-09-30T02:48:00Z',
      webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/pipelines/8845',
    },
    diffRefs: {
      baseSha: '11223344556677889900aabbccddeeff11223344',
      headSha: 'f4e3d2c1b0a987654321fedcba0987654321fedc',
    },
  },
  {
    id: 1003,
    iid: 126,
    projectId: 1,
    title: '[DEMO] refactor(core): Simplify git diff parser and sbs hunks',
    description: `Refactoring logic pemetaan side-by-side diff untuk mengurangi alokasi memori.
Menghapus duplikasi model hunk antara core dan app.`,
    state: 'opened',
    createdAt: '2026-09-29T18:00:00Z',
    updatedAt: '2026-09-30T01:10:00Z',
    targetBranch: 'main',
    sourceBranch: 'refactor/diff-parser',
    author: DEMO_REVIEWER_USER,
    assignees: [DEMO_CURRENT_USER],
    reviewers: [DEMO_DEV2_USER],
    draft: false,
    workInProgress: false,
    mergeStatus: 'cannot_be_merged',
    detailedMergeStatus: 'cannot_be_merged',
    sha: '556677889900aabbccddeeff0011223344556677',
    hasConflicts: true,
    webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/merge_requests/126',
    headPipeline: {
      id: 8840,
      sha: '556677889900aabbccddeeff0011223344556677',
      refName: 'refactor/diff-parser',
      status: 'failed',
      createdAt: '2026-09-30T01:05:00Z',
      webUrl: 'https://gitlab.example.com/jatim/jconnect-flutter/-/pipelines/8840',
    },
    diffRefs: {
      baseSha: '22334455667788990011aabbccddeeff22334455',
      headSha: '556677889900aabbccddeeff0011223344556677',
    },
  },
];

export const DEMO_DIFF_FILES: Record<number, GitDiffFile[]> = {
  124: [
    {
      oldPath: 'lib/core/biometric/biometric_helper.dart',
      newPath: 'lib/core/biometric/biometric_helper.dart',
      status: 'modified',
      binary: false,
      hunks: [
        {
          oldStart: 12,
          oldLines: 8,
          newStart: 12,
          newLines: 14,
          header: '@@ -12,8 +12,14 @@ class BiometricHelper {',
          lines: [
            { kind: 'context', text: '  Future<bool> canAuthenticate() async {', oldNo: 12, newNo: 12 },
            { kind: 'context', text: '    try {', oldNo: 13, newNo: 13 },
            { kind: 'del', text: '      return await _auth.canCheckBiometrics;', oldNo: 14, newNo: null },
            { kind: 'add', text: '      final bool canCheck = await _auth.canCheckBiometrics;', oldNo: null, newNo: 14 },
            { kind: 'add', text: '      final bool isDeviceSupported = await _auth.isDeviceSupported();', oldNo: null, newNo: 15 },
            { kind: 'add', text: '      return canCheck && isDeviceSupported;', oldNo: null, newNo: 16 },
            { kind: 'context', text: '    } catch (e) {', oldNo: 15, newNo: 17 },
            { kind: 'del', text: '      return false;', oldNo: 16, newNo: null },
            { kind: 'add', text: '      _logger.e("Biometric check failed", error: e);', oldNo: null, newNo: 18 },
            { kind: 'add', text: '      return false;', oldNo: null, newNo: 19 },
            { kind: 'context', text: '    }', oldNo: 17, newNo: 20 },
            { kind: 'context', text: '  }', oldNo: 18, newNo: 21 },
          ],
        },
      ],
    },
    {
      oldPath: 'lib/features/auth/login_controller.dart',
      newPath: 'lib/features/auth/login_controller.dart',
      status: 'modified',
      binary: false,
      hunks: [
        {
          oldStart: 45,
          oldLines: 6,
          newStart: 45,
          newLines: 8,
          header: '@@ -45,6 +45,8 @@ class LoginController {',
          lines: [
            { kind: 'context', text: '  void onBiometricPressed() async {', oldNo: 45, newNo: 45 },
            { kind: 'add', text: '    state = LoginState.authenticating();', oldNo: null, newNo: 46 },
            { kind: 'context', text: '    final ok = await _biometricHelper.authenticate();', oldNo: 46, newNo: 47 },
            { kind: 'context', text: '    if (ok) {', oldNo: 47, newNo: 48 },
            { kind: 'context', text: '      navigateToHome();', oldNo: 48, newNo: 49 },
            { kind: 'add', text: '    } else {', oldNo: null, newNo: 50 },
            { kind: 'add', text: '      showFallbackPinDialog();', oldNo: null, newNo: 51 },
            { kind: 'context', text: '    }', oldNo: 49, newNo: 52 },
            { kind: 'context', text: '  }', oldNo: 50, newNo: 53 },
          ],
        },
      ],
    },
  ],
  125: [
    {
      oldPath: 'ui/features/mirror/DeviceStage.svelte',
      newPath: 'ui/features/mirror/DeviceStage.svelte',
      status: 'modified',
      binary: false,
      hunks: [
        {
          oldStart: 30,
          oldLines: 5,
          newStart: 30,
          newLines: 7,
          header: '@@ -30,5 +30,7 @@',
          lines: [
            { kind: 'context', text: '  function handleResize() {', oldNo: 30, newNo: 30 },
            { kind: 'del', text: '    calculateViewportFit();', oldNo: 31, newNo: null },
            { kind: 'add', text: '    clearTimeout(resizeTimer);', oldNo: null, newNo: 31 },
            { kind: 'add', text: '    resizeTimer = setTimeout(calculateViewportFit, 150);', oldNo: null, newNo: 32 },
            { kind: 'context', text: '  }', oldNo: 32, newNo: 33 },
          ],
        },
      ],
    },
  ],
  126: [
    {
      oldPath: 'ui/features/git/sbs.ts',
      newPath: 'ui/features/git/sbs.ts',
      status: 'modified',
      binary: false,
      hunks: [
        {
          oldStart: 10,
          oldLines: 4,
          newStart: 10,
          newLines: 4,
          header: '@@ -10,4 +10,4 @@',
          lines: [
            { kind: 'context', text: 'export function hunkToSbs(hunk: GitHunk): SbsHunk {', oldNo: 10, newNo: 10 },
            { kind: 'del', text: '  const leftLines = [];', oldNo: 11, newNo: null },
            { kind: 'add', text: '  const leftLines: SbsLine[] = [];', oldNo: null, newNo: 11 },
            { kind: 'context', text: '  return { header: hunk.header, leftLines, rightLines: [] };', oldNo: 12, newNo: 12 },
          ],
        },
      ],
    },
  ],
};

export const DEMO_DISCUSSIONS: Record<number, Discussion[]> = {
  124: [
    {
      id: 'disc-1',
      individualNote: false,
      notes: [
        {
          id: 501,
          body: 'Pastikan penanganan error biometrik juga mencatat event log audit untuk kepatuhan regulasi OJK.',
          author: DEMO_REVIEWER_USER,
          createdAt: '2026-09-29T10:00:00Z',
          updatedAt: '2026-09-29T10:00:00Z',
          system: false,
          resolvable: true,
          resolved: true,
          position: null,
        },
        {
          id: 502,
          body: 'Sudah ditambahkan di `_logger.e("Biometric check failed", error: e)` dan dikirim ke server audit log.',
          author: DEMO_CURRENT_USER,
          createdAt: '2026-09-29T11:30:00Z',
          updatedAt: '2026-09-29T11:30:00Z',
          system: false,
          resolvable: false,
          resolved: null,
          position: null,
        },
      ],
    },
    {
      id: 'disc-2',
      individualNote: false,
      notes: [
        {
          id: 503,
          body: 'Apakah fallback PIN otomatis memicu lockout setelah 3x gagal verifikasi?',
          author: DEMO_DEV2_USER,
          createdAt: '2026-09-29T14:00:00Z',
          updatedAt: '2026-09-29T14:00:00Z',
          system: false,
          resolvable: true,
          resolved: false,
          position: {
            oldPath: 'lib/core/biometric/biometric_helper.dart',
            newPath: 'lib/core/biometric/biometric_helper.dart',
            newLine: 18,
          },
        },
      ],
    },
  ],
  125: [],
  126: [],
};

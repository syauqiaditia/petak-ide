// Fallback mock for browser preview (when running outside Tauri runtime)
if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: any) => {
      if (cmd === 'git_status') {
        return {
          branch: {
            head: 'feature/transfer-limit',
            upstream: 'origin/feature-transfer-limit',
            ahead: 1,
            behind: 0,
            detached: false,
          },
          entries: [
            {
              path: 'lib/features/transfer/transfer_cubit.dart',
              origPath: null,
              index: 'modified',
              worktree: 'unmodified',
              conflicted: false,
            },
            {
              path: 'lib/features/transfer/transfer_state.dart',
              origPath: null,
              index: 'unmodified',
              worktree: 'modified',
              conflicted: false,
            },
            {
              path: 'test/features/transfer/transfer_cubit_test.dart',
              origPath: null,
              index: 'unmodified',
              worktree: 'untracked',
              conflicted: false,
            },
          ],
        };
      }
      if (cmd === 'git_diff') {
        return [
          {
            oldPath: 'lib/features/transfer/transfer_cubit.dart',
            newPath: 'lib/features/transfer/transfer_cubit.dart',
            status: 'modified',
            binary: false,
            hunks: [
              {
                oldStart: 1,
                oldLines: 5,
                newStart: 1,
                newLines: 6,
                header: '@@ -1,5 +1,6 @@',
                lines: [
                  { kind: 'context', text: 'class TransferCubit extends Cubit<TransferState> {', oldNo: 1, newNo: 1 },
                  { kind: 'del', text: '  final TransferRepository _repo;', oldNo: 2, newNo: null },
                  { kind: 'add', text: '  final TransferRepository repo;', oldNo: null, newNo: 2 },
                  { kind: 'add', text: '  final LimitService _limitService;', oldNo: null, newNo: 3 },
                  { kind: 'context', text: '  TransferCubit(this.repo) : super(const TransferState());', oldNo: 3, newNo: 4 },
                ],
              },
            ],
          },
        ];
      }
      if (cmd === 'git_branches') {
        return {
          local: [
            {
              name: 'feature/checkout',
              upstream: 'origin/feature/checkout',
              ahead: 2,
              behind: 0,
              isCurrent: true,
              sha: '5e44a0b1234567890abcdef1234567890abcdef1',
            },
            {
              name: 'main',
              upstream: 'origin/main',
              ahead: 0,
              behind: 0,
              isCurrent: false,
              sha: '98765431234567890abcdef1234567890abcdef1',
            },
            {
              name: 'fix/login-refresh',
              upstream: null,
              ahead: 0,
              behind: 0,
              isCurrent: false,
              sha: '12345671234567890abcdef1234567890abcdef1',
            },
          ],
          remote: [
            { name: 'origin/main', sha: '98765431234567890abcdef1234567890abcdef1' },
            { name: 'origin/feature/checkout', sha: '98765431234567890abcdef1234567890abcdef1' },
            { name: 'origin/release/2.15', sha: 'abcdef01234567890abcdef1234567890abcdef1' },
          ],
          tags: [
            { name: 'v2.14.0', sha: '44332211234567890abcdef1234567890abcdef1' },
          ],
        };
      }
      if (cmd === 'git_log') {
        const nowSec = Math.floor(Date.now() / 1000);
        return {
          commits: [
            {
              sha: '5e44a0b1234567890abcdef1234567890abcdef1',
              shortSha: '5e44a0b',
              parents: ['1c7be901234567890abcdef1234567890abcdef1'],
              authorName: 'Claude Code',
              authorEmail: 'claude@code.ai',
              authorTime: nowSec - 240,
              subject: 'fix(checkout): guard empty voucher body',
              refs: [
                { kind: 'head', name: 'HEAD', isCurrent: true },
                { kind: 'branch', name: 'feature/checkout', isCurrent: true },
              ],
              pushed: false,
            },
            {
              sha: '1c7be901234567890abcdef1234567890abcdef1',
              shortSha: '1c7be90',
              parents: ['8d02e111234567890abcdef1234567890abcdef1'],
              authorName: 'Rina',
              authorEmail: 'rina@company.com',
              authorTime: nowSec - 3600,
              subject: 'fix: typo in voucher label',
              refs: [],
              pushed: false,
            },
            {
              sha: '8d02e111234567890abcdef1234567890abcdef1',
              shortSha: '8d02e11',
              parents: ['7b91a021234567890abcdef1234567890abcdef1'],
              authorName: 'You',
              authorEmail: 'you@petak.local',
              authorTime: nowSec - 7200,
              subject: 'wip checkout',
              refs: [],
              pushed: false,
            },
            {
              sha: '7b91a021234567890abcdef1234567890abcdef1',
              shortSha: '7b91a02',
              parents: ['a1b2c3d1234567890abcdef1234567890abcdef1'],
              authorName: 'You',
              authorEmail: 'you@petak.local',
              authorTime: nowSec - 10800,
              subject: 'wip',
              refs: [],
              pushed: false,
            },
            {
              sha: 'a1b2c3d1234567890abcdef1234567890abcdef1',
              shortSha: 'a1b2c3d',
              parents: ['m1n2o3p1234567890abcdef1234567890abcdef1'],
              authorName: 'You',
              authorEmail: 'you@petak.local',
              authorTime: nowSec - 86400,
              subject: 'feat(checkout): voucher input field',
              refs: [],
              pushed: true,
            },
            {
              sha: 'm1n2o3p1234567890abcdef1234567890abcdef1',
              shortSha: 'm1n2o3p',
              parents: [
                'branch1234567890abcdef1234567890abcdef1',
                '98765431234567890abcdef1234567890abcdef1',
              ],
              authorName: 'You',
              authorEmail: 'you@petak.local',
              authorTime: nowSec - 90000,
              subject: "Merge branch 'main' into feature/checkout",
              refs: [],
              pushed: true,
            },
            {
              sha: 'branch1234567890abcdef1234567890abcdef1',
              shortSha: 'branch1',
              parents: ['98765431234567890abcdef1234567890abcdef1'],
              authorName: 'Dimas',
              authorEmail: 'dimas@company.com',
              authorTime: nowSec - 180000,
              subject: 'chore: bump AGP to 8.7',
              refs: [
                { kind: 'remote', name: 'origin/main', isCurrent: false },
                { kind: 'branch', name: 'main', isCurrent: false },
              ],
              pushed: true,
            },
            {
              sha: '98765431234567890abcdef1234567890abcdef1',
              shortSha: '9876543',
              parents: ['44332211234567890abcdef1234567890abcdef1'],
              authorName: 'Dimas',
              authorEmail: 'dimas@company.com',
              authorTime: nowSec - 250000,
              subject: 'fix(auth): refresh token race',
              refs: [],
              pushed: true,
            },
            {
              sha: '44332211234567890abcdef1234567890abcdef1',
              shortSha: '4433221',
              parents: ['root1231234567890abcdef1234567890abcdef1'],
              authorName: 'Dimas',
              authorEmail: 'dimas@company.com',
              authorTime: nowSec - 350000,
              subject: 'release 2.14.0',
              refs: [{ kind: 'tag', name: 'v2.14.0', isCurrent: false }],
              pushed: true,
            },
            {
              sha: 'root1231234567890abcdef1234567890abcdef1',
              shortSha: 'root123',
              parents: [],
              authorName: 'You',
              authorEmail: 'you@petak.local',
              authorTime: nowSec - 500000,
              subject: 'Initial commit',
              refs: [],
              pushed: true,
            },
          ],
          graph: [
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            {
              lane: 0,
              color: 0,
              edges: [
                { from: 0, to: 0, kind: 'straight', color: 0 },
                { from: 0, to: 1, kind: 'branchOut', color: 1 },
              ],
            },
            {
              lane: 1,
              color: 1,
              edges: [
                { from: 0, to: 0, kind: 'straight', color: 0 },
                { from: 1, to: 0, kind: 'mergeIn', color: 1 },
              ],
            },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }] },
            { lane: 0, color: 0, edges: [] },
          ],
          nextCursor: null,
        };
      }
      if (cmd === 'git_commit_files') {
        return [
          { path: 'CheckoutScreen.kt', status: 'modified' },
          { path: 'CheckoutViewModel.kt', status: 'modified' },
          { path: 'VoucherField.kt', status: 'added' },
          { path: 'strings.xml', status: 'modified' },
        ];
      }
      if (cmd === 'git_branch') return 'feature/checkout';
      if (cmd === 'git_last_message') return 'feat(transfer): add daily limit check';
      if (cmd === 'git_commit') return 'commit mock success';
      if (cmd === 'git_stage_files' || cmd === 'git_unstage_files' || cmd === 'git_stage_hunk' || cmd === 'git_unstage_hunk') {
        return null;
      }
      if (cmd === 'list_dir') {
        return [
          { name: 'lib', path: '/workspace/lib', is_dir: true },
          { name: 'test', path: '/workspace/test', is_dir: true },
          { name: 'pubspec.yaml', path: '/workspace/pubspec.yaml', is_dir: false },
        ];
      }
      if (cmd === 'recent_folders') return ['/workspace'];
      if (cmd === 'read_file') return '// Sample file content\n';
      if (cmd === 'bench_mode') return false;
      if (cmd === 'test_mode') return null;
      if (cmd.startsWith('plugin:event|')) return 1;
      return null;
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
}

import { mount } from 'svelte';
import App from './App.svelte';
import { api } from './lib/api';

const formatArg = (a: any) => {
  if (a instanceof Error) {
    return `${a.name}: ${a.message}\n${a.stack}`;
  }
  if (typeof a === 'object' && a !== null) {
    try {
      const s = JSON.stringify(a);
      if (s === '{}') {
        return (a.message || a.toString()) + ' ' + Object.getOwnPropertyNames(a).map(k => `${k}=${a[k]}`).join(', ');
      }
      return s;
    } catch (_) {
      return String(a);
    }
  }
  return String(a);
};

window.addEventListener('error', (e) => {
  api.benchLog('[WINDOW_ERROR] ' + e.message + ' at ' + e.filename + ':' + e.lineno + '\n' + (e.error?.stack || ''));
});
window.addEventListener('unhandledrejection', (e) => {
  api.benchLog('[UNHANDLED] ' + formatArg(e.reason));
});
const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  try {
    api.benchLog('[LOG] ' + args.map(formatArg).join(' '));
  } catch (_) {}
};
const origErr = console.error;
console.error = (...args) => {
  origErr(...args);
  try {
    api.benchLog('[ERROR_LOG] ' + args.map(formatArg).join(' '));
  } catch (_) {}
};

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;

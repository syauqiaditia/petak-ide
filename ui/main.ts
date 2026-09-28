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
      if (cmd === 'git_branch') return 'feature/transfer-limit';
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

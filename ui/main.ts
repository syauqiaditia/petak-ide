// Fallback mock for browser preview (when running outside Tauri runtime)
if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
  (window as any).__PETAK_PREVIEW__ = true;
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
      if (cmd === 'git_backup_list') {
        return [
          {
            name: 'refs/petak/backup/20260928-153012-rebase',
            targetSha: '5e44a0b1234567890abcdef1234567890abcdef1',
            op: 'rebase',
            subject: 'feat(transfer): add daily limit check',
            createdAt: Math.floor(Date.now() / 1000) - 1800,
          },
          {
            name: 'refs/petak/backup/20260928-144500-reset',
            targetSha: '3a11b2c1234567890abcdef1234567890abcdef1',
            op: 'reset',
            subject: 'refactor(ui): extract amount input component',
            createdAt: Math.floor(Date.now() / 1000) - 4500,
          },
        ];
      }
      if (cmd === 'git_remotes') {
        return [
          {
            name: 'origin',
            fetchUrl: 'git@code.istar.id:bankjatim/jconnect.git',
            pushUrl: 'git@code.istar.id:bankjatim/jconnect.git',
          },
        ];
      }
      if (cmd === 'git_op_state') {
        if (typeof window !== 'undefined' && window.location.search.includes('conflict')) {
          return {
            kind: 'rebase',
            headName: 'feature/checkout',
            ontoName: 'origin/main',
            step: [2, 5],
            conflictFiles: ['CheckoutScreen.kt', 'strings.xml'],
          };
        }
        return { kind: 'none', headName: null, ontoName: null, step: null, conflictFiles: [] };
      }
      if (cmd === 'git_conflicts') {
        return [
          {
            path: 'lib/features/checkout/CheckoutScreen.kt',
            merged: `package id.co.bankjatim.jconnect.checkout\n\n<<<<<<< HEAD\nfun renderTotalAmount(total: Double, voucherDiscount: Double): Double {\n  return total - voucherDiscount\n}\n=======\nfun renderTotalAmount(total: Double, voucher: Voucher?): Double {\n  val discount = voucher?.discount ?: 0.0\n  return (total - discount).coerceAtLeast(0.0)\n}\n>>>>>>> origin/main\n`,
            blocks: [
              {
                index: 0,
                startLine: 3,
                ours: [
                  'fun renderTotalAmount(total: Double, voucherDiscount: Double): Double {',
                  '  return total - voucherDiscount',
                  '}',
                ],
                theirs: [
                  'fun renderTotalAmount(total: Double, voucher: Voucher?): Double {',
                  '  val discount = voucher?.discount ?: 0.0',
                  '  return (total - discount).coerceAtLeast(0.0)',
                  '}',
                ],
                base: null,
              },
            ],
          },
          {
            path: 'res/values/strings.xml',
            merged: `<resources>\n<<<<<<< HEAD\n  <string name="checkout_pay">Bayar Sekarang</string>\n=======\n  <string name="checkout_pay">Lanjutkan Pembayaran</string>\n>>>>>>> origin/main\n</resources>`,
            blocks: [
              {
                index: 0,
                startLine: 2,
                ours: ['  <string name="checkout_pay">Bayar Sekarang</string>'],
                theirs: ['  <string name="checkout_pay">Lanjutkan Pembayaran</string>'],
                base: null,
              },
            ],
          },
        ];
      }
      if (cmd === 'git_rebase_todo') {
        return [
          {
            action: 'pick',
            sha: '5e44a0b1234567890abcdef1234567890abcdef1',
            shortSha: '5e44a0b',
            message: 'feat(transfer): add daily limit check',
          },
          {
            action: 'pick',
            sha: '3a11b2c1234567890abcdef1234567890abcdef1',
            shortSha: '3a11b2c',
            message: 'refactor(ui): extract amount input component',
          },
          {
            action: 'pick',
            sha: '7f99e8d1234567890abcdef1234567890abcdef1',
            shortSha: '7f99e8d',
            message: 'fix(form): prevent negative amount entry',
          },
          {
            action: 'pick',
            sha: '2b88c7a1234567890abcdef1234567890abcdef1',
            shortSha: '2b88c7a',
            message: 'style: format currency with separator dots',
          },
          {
            action: 'pick',
            sha: '1c55d4e1234567890abcdef1234567890abcdef1',
            shortSha: '1c55d4e',
            message: 'test: add unit test for daily limit edge cases',
          },
        ];
      }
      if (cmd === 'git_resolve_block') {
        const choice = args?.choice;
        if (choice === 'theirs') {
          return 'fun renderTotalAmount(total: Double, voucher: Voucher?): Double {\n  val discount = voucher?.discount ?: 0.0\n  return (total - discount).coerceAtLeast(0.0)\n}';
        }
        return 'fun renderTotalAmount(total: Double, voucherDiscount: Double): Double {\n  return total - voucherDiscount\n}';
      }
      if (cmd === 'git_rebase_run' || cmd === 'git_op_continue' || cmd === 'git_squash' || cmd === 'git_reword' || cmd === 'git_fixup' || cmd === 'git_drop' || cmd === 'git_reset' || cmd === 'git_cherry_pick' || cmd === 'git_revert' || cmd === 'git_pull' || cmd === 'git_push') {
        return { ok: true, backupRef: 'refs/petak/backup/20260928-153012-rebase' };
      }
      if (cmd === 'git_branch_checkout' || cmd === 'git_branch_create' || cmd === 'git_branch_rename' || cmd === 'git_branch_delete' || cmd === 'git_backup_restore' || cmd === 'git_backup_delete' || cmd === 'git_op_abort' || cmd === 'git_conflict_write' || cmd === 'git_fetch') {
        return null;
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
      if (cmd === 'run_configs_load') {
        return {
          selected: 'app',
          configs: [
            {
              name: 'app',
              kind: 'gradle',
              module: 'app',
              variant: 'debug',
            },
            {
              name: 'jconnect_flutter',
              kind: 'flutter',
              target: 'lib/main.dart',
              flavor: 'dev',
            },
          ],
        };
      }
      if (cmd === 'run_configs_save') return null;
      if (cmd === 'devices_list') {
        if (typeof window !== 'undefined' && window.location.search.includes('no-device')) {
          return [];
        }
        return [
          {
            id: 'emulator-5554',
            name: 'Pixel 8',
            platform: 'android',
            kind: 'emulator',
            state: 'online',
            connection: 'connected',
            transport: 'usb',
            sdk: '35',
          },
          {
            id: '00008110-00012CCE0C09401E',
            name: 'iPhone UQi',
            platform: 'ios',
            kind: 'physical',
            state: 'offline',
            connection: 'paired',
            transport: 'wifi',
            sdk: '18.1',
          },
          {
            id: 'iphone-prio',
            name: 'iPhone Prio',
            platform: 'ios',
            kind: 'physical',
            state: 'offline',
            connection: 'unavailable',
            transport: 'usb',
          },
          {
            id: '00008101-001234',
            name: 'iPhone 15 Pro',
            platform: 'ios',
            kind: 'simulator',
            state: 'offline',
            connection: 'connected',
            sdk: '17.5',
          },
        ];
      }
      if (cmd === 'devices_snapshot') {
        return {
          emulators: [
            {
              id: 'emulator-5554',
              name: 'Pixel 8',
              kind: 'android-avd',
              state: 'running',
              deviceId: 'emulator-5554',
              sdk: '35',
              flutterId: 'emulator-5554',
            },
            {
              id: 'Z_Fold',
              name: 'Z_Fold',
              kind: 'android-avd',
              state: 'stopped',
              deviceId: null,
              flutterId: null,
            },
          ],
          physical: [
            {
              id: '00008110-00012CCE0C09401E',
              name: 'iPhone UQi',
              platform: 'ios',
              transport: 'wifi',
              connection: 'paired',
              state: 'offline',
              flutterId: null,
            },
            {
              id: 'iphone-prio',
              name: 'iPhone Prio',
              platform: 'ios',
              transport: 'usb',
              connection: 'unavailable',
              state: 'offline',
              flutterId: null,
            },
          ],
          others: [
            {
              id: 'macos',
              name: 'macOS',
              group: 'desktop',
              state: 'online',
              flutterId: 'macos',
            },
          ],
        };
      }
      if (cmd === 'recent_projects_list') {
        return [
          { name: 'jatim-ist-mb-flutter', path: '/mnt/storage/projects/jatim-ist-mb-flutter', lastOpened: Date.now() - 3600000, exists: true },
          { name: 'voinzy', path: '/mnt/storage/projects/voinzy', lastOpened: Date.now() - 7200000, exists: true },
          { name: 'petak', path: '/mnt/storage/uqi-projects/petak', lastOpened: Date.now() - 86400000, exists: true },
          { name: 'old-project-deleted', path: '/mnt/storage/projects/old-deleted', lastOpened: Date.now() - 172800000, exists: false },
        ];
      }
      if (cmd === 'recent_projects_add' || cmd === 'recent_projects_remove') {
        return null;
      }
      if (cmd === 'git_stage_paths' || cmd === 'git_unstage_paths' || cmd === 'git_delete_untracked') {
        return null;
      }
      if (cmd === 'git_commit_selected') {
        return { sha: '5e44a0b1234567890abcdef1234567890abcdef1' };
      }
      if (cmd === 'suggest_query') {
        const prefix = (args?.prefix || '').trim();
        if (prefix === 'ITextF' || prefix.toLowerCase().startsWith('itextf')) {
          return [
            {
              text: 'ieldPin(',
              freq: 5,
              argsTemplate: 'controller: , focusNode: ,',
            },
          ];
        }
        return [];
      }
      if (cmd === 'suggest_index_build' || cmd === 'suggest_index_update') {
        return null;
      }
      if (cmd === 'devices_watch') return null;
      if (cmd === 'avd_list') {
        return [
          { name: 'Pixel_8_API_35' },
          { name: 'Pixel_7_Pro_API_34' },
          { name: 'Medium_Phone_API_35' },
        ];
      }
      if (cmd === 'emulator_start') return null;
      if (cmd === 'run_start') return 101;
      if (cmd === 'run_reload') {
        return {
          fullRestart: args?.full || false,
          ok: true,
          ms: 240,
          message: 'Reloaded 1 of 652 libraries in 240ms',
        };
      }
      if (cmd === 'run_stop') return null;
      if (cmd === 'gradle_status') return true;
      if (cmd === 'gradle_sync') return 'BUILD SUCCESSFUL in 2s';
      if (cmd === 'gradle_stop') return null;
      if (cmd === 'logcat_start') return null;
      if (cmd === 'logcat_stop') return null;
      if (cmd === 'open_url') return null;
      if (cmd === 'mirror_permission_status') {
        const url = typeof window !== 'undefined' ? window.location.search : '';
        if (url.includes('perm-restart')) {
          return { granted: true, restartNeeded: true, kind: 'simulator' };
        }
        if (url.includes('perm-physical')) {
          return { granted: false, restartNeeded: false, kind: 'physical' };
        }
        return { granted: false, restartNeeded: false, kind: 'simulator' };
      }
      if (cmd === 'open_screen_recording_settings') return null;
      if (cmd === 'sim_boot' || cmd === 'sim_shutdown' || cmd === 'sim_open_app') return null;
      if (cmd === 'avd_start' || cmd === 'avd_stop' || cmd === 'avd_wipe' || cmd === 'avd_delete') return null;
      if (cmd === 'kls_install' || cmd === 'kotlin_ls_install') return null;
      if (cmd === 'format_document') {
        return {
          formatted: args?.text || '',
          tool: args?.lang === 'dart' ? 'dart format' : args?.lang === 'kotlin' ? 'ktlint' : 'prettier',
        };
      }

      // GitLab MR Viewer (Phase 5)
      if (cmd === 'mr_get_token_scope') {
        if (typeof window !== 'undefined' && window.location.search.includes('no-token')) {
          return 'none';
        }
        if (typeof window !== 'undefined' && window.location.search.includes('scope=api')) {
          return 'full';
        }
        return 'readOnly';
      }
      if (cmd === 'mr_current_user') {
        const { DEMO_CURRENT_USER } = await import('./features/mr/fixtures');
        return DEMO_CURRENT_USER;
      }
      if (cmd === 'mr_list') {
        const { DEMO_MERGE_REQUESTS } = await import('./features/mr/fixtures');
        return {
          items: DEMO_MERGE_REQUESTS,
          pagination: { page: 1, perPage: 20, total: DEMO_MERGE_REQUESTS.length, totalPages: 1 },
        };
      }
      if (cmd === 'mr_detail') {
        const { DEMO_MERGE_REQUESTS } = await import('./features/mr/fixtures');
        return DEMO_MERGE_REQUESTS.find((m) => m.iid === args?.iid) || DEMO_MERGE_REQUESTS[0];
      }
      if (cmd === 'mr_diffs') {
        const { DEMO_DIFF_FILES } = await import('./features/mr/fixtures');
        return DEMO_DIFF_FILES[args?.iid] || [];
      }
      if (cmd === 'mr_discussions') {
        const { DEMO_DISCUSSIONS } = await import('./features/mr/fixtures');
        return DEMO_DISCUSSIONS[args?.iid] || [];
      }
      if (cmd === 'mr_pipelines') {
        const { DEMO_MERGE_REQUESTS } = await import('./features/mr/fixtures');
        const m = DEMO_MERGE_REQUESTS.find((mr) => mr.iid === args?.iid);
        return m?.headPipeline ? [m.headPipeline] : [];
      }
      if (cmd === 'mr_checkout') {
        return `Switched to branch 'mr-${args?.iid}'`;
      }
      if (cmd === 'mr_evaluate_merge_status') {
        return {
          mergeable: args?.status === 'mergeable' || args?.status === 'can_be_merged',
          canMwps: args?.status === 'ci_still_running',
          reason: args?.status,
        };
      }

      // AI Agents (Phase 5 Track A)
      if (cmd === 'agent_list_slots') {
        const { DEMO_SLOTS } = await import('./features/agents/fixtures');
        return DEMO_SLOTS;
      }
      if (cmd === 'agent_detect_hermes') {
        const { DEMO_HERMES_DETECTION } = await import('./features/agents/fixtures');
        return DEMO_HERMES_DETECTION;
      }
      if (cmd === 'agent_load_team') {
        const { DEMO_TEAM_CONFIG } = await import('./features/agents/fixtures');
        return DEMO_TEAM_CONFIG;
      }
      if (cmd === 'agent_list_pending_permissions') {
        const { DEMO_PENDING_PERMISSIONS } = await import('./features/agents/fixtures');
        return DEMO_PENDING_PERMISSIONS;
      }
      if (cmd === 'agent_list_proposals') {
        const { DEMO_PROPOSALS } = await import('./features/agents/fixtures');
        return DEMO_PROPOSALS;
      }
      if (cmd === 'agent_get_usage') {
        const { DEMO_USAGE_REPORTS } = await import('./features/agents/fixtures');
        return DEMO_USAGE_REPORTS[args?.slotId] || { reported: false, displayText: 'tidak melapor' };
      }
      if (cmd === 'agent_start' || cmd === 'agent_add_slot' || cmd === 'agent_update_slot') {
        const { DEMO_SLOTS } = await import('./features/agents/fixtures');
        return DEMO_SLOTS[0];
      }
      if (cmd === 'agent_prompt') {
        return {
          sessionId: `demo-${args?.slotId || 's1'}`,
          message: `[DEMO] Agent responded to: "${args?.prompt || ''}"`,
          stopReason: 'end_turn',
        };
      }
      if (cmd.startsWith('agent_')) {
        return null;
      }

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
import { logcatStore } from './features/run/logcatStore.svelte';
import type { LogLine } from './lib/api';

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

if (typeof window !== 'undefined') {
  (window as any).__FRAME_TIMES__ = [];
  let lastFrame = performance.now();
  let frameCount = 0;
  const trackFrames = () => {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    if (frameCount > 5) {
      (window as any).__FRAME_TIMES__.push(dt);
    }
    frameCount++;
    requestAnimationFrame(trackFrames);
  };
  requestAnimationFrame(trackFrames);

  (window as any).__GET_PERF_METRICS__ = () => {
    const times: number[] = (window as any).__FRAME_TIMES__ || [];
    if (times.length === 0) return { avg: 16.6, min: 16.6, max: 16.6, p95: 16.6, count: 0 };
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return { avg, min, max, p95, count: times.length };
  };
}

if (typeof window !== 'undefined' && (window.location.search.includes('tab=logcat') || window.location.search.includes('logcat'))) {
  const dummyLogs: LogLine[] = [
    { ts: '10:42:18.204', pid: 12345, tid: 12360, level: 'D', tag: 'Checkout', msg: 'applyVoucher(code=HEMAT50)' },
    { ts: '10:42:18.377', pid: 12345, tid: 12362, level: 'I', tag: 'OkHttp', msg: '--> POST /v2/cart/voucher' },
    { ts: '10:42:18.912', pid: 12345, tid: 12362, level: 'I', tag: 'OkHttp', msg: '<-- 200 OK (534ms, 0-byte body)' },
    { ts: '10:42:19.020', pid: 12345, tid: 12360, level: 'W', tag: 'Checkout', msg: 'voucher response empty, retrying with fallback' },
    { ts: '10:42:19.311', pid: 12345, tid: 12345, level: 'E', tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main — IllegalStateException: voucher must not be null' },
    { ts: '10:42:19.315', pid: 12345, tid: 12345, level: 'E', tag: 'AndroidRuntime', msg: '    at id.shop.checkout.CartRepository.applyVoucher(CartRepository.kt:48)' },
    { ts: '10:42:19.316', pid: 12345, tid: 12345, level: 'E', tag: 'AndroidRuntime', msg: '    at id.shop.checkout.CheckoutCubit.submit(CheckoutCubit.kt:112)' },
    { ts: '10:42:19.320', pid: 12345, tid: 12345, level: 'E', tag: 'AndroidRuntime', msg: '    at android.os.Handler.dispatchMessage(Handler.java:106)' },
    { ts: '10:42:19.410', pid: 12345, tid: 12365, level: 'I', tag: 'Flutter', msg: 'package:id_shop/features/checkout.dart:42:10 Flutter exception handled' },
    { ts: '10:42:19.415', pid: 12345, tid: 12365, level: 'D', tag: 'Flutter', msg: 'lib/features/cart.dart:15:3 rebuild completed' },
    { ts: '10:42:19.500', pid: 12345, tid: 12360, level: 'I', tag: 'ActivityManager', msg: 'Displayed id.shop.lite/.MainActivity: +412ms' },
  ];
  setTimeout(() => {
    logcatStore.handleBatch(dummyLogs);
  }, 100);

  if (window.location.search.includes('feed=synthetic') || window.location.search.includes('bench-feed')) {
    let feedCounter = 1;
    const interval = setInterval(() => {
      const batch: LogLine[] = [];
      const tags = ['OkHttp', 'Checkout', 'Flutter', 'AndroidRuntime', 'ActivityManager', 'SurfaceView'];
      const levels: Array<'V' | 'D' | 'I' | 'W' | 'E'> = ['D', 'I', 'I', 'W', 'D'];
      const now = new Date();
      const ts = `${now.toTimeString().split(' ')[0]}.${String(now.getMilliseconds()).padStart(3, '0')}`;
      for (let i = 0; i < 100; i++) {
        const idx = feedCounter++;
        const lvl = idx % 20 === 0 ? 'E' : levels[idx % levels.length];
        const tag = idx % 20 === 0 ? 'AndroidRuntime' : tags[idx % tags.length];
        const msg = idx % 20 === 0
          ? `FATAL ERROR at id.shop.checkout.CartRepository.applyVoucher(CartRepository.kt:48) event #${idx}`
          : idx % 15 === 0
          ? `package:id_shop/features/checkout.dart:42:10 stream packet #${idx}`
          : `Processed network event batch item #${idx} payload OK`;
        batch.push({
          ts,
          pid: 12345,
          tid: 12360,
          level: lvl,
          tag,
          msg,
        });
      }
      logcatStore.handleBatch(batch);
    }, 50);

    setTimeout(() => clearInterval(interval), 10000);
  }
}

if (typeof window !== 'undefined') {
  if (window.location.search.includes('b3-devices') || window.location.search.includes('panel=devices')) {
    setTimeout(async () => {
      const { panelStore } = await import('./shell/panelStore.svelte');
      panelStore.openRightPanel('devices');
    }, 150);
  }
  if (window.location.search.includes('b3-mirror') || window.location.search.includes('panel=mirror')) {
    setTimeout(async () => {
      const { panelStore } = await import('./shell/panelStore.svelte');
      panelStore.openRightPanel('mirror');
    }, 150);
  }
  if (window.location.search.includes('b3-starting')) {
    setTimeout(async () => {
      const { runStore } = await import('./features/run/runStore.svelte');
      runStore.uiState = 'starting';
    }, 150);
  }
  if (window.location.search.includes('b3-running')) {
    setTimeout(async () => {
      const { runStore } = await import('./features/run/runStore.svelte');
      runStore.uiState = 'running';
    }, 150);
  }
  if (window.location.search.includes('b3-error')) {
    setTimeout(async () => {
      const { runStore } = await import('./features/run/runStore.svelte');
      runStore.uiState = 'error';
    }, 150);
  }
  if (window.location.search.includes('b3-ghost-suggest') || window.location.search.includes('ghost-suggest')) {
    setTimeout(async () => {
      const { tabsManager } = await import('./features/editor/tabs.svelte');
      const { setGhostTextEffect } = await import('./features/editor/ghostText.ts');
      const content = 'import "package:flutter/material.dart";\n\nclass PinInputPage extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) {\n    final field = ITextF\n    return Container();\n  }\n}\n';
      const pos = content.indexOf('ITextF') + 'ITextF'.length;
      tabsManager.openTab('lib/widgets/pin_input.dart', 'pin_input.dart', content);

      setTimeout(() => {
        const view = (window as any).__PETAK_EDITOR_VIEW__;
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content },
            selection: { anchor: pos, head: pos },
            effects: [setGhostTextEffect.of({ text: 'ieldPin(controller: , focusNode: ,)', from: pos })],
          });
          view.focus();
        }
      }, 100);
    }, 150);
  }
  if (window.location.search.includes('b3-ghost-accepted')) {
    setTimeout(async () => {
      const { tabsManager } = await import('./features/editor/tabs.svelte');
      const content = 'import "package:flutter/material.dart";\n\nclass PinInputPage extends StatelessWidget {\n  @override\n  Widget build(BuildContext context) {\n    final field = ITextFieldPin(controller: , focusNode: ,)\n    return Container();\n  }\n}\n';
      const pos = content.indexOf('focusNode: ,)') + 'focusNode: ,)'.length;
      tabsManager.openTab('lib/widgets/pin_input.dart', 'pin_input.dart', content);

      setTimeout(() => {
        const view = (window as any).__PETAK_EDITOR_VIEW__;
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content },
            selection: { anchor: pos, head: pos },
          });
          view.focus();
        }
      }, 100);
    }, 150);
  }
  if (window.location.search.includes('b3-ghost-settings')) {
    setTimeout(async () => {
      const { toolchainStore } = await import('./features/toolchain/toolchainStore.svelte');
      toolchainStore.settingsModalOpen = true;
      setTimeout(() => {
        const el = document.querySelector('.toggle-setting');
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
      }, 150);
    }, 150);
  }
}

export default app;

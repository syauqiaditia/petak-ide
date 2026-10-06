import {
  api,
  type GitRepoStatus,
  type GitBranchInfo,
  type GitStatusEntry,
  type GitDiffFile,
  type GitCommit,
  type GitGraphRow,
  type GitBranchList,
  type GitLogFilter,
  type GitCommitFile,
  type GitBackupRef,
  type GitOpState,
  type GitConflictFile,
  type GitRemote,
  type GitOpResult,
  type GitResetMode,
} from '../../lib/api';

export interface GitCheckoutProgress {
  active: boolean;
  target: string;
  step: string;
  command: string;
  startTime: number;
}

class GitStore {
  root = $state<string>('');
  status = $state<GitRepoStatus | null>(null);
  loading = $state<boolean>(false);
  error = $state<string | null>(null);
  checkoutProgress = $state<GitCheckoutProgress | null>(null);

  selectedFile = $state<{ path: string; kind: 'worktree' | 'staged' } | null>(null);
  diffFiles = $state<GitDiffFile[]>([]);
  diffLoading = $state<boolean>(false);
  diffError = $state<string | null>(null);

  diffMode = $state<'sbs' | 'unified'>('sbs');
  ignoreWs = $state<boolean>(false);

  // In-memory checked commit paths per repo root (Bug 4)
  checkedPathsByRepo = $state<Record<string, Record<string, boolean>>>({});

  isPathChecked(filePath: string): boolean {
    if (!this.root) return false;
    const repoMap = this.checkedPathsByRepo[this.root];
    if (!repoMap || repoMap[filePath] === undefined) {
      return false; // default unchecked
    }
    return repoMap[filePath];
  }

  togglePathChecked(filePath: string) {
    if (!this.root) return;
    if (!this.checkedPathsByRepo[this.root]) {
      this.checkedPathsByRepo[this.root] = {};
    }
    const current = this.isPathChecked(filePath);
    this.checkedPathsByRepo[this.root][filePath] = !current;
  }

  setPathChecked(filePath: string, checked: boolean) {
    if (!this.root) return;
    if (!this.checkedPathsByRepo[this.root]) {
      this.checkedPathsByRepo[this.root] = {};
    }
    this.checkedPathsByRepo[this.root][filePath] = checked;
  }

  setAllPathsChecked(paths: string[], checked: boolean) {
    if (!this.root) return;
    if (!this.checkedPathsByRepo[this.root]) {
      this.checkedPathsByRepo[this.root] = {};
    }
    for (const p of paths) {
      this.checkedPathsByRepo[this.root][p] = checked;
    }
  }

  getCheckedPathsList(allPaths: string[]): string[] {
    return allPaths.filter((p) => this.isPathChecked(p));
  }

  // Log & branches state
  branches = $state<GitBranchList | null>(null);
  branchesLoading = $state<boolean>(false);
  currentBranch = $state<string | null>(null);

  logCommits = $state<GitCommit[]>([]);
  logGraph = $state<GitGraphRow[]>([]);
  nextCursor = $state<number | null>(0);
  logLoading = $state<boolean>(false);
  logError = $state<string | null>(null);
  logFilter = $state<GitLogFilter>({ branches: [] });

  selectedCommitSha = $state<string | null>(null);
  selectedCommitShas = $state<string[]>([]);
  lastSelectedIdx = $state<number>(0);
  commitFiles = $state<GitCommitFile[]>([]);
  commitFilesLoading = $state<boolean>(false);

  commitDiffOpen = $state<boolean>(false);
  commitDiffFile = $state<GitDiffFile | null>(null);
  commitDiffPath = $state<string>('');

  // Backup & undo state
  backups = $state<GitBackupRef[]>([]);
  backupsLoading = $state<boolean>(false);

  // Op state (rebase / merge / cherry-pick / revert)
  opState = $state<GitOpState | null>(null);

  // Conflict state
  conflicts = $state<GitConflictFile[]>([]);
  conflictsLoading = $state<boolean>(false);

  // Remotes
  remotes = $state<GitRemote[]>([]);

  // Stash state
  stashCount = $state<number>(0);
  isStashModalOpen = $state<boolean>(false);
  stashModalMode = $state<'push' | 'list'>('push');

  openStash() {
    this.stashModalMode = 'push';
    this.isStashModalOpen = true;
  }

  openUnstash() {
    this.stashModalMode = 'list';
    this.isStashModalOpen = true;
  }

  closeStash() {
    this.isStashModalOpen = false;
  }

  // Push modal state
  isPushModalOpen = $state<boolean>(false);

  openPushModal() {
    this.isPushModalOpen = true;
  }

  closePushModal() {
    this.isPushModalOpen = false;
  }

  // Rebase branch modal state (ala Android Studio)
  isRebaseModalOpen = $state<boolean>(false);

  openRebaseModal() {
    this.isRebaseModalOpen = true;
  }

  closeRebaseModal() {
    this.isRebaseModalOpen = false;
  }

  // Active sub tab ('commit' | 'log' | 'stash' | 'conflict')
  activeSubTab = $state<'commit' | 'log' | 'stash' | 'conflict'>(
    typeof window !== 'undefined' && (window.location.search.includes('log') || window.location.search.includes('sub=log'))
      ? 'log'
      : typeof window !== 'undefined' && window.location.search.includes('conflict')
      ? 'conflict'
      : 'commit'
  );

  // Toast / notification banner with Undo support
  toast = $state<{
    message: string;
    type?: 'info' | 'error' | 'success' | 'warning';
    backupRef?: string | null;
  } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  get branch(): GitBranchInfo | null {
    return this.status?.branch ?? null;
  }

  get statusMap(): Map<string, GitStatusEntry> {
    const map = new Map<string, GitStatusEntry>();
    if (this.status?.entries) {
      for (const entry of this.status.entries) {
        map.set(entry.path, entry);
      }
    }
    return map;
  }

  get changedDirsSet(): Set<string> {
    const set = new Set<string>();
    if (this.status?.entries) {
      for (const entry of this.status.entries) {
        const parts = entry.path.split('/');
        parts.pop();
        let cur = '';
        for (const p of parts) {
          cur = cur ? `${cur}/${p}` : p;
          set.add(cur);
        }
      }
    }
    return set;
  }

  get stagedEntries(): GitStatusEntry[] {
    if (!this.status?.entries) return [];
    return this.status.entries.filter(
      (e) => e.index !== 'unmodified' && e.index !== 'untracked'
    );
  }

  get changesEntries(): GitStatusEntry[] {
    if (!this.status?.entries) return [];
    return this.status.entries.filter(
      (e) => e.worktree !== 'unmodified' && e.worktree !== 'untracked'
    );
  }

  get untrackedEntries(): GitStatusEntry[] {
    if (!this.status?.entries) return [];
    return this.status.entries.filter((e) => e.worktree === 'untracked');
  }

  get conflictedEntries(): GitStatusEntry[] {
    if (!this.status?.entries) return [];
    return this.status.entries.filter((e) => e.conflicted);
  }

  get currentDiffFile(): GitDiffFile | null {
    if (!this.diffFiles || this.diffFiles.length === 0) return null;
    if (this.selectedFile) {
      const match = this.diffFiles.find(
        (f) =>
          f.newPath === this.selectedFile?.path ||
          f.oldPath === this.selectedFile?.path
      );
      if (match) return match;
    }
    return this.diffFiles[0];
  }

  get selectedCommit(): GitCommit | null {
    if (!this.selectedCommitSha) return null;
    return this.logCommits.find((c) => c.sha === this.selectedCommitSha) ?? null;
  }

  get selectedCommits(): GitCommit[] {
    if (this.selectedCommitShas.length === 0) {
      return this.selectedCommit ? [this.selectedCommit] : [];
    }
    const set = new Set(this.selectedCommitShas);
    return this.logCommits.filter((c) => set.has(c.sha));
  }

  async refresh(targetRoot?: string): Promise<void> {
    const rootPath = targetRoot ?? this.root;
    if (!rootPath) return;
    this.root = rootPath;
    this.loading = true;
    try {
      const res = await api.gitStatus(rootPath);
      this.status = res;
      this.error = null;

      // Realtime stash count update
      api.gitStashList(rootPath).then((stashes) => {
        this.stashCount = stashes.length;
      }).catch(() => {
        this.stashCount = 0;
      });

      if (this.selectedFile) {
        const stillPresent = res.entries.some((e) => e.path === this.selectedFile?.path);
        if (stillPresent) {
          await this.loadDiff();
        } else {
          const next =
            this.stagedEntries[0] ||
            this.changesEntries[0] ||
            this.untrackedEntries[0];
          if (next) {
            const kind =
              next.index !== 'unmodified' && next.index !== 'untracked'
                ? 'staged'
                : 'worktree';
            this.selectedFile = { path: next.path, kind };
            await this.loadDiff();
          } else {
            this.selectedFile = null;
            this.diffFiles = [];
          }
        }
      } else {
        const first =
          this.stagedEntries[0] ||
          this.changesEntries[0] ||
          this.untrackedEntries[0];
        if (first) {
          const kind =
            first.index !== 'unmodified' && first.index !== 'untracked'
              ? 'staged'
              : 'worktree';
          this.selectedFile = { path: first.path, kind };
          await this.loadDiff();
        }
      }
    } catch (e: any) {
      this.error = String(e);
      this.status = null;
    } finally {
      this.loading = false;
      // Also refresh branches and log asynchronously
      this.loadBranches().catch(() => {});
      this.loadLog(true).catch(() => {});
      this.loadBackups().catch(() => {});
      this.loadOpState().catch(() => {});
      this.loadRemotes().catch(() => {});
      if (this.conflictedEntries.length > 0 || this.opState?.kind !== 'none') {
        this.loadConflicts().catch(() => {});
      }
    }
  }

  handleFsChanged(_paths: string[]) {
    if (this.checkoutProgress?.active) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.refresh();
    }, 150);
  }

  async selectFile(path: string, kind: 'worktree' | 'staged') {
    this.selectedFile = { path, kind };
    await this.loadDiff();
  }

  async setIgnoreWs(val: boolean) {
    this.ignoreWs = val;
    await this.loadDiff();
  }

  async setDiffMode(mode: 'sbs' | 'unified') {
    this.diffMode = mode;
  }

  async loadDiff() {
    if (!this.root || !this.selectedFile) {
      this.diffFiles = [];
      return;
    }
    this.diffLoading = true;
    this.diffError = null;
    try {
      let files = await api.gitDiff(this.root, {
        kind: this.selectedFile.kind,
        path: this.selectedFile.path,
        ignoreWs: this.ignoreWs,
      });
      // Fallback otomatis: jika diff yang diminta mengembalikan 0 file, coba otomatis kind lawannya sehingga diff SELALU tampil
      if ((!files || files.length === 0) && this.selectedFile) {
        const oppositeKind = this.selectedFile.kind === 'staged' ? 'worktree' : 'staged';
        const fallbackFiles = await api.gitDiff(this.root, {
          kind: oppositeKind,
          path: this.selectedFile.path,
          ignoreWs: this.ignoreWs,
        });
        if (fallbackFiles && fallbackFiles.length > 0) {
          files = fallbackFiles;
          this.selectedFile.kind = oppositeKind;
        }
      }
      this.diffFiles = files;
    } catch (e: any) {
      this.diffError = String(e);
      this.diffFiles = [];
    } finally {
      this.diffLoading = false;
    }
  }

  async stageFiles(paths: string[]) {
    if (!this.root || paths.length === 0) return;
    await api.gitStageFiles(this.root, paths);
    await this.refresh();
  }

  async unstageFiles(paths: string[]) {
    if (!this.root || paths.length === 0) return;
    await api.gitUnstageFiles(this.root, paths);
    await this.refresh();
  }

  async stageAll() {
    if (!this.root) return;
    const paths = [...this.changesEntries, ...this.untrackedEntries].map((e) => e.path);
    if (paths.length > 0) {
      await api.gitStageFiles(this.root, paths);
      await this.refresh();
    }
  }

  async unstageAll() {
    if (!this.root) return;
    const paths = this.stagedEntries.map((e) => e.path);
    if (paths.length > 0) {
      await api.gitUnstageFiles(this.root, paths);
      await this.refresh();
    }
  }

  async rollback(paths: string[]) {
    if (!this.root || paths.length === 0) return;
    await api.gitRollback(this.root, paths);
    await this.refresh();
  }

  async stageHunk(path: string, hunkIndex: number) {
    if (!this.root) return;
    await api.gitStageHunk(this.root, path, hunkIndex);
    await this.refresh();
  }

  async unstageHunk(path: string, hunkIndex: number) {
    if (!this.root) return;
    await api.gitUnstageHunk(this.root, path, hunkIndex);
    await this.refresh();
  }

  async commit(message: string, amend = false): Promise<string> {
    if (!this.root) throw new Error('No repository open');
    const res = await api.gitCommit(this.root, message, amend);
    await this.refresh();
    return res;
  }

  async getLastMessage(): Promise<string | null> {
    if (!this.root) return null;
    return await api.gitLastMessage(this.root);
  }

  async loadBranches(): Promise<void> {
    if (!this.root) return;
    this.branchesLoading = true;
    try {
      this.branches = await api.gitBranches(this.root);
      const curr = this.branches?.local?.find((b) => b.isCurrent);
      if (curr) {
        this.currentBranch = curr.name;
      } else {
        const b = await api.gitBranch(this.root);
        this.currentBranch = b || null;
      }
    } catch (e: any) {
      console.error('Failed to load branches:', e);
      try {
        const b = await api.gitBranch(this.root);
        this.currentBranch = b || null;
      } catch {
        // ignore
      }
    } finally {
      this.branchesLoading = false;
    }
  }

  async loadLog(reset = false): Promise<void> {
    if (!this.root) return;
    if (this.logLoading) return;
    this.logLoading = true;
    this.logError = null;

    if (reset) {
      this.nextCursor = 0;
      this.logCommits = [];
      this.logGraph = [];
    }

    const cursor = reset ? 0 : (this.nextCursor ?? 0);
    try {
      const page = await api.gitLog(this.root, this.logFilter, cursor, 50);
      if (reset) {
        this.logCommits = page.commits;
        this.logGraph = page.graph;
      } else {
        this.logCommits = [...this.logCommits, ...page.commits];
        this.logGraph = [...this.logGraph, ...page.graph];
      }
      this.nextCursor = page.nextCursor;

      // Select first commit if none selected
      if (!this.selectedCommitSha && this.logCommits.length > 0) {
        await this.selectCommit(this.logCommits[0].sha);
      }
    } catch (e: any) {
      this.logError = String(e);
    } finally {
      this.logLoading = false;
    }
  }

  async loadMoreLog(): Promise<void> {
    if (this.logLoading || this.nextCursor === null) return;
    await this.loadLog(false);
  }

  async setLogFilter(newFilter: Partial<GitLogFilter>): Promise<void> {
    this.logFilter = { ...this.logFilter, ...newFilter };
    await this.loadLog(true);
  }

  async selectCommit(sha: string, multi = false, shift = false): Promise<void> {
    const idx = this.logCommits.findIndex((c) => c.sha === sha);
    if (idx === -1) return;

    if (shift && this.lastSelectedIdx !== null && this.lastSelectedIdx !== undefined) {
      const start = Math.min(this.lastSelectedIdx, idx);
      const end = Math.max(this.lastSelectedIdx, idx);
      const rangeShas = this.logCommits.slice(start, end + 1).map((c) => c.sha);
      this.selectedCommitShas = rangeShas;
      this.selectedCommitSha = sha;
    } else if (multi) {
      const current = new Set(this.selectedCommitShas);
      if (current.has(sha)) {
        current.delete(sha);
      } else {
        current.add(sha);
      }
      this.selectedCommitShas = Array.from(current);
      this.selectedCommitSha = sha;
      this.lastSelectedIdx = idx;
    } else {
      this.selectedCommitSha = sha;
      this.selectedCommitShas = [sha];
      this.lastSelectedIdx = idx;
    }

    // Load commit files for selected commit
    this.commitFilesLoading = true;
    try {
      this.commitFiles = await api.gitCommitFiles(this.root, sha);
    } catch (e: any) {
      console.error('Failed to load commit files:', e);
      this.commitFiles = [];
    } finally {
      this.commitFilesLoading = false;
    }
  }

  async openCommitDiff(file: GitCommitFile): Promise<void> {
    if (!this.root || !this.selectedCommitSha) return;
    this.commitDiffPath = file.path;
    this.commitDiffOpen = true;
    try {
      const diffs = await api.gitDiff(this.root, {
        kind: 'commit',
        sha: this.selectedCommitSha,
        path: file.path,
        ignoreWs: this.ignoreWs,
      });
      this.commitDiffFile = diffs[0] ?? null;
    } catch (e: any) {
      console.error('Failed to load commit diff:', e);
      this.commitDiffFile = null;
    }
  }

  closeCommitDiff(): void {
    this.commitDiffOpen = false;
    this.commitDiffFile = null;
    this.commitDiffPath = '';
  }

  showToast(
    message: string,
    opts?: {
      type?: 'info' | 'error' | 'success' | 'warning';
      backupRef?: string | null;
      duration?: number;
    }
  ) {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toast = {
      message,
      type: opts?.type ?? 'info',
      backupRef: opts?.backupRef ?? null,
    };
    const duration = opts?.duration ?? (opts?.backupRef ? 10000 : 5000);
    this.toastTimer = setTimeout(() => {
      this.clearToast();
    }, duration);
  }

  clearToast() {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toast = null;
  }

  async undoBackup(backupRef: string): Promise<void> {
    if (!this.root || !backupRef) return;
    try {
      await api.gitBackupRestore(this.root, backupRef);
      this.showToast(`Restored to backup ${backupRef}`, { type: 'success' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Restore backup failed: ${e}`, { type: 'error' });
    }
  }

  async loadBackups(): Promise<void> {
    if (!this.root) return;
    this.backupsLoading = true;
    try {
      this.backups = await api.gitBackupList(this.root);
    } catch (e: any) {
      console.error('Failed to load backups:', e);
    } finally {
      this.backupsLoading = false;
    }
  }

  async deleteBackup(name: string): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitBackupDelete(this.root, name);
      this.showToast(`Backup ${name} deleted`, { type: 'info' });
      await this.loadBackups();
    } catch (e: any) {
      this.showToast(`Delete backup failed: ${e}`, { type: 'error' });
    }
  }

  async restoreBackup(name: string): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitBackupRestore(this.root, name);
      this.showToast(`Branch reset to backup ${name}`, { type: 'success' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Reset to backup failed: ${e}`, { type: 'error' });
    }
  }

  async loadOpState(): Promise<void> {
    if (!this.root) return;
    try {
      const state = await api.gitOpState(this.root);
      this.opState = state;
      if (state.kind !== 'none') {
        await this.loadConflicts();
      }
    } catch (e: any) {
      console.error('Failed to load op state:', e);
    }
  }

  async opContinue(): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitOpContinue(this.root);
      if (res.ok) {
        if (res.stashConflict) {
          this.showToast(
            'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
            { type: 'warning' }
          );
        } else {
          this.showToast('Operation continued successfully', { type: 'success', backupRef: res.backupRef });
        }
      } else {
        this.showToast('Operation stopped due to conflicts', { type: 'warning' });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Continue failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async opAbort(): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitOpAbort(this.root);
      this.showToast('Operation aborted', { type: 'info' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Abort failed: ${e}`, { type: 'error' });
    }
  }

  async loadConflicts(): Promise<void> {
    if (!this.root) return;
    this.conflictsLoading = true;
    try {
      this.conflicts = await api.gitConflicts(this.root);
    } catch (e: any) {
      console.error('Failed to load conflicts:', e);
    } finally {
      this.conflictsLoading = false;
    }
  }

  async loadRemotes(): Promise<void> {
    if (!this.root) return;
    try {
      this.remotes = await api.gitRemotes(this.root);
    } catch (e: any) {
      console.error('Failed to load remotes:', e);
    }
  }

  async fetchRemote(remote?: string): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitFetch(this.root, remote);
      this.showToast('Fetch completed: remote updates received', { type: 'success' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Fetch failed: ${e}`, { type: 'error' });
    }
  }

  async pullRemote(mode: 'rebase' | 'merge'): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitPull(this.root, mode);
      if (res.ok) {
        this.showToast(`Pull (${mode}) succeeded`, { type: 'success' });
      } else {
        this.showToast(`Pull stopped: conflicts detected`, { type: 'warning' });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Pull failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async pushRemote(
    remote: string,
    branch: string,
    setUpstream: boolean,
    forceWithLease: boolean
  ): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitPush(this.root, remote, branch, setUpstream, forceWithLease);
      this.showToast(`Pushed to ${remote}/${branch}`, { type: 'success' });
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Push failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async branchCheckout(name: string, autoStash: boolean = true): Promise<void> {
    if (!this.root) return;
    const cleanName = name.startsWith('origin/') ? name.slice(7) : name;

    this.checkoutProgress = {
      active: true,
      target: name,
      step: autoStash ? 'Menyimpan perubahan lokal (Auto-stash)…' : 'Memeriksa commit & working tree…',
      command: `git checkout ${name}`,
      startTime: Date.now(),
    };

    // Give browser event loop time to render the frosted glass HUD
    await new Promise((r) => setTimeout(r, 60));

    const stepTimer = setTimeout(() => {
      if (this.checkoutProgress) {
        this.checkoutProgress.step = `Mengalihkan working tree ke '${cleanName}'…`;
      }
    }, 400);

    const stepTimer2 = setTimeout(() => {
      if (this.checkoutProgress) {
        this.checkoutProgress.step = `Menyinkronkan status berkas proyek di disk…`;
      }
    }, 1200);

    try {
      const res = await api.gitCheckout(this.root, name, autoStash);
      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);

      if (this.checkoutProgress) {
        this.checkoutProgress.step = res.stashed
          ? 'Memulihkan perubahan lokal (Stash pop)…'
          : 'Selesai beralih cabang.';
      }

      this.currentBranch = cleanName;
      const stashMsg = res.stashed ? (res.stashPopped ? ' (changes auto-stashed & restored)' : ' (changes stashed)') : '';
      
      await new Promise((r) => setTimeout(r, 180));
      await this.refresh();
      await this.loadBranches();
      this.showToast(`Switched to branch '${cleanName}'${stashMsg}`, { type: 'success' });
    } catch (e: any) {
      clearTimeout(stepTimer);
      clearTimeout(stepTimer2);
      this.showToast(`Checkout failed: ${e}`, { type: 'error' });
    } finally {
      this.checkoutProgress = null;
    }
  }

  async branchCreate(name: string, startPoint?: string | null): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitBranchCreate(this.root, name, startPoint);
      this.showToast(`Branch '${name}' created`, { type: 'success' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Create branch failed: ${e}`, { type: 'error' });
    }
  }

  async branchDelete(name: string, force = false): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitBranchDelete(this.root, name, force);
      this.showToast(`Branch '${name}' berhasil dihapus`, { type: 'info' });
      await this.refresh();
    } catch (e: any) {
      const err = String(e?.message || e);
      if (!force && (err.toLowerCase().includes('not fully merged') || err.toLowerCase().includes('-d'))) {
        try {
          await api.gitBranchDelete(this.root, name, true);
          this.showToast(`Branch '${name}' dipaksa hapus (-D)`, { type: 'info' });
          await this.refresh();
          return;
        } catch (e2: any) {
          this.showToast(`Gagal hapus branch: ${e2}`, { type: 'error' });
          return;
        }
      }
      this.showToast(`Gagal hapus branch: ${err}`, { type: 'error' });
    }
  }

  async branchRename(oldName: string, newName: string): Promise<void> {
    if (!this.root) return;
    try {
      await api.gitBranchRename(this.root, oldName, newName);
      this.showToast(`Branch renamed: '${oldName}' → '${newName}'`, { type: 'success' });
      await this.refresh();
    } catch (e: any) {
      this.showToast(`Rename branch failed: ${e}`, { type: 'error' });
    }
  }

  async squashCommits(shas: string[], message: string): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitSquash(this.root, shas, message);
      if (res.stashConflict) {
        this.showToast(
          'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
          { type: 'warning' }
        );
      } else {
        this.showToast(`Squashed ${shas.length} commit(s)`, {
          type: 'success',
          backupRef: res.backupRef,
        });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Squash failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async rewordCommit(sha: string, message: string): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitReword(this.root, sha, message);
      if (res.stashConflict) {
        this.showToast(
          'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
          { type: 'warning' }
        );
      } else {
        this.showToast(`Commit message updated`, {
          type: 'success',
          backupRef: res.backupRef,
        });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Reword failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async fixupCommit(sha: string): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitFixup(this.root, sha);
      if (res.stashConflict) {
        this.showToast(
          'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
          { type: 'warning' }
        );
      } else {
        this.showToast(`Fixed up into previous commit`, {
          type: 'success',
          backupRef: res.backupRef,
        });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Fixup failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async dropCommits(shas: string[], keepChanges = true): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitDrop(this.root, shas, keepChanges);
      if (res.stashConflict) {
        this.showToast(
          'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
          { type: 'warning' }
        );
      } else {
        const msg = keepChanges
          ? `Dropped ${shas.length} commit(s) — perubahan dikembalikan ke Changes`
          : `Dropped ${shas.length} commit(s)`;
        this.showToast(msg, {
          type: 'info',
          backupRef: res.backupRef,
        });
      }
      if (keepChanges) {
        this.activeSubTab = 'commit';
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Drop failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async resetBranch(sha: string, mode: GitResetMode): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitReset(this.root, sha, mode);
      this.showToast(`Reset (${mode}) to ${sha.slice(0, 7)}`, {
        type: 'info',
        backupRef: res.backupRef,
      });
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Reset failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async cherryPickCommits(shas: string[]): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitCherryPick(this.root, shas);
      if (res.ok) {
        this.showToast(`Cherry-picked ${shas.length} commit(s)`, { type: 'success' });
      } else {
        this.showToast(`Cherry-pick stopped: conflicts detected`, { type: 'warning' });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Cherry-pick failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async revertCommits(shas: string[]): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitRevert(this.root, shas);
      if (res.ok) {
        this.showToast(`Reverted ${shas.length} commit(s)`, { type: 'success' });
      } else {
        this.showToast(`Revert stopped: conflicts detected`, { type: 'warning' });
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Revert failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async merge(branch: string): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitMerge(this.root, branch);
      if (res.ok) {
        if (res.stashConflict) {
          this.showToast(
            'Rebase done, but your local changes conflicted when restored — see Conflicts / git stash list',
            { type: 'warning' }
          );
        } else {
          this.showToast(`Merged branch '${branch}'`, { type: 'success', backupRef: res.backupRef });
        }
      } else {
        this.showToast('Merge stopped: conflicts detected', { type: 'warning' });
        await this.loadConflicts();
        this.activeSubTab = 'conflict';
      }
      await this.refresh();
      return res;
    } catch (e: any) {
      this.showToast(`Merge failed: ${e}`, { type: 'error' });
      throw e;
    }
  }

  async rebaseOnto(upstream: string): Promise<GitOpResult> {
    if (!this.root) throw new Error('No repository open');
    try {
      const res = await api.gitRebaseOnto(this.root, upstream);
      await this.refresh();
      await this.loadOpState();
      await this.loadConflicts();

      this.closeRebaseModal();

      if (!res.ok || res.stashConflict || this.conflicts.length > 0 || this.opState?.kind === 'rebase') {
        this.activeSubTab = 'conflict';
        this.showToast('Rebase terdapat konflik berkas. Dialihkan ke menu Conflicts.', { type: 'warning' });
      } else {
        this.showToast(`Rebased onto '${upstream}'`, { type: 'success', backupRef: res.backupRef });
      }
      return res;
    } catch (e: any) {
      await this.refresh().catch(() => {});
      await this.loadOpState().catch(() => {});
      await this.loadConflicts().catch(() => {});
      this.closeRebaseModal();
      if (this.conflicts.length > 0 || this.opState?.kind === 'rebase') {
        this.activeSubTab = 'conflict';
      }
      this.showToast(`Rebase failed: ${e}`, { type: 'error' });
      throw e;
    }
  }
}

export const gitStore = new GitStore();

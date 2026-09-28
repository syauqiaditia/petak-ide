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
} from '../../lib/api';

class GitStore {
  root = $state<string>('');
  status = $state<GitRepoStatus | null>(null);
  loading = $state<boolean>(false);
  error = $state<string | null>(null);

  selectedFile = $state<{ path: string; kind: 'worktree' | 'staged' } | null>(null);
  diffFiles = $state<GitDiffFile[]>([]);
  diffLoading = $state<boolean>(false);
  diffError = $state<string | null>(null);

  diffMode = $state<'sbs' | 'unified'>('sbs');
  ignoreWs = $state<boolean>(false);

  // Log & branches state
  branches = $state<GitBranchList | null>(null);
  branchesLoading = $state<boolean>(false);

  logCommits = $state<GitCommit[]>([]);
  logGraph = $state<GitGraphRow[]>([]);
  nextCursor = $state<number | null>(0);
  logLoading = $state<boolean>(false);
  logError = $state<string | null>(null);
  logFilter = $state<GitLogFilter>({});

  selectedCommitSha = $state<string | null>(null);
  selectedCommitShas = $state<string[]>([]);
  lastSelectedIdx = $state<number>(0);
  commitFiles = $state<GitCommitFile[]>([]);
  commitFilesLoading = $state<boolean>(false);

  commitDiffOpen = $state<boolean>(false);
  commitDiffFile = $state<GitDiffFile | null>(null);
  commitDiffPath = $state<string>('');

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
    }
  }

  handleFsChanged(_paths: string[]) {
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
      const files = await api.gitDiff(this.root, {
        kind: this.selectedFile.kind,
        path: this.selectedFile.path,
        ignoreWs: this.ignoreWs,
      });
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
    } catch (e: any) {
      console.error('Failed to load branches:', e);
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
}

export const gitStore = new GitStore();

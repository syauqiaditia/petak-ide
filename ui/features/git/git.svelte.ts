import {
  api,
  type GitRepoStatus,
  type GitBranchInfo,
  type GitStatusEntry,
  type GitDiffFile,
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
}

export const gitStore = new GitStore();

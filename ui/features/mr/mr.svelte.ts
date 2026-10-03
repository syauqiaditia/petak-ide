/**
 * Reactive store for GitLab MR Viewer (Svelte 5 runes).
 * Handles list fetching, filtering, MR detail, pipeline polling (15s), and demo mode.
 */
import { api } from '../../lib/api';
import type {
  MergeRequest,
  Discussion,
  PipelineInfo,
  GitLabUser,
  TokenScopeMode,
  MrFilter,
  MergeRequestParams,
  InlinePositionParams,
  CreateMrParams,
} from './types';
import type { GitDiffFile } from '../git/types';
import { filterMergeRequests, canWrite } from './mrLogic';
import {
  DEMO_CURRENT_USER,
  DEMO_MERGE_REQUESTS,
  DEMO_DIFF_FILES,
  DEMO_DISCUSSIONS,
} from './fixtures';

class MrStore {
  // State
  mergeRequests = $state<MergeRequest[]>([]);
  selectedIid = $state<number | null>(null);
  selectedMrDetail = $state<MergeRequest | null>(null);
  diffFiles = $state<GitDiffFile[]>([]);
  discussions = $state<Discussion[]>([]);
  pipelines = $state<PipelineInfo[]>([]);

  activeFilter = $state<MrFilter>('opened');
  searchQuery = $state<string>('');

  tokenScope = $state<TokenScopeMode>('none');
  currentUser = $state<GitLabUser | null>(null);
  isDemoMode = $state<boolean>(false);

  isLoadingList = $state<boolean>(false);
  isLoadingDetail = $state<boolean>(false);
  isMerging = $state<boolean>(false);
  actionError = $state<string | null>(null);
  actionSuccess = $state<string | null>(null);

  // Polling
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private currentFolderPath = '';

  // Derived
  filteredList = $derived(
    filterMergeRequests(
      this.mergeRequests,
      this.activeFilter,
      this.searchQuery,
      this.currentUser
    )
  );

  canPerformWrite = $derived(canWrite(this.tokenScope));

  /**
   * Initialize or refresh the MR viewer.
   */
  async init(folderPath: string = '') {
    this.currentFolderPath = folderPath;
    await this.checkTokenScope();
    await this.loadCurrentUser();
    await this.loadList();
  }

  /**
   * Check token scope from core.
   */
  async checkTokenScope() {
    try {
      const scope = await api.mrGetTokenScope(this.currentFolderPath);
      this.tokenScope = scope;
      if (scope === 'none') {
        // If no token, we remain in 'none' so empty state is displayed,
        // unless demo mode was manually triggered.
      }
    } catch {
      this.tokenScope = 'none';
    }
  }

  /**
   * Load authenticated user.
   */
  async loadCurrentUser() {
    if (this.isDemoMode) {
      this.currentUser = DEMO_CURRENT_USER;
      return;
    }
    if (this.tokenScope === 'none') {
      this.currentUser = null;
      return;
    }
    try {
      this.currentUser = await api.mrCurrentUser(this.currentFolderPath);
    } catch {
      this.currentUser = null;
    }
  }

  /**
   * Enable Demo Mode explicitly (Manager priority 2).
   */
  enableDemoMode() {
    this.isDemoMode = true;
    this.tokenScope = 'readOnly';
    this.currentUser = DEMO_CURRENT_USER;
    this.mergeRequests = DEMO_MERGE_REQUESTS;
    if (this.mergeRequests.length > 0 && !this.selectedIid) {
      this.selectMr(this.mergeRequests[0].iid);
    }
  }

  /**
   * Load merge request list.
   */
  async loadList() {
    if (this.isDemoMode) {
      this.mergeRequests = DEMO_MERGE_REQUESTS;
      return;
    }
    if (this.tokenScope === 'none') {
      this.mergeRequests = [];
      return;
    }

    this.isLoadingList = true;
    this.actionError = null;

    try {
      const res = await api.mrList({ state: 'opened' }, this.currentFolderPath);
      this.mergeRequests = res.items;
      if (this.mergeRequests.length > 0 && !this.selectedIid) {
        // Auto-select first item
        this.selectMr(this.mergeRequests[0].iid);
      }
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      this.mergeRequests = [];
    } finally {
      this.isLoadingList = false;
    }
  }

  /**
   * Select a merge request and load its full details, diffs, and discussions.
   */
  async selectMr(iid: number) {
    this.selectedIid = iid;
    this.stopPipelinePolling();
    this.isLoadingDetail = true;
    this.actionError = null;

    if (this.isDemoMode) {
      const mr = DEMO_MERGE_REQUESTS.find((m) => m.iid === iid) || null;
      this.selectedMrDetail = mr;
      this.diffFiles = DEMO_DIFF_FILES[iid] || [];
      this.discussions = DEMO_DISCUSSIONS[iid] || [];
      this.pipelines = mr?.headPipeline ? [mr.headPipeline] : [];
      this.isLoadingDetail = false;
      this.checkAndStartPipelinePolling();
      return;
    }

    try {
      const [detail, diffs, disc, pipes] = await Promise.all([
        api.mrDetail(iid, this.currentFolderPath),
        api.mrDiffs(iid, undefined, this.currentFolderPath),
        api.mrDiscussions(iid, this.currentFolderPath),
        api.mrPipelines(iid, this.currentFolderPath).catch(() => []),
      ]);

      this.selectedMrDetail = detail;
      this.diffFiles = diffs;
      this.discussions = disc;
      this.pipelines = pipes;

      this.checkAndStartPipelinePolling();
    } catch (e: any) {
      this.actionError = e?.message || String(e);
    } finally {
      this.isLoadingDetail = false;
    }
  }

  /**
   * Poll pipelines every 15s ONLY when detail is open and pipeline is running/pending.
   */
  private checkAndStartPipelinePolling() {
    this.stopPipelinePolling();

    const headPipe = this.selectedMrDetail?.headPipeline;
    const isRunning = headPipe?.status === 'running' || headPipe?.status === 'pending';

    if (isRunning && this.selectedIid) {
      this.pollTimer = setInterval(async () => {
        if (!this.selectedIid) {
          this.stopPipelinePolling();
          return;
        }
        try {
          if (this.isDemoMode) return;
          const pipes = await api.mrPipelines(this.selectedIid, this.currentFolderPath);
          this.pipelines = pipes;
          if (pipes.length > 0 && this.selectedMrDetail) {
            this.selectedMrDetail = {
              ...this.selectedMrDetail,
              headPipeline: pipes[0],
            };
            if (pipes[0].status !== 'running' && pipes[0].status !== 'pending') {
              this.stopPipelinePolling();
            }
          }
        } catch {
          // ignore polling failure
        }
      }, 15000);
    }
  }

  stopPipelinePolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Checkout local branch for MR.
   */
  async checkoutMr(iid: number): Promise<string> {
    this.actionError = null;
    try {
      const msg = await api.mrCheckout(iid, undefined, this.currentFolderPath);
      this.actionSuccess = msg;
      return msg;
    } catch (e: any) {
      const err = e?.message || String(e);
      this.actionError = err;
      throw new Error(err);
    }
  }

  /**
   * Create a new note/comment on MR.
   */
  async createNote(iid: number, body: string) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      const note = await api.mrCreateNote(iid, body, this.currentFolderPath);
      // Append to discussions as individual discussion
      const newDisc: Discussion = {
        id: `disc-${note.id}`,
        individualNote: true,
        notes: [note],
      };
      this.discussions = [...this.discussions, newDisc];
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Reply to an existing discussion.
   */
  async replyDiscussion(iid: number, discussionId: string, body: string) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      const note = await api.mrReplyDiscussion(iid, discussionId, body, this.currentFolderPath);
      this.discussions = this.discussions.map((d) => {
        if (d.id === discussionId) {
          return { ...d, notes: [...d.notes, note] };
        }
        return d;
      });
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Resolve / unresolve a discussion.
   */
  async resolveDiscussion(iid: number, discussionId: string, resolved: boolean) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      await api.mrResolveDiscussion(iid, discussionId, resolved, this.currentFolderPath);
      this.discussions = this.discussions.map((d) => {
        if (d.id === discussionId) {
          return {
            ...d,
            notes: d.notes.map((n) => ({ ...n, resolved })),
          };
        }
        return d;
      });
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Approve MR.
   */
  async approve(iid: number, sha?: string) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      await api.mrApprove(iid, sha, this.currentFolderPath);
      this.actionSuccess = 'Merge Request disetujui (Approved).';
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Unapprove MR.
   */
  async unapprove(iid: number) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      await api.mrUnapprove(iid, this.currentFolderPath);
      this.actionSuccess = 'Persetujuan Merge Request dibatalkan.';
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Execute merge with SHA validation.
   */
  async merge(iid: number, params: MergeRequestParams) {
    if (!this.canPerformWrite) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.isMerging = true;
    this.actionError = null;
    try {
      const merged = await api.mrMerge(iid, params, this.currentFolderPath);
      this.selectedMrDetail = merged;
      this.actionSuccess = `MR !${iid} berhasil di-merge.`;
      // Update item in list
      this.mergeRequests = this.mergeRequests.map((m) => (m.iid === iid ? merged : m));
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    } finally {
      this.isMerging = false;
    }
  }

  /**
   * Create a new Merge Request.
   */
  async createMr(params: CreateMrParams): Promise<MergeRequest> {
    if (!this.canPerformWrite && !this.isDemoMode) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      const newMr = await api.mrCreate(params, this.currentFolderPath);
      this.mergeRequests = [newMr, ...this.mergeRequests];
      this.selectMr(newMr.iid);
      this.actionSuccess = `Merge Request !${newMr.iid} berhasil dibuat.`;
      return newMr;
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Rebase MR source branch onto target branch.
   */
  async rebase(iid: number) {
    if (!this.canPerformWrite && !this.isDemoMode) {
      throw new Error("Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.");
    }
    this.actionError = null;
    try {
      await api.mrRebase(iid, this.currentFolderPath);
      this.actionSuccess = `Rebase MR !${iid} telah dimulai.`;
      if (this.selectedIid) {
        await this.selectMr(this.selectedIid);
      }
    } catch (e: any) {
      this.actionError = e?.message || String(e);
      throw e;
    }
  }

  /**
   * Destroy / cleanup when panel is closed.
   */
  destroy() {
    this.stopPipelinePolling();
  }
}

export const mrStore = new MrStore();

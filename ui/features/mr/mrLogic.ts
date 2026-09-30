/**
 * Pure logic for GitLab MR Viewer (filtering, scope checking, merge readiness, SHA validation).
 */
import type { MergeRequest, MrFilter, TokenScopeMode, GitLabUser, MergeStatusEvaluation } from './types';

/**
 * Filter MRs based on active tab and search query.
 */
export function filterMergeRequests(
  mrs: MergeRequest[],
  filter: MrFilter,
  search: string,
  currentUser: GitLabUser | null
): MergeRequest[] {
  let list = mrs;

  // 1. Filter by category
  switch (filter) {
    case 'opened':
      list = list.filter((mr) => mr.state === 'opened');
      break;
    case 'mine':
      if (currentUser) {
        list = list.filter((mr) => mr.author.id === currentUser.id);
      }
      break;
    case 'assigned':
      if (currentUser) {
        list = list.filter((mr) =>
          mr.assignees.some((a) => a.id === currentUser.id)
        );
      }
      break;
    case 'reviewer':
      if (currentUser) {
        list = list.filter((mr) =>
          mr.reviewers.some((r) => r.id === currentUser.id)
        );
      }
      break;
  }

  // 2. Filter by search query
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter((mr) => {
      const matchTitle = mr.title.toLowerCase().includes(q);
      const matchIid = `!${mr.iid}`.includes(q) || `${mr.iid}`.includes(q);
      const matchAuthor = mr.author.name.toLowerCase().includes(q) || mr.author.username.toLowerCase().includes(q);
      const matchBranch = mr.sourceBranch.toLowerCase().includes(q) || mr.targetBranch.toLowerCase().includes(q);
      return matchTitle || matchIid || matchAuthor || matchBranch;
    });
  }

  return list;
}

/**
 * Check if write operations are permitted for current token scope.
 */
export function canWrite(scope: TokenScopeMode): boolean {
  return scope === 'full';
}

export const SCOPE_DISABLED_TOOLTIP = "Aksi dinonaktifkan: token butuh scope 'api' untuk menulis ke GitLab.";

/**
 * Client-side evaluation of detailed merge status.
 */
export function evaluateMrMergeStatus(mr: MergeRequest): MergeStatusEvaluation {
  const status = mr.detailedMergeStatus || mr.mergeStatus || '';

  if (mr.state === 'merged') {
    return { mergeable: false, canMwps: false, reason: 'MR sudah di-merge' };
  }
  if (mr.state === 'closed') {
    return { mergeable: false, canMwps: false, reason: 'MR sudah ditutup' };
  }
  if (mr.hasConflicts || status === 'conflict' || status === 'cannot_be_merged') {
    return { mergeable: false, canMwps: false, reason: 'Ada konflik branch yang harus diselesaikan' };
  }
  if (mr.draft || mr.workInProgress || status === 'draft_status') {
    return { mergeable: false, canMwps: false, reason: 'MR masih berstatus Draft' };
  }
  if (status === 'discussions_not_resolved') {
    return { mergeable: false, canMwps: false, reason: 'Selesaikan semua diskusi sebelum merge' };
  }
  if (status === 'not_approved') {
    return { mergeable: false, canMwps: false, reason: 'Membutuhkan persetujuan reviewer' };
  }
  if (status === 'blocked_status') {
    return { mergeable: false, canMwps: false, reason: 'Menunggu dependensi MR' };
  }
  if (status === 'ci_still_running') {
    return { mergeable: false, canMwps: true, reason: 'Pipeline CI/CD sedang berjalan' };
  }
  if (status === 'mergeable' || status === 'can_be_merged') {
    return { mergeable: true, canMwps: false, reason: 'Siap di-merge' };
  }

  // Fallback
  return {
    mergeable: !mr.hasConflicts && !mr.draft,
    canMwps: mr.headPipeline?.status === 'running' || mr.headPipeline?.status === 'pending',
    reason: mr.hasConflicts ? 'Ada konflik branch' : 'Status: ' + status,
  };
}

/**
 * Validates that merge parameters contain a valid, non-empty commit SHA matching head SHA.
 */
export function validateMergeSha(requestedSha: string, mrHeadSha: string): { valid: boolean; error?: string } {
  if (!requestedSha || !requestedSha.trim()) {
    return { valid: false, error: 'Commit SHA tidak boleh kosong' };
  }
  if (requestedSha.trim().toLowerCase() !== mrHeadSha.trim().toLowerCase()) {
    return {
      valid: false,
      error: `Commit SHA (${requestedSha.slice(0, 8)}) tidak cocok dengan head MR (${mrHeadSha.slice(0, 8)}). Branch mungkin telah berubah.`,
    };
  }
  return { valid: true };
}

// GitLab MR Viewer types — mirrors crates/core/src/gitlab/model.rs (camelCase)
import type { GitDiffFile } from '../git/types';

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
  state?: string | null;
  avatarUrl?: string | null;
  webUrl?: string | null;
}

export interface DiffRefs {
  baseSha?: string | null;
  headSha: string;
  startSha?: string | null;
}

export interface PipelineInfo {
  id: number;
  iid?: number | null;
  projectId?: number | null;
  sha: string;
  refName: string;
  status: string;
  source?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  webUrl?: string | null;
}

export interface JobInfo {
  id: number;
  name: string;
  stage: string;
  status: string;
  duration?: number | null;
  createdAt?: string | null;
  finishedAt?: string | null;
}

export interface MergeRequest {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description?: string | null;
  state: string;
  createdAt: string;
  updatedAt: string;
  targetBranch: string;
  sourceBranch: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  reviewers: GitLabUser[];
  sourceProjectId?: number | null;
  targetProjectId?: number | null;
  draft: boolean;
  workInProgress: boolean;
  mergeStatus?: string | null;
  detailedMergeStatus?: string | null;
  sha: string;
  hasConflicts: boolean;
  webUrl: string;
  diffRefs?: DiffRefs | null;
  blockingDiscussionsResolved?: boolean | null;
  shouldRemoveSourceBranch?: boolean | null;
  forceRemoveSourceBranch?: boolean | null;
  headPipeline?: PipelineInfo | null;
  mergeCommitSha?: string | null;
}

export interface NotePosition {
  baseSha?: string | null;
  startSha?: string | null;
  headSha?: string | null;
  oldPath?: string | null;
  newPath?: string | null;
  positionType?: string | null;
  oldLine?: number | null;
  newLine?: number | null;
}

export interface Note {
  id: number;
  type?: string | null;
  body: string;
  attachment?: string | null;
  author: GitLabUser;
  createdAt: string;
  updatedAt: string;
  system: boolean;
  resolvable: boolean;
  resolved?: boolean | null;
  position?: NotePosition | null;
}

export interface Discussion {
  id: string;
  individualNote: boolean;
  notes: Note[];
}

export type TokenScopeMode = 'readOnly' | 'full' | 'none';

export interface PageInfo {
  page: number;
  perPage: number;
  nextPage?: number | null;
  totalPages?: number | null;
  total?: number | null;
}

export interface PaginatedList<T> {
  items: T[];
  pagination: PageInfo;
}

export interface MrListQuery {
  state?: string | null;
  scope?: string | null;
  reviewerId?: number | null;
  search?: string | null;
  page?: number | null;
  perPage?: number | null;
}

export interface InlinePositionParams {
  baseSha: string;
  startSha: string;
  headSha: string;
  oldPath: string;
  newPath: string;
  positionType?: string;
  oldLine?: number | null;
  newLine?: number | null;
}

export interface MergeRequestParams {
  sha: string;
  squash?: boolean | null;
  shouldRemoveSourceBranch?: boolean | null;
  mergeWhenPipelineSucceeds?: boolean | null;
  squashCommitMessage?: string | null;
  mergeCommitMessage?: string | null;
}

export interface CreateMrParams {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
  assigneeIds?: number[];
  reviewerIds?: number[];
  removeSourceBranch?: boolean;
}

export interface MergeStatusEvaluation {
  mergeable: boolean;
  canMwps: boolean;
  reason?: string | null;
}

export type MrFilter = 'opened' | 'mine' | 'assigned' | 'reviewer';

// Re-export for convenience
export type { GitDiffFile };

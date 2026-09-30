/**
 * Pure logic for Git file commit checkbox selection and context actions (F3).
 *
 * Model = Checkbox = Stage sungguhan (git add / restore --staged)
 * Commit = Staged saja (Commit (N))
 */

import type { GitStatusEntry } from './types.ts';

export interface CommitSelectionState {
  stagedPaths: string[];
  changedPaths: string[];
  untrackedPaths: string[];
}

export function isEntryStaged(entry: GitStatusEntry): boolean {
  return entry.index !== 'unmodified' && entry.index !== 'untracked';
}

export function filterUnifiedChanges(entries: GitStatusEntry[] = []): GitStatusEntry[] {
  return entries.filter(
    (e) => e.index !== 'unmodified' || e.worktree !== 'unmodified' || e.conflicted
  );
}

export function countCheckedEntries(entries: GitStatusEntry[] = []): number {
  return entries.filter(isEntryStaged).length;
}

export function getUnifiedStatusLetter(entry: GitStatusEntry): { char: string; color: string } {
  if (entry.conflicted) {
    return { char: '!', color: '#e8b45a' };
  }
  const isStaged = isEntryStaged(entry);
  const state = isStaged ? entry.index : entry.worktree;
  switch (state) {
    case 'modified':
      return { char: 'M', color: '#9cc3ff' };
    case 'added':
      return { char: 'A', color: '#7fc98f' };
    case 'deleted':
      return { char: 'D', color: '#f07a74' };
    case 'renamed':
      return { char: 'R', color: '#6ea8ff' };
    case 'copied':
      return { char: 'C', color: '#7fc98f' };
    case 'untracked':
      return { char: '?', color: '#7fc98f' };
    default:
      return { char: 'M', color: '#8b8f98' };
  }
}

export function getTotalFilesCount(state: CommitSelectionState): number {
  const all = new Set([...state.stagedPaths, ...state.changedPaths, ...state.untrackedPaths]);
  return all.size;
}

export function isAllSelected(stagedCount: number, totalCount: number): boolean {
  return totalCount > 0 && stagedCount === totalCount;
}

export function isPartiallySelected(stagedCount: number, totalCount: number): boolean {
  return stagedCount > 0 && stagedCount < totalCount;
}

export function getCommitButtonLabel(
  stagedCount: number,
  isAmend: boolean = false,
  isCommitting: boolean = false
): string {
  if (isCommitting) {
    return 'Committing…';
  }
  if (isAmend) {
    return 'Amend Commit';
  }
  return `Commit (${stagedCount})`;
}

export function canExecuteCommit(
  stagedCount: number,
  commitMessage: string,
  isAmend: boolean = false,
  isCommitting: boolean = false
): boolean {
  if (isCommitting) return false;
  if (!commitMessage || commitMessage.trim().length === 0) return false;
  return stagedCount > 0 || isAmend;
}

/**
 * Determine batch paths to stage or unstage when toggling Select All.
 * If anything is unstaged -> stage all remaining.
 * If everything is already staged -> unstage all.
 */
export function planSelectAllToggle(
  stagedPaths: string[],
  allPaths: string[]
): { action: 'stage' | 'unstage'; paths: string[] } {
  const stagedSet = new Set(stagedPaths);
  const unstaged = allPaths.filter((p) => !stagedSet.has(p));

  if (unstaged.length > 0) {
    return { action: 'stage', paths: unstaged };
  } else {
    return { action: 'unstage', paths: [...stagedPaths] };
  }
}

/**
 * Validates context menu items according to contract:
 * Rollback, Go to File, Show Diff, Stage/Unstage, Add to .gitignore, Show History, Copy Path, Reveal in Finder, Delete untracked.
 */
export interface FileContextAction {
  id:
    | 'rollback'
    | 'goto_file'
    | 'show_diff'
    | 'toggle_stage'
    | 'gitignore_add'
    | 'show_history'
    | 'copy_path'
    | 'reveal_finder'
    | 'delete_untracked';
  label: string;
  danger?: boolean;
}

export function getFileContextActions(
  filePath: string,
  isStaged: boolean,
  isUntracked: boolean
): FileContextAction[] {
  const actions: FileContextAction[] = [
    { id: 'rollback', label: 'Rollback…', danger: true },
    { id: 'goto_file', label: 'Go to File' },
    { id: 'show_diff', label: 'Show Diff' },
    { id: 'toggle_stage', label: isStaged ? 'Unstage Changes' : 'Stage Changes' },
    { id: 'gitignore_add', label: 'Add to .gitignore' },
    { id: 'show_history', label: 'Show History' },
    { id: 'copy_path', label: 'Copy Path' },
    { id: 'reveal_finder', label: 'Reveal in Finder' },
  ];

  if (isUntracked) {
    actions.push({ id: 'delete_untracked', label: 'Delete untracked', danger: true });
  }

  return actions;
}

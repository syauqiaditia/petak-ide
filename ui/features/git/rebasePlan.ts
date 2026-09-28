import type { GitRebaseItem, GitRebasePlan, GitRebaseAction } from './types';

export interface PlanValidationResult {
  valid: boolean;
  error?: string;
}

export interface PlanSummary {
  total: number;
  resulting: number;
  pickCount: number;
  rewordCount: number;
  editCount: number;
  squashCount: number;
  fixupCount: number;
  dropCount: number;
}

/**
 * Validates a rebase plan according to Git interactive rebase rules.
 * - Cannot be empty
 * - First commit cannot be squash or fixup
 * - Cannot drop all commits
 */
export function validateRebasePlan(items: GitRebaseItem[]): PlanValidationResult {
  if (!items || items.length === 0) {
    return { valid: false, error: 'Rebase plan tidak boleh kosong' };
  }

  const first = items[0];
  if (first.action === 'squash' || first.action === 'fixup') {
    return {
      valid: false,
      error: `Baris pertama tidak boleh '${first.action}' (harus ada commit sebelumnya)`,
    };
  }

  const allDropped = items.every((it) => it.action === 'drop');
  if (allDropped) {
    return { valid: false, error: 'Tidak bisa drop seluruh commit dalam rebase' };
  }

  return { valid: true };
}

/**
 * Summarizes the outcome of the rebase plan (e.g. 5 commit jadi 3).
 */
export function summarizeRebasePlan(items: GitRebaseItem[]): PlanSummary {
  let pickCount = 0;
  let rewordCount = 0;
  let editCount = 0;
  let squashCount = 0;
  let fixupCount = 0;
  let dropCount = 0;
  let resulting = 0;

  for (const it of items) {
    switch (it.action) {
      case 'pick':
        pickCount++;
        resulting++;
        break;
      case 'reword':
        rewordCount++;
        resulting++;
        break;
      case 'edit':
        editCount++;
        resulting++;
        break;
      case 'squash':
        squashCount++;
        break;
      case 'fixup':
        fixupCount++;
        break;
      case 'drop':
        dropCount++;
        break;
    }
  }

  return {
    total: items.length,
    resulting,
    pickCount,
    rewordCount,
    editCount,
    squashCount,
    fixupCount,
    dropCount,
  };
}

/**
 * Pure helper to move an item from one index to another.
 */
export function reorderItems(
  items: GitRebaseItem[],
  fromIndex: number,
  toIndex: number
): GitRebaseItem[] {
  if (
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items];
  }

  const next = [...items];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

/**
 * Pure helper to update the action of an item.
 */
export function setItemAction(
  items: GitRebaseItem[],
  index: number,
  action: GitRebaseAction
): GitRebaseItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((it, idx) => (idx === index ? { ...it, action } : it));
}

/**
 * Pure helper to update the commit message of an item.
 */
export function setItemMessage(
  items: GitRebaseItem[],
  index: number,
  message: string
): GitRebaseItem[] {
  if (index < 0 || index >= items.length) return items;
  return items.map((it, idx) => (idx === index ? { ...it, message } : it));
}

/**
 * Constructs the final RebasePlan ready for Tauri invoke.
 */
export function buildRebasePlan(
  base: string,
  items: GitRebaseItem[],
  backup = true
): GitRebasePlan {
  return {
    base,
    items: items.map((it) => ({
      sha: it.sha,
      action: it.action,
      message: it.message ?? null,
    })),
    backup,
  };
}

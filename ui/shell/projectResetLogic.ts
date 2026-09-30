/**
 * Pure logic for Project switching, recent projects list, and workspace reset (B4 + F1).
 *
 * Requirements:
 * - Recent projects: max 10, name + path, hover delete, non-existing marked/prompt remove
 * - Switch project:
 *   1. Close all tabs (confirm save if dirty)
 *   2. Reset Problems / diagnostics (no old diagnostics left)
 *   3. Reset Run log and build errors
 *   4. Reset Git view and log filter
 *   5. Set new project root and refresh file tree
 */

import type { RecentProject } from '../lib/api';

export interface ProjectSwitchResetContext {
  tabsManager: {
    tabs: Array<{ path: string; dirty?: boolean; name?: string }>;
    closeAll?: () => boolean;
    clearAll: () => void;
  };
  diagnosticsStore: {
    clear: () => void;
    totalCount?: number;
  };
  runStore: {
    resetLogs?: () => void;
    outputLines?: any[];
    buildErrors?: any[];
    uiState?: string;
  };
  gitStore: {
    resetState: () => void;
    clearFilter?: () => void;
  };
  mirrorStore?: {
    close: () => Promise<void> | void;
    stop?: () => Promise<void> | void;
  };
  onSaveDirtyTab?: (tab: { path: string; name?: string }) => Promise<boolean> | boolean;
}

export interface ProjectSwitchResetResult {
  success: boolean;
  cancelled: boolean;
  dirtyCount: number;
  tabsClosedCount: number;
}

/**
 * Filter and sort recent projects list: maximum 10 items.
 */
export function formatRecentProjects(list: RecentProject[], max: number = 10): RecentProject[] {
  return [...(list || [])]
    .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
    .slice(0, max);
}

/**
 * Remove a project from recent projects list.
 */
export function removeProjectFromList(list: RecentProject[], pathToRemove: string): RecentProject[] {
  return (list || []).filter((p) => p.path !== pathToRemove);
}

/**
 * Execute full workspace reset when switching projects.
 * Guarantees no lingering tabs, diagnostics, run logs, or git filter from previous project.
 */
export async function executeProjectSwitchReset(
  context: ProjectSwitchResetContext
): Promise<ProjectSwitchResetResult> {
  const { tabsManager, diagnosticsStore, runStore, gitStore, onSaveDirtyTab } = context;

  // 1. Check for dirty tabs
  const dirtyTabs = (tabsManager.tabs || []).filter((t) => !!t.dirty);
  if (dirtyTabs.length > 0 && onSaveDirtyTab) {
    for (const tab of dirtyTabs) {
      const ok = await onSaveDirtyTab(tab);
      if (!ok) {
        return {
          success: false,
          cancelled: true,
          dirtyCount: dirtyTabs.length,
          tabsClosedCount: 0,
        };
      }
    }
  }

  const initialTabCount = tabsManager.tabs.length;

  // 2. Close all tabs cleanly
  tabsManager.clearAll();

  // 3. Clear all diagnostics / Problems
  diagnosticsStore.clear();

  // 4. Reset Run logs, build errors, and run ui state
  if (runStore.resetLogs) {
    runStore.resetLogs();
  } else {
    if (runStore.outputLines) runStore.outputLines.length = 0;
    if (runStore.buildErrors) runStore.buildErrors.length = 0;
  }

  // 5. Reset Git view, selection, and log filter
  gitStore.resetState();

  // 6. Terminate active mirror session cleanly
  if (context.mirrorStore?.close) {
    try {
      await context.mirrorStore.close();
    } catch (_) {}
  }
  if (gitStore.clearFilter) {
    gitStore.clearFilter();
  }

  return {
    success: true,
    cancelled: false,
    dirtyCount: dirtyTabs.length,
    tabsClosedCount: initialTabCount,
  };
}

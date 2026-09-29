<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, type Entry } from '../lib/api';
  import { gitStore } from '../features/git/git.svelte.ts';
  import { tabsManager } from '../features/editor/tabs.svelte.ts';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import NewItemModal, { type ItemType } from './NewItemModal.svelte';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';
  import RollbackConfirmModal from './RollbackConfirmModal.svelte';
  import ComparePickerModal from './ComparePickerModal.svelte';
  import LocalHistoryModal from './LocalHistoryModal.svelte';
  import DiffModal from './DiffModal.svelte';
  import {
    formatCopyPath,
    canCopyPackageImport,
    makeDuplicateName,
    getRelativePath,
    getMenuCapabilities,
  } from './contextMenuLogic';
  import { createDiffFileFromTexts } from './diffUtils';
  import type { GitDiffFile } from '../features/git/types';

  let {
    rootEntries = [],
    activeFilePath = '',
    folderPath = '',
    recentFolders = [],
    onSelectFile,
    onPickFolder,
    onOpenRecent,
    onOpenTerminal,
    onOpenSearch,
    onOpenGitLog,
    onOpenCommitPanel,
    onToggleAnnotate,
  } = $props<{
    rootEntries?: Entry[];
    activeFilePath?: string;
    folderPath?: string;
    recentFolders?: string[];
    onSelectFile?: (entry: Entry) => void;
    onPickFolder?: () => void;
    onOpenRecent?: (path: string) => void;
    onOpenTerminal?: (cwd?: string) => void;
    onOpenSearch?: (mode: string, initialQuery?: string, scope?: string) => void;
    onOpenGitLog?: (pathFilter?: string) => void;
    onOpenCommitPanel?: (path?: string) => void;
    onToggleAnnotate?: () => void;
  }>();

  let expanded = $state<Record<string, boolean>>({});
  let childrenCache = $state<Record<string, Entry[]>>({});
  let loading = $state<Record<string, boolean>>({});

  // Multi-selection state
  let selectedPaths = $state<Set<string>>(new Set());
  let lastSelectedPath = $state<string | null>(null);

  // Internal tree clipboard
  let treeClipboard = $state<{ paths: string[]; mode: 'cut' | 'copy' } | null>(null);

  // Inline rename state
  let renamingPath = $state<string | null>(null);
  let renameValue = $state('');
  let renameStem = $state('');
  let renameExt = $state('');
  let renameError = $state<string | null>(null);
  let renameInputEl = $state<HTMLInputElement | null>(null);

  // Context menu state
  let contextMenuVisible = $state(false);
  let contextMenuPos = $state({ x: 0, y: 0 });
  let contextMenuItems = $state<MenuItem[]>([]);
  let contextMenuTitle = $state('');

  // Modals state
  let newItemModalOpen = $state(false);
  let newItemTargetDir = $state('');
  let newItemInitialType = $state<ItemType>('file');

  let deleteModalOpen = $state(false);
  let deleteModalPaths = $state<string[]>([]);

  let rollbackModalOpen = $state(false);
  let rollbackModalPaths = $state<string[]>([]);

  let comparePickerOpen = $state(false);
  let compareInitialTab = $state<'branches' | 'revisions'>('branches');
  let compareTargetFile = $state<{ name: string; rel: string } | null>(null);

  let localHistoryOpen = $state(false);
  let localHistoryTarget = $state<{ rel: string; abs: string; isDir: boolean } | null>(null);

  let diffModalOpen = $state(false);
  let modalDiffFile = $state<GitDiffFile | null>(null);
  let modalDiffTitle = $state('');

  // pubspec.yaml cache for package: import syntax
  let pubspecPackageName = $state<string>('');

  onMount(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('menu-git')) {
      setTimeout(() => {
        selectedPaths = new Set(['/project/lib/main.dart']);
        openContextMenuForSelection(140, 180);
      }, 300);
    }
  });

  $effect(() => {
    if (folderPath) {
      api.readFile(folderPath + '/pubspec.yaml')
        .then((content) => {
          const m = content.match(/^name:\s*([^\s#]+)/m);
          if (m) pubspecPackageName = m[1].trim();
        })
        .catch(() => {
          pubspecPackageName = '';
        });
    }
  });

  let folderLeaf = $derived(
    folderPath ? folderPath.split('/').filter(Boolean).pop() || 'Project' : 'No Folder Open'
  );

  function getRelPath(absPath: string): string {
    return getRelativePath(absPath, folderPath);
  }

  function getParentDir(absPath: string): string {
    const parts = absPath.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    return parts.length > 0 ? (absPath.startsWith('/') ? '/' : '') + parts.join('/') : '';
  }

  function getParentRel(relPath: string): string {
    const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  }

  function findEntryByPath(path: string): Entry | null {
    function search(list: Entry[]): Entry | null {
      for (const e of list) {
        if (e.path === path) return e;
        if (e.is_dir && childrenCache[e.path]) {
          const found = search(childrenCache[e.path]);
          if (found) return found;
        }
      }
      return null;
    }
    return search(rootEntries);
  }

  function getAllVisibleEntries(): Entry[] {
    const result: Entry[] = [];
    function traverse(entries: Entry[]) {
      for (const e of entries) {
        result.push(e);
        if (e.is_dir && expanded[e.path] && childrenCache[e.path]) {
          traverse(childrenCache[e.path]);
        }
      }
    }
    traverse(rootEntries);
    return result;
  }

  function getFileGitColor(absPath: string): string | null {
    const rel = getRelPath(absPath);
    if (!rel) return null;
    const entry = gitStore.statusMap.get(rel);
    if (!entry) return null;
    if (entry.conflicted) return '#e8b45a';
    if (entry.worktree === 'modified' || entry.index === 'modified') return '#9cc3ff';
    if (
      entry.worktree === 'untracked' ||
      entry.worktree === 'added' ||
      entry.index === 'added'
    )
      return '#7fc98f';
    if (entry.worktree === 'deleted' || entry.index === 'deleted') return '#f07a74';
    return null;
  }

  function isDirChanged(absPath: string): boolean {
    const rel = getRelPath(absPath);
    if (!rel) return false;
    return gitStore.changedDirsSet.has(rel);
  }

  export async function toggleFolder(entry: Entry) {
    const path = entry.path;
    if (expanded[path]) {
      expanded[path] = false;
    } else {
      if (!childrenCache[path]) {
        loading[path] = true;
        try {
          const items = await api.listDir(path);
          childrenCache[path] = items;
        } catch (e) {
          console.error('Failed to list directory:', path, e);
        } finally {
          loading[path] = false;
        }
      }
      expanded[path] = true;
    }
  }

  export async function refreshExpandedFolders(changedPaths: string[]) {
    for (const p of Object.keys(childrenCache)) {
      if (expanded[p]) {
        const affected = changedPaths.some((cp) => cp === p || cp.startsWith(p + '/'));
        if (affected) {
          try {
            childrenCache[p] = await api.listDir(p);
          } catch (e) {
            console.error('Failed to refresh folder:', p, e);
          }
        }
      }
    }
  }

  export function collapseAll() {
    expanded = {};
  }

  export function expandAll() {
    for (const k of Object.keys(childrenCache)) {
      expanded[k] = true;
    }
  }

  export async function selectOpenedFile(filePath: string) {
    if (!filePath || !folderPath) return;
    const rel = getRelPath(filePath);
    if (!rel) return;
    const parts = rel.split('/').filter(Boolean);
    parts.pop(); // remove leaf file

    let cur = folderPath;
    for (const part of parts) {
      cur = `${cur}/${part}`;
      if (!expanded[cur]) {
        if (!childrenCache[cur]) {
          try {
            childrenCache[cur] = await api.listDir(cur);
          } catch (e) {}
        }
        expanded[cur] = true;
      }
    }

    selectedPaths = new Set([filePath]);
    lastSelectedPath = filePath;

    await tick();
    const activeEl = document.querySelector(`.item[data-path="${filePath}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }

  function getFileColor(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.kt') || lower.endsWith('.kts')) return '#7fc98f';
    if (lower.endsWith('.dart')) return '#2aacb8';
    if (lower.endsWith('.swift')) return '#cf8e6d';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return '#b3ae60';
    if (lower.endsWith('.json')) return '#e8b45a';
    if (lower.endsWith('.xml')) return '#8b8f98';
    if (lower.endsWith('.md')) return '#6ea8ff';
    return '#8b8f98';
  }

  // Selection handlers
  function handleItemClick(entry: Entry, e: MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selectedPaths);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
        lastSelectedPath = entry.path;
      }
      selectedPaths = next;
    } else if (e.shiftKey && lastSelectedPath) {
      const visible = getAllVisibleEntries();
      const idx1 = visible.findIndex((v) => v.path === lastSelectedPath);
      const idx2 = visible.findIndex((v) => v.path === entry.path);
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        selectedPaths = new Set(visible.slice(start, end + 1).map((v) => v.path));
      }
    } else {
      selectedPaths = new Set([entry.path]);
      lastSelectedPath = entry.path;
      if (entry.is_dir) {
        toggleFolder(entry);
      } else {
        onSelectFile?.(entry);
      }
    }
  }

  // Inline Rename
  function startInlineRename(entry: Entry) {
    if (entry.path === folderPath) return;
    renamingPath = entry.path;
    const name = entry.name;
    if (entry.is_dir) {
      renameStem = name;
      renameExt = '';
    } else {
      const lastDot = name.lastIndexOf('.');
      if (lastDot > 0) {
        renameStem = name.slice(0, lastDot);
        renameExt = name.slice(lastDot);
      } else {
        renameStem = name;
        renameExt = '';
      }
    }
    renameValue = renameStem;
    renameError = null;
    tick().then(() => {
      if (renameInputEl) {
        renameInputEl.focus();
        renameInputEl.select();
      }
    });
  }

  function validateRename(val: string): string | null {
    const trimmed = val.trim();
    if (!trimmed) return 'File name cannot be empty';
    if (/[\/\\:\*\?"<>\|]/.test(trimmed)) return 'File name contains invalid characters';
    const parent = getParentDir(renamingPath!);
    const siblings = parent && childrenCache[parent] ? childrenCache[parent] : rootEntries;
    const newFullName = trimmed + renameExt;
    const conflict = siblings.some(
      (s) => s.path !== renamingPath && s.name.toLowerCase() === newFullName.toLowerCase()
    );
    if (conflict) return 'A file with this name already exists';
    return null;
  }

  async function commitInlineRename() {
    if (!renamingPath) return;
    const err = validateRename(renameValue);
    if (err) {
      renameError = err;
      return;
    }
    const newFullName = renameValue.trim() + renameExt;
    const oldPath = renamingPath;
    renamingPath = null;
    renameError = null;

    const oldRel = getRelPath(oldPath);
    const parentRel = getParentRel(oldRel);
    const newRel = parentRel ? `${parentRel}/${newFullName}` : newFullName;
    const newAbs = folderPath ? `${folderPath}/${newRel}` : newRel;

    if (oldRel === newRel) return;

    try {
      await api.fsRename(folderPath, oldRel, newRel);
      tabsManager.renamePath(oldPath, newAbs);

      const parentAbs = getParentDir(oldPath);
      if (parentAbs && expanded[parentAbs]) {
        childrenCache[parentAbs] = await api.listDir(parentAbs);
      } else {
        await refreshExpandedFolders([oldPath, newAbs]);
      }
    } catch (e: any) {
      alert('Rename failed: ' + (e?.message || String(e)));
    }
  }

  function cancelInlineRename() {
    renamingPath = null;
    renameError = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commitInlineRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelInlineRename();
    }
  }

  // Tree Clipboard Actions
  async function executePaste(targetDirPath?: string) {
    if (!treeClipboard || treeClipboard.paths.length === 0) return;
    const targetDir = targetDirPath ?? (selectedPaths.size === 1 ? Array.from(selectedPaths)[0] : folderPath);
    const destRel = getRelPath(targetDir);
    const srcsRel = treeClipboard.paths.map(getRelPath);

    try {
      if (treeClipboard.mode === 'cut') {
        await api.fsMove(folderPath, srcsRel, destRel);
        treeClipboard = null;
      } else {
        await api.fsCopy(folderPath, srcsRel, destRel);
      }
      if (childrenCache[targetDir]) {
        childrenCache[targetDir] = await api.listDir(targetDir);
      } else {
        await refreshExpandedFolders([targetDir]);
      }
    } catch (e: any) {
      alert('Paste failed: ' + (e?.message || String(e)));
    }
  }

  // Drag and drop move
  function handleDragStart(e: DragEvent, entry: Entry) {
    if (!selectedPaths.has(entry.path)) {
      selectedPaths = new Set([entry.path]);
    }
    e.dataTransfer?.setData('text/plain', JSON.stringify(Array.from(selectedPaths)));
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  async function handleDrop(e: DragEvent, targetEntry?: Entry) {
    e.preventDefault();
    const data = e.dataTransfer?.getData('text/plain');
    if (!data) return;
    try {
      const paths: string[] = JSON.parse(data);
      const destDir = targetEntry
        ? targetEntry.is_dir
          ? targetEntry.path
          : getParentDir(targetEntry.path)
        : folderPath;

      const destRel = getRelPath(destDir);
      const srcsRel = paths.map(getRelPath);
      await api.fsMove(folderPath, srcsRel, destRel);

      if (childrenCache[destDir]) {
        childrenCache[destDir] = await api.listDir(destDir);
      } else {
        await refreshExpandedFolders([destDir, ...paths]);
      }
    } catch (err) {
      console.error('Drag and drop move failed:', err);
    }
  }

  // Context Menu Builders
  function openContextMenuForSelection(clientX: number, clientY: number) {
    const selectedArr = Array.from(selectedPaths);
    const selectedEntries = selectedArr.map(findEntryByPath).filter(Boolean) as Entry[];
    const isMulti = selectedArr.length > 1;
    const firstEntry = selectedEntries[0] ?? { path: selectedArr[0], name: selectedArr[0].split('/').pop() || '', is_dir: false };
    const areAllFiles = selectedEntries.every((e) => !e.is_dir);
    const isRepo = !!(gitStore.status && !gitStore.error);
    const caps = getMenuCapabilities({
      selectedCount: selectedArr.length,
      isFolder: firstEntry.is_dir,
      isRepo,
      clipboardHasContent: treeClipboard !== null,
      areAllFiles,
    });

    contextMenuTitle = caps.multiHeaderLabel || firstEntry.name;
    const items: MenuItem[] = [];

    if (isMulti) {
      // Multi-selection menu
      items.push({
        label: 'Cut',
        icon: 'cut',
        shortcut: '⌘X',
        action: () => {
          treeClipboard = { paths: selectedArr, mode: 'cut' };
        },
      });
      items.push({
        label: 'Copy',
        icon: 'copy',
        shortcut: '⌘C',
        action: () => {
          treeClipboard = { paths: selectedArr, mode: 'copy' };
          navigator.clipboard.writeText(selectedArr.join('\n'));
        },
      });
      items.push({
        label: 'Delete…',
        icon: 'trash',
        shortcut: '⌘⌫',
        danger: true,
        action: () => {
          deleteModalPaths = selectedArr.filter((p) => p !== folderPath);
          if (deleteModalPaths.length > 0) {
            deleteModalOpen = true;
          }
        },
      });

      items.push({ separator: true });

      items.push({
        label: 'Copy Paths',
        action: () => {
          const rels = selectedArr.map(getRelPath).join('\n');
          navigator.clipboard.writeText(rels);
        },
      });

      items.push({
        label: 'Open in Terminal',
        icon: 'terminal',
        action: () => {
          const firstDir = selectedEntries.find((e) => e.is_dir)?.path || getParentDir(selectedArr[0]);
          onOpenTerminal?.(firstDir);
        },
      });

      items.push({ separator: true });

      items.push({
        label: 'Find in Selected Files…',
        shortcut: '⇧⌘F',
        action: () => {
          onOpenSearch?.('text', '', getRelPath(selectedArr[0]));
        },
      });

      if (caps.compareMode === 'compare_two') {
        items.push({ separator: true });
        items.push({
          label: 'Compare 2 Files…',
          icon: 'diff',
          action: async () => {
            const [p1, p2] = selectedArr;
            const t1 = await api.readFile(p1).catch(() => '');
            const t2 = await api.readFile(p2).catch(() => '');
            modalDiffFile = createDiffFileFromTexts(getRelPath(p1), getRelPath(p2), t1, t2);
            modalDiffTitle = `Compare: ${getRelPath(p1)} vs ${getRelPath(p2)}`;
            diffModalOpen = true;
          },
        });
      }

      if (caps.gitVisible) {
        items.push({ separator: true });
        items.push({
          label: 'Git',
          icon: 'git',
          items: [
            {
              label: 'Add to VCS',
              action: async () => {
                const rels = selectedArr.map(getRelPath);
                for (const r of rels) {
                  await api.gitDiffPath(folderPath, r, 'head').catch(() => {});
                }
              },
            },
            {
              label: `Commit ${selectedArr.length} Items…`,
              shortcut: '⌘K',
              action: () => {
                onOpenCommitPanel?.(getRelPath(selectedArr[0]));
              },
            },
            {
              label: 'Rollback Changes…',
              danger: true,
              action: () => {
                rollbackModalPaths = selectedArr.map(getRelPath);
                rollbackModalOpen = true;
              },
            },
          ],
        });
      }
    } else {
      // Single selection menu
      const targetDir = firstEntry.is_dir ? getRelPath(firstEntry.path) : getParentRel(getRelPath(firstEntry.path));
      const relEntryPath = getRelPath(firstEntry.path);
      const isEntryStaged = gitStore.stagedEntries.some(
        (s) => s.path === relEntryPath || s.path.startsWith(relEntryPath + '/')
      );

      items.push({
        label: 'New',
        icon: 'file',
        shortcut: '⌘N',
        items: [
          {
            label: 'File',
            shortcut: '⌘N',
            action: () => {
              newItemTargetDir = targetDir;
              newItemInitialType = 'file';
              newItemModalOpen = true;
            },
          },
          {
            label: 'Folder',
            action: () => {
              newItemTargetDir = targetDir;
              newItemInitialType = 'folder';
              newItemModalOpen = true;
            },
          },
          { separator: true },
          {
            label: 'Dart File',
            action: () => {
              newItemTargetDir = targetDir;
              newItemInitialType = 'dart';
              newItemModalOpen = true;
            },
          },
          {
            label: 'Kotlin Class',
            action: () => {
              newItemTargetDir = targetDir;
              newItemInitialType = 'kotlin';
              newItemModalOpen = true;
            },
          },
          {
            label: 'Swift File',
            action: () => {
              newItemTargetDir = targetDir;
              newItemInitialType = 'swift';
              newItemModalOpen = true;
            },
          },
        ],
      });

      items.push({ separator: true });

      items.push({
        label: 'Cut',
        icon: 'cut',
        shortcut: '⌘X',
        action: () => {
          treeClipboard = { paths: [firstEntry.path], mode: 'cut' };
        },
      });
      items.push({
        label: 'Copy',
        icon: 'copy',
        shortcut: '⌘C',
        action: () => {
          treeClipboard = { paths: [firstEntry.path], mode: 'copy' };
          navigator.clipboard.writeText(firstEntry.path);
        },
      });
      items.push({
        label: 'Paste',
        icon: 'paste',
        shortcut: '⌘V',
        disabled: !caps.canPaste,
        disabledReason: !firstEntry.is_dir ? 'Can only paste into a folder' : 'Clipboard is empty',
        action: () => executePaste(firstEntry.path),
      });
      items.push({
        label: 'Duplicate',
        shortcut: '⌘D',
        disabled: !caps.canDuplicate,
        action: async () => {
          const rel = getRelPath(firstEntry.path);
          await api.fsDuplicate(folderPath, rel);
          await refreshExpandedFolders([firstEntry.path]);
        },
      });
      items.push({
        label: 'Rename…',
        icon: 'edit',
        shortcut: '⇧F6',
        action: () => startInlineRename(firstEntry),
      });
      items.push({
        label: 'Delete…',
        icon: 'trash',
        shortcut: '⌘⌫',
        danger: true,
        action: () => {
          if (firstEntry.path !== folderPath) {
            deleteModalPaths = [firstEntry.path];
            deleteModalOpen = true;
          }
        },
      });

      items.push({ separator: true });

      // Copy Path / Reference
      const copySubmenu: MenuItem[] = [
        {
          label: 'Absolute Path',
          shortcut: '⌥⇧⌘C',
          action: () => navigator.clipboard.writeText(formatCopyPath('absolute', firstEntry.path, folderPath)),
        },
        {
          label: 'Path from Content Root',
          action: () => navigator.clipboard.writeText(formatCopyPath('relative', firstEntry.path, folderPath)),
        },
        {
          label: 'File Name',
          action: () => navigator.clipboard.writeText(formatCopyPath('name', firstEntry.path, folderPath)),
        },
        {
          label: 'File Name without Extension',
          action: () => navigator.clipboard.writeText(formatCopyPath('stem', firstEntry.path, folderPath)),
        },
        {
          label: 'Path with Line Number',
          action: () => navigator.clipboard.writeText(formatCopyPath('line', firstEntry.path, folderPath, 1)),
        },
      ];

      if (canCopyPackageImport(getRelPath(firstEntry.path))) {
        copySubmenu.push({
          label: "Copy as 'package:' Import",
          action: () =>
            navigator.clipboard.writeText(
              formatCopyPath('package', firstEntry.path, folderPath, undefined, pubspecPackageName)
            ),
        });
      }

      items.push({
        label: 'Copy Path/Reference',
        items: copySubmenu,
      });

      // Open in
      items.push({
        label: 'Open in',
        items: [
          {
            label: 'Reveal in Finder',
            shortcut: '⌥F1',
            icon: 'external',
            action: () => api.osReveal(firstEntry.path),
          },
          {
            label: 'Open in Terminal',
            icon: 'terminal',
            action: () => onOpenTerminal?.(firstEntry.is_dir ? firstEntry.path : getParentDir(firstEntry.path)),
          },
          {
            label: 'Open with Default App',
            icon: 'external',
            action: () => api.osOpenDefault(firstEntry.path),
          },
        ],
      });

      items.push({ separator: true });

      items.push({
        label: 'Find in Folder…',
        icon: 'search',
        shortcut: '⇧⌘F',
        disabled: !firstEntry.is_dir,
        disabledReason: 'Find in Folder is only available on directories',
        action: () => onOpenSearch?.('text', '', getRelPath(firstEntry.path)),
      });
      items.push({
        label: 'Replace in Folder…',
        shortcut: '⇧⌘R',
        disabled: !firstEntry.is_dir,
        disabledReason: 'Replace in Folder is only available on directories',
        action: () => onOpenSearch?.('text', '', getRelPath(firstEntry.path)),
      });

      if (!firstEntry.is_dir) {
        items.push({ separator: true });
        items.push({
          label: 'Compare With…',
          icon: 'diff',
          action: () => {
            compareTargetFile = { name: firstEntry.name, rel: getRelPath(firstEntry.path) };
            comparePickerOpen = true;
          },
        });
        items.push({
          label: 'Compare with Clipboard',
          icon: 'diff',
          action: async () => {
            const fileContent = await api.readFile(firstEntry.path).catch(() => '');
            const clipText = await navigator.clipboard.readText().catch(() => '');
            modalDiffFile = createDiffFileFromTexts('Clipboard', getRelPath(firstEntry.path), clipText, fileContent);
            modalDiffTitle = `Compare: Clipboard vs ${firstEntry.name}`;
            diffModalOpen = true;
          },
        });
      }

      items.push({ separator: true });
      items.push({
        label: 'Reload from Disk',
        icon: 'refresh',
        action: () => refreshExpandedFolders([firstEntry.path]),
      });
      items.push({
        label: 'Select Opened File',
        action: () => selectOpenedFile(activeFilePath),
      });

      if (caps.gitVisible) {
        items.push({ separator: true });
        items.push({
          label: 'Git',
          icon: 'git',
          items: [
            {
              label: 'Show Diff',
              icon: 'diff',
              shortcut: '⌘D',
              action: async () => {
                const diffs = await api.gitDiffPath(folderPath, getRelPath(firstEntry.path), 'head').catch(() => []);
                if (diffs && diffs.length > 0) {
                  modalDiffFile = diffs[0];
                  modalDiffTitle = `Git Diff (HEAD): ${firstEntry.name}`;
                  diffModalOpen = true;
                } else {
                  alert('No uncommitted changes in this file.');
                }
              },
            },
            {
              label: 'Show History',
              action: () => onOpenGitLog?.(getRelPath(firstEntry.path)),
            },
            {
              label: 'Compare with Branch…',
              action: () => {
                compareTargetFile = { name: firstEntry.name, rel: getRelPath(firstEntry.path) };
                compareInitialTab = 'branches';
                comparePickerOpen = true;
              },
            },
            {
              label: 'Compare with Revision…',
              action: () => {
                compareTargetFile = { name: firstEntry.name, rel: getRelPath(firstEntry.path) };
                compareInitialTab = 'revisions';
                comparePickerOpen = true;
              },
            },
            {
              label: 'Annotate / Blame',
              disabled: firstEntry.is_dir,
              action: () => {
                onSelectFile(firstEntry.path);
                setTimeout(() => onToggleAnnotate?.(), 100);
              },
            },
            { separator: true },
            {
              label: 'Rollback Changes…',
              danger: true,
              action: () => {
                rollbackModalPaths = [getRelPath(firstEntry.path)];
                rollbackModalOpen = true;
              },
            },
            {
              label: 'Add to .gitignore',
              action: async () => {
                await api.gitGitignoreAdd(folderPath, getRelPath(firstEntry.path));
                await gitStore.refresh(folderPath);
              },
            },
            {
              label: isEntryStaged ? 'Unstage' : 'Stage',
              action: async () => {
                if (isEntryStaged) {
                  await api.gitUnstage(folderPath, relEntryPath);
                } else {
                  await api.gitStage(folderPath, relEntryPath);
                }
                await gitStore.refresh(folderPath);
              },
            },
            { separator: true },
            {
              label: firstEntry.is_dir ? 'Commit Folder…' : 'Commit File…',
              shortcut: '⌘K',
              action: () => onOpenCommitPanel?.(getRelPath(firstEntry.path)),
            },
          ],
        });
      }

      items.push({
        label: 'Local History',
        icon: 'clock',
        items: [
          {
            label: 'Show History',
            action: () => {
              localHistoryTarget = {
                rel: getRelPath(firstEntry.path),
                abs: firstEntry.path,
                isDir: firstEntry.is_dir,
              };
              localHistoryOpen = true;
            },
          },
          {
            label: 'Put Label…',
            action: () => {
              localHistoryTarget = {
                rel: getRelPath(firstEntry.path),
                abs: firstEntry.path,
                isDir: firstEntry.is_dir,
              };
              localHistoryOpen = true;
            },
          },
        ],
      });
    }

    contextMenuItems = items;
    contextMenuPos = { x: clientX, y: clientY };
    contextMenuVisible = true;
  }

  function openContextMenuForEmptyArea(clientX: number, clientY: number) {
    contextMenuTitle = '';
    contextMenuItems = [
      {
        label: 'New File…',
        icon: 'file',
        shortcut: '⌘N',
        action: () => {
          newItemTargetDir = '';
          newItemInitialType = 'file';
          newItemModalOpen = true;
        },
      },
      {
        label: 'New Folder…',
        icon: 'folder',
        action: () => {
          newItemTargetDir = '';
          newItemInitialType = 'folder';
          newItemModalOpen = true;
        },
      },
      { separator: true },
      {
        label: 'Paste',
        icon: 'paste',
        shortcut: '⌘V',
        disabled: treeClipboard === null,
        disabledReason: 'Clipboard is empty',
        action: () => executePaste(folderPath),
      },
      { separator: true },
      {
        label: 'Open in Terminal',
        icon: 'terminal',
        action: () => onOpenTerminal?.(folderPath),
      },
      {
        label: 'Find in Files…',
        icon: 'search',
        shortcut: '⇧⌘F',
        action: () => onOpenSearch?.('text', '', ''),
      },
      { separator: true },
      {
        label: 'Reload from Disk',
        icon: 'refresh',
        action: () => refreshExpandedFolders([folderPath]),
      },
    ];
    contextMenuPos = { x: clientX, y: clientY };
    contextMenuVisible = true;
  }

  function handleEmptyAreaContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openContextMenuForEmptyArea(e.clientX, e.clientY);
  }

  function handleItemContextMenu(e: MouseEvent, entry: Entry) {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPaths.has(entry.path)) {
      selectedPaths = new Set([entry.path]);
      lastSelectedPath = entry.path;
    }
    openContextMenuForSelection(e.clientX, e.clientY);
  }

  function handleTreeKeydown(e: KeyboardEvent) {
    if (renamingPath) return;

    const isCmd = e.metaKey || e.ctrlKey;

    if (e.shiftKey && e.key === 'F6') {
      e.preventDefault();
      if (selectedPaths.size === 1) {
        const p = Array.from(selectedPaths)[0];
        const entry = findEntryByPath(p);
        if (entry) startInlineRename(entry);
      }
      return;
    }

    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      const first = selectedPaths.size === 1 ? findEntryByPath(Array.from(selectedPaths)[0]) : null;
      newItemTargetDir = first ? (first.is_dir ? getRelPath(first.path) : getParentRel(getRelPath(first.path))) : '';
      newItemInitialType = 'file';
      newItemModalOpen = true;
      return;
    }

    if ((isCmd && e.key === 'Backspace') || e.key === 'Delete') {
      e.preventDefault();
      const validPaths = Array.from(selectedPaths).filter((p) => p !== folderPath);
      if (validPaths.length > 0) {
        deleteModalPaths = validPaths;
        deleteModalOpen = true;
      }
      return;
    }

    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (selectedPaths.size > 0) {
        treeClipboard = { paths: Array.from(selectedPaths), mode: 'copy' };
        navigator.clipboard.writeText(Array.from(selectedPaths).join('\n'));
      }
      return;
    }

    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      if (selectedPaths.size > 0) {
        treeClipboard = { paths: Array.from(selectedPaths), mode: 'cut' };
      }
      return;
    }

    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      executePaste();
      return;
    }

    if (isCmd && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (selectedPaths.size > 0) {
        const p = Array.from(selectedPaths)[0];
        navigator.clipboard.writeText(formatCopyPath('relative', p, folderPath));
      }
      return;
    }

    if (e.altKey && e.key === 'F1') {
      e.preventDefault();
      if (selectedPaths.size > 0) {
        const p = Array.from(selectedPaths)[0];
        api.osReveal(p);
      }
      return;
    }
  }
</script>

<div
  class="file-tree"
  tabindex="0"
  onkeydown={handleTreeKeydown}
  oncontextmenu={handleEmptyAreaContextMenu}
  ondragover={handleDragOver}
  ondrop={(e) => handleDrop(e)}
  role="region"
  aria-label="Project File Tree"
>
  <!-- Header with Title & Toolbar Icons -->
  <div class="header">
    <span class="header-title">PROJECT</span>
    <div class="toolbar-actions">
      <button
        class="icon-btn"
        onclick={() => selectOpenedFile(activeFilePath)}
        title="Select Opened File (Locate in tree)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <line x1="12" y1="3" x2="12" y2="7"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
          <line x1="3" y1="12" x2="7" y2="12"/>
          <line x1="17" y1="12" x2="21" y2="12"/>
        </svg>
      </button>
      <button class="icon-btn" onclick={collapseAll} title="Collapse All">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 14 12 6 20 14"/>
        </svg>
      </button>
      <button class="icon-btn" onclick={expandAll} title="Expand All">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 10 12 18 20 10"/>
        </svg>
      </button>
      <button class="open-btn" onclick={onPickFolder} title="Open Folder">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        <span>Open</span>
      </button>
    </div>
  </div>

  {#if folderPath}
    <div
      class="root-folder"
      oncontextmenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedPaths = new Set();
        openContextMenuForEmptyArea(e.clientX, e.clientY);
      }}
    >
      <span class="caret">▾</span>
      <span class="folder-name">{folderLeaf}</span>
    </div>

    <div class="tree-list" oncontextmenu={handleEmptyAreaContextMenu}>
      {#if rootEntries.length === 0}
        <div class="empty-folder">Empty folder</div>
      {:else}
        {#snippet renderEntry(entry: Entry, depth: number)}
          {@const isExpanded = !!expanded[entry.path]}
          {@const isDir = entry.is_dir}
          {@const isActive = entry.path === activeFilePath}
          {@const isSelected = selectedPaths.has(entry.path)}
          {@const isRenaming = renamingPath === entry.path}

          {#if isDir}
            <div
              class="item dir-item"
              class:selected={isSelected}
              style="padding-left: {8 + depth * 16}px;"
              draggable="true"
              data-path={entry.path}
              onclick={(e) => handleItemClick(entry, e)}
              oncontextmenu={(e) => handleItemContextMenu(e, entry)}
              ondragstart={(e) => handleDragStart(e, entry)}
              ondragover={handleDragOver}
              ondrop={(e) => {
                e.stopPropagation();
                handleDrop(e, entry);
              }}
              role="treeitem"
              aria-selected={isSelected}
              tabindex="-1"
            >
              <span
                class="item-caret"
                onclick={(e) => {
                  e.stopPropagation();
                  toggleFolder(entry);
                }}
              >
                {isExpanded ? '▾' : '▸'}
              </span>

              {#if isExpanded}
                <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8">
                  <path d="M5 19h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                  <path d="M3 19l2-8h16l-2 8"></path>
                </svg>
              {:else}
                <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                </svg>
              {/if}

              {#if isRenaming}
                <div class="rename-input-wrap" onclick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    bind:this={renameInputEl}
                    bind:value={renameValue}
                    class="rename-input"
                    class:has-error={!!renameError}
                    onkeydown={handleRenameKeydown}
                    onblur={commitInlineRename}
                  />
                  {#if renameError}
                    <div class="rename-tooltip">{renameError}</div>
                  {/if}
                </div>
              {:else}
                <span class="item-name" class:dir-changed={isDirChanged(entry.path)}>
                  {entry.name}
                </span>
              {/if}
            </div>

            {#if isExpanded}
              {#if loading[entry.path]}
                <div class="loading-node" style="padding-left: {8 + (depth + 1) * 16}px;">...</div>
              {:else if childrenCache[entry.path]}
                {#each childrenCache[entry.path] as child (child.path)}
                  {@render renderEntry(child, depth + 1)}
                {/each}
              {/if}
            {/if}
          {:else}
            {@const gitColor = getFileGitColor(entry.path)}
            <div
              class="item file-item"
              class:active={isActive}
              class:selected={isSelected}
              style="padding-left: {8 + depth * 16}px;"
              draggable="true"
              data-path={entry.path}
              onclick={(e) => handleItemClick(entry, e)}
              oncontextmenu={(e) => handleItemContextMenu(e, entry)}
              ondragstart={(e) => handleDragStart(e, entry)}
              role="treeitem"
              aria-selected={isSelected}
              tabindex="-1"
            >
              <span class="item-spacer"></span>
              <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={getFileColor(entry.name)} stroke-width="1.8">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>

              {#if isRenaming}
                <div class="rename-input-wrap" onclick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    bind:this={renameInputEl}
                    bind:value={renameValue}
                    class="rename-input"
                    class:has-error={!!renameError}
                    onkeydown={handleRenameKeydown}
                    onblur={commitInlineRename}
                  />
                  {#if renameExt}
                    <span class="rename-ext">{renameExt}</span>
                  {/if}
                  {#if renameError}
                    <div class="rename-tooltip">{renameError}</div>
                  {/if}
                </div>
              {:else}
                <span class="item-name" style={gitColor ? `color: ${gitColor};` : ''}>
                  {entry.name}
                </span>
              {/if}
            </div>
          {/if}
        {/snippet}

        {#each rootEntries as entry (entry.path)}
          {@render renderEntry(entry, 0)}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <span class="empty-label">No folder open</span>
      <button class="open-folder-btn" onclick={onPickFolder}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        <span>Open Folder</span>
      </button>

      {#if recentFolders && recentFolders.length > 0}
        <div class="recent-section">
          <span class="recent-title">RECENT</span>
          <div class="recent-list">
            {#each recentFolders as rf}
              {@const leaf = rf.split('/').filter(Boolean).pop() || rf}
              <button class="recent-item" onclick={() => onOpenRecent?.(rf)} title={rf}>
                <span class="recent-name">{leaf}</span>
                <span class="recent-path">{rf}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Context Menu Component -->
{#if contextMenuVisible}
  <ContextMenu
    x={contextMenuPos.x}
    y={contextMenuPos.y}
    title={contextMenuTitle}
    items={contextMenuItems}
    onclose={() => (contextMenuVisible = false)}
  />
{/if}

<!-- Modals -->
{#if newItemModalOpen}
  <NewItemModal
    targetDir={newItemTargetDir}
    initialType={newItemInitialType}
    onclose={() => (newItemModalOpen = false)}
    oncreate={async (relPath, type) => {
      let createdPath = '';
      if (type === 'folder') {
        createdPath = await api.fsCreateDir(folderPath, relPath);
      } else {
        const tmpl = type === 'dart' ? 'dart' : type === 'kotlin' ? 'kotlin' : type === 'swift' ? 'swift' : undefined;
        createdPath = await api.fsCreateFile(folderPath, relPath, tmpl);
      }
      const absCreated = folderPath ? `${folderPath}/${relPath}` : relPath;
      if (type !== 'folder') {
        const leaf = relPath.split('/').pop() || relPath;
        const content = await api.readFile(absCreated).catch(() => '');
        tabsManager.openTab(absCreated, leaf, content);
      }
      await refreshExpandedFolders([absCreated]);
    }}
  />
{/if}

{#if deleteModalOpen}
  <DeleteConfirmModal
    paths={deleteModalPaths.map(getRelPath)}
    onclose={() => (deleteModalOpen = false)}
    onconfirm={async () => {
      const rels = deleteModalPaths.map(getRelPath);
      await api.fsTrash(folderPath, rels);
      for (const p of deleteModalPaths) {
        tabsManager.closeTab(p);
      }
      selectedPaths = new Set();
      await refreshExpandedFolders(deleteModalPaths);
    }}
  />
{/if}

{#if rollbackModalOpen}
  <RollbackConfirmModal
    paths={rollbackModalPaths}
    onclose={() => (rollbackModalOpen = false)}
    onconfirm={async () => {
      for (const r of rollbackModalPaths) {
        await api.lhSnapshot(folderPath, r, 'before_rollback');
      }
      await api.gitRollback(folderPath, rollbackModalPaths);
      await refreshExpandedFolders(rollbackModalPaths.map((r) => `${folderPath}/${r}`));
      gitStore.refresh();
    }}
  />
{/if}

{#if comparePickerOpen && compareTargetFile}
  <ComparePickerModal
    fileName={compareTargetFile.name}
    relPath={compareTargetFile.rel}
    {folderPath}
    initialTab={compareInitialTab}
    onclose={() => (comparePickerOpen = false)}
    onselect={async (ref) => {
      try {
        const diffs = await api.gitDiffPath(folderPath, compareTargetFile!.rel, ref);
        if (diffs && diffs.length > 0) {
          modalDiffFile = diffs[0];
        } else {
          const fileRef = await api.gitFileAtRef(folderPath, ref, compareTargetFile!.rel);
          const currentText = await api.readFile(`${folderPath}/${compareTargetFile!.rel}`).catch(() => '');
          modalDiffFile = createDiffFileFromTexts(
            `${ref}:${compareTargetFile!.rel}`,
            compareTargetFile!.rel,
            fileRef || '',
            currentText
          );
        }
        modalDiffTitle = `Compare: ${compareTargetFile!.name} vs ${ref}`;
        diffModalOpen = true;
      } catch (err: any) {
        alert('Failed to compare: ' + (err?.message || String(err)));
      }
    }}
  />
{/if}

{#if localHistoryOpen && localHistoryTarget}
  <LocalHistoryModal
    {folderPath}
    relPath={localHistoryTarget.rel}
    absPath={localHistoryTarget.abs}
    isDir={localHistoryTarget.isDir}
    onclose={() => (localHistoryOpen = false)}
    onrevert={async (revPath) => {
      const leaf = revPath.split('/').pop() || revPath;
      const content = await api.readFile(revPath).catch(() => '');
      tabsManager.openTab(revPath, leaf, content);
      await refreshExpandedFolders([revPath]);
    }}
  />
{/if}

{#if diffModalOpen}
  <DiffModal
    diffFile={modalDiffFile}
    title={modalDiffTitle}
    onclose={() => (diffModalOpen = false)}
  />
{/if}

<style>
  .file-tree {
    width: 250px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    outline: none;
  }
  .header {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid #1c1d22;
  }
  .header-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.15s;
  }
  .icon-btn:hover {
    color: #d8d9dc;
    background: #1f2026;
  }
  .open-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #6ea8ff;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .open-btn:hover {
    background: #1f2a3d;
  }
  .root-folder {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    color: #e6e7ea;
    border-bottom: 1px solid #1c1d22;
  }
  .caret {
    color: #8b8f98;
    font-size: 11px;
  }
  .tree-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding-right: 12px;
    font-size: 13px;
    color: #bcbec4;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
    border: none;
    background: transparent;
    cursor: pointer;
    box-sizing: border-box;
  }
  .item:hover {
    background: #1b1c21;
    color: #e6e7ea;
  }
  .item.selected {
    background: #202a3a;
    color: #e6efff;
  }
  .file-item.active {
    background: #1f2a3d;
    color: #9cc3ff;
  }
  .item-caret {
    font-size: 10px;
    color: #6e727b;
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .item-spacer {
    width: 12px;
    flex-shrink: 0;
  }
  .item-icon {
    flex-shrink: 0;
  }
  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .item-name.dir-changed {
    color: #e2e4e9;
  }
  .loading-node {
    height: 20px;
    display: flex;
    align-items: center;
    font-size: 11px;
    color: #5b5f68;
  }
  .empty-folder {
    padding: 16px;
    color: #8b8f98;
    font-size: 12px;
    text-align: center;
  }
  .empty-state {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    color: #8b8f98;
  }
  .empty-label {
    font-size: 12px;
    color: #8b8f98;
    text-align: center;
  }
  .open-folder-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 6px;
    background: #1f2a3d;
    color: #6ea8ff;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #2a3d5e;
    cursor: pointer;
    transition: background 0.15s;
  }
  .open-folder-btn:hover {
    background: #253652;
  }
  .recent-section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .recent-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #5b5f68;
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .recent-item {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border-radius: 5px;
    background: #18191d;
    border: 1px solid #22242a;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .recent-item:hover {
    background: #202227;
  }
  .recent-name {
    font-size: 12px;
    color: #d8d9dc;
    font-weight: 500;
  }
  .recent-path {
    font-size: 10px;
    color: #6e727b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Inline Rename input */
  .rename-input-wrap {
    display: inline-flex;
    align-items: center;
    position: relative;
    flex: 1;
  }
  .rename-input {
    background: #141518;
    border: 1px solid #6ea8ff;
    border-radius: 4px;
    color: #d8d9dc;
    font-family: inherit;
    font-size: 13px;
    height: 22px;
    padding: 0 4px;
    outline: none;
    width: 130px;
  }
  .rename-input.has-error {
    border-color: #f07a74;
  }
  .rename-ext {
    color: #8b8f98;
    margin-left: 2px;
    font-size: 13px;
  }
  .rename-tooltip {
    position: absolute;
    top: 26px;
    left: 0;
    background: #2c1d1f;
    border: 1px solid #f07a74;
    color: #f0a6a2;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }
</style>

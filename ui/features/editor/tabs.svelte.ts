import type { EditorState } from '@codemirror/state';

export interface TabItem {
  path: string;
  name: string;
  savedContent: string;
  dirty: boolean;
  state?: EditorState;
  externalConflict?: boolean;
  pendingDiskContent?: string;
}

class TabsManager {
  tabs = $state<TabItem[]>([]);
  activePath = $state<string>('');
  recentFiles = $state<string[]>([]); // in-memory, newest in front

  get activeTab(): TabItem | undefined {
    return this.tabs.find((t) => t.path === this.activePath);
  }

  get activeIndex(): number {
    return this.tabs.findIndex((t) => t.path === this.activePath);
  }

  openTab(path: string, name: string, content: string, state?: EditorState): TabItem {
    const existing = this.tabs.find((t) => t.path === path);
    this.recordRecentFile(path);
    if (existing) {
      this.activePath = path;
      return existing;
    }
    const newTab: TabItem = {
      path,
      name,
      savedContent: content,
      dirty: false,
      state,
      externalConflict: false,
    };
    this.tabs.push(newTab);
    this.activePath = path;
    return newTab;
  }

  setActive(path: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab) {
      this.activePath = path;
      this.recordRecentFile(path);
    }
  }

  closeTab(path: string): boolean {
    const idx = this.tabs.findIndex((t) => t.path === path);
    if (idx === -1) return false;
    const tab = this.tabs[idx];
    if (tab.dirty) {
      const ok = window.confirm(`Close ${tab.name}? Unsaved changes will be lost.`);
      if (!ok) return false;
    }
    this.tabs.splice(idx, 1);
    if (this.activePath === path) {
      if (this.tabs.length > 0) {
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        this.activePath = this.tabs[nextIdx].path;
        this.recordRecentFile(this.activePath);
      } else {
        this.activePath = '';
      }
    }
    return true;
  }

  markSaved(path: string, newContent: string) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab) {
      tab.savedContent = newContent;
      tab.dirty = false;
      tab.externalConflict = false;
      tab.pendingDiskContent = undefined;
    }
  }

  markDirty(path: string, dirty: boolean) {
    const tab = this.tabs.find((t) => t.path === path);
    if (tab && tab.dirty !== dirty) {
      tab.dirty = dirty;
    }
  }

  recordRecentFile(path: string) {
    this.recentFiles = [path, ...this.recentFiles.filter((p) => p !== path)];
  }

  renamePath(oldPath: string, newPath: string) {
    for (const tab of this.tabs) {
      if (tab.path === oldPath) {
        tab.path = newPath;
        tab.name = newPath.split('/').pop() || newPath;
        if (this.activePath === oldPath) {
          this.activePath = newPath;
        }
      } else if (tab.path.startsWith(oldPath + '/')) {
        const rest = tab.path.slice(oldPath.length);
        tab.path = newPath + rest;
        tab.name = tab.path.split('/').pop() || tab.path;
        if (this.activePath.startsWith(oldPath + '/')) {
          this.activePath = newPath + rest;
        }
      }
    }
  }

  closeOthers(keepPath: string): boolean {
    const toClose = this.tabs.filter((t) => t.path !== keepPath);
    for (const tab of toClose) {
      if (!this.closeTab(tab.path)) return false;
    }
    this.setActive(keepPath);
    return true;
  }

  closeToRight(targetPath: string): boolean {
    const idx = this.tabs.findIndex((t) => t.path === targetPath);
    if (idx === -1) return false;
    const toClose = this.tabs.slice(idx + 1);
    for (const tab of toClose) {
      if (!this.closeTab(tab.path)) return false;
    }
    return true;
  }

  closeAll(): boolean {
    const copy = [...this.tabs];
    for (const tab of copy) {
      if (!this.closeTab(tab.path)) return false;
    }
    return true;
  }

  clearAll() {
    this.tabs = [];
    this.activePath = '';
  }
}

export const tabsManager = new TabsManager();

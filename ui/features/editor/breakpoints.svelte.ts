/**
 * Breakpoint management for Petak IDE (ala Android Studio).
 * Tracks breakpoints per file path and line number, persisted in localStorage.
 */

class BreakpointStore {
  breakpoints = $state<Record<string, number[]>>({});

  constructor() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('petak.breakpoints');
        if (raw) {
          this.breakpoints = JSON.parse(raw);
        }
      } catch (_) {}
    }
  }

  save() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('petak.breakpoints', JSON.stringify(this.breakpoints));
      } catch (_) {}
    }
  }

  getBreakpoints(path: string | null | undefined): number[] {
    if (!path) return [];
    return this.breakpoints[path] || [];
  }

  hasBreakpoint(path: string, line: number): boolean {
    const list = this.getBreakpoints(path);
    return list.includes(line);
  }

  toggle(path: string, line: number): boolean {
    const current = this.breakpoints[path] ? [...this.breakpoints[path]] : [];
    const idx = current.indexOf(line);
    let added = false;
    if (idx >= 0) {
      current.splice(idx, 1);
      added = false;
    } else {
      current.push(line);
      current.sort((a, b) => a - b);
      added = true;
    }

    if (current.length === 0) {
      delete this.breakpoints[path];
    } else {
      this.breakpoints[path] = current;
    }
    this.save();
    return added;
  }

  remove(path: string, line: number) {
    if (!this.breakpoints[path]) return;
    const current = this.breakpoints[path].filter((l) => l !== line);
    if (current.length === 0) {
      delete this.breakpoints[path];
    } else {
      this.breakpoints[path] = current;
    }
    this.save();
  }

  clear(path?: string) {
    if (path) {
      delete this.breakpoints[path];
    } else {
      this.breakpoints = {};
    }
    this.save();
  }
}

export const breakpointStore = new BreakpointStore();

import { api, type UnlistenFn, type LogLine } from '../../lib/api';
import {
  type LogItem,
  type LogcatFilter,
  type LogLevel,
  filterLogLines,
  LogcatRingBuffer,
} from './logcat';
import { runStore } from './runStore.svelte';

class LogcatStore {
  // Bounded ring buffer cap 50k
  ringBuffer = new LogcatRingBuffer(50000);

  // Filter state
  minLevel = $state<LogLevel>('V');
  tagFilter = $state<string>('');
  searchQuery = $state<string>('');
  packageMine = $state<boolean>(false);

  // Playback & view states
  isPaused = $state<boolean>(false);
  autoScroll = $state<boolean>(true);

  // Filtered lines for display
  filteredLines = $state<LogItem[]>([]);
  totalBufferedCount = $state<number>(0);

  // Event listener & timers
  private unlistenBatch: UnlistenFn | null = null;
  private rafId: number | null = null;
  private debounceTimer: any = null;

  constructor() {
    this.initListener();
  }

  async initListener() {
    try {
      this.unlistenBatch = await api.onLogcatBatch((batch) => {
        this.handleBatch(batch);
      });
    } catch (e) {
      console.warn('[logcatStore] Failed to listen to logcat-batch:', e);
    }
  }

  handleBatch(batch: LogLine[]) {
    if (!batch || batch.length === 0) return;

    this.ringBuffer.pushBatch(batch);
    this.totalBufferedCount = this.ringBuffer.length;

    if (this.isPaused) {
      // Buffer continues collecting, rendering stays paused
      return;
    }

    this.scheduleRafUpdate();
  }

  scheduleRafUpdate() {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') {
      if (typeof requestAnimationFrame === 'undefined') {
        this.applyFilter();
      }
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.applyFilter();
    });
  }

  get currentFilter(): LogcatFilter {
    return {
      minLevel: this.minLevel,
      tag: this.tagFilter,
      search: this.searchQuery,
      packageMine: this.packageMine,
      appPid: runStore.pid,
    };
  }

  applyFilter() {
    this.filteredLines = filterLogLines(this.ringBuffer.getAll(), this.currentFilter);
  }

  setMinLevel(level: LogLevel) {
    this.minLevel = level;
    this.scheduleRafUpdate();
  }

  setTagFilter(tag: string) {
    this.tagFilter = tag;
    this.scheduleRafUpdate();
  }

  setSearchQuery(q: string) {
    // Debounce search text 100 ms as specified
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.searchQuery = q;
      this.scheduleRafUpdate();
    }, 100);
  }

  setSearchQueryImmediate(q: string) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.searchQuery = q;
    this.scheduleRafUpdate();
  }

  togglePackageMine() {
    this.packageMine = !this.packageMine;
    this.scheduleRafUpdate();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    if (!this.isPaused) {
      this.scheduleRafUpdate();
    }
  }

  clear() {
    this.ringBuffer.clear();
    this.totalBufferedCount = 0;
    this.filteredLines = [];
  }

  destroy() {
    if (this.unlistenBatch) {
      this.unlistenBatch();
      this.unlistenBatch = null;
    }
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

export const logcatStore = new LogcatStore();

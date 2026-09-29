import type { LogLevel, LogLine } from '../../lib/api';

export type { LogLevel, LogLine };

export interface LogItem extends LogLine {
  id?: number;
}

export const LEVEL_WEIGHT: Record<LogLevel, number> = {
  V: 0,
  D: 1,
  I: 2,
  W: 3,
  E: 4,
  F: 5,
};

export const LEVEL_COLORS: Record<LogLevel, string> = {
  V: '#6e7380',
  D: '#8b8f98',
  I: '#7fc98f',
  W: '#e8b45a',
  E: '#f07a74',
  F: '#f07a74',
};

export const LEVEL_BG: Partial<Record<LogLevel, string>> = {
  E: '#2a1d1e',
  F: '#381c1e',
};

export interface StackLink {
  file: string;
  line: number;
  col: number | null;
  raw: string;
  startIndex: number;
  endIndex: number;
}

export interface MessagePart {
  text: string;
  link?: StackLink;
}

/**
 * Port of core stack_links from crates/core/src/run/logs.rs:
 * 1. Dart package: package:<pkg>/<subpath>.dart:line:col
 * 2. Dart file uri: file:///<path>:line:col
 * 3. Dart relative: lib/...dart:line:col
 * 4. Java/Kotlin stack trace: at a.b.C.m(Foo.kt:42) or Foo.java:42
 */
export function parseStackLinks(msg: string, root?: string): StackLink[] {
  const links: StackLink[] = [];

  // 1. Dart package: package:<pkg>/<subpath>.dart:line:col or ...:line
  const rePkg = /package:[a-zA-Z0-9_-]+\/([a-zA-Z0-9_\/-]+\.dart):(\d+)(?::(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = rePkg.exec(msg)) !== null) {
    const subpath = m[1];
    const line = parseInt(m[2], 10);
    const col = m[3] ? parseInt(m[3], 10) : null;
    const normRoot = root ? root.replace(/\/+$/, '') : '';
    const file = normRoot ? `${normRoot}/lib/${subpath}` : `lib/${subpath}`;
    links.push({
      file,
      line,
      col,
      raw: m[0],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }

  // 2. Dart file uri: file:///<path>:line:col or ...:line
  const reFile = /file:\/\/([^\s:()]+):(\d+)(?::(\d+))?/g;
  while ((m = reFile.exec(msg)) !== null) {
    const rawPath = m[1];
    const line = parseInt(m[2], 10);
    const col = m[3] ? parseInt(m[3], 10) : null;
    links.push({
      file: rawPath,
      line,
      col,
      raw: m[0],
      startIndex: m.index,
      endIndex: m.index + m[0].length,
    });
  }

  // 3. Dart relative lib/...dart:line:col
  const reLib = /(?:^|[\s(])(lib\/[a-zA-Z0-9_\/-]+\.dart):(\d+)(?::(\d+))?/g;
  while ((m = reLib.exec(msg)) !== null) {
    const rel = m[1];
    const line = parseInt(m[2], 10);
    const col = m[3] ? parseInt(m[3], 10) : null;
    const matchOffset = m[0].indexOf(rel);
    const startIndex = m.index + matchOffset;
    const raw = m[0].slice(matchOffset);
    const normRoot = root ? root.replace(/\/+$/, '') : '';
    const file = normRoot ? `${normRoot}/${rel}` : rel;
    links.push({
      file,
      line,
      col,
      raw,
      startIndex,
      endIndex: startIndex + raw.length,
    });
  }

  // 4. Java/Kotlin stack trace: at a.b.C.m(Foo.kt:42) or Foo.java:42
  const reJvm = /\bat\s+[a-zA-Z0-9_$.]+\(([^:)]+\.(?:kt|java)):(\d+)(?::(\d+))?\)/g;
  while ((m = reJvm.exec(msg)) !== null) {
    const filename = m[1];
    const line = parseInt(m[2], 10);
    const col = m[3] ? parseInt(m[3], 10) : null;
    // We can link either the whole `at ...(Foo.kt:42)` or just the file:line token inside parens.
    // Making the whole `at ...(Foo.kt:42)` or the file:line clickable:
    const fileToken = `${filename}:${m[2]}${m[3] ? `:${m[3]}` : ''}`;
    const tokenOffset = m[0].indexOf(fileToken);
    const startIndex = tokenOffset !== -1 ? m.index + tokenOffset : m.index;
    const raw = tokenOffset !== -1 ? fileToken : m[0];
    links.push({
      file: filename,
      line,
      col,
      raw,
      startIndex,
      endIndex: startIndex + raw.length,
    });
  }

  // Sort and remove duplicates / overlaps
  links.sort((a, b) => a.startIndex - b.startIndex);
  const deduped: StackLink[] = [];
  let lastEnd = 0;
  for (const l of links) {
    if (l.startIndex >= lastEnd) {
      deduped.push(l);
      lastEnd = l.endIndex;
    }
  }

  return deduped;
}

export function splitLogMessageWithLinks(msg: string, links: StackLink[]): MessagePart[] {
  if (!links || links.length === 0) {
    return [{ text: msg }];
  }
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  for (const link of links) {
    if (link.startIndex > lastIndex) {
      parts.push({ text: msg.slice(lastIndex, link.startIndex) });
    }
    parts.push({
      text: link.raw,
      link,
    });
    lastIndex = Math.max(lastIndex, link.endIndex);
  }
  if (lastIndex < msg.length) {
    parts.push({ text: msg.slice(lastIndex) });
  }
  return parts;
}

export interface LogcatFilter {
  minLevel: LogLevel;
  tag: string;
  search: string;
  packageMine: boolean;
  appPid: number | null;
}

export function defaultLogcatFilter(): LogcatFilter {
  return {
    minLevel: 'V',
    tag: '',
    search: '',
    packageMine: false,
    appPid: null,
  };
}

export function matchesFilter(line: LogItem, filter: LogcatFilter): boolean {
  if (LEVEL_WEIGHT[line.level] < LEVEL_WEIGHT[filter.minLevel]) {
    return false;
  }
  if (filter.packageMine && filter.appPid !== null) {
    if (line.pid !== filter.appPid) {
      return false;
    }
  }
  if (filter.tag) {
    const t = filter.tag.trim().toLowerCase();
    if (t && !line.tag.toLowerCase().includes(t)) {
      return false;
    }
  }
  if (filter.search) {
    const q = filter.search.trim().toLowerCase();
    if (q) {
      const matchMsg = line.msg.toLowerCase().includes(q);
      const matchTag = line.tag.toLowerCase().includes(q);
      if (!matchMsg && !matchTag) {
        return false;
      }
    }
  }
  return true;
}

export function filterLogLines(lines: LogItem[], filter: LogcatFilter): LogItem[] {
  const isDefault =
    filter.minLevel === 'V' &&
    !filter.tag.trim() &&
    !filter.search.trim() &&
    (!filter.packageMine || filter.appPid === null);

  if (isDefault) {
    return lines;
  }

  const tagLower = filter.tag.trim().toLowerCase();
  const searchLower = filter.search.trim().toLowerCase();
  const minWeight = LEVEL_WEIGHT[filter.minLevel];
  const filterPid = filter.packageMine ? filter.appPid : null;

  const result: LogItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (LEVEL_WEIGHT[l.level] < minWeight) continue;
    if (filterPid !== null && l.pid !== filterPid) continue;
    if (tagLower && !l.tag.toLowerCase().includes(tagLower)) continue;
    if (searchLower) {
      if (!l.msg.toLowerCase().includes(searchLower) && !l.tag.toLowerCase().includes(searchLower)) {
        continue;
      }
    }
    result.push(l);
  }
  return result;
}

export class LogcatRingBuffer {
  private buffer: LogItem[] = [];
  private capacity: number;
  private nextId: number = 1;

  constructor(capacity: number = 50000) {
    this.capacity = capacity;
  }

  pushBatch(batch: LogLine[]): LogItem[] {
    if (batch.length === 0) return [];

    const prepared: LogItem[] = new Array(batch.length);
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      prepared[i] = {
        ts: item.ts,
        pid: item.pid,
        tid: item.tid,
        level: item.level,
        tag: item.tag,
        msg: item.msg,
        id: (item as LogItem).id ?? this.nextId++,
      };
    }

    if (prepared.length >= this.capacity) {
      this.buffer = prepared.slice(prepared.length - this.capacity);
      return prepared;
    }

    for (let i = 0; i < prepared.length; i++) {
      this.buffer.push(prepared[i]);
    }

    if (this.buffer.length > this.capacity) {
      const excess = this.buffer.length - this.capacity;
      this.buffer.splice(0, excess);
    }

    return prepared;
  }

  clear(): void {
    this.buffer = [];
  }

  get length(): number {
    return this.buffer.length;
  }

  getAll(): LogItem[] {
    return this.buffer;
  }

  get(index: number): LogItem | undefined {
    return this.buffer[index];
  }
}

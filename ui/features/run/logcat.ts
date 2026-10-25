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

export const TAG_PALETTE: readonly string[] = [
  '#4ec9b0', // teal
  '#e8b45a', // amber
  '#b180d7', // violet
  '#4fc1ff', // cyan
  '#56a8f5', // sky
  '#f08d49', // coral
  '#7fc98f', // mint
  '#e57373', // rose
];

export function getTagColor(tag: string): string {
  if (!tag || typeof tag !== 'string' || !tag.trim()) {
    return '#8b8f98';
  }
  const str = tag.trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % TAG_PALETTE.length;
  return TAG_PALETTE[idx];
}

export interface ParsedLogcatDsl {
  tags: string[];          // tag:... (inclusive)
  excludeTags: string[];   // -tag:... (exclude)
  minLevel?: LogLevel;     // level:...
  packageMine?: boolean;   // package:mine or app:mine
  textTerms: string[];     // free text words
}

export function parseLogcatFilter(query: string): ParsedLogcatDsl {
  const dsl: ParsedLogcatDsl = {
    tags: [],
    excludeTags: [],
    textTerms: [],
  };

  if (!query || typeof query !== 'string' || !query.trim()) {
    return dsl;
  }

  const tokens = query.trim().split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower === 'package:mine' || lower === 'app:mine') {
      dsl.packageMine = true;
    } else if (lower.startsWith('-tag:')) {
      const val = token.slice(5).trim().replace(/^["']|["']$/g, '');
      if (val) {
        dsl.excludeTags.push(val);
      }
    } else if (lower.startsWith('tag:')) {
      const val = token.slice(4).trim().replace(/^["']|["']$/g, '');
      if (val) {
        dsl.tags.push(val);
      }
    } else if (lower.startsWith('level:')) {
      const val = lower.slice(6).trim();
      let normalized: LogLevel | undefined;
      switch (val) {
        case 'v':
        case 'verbose':
          normalized = 'V';
          break;
        case 'd':
        case 'debug':
          normalized = 'D';
          break;
        case 'i':
        case 'info':
          normalized = 'I';
          break;
        case 'w':
        case 'warn':
        case 'warning':
          normalized = 'W';
          break;
        case 'e':
        case 'error':
          normalized = 'E';
          break;
        case 'f':
        case 'fatal':
          normalized = 'F';
          break;
      }
      if (normalized) {
        dsl.minLevel = normalized;
      } else {
        dsl.textTerms.push(token);
      }
    } else {
      dsl.textTerms.push(token);
    }
  }

  return dsl;
}

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
  caseSensitive?: boolean;
  isRegex?: boolean;
  dsl?: ParsedLogcatDsl;
  includeNativeLogs?: boolean;
}

export function defaultLogcatFilter(): LogcatFilter {
  return {
    minLevel: 'V',
    tag: '',
    search: '',
    packageMine: false,
    appPid: null,
    caseSensitive: false,
    isRegex: false,
    includeNativeLogs: true,
  };
}

export function matchesFilter(line: LogItem, filter: LogcatFilter): boolean {
  const dsl = filter.dsl ?? (filter.isRegex ? undefined : parseLogcatFilter(filter.search));

  const effectiveMinLevel = dsl?.minLevel ?? filter.minLevel;
  if (LEVEL_WEIGHT[line.level] < LEVEL_WEIGHT[effectiveMinLevel]) {
    return false;
  }

  const effectivePackageMine = dsl?.packageMine ?? filter.packageMine;
  if (effectivePackageMine && filter.appPid !== null) {
    if (line.pid !== filter.appPid) {
      return false;
    }
  }

  if (filter.includeNativeLogs === false) {
    const isFlutter = /^(flutter|dart)/i.test(line.tag);
    if (!isFlutter) {
      return false;
    }
  }

  if (filter.tag) {
    const t = filter.tag.trim();
    if (t) {
      if (filter.isRegex) {
        try {
          const re = new RegExp(t, filter.caseSensitive ? '' : 'i');
          if (!re.test(line.tag)) return false;
        } catch {
          if (!line.tag.toLowerCase().includes(t.toLowerCase())) return false;
        }
      } else if (filter.caseSensitive) {
        if (!line.tag.includes(t)) return false;
      } else {
        if (!line.tag.toLowerCase().includes(t.toLowerCase())) return false;
      }
    }
  }

  if (dsl && dsl.tags.length > 0) {
    const matchTag = dsl.tags.some((tag) =>
      line.tag.toLowerCase().includes(tag.toLowerCase())
    );
    if (!matchTag) return false;
  }

  if (dsl && dsl.excludeTags.length > 0) {
    const isExcluded = dsl.excludeTags.some((tag) =>
      line.tag.toLowerCase().includes(tag.toLowerCase())
    );
    if (isExcluded) return false;
  }

  if (filter.search && filter.isRegex) {
    const q = filter.search.trim();
    if (q) {
      try {
        const re = new RegExp(q, filter.caseSensitive ? '' : 'i');
        if (!re.test(line.msg) && !re.test(line.tag)) return false;
      } catch {
        if (!line.msg.toLowerCase().includes(q.toLowerCase()) && !line.tag.toLowerCase().includes(q.toLowerCase())) return false;
      }
    }
    return true;
  }

  if (dsl && dsl.textTerms.length > 0) {
    for (const term of dsl.textTerms) {
      if (filter.caseSensitive) {
        if (!line.msg.includes(term) && !line.tag.includes(term)) {
          return false;
        }
      } else {
        const termLower = term.toLowerCase();
        if (!line.msg.toLowerCase().includes(termLower) && !line.tag.toLowerCase().includes(termLower)) {
          return false;
        }
      }
    }
  }

  return true;
}

export function filterLogLines(lines: LogItem[], filter: LogcatFilter): LogItem[] {
  const dsl = filter.dsl ?? (filter.isRegex ? undefined : parseLogcatFilter(filter.search));

  const isDefault =
    filter.minLevel === 'V' &&
    !filter.tag.trim() &&
    !filter.search.trim() &&
    (!filter.packageMine || filter.appPid === null) &&
    !dsl?.tags?.length &&
    !dsl?.excludeTags?.length &&
    !dsl?.textTerms?.length &&
    dsl?.minLevel === undefined &&
    dsl?.packageMine === undefined &&
    filter.includeNativeLogs !== false;

  if (isDefault) {
    return lines;
  }

  const effectiveFilter = dsl ? { ...filter, dsl } : filter;
  const result: LogItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (matchesFilter(lines[i], effectiveFilter)) {
      result.push(lines[i]);
    }
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

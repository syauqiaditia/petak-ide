import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import { setDiagnostics } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import type { LspDiagnostic } from '../../../lib/api';
import { lspPosToOffset } from './pos';

export interface FileDiagnostic {
  path: string;
  line: number; // 1-based
  col: number; // 1-based
  endLine: number;
  endCol: number;
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
  code?: string | number;
}

class DiagnosticsStore {
  byFile = $state<Map<string, FileDiagnostic[]>>(new Map());

  get totalErrors(): number {
    let count = 0;
    for (const diags of this.byFile.values()) {
      for (const d of diags) {
        if (d.severity === 'error') count++;
      }
    }
    return count;
  }

  get totalWarnings(): number {
    let count = 0;
    for (const diags of this.byFile.values()) {
      for (const d of diags) {
        if (d.severity === 'warning') count++;
      }
    }
    return count;
  }

  get totalCount(): number {
    let count = 0;
    for (const diags of this.byFile.values()) {
      count += diags.length;
    }
    return count;
  }

  setForFile(path: string, diags: FileDiagnostic[]) {
    const next = new Map(this.byFile);
    if (diags.length === 0) {
      next.delete(path);
    } else {
      next.set(path, diags);
    }
    this.byFile = next;
  }

  getForFile(path: string): FileDiagnostic[] {
    return this.byFile.get(path) ?? [];
  }

  clear() {
    this.byFile = new Map();
  }
}

export const diagnosticsStore = new DiagnosticsStore();

export function lspSeverityToCm(sev?: number): 'error' | 'warning' | 'info' | 'hint' {
  switch (sev) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    case 3:
      return 'info';
    case 4:
    default:
      return 'hint';
  }
}

/**
 * Custom DOM renderer for the lint popup matching Petak design.
 */
function renderLintPopup(diag: FileDiagnostic): HTMLElement {
  const container = document.createElement('div');
  container.className = 'petak-lint-popup';
  container.style.cssText = 'width: 380px; overflow: hidden;';

  // Body: icon + message + source
  const body = document.createElement('div');
  body.style.cssText = 'padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start;';

  const isError = diag.severity === 'error';
  const color = isError ? '#f07a74' : '#e8b45a';

  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '16');
  iconSvg.setAttribute('height', '16');
  iconSvg.setAttribute('viewBox', '0 0 24 24');
  iconSvg.setAttribute('fill', 'none');
  iconSvg.setAttribute('stroke', color);
  iconSvg.setAttribute('stroke-width', '2');
  iconSvg.setAttribute('stroke-linecap', 'round');
  iconSvg.style.cssText = 'flex-shrink: 0; margin-top: 1px;';

  if (isError) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '12');
    line1.setAttribute('y1', '8');
    line1.setAttribute('x2', '12');
    line1.setAttribute('y2', '12');
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '12');
    line2.setAttribute('y1', '16');
    line2.setAttribute('x2', '12.01');
    line2.setAttribute('y2', '16');
    iconSvg.appendChild(circle);
    iconSvg.appendChild(line1);
    iconSvg.appendChild(line2);
  } else {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 3l10 18H2z');
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line1.setAttribute('d', 'M12 10v5M12 18v.01');
    iconSvg.appendChild(path);
    iconSvg.appendChild(line1);
  }
  body.appendChild(iconSvg);

  const textCol = document.createElement('div');
  textCol.style.cssText = 'display: flex; flex-direction: column; gap: 3px; overflow: hidden;';

  const msgSpan = document.createElement('span');
  msgSpan.style.cssText = 'font-size: 13px; line-height: 18px; color: #e6e7ea; word-break: break-word;';
  msgSpan.textContent = diag.message;
  textCol.appendChild(msgSpan);

  const metaParts: string[] = [];
  if (diag.source) metaParts.push(diag.source);
  if (diag.code) metaParts.push(String(diag.code));
  if (metaParts.length > 0) {
    const metaSpan = document.createElement('span');
    metaSpan.style.cssText = 'font-size: 11px; color: #8b8f98;';
    metaSpan.textContent = metaParts.join(' · ');
    textCol.appendChild(metaSpan);
  }

  body.appendChild(textCol);
  container.appendChild(body);

  // Footer: quick fix slot + Ask agent (disabled)
  const footer = document.createElement('div');
  footer.style.cssText =
    'display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid #2f3137; background: #1d1f24; align-items: center;';

  // Slot for quick fix actions (P2.4)
  const actionSlot = document.createElement('div');
  actionSlot.className = 'quick-fix-slot';
  actionSlot.style.cssText = 'display: flex; gap: 6px;';
  footer.appendChild(actionSlot);

  // Ask agent button (disabled)
  const agentBtn = document.createElement('button');
  agentBtn.disabled = true;
  agentBtn.style.cssText =
    'height: 26px; padding: 0 8px; border-radius: 5px; color: #e8b45a; margin-left: auto; display: flex; align-items: center; gap: 6px; background: none; border: 1px solid #34363d; opacity: 0.5; cursor: not-allowed; font-size: 12px;';

  const sparkle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sparkle.setAttribute('width', '13');
  sparkle.setAttribute('height', '13');
  sparkle.setAttribute('viewBox', '0 0 24 24');
  sparkle.setAttribute('fill', 'none');
  sparkle.setAttribute('stroke', 'currentColor');
  sparkle.setAttribute('stroke-width', '2');
  sparkle.setAttribute('stroke-linejoin', 'round');
  const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  starPath.setAttribute('d', 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z');
  sparkle.appendChild(starPath);

  agentBtn.appendChild(sparkle);
  const btnText = document.createTextNode('Ask agent');
  agentBtn.appendChild(btnText);
  footer.appendChild(agentBtn);

  container.appendChild(footer);
  return container;
}

export function convertLspToCmDiagnostics(
  doc: Text,
  rawDiags: LspDiagnostic[],
  filePath: string
): { cmDiags: CmDiagnostic[]; fileDiags: FileDiagnostic[] } {
  const cmDiags: CmDiagnostic[] = [];
  const fileDiags: FileDiagnostic[] = [];

  for (const raw of rawDiags) {
    let from = lspPosToOffset(doc, raw.range.start);
    let to = lspPosToOffset(doc, raw.range.end);
    if (to <= from) {
      to = Math.min(from + 1, doc.length);
    }

    const severity = lspSeverityToCm(raw.severity);
    const fileDiag: FileDiagnostic = {
      path: filePath,
      line: raw.range.start.line + 1,
      col: raw.range.start.character + 1,
      endLine: raw.range.end.line + 1,
      endCol: raw.range.end.character + 1,
      from,
      to,
      severity,
      message: raw.message,
      source: raw.source,
      code: raw.code,
    };
    fileDiags.push(fileDiag);

    cmDiags.push({
      from,
      to,
      severity,
      message: raw.message,
      source: raw.source,
      renderMessage: () => renderLintPopup(fileDiag),
    });
  }

  return { cmDiags, fileDiags };
}

export function applyDiagnosticsToView(
  view: EditorView,
  filePath: string,
  rawDiags: LspDiagnostic[]
) {
  const { cmDiags, fileDiags } = convertLspToCmDiagnostics(view.state.doc, rawDiags, filePath);
  diagnosticsStore.setForFile(filePath, fileDiags);
  view.dispatch(setDiagnostics(view.state, cmDiags));
}

export function applyStoredDiagnosticsToView(view: EditorView, filePath: string) {
  const fileDiags = diagnosticsStore.getForFile(filePath);
  const doc = view.state.doc;
  const cmDiags: CmDiagnostic[] = fileDiags.map((d) => {
    let from = d.from;
    let to = d.to;
    if (from > doc.length) from = doc.length;
    if (to > doc.length) to = doc.length;
    if (to <= from && doc.length > 0) to = Math.min(from + 1, doc.length);
    return {
      from,
      to,
      severity: d.severity,
      message: d.message,
      source: d.source,
      renderMessage: () => renderLintPopup(d),
    };
  });
  view.dispatch(setDiagnostics(view.state, cmDiags));
}

export function handleIncomingDiagnostics(
  payload: { path: string; diagnostics: LspDiagnostic[] },
  activeView: EditorView | null,
  activePath: string | null,
  getDocForPath?: (path: string) => Text | null
) {
  const { path, diagnostics } = payload;
  if (activeView && activePath === path) {
    applyDiagnosticsToView(activeView, path, diagnostics);
  } else {
    const doc = getDocForPath ? getDocForPath(path) : null;
    if (doc) {
      const { fileDiags } = convertLspToCmDiagnostics(doc, diagnostics, path);
      diagnosticsStore.setForFile(path, fileDiags);
    } else {
      const fileDiags: FileDiagnostic[] = diagnostics.map((d) => ({
        path,
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        endLine: d.range.end.line + 1,
        endCol: d.range.end.character + 1,
        from: 0,
        to: 0,
        severity: lspSeverityToCm(d.severity),
        message: d.message,
        source: d.source,
        code: d.code,
      }));
      diagnosticsStore.setForFile(path, fileDiags);
    }
  }
}


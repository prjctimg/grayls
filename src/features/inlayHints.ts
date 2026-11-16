import type { DocumentStore, InlayHint, Range } from '../types';
import { InlayHintKind, DiagnosticSeverity } from '../types';
import { scanSymbols } from '../utils/symbols';
import { computeDiagnostics } from './diagnostics';
import { findTestBlocks, getTestStatuses, testStatusIcon } from '../utils/test-status';

function isInsideRange(line: number, character: number, range?: Range): boolean {
  if (!range) return true;
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && character < range.start.character) return false;
  if (line === range.end.line && character > range.end.character) return false;
  return true;
}

function splitArgs(text: string): { value: string; offset: number }[] {
  const out: { value: string; offset: number }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push({ value: text.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (text.slice(start).trim().length > 0 || out.length > 0) {
    out.push({ value: text.slice(start), offset: start });
  }
  return out;
}

export function provideInlayHints(
  params: { textDocument: { uri: string }; range: Range },
  documents: DocumentStore,
): InlayHint[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const symbols = scanSymbols(text);
  const funcs = new Map(symbols.filter(s => s.kind === 'function' && s.params).map(s => [s.name, s]));
  const lines = text.split('\n');
  const hints: InlayHint[] = [];

  for (let li = params.range.start.line; li <= Math.min(params.range.end.line, lines.length - 1); li++) {
    const line = lines[li];
    // find simple call patterns: name(...)
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const fnName = m[1];
      const fn = funcs.get(fnName);
      if (!fn || !fn.params || fn.params.length === 0) continue;
      // find matching closing paren on this line (simple case)
      let depth = 0;
      let close = -1;
      for (let i = m.index + m[0].length - 1; i < line.length; i++) {
        if (line[i] === '(') depth++;
        else if (line[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
      }
      if (close === -1) continue;
      const argsStr = line.slice(m.index + m[0].length, close);
      const args = splitArgs(argsStr);
      for (let ai = 0; ai < args.length && ai < fn.params.length; ai++) {
        const arg = args[ai];
        const trimmed = arg.value.trimStart();
        if (!trimmed) continue;
        // skip if already a named argument like `name:`
        if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(trimmed)) continue;
        const leadingWs = arg.value.length - trimmed.length;
        const argPosChar = m.index + m[0].length + arg.offset + leadingWs;
        if (!isInsideRange(li, argPosChar, params.range)) continue;
        hints.push({
          position: { line: li, character: argPosChar },
          label: `${fn.params[ai].name}:`,
          kind: InlayHintKind.Parameter,
          paddingRight: true,
        });
      }
    }
  }

  // Show compiler diagnostics as inlay hints at end of line (merged per line).
  try {
    const diags = computeDiagnostics(text);
    const byLine = new Map<number, typeof diags>();
    for (const d of diags) {
      if (d.severity !== DiagnosticSeverity.Error && d.severity !== DiagnosticSeverity.Warning) continue;
      const dl = d.range.start.line;
      if (dl < params.range.start.line || dl > params.range.end.line) continue;
      if (!byLine.has(dl)) byLine.set(dl, []);
      byLine.get(dl)!.push(d);
    }
    for (const [dl, lineDiags] of byLine.entries()) {
      const sorted = [...lineDiags].sort((a, b) => (a.severity - b.severity) || (a.range.start.character - b.range.start.character));
      const parts = sorted.map(d => {
        const icon = d.severity === DiagnosticSeverity.Error ? '' : '';
        const code = d.code ? `[${d.code}] ` : '';
        const msg = (d.message || '').replace(/\s+/g, ' ').trim();
        const short = msg.length > 120 ? msg.slice(0, 117) + '...' : msg;
        return `${icon} ${code}${short}`;
      });
      hints.push({
        position: { line: dl, character: (lines[dl] ?? '').length },
        label: `  ${parts.join('  │  ')}`,
        kind: InlayHintKind.Type,
        paddingLeft: true,
      });
    }
  } catch { /* ignore diagnostic computation errors */ }

  // Show test pass/fail status inline next to test blocks.
  try {
    const tests = findTestBlocks(text);
    if (tests.length > 0) {
      const statuses = getTestStatuses(params.textDocument.uri);
      for (const t of tests) {
        if (t.line < params.range.start.line || t.line > params.range.end.line) continue;
        let state = statuses.get(t.name) ?? statuses.get('*') ?? 'unknown';
        const icon = testStatusIcon(state);
        const label = state === 'passed' ? 'passed' : state === 'failed' ? 'failed' : 'not run';
        hints.push({
          position: { line: t.line, character: (lines[t.line] ?? '').length },
          label: `  ${icon} ${label}`,
          kind: InlayHintKind.Type,
          paddingLeft: true,
        });
      }
    }
  } catch { /* ignore test status errors */ }

  return hints;
}
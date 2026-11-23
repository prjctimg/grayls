import type { DocumentStore, Position, Range, SelectionRange } from '../types';
import { maskNonCode } from '../utils/occurrences';
import { wordRangeAt } from '../utils/occurrences';

function rangeContains(outer: Range, inner: Range): boolean {
  if (outer.start.line > inner.start.line) return false;
  if (outer.start.line === inner.start.line && outer.start.character > inner.start.character) return false;
  if (outer.end.line < inner.end.line) return false;
  if (outer.end.line === inner.end.line && outer.end.character < inner.end.character) return false;
  return true;
}

function braceRanges(text: string): Range[] {
  const masked = maskNonCode(text);
  const lines = masked.split('\n');
  const stack: { line: number; char: number }[] = [];
  const out: Range[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '{') stack.push({ line: li, char: i });
      else if (ch === '}' && stack.length > 0) {
        const s = stack.pop()!;
        out.push({ start: { line: s.line, character: s.char }, end: { line: li, character: i + 1 } });
      }
    }
  }
  return out;
}

function lineRange(text: string, line: number): Range | null {
  const lines = text.split('\n');
  const l = lines[line];
  if (l == null) return null;
  const start = l.search(/\S/);
  const end = l.length;
  if (start < 0) return { start: { line, character: 0 }, end: { line, character: 0 } };
  return { start: { line, character: start }, end: { line, character: end } };
}

function buildForPosition(text: string, pos: Position, blocks: Range[]): SelectionRange {
  const fileRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, text.split('\n').length - 1), character: (text.split('\n').at(-1) ?? '').length },
  };
  const ranges: Range[] = [];
  const w = wordRangeAt(text, pos);
  if (w) ranges.push(w);
  const lr = lineRange(text, pos.line);
  if (lr) ranges.push(lr);
  for (const b of blocks) {
    if (rangeContains(b, w ?? { start: pos, end: pos })) ranges.push(b);
  }
  ranges.push(fileRange);

  // unique, smallest to largest
  const uniq: Range[] = [];
  for (const r of ranges) {
    if (!uniq.some(u => u.start.line === r.start.line && u.start.character === r.start.character && u.end.line === r.end.line && u.end.character === r.end.character)) {
      uniq.push(r);
    }
  }
  uniq.sort((a, b) => {
    const aSize = (a.end.line - a.start.line) * 100000 + (a.end.character - a.start.character);
    const bSize = (b.end.line - b.start.line) * 100000 + (b.end.character - b.start.character);
    if (aSize !== bSize) return aSize - bSize;
    return a.start.line - b.start.line;
  });

  let current: SelectionRange | undefined;
  for (let i = uniq.length - 1; i >= 0; i--) {
    current = { range: uniq[i], parent: current };
  }
  return current ?? { range: fileRange };
}

export function provideSelectionRanges(
  params: { textDocument: { uri: string }; positions: Position[] },
  documents: DocumentStore,
): SelectionRange[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return params.positions.map(p => ({ range: { start: p, end: p } }));
  const text = doc.getText();
  const blocks = braceRanges(text);
  return params.positions.map(p => buildForPosition(text, p, blocks));
}

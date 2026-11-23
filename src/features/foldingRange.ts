import type { DocumentStore, FoldingRange } from '../types';
import { FoldingRangeKind } from '../types';
import { maskNonCode } from '../utils/occurrences';

export function provideFoldingRanges(
  params: { textDocument: { uri: string } },
  documents: DocumentStore,
): FoldingRange[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const masked = maskNonCode(text);
  const lines = masked.split('\n');
  const out: FoldingRange[] = [];

  // Brace blocks
  const stack: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '{') stack.push(li);
      else if (ch === '}' && stack.length > 0) {
        const start = stack.pop()!;
        if (li > start) out.push({ startLine: start, endLine: li });
      }
    }
  }

  // Block comments
  const raw = text.split('\n');
  let inBlock = false;
  let blockStart = -1;
  for (let li = 0; li < raw.length; li++) {
    const line = raw[li];
    if (!inBlock) {
      const idx = line.indexOf('/*');
      if (idx !== -1 && line.indexOf('*/', idx + 2) === -1) {
        inBlock = true;
        blockStart = li;
      }
    } else {
      if (line.includes('*/')) {
        if (li > blockStart) out.push({ startLine: blockStart, endLine: li, kind: FoldingRangeKind.Comment });
        inBlock = false;
      }
    }
  }

  // Consecutive import lines
  let importStart = -1;
  for (let li = 0; li <= raw.length; li++) {
    const line = raw[li] ?? '';
    const isImport = /^\s*(?:import|extern\s+import)\b/.test(line);
    if (isImport) {
      if (importStart === -1) importStart = li;
    } else {
      if (importStart !== -1 && li - 1 > importStart) {
        out.push({ startLine: importStart, endLine: li - 1, kind: FoldingRangeKind.Imports });
      }
      importStart = -1;
    }
  }

  // dedupe
  const seen = new Set<string>();
  return out.filter(r => {
    const k = `${r.startLine}:${r.endLine}:${r.kind ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return r.endLine > r.startLine;
  }).sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

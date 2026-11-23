import type { DocumentHighlight, DocumentStore } from '../types';
import { DocumentHighlightKind } from '../types';
import {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  wordRangeAt,
} from '../utils/occurrences';
import { scanSymbols } from '../utils/symbols';

function isWrite(text: string, line: number, start: number, end: number): boolean {
  const lines = text.split('\n');
  const l = lines[line] ?? '';
  const before = l.slice(0, start).trimEnd();
  const after = l.slice(end).trimStart();
  if (/^(?:mut\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\s+)?(?:[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])*(?:\??))?$/.test(before) && after.startsWith('=')) {
    // crude declaration/assignment heuristic
  }
  if (after.startsWith('=') && !after.startsWith('==')) return true;
  if (/[+\-*/%&|^]=/.test(after.slice(0, 2))) return true;
  // declaration site
  if (/\b(?:mut|const)\s+$/.test(before + ' ') || before === '') {
    const declLine = l.trim();
    if (/^(?:mut\s+|const\s+)?[A-Za-z_][A-Za-z0-9_]*\b/.test(declLine)) return true;
  }
  return false;
}

export function provideDocumentHighlights(
  params: { textDocument: { uri: string }; position: { line: number; character: number } },
  documents: DocumentStore,
): DocumentHighlight[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  if (!isCodePosition(text, params.position)) return [];
  if (isMemberAccessAt(text, params.position)) return [];

  const range = wordRangeAt(text, params.position);
  if (!range) return [];
  const lines = text.split('\n');
  const word = (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
  if (!word) return [];

  // ensure it's a known symbol/reference in file; still highlight plain identifiers conservatively
  const syms = scanSymbols(text);
  const hasSym = syms.some(s => s.name === word);
  if (!hasSym) return [];

  return findWordOccurrences(text, word, { skipMemberAccess: true }).map(r => ({
    range: r,
    kind: isWrite(text, r.start.line, r.start.character, r.end.character)
      ? DocumentHighlightKind.Write
      : DocumentHighlightKind.Read,
  }));
}

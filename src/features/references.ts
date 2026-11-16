import type { DocumentStore, Location } from '../types';
import {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  rangeEquals,
  wordRangeAt,
} from '../utils/occurrences';
import { scanSymbols } from '../utils/symbols';
import { allIndexedFiles, refreshWorkspaceIndex } from '../utils/workspace';

/** References to the symbol under the cursor (file-local by default; can include workspace files). */
export function provideReferences(
  params: {
    textDocument: { uri: string };
    position: { line: number; character: number };
    context?: { includeDeclaration?: boolean };
  },
  documents: DocumentStore,
): Location[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  if (!isCodePosition(text, params.position)) return [];
  if (isMemberAccessAt(text, params.position)) return [];

  const range = wordRangeAt(text, params.position);
  if (!range) return [];

  const line = text.split('\n')[range.start.line] ?? '';
  const word = line.slice(range.start.character, range.end.character);
  if (!word) return [];

  const localDecls = scanSymbols(text).filter(sym => sym.name === word);
  if (localDecls.length === 0) return [];

  const includeDeclaration = params.context?.includeDeclaration ?? true;
  const locations: Location[] = [];

  // current file
  const declRanges = localDecls.map(sym => ({
    start: { line: sym.line, character: sym.char },
    end: { line: sym.line, character: sym.char + sym.name.length },
  }));
  for (const r of findWordOccurrences(text, word, { skipMemberAccess: true })) {
    if (includeDeclaration || !declRanges.some(d => rangeEquals(d, r))) {
      locations.push({ uri: params.textDocument.uri, range: r });
    }
  }

  // cross-file: if this looks like a top-level file symbol, search workspace
  const isTopLevel = localDecls.some(s => s.kind !== 'parameter' && s.container === undefined);
  if (isTopLevel) {
    try { refreshWorkspaceIndex(); } catch {}
    for (const file of allIndexedFiles()) {
      if (file.uri === params.textDocument.uri) continue;
      const otherDecls = file.symbols.filter(sym => sym.name === word && sym.kind !== 'parameter');
      const otherDeclRanges = otherDecls.map(sym => ({
        start: { line: sym.line, character: sym.char },
        end: { line: sym.line, character: sym.char + sym.name.length },
      }));
      for (const r of findWordOccurrences(file.text, word, { skipMemberAccess: true })) {
        if (includeDeclaration || !otherDeclRanges.some(d => rangeEquals(d, r))) {
          locations.push({ uri: file.uri, range: r });
        }
      }
    }
  }

  return locations;
}
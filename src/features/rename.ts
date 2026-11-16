import type { DocumentStore, WorkspaceEdit } from '../types';
import { ErrorCodes, LspError } from '../types';
import { BUILTINS, KEYWORDS, TYPES } from '../utils/gray-data';
import {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  wordRangeAt,
} from '../utils/occurrences';
import { resolveSymbolAt, scanSymbols } from '../utils/symbols';
import { allIndexedFiles, refreshWorkspaceIndex } from '../utils/workspace';

const RESERVED = new Set([...KEYWORDS, ...TYPES, ...BUILTINS]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function symbolAt(
  text: string,
  position: { line: number; character: number },
): { name: string; range: ReturnType<typeof wordRangeAt>; kind?: string; container?: string } | null {
  if (!isCodePosition(text, position)) return null;
  if (isMemberAccessAt(text, position)) return null;

  const range = wordRangeAt(text, position);
  if (!range) return null;

  const line = text.split('\n')[range.start.line] ?? '';
  const name = line.slice(range.start.character, range.end.character);
  if (!name) return null;

  const sym = resolveSymbolAt(name, scanSymbols(text), position);
  if (!sym) return null;
  return { name, range, kind: sym.kind, container: sym.container };
}

/** Validate that the cursor is on a symbol that can be renamed. */
export function prepareRename(
  params: { textDocument: { uri: string }; position: { line: number; character: number } },
  documents: DocumentStore,
): { range: NonNullable<ReturnType<typeof wordRangeAt>>; placeholder: string } | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const target = symbolAt(doc.getText(), params.position);
  if (!target || !target.range) return null;
  return { range: target.range, placeholder: target.name };
}

/** Rename symbol occurrences (file-local for locals/params, cross-file for top-level symbols). */
export function provideRename(
  params: {
    textDocument: { uri: string };
    position: { line: number; character: number };
    newName: string;
  },
  documents: DocumentStore,
): WorkspaceEdit | null {
  const newName = params.newName;
  if (!IDENTIFIER.test(newName) || RESERVED.has(newName)) {
    throw new LspError(
      ErrorCodes.InvalidParams,
      `'${newName}' is not a valid Grayscale identifier`,
    );
  }

  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const text = doc.getText();
  const target = symbolAt(text, params.position);
  if (!target || !target.range) return null;
  if (target.name === newName) return null;

  const localSyms = scanSymbols(text);
  if (localSyms.some(sym => sym.name === newName)) {
    // allow renaming to same symbol identity? but simpler: reject conflicts in file
    const conflict = resolveSymbolAt(newName, localSyms, params.position);
    if (conflict) {
      throw new LspError(
        ErrorCodes.InvalidParams,
        `'${newName}' is already declared in this file`,
      );
    }
  }

  const changes: { [uri: string]: { range: any; newText: string }[] } = {};
  const localEdits = findWordOccurrences(text, target.name, { skipMemberAccess: true })
    .map(range => ({ range, newText: newName }));
  if (localEdits.length > 0) changes[params.textDocument.uri] = localEdits;

  const isTopLevel = target.kind !== 'parameter' && target.container === undefined;
  if (isTopLevel) {
    try { refreshWorkspaceIndex(); } catch {}
    for (const file of allIndexedFiles()) {
      if (file.uri === params.textDocument.uri) continue;
      if (file.symbols.some(sym => sym.name === newName && sym.kind !== 'parameter')) {
        throw new LspError(ErrorCodes.InvalidParams, `'${newName}' is already declared in ${file.uri}`);
      }
      const edits = findWordOccurrences(file.text, target.name, { skipMemberAccess: true })
        .map(range => ({ range, newText: newName }));
      if (edits.length > 0) changes[file.uri] = edits;
    }
  }

  if (Object.keys(changes).length === 0) return null;
  return { changes };
}

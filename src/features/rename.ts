import type { DocumentStore, WorkspaceEdit } from '../types';
import { ErrorCodes, LspError } from '../types';
import { BUILTINS, KEYWORDS, TYPES } from '../utils/gray-data';
import {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  wordRangeAt,
} from '../utils/occurrences';
import { scanSymbols } from '../utils/symbols';

const RESERVED = new Set([...KEYWORDS, ...TYPES, ...BUILTINS]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function symbolAt(
  text: string,
  position: { line: number; character: number },
): { name: string; range: ReturnType<typeof wordRangeAt> } | null {
  if (!isCodePosition(text, position)) return null;
  if (isMemberAccessAt(text, position)) return null;

  const range = wordRangeAt(text, position);
  if (!range) return null;

  const line = text.split('\n')[range.start.line] ?? '';
  const name = line.slice(range.start.character, range.end.character);
  if (!name) return null;

  if (!scanSymbols(text).some(sym => sym.name === name)) return null;
  return { name, range };
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

/** File-local rename of every whole-word occurrence of the symbol. */
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

  if (scanSymbols(text).some(sym => sym.name === newName)) {
    throw new LspError(
      ErrorCodes.InvalidParams,
      `'${newName}' is already declared in this file`,
    );
  }

  const edits = findWordOccurrences(text, target.name, { skipMemberAccess: true })
    .map(range => ({ range, newText: newName }));

  if (edits.length === 0) return null;

  return {
    changes: {
      [params.textDocument.uri]: edits,
    },
  };
}

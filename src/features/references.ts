import {
  Location,
  ReferenceParams,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  rangeEquals,
  wordRangeAt,
} from '../utils/occurrences';
import { scanSymbols } from '../utils/symbols';

/** All in-file references to the symbol under the cursor. */
export function provideReferences(
  params: ReferenceParams,
  documents: TextDocuments<TextDocument>,
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

  const declarations = scanSymbols(text)
    .filter(sym => sym.name === word)
    .map(sym => ({
      start: { line: sym.line, character: sym.char },
      end: { line: sym.line, character: sym.char + sym.name.length },
    }));

  if (declarations.length === 0) return [];

  const includeDeclaration = params.context?.includeDeclaration ?? true;
  return findWordOccurrences(text, word, { skipMemberAccess: true })
    .filter(r => includeDeclaration || !declarations.some(d => rangeEquals(d, r)))
    .map(r => ({ uri: params.textDocument.uri, range: r }));
}

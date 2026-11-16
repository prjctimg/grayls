import type { DocumentStore, Location } from '../types';
import { wordAt, scanSymbols, findDeclaration } from '../utils/symbols';
import { allIndexedFiles, refreshWorkspaceIndex } from '../utils/workspace';

export function provideDefinition(
  params: { textDocument: { uri: string }; position: { line: number; character: number } },
  documents: DocumentStore,
): Location | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const text = doc.getText();
  const word = wordAt(text, params.position);
  if (!word) return null;

  const symbols = scanSymbols(text);
  const local = findDeclaration(word, symbols, params.textDocument.uri, params.position);
  if (local) return local;

  try { refreshWorkspaceIndex(); } catch { /* ignore */ }
  for (const file of allIndexedFiles()) {
    if (file.uri === params.textDocument.uri) continue;
    const sym = file.symbols.find(s => s.name === word && s.kind !== 'parameter');
    if (sym) {
      return {
        uri: file.uri,
        range: {
          start: { line: sym.line, character: sym.char },
          end: { line: sym.line, character: sym.char + sym.name.length },
        },
      };
    }
  }
  return null;
}

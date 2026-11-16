import type { DocumentStore, SymbolInformation } from '../types';
import { SymbolKind } from '../types';
import { allIndexedFiles, refreshWorkspaceIndex } from '../utils/workspace';

const KIND: Record<string, number> = {
  function: SymbolKind.Function,
  variable: SymbolKind.Variable,
  constant: SymbolKind.Constant,
  struct: SymbolKind.Struct,
  enum: SymbolKind.Enum,
  alias: SymbolKind.TypeParameter,
  parameter: SymbolKind.Variable,
};

export function provideWorkspaceSymbols(
  params: { query: string },
  _documents: DocumentStore,
): SymbolInformation[] {
  const q = (params.query ?? '').toLowerCase();
  try { refreshWorkspaceIndex(); } catch { /* ignore */ }
  const out: SymbolInformation[] = [];
  for (const file of allIndexedFiles()) {
    for (const sym of file.symbols) {
      if (sym.kind === 'parameter') continue;
      if (q && !sym.name.toLowerCase().includes(q)) continue;
      out.push({
        name: sym.name,
        kind: KIND[sym.kind] ?? SymbolKind.Variable,
        location: {
          uri: file.uri,
          range: {
            start: { line: sym.line, character: sym.char },
            end: { line: sym.line, character: sym.char + sym.name.length },
          },
        },
      });
    }
  }
  return out;
}
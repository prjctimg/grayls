import {
  DocumentSymbol,
  DocumentSymbolParams,
  Range,
  SymbolKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { maskNonCode } from '../utils/occurrences';
import { GraySymbol, scanSymbols } from '../utils/symbols';

const SYMBOL_KINDS: Record<GraySymbol['kind'], SymbolKind> = {
  variable: SymbolKind.Variable,
  constant: SymbolKind.Constant,
  function: SymbolKind.Function,
  struct: SymbolKind.Struct,
  enum: SymbolKind.Enum,
  alias: SymbolKind.TypeParameter,
};

function lastNonSpace(line: string): number {
  let i = line.length - 1;
  while (i >= 0 && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r')) i--;
  return i + 1;
}

/**
 * End line of a brace-delimited declaration. Function signatures can put the
 * opening brace on a later line, so scan forward until the matching close.
 * Strings/comments are masked first so braces inside them do not count.
 */
function blockEndLine(maskedLines: string[], startLine: number): number {
  let depth = 0;
  let opened = false;

  for (let line = startLine; line < maskedLines.length; line++) {
    for (const c of maskedLines[line]) {
      if (c === '{') {
        depth++;
        opened = true;
      } else if (c === '}') {
        depth--;
        if (opened && depth === 0) return line;
      }
    }
  }

  return startLine;
}

function declarationRange(
  lines: string[],
  maskedLines: string[],
  sym: GraySymbol,
): Range {
  const endLine = sym.kind === 'function' || sym.kind === 'struct' || sym.kind === 'enum'
    ? blockEndLine(maskedLines, sym.line)
    : sym.line;

  const startText = lines[sym.line] ?? '';
  let start = 0;
  while (start < startText.length && (startText[start] === ' ' || startText[start] === '\t')) start++;

  const endText = lines[endLine] ?? '';
  const end = lastNonSpace(endText);

  return {
    start: { line: sym.line, character: start },
    end: { line: endLine, character: end },
  };
}

/** Document symbols for all declarations in the current file. */
export function provideDocumentSymbols(
  params: DocumentSymbolParams,
  documents: TextDocuments<TextDocument>,
): DocumentSymbol[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const lines = text.split('\n');
  const maskedLines = maskNonCode(text).split('\n');

  return scanSymbols(text).map(sym => ({
    name: sym.name,
    kind: SYMBOL_KINDS[sym.kind],
    detail: sym.declaration,
    range: declarationRange(lines, maskedLines, sym),
    selectionRange: {
      start: { line: sym.line, character: sym.char },
      end: { line: sym.line, character: sym.char + sym.name.length },
    },
  }));
}

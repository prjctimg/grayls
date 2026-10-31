/**
 * Protocol-neutral shapes shared by the Node LSP server and the native
 * `scriptc` server. Keeping these local means the feature modules do not import
 * `vscode-languageserver` at runtime, so `scriptc` can compile them without
 * crossing a Node-island boundary.
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface TextDocumentLike {
  uri: string;
  getText(): string;
}

export interface DocumentStore {
  get(uri: string): TextDocumentLike | undefined;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface WorkspaceEdit {
  changes: { [uri: string]: TextEdit[] };
}

export interface Diagnostic {
  range: Range;
  severity: number;
  code?: string;
  message: string;
  source?: string;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  filterText?: string;
  insertText?: string;
  sortText?: string;
}

export interface MarkupContent {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export interface Hover {
  contents: MarkupContent;
}

export interface DocumentSymbol {
  name: string;
  kind: number;
  detail?: string;
  range: Range;
  selectionRange: Range;
}

/** LSP `CompletionItemKind` values used by this server. */
export const CompletionItemKind = {
  Function: 3,
  Field: 5,
  Variable: 6,
  Constant: 21,
  Struct: 22,
  Enum: 13,
  Keyword: 14,
  Module: 9,
  Property: 10,
  EnumMember: 20,
  TypeParameter: 25,
};

/** LSP `SymbolKind` values used by this server. */
export const SymbolKind = {
  Function: 12,
  Variable: 13,
  Constant: 14,
  Enum: 10,
  Struct: 23,
  TypeParameter: 26,
};

/** LSP `DiagnosticSeverity` values used by this server. */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
};

/** Subset of LSP error codes used by this server. */
export const ErrorCodes = {
  InvalidParams: -32602,
  InternalError: -32603,
  MethodNotFound: -32601,
};

export class LspError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'LspError';
    this.code = code;
  }
}

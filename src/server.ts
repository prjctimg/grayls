import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionParams,
  HoverParams,
  DefinitionParams,
  DocumentSymbolParams,
  ReferenceParams,
  PrepareRenameParams,
  RenameParams,
  DocumentFormattingParams,
  SignatureHelpParams,
  InlayHintParams,
  SemanticTokensParams,
  CodeActionParams,
  WorkspaceSymbolParams,
  DocumentHighlightParams,
  FoldingRangeParams,
  SelectionRangeParams,
  ResponseError,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LspError } from './types';

import { registerDiagnostics } from './features/diagnosticsServer';
import { provideCompletion } from './features/completion';
import { provideHover } from './features/hover';
import { provideDefinition } from './features/definition';
import { provideDocumentSymbols } from './features/documentSymbols';
import { provideReferences } from './features/references';
import { prepareRename, provideRename } from './features/rename';
import { provideFormatting } from './features/formatting';
import { provideSignatureHelp } from './features/signatureHelp';
import { provideInlayHints } from './features/inlayHints';
import { provideSemanticTokens, SEMANTIC_TOKENS_LEGEND } from './features/semanticTokens';
import { provideCodeActions } from './features/codeActions';
import { provideWorkspaceSymbols } from './features/workspaceSymbols';
import { provideDocumentHighlights } from './features/documentHighlight';
import { provideFoldingRanges } from './features/foldingRange';
import { provideSelectionRanges } from './features/selectionRange';
import { refreshWorkspaceIndex, setWorkspaceRoots, upsertIndexedDocument } from './utils/workspace';

// Create connection using stdio (works for VS Code IPC and Zed LSP)
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Feature modules throw protocol-neutral LspError; the Node connection expects
// vscode-languageserver's ResponseError to preserve the JSON-RPC error code.
function withResponseError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LspError) {
      throw new ResponseError(err.code, err.message);
    }
    throw err;
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LspError) {
      throw new ResponseError(err.code, err.message);
    }
    return fallback;
  }
}

function syncWorkspaceIndex(): void {
  const open = new Map<string, string>();
  for (const d of documents.all()) open.set(d.uri, d.getText());
  try { refreshWorkspaceIndex(open); } catch { /* ignore */ }
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const roots: string[] = [];
  if (params.rootUri) roots.push(params.rootUri);
  if (params.rootPath) roots.push(params.rootPath);
  if (Array.isArray(params.workspaceFolders)) {
    for (const f of params.workspaceFolders) if (f?.uri) roots.push(f.uri);
  }
  setWorkspaceRoots(roots);
  syncWorkspaceIndex();

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['.', '@'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      documentSymbolProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentFormattingProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      inlayHintProvider: true,
      semanticTokensProvider: { legend: SEMANTIC_TOKENS_LEGEND as any, full: true },
      codeActionProvider: true,
      workspaceSymbolProvider: true,
      documentHighlightProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
    },
    serverInfo: {
      name: 'GrayLS',
      version: '0.1.0',
    },
  };
});

// Register diagnostics (runs gray check on open/save/change)
registerDiagnostics(connection, documents);

documents.onDidOpen(e => { try { upsertIndexedDocument(e.document.uri, e.document.getText()); } catch {} });
documents.onDidChangeContent(e => { try { upsertIndexedDocument(e.document.uri, e.document.getText()); } catch {} });
documents.onDidSave(e => { try { upsertIndexedDocument(e.document.uri, e.document.getText()); syncWorkspaceIndex(); } catch {} });

// Completion
connection.onCompletion((params: CompletionParams) =>
  safe(() => provideCompletion(params, documents) as never, [] as never),
);

// Hover
connection.onHover((params: HoverParams) =>
  safe(() => provideHover(params, documents) as never, null as never),
);

// Go to definition
connection.onDefinition((params: DefinitionParams) =>
  safe(() => provideDefinition(params, documents), null),
);

// Document symbols
connection.onDocumentSymbol((params: DocumentSymbolParams) =>
  safe(() => provideDocumentSymbols(params, documents) as never, [] as never),
);

// References
connection.onReferences((params: ReferenceParams) =>
  safe(() => provideReferences(params, documents), []),
);

// Rename
connection.onPrepareRename((params: PrepareRenameParams) =>
  safe(() => prepareRename(params, documents), null),
);

connection.onRenameRequest((params: RenameParams) =>
  withResponseError(() => provideRename(params, documents)),
);

// Formatting
connection.onDocumentFormatting((params: DocumentFormattingParams) =>
  withResponseError(() => provideFormatting(params, documents)),
);

// Signature help
connection.onSignatureHelp((params: SignatureHelpParams) =>
  safe(() => provideSignatureHelp(params as any, documents) as never, null as never),
);

// Inlay hints
connection.languages.inlayHint.on((params: InlayHintParams) =>
  safe(() => provideInlayHints(params as any, documents) as never, [] as never),
);

// Semantic tokens
connection.languages.semanticTokens.on((params: SemanticTokensParams) =>
  safe(() => provideSemanticTokens(params as any, documents) as never, { data: [] } as never),
);

// Code actions
connection.onCodeAction((params: CodeActionParams) =>
  safe(() => provideCodeActions(params as any, documents) as never, [] as never),
);

// Workspace symbols
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams) =>
  safe(() => provideWorkspaceSymbols(params as any, documents) as never, [] as never),
);

connection.onDocumentHighlight((params: DocumentHighlightParams) =>
  safe(() => provideDocumentHighlights(params as any, documents) as never, [] as never),
);

connection.onFoldingRanges((params: FoldingRangeParams) =>
  safe(() => provideFoldingRanges(params as any, documents) as never, [] as never),
);

connection.onSelectionRanges((params: SelectionRangeParams) =>
  safe(() => provideSelectionRanges(params as any, documents) as never, [] as never),
);

connection.onDidChangeWatchedFiles(() => syncWorkspaceIndex());

// Attach document manager and start listening
documents.listen(connection);
connection.listen();
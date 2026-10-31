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
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { registerDiagnostics } from './features/diagnostics';
import { provideCompletion } from './features/completion';
import { provideHover } from './features/hover';
import { provideDefinition } from './features/definition';
import { provideDocumentSymbols } from './features/documentSymbols';
import { provideReferences } from './features/references';
import { prepareRename, provideRename } from './features/rename';
import { provideFormatting } from './features/formatting';

// Create connection using stdio (works for VS Code IPC and Zed LSP)
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
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
    },
    serverInfo: {
      name: 'GrayLS',
      version: '0.1.0',
    },
  };
});

// Register diagnostics (runs gray check on open/save/change)
registerDiagnostics(connection, documents);

// Completion
connection.onCompletion((params: CompletionParams) =>
  provideCompletion(params, documents),
);

// Hover
connection.onHover((params: HoverParams) =>
  provideHover(params, documents),
);

// Go to definition
connection.onDefinition((params: DefinitionParams) =>
  provideDefinition(params, documents),
);

// Document symbols
connection.onDocumentSymbol((params: DocumentSymbolParams) =>
  provideDocumentSymbols(params, documents),
);

// References
connection.onReferences((params: ReferenceParams) =>
  provideReferences(params, documents),
);

// Rename
connection.onPrepareRename((params: PrepareRenameParams) =>
  prepareRename(params, documents),
);

connection.onRenameRequest((params: RenameParams) =>
  provideRename(params, documents),
);

// Formatting
connection.onDocumentFormatting((params: DocumentFormattingParams) =>
  provideFormatting(params, documents),
);

// Attach document manager and start listening
documents.listen(connection);
connection.listen();

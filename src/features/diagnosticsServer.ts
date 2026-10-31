import {
  Connection,
  TextDocumentChangeEvent,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { computeDiagnostics } from './diagnostics';

// Debounce timer per document URI
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function registerDiagnostics(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
): void {
  function validate(doc: TextDocument): void {
    const uri = doc.uri;
    const existing = timers.get(uri);
    if (existing) clearTimeout(existing);

    timers.set(
      uri,
      setTimeout(() => {
        timers.delete(uri);
        connection.sendDiagnostics({
          uri,
          // Feature modules use plain numeric severities; both values match LSP.
          diagnostics: computeDiagnostics(doc.getText()) as never,
        });
      }, 300),
    );
  }

  documents.onDidOpen((e: TextDocumentChangeEvent<TextDocument>) => validate(e.document));
  documents.onDidSave((e: TextDocumentChangeEvent<TextDocument>) => validate(e.document));
  documents.onDidChangeContent((e: TextDocumentChangeEvent<TextDocument>) => validate(e.document));

  documents.onDidClose((e: TextDocumentChangeEvent<TextDocument>) => {
    const t = timers.get(e.document.uri);
    if (t) { clearTimeout(t); timers.delete(e.document.uri); }
    // Clear diagnostics when file is closed
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });
}

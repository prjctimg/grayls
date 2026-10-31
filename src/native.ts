/**
 * Native GrayLS entry point.
 *
 * `scriptc` cannot yet compile `vscode-languageserver` because the connection
 * object crosses a Node-island boundary. This entry implements the small slice
 * of JSON-RPC/LSP that GrayLS needs directly over stdio (fd 0/1) and calls the
 * same protocol-neutral feature modules as the Node server.
 */

import * as fs from 'fs';
import type { DocumentStore, TextDocumentLike } from './types';
import { ErrorCodes, LspError } from './types';
import { provideCompletion } from './features/completion';
import { computeDiagnostics } from './features/diagnostics';
import { provideDefinition } from './features/definition';
import { provideDocumentSymbols } from './features/documentSymbols';
import { provideFormatting } from './features/formatting';
import { provideHover } from './features/hover';
import { provideReferences } from './features/references';
import { prepareRename, provideRename } from './features/rename';

interface NativeDocument {
  uri: string;
  version: number;
  text: string;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: any;
}

const documents = new Map<string, NativeDocument>();
let input = Buffer.alloc(0);

const store: DocumentStore = {
  get(uri: string): TextDocumentLike | undefined {
    const doc = documents.get(uri);
    if (!doc) return undefined;
    return {
      uri: doc.uri,
      getText: () => doc.text,
    };
  },
};

function send(payload: unknown): void {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  fs.writeSync(1, header + body);
}

function readMessage(): string | null {
  for (;;) {
    const headerEnd = input.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = input.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        throw new Error('Malformed LSP header');
      }

      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (input.length >= bodyStart + length) {
        const body = input.subarray(bodyStart, bodyStart + length).toString('utf8');
        input = input.subarray(bodyStart + length);
        return body;
      }
    }

    const chunk = Buffer.alloc(65536);
    const n = fs.readSync(0, chunk, 0, chunk.length, null);
    if (n === 0) return null;
    const next = chunk.subarray(0, n);
    input = input.length === 0 ? next : Buffer.concat([input, next]);
  }
}

function publishDiagnostics(uri: string): void {
  const doc = documents.get(uri);
  if (!doc) return;
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, diagnostics: computeDiagnostics(doc.text) },
  });
}

function initialize(): unknown {
  return {
    capabilities: {
      // Full sync keeps the native wire protocol small; Neovim respects it.
      textDocumentSync: 1,
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
      version: '0.1.0-native',
    },
  };
}

function dispatch(method: string, params: any): unknown {
  switch (method) {
    case 'initialize':
      return initialize();
    case 'shutdown':
      return null;
    case 'textDocument/completion':
      return provideCompletion(params, store);
    case 'textDocument/hover':
      return provideHover(params, store);
    case 'textDocument/definition':
      return provideDefinition(params, store);
    case 'textDocument/documentSymbol':
      return provideDocumentSymbols(params, store);
    case 'textDocument/references':
      return provideReferences(params, store);
    case 'textDocument/prepareRename':
      return prepareRename(params, store);
    case 'textDocument/rename':
      return provideRename(params, store);
    case 'textDocument/formatting':
      return provideFormatting(params, store);
    default:
      throw new LspError(ErrorCodes.MethodNotFound, `Unsupported method: ${method}`);
  }
}

function handleNotification(method: string, params: any): void {
  switch (method) {
    case 'initialized':
      return;
    case 'textDocument/didOpen': {
      const doc = params.textDocument;
      documents.set(doc.uri, { uri: doc.uri, version: doc.version, text: doc.text });
      publishDiagnostics(doc.uri);
      return;
    }
    case 'textDocument/didChange': {
      const uri = params.textDocument.uri;
      const doc = documents.get(uri);
      if (!doc) return;
      const changes = params.contentChanges;
      if (changes.length === 0) return;
      // Full sync: the last change contains the whole document.
      doc.text = changes[changes.length - 1].text;
      doc.version = params.textDocument.version;
      publishDiagnostics(uri);
      return;
    }
    case 'textDocument/didSave': {
      const uri = params.textDocument.uri;
      if (params.text !== undefined) {
        const doc = documents.get(uri);
        if (doc) doc.text = params.text;
      }
      publishDiagnostics(uri);
      return;
    }
    case 'textDocument/didClose': {
      const uri = params.textDocument.uri;
      documents.delete(uri);
      send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [] },
      });
      return;
    }
    case 'exit':
      process.exit(0);
      return;
    default:
      // Ignore notifications we do not implement.
      return;
  }
}

function handle(message: RpcMessage): void {
  const method = message.method;
  if (typeof method !== 'string') return;

  if (message.id === undefined) {
    handleNotification(method, message.params);
    return;
  }

  try {
    const result = dispatch(method, message.params);
    send({ jsonrpc: '2.0', id: message.id, result: result === undefined ? null : result });
  } catch (err) {
    const code = err instanceof LspError ? err.code : ErrorCodes.InternalError;
    const text = err instanceof Error ? err.message : String(err);
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code, message: text },
    });
  }
}

function main(): void {
  for (;;) {
    const raw = readMessage();
    if (raw === null) break;
    let message: RpcMessage;
    try {
      message = JSON.parse(raw) as RpcMessage;
    } catch {
      continue;
    }
    handle(message);
  }
}

main();

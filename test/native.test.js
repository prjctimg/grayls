const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const NATIVE = path.join(__dirname, '..', 'out', 'native.js');
const URI = 'file:///test/native.gray';

function frame(message) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function decode(output) {
  const messages = [];
  let rest = Buffer.from(output, 'utf8');
  while (rest.length > 0) {
    const split = rest.indexOf('\r\n\r\n');
    if (split === -1) break;
    const header = rest.subarray(0, split).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    assert.ok(match, `missing Content-Length in ${header}`);
    const length = Number(match[1]);
    const start = split + 4;
    messages.push(JSON.parse(rest.subarray(start, start + length).toString('utf8')));
    rest = rest.subarray(start + length);
  }
  return messages;
}

test('native server speaks framing, sync, and LSP features', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    return a + b',
    '}',
    '',
    'do main() {',
    '    mut total i64 = add(1, 2)',
    '    println(total)',
    '}',
  ].join('\n');

  const input = [
    frame({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { capabilities: {}, rootUri: 'file:///tmp', workspaceFolders: [{ uri: 'file:///tmp', name: 'tmp' }] },
    }),
    frame({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: { uri: URI, languageId: 'gray', version: 1, text },
      },
    }),
    frame({
      jsonrpc: '2.0',
      id: 2,
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri: URI } },
    }),
    frame({
      jsonrpc: '2.0',
      id: 3,
      method: 'textDocument/hover',
      params: { textDocument: { uri: URI }, position: { line: 5, character: 8 } }, // total
    }),
    frame({
      jsonrpc: '2.0',
      id: 4,
      method: 'textDocument/signatureHelp',
      params: { textDocument: { uri: URI }, position: { line: 5, character: 23 } }, // inside add(1, 2)
    }),
    frame({
      jsonrpc: '2.0',
      id: 5,
      method: 'textDocument/inlayHint',
      params: { textDocument: { uri: URI }, range: { start: { line: 0, character: 0 }, end: { line: 8, character: 0 } } },
    }),
    frame({
      jsonrpc: '2.0',
      id: 6,
      method: 'textDocument/semanticTokens/full',
      params: { textDocument: { uri: URI } },
    }),
    frame({
      jsonrpc: '2.0',
      id: 7,
      method: 'textDocument/codeAction',
      params: { textDocument: { uri: URI }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, context: { diagnostics: [] } },
    }),
    frame({
      jsonrpc: '2.0',
      id: 8,
      method: 'workspace/symbol',
      params: { query: 'add' },
    }),
    frame({ jsonrpc: '2.0', id: 9, method: 'shutdown', params: null }),
    frame({ jsonrpc: '2.0', method: 'exit' }),
  ].join('');

  const result = spawnSync(process.execPath, [NATIVE], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
  });

  assert.equal(result.status, 0, result.stderr);
  const messages = decode(result.stdout);
  const init = messages.find(m => m.id === 1);
  const caps = init.result.capabilities;
  assert.equal(caps.documentFormattingProvider, true);
  assert.equal(caps.renameProvider.prepareProvider, true);
  assert.equal(caps.textDocumentSync, 1);
  assert.equal(caps.hoverProvider, true);
  assert.equal(caps.definitionProvider, true);
  assert.equal(caps.signatureHelpProvider && Array.isArray(caps.signatureHelpProvider.triggerCharacters), true);
  assert.equal(caps.inlayHintProvider, true);
  assert.ok(caps.semanticTokensProvider && caps.semanticTokensProvider.legend);
  assert.equal(caps.codeActionProvider, true);
  assert.equal(caps.workspaceSymbolProvider, true);

  const symbols = messages.find(m => m.id === 2).result;
  assert.deepEqual(symbols.map(s => s.name), ['add', 'main', 'total']);

  const hover = messages.find(m => m.id === 3).result;
  assert.ok(hover && hover.contents && /Variable|Parameter|Constant/.test(hover.contents.value));

  const sig = messages.find(m => m.id === 4).result;
  assert.ok(sig === null || (sig.signatures && sig.signatures.length >= 1));

  const hints = messages.find(m => m.id === 5).result;
  assert.ok(Array.isArray(hints));

  const sem = messages.find(m => m.id === 6).result;
  assert.ok(sem && Array.isArray(sem.data));

  const actions = messages.find(m => m.id === 7).result;
  assert.ok(Array.isArray(actions));

  const ws = messages.find(m => m.id === 8).result;
  assert.ok(Array.isArray(ws));
});

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

test('native server speaks framing, sync, and document symbols', () => {
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
      params: { capabilities: {} },
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
    frame({ jsonrpc: '2.0', id: 3, method: 'shutdown', params: null }),
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
  assert.equal(init.result.capabilities.documentFormattingProvider, true);
  assert.equal(init.result.capabilities.renameProvider.prepareProvider, true);
  assert.equal(init.result.capabilities.textDocumentSync, 1);

  const symbols = messages.find(m => m.id === 2).result;
  assert.deepEqual(symbols.map(s => s.name), ['add', 'main', 'total']);
  assert.equal(symbols[0].range.end.line, 2);
  assert.equal(symbols[2].kind, 13);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { provideDocumentSymbols } = require('../out/features/documentSymbols');
const { provideReferences } = require('../out/features/references');
const { prepareRename, provideRename } = require('../out/features/rename');

const URI = 'file:///test/features.gray';

function fakeDocuments(text) {
  return {
    get(uri) {
      return uri === URI ? { getText: () => text } : undefined;
    },
  };
}

function request(text, method, position) {
  return {
    textDocument: { uri: URI },
    position,
    context: { includeDeclaration: true },
    ...method,
  };
}

const SYMBOL_TEXT = [
  'const Origin i64 = 0',
  '',
  'const Point struct {',
  '    x i64',
  '    y i64',
  '}',
  '',
  'const Shape enum {',
  '    Circle(f64)',
  '    Square(f64)',
  '}',
  '',
  'alias Number = i64',
  '',
  'do add(a i64, b i64) -> i64 {',
  '    return a + b',
  '}',
  '',
  'do main() {',
  '    mut count i64 = Origin',
  '    mut total i64 = add(count, 2)',
  '    println(total)',
  '}',
].join('\n');

test('document symbols include declarations and full block ranges', () => {
  const symbols = provideDocumentSymbols(
    { textDocument: { uri: URI } },
    fakeDocuments(SYMBOL_TEXT),
  );

  assert.deepEqual(
    symbols.map(s => s.name),
    ['Origin', 'Point', 'Shape', 'Number', 'add', 'main', 'count', 'total'],
  );
  assert.deepEqual(
    symbols.map(s => s.range.end.line),
    [0, 5, 10, 12, 16, 22, 19, 20],
  );
  assert.deepEqual(symbols.find(s => s.name === 'add').selectionRange, {
    start: { line: 14, character: 3 },
    end: { line: 14, character: 6 },
  });
});

const REFERENCE_TEXT = [
  'const X i64 = 1',
  '',
  'do main() {',
  '    mut count i64 = X',
  '    // count in a comment',
  '    println("count")',
  '    count = count + 1',
  '    math.count()',
  '}',
].join('\n');

test('references include declarations and skip comments, strings, and members', () => {
  const documents = fakeDocuments(REFERENCE_TEXT);
  const refs = provideReferences(
    request(REFERENCE_TEXT, {}, { line: 3, character: 8 }),
    documents,
  );

  assert.deepEqual(
    refs.map(r => [r.range.start.line, r.range.start.character]),
    [[3, 8], [6, 4], [6, 12]],
  );

  const withoutDecl = provideReferences(
    {
      textDocument: { uri: URI },
      position: { line: 3, character: 8 },
      context: { includeDeclaration: false },
    },
    documents,
  );
  assert.deepEqual(
    withoutDecl.map(r => [r.range.start.line, r.range.start.character]),
    [[6, 4], [6, 12]],
  );
});

test('references return nothing on member accesses, comments, and builtins', () => {
  const documents = fakeDocuments(REFERENCE_TEXT);

  assert.deepEqual(
    provideReferences(request(REFERENCE_TEXT, {}, { line: 7, character: 7 }), documents),
    [],
  );
  assert.deepEqual(
    provideReferences(request(REFERENCE_TEXT, {}, { line: 4, character: 7 }), documents),
    [],
  );
  assert.deepEqual(
    provideReferences(request(REFERENCE_TEXT, {}, { line: 5, character: 5 }), documents),
    [],
  );
});

test('prepareRename accepts declared symbols and rejects other positions', () => {
  const documents = fakeDocuments(REFERENCE_TEXT);

  assert.deepEqual(prepareRename(request(REFERENCE_TEXT, {}, { line: 3, character: 8 }), documents), {
    range: {
      start: { line: 3, character: 8 },
      end: { line: 3, character: 13 },
    },
    placeholder: 'count',
  });

  assert.equal(prepareRename(request(REFERENCE_TEXT, {}, { line: 7, character: 7 }), documents), null);
  assert.equal(prepareRename(request(REFERENCE_TEXT, {}, { line: 4, character: 7 }), documents), null);
  assert.equal(prepareRename(request(REFERENCE_TEXT, {}, { line: 5, character: 5 }), documents), null);
});

test('rename edits every code occurrence and skips comments, strings, and members', () => {
  const documents = fakeDocuments(REFERENCE_TEXT);
  const edit = provideRename(
    {
      textDocument: { uri: URI },
      position: { line: 3, character: 8 },
      newName: 'amount',
    },
    documents,
  );

  const edits = edit.changes[URI];
  assert.deepEqual(
    edits.map(e => [e.range.start.line, e.range.start.character, e.newText]),
    [[3, 8, 'amount'], [6, 4, 'amount'], [6, 12, 'amount']],
  );
});

test('rename rejects invalid, reserved, and already-declared names', () => {
  const documents = fakeDocuments(REFERENCE_TEXT);
  const rename = newName => provideRename(
    {
      textDocument: { uri: URI },
      position: { line: 3, character: 8 },
      newName,
    },
    documents,
  );

  assert.throws(() => rename('not valid'));
  assert.throws(() => rename('mut'));
  assert.throws(() => rename('X'));
});

const { provideHover } = require('../out/features/hover');
const { provideDefinition } = require('../out/features/definition');
const { provideSignatureHelp } = require('../out/features/signatureHelp');
const { provideInlayHints } = require('../out/features/inlayHints');
const { provideSemanticTokens, SEMANTIC_TOKENS_LEGEND } = require('../out/features/semanticTokens');
const { provideCodeActions } = require('../out/features/codeActions');
const { provideWorkspaceSymbols } = require('../out/features/workspaceSymbols');
const { setWorkspaceRoots, refreshWorkspaceIndex } = require('../out/utils/workspace');

test('hover resolves variables and parameters', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    mut total i64 = a + b',
    '    return total',
    '}',
  ].join('\n');
  const documents = fakeDocuments(text);
  const paramHover = provideHover({ textDocument: { uri: URI }, position: { line: 1, character: 20 } }, documents);
  assert.ok(paramHover);
  assert.match(paramHover.contents.value, /Parameter/);
  assert.match(paramHover.contents.value, /`a`/);
  const varHover = provideHover({ textDocument: { uri: URI }, position: { line: 2, character: 12 } }, documents);
  assert.ok(varHover);
  assert.match(varHover.contents.value, /Variable/);
  assert.match(varHover.contents.value, /`total`/);
});

test('definition resolves parameters', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    return a + b',
    '}',
  ].join('\n');
  const documents = fakeDocuments(text);
  const loc = provideDefinition({ textDocument: { uri: URI }, position: { line: 1, character: 11 } }, documents);
  assert.ok(loc);
  assert.equal(loc.range.start.line, 0);
});

test('signature help returns user function signatures', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    return a + b',
    '}',
    'do main() {',
    '    add(1, 2)',
    '}',
  ].join('\n');
  const documents = fakeDocuments(text);
  const help = provideSignatureHelp({ textDocument: { uri: URI }, position: { line: 4, character: 10 } }, documents);
  assert.ok(help);
  assert.equal(help.signatures.length, 1);
  assert.match(help.signatures[0].label, /add/);
  assert.ok(help.signatures[0].parameters.length >= 2);
});

test('inlay hints provide parameter names for calls', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    return a + b',
    '}',
    'do main() {',
    '    add(1, 2)',
    '}',
  ].join('\n');
  const documents = fakeDocuments(text);
  const hints = provideInlayHints({ textDocument: { uri: URI }, range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } }, documents);
  assert.ok(hints.length >= 2);
  assert.ok(hints.some(h => String(h.label).includes('a')));
});

test('semantic tokens return legend-compatible data', () => {
  const text = [
    'do add(a i64, b i64) -> i64 {',
    '    mut total i64 = a + b',
    '    return total',
    '}',
  ].join('\n');
  const documents = fakeDocuments(text);
  const tokens = provideSemanticTokens({ textDocument: { uri: URI } }, documents);
  assert.ok(SEMANTIC_TOKENS_LEGEND.tokenTypes.length > 0);
  assert.ok(Array.isArray(tokens.data));
  assert.equal(tokens.data.length % 5, 0);
  assert.ok(tokens.data.length > 0);
});

test('code actions and workspace symbols are callable', () => {
  const text = 'do main() { mut x i64 = 1 }';
  const documents = fakeDocuments(text);
  const actions = provideCodeActions({ textDocument: { uri: URI }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } }, context: { diagnostics: [] } }, documents);
  assert.ok(Array.isArray(actions));
  setWorkspaceRoots([]);
  refreshWorkspaceIndex();
  const ws = provideWorkspaceSymbols({ query: '' }, documents);
  assert.ok(Array.isArray(ws));
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findWordOccurrences,
  isCodePosition,
  isMemberAccessAt,
  maskNonCode,
  wordRangeAt,
} = require('../out/utils/occurrences');

test('maskNonCode preserves offsets while hiding comments and literals', () => {
  const text = [
    'const X i64 = 1 // X in a comment',
    'const S string = "X in a string"',
    'const R string = `X in a raw',
    'string`',
    '/* X in a block comment */',
  ].join('\n');

  const masked = maskNonCode(text);
  assert.equal(masked.length, text.length);
  assert.equal(masked.split('\n').length, text.split('\n').length);
  assert.equal((masked.match(/X/g) || []).length, 1);
  assert.equal(masked.split('\n')[1].includes('X'), false);
  assert.equal(masked.split('\n')[2].includes('X'), false);
  assert.equal(masked.split('\n')[4].includes('X'), false);
});

test('wordRangeAt handles identifiers and end-of-line positions', () => {
  const text = 'mut count i64 = 1';
  assert.deepEqual(wordRangeAt(text, { line: 0, character: 8 }), {
    start: { line: 0, character: 4 },
    end: { line: 0, character: 9 },
  });
  assert.deepEqual(wordRangeAt(text, { line: 0, character: 9 }), {
    start: { line: 0, character: 4 },
    end: { line: 0, character: 9 },
  });
  assert.deepEqual(wordRangeAt(text, { line: 0, character: 3 }), {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 3 },
  });
  assert.equal(wordRangeAt('()', { line: 0, character: 0 }), null);
});

test('isCodePosition and isMemberAccessAt distinguish comments and members', () => {
  const text = 'mut count i64 = 1 // count\nmath.count()\n';
  assert.equal(isCodePosition(text, { line: 0, character: 4 }), true);
  assert.equal(isCodePosition(text, { line: 0, character: 23 }), false);
  assert.equal(isMemberAccessAt(text, { line: 1, character: 7 }), true);
  assert.equal(isMemberAccessAt(text, { line: 0, character: 4 }), false);
});

test('findWordOccurrences ignores comments, strings, and member accesses', () => {
  const text = [
    'mut count i64 = 1',
    '// count in a comment',
    'println("count")',
    'count = count + 1',
    'math.count()',
  ].join('\n');

  const ranges = findWordOccurrences(text, 'count', { skipMemberAccess: true });
  assert.deepEqual(
    ranges.map(r => [r.start.line, r.start.character]),
    [[0, 4], [3, 0], [3, 8]],
  );
});

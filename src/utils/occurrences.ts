import type { Position, Range } from '../types';

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_]/.test(c);
}

/**
 * Blank out comments, string/character literals, and raw strings while keeping
 * every offset and newline intact. This lets identifier scans use the original
 * line/column positions without matching text inside comments or strings.
 */
export function maskNonCode(text: string): string {
  const out = text.split('');
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
    } else if (c === '/' && text[i + 1] === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < text.length) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      const quote = c;
      out[i] = ' ';
      i++;
      while (i < text.length && text[i] !== quote && text[i] !== '\n') {
        if (text[i] === '\\') {
          out[i] = ' ';
          i++;
          if (i < text.length) {
            out[i] = ' ';
            i++;
          }
        } else {
          out[i] = ' ';
          i++;
        }
      }
      if (i < text.length && text[i] === quote) {
        out[i] = ' ';
        i++;
      }
    } else if (c === '`') {
      out[i] = ' ';
      i++;
      while (i < text.length && text[i] !== '`') {
        if (text[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < text.length) {
        out[i] = ' ';
        i++;
      }
    } else {
      i++;
    }
  }

  return out.join('');
}

/**
 * True when the position points at real source text rather than a comment or
 * string literal. `maskNonCode` preserves every offset, so comparing the
 * original and masked character is enough.
 */
export function isCodePosition(text: string, position: Position): boolean {
  const lines = text.split('\n');
  const line = lines[position.line];
  if (line === undefined || line.length === 0 || position.character < 0) {
    return false;
  }

  // Clients can report a cursor at the end of a line (one past the last
  // character); treat that as the character before it.
  const index = Math.min(position.character, line.length - 1);
  const maskedLine = maskNonCode(text).split('\n')[position.line];
  return maskedLine !== undefined && maskedLine[index] === line[index];
}

/** Range of the identifier at `position`, or null when the position is not on one. */
export function wordRangeAt(text: string, position: Position): Range | null {
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return null;

  const ch = Math.min(position.character, line.length);
  let start = ch;
  let end = ch;
  while (start > 0 && isWordChar(line[start - 1])) start--;
  while (end < line.length && isWordChar(line[end])) end++;
  if (start === end) return null;

  return {
    start: { line: position.line, character: start },
    end: { line: position.line, character: end },
  };
}

function previousNonSpace(text: string, index: number): string | undefined {
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] !== ' ' && text[i] !== '\t') return text[i];
  }
  return undefined;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAtOffset(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** True when the identifier at `position` is the member part of `value.name`. */
export function isMemberAccessAt(text: string, position: Position): boolean {
  const range = wordRangeAt(text, position);
  if (!range) return false;

  const line = text.split('\n')[range.start.line] ?? '';
  let i = range.start.character - 1;
  while (i >= 0 && (line[i] === ' ' || line[i] === '\t')) i--;
  return i >= 0 && line[i] === '.';
}

export interface OccurrenceOptions {
  /**
   * Skip identifiers immediately after a dot (`obj.name`). A file symbol and a
   * struct field/module function can share a name, and renaming the local symbol
   * should not touch member accesses.
   */
  skipMemberAccess?: boolean;
}

/**
 * All whole-word occurrences of `word` in code, in document order.
 * Comments, strings, and raw strings are ignored.
 */
export function findWordOccurrences(
  text: string,
  word: string,
  options: OccurrenceOptions = {},
): Range[] {
  if (!word) return [];

  const masked = maskNonCode(text);
  const starts = lineStarts(masked);
  const ranges: Range[] = [];
  let from = 0;

  while (from <= masked.length) {
    const index = masked.indexOf(word, from);
    if (index === -1) break;
    from = index + word.length;

    if (isWordChar(masked[index - 1]) || isWordChar(masked[index + word.length])) continue;
    if (options.skipMemberAccess && previousNonSpace(masked, index) === '.') continue;

    const line = lineAtOffset(starts, index);
    const character = index - starts[line];
    ranges.push({
      start: { line, character },
      end: { line, character: character + word.length },
    });
  }

  return ranges;
}

export function rangeEquals(a: Range, b: Range): boolean {
  return (
    a.start.line === b.start.line &&
    a.start.character === b.start.character &&
    a.end.line === b.end.line &&
    a.end.character === b.end.character
  );
}

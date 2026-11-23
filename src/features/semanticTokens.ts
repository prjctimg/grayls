import type { DocumentStore, SemanticTokens, SemanticTokensLegend } from '../types';
import { scanSymbols } from '../utils/symbols';
import { maskNonCode } from '../utils/occurrences';
import { KEYWORDS, TYPES, BUILTINS, ATTRIBUTES } from '../utils/gray-data';

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
  tokenTypes: ['namespace', 'type', 'enum', 'struct', 'parameter', 'variable', 'property', 'enumMember', 'function', 'macro', 'keyword', 'comment', 'string', 'number', 'operator'],
  tokenModifiers: ['declaration', 'readonly', 'defaultLibrary'],
};

const TT = Object.fromEntries(SEMANTIC_TOKENS_LEGEND.tokenTypes.map((t, i) => [t, i])) as Record<string, number>;
const TM = Object.fromEntries(SEMANTIC_TOKENS_LEGEND.tokenModifiers.map((t, i) => [t, 1 << i])) as Record<string, number>;

interface RawToken { line: number; start: number; length: number; type: number; modifiers: number }

function push(tokens: RawToken[], line: number, start: number, length: number, type: number, modifiers = 0) {
  if (length <= 0 || start < 0) return;
  tokens.push({ line, start, length, type, modifiers });
}

const KW = new Set([...KEYWORDS, ...TYPES]);
const BUILTIN = new Set(BUILTINS);

function emitLexical(tokens: RawToken[], text: string) {
  const lines = text.split('\n');
  let inBlock = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) { push(tokens, li, i, line.length - i, TT.comment); break; }
        push(tokens, li, i, end + 2 - i, TT.comment); i = end + 2; inBlock = false; continue;
      }
      const c = line[i];
      const n = line[i + 1];
      if (c === '/' && n === '/') { push(tokens, li, i, line.length - i, TT.comment); break; }
      if (c === '/' && n === '*') {
        const end = line.indexOf('*/', i + 2);
        if (end === -1) { push(tokens, li, i, line.length - i, TT.comment); inBlock = true; break; }
        push(tokens, li, i, end + 2 - i, TT.comment); i = end + 2; continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        let j = i + 1;
        while (j < line.length) {
          if (quote !== '`' && line[j] === '\\') { j += 2; continue; }
          if (line[j] === quote) { j++; break; }
          j++;
        }
        push(tokens, li, i, j - i, TT.string); i = j; continue;
      }
      if (c === '#') {
        const m = /^#[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
        if (m) { push(tokens, li, i, m[0].length, TT.macro); i += m[0].length; continue; }
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(n))) {
        const m = /^(?:0x[0-9A-Fa-f_]+|0b[01_]+|0o[0-7_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?)/.exec(line.slice(i));
        if (m) { push(tokens, li, i, m[0].length, TT.number); i += m[0].length; continue; }
      }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1; while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (KW.has(word)) push(tokens, li, i, word.length, TT.keyword);
        else if (BUILTIN.has(word)) push(tokens, li, i, word.length, TT.function, TM.defaultLibrary ?? 0);
        i = j; continue;
      }
      if (/[+\-*/%=&|<>!^~?:.,;(){}\[\]]/.test(c)) {
        push(tokens, li, i, 1, TT.operator); i++; continue;
      }
      i++;
    }
  }
}

export function provideSemanticTokens(
  params: { textDocument: { uri: string } },
  documents: DocumentStore,
): SemanticTokens {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  const text = doc.getText();
  const lines = text.split('\n');
  const masked = maskNonCode(text).split('\n');
  const symbols = scanSymbols(text);
  const byName = new Map<string, typeof symbols>();
  for (const s of symbols) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }

  const declKeys = new Set(symbols.map(s => `${s.line}:${s.char}:${s.name}`));
  const raw: RawToken[] = [];

  emitLexical(raw, text);

  for (const s of symbols) {
    let type = TT.variable;
    let mods = TM.declaration ?? 0;
    if (s.kind === 'function') type = TT.function;
    else if (s.kind === 'struct') type = TT.struct;
    else if (s.kind === 'enum') type = TT.enum;
    else if (s.kind === 'alias') type = TT.type;
    else if (s.kind === 'parameter') type = TT.parameter;
    else if (s.kind === 'constant') { type = TT.variable; mods |= TM.readonly ?? 0; }
    push(raw, s.line, s.char, s.name.length, type, mods);
  }

  const identRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (let li = 0; li < masked.length; li++) {
    const line = masked[li];
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(line)) !== null) {
      const name = m[1];
      const start = m.index;
      if (declKeys.has(`${li}:${start}:${name}`)) continue;
      if (KW.has(name) || BUILTIN.has(name)) continue;
      const syms = byName.get(name);
      if (!syms || syms.length === 0) continue;
      const s = syms[0];
      let type = TT.variable;
      let mods = 0;
      if (s.kind === 'function') type = TT.function;
      else if (s.kind === 'struct') type = TT.struct;
      else if (s.kind === 'enum') type = TT.enum;
      else if (s.kind === 'alias') type = TT.type;
      else if (s.kind === 'parameter') type = TT.parameter;
      else if (s.kind === 'constant') mods |= TM.readonly ?? 0;
      const orig = lines[li] ?? '';
      let i = start - 1;
      while (i >= 0 && /\s/.test(orig[i])) i--;
      if (i >= 0 && orig[i] === '.') continue;
      push(raw, li, start, name.length, type, mods);
    }
  }

  // dedupe by position, prefer higher-specificity tokens (larger type/mod info from declarations)
  const byPos = new Map<string, RawToken>();
  for (const t of raw) {
    const k = `${t.line}:${t.start}:${t.length}`;
    const prev = byPos.get(k);
    if (!prev || t.modifiers > prev.modifiers || (t.modifiers === prev.modifiers && t.type !== TT.keyword)) byPos.set(k, t);
  }
  const deduped = Array.from(byPos.values()).sort((a, b) => a.line - b.line || a.start - b.start);
  const data: number[] = [];
  let prevLine = 0;
  let prevStart = 0;
  for (const t of deduped) {
    const deltaLine = t.line - prevLine;
    const deltaStart = deltaLine === 0 ? t.start - prevStart : t.start;
    data.push(deltaLine, deltaStart, t.length, t.type, t.modifiers);
    prevLine = t.line;
    prevStart = t.start;
  }
  return { data };
}

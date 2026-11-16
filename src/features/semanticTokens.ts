import type { DocumentStore, SemanticTokens, SemanticTokensLegend } from '../types';
import { scanSymbols } from '../utils/symbols';
import { maskNonCode } from '../utils/occurrences';

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

  // declarations
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

  // references in code
  const identRe = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (let li = 0; li < masked.length; li++) {
    const line = masked[li];
    let m: RegExpExecArray | null;
    while ((m = identRe.exec(line)) !== null) {
      const name = m[1];
      const start = m.index;
      if (declKeys.has(`${li}:${start}:${name}`)) continue;
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
      // skip member accesses
      const orig = lines[li] ?? '';
      let i = start - 1;
      while (i >= 0 && /\s/.test(orig[i])) i--;
      if (i >= 0 && orig[i] === '.') continue;
      push(raw, li, start, name.length, type, mods);
    }
  }

  raw.sort((a, b) => a.line - b.line || a.start - b.start);
  const data: number[] = [];
  let prevLine = 0;
  let prevStart = 0;
  for (const t of raw) {
    const deltaLine = t.line - prevLine;
    const deltaStart = deltaLine === 0 ? t.start - prevStart : t.start;
    data.push(deltaLine, deltaStart, t.length, t.type, t.modifiers);
    prevLine = t.line;
    prevStart = t.start;
  }
  return { data };
}
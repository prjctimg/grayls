import type { CompletionItem, DocumentStore, TextDocumentLike } from '../types';
import { CompletionItemKind } from '../types';
import { KEYWORDS, TYPES, BUILTINS, STDLIB_MODULES, ATTRIBUTES, DOCS, MODULE_FUNCTION_DOCS } from '../utils/gray-data';
import { resolveSymbolAt, scanSymbols } from '../utils/symbols';

// Pre-built static completion lists (created once)
const KEYWORD_ITEMS: CompletionItem[] = KEYWORDS.map(k => ({
  label: k,
  kind: CompletionItemKind.Keyword,
  detail: 'keyword',
  documentation: DOCS[k],
}));

const TYPE_ITEMS: CompletionItem[] = TYPES.map(t => ({
  label: t,
  kind: CompletionItemKind.TypeParameter,
  detail: 'type',
  documentation: DOCS[t],
}));

const BUILTIN_ITEMS: CompletionItem[] = BUILTINS.map(b => ({
  label: b,
  kind: CompletionItemKind.Function,
  detail: 'builtin',
  documentation: DOCS[b],
}));

const ATTRIBUTE_ITEMS: CompletionItem[] = ATTRIBUTES.map(a => ({
  label: `#${a}`,
  kind: CompletionItemKind.Property,
  detail: 'attribute',
  documentation: DOCS[`#${a}`],
  filterText: a,
  insertText: a,
}));

const MODULE_ITEMS: CompletionItem[] = STDLIB_MODULES.map(m => ({
  label: m,
  kind: CompletionItemKind.Module,
  detail: 'stdlib module',
  documentation: DOCS[m],
  insertText: m,
}));

// Static items always available
const STATIC_ITEMS: CompletionItem[] = [
  ...KEYWORD_ITEMS,
  ...TYPE_ITEMS,
  ...BUILTIN_ITEMS,
];

const MODULE_MEMBER_ITEMS = new Map<string, CompletionItem[]>();
for (const [key, doc] of Object.entries(MODULE_FUNCTION_DOCS)) {
  const dot = key.indexOf('.');
  if (dot <= 0) continue;
  const mod = key.slice(0, dot);
  const name = key.slice(dot + 1);
  if (!MODULE_MEMBER_ITEMS.has(mod)) MODULE_MEMBER_ITEMS.set(mod, []);
  MODULE_MEMBER_ITEMS.get(mod)!.push({
    label: name,
    kind: CompletionItemKind.Function,
    detail: `${mod}.${name}`,
    documentation: doc,
  });
}

/**
 * Name of the function whose argument list the cursor sits in, or null.
 * Scans back for the innermost unclosed `(`.
 */
function enclosingCall(prefix: string): string | null {
  let depth = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const m = prefix.slice(0, i).match(/([A-Za-z][A-Za-z0-9_]*)\s*$/);
        return m ? m[1] : null;
      }
      depth--;
    }
  }
  return null;
}

function getLinePrefix(
  doc: TextDocumentLike,
  params: { position: { line: number; character: number } },
): string {
  const lines = doc.getText().split('\n');
  const line = lines[params.position.line] ?? '';
  return line.slice(0, params.position.character);
}

function memberAccessPrefix(prefix: string): string | null {
  const m = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\.\w*$/);
  if (!m) return null;
  // bare implicit selector `.X` is handled separately
  if (/(?:^|[\s({\[,:=!<>+\-*/])\.\w*$/.test(prefix)) return null;
  return m[1];
}

function normalizeTypeName(type: string | undefined): string | null {
  if (!type) return null;
  let t = type.trim();
  t = t.replace(/^\^+/, '').trim();
  if (!t || t.startsWith('[') || t.startsWith('map[')) return null;
  const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] : null;
}

function importedModules(text: string): Set<string> {
  const set = new Set<string>();
  const re = /^\s*import\s+(?:and\s+use\s+)?(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const modRe = /@([A-Za-z_][A-Za-z0-9_]*)/g;
    let mm: RegExpExecArray | null;
    while ((mm = modRe.exec(m[1])) !== null) set.add(mm[1]);
  }
  return set;
}

function importInsertEdit(text: string, moduleName: string): { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string } {
  const lines = text.split('\n');
  let insertLine = 0;
  // place after leading comments/blank lines and existing import block
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '' || t.startsWith('//')) { insertLine = i + 1; continue; }
    if (/^import\b/.test(t)) { insertLine = i + 1; continue; }
    break;
  }
  return {
    range: { start: { line: insertLine, character: 0 }, end: { line: insertLine, character: 0 } },
    newText: `import @${moduleName}\n`,
  };
}

function withAutoImport(items: CompletionItem[], text: string, moduleName: string): CompletionItem[] {
  const imported = importedModules(text);
  if (imported.has(moduleName)) return items;
  const edit = importInsertEdit(text, moduleName);
  return items.map(it => ({ ...it, additionalTextEdits: [edit], detail: `${it.detail ?? moduleName} (auto-import @${moduleName})` }));
}

export function provideCompletion(
  params: { textDocument: { uri: string }; position: { line: number; character: number } },
  documents: DocumentStore,
): CompletionItem[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const prefix = getLinePrefix(doc, params);

  // Context: after `import @`, `import and use @`, or a comma continuation
  // of either → suggest module names.
  if (/^\s*import\s+(?:and\s+use\s+)?(?:@\w*\s*,\s*)*@\w*$/.test(prefix)) {
    return MODULE_ITEMS;
  }

  // Context: after `#` → suggest attribute names
  if (/#\w*$/.test(prefix)) {
    return ATTRIBUTE_ITEMS;
  }

  const text = doc.getText();
  const fileSymbols = scanSymbols(text);

  // Context: module or struct member access like `arrays.` / `point.`
  const base = memberAccessPrefix(prefix);
  if (base) {
    const moduleItems = MODULE_MEMBER_ITEMS.get(base);
    if (moduleItems && moduleItems.length > 0) {
      return withAutoImport(moduleItems, text, base);
    }

    const baseSym = resolveSymbolAt(base, fileSymbols, params.position);
    const typeName = normalizeTypeName(baseSym?.type);
    if (typeName) {
      let structSym = fileSymbols.find(s => s.kind === 'struct' && s.name === typeName);
      if (!structSym) {
        const alias = fileSymbols.find(s => s.kind === 'alias' && s.name === typeName);
        const aliased = normalizeTypeName(alias?.type);
        if (aliased) structSym = fileSymbols.find(s => s.kind === 'struct' && s.name === aliased);
      }
      if (structSym?.structFields?.length) {
        return structSym.structFields.map(f => ({
          label: f.name,
          kind: CompletionItemKind.Field,
          detail: `${structSym!.name}.${f.name} ${f.type}${f.default !== undefined ? ` = ${f.default}` : ''}`,
        }));
      }
    }
    // Unknown member access base: fall through to general completions below.
  }

  // Context: a bare `.` not preceded by an identifier → implicit enum selector.
  // Offer every variant declared in the file; the compiler resolves the type.
  if (/(?:^|[\s({\[,:=!<>+\-*/])\.\w*$/.test(prefix)) {
    const variantItems: CompletionItem[] = [];
    for (const sym of fileSymbols) {
      if (sym.kind !== 'enum' || !sym.enumMembers) continue;
      for (const mem of sym.enumMembers) {
        const payload = mem.payload && mem.payload.length > 0
          ? `(${mem.payload.join(', ')})`
          : '';
        variantItems.push({
          label: mem.name,
          kind: CompletionItemKind.EnumMember,
          detail: `${sym.name}.${mem.name}${payload}`,
          documentation: payload ? undefined : `= ${mem.value}`,
        });
      }
    }
    if (variantItems.length > 0) return variantItems;
  }

  const symbolItems: CompletionItem[] = fileSymbols
    .filter(sym => sym.kind !== 'parameter')
    .map(sym => ({
    label: sym.name,
    kind: sym.kind === 'function'
      ? CompletionItemKind.Function
      : sym.kind === 'struct'
        ? CompletionItemKind.Struct
        : sym.kind === 'enum'
          ? CompletionItemKind.Enum
          : sym.kind === 'alias'
            ? CompletionItemKind.TypeParameter
            : sym.kind === 'constant'
              ? CompletionItemKind.Constant
              : CompletionItemKind.Variable,
    detail: `${sym.kind} — ${sym.declaration}`,
  }));

  // Context: inside a user function's argument list → offer parameter names as
  // named arguments. Not offered for builtins or stdlib functions, which do
  // not support named arguments.
  const namedItems: CompletionItem[] = [];
  const call = enclosingCall(prefix);
  if (call) {
    const fn = fileSymbols.find(sym => sym.kind === 'function' && sym.name === call);
    for (const p of fn?.params ?? []) {
      namedItems.push({
        label: `${p.name}:`,
        kind: CompletionItemKind.Field,
        detail: `named argument — ${p.type}${p.default !== undefined ? ` = ${p.default}` : ''}`,
        insertText: `${p.name}: `,
        sortText: `0${p.name}`,
      });
    }
  }

  return [...namedItems, ...STATIC_ITEMS, ...symbolItems];
}

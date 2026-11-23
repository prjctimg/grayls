import type { CodeAction, CodeActionContext, DocumentStore, Range, TextEdit } from '../types';
import { CodeActionKind } from '../types';
import { STDLIB_MODULES } from '../utils/gray-data';

const MODULE_NAMES = new Set(STDLIB_MODULES);
const IMPORT_RE = /^\s*(?:extern\s+)?import\b.*$/gm;

function importedModules(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:extern\s+)?import\b([^\n]*)/g)) {
    const rest = m[1];
    for (const im of rest.matchAll(/@([A-Za-z_][A-Za-z0-9_]*)/g)) out.add(im[1]);
  }
  return out;
}

function importInsertEdit(text: string, moduleName: string): TextEdit {
  const lines = text.split('\n');
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:extern\s+)?import\b/.test(lines[i])) lastImport = i;
  }
  const line = lastImport >= 0 ? lastImport + 1 : 0;
  return { range: { start: { line, character: 0 }, end: { line, character: 0 } }, newText: `import @${moduleName}\n` };
}

function collectMissingImports(text: string): string[] {
  const imported = importedModules(text);
  const missing = new Set<string>();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  for (const m of text.matchAll(re)) {
    const mod = m[1];
    if (MODULE_NAMES.has(mod) && !imported.has(mod)) missing.add(mod);
  }
  return Array.from(missing).sort();
}

export function provideCodeActions(
  params: {
    textDocument: { uri: string };
    range: Range;
    context: CodeActionContext;
  },
  documents: DocumentStore,
): CodeAction[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  const text = doc.getText();
  const actions: CodeAction[] = [];

  const missing = collectMissingImports(text);
  for (const mod of missing) {
    actions.push({
      title: `Add import @${mod}`,
      kind: CodeActionKind.QuickFix,
      edit: { changes: { [params.textDocument.uri]: [importInsertEdit(text, mod)] } },
    });
  }

  // Dedupe identical adjacent import lines (simple quickfix)
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*(?:extern\s+)?import\b/.test(lines[i]) && lines[i] === lines[i - 1]) {
      actions.push({
        title: 'Remove duplicate import line',
        kind: CodeActionKind.QuickFix,
        edit: {
          changes: {
            [params.textDocument.uri]: [{
              range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
              newText: '',
            }],
          },
        },
      });
      break;
    }
  }

  return actions;
}

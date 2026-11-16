import type { DocumentStore, SignatureHelp, SignatureInformation, ParameterInformation } from '../types';
import { DOCS, MODULE_FUNCTION_DOCS } from '../utils/gray-data';
import { scanSymbols } from '../utils/symbols';

function getLinePrefix(text: string, position: { line: number; character: number }): string {
  const lines = text.split('\n');
  const line = lines[position.line] ?? '';
  return line.slice(0, position.character);
}

function callContext(prefix: string): { name: string; module?: string; activeParameter: number } | null {
  let depth = 0;
  let commas = 0;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const c = prefix[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) {
        const before = prefix.slice(0, i);
        const m = before.match(/([A-Za-z0-9_]+)(?:\s*)$/);
        if (!m) return null;
        const name = m[1];
        const modMatch = before.slice(0, m.index).match(/([A-Za-z0-9_]+)\.\s*$/);
        return { name, module: modMatch ? modMatch[1] : undefined, activeParameter: commas };
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      commas++;
    }
  }
  return null;
}

function parseParamsFromLabel(label: string): ParameterInformation[] {
  const m = label.match(/\(([^)]*)\)/);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '[' || c === '(' || c === '{' || c === '<') depth++;
    else if (c === ']' || c === ')' || c === '}' || c === '>') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map(p => ({ label: p }));
}

function signatureFromDoc(doc: string): SignatureInformation | null {
  // docs look like **`module.fn(args) -> ret`** — desc
  const m = doc.match(/\*\*`([^`]+)`\*\*/);
  if (!m) return null;
  const label = m[1];
  return { label, documentation: { kind: 'markdown', value: doc }, parameters: parseParamsFromLabel(label) };
}

export function provideSignatureHelp(
  params: { textDocument: { uri: string }; position: { line: number; character: number } },
  documents: DocumentStore,
): SignatureHelp | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const text = doc.getText();
  const prefix = getLinePrefix(text, params.position);
  const ctx = callContext(prefix);
  if (!ctx) return null;

  const signatures: SignatureInformation[] = [];

  if (ctx.module) {
    const key = `${ctx.module}.${ctx.name}`;
    const d = MODULE_FUNCTION_DOCS[key];
    if (d) {
      const sig = signatureFromDoc(d);
      if (sig) signatures.push(sig);
    }
  } else {
    const symbols = scanSymbols(text);
    const fn = symbols.find(s => s.kind === 'function' && s.name === ctx.name);
    if (fn) {
      const decl = fn.declaration;
      const m = decl.match(/\b(?:do|fn|func)\s+[A-Za-z0-9_]+\s*(\([^)]*\)(?:\s*->\s*[^\{]+)?)/);
      const label = m ? `${fn.name}${m[1].trim()}` : fn.declaration;
      const parameters: ParameterInformation[] = (fn.params ?? []).map(p => ({ label: `${p.name} ${p.type}${p.default !== undefined ? ` = ${p.default}` : ''}` }));
      signatures.push({ label, documentation: { kind: 'markdown', value: `\`\`\`gray\n${fn.declaration}\n\`\`\`` }, parameters });
    } else if (DOCS[ctx.name]) {
      const sig = signatureFromDoc(DOCS[ctx.name]);
      if (sig) signatures.push(sig);
    }
  }

  if (signatures.length === 0) return null;
  return { signatures, activeSignature: 0, activeParameter: ctx.activeParameter };
}
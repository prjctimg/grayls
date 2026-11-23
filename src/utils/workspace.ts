import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import type { GraySymbol } from './symbols';
import { scanSymbols } from './symbols';

export interface WorkspaceFile {
  uri: string;
  path: string;
  text: string;
  symbols: GraySymbol[];
}

const index = new Map<string, WorkspaceFile>();
let roots: string[] = [];

export function setWorkspaceRoots(urisOrPaths: (string | undefined | null)[]): void {
  const out: string[] = [];
  for (const v of urisOrPaths) {
    if (!v) continue;
    try {
      if (v.startsWith('file://')) out.push(fileURLToPath(v));
      else out.push(v);
    } catch { /* ignore */ }
  }
  roots = out;
}

export function getWorkspaceRoots(): string[] {
  return roots;
}

function walk(dir: string, out: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'out') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.gray')) out.add(p);
  }
}

export function refreshWorkspaceIndex(openDocs?: Map<string, string>): void {
  index.clear();
  const files = new Set<string>();
  for (const r of roots) walk(r, files);
  for (const p of files) {
    try {
      const uri = pathToFileURL(p).toString();
      const text = openDocs?.get(uri) ?? fs.readFileSync(p, 'utf8');
      index.set(uri, { uri, path: p, text, symbols: scanSymbols(text) });
    } catch { /* ignore */ }
  }
  if (openDocs) {
    for (const [uri, text] of openDocs.entries()) {
      if (!uri.endsWith('.gray')) continue;
      try {
        index.set(uri, { uri, path: uri.startsWith('file://') ? fileURLToPath(uri) : uri, text, symbols: scanSymbols(text) });
      } catch { /* ignore */ }
    }
  }
}

export function refreshWorkspaceIndexAsync(openDocs?: Map<string, string>, onDone?: () => void): void {
  const files = new Set<string>();
  for (const r of roots) walk(r, files);
  const list = Array.from(files);
  const next = new Map<string, WorkspaceFile>();
  let i = 0;
  const BATCH = 25;
  const step = () => {
    const end = Math.min(i + BATCH, list.length);
    for (; i < end; i++) {
      const p = list[i];
      try {
        const uri = pathToFileURL(p).toString();
        const text = openDocs?.get(uri) ?? fs.readFileSync(p, 'utf8');
        next.set(uri, { uri, path: p, text, symbols: scanSymbols(text) });
      } catch { /* ignore */ }
    }
    if (i < list.length) {
      setImmediate(step);
      return;
    }
    if (openDocs) {
      for (const [uri, text] of openDocs.entries()) {
        if (!uri.endsWith('.gray')) continue;
        try {
          next.set(uri, { uri, path: uri.startsWith('file://') ? fileURLToPath(uri) : uri, text, symbols: scanSymbols(text) });
        } catch { /* ignore */ }
      }
    }
    index.clear();
    for (const [k, v] of next.entries()) index.set(k, v);
    onDone?.();
  };
  setImmediate(step);
}

export function upsertIndexedDocument(uri: string, text: string): void {
  try {
    const p = uri.startsWith('file://') ? fileURLToPath(uri) : uri;
    index.set(uri, { uri, path: p, text, symbols: scanSymbols(text) });
  } catch { /* ignore */ }
}

export function removeIndexedDocument(uri: string): void {
  // keep if on disk? simple: remove
  index.delete(uri);
}

export function allIndexedFiles(): WorkspaceFile[] {
  return Array.from(index.values());
}

export function indexedFile(uri: string): WorkspaceFile | undefined {
  return index.get(uri);
}
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import type { Diagnostic } from '../types';
import { DiagnosticSeverity } from '../types';

// Match: error[E3018]: message\n  --> file.gray:42:10
// or:    warning[W1234]: message\n  --> file.gray:42:10
const DIAG_PATTERN =
  /^(error|warning)\[([EW]\d+)\]:\s+(.+)\n\s+-->\s+[^:]+:(\d+):(\d+)/gm;

export function parseDiagnostics(output: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  let m: RegExpExecArray | null;
  DIAG_PATTERN.lastIndex = 0;

  while ((m = DIAG_PATTERN.exec(output)) !== null) {
    const [, severity, code, message, lineStr, colStr] = m;
    const line = Math.max(0, parseInt(lineStr, 10) - 1);  // to 0-indexed
    const col  = Math.max(0, parseInt(colStr, 10) - 1);

    diags.push({
      range: {
        start: { line, character: col },
        end:   { line, character: col + 1 },
      },
      severity: severity === 'error'
        ? DiagnosticSeverity.Error
        : DiagnosticSeverity.Warning,
      code,
      message,
      source: 'grayc',
    });
  }
  return diags;
}

const diagCache = new Map<string, { at: number; diags: Diagnostic[] }>();
const DIAG_CACHE_TTL = 1500;

function cacheKey(text: string): string {
  // cheap key: length + head/tail sample
  const head = text.slice(0, 256);
  const tail = text.slice(-256);
  return `${text.length}:${head}:${tail}`;
}

function parseDiagnosticsJson(output: string): Diagnostic[] | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as { diagnostics?: any[] };
    if (!obj || !Array.isArray(obj.diagnostics)) return null;
    const diags: Diagnostic[] = [];
    for (const d of obj.diagnostics) {
      const sev = d?.severity === 'error' ? DiagnosticSeverity.Error
        : d?.severity === 'warning' ? DiagnosticSeverity.Warning
        : null;
      if (!sev) continue;
      const line = Math.max(0, (Number(d.line) || 1) - 1);
      const col = Math.max(0, (Number(d.column) || 1) - 1);
      const endCol = Math.max(col + 1, (Number(d.endColumn) || (col + 1)));
      diags.push({
        range: { start: { line, character: col }, end: { line, character: endCol } },
        severity: sev,
        code: typeof d.code === 'string' ? d.code : undefined,
        message: typeof d.message === 'string' ? d.message : String(d.message ?? ''),
        source: 'grayc',
      });
    }
    return diags;
  } catch {
    return null;
  }
}

/** Run `gray check` on a temporary copy and parse the compiler diagnostics. */
export function computeDiagnostics(text: string): Diagnostic[] {
  const key = cacheKey(text);
  const now = Date.now();
  const cached = diagCache.get(key);
  if (cached && now - cached.at < DIAG_CACHE_TTL) return cached.diags;
  if (diagCache.size > 32) {
    const first = diagCache.keys().next().value;
    if (first) diagCache.delete(first);
  }

  // Write to a temp file so gray can read it (handles unsaved buffers too)
  const tmpFile = path.join(os.tmpdir(), `gray-lsp-${process.pid}-${Math.random().toString(36).slice(2)}.gray`);
  try {
    fs.writeFileSync(tmpFile, text, 'utf8');
  } catch {
    return [];
  }

  try {
    // Prefer structured JSON diagnostics (newer grayc), fall back to text parsing.
    const jsonResult = cp.spawnSync('gray', ['check', '--diagnostic-format=json', tmpFile], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const jsonOut = (jsonResult.stdout ?? '') + (jsonResult.stderr ?? '');
    let diags = parseDiagnosticsJson(jsonOut);
    if (diags === null) {
      const result = cp.spawnSync('gray', ['check', tmpFile], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      const output = (result.stdout ?? '') + (result.stderr ?? '');
      diags = parseDiagnostics(output);
    }
    diagCache.set(key, { at: now, diags });
    return diags;
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

export interface TestBlock {
  name: string;
  line: number; // 0-indexed line of function declaration
}

export type TestState = 'passed' | 'failed' | 'unknown';

interface CacheEntry {
  at: number;
  byName: Map<string, TestState>;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 15000;

export function findTestBlocks(text: string): TestBlock[] {
  const lines = text.split('\n');
  const blocks: TestBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!(trimmed === '#test' || /^#\[\s*test\s*\]/.test(trimmed) || /(^|[,\s])test([,\]\s]|$)/.test(trimmed) && trimmed.startsWith('#['))) {
      // also allow grouped like #[doc("x"), test]
      if (!/#\[[^\]]*\btest\b[^\]]*\]/.test(trimmed) && trimmed !== '#test') continue;
    }
    // find next function declaration
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const t = lines[j].trim();
      if (t === '' || t.startsWith('//') || t.startsWith('#')) continue;
      const m = /^\s*(?:private\s+)?(?:unsafe\s+)?(?:do|fn|func)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(lines[j]);
      if (m) blocks.push({ name: m[1], line: j });
      break;
    }
  }
  return blocks;
}

function parseTestOutput(output: string): Map<string, TestState> {
  const byName = new Map<string, TestState>();
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    // common patterns: "ok  test name", "PASS test name", "FAIL test name", "not ok ..."
    let m = /^\s*(?:ok|PASS|passed|✓|✔)\b[:\s-]+([A-Za-z0-9_:.\/-]+)/i.exec(line);
    if (m) { byName.set(m[1], 'passed'); continue; }
    m = /^\s*(?:not ok|FAIL|failed|✗|✘|×)\b[:\s-]+([A-Za-z0-9_:.\/-]+)/i.exec(line);
    if (m) { byName.set(m[1], 'failed'); continue; }
    // fallback: line contains test name and pass/fail words
    m = /\b([A-Za-z_][A-Za-z0-9_]*)\b.*\b(passed|ok)\b/i.exec(line);
    if (m && !/failed|fail|error/i.test(line)) { byName.set(m[1], 'passed'); continue; }
    m = /\b([A-Za-z_][A-Za-z0-9_]*)\b.*\b(failed|fail|error)\b/i.exec(line);
    if (m) { byName.set(m[1], 'failed'); continue; }
  }
  // aggregate fallback
  if (byName.size === 0) {
    if (/\b0\s+failed\b/i.test(output) && /\b(pass|ok|passed)\b/i.test(output)) return byName; // keep empty => unknown per-test
    if (/\bfail(ed)?\b/i.test(output)) byName.set('*', 'failed');
    else if (/\bpass(ed)?\b|\bok\b/i.test(output)) byName.set('*', 'passed');
  }
  return byName;
}

export function getTestStatuses(filePathOrUri: string): Map<string, TestState> {
  try {
    const filePath = filePathOrUri.startsWith('file://') ? fileURLToPath(filePathOrUri) : filePathOrUri;
    if (!fs.existsSync(filePath)) return new Map();
    const key = path.resolve(filePath);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && now - cached.at < TTL_MS) return cached.byName;

    const res = cp.spawnSync('gray', ['test', filePath], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const output = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    const byName = parseTestOutput(output);
    cache.set(key, { at: now, byName });
    return byName;
  } catch {
    return new Map();
  }
}

export function testStatusIcon(state: TestState): string {
  if (state === 'passed') return '';
  if (state === 'failed') return '';
  return '';
}

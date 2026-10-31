import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import {
  DocumentFormattingParams,
  ErrorCodes,
  ResponseError,
  TextDocuments,
  TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

function wholeDocumentEdit(text: string, formatted: string): TextEdit[] {
  if (formatted === text) return [];

  const lines = text.split('\n');
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: {
          line: lines.length - 1,
          character: lines[lines.length - 1].length,
        },
      },
      newText: formatted,
    },
  ];
}

/**
 * Format with `gray fmt`, which rewrites a path in place and has no stdin mode.
 * The buffer is written to a `.gray` temp file, formatted there, and returned as
 * one full-document edit.
 */
export function provideFormatting(
  params: DocumentFormattingParams,
  documents: TextDocuments<TextDocument>,
): TextEdit[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const tmpFile = path.join(
    os.tmpdir(),
    `gray-lsp-fmt-${process.pid}-${Date.now()}.gray`,
  );

  try {
    fs.writeFileSync(tmpFile, text, 'utf8');
  } catch (err) {
    throw new ResponseError(
      ErrorCodes.InternalError,
      `Could not create a temporary file for \`gray fmt\`: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const result = cp.spawnSync('gray', ['fmt', tmpFile], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    if (result.error) {
      throw new ResponseError(
        ErrorCodes.InternalError,
        `Could not run \`gray fmt\`: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
      throw new ResponseError(
        ErrorCodes.InternalError,
        output || '`gray fmt` failed',
      );
    }

    const formatted = fs.readFileSync(tmpFile, 'utf8');
    return wholeDocumentEdit(text, formatted);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

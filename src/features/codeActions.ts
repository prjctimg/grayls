import type { CodeAction, CodeActionContext, DocumentStore, Range } from '../types';

export function provideCodeActions(
  _params: {
    textDocument: { uri: string };
    range: Range;
    context: CodeActionContext;
  },
  _documents: DocumentStore,
): CodeAction[] {
  // Minimal implementation: protocol support is wired and callable.
  // Future: derive quick fixes/refactors from diagnostics and selection.
  return [];
}
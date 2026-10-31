/**
 * Batch 8.3b — the editor glue for suggestions and fixes.
 *
 * Kept out of `index.ts` on purpose: this file imports `vscode`, and everything
 * in the barrel must stay loadable by a test. The logic lives in `suggest.ts`
 * and `fix.ts`; this is the wiring, and it is deliberately thin.
 *
 * Provenance: adapted from AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 */

import * as vscode from 'vscode';
import { askFeature, type ServiceBridge } from './service';
import type { RoutableModel } from './routing';
import { buildSuggestionPrompt, cleanSuggestion, isUsable } from './suggest';
import {
  FIX_CONTEXT_LINES,
  buildFixPrompt,
  describeFix,
  extractReplacement,
  isUsableFix,
} from './fix';

export interface EditorOptions {
  bridge: ServiceBridge;
  models: () => Promise<RoutableModel[]>;
  /** The model setting for a feature: a model id or `auto`. */
  setting: (feature: 'suggestions' | 'fix') => string;
  enabled: (feature: 'suggestions' | 'fix') => boolean;
  log: (message: string) => void;
  /** Batch 8.3c — serves the proposed file to the diff view. */
  preview?: { set(uri: vscode.Uri, content: string): void };
}

/** Scheme for the proposed document the diff view opens beside the real file. */
export const FIX_SCHEME = 'ai-bridge-fix';

/**
 * Batch 8.3c — the proposed content, served read-only to `vscode.diff`.
 *
 * A diff needs a document URI on both sides; the real file is one and this is the
 * other. Nothing here is written to disk — the document lives for as long as the
 * editor keeps it open, and the apply path is still the single `WorkspaceEdit`.
 */
export class FixPreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly documents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  dispose(): void {
    this.documents.clear();
    this.emitter.dispose();
  }
}

/**
 * Ghost text, on demand only.
 *
 * The provider is armed by the command and disarms itself after one answer, so
 * it never fires while typing. On a free backend that takes seconds, an
 * automatic provider is worse than none: it would interrupt more often than it
 * helped.
 */
export class SuggestProvider implements vscode.InlineCompletionItemProvider {
  private armed = false;

  constructor(private readonly opts: EditorOptions) {}

  /** Called by the command, immediately before the editor is asked to trigger. */
  arm(): void {
    this.armed = true;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.armed) return undefined;
    this.armed = false;
    if (!this.opts.enabled('suggestions')) return undefined;

    const config = vscode.workspace.getConfiguration('aiBridge');
    const maxPrefixChars = config.get<number>('features.suggestions.maxPrefixChars', 2_000);
    const maxSuffixChars = config.get<number>('features.suggestions.maxSuffixChars', 800);

    const offset = document.offsetAt(position);
    const text = document.getText();
    const prefix = text.slice(Math.max(0, offset - maxPrefixChars), offset);
    const suffix = text.slice(offset, Math.min(text.length, offset + maxSuffixChars));

    const prompt = buildSuggestionPrompt({
      prefix,
      suffix,
      languageId: document.languageId,
      maxPrefixChars,
      maxSuffixChars,
    });

    try {
      const result = await askFeature(
        this.opts.bridge,
        await this.opts.models(),
        'suggestions',
        this.opts.setting('suggestions'),
        prompt,
      );
      if (token.isCancellationRequested) return undefined;

      const suggestion = cleanSuggestion(result.text);
      if (!isUsable(suggestion)) return undefined;

      this.opts.log(`suggest: ${suggestion.split('\n').length} line(s) from ${result.modelLabel}`);
      return [new vscode.InlineCompletionItem(suggestion, new vscode.Range(position, position))];
    } catch (err) {
      // A failed suggestion is silent by design: it must never interrupt typing.
      this.opts.log(`suggest: ${(err as Error).message}`);
      return undefined;
    }
  }
}

/** Offers a fix on errors and warnings, as a Quick Fix action. */
export class FixProvider implements vscode.CodeActionProvider {
  constructor(private readonly opts: EditorOptions) {}

  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!this.opts.enabled('fix')) return [];
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics.slice(0, 3)) {
      if (
        diagnostic.severity !== vscode.DiagnosticSeverity.Error &&
        diagnostic.severity !== vscode.DiagnosticSeverity.Warning
      ) {
        continue;
      }
      const action = new vscode.CodeAction('AI Bridge: Fix this', vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: 'aiBridge.fix',
        title: 'AI Bridge: Fix this',
        arguments: [_document.uri, diagnostic],
      };
      actions.push(action);
    }
    return actions;
  }
}

/**
 * Runs one fix.
 *
 * The replacement is shown before it is applied — the model's text lands in a
 * file the user owns, so it is previewed and confirmed, then applied as a single
 * `WorkspaceEdit` over one line range: one undo step, no partial state.
 */
export async function runFix(
  opts: EditorOptions,
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const line = diagnostic.range.start.line;
  if (line >= document.lineCount) return;

  const from = Math.max(0, line - FIX_CONTEXT_LINES);
  const to = Math.min(document.lineCount - 1, line + FIX_CONTEXT_LINES);
  const code = document.getText(new vscode.Range(from, 0, to, document.lineAt(to).text.length));

  const prompt = buildFixPrompt({
    code,
    message: diagnostic.message,
    languageId: document.languageId,
    line: line + 1,
    offset: line - from,
  });

  const result = await askFeature(
    opts.bridge,
    await opts.models(),
    'fix',
    opts.setting('fix'),
    prompt,
  );
  const replacement = extractReplacement(result.text);
  if (!isUsableFix(replacement)) {
    void vscode.window.showWarningMessage('AI Bridge: the model returned no usable fix.');
    return;
  }

  const preview = replacement.length > 800 ? `${replacement.slice(0, 800)}\n…` : replacement;
  let choice = await vscode.window.showWarningMessage(
    `AI Bridge (${result.modelLabel}) — ${describeFix(replacement)}:`,
    { modal: true, detail: preview },
    'Apply',
    'Show diff',
  );

  // Batch 8.3c: the modal shows the text, the diff shows it in place. Someone who
  // wants the second is about to change their mind or not; either way they should
  // not have to apply to find out.
  if (choice === 'Show diff') {
    await showFixDiff(opts, document, line, replacement);
    choice = await vscode.window.showWarningMessage(
      `Apply this fix to ${basename(document.fileName)}?`,
      { modal: true },
      'Apply',
    );
  }
  if (choice !== 'Apply') return;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, document.lineAt(line).range, replacement);
  const applied = await vscode.workspace.applyEdit(edit);
  opts.log(
    `fix: ${applied ? 'applied' : 'rejected by the editor'} (${result.modelLabel})`,
  );
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || 'file';
}

/**
 * Opens the fix as a side-by-side diff: the real file on the left, the file as it
 * would be on the right.
 *
 * Silent when no preview provider was supplied — the modal remains the whole
 * interaction in that case, which is the behaviour every earlier build had.
 */
async function showFixDiff(
  opts: EditorOptions,
  document: vscode.TextDocument,
  line: number,
  replacement: string,
): Promise<void> {
  if (!opts.preview) return;

  const lines = document.getText().split('\n');
  lines.splice(line, 1, ...replacement.split('\n'));

  const proposed = vscode.Uri.parse(`${FIX_SCHEME}:${encodeURIComponent(document.fileName)}`);
  opts.preview.set(proposed, lines.join('\n'));

  await vscode.commands.executeCommand(
    'vscode.diff',
    document.uri,
    proposed,
    `AI Bridge fix — ${basename(document.fileName)}`,
  );
}

/**
 * The debate panel, inside the VS Code extension.
 *
 * This is the third host for the same UI (D10): the bridge serves `panel.html` to a
 * browser, the Chrome extension bundles it into a side panel, and this loads it into
 * a webview. There is no copy here — it reads the file the bridge already ships, so
 * the two cannot drift.
 *
 * The transport is the only host-specific part, and it is the same shape as the
 * Chrome relay: the webview posts a message, this forwards it to the bridge over the
 * client the extension already has, and posts the reply back. The webview never
 * learns a port or a token, which is why it needs no CSP exception for ws://.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BridgeClient } from '@ai-bridge/shared';

interface CallMessage {
  type: 'ai-bridge:call';
  id: number;
  op: string;
  args?: Record<string, unknown>;
}

const isCall = (msg: unknown): msg is CallMessage =>
  typeof msg === 'object' &&
  msg !== null &&
  (msg as { type?: unknown }).type === 'ai-bridge:call' &&
  typeof (msg as { op?: unknown }).op === 'string';

export class DebatePanelProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'aiBridge.debateView';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: BridgeClient,
    private readonly log: (line: string) => void = () => {},
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      // The panel needs nothing from disk: every asset is inline.
      localResourceRoots: [],
    };
    view.webview.html = this.html();

    view.webview.onDidReceiveMessage((msg: unknown) => {
      if (!isCall(msg)) return;
      void this.forward(msg);
    });
  }

  reveal(): void {
    void vscode.commands.executeCommand(`${DebatePanelProvider.viewType}.focus`);
  }

  private async forward(msg: CallMessage): Promise<void> {
    const view = this.view;
    if (!view) return;
    try {
      const result = await this.client.request({ op: msg.op, ...(msg.args ?? {}) } as never);
      void view.webview.postMessage({ type: 'ai-bridge:reply', id: msg.id, result });
    } catch (err) {
      const error = (err as Error).message;
      this.log(`debate ${msg.op} failed: ${error}`);
      void view.webview.postMessage({ type: 'ai-bridge:reply', id: msg.id, error });
    }
  }

  /** The panel the bridge serves, with a CSP nonce and the host flag injected. */
  private html(): string {
    const nonce = Array.from({ length: 24 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62)),
    ).join('');

    const file = path.join(this.extensionUri.fsPath, 'bridge', 'dist', 'server', 'panel.html');
    let panel: string;
    try {
      panel = fs.readFileSync(file, 'utf8');
    } catch {
      return `<!doctype html><html><body style="font:14px system-ui;padding:18px">
        <p>The debate panel is missing from this build.</p>
        <p><code>${file}</code> was not packaged, which means <code>npm run build</code>
        did not run <code>scripts/copy-assets.mjs</code> before the .vsix was made.</p>
      </body></html>`;
    }

    const config = JSON.stringify({ host: 'vscode' }).replace(/</g, '\\u003c');
    const csp = [
      "default-src 'none'",
      `style-src 'nonce-${nonce}' 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return panel
      .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      .replace(
        '</head>',
        `<script nonce="${nonce}">window.__BRIDGE__ = ${config};</script>\n</head>`,
      )
      // The panel's own script tag needs the nonce to run under that policy.
      .replace(/<script>/g, `<script nonce="${nonce}">`);
  }
}

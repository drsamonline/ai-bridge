/**
 * Settings panel — the VS Code shell around `SettingsController` (§5.12:
 * "cmd-response pattern · retainContextWhenHidden · debounced save").
 */

import * as vscode from 'vscode';
import { SettingsController, type FromPanel, type PanelSnapshot, type SettingsHost } from './controller';
import { renderSettingsHtml } from './html';

export interface SettingsPanelDeps {
  extensionUri: vscode.Uri;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  onApplied?: (key: string, value: unknown) => void;
  snapshot?: () => PanelSnapshot;
  samples?: () => number[];
  actions?: Record<string, (value?: unknown) => Promise<string | void> | string | void>;
  compressPreview?: (text: string) => Promise<{ before: number; after: number; percent: number; text: string }>;
}

/** Reads and writes the flat `aiBridge.*` keys through VS Code configuration. */
export function vscodeSettingsHost(
  target: () => vscode.ConfigurationTarget,
): SettingsHost {
  return {
    get(key, dflt) {
      return vscode.workspace.getConfiguration().get(key, dflt as never);
    },
    async update(key, value) {
      await vscode.workspace.getConfiguration().update(key, value, target());
    },
  };
}

export class SettingsPanel {
  private static current: SettingsPanel | null = null;

  private readonly controller: SettingsController;
  private disposed = false;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    deps: SettingsPanelDeps,
  ) {
    this.controller = new SettingsController({
      host: vscodeSettingsHost(() => vscode.ConfigurationTarget.Global),
      log: deps.log,
      ...(deps.onApplied ? { onApplied: deps.onApplied } : {}),
      ...(deps.snapshot ? { snapshot: deps.snapshot } : {}),
      ...(deps.samples ? { samples: deps.samples } : {}),
      ...(deps.actions ? { actions: deps.actions } : {}),
      ...(deps.compressPreview ? { compressPreview: deps.compressPreview } : {}),
      debounceMs: 200,
    });

    const nonce = Array.from({ length: 24 }, () =>
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62)),
    ).join('');

    panel.webview.options = { enableScripts: true, localResourceRoots: [deps.extensionUri] };
    panel.webview.html = renderSettingsHtml({
      nonce,
      snapshot: deps.snapshot?.() ?? {
        ramPercent: null,
        ramUsedMb: null,
        ramCapMb: null,
        bootTokens: null,
        deltas: null,
        indexedFiles: null,
        snapshots: [],
        health: [],
        t1: null,
      },
    });

    panel.webview.onDidReceiveMessage((msg: FromPanel) => {
      void this.dispatch(msg);
    });

    panel.onDidDispose(() => {
      this.disposed = true;
      void this.controller.dispose();
      if (SettingsPanel.current === this) SettingsPanel.current = null;
    });
  }

  private async dispatch(msg: FromPanel): Promise<void> {
    if (this.disposed) return;
    const replies = await this.controller.handle(msg);
    for (const reply of replies) {
      if (this.disposed) return;
      await this.panel.webview.postMessage(reply);
    }
  }

  /** Push fresh live data (RAM, snapshots, health) without re-rendering fields. */
  refresh(): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(this.controller.state());
  }

  static show(deps: SettingsPanelDeps): SettingsPanel {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal();
      SettingsPanel.current.refresh();
      return SettingsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'aiBridge.settings',
      'AI Bridge Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // §5.12: keep the panel alive when focus moves away.
        retainContextWhenHidden: true,
        localResourceRoots: [deps.extensionUri],
      },
    );
    const instance = new SettingsPanel(panel, deps);
    SettingsPanel.current = instance;
    deps.log('info', 'settings panel opened');
    return instance;
  }

  static refreshIfOpen(): void {
    SettingsPanel.current?.refresh();
  }
}

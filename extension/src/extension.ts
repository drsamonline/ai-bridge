/**
 * AI Bridge — extension entry point.
 *
 * Batch 0.1: bridge lifecycle + token handshake.
 * Batch 0.2: CDP attach, RAM meter, watchdog surface.
 *
 * Surfaces (spec §6): the "AI Bridge" Output channel, the status bar
 * (`Attached: Chrome · RAM 120/500`), toasts for every watchdog event, and a
 * palette entry for every action. Nothing here is silent.
 */

import * as os from 'node:os';
import * as vscode from 'vscode';
import { registerAiBridgeLanguageModel, type LmClient } from './lm';
import {
  BridgeClient,
  type BrowserStatus,
  type ControlEvent,
  type RamSample,
  type HandshakeData,
} from '@ai-bridge/shared';
import { BridgeProcess } from './bridgeProcess';
import { ChatPanelProvider, type FromPanel } from './chatPanel';
import { DecisionStore, RepoService } from './repo/service';
import { contextWorthIt } from './repo/relevance';
import { StateManager } from './state/manager';
import { StateStore } from './state/store';
import { T1Host } from './state/workerHost';
import { HeuristicT2, OllamaT2, TabT2, type T2Backend } from './state/t2';
import { bootstrapChat } from './state/bootstrap';
import { CompressHost } from './compress/host';
import { compressT0, savedPercent, type CompressResult } from './compress/t0';
import { SettingsPanel } from './settings/panel';
import { SessionRotator, type RotationResult } from './rotation/rotator';
import { effective, resolveLowEnd, type EffectiveSettings, type LowEndDecision } from './lowEnd';
import { assertNoChatContent, buildReport, summarise } from './diagnostics/breakage';
import type { PanelSnapshot } from './settings/controller';
import { LlamaCppCompressor, OllamaCompressor, T1Compressor, shouldEnableT1, type T1Backend } from './compress/t1';
import { ProviderCompressor } from './compress/providerT2';
import {
  decisionsFromState,
  lockDecision,
  migrateDecisions,
  recordOverride,
  unlockDecision,
} from './state/decisions';
import type { LockedDecisionLite } from './repo/applier';
import { nodeStateFs, resolveStateDir, secretCipher } from './state/vscodeState';
import { statusText, statusTooltip, mb, type MeterState, type Phase } from './statusBar';

const CHANNEL = 'AI Bridge';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(CHANNEL);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  status.command = 'aiBridge.bridge.showLog';
  status.show();

  let phase: Phase = 'stopped';
  let stopping = false;
  let lastError: string | null = null;
  let handshake: HandshakeData | null = null;
  let browser: BrowserStatus | null = null;
  let ram: RamSample | null = null;
  let blocked = false;
  let lastWarnAt = 0;
  /** Wall-clock when the active tab was opened, so the age ticks between refreshes. */
  let tabOpenedAt: number | null = null;
  /** Streaming state for the status bar and the panel. */
  let currentStreamId: string | null = null;
  let msgSeq = 0;
  let streamStartedAt = 0;
  let lastStreamMs: number | null = null;
  let lastStreamAt = 0;
  let streamTicker: NodeJS.Timeout | null = null;

  const write = (level: 'info' | 'warn' | 'error', text: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    output.appendLine(`${stamp} ${level.toUpperCase().padEnd(5)} [ext] ${text}`);
  };

  /** Repo layer — present only when a folder is open. */
  const decisions = new DecisionStore(context.workspaceState);
  const folder = vscode.workspace.workspaceFolders?.[0];
  /** From 2.3 the guard reads §4 `ProjectState.decisions`; the memento is legacy. */
  let decisionSource: () => LockedDecisionLite[] = () => decisions.list();
  const repo = folder ? new RepoService(folder.uri, () => decisionSource(), write) : null;
  if (!repo) write('info', 'no workspace folder — repo context and edit proposals are off');

  /** State layer — schema + gzip persistence + T1 in a worker thread (§5.5). */
  let stateManager: StateManager | null = null;
  let stateT1: T1Host | null = null;

  /** T0 compressor — §5.6, always on, off the host thread. */
  let compressor: CompressHost | null = null;
  let lastCompression: CompressResult | null = null;
  let t1Compressor: T1Compressor | null = null;
  let t1Gate: { enable: boolean; reason: string } | null = null;
  /** §7.1 low-end mode: resolved once at activation and re-resolved on change. */
  let lowEnd: LowEndDecision = resolveLowEnd(os.totalmem(), 'auto');
  let eff: EffectiveSettings = effective(lowEnd);
  const refreshLowEnd = (): void => {
    const mode = cfg().get<'auto' | 'on' | 'off'>('ui.lowEndMode', 'auto');
    lowEnd = resolveLowEnd(os.totalmem(), mode);
    eff = effective(lowEnd);
    write(lowEnd.active ? 'warn' : 'info', `low-end: ${lowEnd.reason}`);
  };

  /** Rolling RAM samples for the Performance tab's sparkline. */
  const ramSamples: number[] = [];
  /** Last adapter health probe, for the Providers tab. */
  let lastHealth: Array<{ id: string; label: string; ready: boolean; limited: boolean; matches: number }> = [];
  /** How many provider switches this session has made, for diagnostics. */
  let failoverCount = 0;
  /** Index into state.deltas at the last failover — everything after it is the delta. */
  let lastDeltaIndex = 0;
  let lastModels: Array<{ id: string; label: string; isFree: boolean; current: boolean }> = [];
  /** §5.9/§5.10: who answered last, and whether their current model is free. */
  let activeProviderId: string | null = null;
  let routerSnapshot: Array<{
    id: string;
    label: string;
    state: string;
    cooldownUntil: number;
    priority?: number;
    cooldownMs?: number;
  }> = [];
  /** §6 Providers Health: "last response" per provider. */
  const lastResponse: Record<string, { ms: number; at: number }> = {};
  /** Last prompt text, kept only so the breakage report can prove it excludes it. */
  let lastPromptText = '';
  /** Cumulative tokens saved by compression this session (§5.6 visibility). */
  let tokensSavedSession = 0;

  const startCompressor = async (): Promise<CompressHost | null> => {
    if (compressor) return compressor;
    try {
      compressor = new CompressHost({ log: write });
      const threaded = await compressor.start();
      write(
        'info',
        `T0 compressor ready (${threaded ? 'worker thread' : 'inline'}), tier=${cfg().get<string>('compressor.tier', 'auto')}, budget=${cfg().get<number>('compressor.budgetTokens', 4096)} tokens`,
      );
      await initT1();
      await pushCustomProviders();
      return compressor;
    } catch (err) {
      write('error', `T0 compressor failed to start: ${(err as Error).message}`);
      compressor = null;
      return null;
    }
  };

  const startState = async (): Promise<StateManager | null> => {
    if (stateManager) return stateManager;
    try {
      const location = cfg().get<'workspace' | 'global'>('state.location', 'workspace');
      const dir = await resolveStateDir(location, folder?.uri.fsPath ?? null);
      const encrypt = cfg().get<boolean>('state.encrypt', true);
      const cipher = encrypt ? await secretCipher(context.secrets, write) : undefined;
      stateT1 = new T1Host({ log: write });
      await stateT1.start();
      const store = new StateStore({
        fs: nodeStateFs(),
        dir,
        encrypt,
        ...(cipher ? { cipher } : {}),
        maxSnapshots: cfg().get<number>('state.maxSnapshots', 10),
        log: write,
        createOptions: { id: folder?.uri.fsPath ?? 'global', root: folder?.uri.fsPath ?? '' },
      });
      stateManager = new StateManager({
        store,
        t1: stateT1,
        log: write,
        snapshotEvery: cfg().get<number>('state.snapshotEvery', 10),
        t2: await pickT2Backend(),
        t2Every: cfg().get<number>('t2.every', 5),
        ...(repo ? { fs: (await import('./repo/vscodePorts')).createFsPort(folder!.uri, (m) => write('warn', m)) } : {}),
      });
      const init = await stateManager.init();
      write(
        'info',
        `state: ${init.state.deltas.length} delta(s) at ${store.path} · T1 ${stateManager.threaded ? 'on a worker thread' : 'inline'}`,
      );

      // §2.3: the guard's decisions now live in the state. Migrate the interim
      // store once so nothing locked before 2.3 silently stops being enforced.
      const migration = await migrateDecisions(decisions.list(), stateManager.current, () => decisions.clear(), write);
      if (migration.ran) await stateManager.saveNow();
      decisionSource = () => decisionsFromState(stateManager!.current);
      write(
        'info',
        `locked decisions: ${stateManager.current.decisions.length} (source: project state${migration.migrated ? `, ${migration.migrated} migrated` : ''})`,
      );
      await refreshSnapshots();
      SettingsPanel.refreshIfOpen();
      renderStatus();
      return stateManager;
    } catch (err) {
      write('error', `state layer failed to start: ${(err as Error).message}`);
      return null;
    }
  };

  /** §5.5: Ollama first, then a throwaway tab, then the offline extractor. */
  const pickT2Backend = async (): Promise<T2Backend | undefined> => {
    const choice = cfg().get<string>('t2.backend', 'auto');
    if (choice === 'off') {
      write('info', 'T2 disabled by setting');
      return undefined;
    }
    const ollama = new OllamaT2({
      url: cfg().get<string>('t2.url', 'http://127.0.0.1:11434'),
      model: cfg().get<string>('t2.model', 'llama3.2'),
      log: write,
    });
    if (choice === 'ollama') {
      write('info', `T2 backend: ollama (${cfg().get<string>('t2.model', 'llama3.2')})`);
      return ollama;
    }
    if (choice === 'tab') {
      write('info', 'T2 backend: throwaway tab');
      return new TabT2(async (text) => {
        const res = (await client.request({ op: 'ctl.prompt', adapterId: cfg().get<string>('adapter.id', 'chatgpt'), text }, 120000)) as { text: string };
        return res.text;
      }, write);
    }
    if (choice === 'heuristic') {
      write('info', 'T2 backend: heuristic (offline)');
      return new HeuristicT2();
    }
    // auto: probe, then fall back.
    if (await ollama.available()) {
      write('info', 'T2 backend: ollama (auto-detected)');
      return ollama;
    }
    write('info', 'T2 backend: heuristic (no Ollama on 127.0.0.1:11434)');
    return new HeuristicT2();
  };

  /**
   * §5.6: T1 is opt-in and auto-off below 8 GB. The gate decision is logged and
   * surfaced in the status bar, so "T1 is off" is never a mystery.
   */
  const initT1 = async (): Promise<void> => {
    const minRamGb = cfg().get<number>('t1.minRamGb', 8);
    const mode = cfg().get<'auto' | 'on' | 'off'>('t1.mode', 'auto');
    const gate = shouldEnableT1(os.totalmem(), {
      lowEndMode: mode,
      minRamBytes: minRamGb * 1024 ** 3,
    });
    // §7.1: low-end mode closes T1 outright, whatever the RAM gate says.
    if (eff.t1Allowed === false && gate.enable) {
      t1Gate = { enable: false, reason: `low-end mode — T1 off (${lowEnd.reason})` };
      write('info', `T1 off: ${t1Gate.reason}`);
      t1Compressor = null;
      return;
    }
    t1Gate = { enable: gate.enable, reason: gate.reason };

    if (!gate.enable) {
      write('info', `T1 off: ${gate.reason}`);
      t1Compressor = null;
      return;
    }

    const kind = cfg().get<'ollama' | 'llamacpp' | 'provider'>('t1.backend', 'ollama');
    let backend: T1Backend | undefined;
    if (kind === 'provider') {
      // §5.6 T2: ask the provider itself, in a throwaway tab, so the real
      // conversation never sees the compression chatter.
      backend = new ProviderCompressor(async (prompt: string) => {
        const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
        const adapters = (await client.request({ op: 'ctl.adapters' })) as {
          adapters: Array<{ id: string; url: string }>;
        };
        const url = adapters.adapters.find((a) => a.id === adapterId)?.url ?? 'about:blank';
        const tab = (await client.request({ op: 'ctl.tab.open', url })) as { id: string };
        try {
          const res = (await client.request(
            { op: 'ctl.prompt', adapterId, text: prompt, timeoutMs: 90_000 },
            120_000,
          )) as { text: string };
          return res.text;
        } finally {
          await client.request({ op: 'ctl.tab.close', tabId: tab.id }).catch(() => undefined);
        }
      }, write);
    } else if (kind === 'llamacpp') {
      const modelPath = cfg().get<string>('t1.modelPath', '');
      backend = modelPath ? new LlamaCppCompressor({ modelPath }, write) : undefined;
      if (!backend) write('warn', 'T1: no llama.cpp model path configured (t1.modelPath)');
    } else {
      backend = new OllamaCompressor(
        { url: cfg().get<string>('t1.url', 'http://127.0.0.1:11434'), model: cfg().get<string>('t1.model', 'llama3.2') },
        write,
      );
    }

    t1Compressor = new T1Compressor({
      ...(backend ? { backend } : {}),
      // Only used when no precomputed base is supplied; the prompt path always
      // computes T0 on the worker first.
      t0: (text, o) => compressT0(text, o),
      log: write,
      totalMemBytes: () => os.totalmem(),
      lowEndMode: mode,
      minRamBytes: minRamGb * 1024 ** 3,
      timeoutMs: cfg().get<number>('t1.timeoutMs', 20000),
    });

    const usable = backend ? await backend.available().catch(() => false) : false;
    write(
      usable ? 'info' : 'warn',
      usable
        ? `T1 ready: ${backend!.name} (${gate.reason})`
        : `T1 enabled but backend "${kind}" is not reachable — prompts stay on T0 until it is`,
    );
  };

  const recordTurn = async (role: 'user' | 'assistant', text: string): Promise<void> => {
    const mgr = stateManager ?? (await startState());
    if (!mgr) return;
    try {
      const r = await mgr.turn(role, text);
      write(
        'info',
        `state: ${role} turn → +${r.deltas} delta(s), ${r.total} total, ${r.tookMs} ms${r.threaded ? ' (worker)' : ' (inline)'}`,
      );
    } catch (err) {
      write('warn', `state turn failed: ${(err as Error).message}`);
    }
  };

  const cfg = () => vscode.workspace.getConfiguration('aiBridge');

  const meter = (): MeterState => ({
    phase,
    browser:
      browser && tabOpenedAt !== null
        ? { ...browser, tabAgeMs: Math.max(0, Date.now() - tabOpenedAt) }
        : browser,
    ram,
    extRssBytes: process.memoryUsage().rss,
    extCapBytes: cfg().get<number>('ramCap.extension', 1024) * 1024 * 1024,
    blocked,
    lastError,
    lowEnd: { active: lowEnd.active, reason: lowEnd.reason },
    provider: (() => {
      const id = activeProviderId ?? cfg().get<string>('adapter.id', 'chatgpt');
      const fromRouter = routerSnapshot.find((p) => p.id === id);
      return {
        id,
        label: fromRouter?.label ?? id,
        cooling: fromRouter?.state === 'cooling',
        cooldownMsLeft: fromRouter ? Math.max(0, fromRouter.cooldownUntil - Date.now()) : 0,
      };
    })(),
    model: lastModels.find((m) => m.current) ?? lastModels[0] ?? null,
    state: stateManager
      ? {
          deltas: stateManager.current.deltas.length,
          snapshots: 0,
          threaded: stateManager.threaded,
          bootTokens: stateManager.current.meta.bootTokenEstimate,
        }
      : null,
    compress: lastCompression
      ? {
          percent: savedPercent(lastCompression),
          tokensBefore: lastCompression.tokensBefore,
          tokensAfter: lastCompression.tokensAfter,
          cacheHit: lastCompression.cacheHit,
          tier: ((lastCompression as { t1?: { tier?: string } }).t1?.tier ?? 'T0') as 'T0' | 'T1',
          t1Reason: (lastCompression as { t1?: { reason?: string } }).t1?.reason,
        }
      : null,
    stream: {
      active: currentStreamId !== null,
      elapsedMs: currentStreamId !== null ? Date.now() - streamStartedAt : 0,
      lastMs: lastStreamMs,
      lastAt: lastStreamAt,
    },
  });

  let extRamWarned = false;
  const guardExtensionRam = (): void => {
    const capMb = cfg().get<number>('ramCap.extension', 1024);
    const rssMb = Math.round(process.memoryUsage().rss / 1048576);
    if (rssMb > capMb && !extRamWarned) {
      extRamWarned = true;
      write('warn', `extension host RSS ${rssMb} MB exceeds the ${capMb} MB cap (§2)`);
      void vscode.window.showWarningMessage(
        `AI Bridge: the extension host is using ${rssMb} MB, over the ${capMb} MB budget. Reloading the window usually reclaims it.`,
      );
    } else if (rssMb < capMb * 0.8) {
      extRamWarned = false;
    }
  };

  const renderStatus = () => {
    const m = meter();
    status.text = statusText(m);
    status.tooltip = new vscode.MarkdownString(statusTooltip(m));
    status.backgroundColor =
      phase === 'error' || blocked ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
  };

  const setPhase = (next: Phase, reason: string) => {
    phase = next;
    write(next === 'error' ? 'error' : 'info', `phase → ${next} (${reason})`);
    renderStatus();
  };

  const bridge = new BridgeProcess({
    extensionPath: context.extensionPath,
    port: cfg().get<number>('bridge.port', 47615),
    logLevel: cfg().get<string>('logLevel', 'info'),
    onLine: (line, stream) => {
      const stamp = new Date().toISOString().slice(11, 23);
      output.appendLine(stream === 'stderr' ? `${stamp} STDERR ${line}` : line);
    },
  });

  const client = new BridgeClient({ label: 'vscode-extension' });
  client.on('log', (level, message) => write(level, message));
  client.on('connecting', ({ host, port }) => write('info', `connecting ws://${host}:${port}`));
  client.on('disconnected', ({ code }) => {
    if (stopping) {
      write('info', `socket closed during shutdown (code ${code})`);
      return;
    }
    if (phase === 'ready') setPhase('error', `socket closed ${code}`);
  });

  /* ------------------------------------------------------------- panel */

  const panel = new ChatPanelProvider(context.extensionUri, write);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewType, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const setPanelStatus = (text: string, state: '' | 'ok' | 'busy' = '') => {
    panel.post({ type: 'status', text, ...(state ? { state } : {}) } as never);
  };

  const startTicker = () => {
    if (streamTicker) return;
    streamTicker = setInterval(() => renderStatus(), 200);
  };
  const stopTicker = () => {
    if (streamTicker) clearInterval(streamTicker);
    streamTicker = null;
  };

  /**
   * §5.1: detectLimit → boot → new page → inject. The preview is the editable
   * document from §5.13, shown on failover unless the user turns it off.
   */
  const rotateSession = async (trigger: 'limit' | 'manual'): Promise<RotationResult | null> => {
    const mgr = stateManager ?? (await startState());
    if (!mgr) {
      void vscode.window.showWarningMessage('AI Bridge: the state layer is not running, so there is no context to carry.');
      return null;
    }
    const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
    const previewMode = cfg().get<string>('rotation.preview', 'on-failover');
    const showPreview = previewMode === 'always' || (previewMode === 'on-failover' && trigger === 'limit');

    const rotator = new SessionRotator(
      {
        detectLimit: async () =>
          (await client.request({ op: 'ctl.limit', adapterId })) as {
            limited: boolean;
            kind?: string;
            resetAt?: number;
          },
        buildBoot: async () => {
          const boot = mgr.boot({ budgetTokens: eff.bootBudgetTokens });
          return { text: boot.text, tokens: boot.tokens, budgetTokens: boot.budgetTokens };
        },
        ...(showPreview
          ? {
              preview: async (bootText: string) => {
                // §5.13: editable document, then Inject / Cancel.
                const doc = await vscode.workspace.openTextDocument({ content: bootText, language: 'markdown' });
                await vscode.window.showTextDocument(doc, { preview: false });
                const pick = await vscode.window.showQuickPick(['Inject into a fresh chat', 'Cancel'], {
                  title: `Session rotation — boot ${mgr.current.meta.bootTokenEstimate}/4000 tokens (edit the document first if you want)`,
                });
                if (pick !== 'Inject into a fresh chat') return null;
                return doc.getText();
              },
            }
          : {}),
        newPage: async () => {
          const adapters = (await client.request({ op: 'ctl.adapters' })) as {
            adapters: Array<{ id: string; url: string }>;
          };
          const url = adapters.adapters.find((a) => a.id === adapterId)?.url ?? 'about:blank';
          const status = (await client.request({ op: 'ctl.status' })) as { browser: { tabs: Array<{ id: string }> } };
          for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
          const tab = (await client.request({ op: 'ctl.tab.open', url })) as { id: string };
          return { id: tab.id };
        },
        inject: async (bootText: string) => {
          const res = (await client.request({ op: 'ctl.prompt', adapterId, text: bootText }, 180_000)) as {
            text: string;
          };
          return res.text;
        },
        ack: (answer: string) => mgr.ack(answer),
        log: write,
      },
      { maxRetries: 1, showPreview },
    );

    setPanelStatus(trigger === 'limit' ? 'Provider limit hit — rotating session…' : 'Rotating session…', 'busy');
    const result = await rotator.rotate(trigger);
    write(
      result.contextPreserved ? 'info' : 'warn',
      `rotation (${trigger}): rotated=${result.rotated} preview=${result.previewShown} ack=${result.ackOk} tokens=${result.tokens} tab=${result.newTabId} — ${result.reason}`,
    );

    if (result.rotated && result.contextPreserved) {
      setPanelStatus(`Rotated — ${result.ackOk ? 'context preserved' : 'context incomplete'}`, 'ok');
      void vscode.window.showInformationMessage(
        `AI Bridge: rotated to a fresh chat; the new session restated the context (${result.tokens}/4000 tokens).`,
      );
    } else if (result.rotated) {
      setPanelStatus(`Rotated but context incomplete — ${result.missing.length} item(s) missing`, '');
      void vscode.window
        .showWarningMessage(
          `AI Bridge: rotated, but the fresh chat did not restate ${result.missing.length} item(s): ${result.missing.slice(0, 3).join('; ')}`,
          'Show Log',
        )
        .then((pick) => pick === 'Show Log' && output.show(true));
    } else {
      setPanelStatus(result.reason, '');
    }
    renderStatus();
    return result;
  };

  /** One prompt round trip: user bubble → streamed deltas → settled meta. */
  const runPrompt = async (text: string, opts: { afterRotation?: boolean } = {}): Promise<void> => {
    if (phase !== 'ready') {
      panel.post({ type: 'error', id: 'x', text: 'Bridge not ready — start it first.' });
      return;
    }
    const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
    const id = `m${++msgSeq}`;
    lastPromptText = text;

    // §5.7: attach repo context to the prompt when a folder is open.
    let outbound = text;
    const contextMode = cfg().get<'auto' | 'always' | 'off'>('repo.contextMode', 'auto');
    const relevance = contextWorthIt(text);
    if (repo && contextMode !== 'off' && (contextMode === 'always' || relevance.attach)) {
      try {
        const bundle = await repo.contextFor(text, {
          maxFiles: eff.repoMaxFiles,
          budgetTokens: eff.repoBudgetTokens,
        });
        if (bundle.files.length > 0) {
          outbound = `${bundle.text}\n\n---\n\nUser request: ${text}`;
          setPanelStatus(
            `Context: ${bundle.files.length} file(s), ~${bundle.tokens} tokens · streaming…`,
            'busy',
          );
          write(
            'info',
            `repo context attached: ${bundle.files.length} file(s), ~${bundle.tokens} tokens (${bundle.files.map((f) => f.path).join(', ')})`,
          );
        }
      } catch (err) {
        write('warn', `repo context failed: ${(err as Error).message}`);
      }
    } else if (repo && contextMode === 'auto' && !relevance.attach) {
      write('info', `repo context skipped: ${relevance.reason}`);
    }

    await recordTurn('user', text);

    // §5.6: T0 runs on every prompt. Boot injection is deliberately exempt —
    // that text is state and must arrive verbatim.
    let sent = outbound;
    let compression: { text: string; percent: number; tokensBefore: number; tokensAfter: number } | null = null;
    if (cfg().get<boolean>('compressor.enabled', true)) {
      const host = await startCompressor();
      if (host) {
        try {
          const compressOpts = {
            // §5.6: the Compressor tab's aliases win over the state's glossary.
            glossary: {
              ...(stateManager?.current.glossary ?? {}),
              ...(cfg().get<Record<string, string>>('compressor.glossary', {}) ?? {}),
            },
            budgetTokens: cfg().get<number>('compressor.budgetTokens', 4096),
          };
          const base = await host.compress(outbound, compressOpts);
          const tier = cfg().get<string>('compressor.tier', 'auto');
          const res =
            tier === 'T0' || !t1Compressor
              ? { ...base, t1: { tier: 'T0' as const, reason: tier === 'T0' ? 'tier set to T0' : (t1Gate?.reason ?? 'T1 not initialised') } }
              : await t1Compressor.compress(outbound, compressOpts, base);
          lastCompression = res;
          tokensSavedSession += Math.max(0, res.tokensBefore - res.tokensAfter);
          if (res.t1) {
            write(
              res.t1.tier === 'T1' ? 'info' : 'info',
              `compressor tier: ${res.t1.tier} — ${res.t1.reason}${res.t1.tookMs ? ` (${res.t1.tookMs} ms)` : ''}`,
            );
          }
          const percent = savedPercent(res);
          if (percent >= 5) {
            sent = res.text;
            compression = {
              text: res.text,
              percent,
              tokensBefore: res.tokensBefore,
              tokensAfter: res.tokensAfter,
            };
          }
          write(
            'info',
            `T0: ${res.tokensBefore}→${res.tokensAfter} tokens (⇣${percent}%) · ${res.protectedSpans} span(s) protected · ${res.dedupedLines} dup line(s)${res.cacheHit ? ' · cache hit' : ''}${res.overBudget ? ' · over budget' : ''}`,
          );
          if (res.flagged.length) write('info', `T0 flagged jargon: ${res.flagged.join(', ')}`);
          renderStatus();
        } catch (err) {
          write('warn', `T0 failed, sending uncompressed: ${(err as Error).message}`);
        }
      }
    }

    // One user bubble, carrying what was actually sent when T0 changed it.
    panel.post({ type: 'user', id: `u${id}`, text, ...(compression ? { compressed: compression } : {}) });
    panel.post({ type: 'assistant', id, text: '', streaming: true });

    currentStreamId = id;
    streamStartedAt = Date.now();
    startTicker();
    setPanelStatus(`Streaming from ${adapterId}…`, 'busy');
    write('info', `prompt → ${adapterId}: ${text.slice(0, 120)}`);

    try {
      const failover = cfg().get<boolean>('router.failover', true);
      const bootForFailover =
        failover && stateManager ? stateManager.boot({ budgetTokens: eff.bootBudgetTokens }).text : undefined;
      // §6.2 delta-only transport: only what changed since the last failover.
      const deltaText =
        failover && stateManager
          ? stateManager.current.deltas
              .slice(lastDeltaIndex)
              .slice(-20)
              .map((d) => `- [${d.op}] ${d.summary}`)
              .join('\n')
          : undefined;
      const res = (await client.request(
        {
          op: 'ctl.prompt',
          adapterId: failover ? 'auto' : adapterId,
          text: sent,
          ...(bootForFailover ? { boot: bootForFailover } : {}),
          ...(deltaText ? { delta: deltaText } : {}),
          debounceMs: cfg().get<number>('chat.debounceMs', 900),
        },
        cfg().get<number>('chat.timeoutMs', 180_000),
      )) as {
        text: string;
        firstTokenMs: number | null;
        totalMs: number;
        settledBy: string;
        adapterId?: string;
        switched?: Array<{ from: string; to: string; reason: string }>;
        bootChars?: number;
        bootAnswer?: string;
      };

      panel.post({
        type: 'done',
        id,
        meta: {
          firstTokenMs: res.firstTokenMs,
          totalMs: res.totalMs,
          settledBy: res.settledBy,
          chars: res.text.length,
        },
      });
      lastStreamMs = res.totalMs;
      lastStreamAt = Date.now();
      if (res.adapterId) {
        activeProviderId = res.adapterId;
        lastResponse[res.adapterId] = { ms: Math.round(res.totalMs), at: Date.now() };
      }

      // §5.9 / §6: a toast on every provider switch.
      if (res.adapterId) {
        // §6 Chat Panel: a visible marker on the message that came via failover.
        panel.post({
          type: 'marker',
          id,
          text:
            res.switched && res.switched.length > 0
              ? `failover → ${res.adapterId}`
              : undefined,
          provider: res.adapterId,
        });
      }
      if (res.switched && res.switched.length > 0) {
        const hops = res.switched.map((sw) => `${sw.from} → ${sw.to} (${sw.reason})`).join(', ');
        write('warn', `failover: ${hops}`);
        setPanelStatus(`Failover: ${hops}`, 'ok');
        void vscode.window.showWarningMessage(`AI Bridge: switched provider — ${hops}. Context carried across.`);
        failoverCount += res.switched.length;
        // The next failover only needs what happened after this one.
        lastDeltaIndex = stateManager?.current.deltas.length ?? lastDeltaIndex;
        if (res.bootAnswer) write('info', `new provider acknowledged the boot (${res.bootAnswer.length} chars)`);
      }
      setPanelStatus(
        `Settled in ${res.totalMs} ms${res.firstTokenMs != null ? ` (first token ${res.firstTokenMs} ms)` : ''} · ${res.settledBy}`,
        'ok',
      );
      write(
        'info',
        `✅ STREAM PROOF — ${res.text.length} chars · first token ${res.firstTokenMs ?? '—'} ms · total ${res.totalMs} ms · settled by ${res.settledBy}`,
      );

      await recordTurn('assistant', res.text);

      // §5.8: an answer may carry edit blocks; plan them and show a diff card.
      if (repo && cfg().get<boolean>('repo.edits', true)) {
        try {
          const card = await repo.propose(res.text, id);
          if (card) {
            panel.post({ type: 'proposal', id: card.id, card });
            if (!card.canApply) {
              void vscode.window.showWarningMessage(
                `AI Bridge: proposal has ${card.refusals.length} refusal(s) — review before accepting.`,
              );
            }
          }
        } catch (err) {
          write('error', `proposal planning failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      const message = (err as Error).message;

      // §5.1: a detected limit rotates the session and retries ONCE on the fresh
      // page — never twice, or a hard quota would spin.
      if (/ELIMIT/.test(message) && !opts.afterRotation && cfg().get<boolean>('rotation.enabled', true)) {
        write('warn', `limit hit — attempting a session rotation before giving up`);
        panel.post({ type: 'error', id, text: `${message}\n\nRotating to a fresh chat…` });
        const rotation = await rotateSession('limit');
        if (rotation?.rotated && rotation.contextPreserved) {
          currentStreamId = null;
          stopTicker();
          await runPrompt(text, { afterRotation: true });
          return;
        }
      }

      panel.post({ type: 'error', id, text: message });
      setPanelStatus(message, '');
      write('error', `prompt failed: ${message}`);
      void vscode.window.showErrorMessage(`AI Bridge: ${message}`);
    } finally {
      currentStreamId = null;
      stopTicker();
      renderStatus();
    }
  };

  panel.onMessage((msg: FromPanel) => {
    if (msg.type === 'send') void runPrompt(msg.text);
    if (msg.type === 'clear') panel.post({ type: 'reset' });
    if (msg.type === 'proposal.action') {
      void handleProposalAction(
        msg.id,
        msg.action,
        (msg as { decisionId?: string }).decisionId,
        (msg as { hunks?: string[] }).hunks,
      );
    }
  });

  const handleProposalAction = async (
    id: string,
    action: 'accept' | 'reject' | 'diff' | 'approve',
    decisionId?: string,
    hunks?: string[],
  ): Promise<void> => {
    if (!repo) {
      void vscode.window.showWarningMessage('AI Bridge: no workspace folder open.');
      return;
    }
    if (action === 'diff') {
      const shown = await repo.showDiff(id);
      if (!shown) write('warn', `diff requested for unknown proposal ${id}`);
      return;
    }
    if (action === 'approve') {
      const held = repo.heldFor(id).find((h) => h.decisionId === decisionId);
      if (!held) {
        write('warn', `approve requested for a decision that did not hold ${id}`);
        return;
      }
      // §6: every destructive action confirms. This one overrides a lock.
      const confirm = await vscode.window.showWarningMessage(
        `Override the locked decision "${held.what}" for ${held.path}?\n\nThis edit will remove text the decision protects. The override is recorded in the project state.`,
        { modal: true },
        'Override',
      );
      if (confirm !== 'Override') {
        write('info', `override of ${held.decisionId} cancelled by the user`);
        return;
      }
      const res = await repo.approve(id, held.decisionId);
      if (!res.card) {
        write('error', `approve failed: ${res.error}`);
        void vscode.window.showErrorMessage(`AI Bridge: ${res.error}`);
        return;
      }
      panel.post({ type: 'proposal', id, card: res.card });
      if (stateManager) {
        recordOverride(stateManager.current, { id: held.decisionId, what: held.what }, [held.path]);
        await stateManager.saveNow();
      }
      write(
        res.ok ? 'warn' : 'error',
        `override ${held.decisionId} applied to the plan — ${res.ok ? 'now applicable, awaiting Accept' : 'still refused, see the card'}`,
      );
      void vscode.window.showWarningMessage(
        res.ok
          ? `AI Bridge: plan re-evaluated with "${held.what}" waived. Press Accept to write it.`
          : 'AI Bridge: still refused after the override — another guard is blocking it.',
      );
      return;
    }

    if (action === 'reject') {
      const dropped = repo.reject(id);
      panel.post({
        type: 'proposal.result',
        id,
        ok: true,
        text: dropped ? 'Rejected — nothing was written.' : 'Already settled.',
      });
      write('info', `proposal ${id} rejected — workspace untouched`);
      return;
    }

    // §6: `hunks` is absent when the user kept every checkbox, and a list of
    // `path#index` keys when they unticked some.
    const res = await repo.accept(id, hunks);
    const subset = Array.isArray(hunks) ? ` (${hunks.length} hunk(s) selected)` : '';
    panel.post({
      type: 'proposal.result',
      id,
      ok: res.ok,
      text: res.ok ? `Applied ${res.applied} file(s)${subset} in one undo step.` : `Refused: ${res.error}`,
    });
    if (res.ok) {
      write('info', `✅ EDIT PROOF — applied ${res.applied} file(s) from ${id} as a single WorkspaceEdit${subset}`);
      void vscode.window.showInformationMessage(`AI Bridge: applied ${res.applied} file(s).`);
    } else {
      write('error', `apply refused: ${res.error}`);
      void vscode.window.showErrorMessage(`AI Bridge: ${res.error}`);
    }
  };

  /* ------------------------------------------------------------ events */

  client.on('event', (event: ControlEvent) => {
    switch (event.kind) {
      case 'ram.sample': {
        ram = event.data as RamSample;
        if (ramSamples.length % 10 === 0) void refreshRouter();
        ramSamples.push(ram.percent);
        if (ramSamples.length > 40) ramSamples.shift();
        SettingsPanel.refreshIfOpen();
        blocked = ram.level === 'block';
        renderStatus();
        break;
      }
      case 'ram.warn': {
        const d = event.data as {
          percent: number;
          afterPercent: number;
          evicted: string[];
          freedBytes: number;
          escalated?: boolean;
        };
        write(
          'warn',
          `RAM warn at ${d.percent}% — evicted ${d.evicted.length} idle tab(s), freed ${mb(d.freedBytes)} MB → ${d.afterPercent}%${d.escalated ? ' (recycled active tab)' : ''}`,
        );
        lastWarnAt = Date.now();
        void vscode.window
          .showWarningMessage(
            `AI Bridge: browser RAM at ${d.percent}% of cap. Freed ${mb(d.freedBytes)} MB${d.escalated ? ' by recycling the tab' : ''}.`,
            'Show Log',
            'Raise Cap',
          )
          .then((pick) => {
            if (pick === 'Show Log') output.show(true);
            if (pick === 'Raise Cap') void raiseCap();
          });
        break;
      }
      case 'ram.block': {
        const d = event.data as { percent: number; usedBytes: number; capBytes: number };
        blocked = true;
        write('error', `RAM cap reached (${d.percent}%) — requests blocked`);
        void vscode.window
          .showErrorMessage(
            `AI Bridge: browser RAM at ${mb(d.usedBytes)}/${mb(d.capBytes)} MB — requests are blocked until it drops.`,
            'Show Log',
            'Raise Cap',
          )
          .then((pick) => {
            if (pick === 'Show Log') output.show(true);
            if (pick === 'Raise Cap') void raiseCap();
          });
        break;
      }
      case 'ram.ok':
        blocked = false;
        write('info', 'RAM back under the warn line — unblocked');
        break;
      case 'attached': {
        browser = event.data as BrowserStatus;
        tabOpenedAt = browser.tabAgeMs > 0 ? Date.now() - browser.tabAgeMs : null;
        write(
          'info',
          `attached: ${browser.name} ${browser.version} on 127.0.0.1:${browser.port} · contexts=${browser.contexts}`,
        );
        break;
      }
      case 'detached': {
        const d = event.data as { reason: string; browserStillRunning?: boolean };
        browser = browser ? { ...browser, attached: false, tabs: [] } : null;
        tabOpenedAt = null;
        write('info', `detached (${d.reason})${d.browserStillRunning ? ' — browser left running' : ''}`);
        break;
      }
      case 'recycled': {
        const d = event.data as { reason: string; opened: string; count: number };
        tabOpenedAt = Date.now();
        write('info', `tab recycled (${d.reason}) → ${d.opened} · total ${d.count}`);
        break;
      }
      case 'stream.delta': {
        const d = event.data as { text: string; elapsedMs: number };
        if (currentStreamId) panel.post({ type: 'delta', id: currentStreamId, text: d.text });
        break;
      }
      case 'provider.switch': {
        const d = event.data as { from: string; to: string; reason: string };
        write('warn', `provider switch: ${d.from} → ${d.to} (${d.reason})`);
        break;
      }
      case 'boot.injected': {
        const d = event.data as { adapterId: string; chars: number };
        write('info', `boot injected into ${d.adapterId} (${d.chars} chars)`);
        break;
      }
      case 'stream.start':
      case 'stream.end':
        write('info', `${event.kind}: ${JSON.stringify(event.data).slice(0, 200)}`);
        break;
      case 'tab.opened':
        tabOpenedAt = Date.now();
        write('info', `${event.kind}: ${JSON.stringify(event.data)}`);
        break;
      case 'tab.closed':
      case 'gc':
        write('info', `${event.kind}: ${JSON.stringify(event.data)}`);
        break;
      default:
        break;
    }
    if (browser && event.kind !== 'ram.sample') void refreshStatus();
  });

  /* ------------------------------------------------------------ actions */

  const refreshStatus = async (): Promise<void> => {
    if (phase !== 'ready') return;
    try {
      const res = (await client.request({ op: 'ctl.status' })) as {
        browser: BrowserStatus;
        ram: RamSample | null;
        watchdog: { blocked: boolean };
      };
      browser = res.browser;
      if (res.ram) ram = res.ram;
      blocked = res.watchdog.blocked;
      tabOpenedAt = browser.attached && browser.tabAgeMs > 0 ? Date.now() - browser.tabAgeMs : null;
      renderStatus();
    } catch (err) {
      write('info', `status refresh failed: ${(err as Error).message}`);
    }
  };

  const raiseCap = async (): Promise<void> => {
    const current = cfg().get<number>('ramCap.browser', 500);
    const pick = await vscode.window.showInputBox({
      title: 'AI Bridge — browser RAM cap (MB)',
      value: String(current),
      validateInput: (v) => (/^\d+$/.test(v) && Number(v) >= 100 ? null : 'Enter a number ≥ 100'),
    });
    if (!pick) return;
    await cfg().update('ramCap.browser', Number(pick), vscode.ConfigurationTarget.Global);
    await client.request({ op: 'ctl.config', ramCapBytes: Number(pick) * 1024 * 1024 });
    write('info', `RAM cap raised to ${pick} MB`);
  };

  const attachBrowser = async (): Promise<void> => {
    const ports = cfg().get<number[]>('browser.ports', [9222, 9223]);
    write('info', `attaching via connectOverCDP — probing ports ${ports.join(', ')}`);
    try {
      const res = (await client.request({ op: 'ctl.attach', ports }, 20_000)) as {
        browser: BrowserStatus;
        ram: RamSample | null;
      };
      browser = res.browser;
      if (res.ram) ram = res.ram;
      tabOpenedAt = browser.attached && browser.tabAgeMs > 0 ? Date.now() - browser.tabAgeMs : null;
      lastError = null;
      renderStatus();
      write(
        'info',
        `✅ ATTACH PROOF — ${browser.name} ${browser.version} · port ${browser.port} · contexts ${browser.contexts} · tabs ${browser.tabs.length}`,
      );
      setPanelStatus(`Attached: ${browser.name} · ${browser.tabs.length} tab(s)`, 'ok');
      void vscode.window.showInformationMessage(
        `AI Bridge attached to ${browser.name} on 127.0.0.1:${browser.port}.`,
      );
    } catch (err) {
      const message = (err as Error).message;
      lastError = message;
      write('error', `attach failed: ${message}`);
      renderStatus();
      void vscode.window
        .showErrorMessage(`AI Bridge: ${message}`, 'Show Log')
        .then((pick) => pick === 'Show Log' && output.show(true));
    }
  };

  const detachBrowser = async (): Promise<void> => {
    try {
      const res = (await client.request({ op: 'ctl.detach' })) as {
        closedTabs: number;
        browserStillRunning: boolean;
      };
      browser = browser ? { ...browser, attached: false, tabs: [] } : null;
      tabOpenedAt = null;
      renderStatus();
      void vscode.window.showInformationMessage(
        `AI Bridge detached — closed ${res.closedTabs} bridge tab(s); your browser is still running.`,
      );
    } catch (err) {
      write('error', `detach failed: ${(err as Error).message}`);
    }
  };

  /**
   * Send a boot prompt into a FRESH tab and check the chat restated DOING/TODO
   * (§5.9's failover uses the same path; 2.3's ack retry builds on it).
   */
  const injectBoot = async (mgr: StateManager, bootText: string): Promise<void> => {
    if (phase !== 'ready') {
      void vscode.window.showWarningMessage('AI Bridge: attach a browser first.');
      return;
    }
    const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
    setPanelStatus('Injecting boot into a fresh chat…', 'busy');
    try {
      const adapters = (await client.request({ op: 'ctl.adapters' })) as {
        adapters: Array<{ id: string; url: string }>;
      };
      const target = adapters.adapters.find((a) => a.id === adapterId);
      const url = target?.url ?? 'about:blank';

      // A new chat: close the bridge's tabs, open one, then inject.
      const status = (await client.request({ op: 'ctl.status' })) as {
        browser: { tabs: Array<{ id: string }> };
      };
      for (const tab of status.browser.tabs) await client.request({ op: 'ctl.tab.close', tabId: tab.id });
      await client.request({ op: 'ctl.tab.open', url });

      panel.post({ type: 'user', id: `u${++msgSeq}`, text: '⟪boot prompt injected⟫' });
      const msgId = `m${++msgSeq}`;
      panel.post({ type: 'assistant', id: msgId, text: '', streaming: true });
      currentStreamId = msgId;
      streamStartedAt = Date.now();
      startTicker();

      // §2.3: bootstrap ack check, retried exactly once with a stricter prompt.
      const result = await bootstrapChat({
        boot: bootText,
        send: async (prompt) => {
          const res = (await client.request({ op: 'ctl.prompt', adapterId, text: prompt }, 180000)) as {
            text: string;
            firstTokenMs: number | null;
            totalMs: number;
            settledBy: string;
          };
          panel.post({
            type: 'done',
            id: msgId,
            meta: {
              firstTokenMs: res.firstTokenMs,
              totalMs: res.totalMs,
              settledBy: res.settledBy,
              chars: res.text.length,
            },
          });
          return res.text;
        },
        ack: (answer) => mgr.ack(answer),
        maxRetries: 1,
        log: write,
        onAttempt: (rec) => {
          write(
            'info',
            `boot attempt ${rec.attempt}: ${rec.answerChars} chars, ack ${rec.ok ? 'ok' : `missing ${rec.missing.length}`}`,
          );
        },
      });

      if (result.ok) {
        setPanelStatus(
          `Boot ack OK${result.retried ? ` on retry (attempt ${result.attempts})` : ''} — ${result.ack.found.length} item(s)`,
          'ok',
        );
        void vscode.window.showInformationMessage(
          `AI Bridge: the fresh chat restated all ${result.ack.found.length} DOING/TODO item(s)${result.retried ? ` (after a retry)` : ''}.`,
        );
      } else {
        setPanelStatus(`Boot ack failed after ${result.attempts} attempt(s)`, '');
        // The banner §2.3 asks for: what was missing, and a way to try again.
        void vscode.window
          .showWarningMessage(
            `AI Bridge: the fresh chat never restated the state after ${result.attempts} attempt(s). Missing: ${result.ack.missing.slice(0, 3).join('; ')}`,
            'Retry',
            'Show Log',
          )
          .then((pick) => {
            if (pick === 'Show Log') output.show(true);
            if (pick === 'Retry') void injectBoot(mgr, bootText);
          });
      }
    } catch (err) {
      write('error', `boot injection failed: ${(err as Error).message}`);
      setPanelStatus((err as Error).message, '');
      void vscode.window.showErrorMessage(`AI Bridge: ${(err as Error).message}`);
    } finally {
      currentStreamId = null;
      stopTicker();
      renderStatus();
    }
  };

  /* ----------------------------------------------------------- settings */

  const probeHealth = async (): Promise<string> => {
    if (phase !== 'ready') return 'Bridge not ready.';
    const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
    const report = (await client.request({ op: 'ctl.health', adapterId })) as {
      id: string;
      ready: boolean;
      limited: boolean;
      matches: Array<{ role: string }>;
    };
    lastHealth = [
      {
        id: report.id,
        label: adapterId,
        ready: report.ready,
        limited: report.limited,
        matches: report.matches.filter((m) => m.role).length,
      },
    ];
    write(
      report.ready ? 'info' : 'warn',
      `adapter health: ${adapterId} ready=${report.ready} limited=${report.limited} selectors=${lastHealth[0]?.matches ?? 0}`,
    );
    SettingsPanel.refreshIfOpen();
    return `Health: ${adapterId} ${report.ready ? 'ready' : 'not ready'}${report.limited ? ' (usage limit)' : ''}.`;
  };

  const panelSnapshot = (): PanelSnapshot => ({
    ramPercent: ram?.percent ?? null,
    ramUsedMb: ram ? Math.round(ram.browser.totalBytes / 1048576) : null,
    ramCapMb: ram ? Math.round(ram.capBytes / 1048576) : null,
    extMb: Math.round(process.memoryUsage().rss / 1048576),
    bootTokens: stateManager?.current.meta.bootTokenEstimate ?? null,
    deltas: stateManager?.current.deltas.length ?? null,
    indexedFiles: repo?.indexed ?? null,
    models: lastModels,
    bootBudget: eff.bootBudgetTokens,
    contextMode: cfg().get<'auto' | 'always' | 'off'>('repo.contextMode', 'auto'),
    router: routerSnapshot.map((p) => ({
      id: p.id,
      label: p.label,
      state: p.state,
      priority: p.priority ?? 99,
      cooldownMs: p.cooldownMs ?? 300000,
      health: p.state === 'cooling' ? 'red' : p.state === 'disabled' ? 'yellow' : lastResponse[p.id] ? 'green' : 'yellow',
      lastResponseMs: lastResponse[p.id]?.ms ?? null,
    })),
    snapshots: snapshotNames,
    health: lastHealth,
    t1: t1Gate ? { enabled: t1Gate.enable, reason: t1Gate.reason } : null,
  });

  let snapshotNames: string[] = [];
  const refreshSnapshots = async (): Promise<void> => {
    if (!stateManager) return;
    try {
      snapshotNames = (await stateManager.snapshots()).map((s) => s.name).slice(0, 10);
    } catch {
      snapshotNames = [];
    }
  };

  const openSettings = (): void => {
    SettingsPanel.show({
      extensionUri: context.extensionUri,
      log: write,
      snapshot: panelSnapshot,
      samples: () => ramSamples,
      onApplied: (key, value) => {
        void applySetting(key, value);
      },
      compressPreview: async (text) => {
        const host = await startCompressor();
        const res = host
          ? await host.compress(text, { glossary: stateManager?.current.glossary ?? {} })
          : compressT0(text, { glossary: stateManager?.current.glossary ?? {} });
        return {
          before: res.tokensBefore,
          after: res.tokensAfter,
          percent: savedPercent(res),
          text: res.text,
        };
      },
      actions: {
        attachBrowser: async () => {
          await attachBrowser();
          return `Attach attempted — see the Output log.`;
        },
        health: () => probeHealth(),
        snapshot: async () => {
          if (!stateManager) return 'State layer is not running.';
          const path_ = await stateManager.snapshot('manual');
          await refreshSnapshots();
          return `Snapshot written: ${path_.split('/').pop()}`;
        },
        restore: async (value) => {
          if (!stateManager) return 'State layer is not running.';
          const restored = await stateManager.restore(String(value));
          return `Restored ${restored.deltas.length} delta(s).`;
        },
        rescan: async () => {
          if (!stateManager) return 'State layer is not running.';
          const res = await stateManager.rescan();
          return `T3: ${res.files} file(s), +${res.added.length} −${res.removed.length}.`;
        },
        previewBoot: async () => {
          await vscode.commands.executeCommand('aiBridge.boot.preview');
          return 'Boot preview opened.';
        },
        clearState: async () => {
          await vscode.commands.executeCommand('aiBridge.state.clear');
          return 'Clear requested — confirm in the dialog.';
        },
        indexRepo: async () => {
          if (!repo) return 'No workspace folder.';
          const res = await repo.index();
          return `Indexed ${res.files} file(s) in ${res.tookMs} ms.`;
        },
        decisions: async () => {
          await vscode.commands.executeCommand('aiBridge.repo.decisions');
          return 'Locked decisions opened.';
        },
        gc: async () => {
          const res = (await client.request({ op: 'ctl.gc' })) as { pages: number };
          return `Collected garbage on ${res.pages} tab(s).`;
        },
        ramNow: async () => {
          const sample = (await client.request({ op: 'ctl.ram' })) as RamSample;
          ram = sample;
          ramSamples.push(sample.percent);
          if (ramSamples.length > 40) ramSamples.shift();
          renderStatus();
          return `Browser RAM ${Math.round(sample.browser.totalBytes / 1048576)} MB (${sample.percent}%).`;
        },
        t1Status: async () => {
          const gate = shouldEnableT1(os.totalmem(), {
            lowEndMode: cfg().get<'auto' | 'on' | 'off'>('t1.mode', 'auto'),
            minRamBytes: cfg().get<number>('t1.minRamGb', 8) * 1024 ** 3,
          });
          return `T1 ${gate.enable ? 'permitted' : 'off'} — ${gate.reason}`;
        },
        fetchModels: async () => {
          const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
          const res = (await client.request({ op: 'ctl.models', adapterId })) as {
            models: Array<{ id: string; label: string; isFree: boolean; current: boolean }>;
            current: { label: string; isFree: boolean } | null;
          };
          lastModels = res.models;
          SettingsPanel.refreshIfOpen();
          renderStatus();
          write(
            'info',
            `models for ${adapterId}: ${res.models.map((m) => `${m.label}${m.current ? '*' : ''}${m.isFree ? ' (free)' : ''}`).join(', ')}`,
          );
          return `${res.models.length} model(s)${res.current ? ` — current: ${res.current.label}${res.current.isFree ? ' (free)' : ''}` : ''}`;
        },
        previewRepo: async (value) => {
          const q = String(value ?? '').trim();
          if (!q) return 'Type a question first.';
          const mode = cfg().get<'auto' | 'always' | 'off'>('repo.contextMode', 'auto');
          const verdict = contextWorthIt(q);
          if (mode === 'off') return 'Context mode is off — nothing would be attached.';
          if (mode === 'auto' && !verdict.attach) return `Skip — ${verdict.reason}`;
          if (!repo) return 'No workspace folder open.';
          const bundle = await repo.contextFor(q, {
            maxFiles: eff.repoMaxFiles,
            budgetTokens: eff.repoBudgetTokens,
          });
          return `Attach ${bundle.files.length} file(s), ${bundle.tokens} tokens — ${verdict.reason}`;
        },
        routerConfigure: async (value) => {
          const v = (value ?? {}) as { id?: string; priority?: number; cooldownMs?: number };
          if (!v.id) return 'No provider given.';
          await client.request({
            op: 'ctl.router.configure',
            adapterId: v.id,
            ...(v.priority !== undefined ? { priority: v.priority } : {}),
            ...(v.cooldownMs !== undefined ? { cooldownMs: v.cooldownMs } : {}),
          });
          await refreshRouter();
          return `${v.id} updated${v.priority !== undefined ? ` → priority ${v.priority}` : ''}${v.cooldownMs !== undefined ? ` · cooldown ${v.cooldownMs} ms` : ''}`;
        },
        routerPrewarm: async () => {
          const res = (await client.request({ op: 'ctl.router.prewarm' })) as {
            warmed: string[];
            candidates: string[];
          };
          await refreshRouter();
          return res.warmed.length
            ? `Pre-warmed ${res.warmed.join(', ')}`
            : res.candidates.length
              ? `Candidates: ${res.candidates.join(', ')} (none opened)`
              : 'No provider is at 80% of its cooldown.';
        },
        routerStatus: async () => {
          const st = (await client.request({ op: 'ctl.router' })) as {
            strategy: string;
            backoff: string;
            providers: Array<{ id: string; state: string; cooldownProgress: number; failures: number }>;
            prewarm: string[];
          };
          const doc = await vscode.workspace.openTextDocument({
            content: JSON.stringify(st, null, 2),
            language: 'json',
          });
          await vscode.window.showTextDocument(doc, { preview: true });
          const summary = st.providers.map((p) => `${p.id}:${p.state}`).join(', ');
          write('info', `router: ${summary}`);
          return `Router — ${summary}`;
        },
        rotate: async () => {
          const res = await rotateSession('manual');
          return res ? `Rotation: ${res.reason}` : 'Rotation unavailable.';
        },
        compressStats: async () => {
          await vscode.commands.executeCommand('aiBridge.compress.stats');
          return 'Compression stats opened.';
        },
      },
    });
    void refreshSnapshots();
  };

  /** Settings that take effect immediately vs. those needing a restart. */
  const applySetting = async (key: string, value: unknown): Promise<void> => {
    const num = Number(value);
    switch (key) {
      case 'aiBridge.ramCap.browser':
        await client.request({ op: 'ctl.config', ramCapBytes: num * 1048576 }).catch(() => undefined);
        write('info', `RAM cap → ${num} MB`);
        renderStatus();
        return;
      case 'aiBridge.watchdog.pollMs':
        await client.request({ op: 'ctl.config', pollMs: num }).catch(() => undefined);
        write('info', `watchdog poll → ${num} ms`);
        return;
      case 'aiBridge.custom.providers':
        await pushCustomProviders();
        void vscode.window.showInformationMessage('AI Bridge: custom providers updated.');
        return;
      case 'aiBridge.ui.lowEndMode':
        refreshLowEnd();
        await initT1();
      await pushCustomProviders();
        renderStatus();
        void vscode.window.showInformationMessage(`AI Bridge: low-end mode ${lowEnd.active ? 'on' : 'off'} — ${lowEnd.reason}`);
        return;
      case 'aiBridge.ui.statusBar':
        if (value) status.show();
        else status.hide();
        return;
      case 'aiBridge.compressor.tier':
      case 'aiBridge.t1.mode':
      case 'aiBridge.t1.backend':
      case 'aiBridge.t1.model':
      case 'aiBridge.t1.minRamGb':
        await initT1();
      await pushCustomProviders();
        return;
      case 'aiBridge.bridge.port':
        void vscode.window.showInformationMessage(
          'AI Bridge: the port change applies when the bridge restarts (AI Bridge: Restart Bridge).',
        );
        return;
      case 'aiBridge.state.location':
      case 'aiBridge.state.encrypt':
        void vscode.window.showInformationMessage(
          'AI Bridge: state storage changes apply to new writes; reload the window to re-initialise.',
        );
        return;
      default:
        write('info', `setting applied: ${key} = ${JSON.stringify(value)}`);
    }
  };

  /** §1: hand the user's custom providers to the bridge. */
  const pushCustomProviders = async (): Promise<void> => {
    if (phase !== 'ready') return;
    const raw = cfg().get<unknown[]>('custom.providers', []);
    const providers = Array.isArray(raw) ? raw : [];
    try {
      const res = (await client.request({ op: 'ctl.providers.set', providers })) as {
        accepted: string[];
        rejected: Array<{ id: string; error: string }>;
      };
      if (providers.length > 0) {
        write(
          res.rejected.length ? 'warn' : 'info',
          `custom providers: ${res.accepted.length} accepted${res.rejected.length ? `, ${res.rejected.length} rejected (${res.rejected.map((r) => `${r.id}: ${r.error}`).join('; ')})` : ''}`,
        );
      }
      if (res.rejected.length) {
        void vscode.window.showWarningMessage(
          `AI Bridge: ${res.rejected.length} custom provider(s) rejected — ${res.rejected[0]!.error}`,
        );
      }
    } catch (err) {
      write('warn', `custom providers not applied: ${(err as Error).message}`);
    }
  };

  const refreshRouter = async (): Promise<void> => {
    if (phase !== 'ready') return;
    try {
      const st = (await client.request({ op: 'ctl.router' })) as {
        providers: Array<{
          id: string;
          label: string;
          state: string;
          cooldownUntil: number;
          priority?: number;
          cooldownMs?: number;
        }>;
      };
      routerSnapshot = st.providers;
      renderStatus();
    } catch {
      /* bridge not ready — the meter simply omits the provider line */
    }
  };

  const handshakeOnce = async (): Promise<void> => {
    setPhase('handshaking', 'reading lock + attach');
    try {
      const data = await client.connect();
      handshake = data;
      lastError = null;
      setPhase('ready', `handshake ok, pid ${data.bridge.pid}`);
      setPanelStatus('Bridge ready — attach a browser', 'ok');
      write(
        'info',
        `✅ HANDSHAKE PROOF — op=attach accepted · pid=${data.bridge.pid} · v${data.bridge.version} · protocol=v${data.bridge.protocol} · token=${data.tokenFingerprint} · caps=[${data.capabilities.join(', ')}]`,
      );
      // Push the configured caps before the first sample lands.
      await client
        .request({
          op: 'ctl.config',
          ramCapBytes: cfg().get<number>('ramCap.browser', 500) * 1024 * 1024,
          pollMs: cfg().get<number>('watchdog.pollMs', 3000),
        })
        .catch((err: Error) => write('warn', `cap push failed: ${err.message}`));

      if (cfg().get<boolean>('browser.autoAttach', true)) await attachBrowser();
      else await refreshStatus();
    } catch (err) {
      lastError = (err as Error).message;
      setPhase('error', lastError);
      void vscode.window.showErrorMessage(`AI Bridge: ${lastError}`, 'Show Log').then((pick) => {
        if (pick === 'Show Log') output.show(true);
      });
    }
  };

  const startAll = async (): Promise<void> => {
    if (phase === 'starting' || phase === 'handshaking') return;
    setPhase('starting', 'spawn');
    output.show(true);
    try {
      const info = await bridge.start();
      write('info', `bridge ready — port ${info.port}, pid ${info.pid}, lock ${info.lock}`);
      await handshakeOnce();
    } catch (err) {
      lastError = (err as Error).message;
      setPhase('error', lastError);
      void vscode.window.showErrorMessage(`AI Bridge failed to start: ${lastError}`);
    }
  };

  const stopAll = async (): Promise<void> => {
    stopping = true;
    write('info', 'stopping: detaching browser, closing socket, stopping bridge');
    try {
      if (phase === 'ready') {
        await client.request({ op: 'ctl.detach' }, 5000).catch(() => undefined);
      }
      client.close();
      handshake = null;
      browser = null;
      ram = null;
      await bridge.stop();
      setPhase('stopped', 'user requested stop');
    } finally {
      stopping = false;
    }
  };

  const redactedLock = (): string => {
    try {
      const { lock, mode, path } = require('@ai-bridge/shared').readLock() as {
        lock: Record<string, unknown>;
        mode: number;
        path: string;
      };
      return (
        JSON.stringify(
          { ...lock, token: `${String(lock.token).slice(0, 4)}…${String(lock.token).slice(-4)} (redacted)` },
          null,
          2,
        ) + `\n\npath: ${path}\nmode: 0${mode.toString(8)}`
      );
    } catch (err) {
      return `lock unavailable: ${(err as Error).message}`;
    }
  };

  // Batch 8.2 — appear in Copilot Chat, where this VS Code can host a provider.
  // On 1.90–1.103 there is no such API and this returns undefined; the extension
  // then behaves exactly as it did before the batch.
  const lmRegistration = registerAiBridgeLanguageModel({
    client: () => client as unknown as LmClient,
    log: (message) => write('info', message),
  });
  if (lmRegistration) context.subscriptions.push(lmRegistration);

  context.subscriptions.push(
    output,
    status,
    { dispose: () => {
        stopping = true;
        client.close();
      } },
    { dispose: () => void bridge.stop() },
    { dispose: () => void stateManager?.dispose() },
    { dispose: () => void compressor?.stop() },

    vscode.commands.registerCommand('aiBridge.bridge.start', async () => {
      await startAll();
    }),
    vscode.commands.registerCommand('aiBridge.bridge.stop', async () => {
      await stopAll();
    }),
    vscode.commands.registerCommand('aiBridge.bridge.restart', async () => {
      await stopAll();
      await startAll();
    }),
    vscode.commands.registerCommand('aiBridge.bridge.reconnect', async () => {
      client.close();
      await handshakeOnce();
    }),
    vscode.commands.registerCommand('aiBridge.bridge.showLog', () => {
      output.show(true);
    }),
    vscode.commands.registerCommand('aiBridge.browser.attach', async () => {
      if (phase !== 'ready') {
        void vscode.window.showWarningMessage('AI Bridge: start the bridge first.');
        return;
      }
      await attachBrowser();
    }),
    vscode.commands.registerCommand('aiBridge.browser.detach', async () => {
      await detachBrowser();
    }),
    vscode.commands.registerCommand('aiBridge.browser.recycle', async () => {
      try {
        const res = (await client.request({ op: 'recycle' })) as { closed: string; opened: { id: string } };
        write('info', `recycled ${res.closed} → ${res.opened?.id}`);
        void vscode.window.showInformationMessage('AI Bridge: tab recycled in the same context.');
      } catch (err) {
        void vscode.window.showErrorMessage(`AI Bridge: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('aiBridge.browser.gc', async () => {
      try {
        const res = (await client.request({ op: 'ctl.gc' })) as { pages: number };
        void vscode.window.showInformationMessage(`AI Bridge: garbage collected ${res.pages} tab(s).`);
      } catch (err) {
        void vscode.window.showErrorMessage(`AI Bridge: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('aiBridge.browser.status', async () => {
      await refreshStatus();
      const m = meter();
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(
          { text: statusText(m), tooltip: statusTooltip(m), browser, ram, blocked },
          null,
          2,
        ),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('aiBridge.diagnostics.report', async () => {
      // §7.2: opt-in, and explicit about what is and is not in the file.
      const go = await vscode.window.showWarningMessage(
        'Export a breakage report? It contains the adapter id, the host, the selectors that were tried, and the tag/attribute NAMES of the page region. It contains no conversation text, no URLs with paths, and no file paths.',
        { modal: true },
        'Export',
      );
      if (go !== 'Export') return;

      const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
      const diag = (await client.request({ op: 'ctl.diagnostics', adapterId }).catch((err: Error) => {
        write('error', `diagnostics failed: ${err.message}`);
        return null;
      })) as
        | {
            adapterId: string;
            host: string;
            matches: Array<{ role: string; matched: string; via: string }>;
            shape: { tags: string[]; attributeNames: string[]; counts: Record<string, number> } | null;
            bridgeVersion: string | null;
          }
        | null;
      if (!diag) {
        void vscode.window.showErrorMessage('AI Bridge: could not collect diagnostics — is the bridge attached?');
        return;
      }

      const broken = diag.matches.find((m) => m.via === 'none') ?? diag.matches[0];
      const report = buildReport({
        adapterId: diag.adapterId,
        url: diag.host,
        role: broken?.role ?? 'unknown',
        tried: diag.matches.filter((m) => m.via === 'none').map((m) => m.role),
        matched: broken?.matched || null,
        via: broken?.via ?? 'none',
        error: `ENOSELECTOR: ${broken?.role ?? 'unknown'} did not resolve`,
        extensionVersion: String(context.extension.packageJSON.version ?? '0.0.0'),
        bridgeVersion: diag.bridgeVersion ?? undefined,
        platform: `${process.platform}-${process.arch}`,
        nodeVersion: process.version,
        shape: diag.shape,
      });

      // Refuse to write if anything resembling the conversation slipped in.
      const guard = assertNoChatContent(report, [lastPromptText, lastPromptText.slice(0, 40)]);
      if (!guard.ok) {
        write('error', `breakage report blocked — chat content detected: ${guard.leaked.join(', ')}`);
        void vscode.window.showErrorMessage('AI Bridge: refusing to write a report that contains conversation text.');
        return;
      }

      const target = await vscode.window.showSaveDialog({
        saveLabel: 'Save breakage report',
        filters: { JSON: ['json'] },
        defaultUri: vscode.Uri.joinPath(
          context.globalStorageUri ?? context.extensionUri,
          `ai-bridge-breakage-${diag.adapterId}-${new Date().toISOString().slice(0, 10)}.json`,
        ),
      });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(report, null, 2), 'utf8'));
      write('info', `breakage report written: ${summarise(report)}`);
      void vscode.window.showInformationMessage(`AI Bridge: ${summarise(report)}`);
    }),
    vscode.commands.registerCommand('aiBridge.rotation.rotate', async () => {
      await rotateSession('manual');
    }),
    vscode.commands.registerCommand('aiBridge.rotation.status', async () => {
      const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
      const limit = (await client.request({ op: 'ctl.limit', adapterId }).catch(() => null)) as
        | { limited: boolean; kind?: string; resetAt?: number }
        | null;
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(
          {
            adapter: adapterId,
            limit,
            rotation: {
              enabled: cfg().get<boolean>('rotation.enabled', true),
              preview: cfg().get<string>('rotation.preview', 'on-failover'),
            },
            bootTokens: stateManager?.current.meta.bootTokenEstimate ?? null,
            doing: stateManager?.current.doing.length ?? null,
            todo: stateManager?.current.todo.length ?? null,
          },
          null,
          2,
        ),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('aiBridge.settings.open', () => {
      openSettings();
    }),
    vscode.commands.registerCommand('aiBridge.compress.preview', async () => {
      const text = await vscode.window.showInputBox({
        title: 'T0 compression preview',
        prompt: 'Text to compress (code fences, paths, URLs, constants and error lines are protected)',
        ignoreFocusOut: true,
      });
      if (!text) return;
      const host = await startCompressor();
      if (!host) return;
      const res = await host.compress(text, {
        glossary: stateManager?.current.glossary ?? {},
        budgetTokens: cfg().get<number>('compressor.budgetTokens', 4096),
      });
      lastCompression = res;
      renderStatus();
      const doc = await vscode.workspace.openTextDocument({
        content: [
          `T0 · ${res.tokensBefore} → ${res.tokensAfter} tokens (⇣${savedPercent(res)}%)`,
          `passes: ${res.passes.join(' → ')}`,
          `protected spans: ${res.protectedSpans} · deduped lines: ${res.dedupedLines} · glossary hits: ${res.glossaryHits}`,
          res.flagged.length ? `flagged jargon: ${res.flagged.join(', ')}` : '',
          '',
          '--- INPUT ---',
          text,
          '',
          '--- OUTPUT ---',
          res.text,
        ]
          .filter(Boolean)
          .join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      write('info', `T0 preview: ${res.tokensBefore}→${res.tokensAfter} (⇣${savedPercent(res)}%)`);
    }),
    vscode.commands.registerCommand('aiBridge.compress.t1Status', async () => {
      const backendKind = cfg().get<string>('t1.backend', 'ollama');
      const gate = shouldEnableT1(os.totalmem(), {
        lowEndMode: cfg().get<'auto' | 'on' | 'off'>('t1.mode', 'auto'),
        minRamBytes: cfg().get<number>('t1.minRamGb', 8) * 1024 ** 3,
      });
      const backend = backendKind === 'llamacpp'
        ? new LlamaCppCompressor({ modelPath: cfg().get<string>('t1.modelPath', '') }, write)
        : new OllamaCompressor(
            { url: cfg().get<string>('t1.url', 'http://127.0.0.1:11434'), model: cfg().get<string>('t1.model', 'llama3.2') },
            write,
          );
      const available = await backend.available().catch(() => false);
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(
          {
            totalMemoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(2)),
            gate: { enable: gate.enable, reason: gate.reason, minRamGB: cfg().get<number>('t1.minRamGb', 8) },
            mode: cfg().get<string>('t1.mode', 'auto'),
            tier: cfg().get<string>('compressor.tier', 'auto'),
            backend: { kind: backendKind, available, footprint: backend.footprint },
            lastTier: (lastCompression as { t1?: unknown } | null)?.t1 ?? null,
          },
          null,
          2,
        ),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      write('info', `T1 status: ${gate.enable ? 'permitted' : 'off'} — ${gate.reason}; backend ${backendKind} ${available ? 'available' : 'unavailable'}`);
    }),
    vscode.commands.registerCommand('aiBridge.compress.stats', async () => {
      const host = await startCompressor();
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(
          {
            threaded: host?.threaded ?? false,
            enabled: cfg().get<boolean>('compressor.enabled', true),
            tier: cfg().get<string>('compressor.tier', 'T0'),
            budgetTokens: cfg().get<number>('compressor.budgetTokens', 4096),
            last: lastCompression
              ? {
                  tokensBefore: lastCompression.tokensBefore,
                  tokensAfter: lastCompression.tokensAfter,
                  savedPercent: savedPercent(lastCompression),
                  protectedSpans: lastCompression.protectedSpans,
                  passes: lastCompression.passes,
                  flagged: lastCompression.flagged,
                  cacheHit: lastCompression.cacheHit,
                }
              : null,
          },
          null,
          2,
        ),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('aiBridge.boot.preview', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const boot = mgr.boot();
      write('info', `boot: ${boot.tokens}/${boot.budgetTokens} tokens, sections [${boot.sections.join(', ')}]`);

      const doc = await vscode.workspace.openTextDocument({ content: boot.text, language: 'markdown' });
      await vscode.window.showTextDocument(doc, { preview: false });
      const pick = await vscode.window.showQuickPick(['Inject into a fresh chat', 'Cancel'], {
        title: `Boot ${boot.tokens}/${boot.budgetTokens} tokens — edit the document first if you want`,
        placeHolder: 'Edits to the boot document are used as-is',
      });
      if (pick !== 'Inject into a fresh chat') {
        write('info', 'boot injection cancelled');
        return;
      }
      await injectBoot(mgr, doc.getText());
    }),
    vscode.commands.registerCommand('aiBridge.boot.inject', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      await injectBoot(mgr, mgr.boot().text);
    }),
    vscode.commands.registerCommand('aiBridge.state.rescan', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      try {
        const res = await mgr.rescan();
        write('info', `T3: ${res.files} file(s), +${res.added.length} −${res.removed.length} ~${res.changed.length}, dirtyHash ${res.dirtyHash}`);
        void vscode.window.showInformationMessage(
          `AI Bridge: rescan found ${res.files} file(s) — +${res.added.length} added, −${res.removed.length} gone, ${res.changed.length} changed.`,
        );
        renderStatus();
      } catch (err) {
        void vscode.window.showErrorMessage(`AI Bridge: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('aiBridge.state.t2', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const outcome = await mgr.runT2();
      const text = outcome.ran
        ? `T2 via ${outcome.backend} in ${outcome.tookMs} ms — ${JSON.stringify(outcome.counts)}`
        : `T2 did not run: ${outcome.reason}`;
      write(outcome.ran ? 'info' : 'warn', text);
      void vscode.window.showInformationMessage(`AI Bridge: ${text}`);
    }),
    vscode.commands.registerCommand('aiBridge.state.show', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(mgr.current, null, 2),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      write('info', `state: ${mgr.current.deltas.length} delta(s), ${mgr.current.files.length} file(s)`);
    }),
    vscode.commands.registerCommand('aiBridge.state.snapshots', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const snaps = await mgr.snapshots();
      const pick = await vscode.window.showQuickPick(
        snaps.map((s) => ({
          label: s.name,
          description: `${Math.round(s.bytes / 1024)} KB · ${new Date(s.mtimeMs).toLocaleString()}`,
        })),
        { title: 'AI Bridge — state snapshots', placeHolder: `${snaps.length} snapshot(s)` },
      );
      if (!pick) return;
      const restored = await mgr.restore(pick.label);
      void vscode.window.showInformationMessage(
        `AI Bridge: restored ${restored.deltas.length} delta(s) from ${pick.label}.`,
      );
      renderStatus();
    }),
    vscode.commands.registerCommand('aiBridge.state.snapshot', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const path_ = await mgr.snapshot('manual');
      void vscode.window.showInformationMessage(`AI Bridge: snapshot written to ${path_}.`);
    }),
    vscode.commands.registerCommand('aiBridge.state.clear', async () => {
      const mgr = stateManager ?? (await startState());
      if (!mgr) return;
      const ok = await vscode.window.showWarningMessage(
        'Clear the project state? Locked decisions and the glossary are kept; a snapshot is taken first.',
        { modal: true },
        'Clear',
      );
      if (ok !== 'Clear') return;
      await mgr.snapshot('pre-clear');
      await mgr.clear();
      renderStatus();
      void vscode.window.showInformationMessage('AI Bridge: state cleared.');
    }),
    vscode.commands.registerCommand('aiBridge.repo.attach', async () => {
      if (!repo) {
        void vscode.window.showWarningMessage('AI Bridge: open a folder first.');
        return;
      }
      const res = await repo.index();
      void vscode.window.showInformationMessage(
        `AI Bridge: indexed ${res.files} file(s) in ${res.tookMs} ms.`,
      );
    }),
    vscode.commands.registerCommand('aiBridge.repo.context', async () => {
      if (!repo) return;
      const bundle = await repo.contextFor(
        (await vscode.window.showInputBox({ title: 'Repo context — what are you working on?' })) ?? '',
      );
      const doc = await vscode.workspace.openTextDocument({
        content: bundle.text,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      write('info', `context preview: ${bundle.files.length} files, ~${bundle.tokens} tokens`);
    }),
    vscode.commands.registerCommand('aiBridge.repo.lock', async () => {
      const what = await vscode.window.showInputBox({
        title: 'Lock a decision',
        prompt: 'Text the AI must never remove (a line, a rule, a constant)',
        ignoreFocusOut: true,
      });
      if (!what) return;
      const why = (await vscode.window.showInputBox({ title: 'Why is this locked?' })) ?? 'locked by user';
      const pathsRaw = (await vscode.window.showInputBox({
        title: 'Paths this applies to (comma-separated, blank = every file)',
      })) ?? '';
      const paths = pathsRaw.split(',').map((p) => p.trim()).filter(Boolean);
      if (stateManager) {
        const d = lockDecision(stateManager.current, what, why, paths);
        await stateManager.saveNow();
        write('info', `locked decision ${d.id}: ${what}${paths.length ? ` (paths: ${paths.join(', ')})` : ''}`);
        void vscode.window.showInformationMessage(
          `AI Bridge: locked "${what}" in the project state. Edits that would remove it are held.`,
        );
        renderStatus();
      } else {
        const d = await decisions.add(what, why, paths);
        write('warn', `locked decision ${d.id} kept in the interim store — the state layer is not running`);
        void vscode.window.showInformationMessage(`AI Bridge: locked "${what}".`);
      }
    }),
    vscode.commands.registerCommand('aiBridge.repo.decisions', async () => {
      const list = stateManager ? stateManager.current.decisions : decisions.list();
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(list, null, 2),
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      write('info', `${list.length} locked decision(s)`);
    }),
    vscode.commands.registerCommand('aiBridge.chat.open', () => {
      panel.reveal();
    }),
    vscode.commands.registerCommand('aiBridge.chat.send', async () => {
      const text = await vscode.window.showInputBox({
        title: 'AI Bridge — send a prompt',
        prompt: 'Goes to the attached tab via the active adapter',
        ignoreFocusOut: true,
      });
      if (text && text.trim()) {
        panel.reveal();
        await runPrompt(text.trim());
      }
    }),
    vscode.commands.registerCommand('aiBridge.chat.health', async () => {
      try {
        const adapterId = cfg().get<string>('adapter.id', 'chatgpt');
        const report = (await client.request({ op: 'ctl.health', adapterId })) as {
          ready: boolean;
          limited: boolean;
          limitKind?: string;
          matches: Array<{ role: string; matched: string; via: string }>;
        };
        write(
          'info',
          `health ${adapterId}: ready=${report.ready} limited=${report.limited}${report.limitKind ? `(${report.limitKind})` : ''}`,
        );
        const doc = await vscode.workspace.openTextDocument({
          content: JSON.stringify(report, null, 2),
          language: 'json',
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err) {
        void vscode.window.showErrorMessage(`AI Bridge: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('aiBridge.bridge.showLock', async () => {
      const doc = await vscode.workspace.openTextDocument({ content: redactedLock(), language: 'json' });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('aiBridge.bridge.diagnostics', async () => {
      const report = [
        `phase: ${phase}`,
        `bridge running: ${bridge.running}`,
        `handshake: ${handshake ? JSON.stringify(handshake) : 'none'}`,
        `browser: ${browser ? `${browser.name} ${browser.version} port=${browser.port} tabs=${browser.tabs.length}` : 'none'}`,
        `repo: ${repo ? `${repo.indexed} files indexed, ${repo.pendingCount()} pending proposal(s)` : 'no folder'}`,
        `locked decisions: ${decisions.list().length}`,
        `state: ${stateManager ? `${stateManager.current.deltas.length} deltas, ${stateManager.turnCount} turns, T1 ${stateManager.threaded ? 'worker' : 'inline'}` : 'not started'}`,
        `boot: ${stateManager ? `${stateManager.current.meta.bootTokenEstimate} tokens` : 'n/a'}`,
        `T2: ${stateManager ? `${stateManager.lastT2Outcome.backend}${stateManager.lastT2Outcome.ran ? '' : ' (idle)'}` : 'n/a'}`,
        `T0: ${lastCompression ? `${lastCompression.tokensBefore}→${lastCompression.tokensAfter} tokens (⇣${savedPercent(lastCompression)}%)` : 'not run'}`,
        `T1: ${t1Gate ? `${t1Gate.enable ? 'permitted' : 'off'} — ${t1Gate.reason}` : 'not evaluated'}`,
        `failovers this session: ${failoverCount}`,
        `low-end: ${lowEnd.active ? 'ON' : 'off'} — ${lowEnd.reason}`,
        `effective: boot ${eff.bootBudgetTokens} tok · repo ${eff.repoMaxFiles} files · T1 ${eff.t1Allowed ? 'allowed' : 'off'}`,
        `compression: saved ${tokensSavedSession} token(s) this session`,
        `ram: ${ram ? `${mb(ram.browser.totalBytes)}/${mb(ram.capBytes)} MB (${ram.percent}%, ${ram.browser.source})` : 'none'}`,
        `blocked: ${blocked}`,
        `last error: ${lastError ?? 'none'}`,
        `vscode: ${vscode.version}`,
        `node: ${process.version}`,
        `platform: ${process.platform} ${process.arch}`,
      ].join('\n');
      await vscode.env.clipboard.writeText(report);
      void vscode.window.showInformationMessage('AI Bridge diagnostics copied to clipboard.');
    }),
  );

  write('info', `AI Bridge v0.8.0 activated — extension path ${context.extensionPath}`);
  renderStatus();

  refreshLowEnd();

  if (cfg().get<boolean>('compressor.enabled', true)) {
    void startCompressor();
  }

  if (cfg().get<boolean>('state.autostart', true)) {
    void startState();
  }

  if (cfg().get<boolean>('bridge.autostart', true)) {
    void startAll();
  } else {
    setPhase('stopped', 'autostart disabled — run "AI Bridge: Start Bridge"');
  }
}

export function deactivate(): void {
  /* disposal handled through context.subscriptions */
}

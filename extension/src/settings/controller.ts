/**
 * Settings controller — the cmd-response half of §5.12, with no `vscode` import
 * so the whole protocol can be driven headlessly.
 *
 * The webview sends commands; this validates, writes (debounced), and replies.
 * Validation lives here and only here: the webview renders whatever error it is
 * given, so "invalid → inline error" cannot drift between UI and model.
 */

import {
  FIELDS,
  fieldByKey,
  flatValues,
  readSettings,
  validateField,
  fieldsFor,
  type FieldSpec,
  type TabId,
} from './fields';

export interface SettingsHost {
  get(key: string, dflt: unknown): unknown;
  update(key: string, value: unknown): Promise<void>;
}

export type FromPanel =
  | { type: 'cmd'; cmd: 'ready' }
  | { type: 'cmd'; cmd: 'set'; key: string; value: unknown }
  | { type: 'cmd'; cmd: 'resetTab'; tab: TabId }
  | { type: 'cmd'; cmd: 'action'; action: string; value?: unknown };

export interface PanelSnapshot {
  ramPercent: number | null;
  ramUsedMb: number | null;
  ramCapMb: number | null;
  extMb?: number | null;
  bootTokens: number | null;
  deltas: number | null;
  indexedFiles: number | null;
  snapshots: string[];
  health: Array<{ id: string; label: string; ready: boolean; limited: boolean; matches: number }>;
  t1: { enabled: boolean; reason: string } | null;
  models?: Array<{ id: string; label: string; isFree: boolean; current: boolean }>;
  /** For the State tab's boot preview. */
  bootBudget?: number;
  /** For the Repo tab's context preview. */
  contextMode?: 'auto' | 'always' | 'off';
  /**
   * Batch 9.4 — the web-chat cascade. Which rung is answering for each provider,
   * and how often it had to step down. Endpoints have no rungs, so they are not
   * listed here.
   */
  rungs?: Array<{ id: string; rung: string | null; answered: number; fellThrough: number }>;
  /**
   * Batch 9.2 — endpoint status. Makes a rejected key or a dead endpoint visible
   * in the panel instead of only in the log.
   */
  endpoints?: Array<{
    id: string;
    label: string;
    signedIn: boolean;
    models: number;
    lastError?: string | null;
  }>;
  /** §5.9 Router tab: drag reorder (priority), cooldowns, health. */
  router?: Array<{
    id: string;
    label: string;
    state: string;
    priority: number;
    cooldownMs: number;
    health: 'green' | 'yellow' | 'red';
    lastResponseMs?: number | null;
  }>;
}

export type ToPanel =
  | { type: 'state'; values: Record<string, unknown>; errors: Record<string, string | null>; samples: number[]; snapshot: PanelSnapshot }
  | { type: 'validation'; key: string; error: string | null; value?: unknown }
  | { type: 'status'; text: string }
  | { type: 'preview'; before: number; after: number; percent: number; text: string }
  | { type: 'samples'; samples: number[] };

export interface ControllerDeps {
  host: SettingsHost;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Called after a successful write so the extension can apply the change. */
  onApplied?: (key: string, value: unknown) => void;
  snapshot?: () => PanelSnapshot;
  samples?: () => number[];
  actions?: Record<string, (value?: unknown) => Promise<string | void> | string | void>;
  compressPreview?: (text: string) => Promise<{ before: number; after: number; percent: number; text: string }>;
  /** Coalesce writes; 0 writes immediately (used by tests). */
  debounceMs?: number;
}

const EMPTY_SNAPSHOT: PanelSnapshot = {
  ramPercent: null,
  ramUsedMb: null,
  ramCapMb: null,
  bootTokens: null,
  deltas: null,
  indexedFiles: null,
  snapshots: [],
  health: [],
  t1: null,
};

export class SettingsController {
  private readonly errors: Record<string, string | null> = {};
  private readonly pending = new Map<string, { value: unknown; timer: NodeJS.Timeout | null }>();
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {}

  /** Flat current values, defaults filled in. */
  values(): Record<string, unknown> {
    return flatValues((key, dflt) => this.deps.host.get(key, dflt));
  }

  /** The nested §4 Settings as configured right now. */
  settings() {
    return readSettings((key, dflt) => this.deps.host.get(key, dflt));
  }

  currentErrors(): Record<string, string | null> {
    return { ...this.errors };
  }

  state(): ToPanel {
    return {
      type: 'state',
      values: this.values(),
      errors: this.currentErrors(),
      samples: this.deps.samples?.() ?? [],
      snapshot: this.deps.snapshot?.() ?? EMPTY_SNAPSHOT,
    };
  }

  /** One inbound command → the messages to send back. */
  async handle(msg: FromPanel): Promise<ToPanel[]> {
    if (msg.type !== 'cmd') return [];
    switch (msg.cmd) {
      case 'ready':
        return [this.state()];

      case 'set':
        return this.set(msg.key, msg.value);

      case 'resetTab': {
        const fields = fieldsFor(msg.tab);
        const replies: ToPanel[] = [];
        for (const f of fields) {
          if (f.readOnly) continue;
          await this.write(f, f.default);
          this.errors[f.key] = null;
        }
        this.deps.log?.('info', `settings: reset tab "${msg.tab}" to defaults (${fields.length} field(s))`);
        return [...replies, { type: 'status', text: `Reset ${msg.tab} to defaults.` }, this.state()];
      }

      case 'action': {
        // Built-in actions that need their own reply shape run before the
        // registry lookup, otherwise an action without a registered handler is
        // rejected as unknown.
        if (msg.action === 'compressPreview') {
          const text = String(msg.value ?? '');
          if (!this.deps.compressPreview) {
            return [{ type: 'status', text: 'Compression is unavailable.' }];
          }
          try {
            const preview = await this.deps.compressPreview(text);
            return [{ type: 'preview', ...preview }];
          } catch (err) {
            return [{ type: 'status', text: `Preview failed: ${(err as Error).message}` }];
          }
        }

        const handler = this.deps.actions?.[msg.action];
        if (!handler) {
          return [{ type: 'status', text: `Unknown action: ${msg.action}` }];
        }
        try {
          const status = await handler(msg.value);
          return [
            ...(status ? [{ type: 'status' as const, text: status }] : []),
            this.state(),
          ];
        } catch (err) {
          this.deps.log?.('error', `settings action ${msg.action} failed: ${(err as Error).message}`);
          return [{ type: 'status', text: `${msg.action} failed: ${(err as Error).message}` }, this.state()];
        }
      }

      default:
        return [];
    }
  }

  /** Validate, then write (debounced). Returns the replies to send. */
  private async set(key: string, raw: unknown): Promise<ToPanel[]> {
    const spec = fieldByKey(key);
    if (!spec) return [{ type: 'validation', key, error: `Unknown setting: ${key}` }];
    if (spec.readOnly) {
      return [{ type: 'validation', key, error: `${spec.label} is fixed by the contract.` }];
    }

    const result = validateField(spec, raw);
    if (!result.ok) {
      this.errors[key] = result.error;
      this.deps.log?.('warn', `settings: rejected ${key} (${JSON.stringify(raw)}) — ${result.error}`);
      return [{ type: 'validation', key, error: result.error }];
    }

    this.errors[key] = null;
    await this.write(spec, result.value);
    return [{ type: 'validation', key, error: null, value: result.value }];
  }

  private async write(spec: FieldSpec, value: unknown): Promise<void> {
    const debounce = this.deps.debounceMs ?? 0;
    if (debounce <= 0) {
      await this.deps.host.update(spec.key, value);
      this.deps.onApplied?.(spec.key, value);
      return;
    }

    // Coalesce rapid typing into one write.
    const existing = this.pending.get(spec.key);
    if (existing?.timer) clearTimeout(existing.timer);
    const entry = {
      value,
      timer: setTimeout(() => {
        void this.flush(spec.key);
      }, debounce),
    };
    this.pending.set(spec.key, entry);
  }

  private async flush(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    const spec = fieldByKey(key);
    if (!spec) return;
    await this.deps.host.update(spec.key, entry.value);
    this.deps.log?.('info', `settings: ${key} = ${JSON.stringify(entry.value)}`);
    this.deps.onApplied?.(key, entry.value);
  }

  /** Write any still-debounced values immediately (called on dispose). */
  async flushAll(): Promise<void> {
    for (const key of [...this.pending.keys()]) {
      const entry = this.pending.get(key);
      if (entry?.timer) clearTimeout(entry.timer);
      await this.flush(key);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.flushAll();
  }
}

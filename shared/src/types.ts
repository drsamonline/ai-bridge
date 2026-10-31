/**
 * AI Bridge — shared contracts (spec §4).
 *
 * FIELD NAMES AND SHAPES ARE FROZEN. Do not rename fields, do not widen the
 * unions. Every consumer (extension, bridge, adapters, tests) compiles against
 * this file and nothing else.
 */

/* ------------------------------------------------------------------ *
 * Project state
 * ------------------------------------------------------------------ */

export interface ProjectState {
  v: 3;
  id: string;
  repo: { root: string; commit: string | null; dirtyHash: string };
  stack: string[];
  decisions: LockedDecision[];
  constraints: string[];
  done: Task[];
  doing: Task[];
  todo: Task[];
  files: TrackedFile[];
  glossary: Record<string, string>;
  deltas: Delta[]; // cap 200
  meta: { updatedAt: number; bootTokenEstimate: number };
}

export interface LockedDecision {
  id: string;
  what: string;
  why: string;
  locked: true;
}

export interface Task {
  id: string;
  task: string;
  files: string[];
  depends?: string[];
  state?: string;
}

export interface TrackedFile {
  path: string;
  role: string;
  sha: string;
  touchedBy: string[];
}

export interface Delta {
  t: number;
  op: 'edit' | 'add' | 'delete' | 'decide' | 'failover';
  path?: string;
  summary: string;
}

/** Runtime cap on `ProjectState.deltas` (spec §4). */
export const DELTA_CAP = 200;

/* ------------------------------------------------------------------ *
 * Adapters
 * ------------------------------------------------------------------ */

/**
 * Structural stand-in for playwright-core's `Page`.
 *
 * The CDP controller (batch 0.2) will replace this alias with the real
 * `import type { Page } from 'playwright-core'`. It is declared here, and only
 * here, so that batch 0.1 can compile the contract without pulling a browser
 * driver into the extension host bundle.
 */
export interface Page {
  /** playwright-core `Page` subset used by adapters. */
  close(): Promise<void>;
  url(): string;
}

export interface Adapter {
  id: string;
  url: string;
  selectors: SelectorConfig;
  connect(p: Page): Promise<void>;
  isReady(p: Page): Promise<boolean>;
  detectLimit(
    p: Page,
  ): Promise<{ limited: boolean; kind?: 'quota' | 'rate' | 'error'; resetAt?: number }>;
  sendPrompt(p: Page, text: string): Promise<void>;
  observeResponse(p: Page, opts: { debounceMs: number }): Promise<string>;
  extractContext(p: Page): Promise<Delta[]>;
  injectContext(p: Page, boot: string): Promise<void>;
  fetchModels(p: Page): Promise<ModelInfo[]>; // NEW
}

export interface ModelInfo {
  id: string;
  label: string;
  isFree: boolean;
  current: boolean;
}

export interface SelectorConfig {
  primary: string;
  fallbacks: string[];
  accessibility: string | null;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export interface Settings {
  ramCap: { browser: number; extension: number }; // 500 / 1024
  providers: Array<{ id: string; enabled: boolean; priority: number; cooldownMs: number }>;
  router: { strategy: 'priority' | 'round-robin'; retries: number; backoff: 'exponential' | 'linear' };
  compressor: { enabled: boolean; tier: 'T0' | 'T1' | 'auto'; budgetTokens: number; protectCode: true };
  state: { location: 'workspace' | 'global'; maxSnapshots: number; encrypt: boolean };
  ui: { statusBar: boolean; showCompressionPreview: boolean; lowEndMode: 'auto' | 'on' | 'off' };
  bridge: { port: number; autostart: boolean };
}

/* ------------------------------------------------------------------ *
 * Wire protocol
 * ------------------------------------------------------------------ */

export type BridgeMsg =
  | {
      op: 'attach';
      port: number;
      /**
       * Batch 9.5 — only the TCP fallback needs it. A peer that reached the local
       * socket is already authorised by the socket's own permissions.
       */
      token?: string;
    }
  | { op: 'navigate'; adapterId: string; url: string }
  | { op: 'send'; adapterId: string; text: string }
  | { op: 'observe'; adapterId: string; debounceMs: number }
  | { op: 'extract'; adapterId: string }
  | { op: 'inject'; adapterId: string; text: string }
  | { op: 'models'; adapterId: string }
  | { op: 'health'; adapterId: string }
  | { op: 'recycle' }
  | { op: 'result'; id: string; ok: boolean; data?: unknown; error?: string };

export type BridgeOp = BridgeMsg['op'];

/**
 * Transport envelope.
 *
 * `rid` is an ADDITIVE correlation field: the spec's messages carry no request
 * id, but every request needs one so that `{ op: 'result', id }` can be matched
 * to its call. No spec field is renamed or re-typed — `rid` sits alongside them
 * and is stripped before an adapter ever sees the message.
 */
export type WireMsg = BridgeMsg & { rid?: string };

/** Ops that batch 0.1 actually implements. Anything else answers ENOTIMPL. */
export const IMPLEMENTED_OPS: readonly BridgeOp[] = ['attach', 'result', 'recycle'] as const;

export function isBridgeMsg(value: unknown): value is WireMsg {
  if (typeof value !== 'object' || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return typeof op === 'string' && BRIDGE_OPS.includes(op as BridgeOp);
}

export const BRIDGE_OPS: readonly BridgeOp[] = [
  'attach',
  'navigate',
  'send',
  'observe',
  'extract',
  'inject',
  'models',
  'health',
  'recycle',
  'result',
];

/** Default `Settings` (§4) — the single source of truth for defaults. */
export const DEFAULT_SETTINGS: Settings = {
  ramCap: { browser: 500, extension: 1024 },
  providers: [],
  router: { strategy: 'priority', retries: 2, backoff: 'exponential' },
  compressor: { enabled: true, tier: 'auto', budgetTokens: 4096, protectCode: true },
  state: { location: 'workspace', maxSnapshots: 10, encrypt: true },
  ui: { statusBar: true, showCompressionPreview: true, lowEndMode: 'auto' },
  bridge: { port: 47615, autostart: true },
};

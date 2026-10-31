/**
 * Control plane — batch 0.2.
 *
 * §4's `BridgeMsg` union is frozen and has no message that expresses "attach
 * the bridge to the browser", "report RAM", or "open/close a tab". Rather than
 * rename or widen it, the browser-side operations live in this SECOND union,
 * namespaced `ctl.*` so a future §4 op can never collide with one of these.
 *
 * `{ op: 'recycle' }` stays in §4 and is implemented against this controller —
 * no duplicate is declared here.
 */

import type { BridgeMsg } from './types';

export const CTL_PREFIX = 'ctl.' as const;

export interface BrowserCandidate {
  port: number;
  name: string;
  version: string;
  protocol: string;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  ageMs: number;
  idleMs: number;
  turns: number;
}

export interface BrowserStatus {
  attached: boolean;
  port: number | null;
  name: string;
  version: string;
  protocol: string;
  /** Contexts on the attached browser; reused, never recreated. */
  contexts: number;
  /** Tabs this bridge opened. Pre-existing user tabs are never listed or closed. */
  tabs: TabInfo[];
  tabAgeMs: number;
  turns: number;
  recycled: number;
  lastRecycleReason: string | null;
  candidates: BrowserCandidate[];
}

/**
 * Which metric the RSS number actually is. Only `procfs-pss` is a true
 * footprint; `procfs-rss*` are upper bounds because a shared page is counted in
 * every process that maps it.
 */
export type MemorySource =
  | 'procfs-pss'
  | 'procfs-rss-adj'
  | 'procfs-rss'
  | 'ps'
  | 'powershell'
  | 'unavailable';

export interface BrowserMemory {
  totalBytes: number;
  rendererBytes: number;
  processCount: number;
  source: MemorySource;
  /** pid -> bytes, for the Performance tab in batch 7.1. */
  byPid: Record<number, number>;
}

export interface RamSample {
  t: number;
  browser: BrowserMemory;
  capBytes: number;
  percent: number;
  level: RamLevel;
}

export type RamLevel = 'ok' | 'warn' | 'block';

export interface ProviderStatus {
  id: string;
  label: string;
  priority: number;
  state: 'ready' | 'cooling' | 'disabled';
  cooldownUntil: number;
  failures: number;
  lastUsed: number;
  limitedKind?: string;
  cooldownProgress: number;
}

export interface PromptResult {
  adapterId: string;
  text: string;
  /** Milliseconds from send to the first non-empty delta. */
  firstTokenMs: number | null;
  totalMs: number;
  settledBy: 'sentinel' | 'stop-gone' | 'debounce' | 'timeout' | 'no-stream';
  tabId: string | null;
  turns: number;
  /** Characters of boot (+delta) injected on a failover. */
  bootChars?: number;
  /** What the new provider said when it received the boot (first 2 000 chars). */
  bootAnswer?: string;
  /** Providers the request was moved away from (failover chain). */
  switched?: Array<{ from: string; to: string; reason: string }>;
}

export interface AdapterHealthReport {
  id: string;
  label: string;
  url: string;
  ready: boolean;
  limited: boolean;
  limitKind?: 'quota' | 'rate' | 'error';
  matches: Array<{ role: string; matched: string; via: string }>;
}

export type ControlMsg =
  | { op: 'ctl.attach'; ports?: number[] }
  | { op: 'ctl.detach' }
  | { op: 'ctl.status' }
  | { op: 'ctl.ram' }
  | { op: 'ctl.tab.open'; url?: string }
  | { op: 'ctl.tab.close'; tabId?: string }
  | { op: 'ctl.turn'; tabId?: string; n?: number }
  | { op: 'ctl.gc' }
  | { op: 'ctl.config'; ramCapBytes?: number; warnRatio?: number; blockRatio?: number; pollMs?: number }
  | { op: 'ctl.adapters' }
  | { op: 'ctl.health'; adapterId: string }
  | { op: 'ctl.limit'; adapterId: string }
  | {
      op: 'ctl.prompt';
      /** 'auto' (or omitted) walks the router chain with failover (§5.9). */
      adapterId?: string;
      text: string;
      /** Boot prompt injected into a provider on failover, so context follows. */
      boot?: string;
      /** §6.2 delta-only: changes since the boot was built, appended to it. */
      delta?: string;
      debounceMs?: number;
      timeoutMs?: number;
    }
  | { op: 'ctl.models'; adapterId: string }
  | { op: 'ctl.diagnostics'; adapterId: string; selector?: string }
  | { op: 'ctl.providers.set'; providers: unknown[] }
  | { op: 'ctl.router' }
  | { op: 'ctl.router.clear'; adapterId?: string }
  | {
      op: 'ctl.router.configure';
      adapterId: string;
      priority?: number;
      cooldownMs?: number;
      enabled?: boolean;
    }
  | { op: 'ctl.router.prewarm' }
  /* ------------------------------------------------------------------ *
   * Batch 8 — OpenAI-compatible API endpoints.
   *
   * These live here, not in §4's `BridgeMsg`, for the reason this union
   * exists at all: a new operation must never collide with a frozen one.
   * `Settings` is not widened either — endpoint config travels in the
   * payload, and keys are never persisted by the bridge.
   * ------------------------------------------------------------------ */
  | {
      op: 'ctl.api.providers.set';
      providers: unknown[];
      /** Held in memory only. Durable storage is the extension's job (8.0b). */
      keys?: Record<string, string>;
    }
  | { op: 'ctl.api.models'; providerId?: string }
  | { op: 'ctl.api.status' }
  /**
   * Batch 8.1 — one assembled answer from an API endpoint: text and reasoning
   * stream as events, a tool call arrives whole with typed arguments.
   */
  | {
      op: 'ctl.api.prompt';
      /** Namespaced model id: `custom:<providerId>/<model>`. */
      model: string;
      messages: Array<{
        role: string;
        /** A string, or parts when the message carries an image (batch 9.1). */
        content:
          | string
          | Array<{ type: string; text?: string; image_url?: { url: string } }>;
        toolCallId?: string;
        /** Batch 8.1b: the assistant turn's own calls, so results can answer them. */
        toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      }>;
      tools?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
      /** Tools travel as prompt text when the endpoint has no tools API. */
      promptToolProtocol?: boolean;
      maxTokens?: number;
      temperature?: number;
      /** Lets the caller cancel this request by id (batch 8.4). */
      requestId?: string;
    }
  /** Batch 8.4 — stop an in-flight endpoint request at the upstream. */
  | { op: 'ctl.api.cancel'; requestId: string }
  /**
   * Batch 9.0 — the fast path.
   *
   * No template ships with the extension: each one is a provider's private
   * request shape, which none of them documents. A template is configuration the
   * user adds, and it stays disabled until they do.
   */
  | { op: 'ctl.fastpath.set'; templates: unknown[] }
  | { op: 'ctl.fastpath.status' };

export type ControlEventKind =
  | 'attached'
  | 'detached'
  | 'tab.opened'
  | 'tab.closed'
  | 'recycled'
  | 'ram.sample'
  | 'ram.warn'
  | 'ram.block'
  | 'ram.ok'
  | 'gc'
  | 'stream.start'
  | 'stream.delta'
  | 'stream.end'
  /* Batch 8.1 — an assembled answer carries more than one channel. */
  | 'stream.thinking'
  | 'tool.call'
  | 'tool.result'
  | 'api.usage'
  /* Batch 8.4 — what the router learned from an endpoint failure. */
  | 'api.auth'
  | 'api.limited'
  | 'adapter.health'
  | 'provider.switch'
  | 'boot.injected';

export interface ControlEvent {
  op: 'ctl.event';
  kind: ControlEventKind;
  t: number;
  data: unknown;
}

export function isControlMsg(value: unknown): value is ControlMsg {
  if (typeof value !== 'object' || value === null) return false;
  const op = (value as { op?: unknown }).op;
  return typeof op === 'string' && op.startsWith(CTL_PREFIX);
}

export function isControlEvent(value: unknown): value is ControlEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { op?: unknown; kind?: unknown };
  return v.op === 'ctl.event' && typeof v.kind === 'string';
}

/** Everything the bridge will answer in 0.2 (used for the ENOTIMPL message). */
export function implementedOp(op: string): boolean {
  return op === 'attach' || op === 'recycle' || op.startsWith(CTL_PREFIX);
}

export type { BridgeMsg };

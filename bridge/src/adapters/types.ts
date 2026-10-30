/**
 * Bridge-side adapter extensions.
 *
 * §4's `Adapter` is frozen and returns a plain string from `observeResponse`.
 * Streaming — the thing the Chat panel needs to render tokens as they land — is
 * declared here as an OPTIONAL capability, so a §4-only adapter still works and
 * the runtime degrades to a single delta instead of failing.
 */

import type { Adapter, Page } from '@ai-bridge/shared';

export interface StreamMeta {
  elapsedMs: number;
  streaming: boolean;
}

export interface ObserveStreamOptions {
  debounceMs?: number;
  timeoutMs?: number;
  onDelta?: (text: string, meta: StreamMeta) => void;
}

export interface ObserveStreamResult {
  text: string;
  firstTokenMs: number | null;
  totalMs: number;
  settledBy: string;
}

export interface SelectorMatch {
  role: string;
  matched: string;
  via: 'primary' | 'fallback' | 'accessibility' | 'none';
}

export interface AdapterHealth {
  ready: boolean;
  matches: SelectorMatch[];
}

export interface StreamingAdapter extends Adapter {
  observeStreaming(page: Page, opts?: ObserveStreamOptions): Promise<ObserveStreamResult>;
  health(): AdapterHealth;
  /** Re-resolve every selector role against the live page. */
  probe?(page: Page): Promise<SelectorMatch[]>;
}

export function isStreamingAdapter(adapter: Adapter): adapter is StreamingAdapter {
  const a = adapter as Partial<StreamingAdapter>;
  return typeof a.observeStreaming === 'function' && typeof a.health === 'function';
}

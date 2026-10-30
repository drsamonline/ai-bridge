/**
 * Custom provider adapter — "any logged-in web chat AI" (spec §1).
 *
 * The three bundled adapters are code. This one is configuration: give it a URL
 * and the selectors for the composer and the send button, and it behaves like
 * any other provider — same observer, same limit detection, same failover.
 *
 * Roles you do not supply fall back to generic guesses (an `aria-label` containing
 * "stop", `[role="alert"]` for a limit banner, `.markdown`/`.prose` for the answer
 * body), and the observer's debounce rule covers a page with no copy sentinel.
 */

import type { Logger } from '../logger';
import { DomAdapter, type SelectorMap, type SelectorRole } from './domAdapter';

export interface CustomProviderConfig {
  id: string;
  label: string;
  url: string;
  selectors: {
    composer: { primary: string; fallbacks?: string[]; accessibility?: string | null };
    send: { primary: string; fallbacks?: string[]; accessibility?: string | null };
    assistantTurn?: { primary: string; fallbacks?: string[] };
    markdown?: { primary: string; fallbacks?: string[] };
    stop?: { primary: string; fallbacks?: string[] };
    copySentinel?: { primary: string; fallbacks?: string[] };
    streamingFlag?: { primary: string; fallbacks?: string[] };
    limitBanner?: { primary: string; fallbacks?: string[] };
  };
  /** Banner text that means "limited". Defaults to a generic pattern. */
  limitPattern?: string;
}

const role = (
  spec: { primary: string; fallbacks?: string[]; accessibility?: string | null } | undefined,
  generic: SelectorRole,
): SelectorRole =>
  spec
    ? {
        primary: spec.primary,
        fallbacks: spec.fallbacks ?? [],
        accessibility: spec.accessibility ?? null,
      }
    : generic;

export function buildSelectorMap(cfg: CustomProviderConfig): SelectorMap {
  return {
    composer: role(cfg.selectors.composer, {
      primary: '[contenteditable="true"]',
      fallbacks: ['textarea'],
      accessibility: 'textbox',
    }),
    send: role(cfg.selectors.send, {
      primary: 'button[type="submit"]',
      fallbacks: ['button[aria-label*="send" i]'],
      accessibility: 'button[name="Send"]',
    }),
    assistantTurn: role(cfg.selectors.assistantTurn, {
      primary: '[data-message-author-role="assistant"]',
      fallbacks: ['.assistant', '.message.assistant', 'article'],
      accessibility: null,
    }),
    markdown: role(cfg.selectors.markdown, {
      primary: '.markdown',
      fallbacks: ['.prose', '.message-body'],
      accessibility: null,
    }),
    stop: role(cfg.selectors.stop, {
      primary: 'button[aria-label*="stop" i]',
      fallbacks: [],
      accessibility: null,
    }),
    copySentinel: role(cfg.selectors.copySentinel, {
      primary: 'button[aria-label*="copy" i]',
      fallbacks: [],
      accessibility: null,
    }),
    streamingFlag: role(cfg.selectors.streamingFlag, {
      primary: '[aria-busy="true"]',
      fallbacks: ['.streaming'],
      accessibility: null,
    }),
    limitBanner: role(cfg.selectors.limitBanner, {
      primary: '[role="alert"]',
      fallbacks: [],
      accessibility: null,
    }),
  };
}

export class CustomAdapter extends DomAdapter {
  constructor(cfg: CustomProviderConfig, log: Logger) {
    super(
      {
        id: cfg.id,
        label: cfg.label,
        url: cfg.url,
        selectors: buildSelectorMap(cfg),
        limitPattern: cfg.limitPattern ? new RegExp(cfg.limitPattern, 'i') : undefined,
      },
      log,
    );
  }
}

/** Structural validation, so a bad config is rejected with a reason. */
export function validateCustomProvider(value: unknown): { ok: true; config: CustomProviderConfig } | { ok: false; error: string } {
  const v = value as Partial<CustomProviderConfig> | null;
  if (!v || typeof v !== 'object') return { ok: false, error: 'must be an object' };
  if (typeof v.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(v.id)) {
    return { ok: false, error: 'id must be 2–32 chars of a-z, 0-9, - or _' };
  }
  if (typeof v.label !== 'string' || !v.label.trim()) return { ok: false, error: 'label is required' };
  if (typeof v.url !== 'string' || !/^https?:\/\//.test(v.url)) {
    return { ok: false, error: 'url must start with http:// or https://' };
  }
  const sel = v.selectors as CustomProviderConfig['selectors'] | undefined;
  if (!sel || typeof sel !== 'object') return { ok: false, error: 'selectors is required' };
  if (!sel.composer?.primary) return { ok: false, error: 'selectors.composer.primary is required' };
  if (!sel.send?.primary) return { ok: false, error: 'selectors.send.primary is required' };
  return { ok: true, config: v as CustomProviderConfig };
}

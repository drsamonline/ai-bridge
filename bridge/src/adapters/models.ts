/**
 * Model discovery — spec §5.10.
 *
 * "fetchModels() per adapter via DOM dropdown scrape ([data-chat-model-*]) or
 * network intercept; handle no-picker accounts → infer default; on-demand only
 * (no polling)."
 *
 * Three steps, in order:
 *   1. static scrape of any model rows already in the DOM
 *   2. open the picker (if one exists), scrape, close it
 *   3. no picker at all → infer the single current model and say so
 *
 * `isFree` is a heuristic on the label/id. It is documented as a heuristic
 * because that is what it is: providers rename tiers constantly, and a wrong
 * `isFree` only ever costs a slightly worse failover choice, never correctness.
 */

import type { ModelInfo } from '@ai-bridge/shared';

export interface RawModelItem {
  id?: string;
  label?: string;
  current?: boolean;
  /** Providers that expose it directly win over the heuristic. */
  free?: string | boolean;
}

const FREE_HINTS = /\b(free|basic|mini|nano|flash|lite|haiku|small|economy|standard)\b/i;
const PAID_HINTS = /\b(pro|plus|max|ultra|opus|premium|advanced|reasoning|thinking)\b|gpt-4|gpt-5|\bo1\b|\bo3\b|\bo4\b/i;

/** Is this model usable on a free tier? Unknown → false (conservative). */
export function classifyFree(label: string, id = ''): boolean {
  const text = `${label} ${id}`;
  if (FREE_HINTS.test(text)) return true;
  if (PAID_HINTS.test(text)) return false;
  return false;
}

export function normaliseModels(items: RawModelItem[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const item of items) {
    const label = (item.label ?? item.id ?? '').trim();
    if (!label) continue;
    const id = (item.id ?? label).trim().toLowerCase().replace(/\s+/g, '-');
    if (seen.has(id)) continue;
    seen.add(id);
    const explicit = item.free === true || item.free === 'true' ? true : item.free === false || item.free === 'false' ? false : null;
    out.push({
      id,
      label,
      isFree: explicit ?? classifyFree(label, id),
      current: item.current === true,
    });
  }
  // Exactly one model can be current; if the page marked none, mark the first.
  if (out.length > 0 && !out.some((m) => m.current)) out[0]!.current = true;
  return out;
}

/**
 * Runs in the page. Reads any model rows the provider exposes, including the
 * `[data-chat-model-*]` convention the spec names.
 */
export const SCRAPE_MODELS = `(() => {
  const rows = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const label =
      el.getAttribute('data-chat-model-label') ||
      el.getAttribute('data-testid') && el.getAttribute('data-testid').startsWith('model-switcher-') ? el.textContent :
      (el.textContent || '').trim();
    const id = el.getAttribute('data-chat-model-id') || el.getAttribute('data-chat-model') || el.getAttribute('value') || '';
    const checked =
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('data-chat-model-current') === 'true' ||
      el.getAttribute('aria-selected') === 'true';
    const free = el.getAttribute('data-chat-model-free');
    if (!label && !id) return;
    rows.push({ id: id || undefined, label: (label || '').trim().slice(0, 120), current: checked, free: free === null ? undefined : free });
  };
  document.querySelectorAll('[data-chat-model], [data-chat-model-id]').forEach(push);
  document.querySelectorAll('[role="menuitemradio"], [role="option"], [role="menuitem"]').forEach(push);
  return rows;
})()`;

/** Runs in the page. Falls back to whatever the composer chrome advertises. */
export const INFER_CURRENT_MODEL = `(() => {
  const el =
    document.querySelector('[data-testid="model-switcher-dropdown-button"]') ||
    document.querySelector('[data-chat-model-current="true"]') ||
    document.querySelector('[aria-label*="model" i]');
  const text = el ? (el.textContent || '').trim() : '';
  return text ? { label: text.slice(0, 80) } : null;
})()`;

/** Scrape the page; open the picker once if nothing is exposed statically. */
export async function scrapeModels(
  page: {
    evaluate: (src: string) => Promise<unknown>;
    locator: (sel: string) => { first: () => { count: () => Promise<number>; isVisible: () => Promise<boolean>; click: (o?: unknown) => Promise<void> } };
    keyboard?: { press: (k: string) => Promise<void> };
    waitForTimeout?: (ms: number) => Promise<void>;
  },
  pickerSelectors: string[],
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
): Promise<ModelInfo[]> {
  let rows = (await page.evaluate(SCRAPE_MODELS).catch(() => [])) as RawModelItem[];
  if (Array.isArray(rows) && rows.length > 0) {
    log?.('info', `models: ${rows.length} scraped from the DOM`);
    return normaliseModels(rows);
  }

  // Open the picker if the page has one.
  for (const sel of pickerSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    log?.('info', `models: opening the picker (${sel})`);
    await loc.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout?.(250);
    rows = (await page.evaluate(SCRAPE_MODELS).catch(() => [])) as RawModelItem[];
    await page.keyboard?.press('Escape').catch(() => undefined);
    if (Array.isArray(rows) && rows.length > 0) {
      log?.('info', `models: ${rows.length} scraped after opening the picker`);
      return normaliseModels(rows);
    }
    break;
  }

  // No picker: infer the current model and say so honestly.
  const inferred = (await page.evaluate(INFER_CURRENT_MODEL).catch(() => null)) as { label?: string } | null;
  const label = inferred?.label?.trim() || 'Default model';
  log?.('warn', `models: no picker found — inferring the default model ("${label}")`);
  return normaliseModels([{ id: label.toLowerCase().replace(/\s+/g, '-'), label, current: true }]);
}

/** The picker triggers each provider uses, best first. */
export const MODEL_PICKER_SELECTORS = [
  '[data-testid="model-switcher-dropdown-button"]',
  '[data-chat-model-picker]',
  'button[aria-label*="model" i]',
  '[role="button"][aria-haspopup="menu"]',
];

/**
 * Batch 9.0 — the fast path, and what falls back to the tab.
 *
 * The idea, taken from `QwenApiClient.ts` + `QwenBrowserBridge.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad): call the provider's own
 * endpoint directly, and when the answer is a challenge instead of a stream,
 * replay the SAME request inside the browser session that is already trusted.
 * See docs/batch8/attribution.md.
 *
 * What is ours, and what theirs could not be: we already hold a live tab the
 * user signed into, so the replay needs no profile directory, no launcher and no
 * stealth script — it runs `fetch` inside that page, where the cookies and the
 * fingerprint already are.
 */

/** The three rungs, cheapest first. */
export type Rung = 'fast' | 'replay' | 'dom';

export const RUNG_ORDER: readonly Rung[] = ['fast', 'replay', 'dom'] as const;

/**
 * One provider's direct request.
 *
 * No template ships in this repository. ChatGPT, Claude and Gemini all sign
 * their requests with device fingerprints or proof-of-work, none publishes the
 * shape, and guessing one from outside would be fiction. A template is
 * configuration the user adds after capturing a request from their own tab —
 * which is also why the default is `enabled: false`.
 */
export interface FastPathTemplate {
  /** Adapter id this template belongs to, e.g. `chatgpt`. */
  providerId: string;
  /** Absolute URL of the completion endpoint. */
  url: string;
  method?: 'POST' | 'GET';
  /** Headers to mirror. Auth headers are usually better left to the page. */
  headers?: Record<string, string>;
  /** Body with `{{prompt}}` and `{{model}}` placeholders. */
  bodyTemplate: string;
  /** Off by default: a wrong template adds a round trip to every request. */
  enabled?: boolean;
}

export interface FastPathVars {
  prompt: string;
  model?: string;
}

/**
 * Fills `{{name}}` placeholders.
 *
 * Unknown placeholders are left alone rather than replaced with an empty string:
 * a template that quietly loses `{{prompt}}` sends an empty request, which is
 * far harder to diagnose than one that fails visibly.
 */
export function renderTemplate(template: string, vars: FastPathVars): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, name: string) => {
    if (name === 'prompt') return escapeForJson(template, vars.prompt);
    if (name === 'model' && vars.model !== undefined) {
      return escapeForJson(template, vars.model);
    }
    return match;
  });
}

/**
 * Escapes a value for the JSON body it is being substituted into.
 *
 * A prompt is arbitrary text: quotes, newlines, backslashes. Dropped in raw it
 * produces a body that fails to parse, and the failure looks like a provider
 * problem rather than ours.
 */
function escapeForJson(_template: string, value: string): string {
  return JSON.stringify(value ?? '').slice(1, -1);
}

export type TemplateValidation =
  | { ok: true; config: FastPathTemplate }
  | { ok: false; error: string };

/**
 * Validates one template from configuration.
 *
 * A template missing `{{prompt}}` is rejected rather than accepted-and-broken: it
 * would send a request with no question in it, and the provider would answer
 * something plausible about nothing.
 */
export function validateTemplate(raw: unknown): TemplateValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const record = raw as Record<string, unknown>;

  const providerId = typeof record.providerId === 'string' ? record.providerId.trim() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(providerId)) {
    return { ok: false, error: `invalid providerId "${String(record.providerId ?? '')}"` };
  }

  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!url) return { ok: false, error: 'url is required' };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `url is not a URL: ${url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `url must be http or https: ${url}` };
  }

  const bodyTemplate = typeof record.bodyTemplate === 'string' ? record.bodyTemplate : '';
  if (!bodyTemplate.trim()) return { ok: false, error: 'bodyTemplate is required' };
  if (!/\{\{\s*prompt\s*\}\}/.test(bodyTemplate)) {
    return { ok: false, error: 'bodyTemplate must contain {{prompt}}' };
  }

  const method = record.method === 'GET' ? 'GET' : 'POST';
  const headers =
    record.headers && typeof record.headers === 'object'
      ? Object.fromEntries(
          Object.entries(record.headers as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : undefined;

  return {
    ok: true,
    config: {
      providerId,
      url,
      method,
      bodyTemplate,
      // Off unless asked for: a wrong template costs a round trip per request.
      enabled: record.enabled === true,
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    },
  };
}

/**
 * Batch 9.2 — turn a copied cURL into a fast-path template.
 *
 * The capture flow exists because the machinery in 9.0 is useless without a
 * template, and nobody should have to hand-assemble one from DevTools. Copy the
 * request as cURL, paste it, and this does the rest.
 *
 * Two deliberate refusals:
 *
 *  - **Credentials are dropped.** `authorization`, `cookie`, `content-length` and
 *    `host` never survive the parse. The replay runs inside the signed-in tab and
 *    the fast rung is a same-site request; a copied credential would be a secret
 *    in a settings file, and it would go stale.
 *  - **No guess about what the prompt is.** The longest string in the body is
 *    assumed to be the message and replaced with `{{prompt}}` — and the caller is
 *    shown exactly what was replaced, because a wrong guess here produces a
 *    template that sends the wrong text forever.
 */

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type CurlParse =
  | { ok: true; request: ParsedCurl }
  | { ok: false; error: string };

/** Headers that must never be copied into a template. */
const DROPPED_HEADERS = new Set([
  'authorization',
  'cookie',
  'content-length',
  'host',
  'accept-encoding',
  'connection',
]);

/**
 * Splits a shell-ish argument string into tokens, honouring quotes.
 *
 * A cURL from DevTools is a shell command: single quotes around most values,
 * `$'...'` escapes sometimes, and backslash-newline continuations. This handles
 * the shapes Chrome and Firefox actually emit, and refuses rather than guessing
 * when a quote never closes.
 */
export function tokenize(input: string): { ok: true; tokens: string[] } | { ok: false; error: string } {
  const text = input.replace(/\\\r?\n/g, ' ').trim();
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1;
        current += text[i]!;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char as '"' | "'";
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (quote) return { ok: false, error: 'unbalanced quote — the copy may be truncated' };
  if (started) tokens.push(current);
  return { ok: true, tokens };
}

/** Parses a `curl …` command into the request it makes. */
export function parseCurl(input: string): CurlParse {
  const tokenized = tokenize(input ?? '');
  if (!tokenized.ok) return { ok: false, error: tokenized.error };
  const tokens = tokenized.tokens;

  if (tokens.length === 0 || !/^curl$/i.test(tokens[0]!.replace(/^.*[\\/]/, ''))) {
    return { ok: false, error: 'not a curl command — copy the request as cURL from DevTools' };
  }

  let url = '';
  let method = '';
  const headers: Record<string, string> = {};
  let body: string | undefined;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const next = tokens[i + 1];

    if (token === '-X' || token === '--request') {
      method = (next ?? '').toUpperCase();
      i += 1;
      continue;
    }
    if (token === '-H' || token === '--header') {
      const raw = next ?? '';
      const colon = raw.indexOf(':');
      if (colon > 0) {
        const name = raw.slice(0, colon).trim();
        const value = raw.slice(colon + 1).trim();
        // Pseudo-headers from an HTTP/2 dump (`:authority: …`) have an empty name.
        if (name && !name.startsWith(':') && !DROPPED_HEADERS.has(name.toLowerCase())) {
          headers[name] = value;
        }
      }
      i += 1;
      continue;
    }
    if (
      token === '--data-raw' ||
      token === '--data' ||
      token === '--data-binary' ||
      token === '-d'
    ) {
      body = next ?? '';
      i += 1;
      continue;
    }
    if (token === '--compressed' || token === '-s' || token === '--insecure' || token === '-k') {
      continue;
    }
    if (token.startsWith('-')) {
      // An unknown flag with a value: skip both so the URL is not mistaken for it.
      if (next && !next.startsWith('-') && !/^https?:/i.test(next)) i += 1;
      continue;
    }
    if (!url) url = token;
  }

  if (!url) return { ok: false, error: 'no URL in the command' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: `not an http(s) URL: ${url}` };

  return {
    ok: true,
    request: { url, method: method || (body ? 'POST' : 'GET'), headers, body },
  };
}

/** The longest string value in a JSON body, with the path it sits at. */
function longestString(value: unknown, path = '$'): { path: string; text: string } | undefined {
  if (typeof value === 'string') return { path, text: value };
  if (Array.isArray(value)) {
    let best: { path: string; text: string } | undefined;
    value.forEach((entry, index) => {
      const found = longestString(entry, `${path}[${index}]`);
      if (found && (!best || found.text.length > best.text.length)) best = found;
    });
    return best;
  }
  if (value && typeof value === 'object') {
    let best: { path: string; text: string } | undefined;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const found = longestString(entry, `${path}.${key}`);
      if (found && (!best || found.text.length > best.text.length)) best = found;
    }
    return best;
  }
  return undefined;
}

export interface TemplateDraft {
  providerId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  bodyTemplate: string;
  enabled: boolean;
}

export type TemplateFromCurl =
  | { ok: true; template: TemplateDraft; replaced: { path: string; preview: string } }
  | { ok: false; error: string };

/**
 * Builds a template from a copied request.
 *
 * Returns what it replaced so the caller can show it: the guess is good, not
 * perfect, and a template that silently sends the wrong text is worse than no
 * template at all.
 */
export function templateFromCurl(input: string, providerId: string): TemplateFromCurl {
  const parsed = parseCurl(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { url, method, headers, body } = parsed.request;
  if (!body) {
    return {
      ok: false,
      error: 'the command has no request body — a template needs one to put {{prompt}} in',
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      ok: false,
      error: 'the request body is not JSON — only JSON bodies can be templated',
    };
  }

  const longest = longestString(payload);
  if (!longest || longest.text.length < 2) {
    return { ok: false, error: 'no message-sized string found in the body' };
  }

  // Replace the first occurrence of that exact JSON string in the raw body, so
  // everything else stays byte-for-byte as captured.
  const needle = JSON.stringify(longest.text);
  const at = body.indexOf(needle);
  if (at === -1) return { ok: false, error: 'could not locate the message string in the body' };

  const bodyTemplate = `${body.slice(0, at)}{{prompt}}${body.slice(at + needle.length)}`;
  const preview =
    longest.text.length > 80 ? `${longest.text.slice(0, 80)}…` : longest.text;

  return {
    ok: true,
    template: {
      providerId,
      url,
      method,
      ...(Object.keys(headers).length ? { headers } : {}),
      bodyTemplate,
      // A captured template still starts off: the user enables it after it works.
      enabled: false,
    },
    replaced: { path: longest.path, preview },
  };
}

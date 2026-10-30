/**
 * Secret redaction — zero imports on purpose.
 *
 * This module is pulled into the T1 worker, and a worker should not drag the
 * whole shared package (and its WebSocket client) into a fresh isolate just to
 * run ten regexes. Keeping it dependency-free keeps the thread cheap.
 */

/** Patterns that must never reach disk. */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'google-key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: 'assigned-secret',
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["']?([A-Za-z0-9._-]{12,})["']?/gi,
  },
];

export interface RedactionResult {
  text: string;
  redactions: number;
  kinds: string[];
}

/** Strip credentials before anything is written. Idempotent. */
export function redact(text: string): RedactionResult {
  let out = text;
  let redactions = 0;
  const kinds: string[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, (match, captured?: string) => {
      redactions += 1;
      kinds.push(name);
      // Keep the key name when the pattern captured a value, so the record still
      // says *what* was configured without saying what it was.
      if (typeof captured === 'string' && captured.length > 0) {
        return match.replace(captured, '«redacted»');
      }
      return '«redacted»';
    });
  }
  return { text: out, redactions, kinds: [...new Set(kinds)] };
}

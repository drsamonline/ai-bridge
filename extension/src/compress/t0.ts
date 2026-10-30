/**
 * T0 compressor — spec §5.6.
 *
 * Always on, pure, synchronous, no model. Four passes, in this order:
 *
 *   1. PROTECT   fenced code, inline code, URLs, paths, SCREAMING_SNAKE
 *                constants, error lines and stack frames are swapped for
 *                sentinels and restored byte-for-byte at the end
 *   2. WHITESPACE  collapse runs, strip trailing spaces, squeeze blank lines
 *   3. FILLER    pleasantries and wordy connectives, phrase by phrase
 *   4. GLOSSARY + DEDUPE   alias long forms, drop repeated identical lines
 *
 * Anything the compressor does not understand is FLAGGED rather than guessed at:
 * unknown jargon is reported so the Compressor tab (4.1) can ask about it.
 *
 * The one invariant that matters: protected text is never altered, even when the
 * budget forces the hard pass.
 */

import { countTokens } from '../text/tokens';

export type Tier = 'T0' | 'T1' | 'auto';
export type Aggressiveness = 'safe' | 'hard';

export interface CompressOptions {
  /** long form → alias. Entries whose alias is not shorter are ignored. */
  glossary?: Record<string, string>;
  /** When set and still exceeded after the safe pass, the hard pass runs. */
  budgetTokens?: number;
  /** Force the hard pass regardless of budget. */
  aggressiveness?: Aggressiveness;
}

export interface CompressResult {
  text: string;
  tokensBefore: number;
  tokensAfter: number;
  ratio: number;
  /** Bytes saved, for the status bar. */
  savedChars: number;
  protectedSpans: number;
  glossaryHits: number;
  dedupedLines: number;
  fillerRemoved: number;
  flagged: string[];
  passes: string[];
  cacheHit: boolean;
  /** True when the result is still over the requested budget. */
  overBudget: boolean;
}

const SENT_OPEN = '\u0000';
const SENT_CLOSE = '\u0001';

/* ------------------------------------------------------------- protection */

interface Protected {
  text: string;
  spans: string[];
}

/** Ordered: fenced code first, so inner patterns are never re-matched. */
const PROTECT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'fence', re: /```[\s\S]*?```/g },
  { name: 'fence', re: /~~~[\s\S]*?~~~/g },
  { name: 'inline-code', re: /`[^`\n]+`/g },
  { name: 'url', re: /\b(?:https?|wss?|file):\/\/[^\s<>"'`)\]]+/g },
  // Error and stack lines are matched BEFORE paths, so a path inside a stack
  // frame is captured as part of the whole line rather than nested inside it.
  { name: 'error', re: /^\s*(?:[A-Za-z]*Error|Exception|Traceback)[^\n]*$/gm },
  { name: 'stack', re: /^\s+at\s+[^\n]+$/gm },
  { name: 'path', re: /\b(?:[\w.@-]+\/)+[\w.@-]+\.(?:[A-Za-z0-9]{1,8})(?::\d+(?::\d+)?)?\b/g },
  { name: 'path', re: /\b[\w-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|cs|rb|php|swift|kt|sh|sql|json|ya?ml|toml|md|css|html)(?::\d+)?\b/g },
  { name: 'screaming', re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
];

export function protectSpans(input: string): Protected {
  const spans: string[] = [];
  let text = input;
  for (const { re } of PROTECT_PATTERNS) {
    text = text.replace(re, (match) => {
      const idx = spans.length;
      spans.push(match);
      return `${SENT_OPEN}${idx}${SENT_CLOSE}`;
    });
  }
  return { text, spans };
}

export function restoreSpans(text: string, spans: string[]): string {
  let out = text;
  // A protected span can itself contain a sentinel (a path inside a stack line),
  // so restoring runs to a fixed point rather than once.
  for (let pass = 0; pass < 6; pass += 1) {
    if (!/\u0000\d+\u0001/.test(out)) break;
    const next = out.replace(/\u0000(\d+)\u0001/g, (match, idx: string) => {
      const span = spans[Number(idx)];
      return span === undefined ? match : span;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/* ------------------------------------------------------------- filler */

/** Wordy connectives → shorter equivalents. Applied with word boundaries. */
const CONNECTIVES: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bfor the purpose of\b/gi, 'to'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\ba large number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bis able to\b/gi, 'can'],
  [/\bare able to\b/gi, 'can'],
  [/\butilize\b/gi, 'use'],
  [/\butilizes\b/gi, 'uses'],
  [/\bthe reason why is that\b/gi, 'because'],
  [/\bit is important to note that\b/gi, ''],
  [/\bplease note that\b/gi, ''],
  [/\bI would like you to\b/gi, ''],
  [/\bI'd like you to\b/gi, ''],
  [/\bI want you to\b/gi, ''],
  [/\bcould you please\b/gi, ''],
  [/\bcan you please\b/gi, ''],
  [/\bwould you please\b/gi, ''],
  [/\bwould you kindly\b/gi, ''],
  [/\bif you don'?t mind\b/gi, ''],
  [/\bif possible\b/gi, ''],
  [/\bkindly\b/gi, ''],
  [/\bplease\b/gi, ''],
  [/\bas an AI language model\b/gi, ''],
  [/\bas an AI\b/gi, ''],
  [/\bI hope this helps\b/gi, ''],
  [/\bhope this helps\b/gi, ''],
  [/\blet me know if you have any questions\b/gi, ''],
  [/\bfeel free to\b/gi, ''],
  [/\bgreat question\b/gi, ''],
  [/^\s*(?:hi|hello|hey|hiya)\s+there\b[!,.]?\s*/gim, ''],
  [/^\s*(?:hi|hello|hey|hiya)\b[!,.]?\s*/gim, ''],
  [/^\s*good (?:morning|afternoon|evening)\b[!,.]?\s*/gim, ''],
  [/\bof course\b/gi, ''],
  [/\bcertainly\b/gi, ''],
  [/\bsure thing\b/gi, ''],
  [/\babsolutely\b/gi, ''],
  [/\bbasically\b/gi, ''],
  [/\bactually\b/gi, ''],
  [/\bin my opinion\b/gi, ''],
  [/\bI think that\b/gi, ''],
  [/\bI believe that\b/gi, ''],
  [/\bthank you (?:so|very) much\b/gi, ''],
  [/\bthanks (?:so|very) much\b/gi, ''],
  [/\bthank you\b/gi, ''],
  [/\bthanks\b/gi, ''],
  [/\b(?:could|can|would) you\b/gi, ''],
];

/** Only in the hard pass: abbreviations that save tokens but read terse. */
const HARD_SUBS: Array<[RegExp, string]> = [
  [/\band\b/gi, '&'],
  [/\bwith\b/gi, 'w/'],
  [/\bwithout\b/gi, 'w/o'],
  [/\bbecause\b/gi, 'b/c'],
  [/\bapproximately\b/gi, '~'],
  [/\bvery\b/gi, ''],
  [/\breally\b/gi, ''],
  [/\bjust\b/gi, ''],
  [/\bquite\b/gi, ''],
  [/\b(?:the|a|an)\b\s*/gi, ''],
  [/\bthere (?:is|are)\b/gi, ''],
  [/\bthat\b/gi, ''],
];

/** Whole lines that are pure pleasantry once filler is stripped. */
const EMPTY_LINE_WORDS = /^[\s.,!?;:—-]*$/;

function stripPleasantryLines(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text
    .split('\n')
    .filter((line) => {
      // Never touch a line carrying a protected span.
      if (line.includes(SENT_OPEN)) return true;
      if (EMPTY_LINE_WORDS.test(line)) return false;
      const bare = line
        .replace(/\b(please|kindly|thanks|thank you|cheers|great|awesome|perfect|okay|ok)\b/gi, '')
        .trim();
      if (bare.length === 0) {
        removed += 1;
        return false;
      }
      return true;
    })
    .join('\n');
  return { text: out, removed };
}

function applyRules(
  text: string,
  rules: Array<[RegExp, string]>,
): { text: string; changes: number } {
  let changes = 0;
  let out = text;
  for (const [re, replacement] of rules) {
    out = out.replace(re, () => {
      changes += 1;
      return replacement;
    });
  }
  return { text: out, changes };
}

/**
 * Removing phrases leaves orphaned punctuation ("cleaner and . ,"). Protected
 * spans are still sentinels at this point, so this can never touch code.
 *
 * Order matters: conjunctions are dropped BEFORE punctuation is collapsed, and
 * the collapse is repeated until stable so ".," and ",," both settle.
 */
function tidyPunctuation(text: string): string {
  let out = text
    // 1. a conjunction left dangling in front of punctuation disappears with it
    .replace(/\b(?:and|or|but|with|to|of|in|that)\s*(?=[,.;:!?])/gi, '')
    // 2. no space before punctuation
    .replace(/[ \t]+([,.;:!?])/g, '$1');

  // 2b. a period followed by an exclamation keeps the exclamation ("now.!")
  out = out.replace(/([,;:.])\s*([!?])/g, '$2');

  // 3. collapse stacked punctuation until it stops changing: a period wins.
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out
      .replace(/([,;:])\s*(?=[,;:.])/g, '')
      .replace(/\.\s*([,;:])/g, '.') // a period dominates , ; :
      .replace(/([!?])\s*(?=[,;:.])/g, '$1')
      .replace(/\.\s*\./g, '.')
      .replace(/([,;:])\s*\1+/g, '$1');
    if (out === before) break;
  }

  return out
    .replace(/^\s*[,;:.!?]+\s*/gm, '') // nothing may start a line with punctuation
    .replace(/^\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+$/gm, '')
    .trim();
}

function normaliseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function dropEmptyLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.includes(SENT_OPEN) || line.trim().length > 0)
    .join('\n');
}

function dedupeLines(text: string): { text: string; removed: number } {
  const seen = new Set<string>();
  let removed = 0;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    // Protected lines are kept verbatim, duplicates included: two identical code
    // lines are not redundancy.
    if (line.includes(SENT_OPEN) || line.trim().length < 8) {
      out.push(line);
      continue;
    }
    const key = line.trim();
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return { text: out.join('\n'), removed };
}

function applyGlossary(
  text: string,
  glossary: Record<string, string> | undefined,
): { text: string; hits: number } {
  if (!glossary) return { text, hits: 0 };
  let hits = 0;
  let out = text;
  // Longest key first, so "extension host process" wins over "extension host".
  const entries = Object.entries(glossary)
    .filter(([k, v]) => typeof v === 'string' && v.length > 0 && v.length < k.length)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [long, short] of entries) {
    const re = new RegExp(long.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    out = out.replace(re, () => {
      hits += 1;
      return short;
    });
  }
  return { text: out, hits };
}

/** Jargon we could not compress and should ask about later (§5.6 "flag"). */
function findJargon(text: string, glossary: Record<string, string> | undefined): string[] {
  const flagged = new Set<string>();
  const known = new Set(Object.keys(glossary ?? {}).map((k) => k.toLowerCase()));
  for (const m of text.matchAll(/\b[A-Za-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) {
    const word = m[0];
    if (word.length < 6) continue;
    if (known.has(word.toLowerCase())) continue;
    flagged.add(word);
    if (flagged.size >= 10) break;
  }
  return [...flagged];
}

/* --------------------------------------------------------------- the pass */

function runPass(
  input: string,
  opts: CompressOptions,
  aggressive: boolean,
): {
  text: string;
  spans: string[];
  fillerRemoved: number;
  dedupedLines: number;
  glossaryHits: number;
  passes: string[];
} {
  const passes: string[] = [];
  const { text: protectedText, spans } = protectSpans(input);
  passes.push('protect');

  let text = normaliseWhitespace(protectedText);
  passes.push('whitespace');

  const pleasantry = stripPleasantryLines(text);
  text = pleasantry.text;

  const fill = applyRules(text, CONNECTIVES);
  text = fill.text;
  passes.push('filler');

  if (aggressive) {
    const hard = applyRules(text, HARD_SUBS);
    text = hard.text;
    passes.push('hard');
  }

  text = tidyPunctuation(text);
  passes.push('tidy');

  const gloss = applyGlossary(text, opts.glossary);
  text = gloss.text;
  if (gloss.hits > 0) passes.push('glossary');

  const dedupe = dedupeLines(text);
  text = dedupe.text;
  if (dedupe.removed > 0) passes.push('dedupe');

  text = dropEmptyLines(text);
  text = normaliseWhitespace(text);
  text = restoreSpans(text, spans);
  passes.push('restore');

  return {
    text,
    spans,
    fillerRemoved: fill.changes + pleasantry.removed,
    dedupedLines: dedupe.removed,
    glossaryHits: gloss.hits,
    passes,
  };
}

/* ------------------------------------------------------------------- LRU */

export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max = 100) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: delete and re-insert so Map order tracks use.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** Stable cache key over the text and the options that change the output. */
export function cacheKey(text: string, opts: CompressOptions): string {
  // FNV-1a over the text plus the option fingerprint: cheap, stable, no crypto
  // import (the worker should stay dependency-free).
  let hash = 0x811c9dc5;
  const payload = `${text}\u0002${JSON.stringify({
    g: opts.glossary ?? null,
    b: opts.budgetTokens ?? null,
    a: opts.aggressiveness ?? null,
  })}`;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}:${text.length}`;
}

/* --------------------------------------------------------------- public */

const defaultCache = new LruCache<CompressResult>(100);

export function compressT0(
  input: string,
  opts: CompressOptions = {},
  cache: LruCache<CompressResult> = defaultCache,
): CompressResult {
  const key = cacheKey(input, opts);
  const hit = cache.get(key);
  if (hit) return { ...hit, cacheHit: true };

  const before = countTokens(input);
  let result = runPass(input, opts, opts.aggressiveness === 'hard');
  let after = countTokens(result.text);
  let overBudget = opts.budgetTokens !== undefined && after > opts.budgetTokens;

  // Budget only buys one escalation. Beyond that the text is what it is, and the
  // caller decides whether to send it anyway.
  if (overBudget && opts.aggressiveness !== 'hard') {
    const harder = runPass(input, opts, true);
    const harderTokens = countTokens(harder.text);
    if (harderTokens < after) {
      result = harder;
      after = harderTokens;
      overBudget = opts.budgetTokens !== undefined && after > opts.budgetTokens;
    }
  }

  // Never hand back something that stopped being a message: if the passes ate
  // every word (an all-pleasantry input), keep the tidied original instead.
  if (!/[\p{L}\p{N}]/u.test(result.text)) {
    result = { ...result, text: normaliseWhitespace(input) };
    after = countTokens(result.text);
    overBudget = opts.budgetTokens !== undefined && after > opts.budgetTokens;
  }

  const out: CompressResult = {
    text: result.text,
    tokensBefore: before,
    tokensAfter: after,
    ratio: before === 0 ? 1 : Math.round((after / before) * 1000) / 1000,
    savedChars: input.length - result.text.length,
    protectedSpans: result.spans.length,
    glossaryHits: result.glossaryHits,
    dedupedLines: result.dedupedLines,
    fillerRemoved: result.fillerRemoved,
    flagged: findJargon(result.text, opts.glossary),
    passes: result.passes,
    cacheHit: false,
    overBudget,
  };

  cache.set(key, out);
  return out;
}

/** Percentage saved, for the status bar's ⇣38%. */
export function savedPercent(result: CompressResult): number {
  if (result.tokensBefore === 0) return 0;
  return Math.round((1 - result.tokensAfter / result.tokensBefore) * 100);
}

export function clearCompressCache(): void {
  defaultCache.clear();
}

export function compressCacheSize(): number {
  return defaultCache.size;
}

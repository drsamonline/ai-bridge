/**
 * T1 compressor — spec §5.6 ("T1, opt-in, llama.cpp WASM/ONNX, auto-off if
 * RAM < 8 GB", "T1: 50–150 MB", "protect … identifiers preserved").
 *
 * The model is the easy part; the guarantees are the work. T1 is only allowed to
 * touch a prompt if, after it has done so:
 *
 *   · every identifier from the input is still present verbatim
 *   · every protected span (code, paths, URLs, constants, error lines) survives
 *   · the result is actually shorter than T0's
 *
 * If any of those fails — or the backend throws, or it takes too long — T0's
 * output is used and the reason is recorded. T1 can never make a prompt worse,
 * and it can never block one: the fallback is structural, not a try/catch after
 * the fact.
 *
 * Backends:
 *   ollama     a local model over HTTP (llama.cpp under the hood) — external RAM
 *   llamacpp   node-llama-cpp WASM/ONNX in-process — 50–150 MB band
 *
 * Neither is bundled: T1 stays unavailable until the user opts in and has one.
 */

import * as http from 'node:http';
import * as os from 'node:os';
import { protectSpans, type CompressOptions, type CompressResult } from './t0';
import { countTokens } from '../text/tokens';

/* ------------------------------------------------------------------ gate */

export const MIN_RAM_BYTES = 8 * 1024 ** 3;
/** §5.6's stated footprint band for the in-process model. */
export const FOOTPRINT_BAND_MB = { min: 50, max: 150 } as const;

export type LowEndMode = 'auto' | 'on' | 'off';

export interface GateDecision {
  enable: boolean;
  reason: string;
  totalMemBytes: number;
  minRamBytes: number;
}

/**
 * §5.6's "auto-off if RAM < 8 GB". `on` is the user's explicit opt-in and
 * overrides the memory gate; `off` disables T1 regardless.
 */
export function shouldEnableT1(
  totalMemBytes: number,
  opts: { lowEndMode?: LowEndMode; minRamBytes?: number } = {},
): GateDecision {
  const minRamBytes = opts.minRamBytes ?? MIN_RAM_BYTES;
  const mode = opts.lowEndMode ?? 'auto';
  const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

  if (mode === 'off') {
    return { enable: false, reason: 'T1 disabled by setting', totalMemBytes, minRamBytes };
  }
  if (mode === 'on') {
    return {
      enable: true,
      reason: `T1 forced on by the user (${gb(totalMemBytes)} RAM, below the ${gb(minRamBytes)} auto threshold)`,
      totalMemBytes,
      minRamBytes,
    };
  }
  if (totalMemBytes < minRamBytes) {
    return {
      enable: false,
      reason: `low-end machine (${gb(totalMemBytes)} < ${gb(minRamBytes)}) — staying on T0`,
      totalMemBytes,
      minRamBytes,
    };
  }
  return {
    enable: true,
    reason: `${gb(totalMemBytes)} ≥ ${gb(minRamBytes)} — T1 permitted`,
    totalMemBytes,
    minRamBytes,
  };
}

/* -------------------------------------------------------- identifier guard */

const ID_STOPWORDS = new Set([
  'TODO', 'DONE', 'FIXME', 'NOTE', 'OK', 'API', 'URL', 'HTTP', 'HTTPS', 'JSON',
  'HTML', 'CSS', 'SQL', 'RAM', 'CPU', 'IO', 'ID', 'AI', 'LLM',
]);

/**
 * Identifiers T1 must not touch: code-level names, constants, backticked
 * tokens, paths, and anything the surrounding text refers to as a symbol.
 */
export function extractIdentifiers(text: string): string[] {
  const found = new Set<string>();
  const add = (value: string) => {
    const v = value.trim();
    if (v.length < 3 || v.length > 80) return;
    if (ID_STOPWORDS.has(v)) return;
    found.add(v);
  };

  // backticked tokens
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) add(m[1]!);
  // declarations inside code
  for (const m of text.matchAll(/\b(?:function|class|const|let|var|interface|type|enum|def|func|struct|impl)\s+([A-Za-z_][\w]*)/g)) {
    add(m[1]!);
  }
  // CamelCase, snake_case, CONSTANTS
  for (const m of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
  // paths
  for (const m of text.matchAll(/\b(?:[\w.@-]+\/)+[\w.@-]+\.\w{1,8}\b/g)) add(m[0]);

  return [...found];
}

export interface IdentifierCheck {
  ok: boolean;
  missing: string[];
  checked: number;
}

/** Every identifier in `before` must appear verbatim in `after`. */
export function verifyIdentifiers(before: string, after: string): IdentifierCheck {
  const ids = extractIdentifiers(before);
  const missing = ids.filter((id) => !after.includes(id));
  return { ok: missing.length === 0, missing, checked: ids.length };
}

/** Every protected span from the original must survive verbatim. */
export function verifyProtectedSpans(original: string, candidate: string): { ok: boolean; missing: string[] } {
  const { spans } = protectSpans(original);
  const missing = spans.filter((span) => !candidate.includes(span));
  return { ok: missing.length === 0, missing };
}

/* --------------------------------------------------------------- backends */

export interface T1Backend {
  readonly name: string;
  /** Where the model's memory lives, for the 50–150 MB band check. */
  readonly footprint: 'in-process' | 'external';
  /** Reported in-process footprint in MB, when the backend knows it. */
  footprintMb?(): number | undefined;
  available(): Promise<boolean>;
  compress(text: string, opts: { budgetTokens: number; timeoutMs?: number }): Promise<string>;
}

const INSTRUCTION = [
  'You are a lossless prompt compressor. Rewrite the user request to be as short as possible',
  'without losing any instruction or constraint.',
  'HARD RULES:',
  '- Keep every identifier, function name, constant, file path, URL and code block byte-identical.',
  '- Keep every "must", "never", "do not" and numeric value.',
  '- Do not add commentary, do not answer the request, output only the rewritten request.',
].join('\n');

function t1Prompt(text: string): string {
  return `${INSTRUCTION}\n\n--- REQUEST ---\n${text}\n--- END ---`;
}

/** A local model served over HTTP (Ollama, llama.cpp's server, LM Studio…). */
export class OllamaCompressor implements T1Backend {
  readonly name = 'ollama';
  readonly footprint = 'external' as const;
  private readonly url: string;
  private readonly model: string;

  constructor(
    opts: { url?: string; model?: string } = {},
    private readonly log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {
    this.url = opts.url ?? 'http://127.0.0.1:11434';
    this.model = opts.model ?? 'llama3.2';
  }

  private request(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.url);
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          host: url.hostname,
          port: Number(url.port || 11434),
          path,
          method,
          timeout: timeoutMs,
          headers: payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let out = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (out += c));
          res.on('end', () => {
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`ET1HTTP: ${res.statusCode} ${out.slice(0, 200)}`));
              return;
            }
            resolve(out);
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ET1TIMEOUT'));
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async available(): Promise<boolean> {
    try {
      const body = await this.request('GET', '/api/tags', undefined, 1500);
      return body.includes('models');
    } catch {
      return false;
    }
  }

  async compress(text: string, opts: { budgetTokens: number; timeoutMs?: number }): Promise<string> {
    const body = await this.request(
      'POST',
      '/api/generate',
      {
        model: this.model,
        prompt: t1Prompt(text),
        stream: false,
        options: { temperature: 0, num_predict: Math.max(64, Math.min(1024, opts.budgetTokens * 2)) },
      },
      opts.timeoutMs ?? 30_000,
    );
    let parsed: { response?: string };
    try {
      parsed = JSON.parse(body) as { response?: string };
    } catch {
      throw new Error('ET1JSON: backend returned non-JSON');
    }
    const out = (parsed.response ?? '').trim();
    if (!out) throw new Error('ET1EMPTY: backend returned nothing');
    this.log?.('info', `T1 (${this.model}) returned ${out.length} chars`);
    return out;
  }
}

/**
 * In-process llama.cpp / ONNX. The dependency is optional: if it is not
 * installed this backend reports unavailable rather than failing to load.
 */
export class LlamaCppCompressor implements T1Backend {
  readonly name = 'llamacpp';
  readonly footprint = 'in-process' as const;
  private loaded: { compress: (text: string) => Promise<string>; footprintMb: () => number } | null = null;

  constructor(
    private readonly opts: { modelPath?: string } = {},
    private readonly log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {}

  footprintMb(): number | undefined {
    return this.loaded?.footprintMb();
  }

  async available(): Promise<boolean> {
    try {
      // Resolved lazily and optionally: T1 must not be a hard dependency of the
      // extension host.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('node-llama-cpp') as { getLlama?: unknown };
      return typeof mod?.getLlama === 'function' && !!this.opts.modelPath;
    } catch {
      return false;
    }
  }

  async compress(text: string, opts: { budgetTokens: number; timeoutMs?: number }): Promise<string> {
    if (!this.loaded) {
      // Lazy and optional: T1 must not be a hard dependency of the extension host.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('node-llama-cpp') as {
        getLlama: () => Promise<unknown>;
        LlamaChatSession?: new (args: unknown) => {
          prompt: (t: string, opts?: Record<string, unknown>) => Promise<string>;
        };
      };
      const llama = (await mod.getLlama()) as { loadModel: (a: { modelPath: string }) => Promise<unknown> };
      const model = await llama.loadModel({ modelPath: this.opts.modelPath! });
      const ctx = await (model as { createContext: () => Promise<unknown> }).createContext();
      const Session = mod.LlamaChatSession!;
      const session = new Session({ contextSequence: (ctx as { getSequence: () => unknown }).getSequence() });
      this.loaded = {
        compress: (t: string) => session.prompt(t1Prompt(t), { temperature: 0, maxTokens: Math.min(1024, opts.budgetTokens * 2) }),
        footprintMb: () => Math.round(process.memoryUsage().rss / 1048576),
      };
      this.log?.('info', 'T1 llama.cpp model loaded');
    }
    return this.loaded.compress(text);
  }
}

/* ------------------------------------------------------------ orchestrator */

export type CompressFn = (text: string, opts: CompressOptions) => CompressResult;

export interface T1Outcome {
  tier: 'T0' | 'T1';
  /** Why T1 did or did not run. Always populated. */
  reason: string;
  backend?: string;
  /** Set when T1 ran but its output was rejected. */
  rejected?: string;
  missingIdentifiers?: string[];
  missingSpans?: string[];
  tookMs?: number;
}

export interface T1Result extends CompressResult {
  t1: T1Outcome;
}

export interface T1CompressorOptions {
  backend?: T1Backend;
  /** Injected so tests can drive T0 deterministically. */
  t0: CompressFn;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Memory gate inputs. */
  totalMemBytes?: () => number;
  lowEndMode?: LowEndMode;
  minRamBytes?: number;
  timeoutMs?: number;
}

export class T1Compressor {
  constructor(private readonly opts: T1CompressorOptions) {}

  gate(): GateDecision {
    const total = (this.opts.totalMemBytes ?? os.totalmem)();
    return shouldEnableT1(total, {
      lowEndMode: this.opts.lowEndMode ?? 'auto',
      ...(this.opts.minRamBytes ? { minRamBytes: this.opts.minRamBytes } : {}),
    });
  }

  /**
   * Compress with T0, then optionally T1 — and return T0's output unless T1's
   * is provably safe and shorter.
   */
  async compress(
    text: string,
    opts: CompressOptions = {},
    /** A T0 result already computed elsewhere (e.g. on the worker thread). */
    precomputedBase?: CompressResult,
  ): Promise<T1Result> {
    const base = precomputedBase ?? this.opts.t0(text, opts);
    const gate = this.gate();

    const fallback = (outcome: T1Outcome): T1Result => {
      this.opts.log(
        outcome.rejected ? 'warn' : 'info',
        `T1 ${outcome.tier === 'T1' ? 'used' : 'skipped'}: ${outcome.reason}`,
      );
      return { ...base, t1: outcome };
    };

    if (!gate.enable) return fallback({ tier: 'T0', reason: gate.reason });

    const backend = this.opts.backend;
    if (!backend) return fallback({ tier: 'T0', reason: 'no T1 backend configured' });

    if (!(await backend.available().catch(() => false))) {
      return fallback({ tier: 'T0', reason: `T1 backend "${backend.name}" is not available` });
    }

    if (backend.footprint === 'in-process') {
      const mb = backend.footprintMb?.();
      if (mb !== undefined && mb > FOOTPRINT_BAND_MB.max) {
        return fallback({
          tier: 'T0',
          reason: `T1 footprint ${mb} MB exceeds the ${FOOTPRINT_BAND_MB.max} MB band`,
        });
      }
    }

    const started = Date.now();
    let candidate: string;
    try {
      candidate = await backend.compress(base.text, {
        budgetTokens: opts.budgetTokens ?? 4096,
        ...(this.opts.timeoutMs ? { timeoutMs: this.opts.timeoutMs } : {}),
      });
    } catch (err) {
      return fallback({
        tier: 'T0',
        backend: backend.name,
        reason: `T1 backend failed (${(err as Error).message}) — using T0`,
        rejected: (err as Error).message,
      });
    }

    // Guard 1: identifiers, compared against the ORIGINAL text, not T0's output.
    const ids = verifyIdentifiers(text, candidate);
    if (!ids.ok) {
      return fallback({
        tier: 'T0',
        backend: backend.name,
        reason: `T1 dropped ${ids.missing.length} identifier(s) — using T0`,
        rejected: 'identifiers',
        missingIdentifiers: ids.missing.slice(0, 20),
      });
    }

    // Guard 2: protected spans survive byte-for-byte.
    const spans = verifyProtectedSpans(text, candidate);
    if (!spans.ok) {
      return fallback({
        tier: 'T0',
        backend: backend.name,
        reason: `T1 damaged ${spans.missing.length} protected span(s) — using T0`,
        rejected: 'protected-spans',
        missingSpans: spans.missing.slice(0, 5),
      });
    }

    // Guard 3: it must actually be an improvement.
    const t0Tokens = countTokens(base.text);
    const t1Tokens = countTokens(candidate);
    if (t1Tokens >= t0Tokens) {
      return fallback({
        tier: 'T0',
        backend: backend.name,
        reason: `T1 produced no saving (${t0Tokens} → ${t1Tokens} tokens) — using T0`,
        rejected: 'no-saving',
      });
    }

    this.opts.log(
      'info',
      `T1 (${backend.name}): ${base.tokensBefore} → ${t1Tokens} tokens, ${ids.checked} identifier(s) preserved`,
    );
    return {
      ...base,
      text: candidate,
      tokensAfter: t1Tokens,
      ratio: base.tokensBefore === 0 ? 1 : Math.round((t1Tokens / base.tokensBefore) * 1000) / 1000,
      savedChars: text.length - candidate.length,
      cacheHit: false,
      t1: {
        tier: 'T1',
        backend: backend.name,
        reason: `${ids.checked} identifier(s) preserved, ${t0Tokens - t1Tokens} tokens saved over T0`,
        tookMs: Date.now() - started,
      },
    };
  }
}

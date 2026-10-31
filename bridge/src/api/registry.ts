/**
 * Batch 8.0 — the endpoint registry.
 *
 * Adapted from `src/providers/openai/OpenAICompatProvider.ts` and
 * `src/providers/openai/customConfig.ts` of AppsGanin/ai-free-vscode
 * (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * Three decisions worth stating, because each one is a way this could go wrong:
 *
 *  1. **Keys are never persisted.** They arrive over the loopback socket that is
 *     already token-authenticated, live in a `Map` for the life of the bridge
 *     process, and fall back to `AI_BRIDGE_API_KEY_<ID>` from the environment.
 *     The extension owns durable storage (VS Code SecretStorage, batch 8.0b).
 *  2. **The model cache is keyed on the base URL.** Re-pointing an endpoint
 *     drops the old catalogue instead of serving it from a stale entry — the
 *     bug that makes a picker offer models the endpoint no longer has.
 *  3. **A refused credential is forgotten, not retried.** `forgetRejected` means
 *     the next call reports "signed out" instead of replaying the same dead key
 *     through every provider in the router chain.
 */

import { AuthExpiredError, ConfigError } from './errors';
import { fromApiModelId, toApiModelId } from './modelId';
import {
  listModels,
  needsKey,
  streamChatCompletion,
  type ApiClientOptions,
} from './openaiCompat';
import {
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type ApiChunk,
  type ApiModelConfig,
  type ApiModelInfo,
  type ApiProviderConfig,
  type ApiProviderStatus,
  type ApiRequest,
} from './types';

/** Endpoint ids appear in model ids and in env var names, so keep them tame. */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Mirrors `bridge/src/adapters/models.ts`. Unknown counts as paid: a free tier
 * assumed paid costs a wasted choice, a paid tier assumed free costs money.
 */
const FREE_HINTS = /\b(free|basic|mini|nano|flash|lite|haiku|small|economy|standard)\b/i;

export function isFreeLabel(label: string): boolean {
  return FREE_HINTS.test(label);
}

export type ApiValidation =
  | { ok: true; config: ApiProviderConfig }
  | { ok: false; error: string };

function toModelConfig(raw: unknown): ApiModelConfig | undefined {
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id ? { id } : undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return undefined;
  return {
    id,
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    ...(typeof record.maxInputTokens === 'number'
      ? { maxInputTokens: record.maxInputTokens }
      : {}),
    ...(typeof record.maxOutputTokens === 'number'
      ? { maxOutputTokens: record.maxOutputTokens }
      : {}),
    ...(typeof record.toolCalling === 'boolean' ? { toolCalling: record.toolCalling } : {}),
    ...(typeof record.imageInput === 'boolean' ? { imageInput: record.imageInput } : {}),
    ...(typeof record.thinking === 'boolean' ? { thinking: record.thinking } : {}),
  };
}

/** Validates one endpoint from configuration. Rejects with a reason, never silently. */
export function validateApiProvider(raw: unknown): ApiValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      error: `invalid id "${String(record.id ?? '')}" — letters, digits, dot, dash, underscore`,
    };
  }

  const name =
    typeof record.name === 'string' && record.name.trim() ? record.name.trim() : id;

  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  if (!baseUrl) return { ok: false, error: 'baseUrl is required' };
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, error: `baseUrl is not a URL: ${baseUrl}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `baseUrl must be http or https: ${baseUrl}` };
  }

  const models = Array.isArray(record.models)
    ? record.models.map(toModelConfig).filter((m): m is ApiModelConfig => Boolean(m))
    : [];

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
      id,
      name,
      baseUrl,
      enabled: record.enabled !== false,
      noApiKey: record.noApiKey === true,
      models,
      ...(typeof record.maxInputTokens === 'number'
        ? { maxInputTokens: record.maxInputTokens }
        : {}),
      ...(typeof record.maxOutputTokens === 'number'
        ? { maxOutputTokens: record.maxOutputTokens }
        : {}),
      ...(typeof record.toolCalling === 'boolean' ? { toolCalling: record.toolCalling } : {}),
      ...(typeof record.imageInput === 'boolean' ? { imageInput: record.imageInput } : {}),
      ...(typeof record.thinking === 'boolean' ? { thinking: record.thinking } : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
    },
  };
}

function toModelInfo(config: ApiProviderConfig, upstreamId: string): ApiModelInfo {
  const pinned = config.models?.find((model) => model.id === upstreamId);
  const label = pinned?.name ?? upstreamId;
  return {
    id: toApiModelId(config.id, upstreamId),
    label,
    providerId: config.id,
    upstreamId,
    isFree: isFreeLabel(label),
    maxInputTokens: pinned?.maxInputTokens ?? config.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS,
    maxOutputTokens:
      pinned?.maxOutputTokens ?? config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    toolCalling: pinned?.toolCalling ?? config.toolCalling ?? true,
    thinking: pinned?.thinking ?? config.thinking ?? false,
  };
}

function modelsFromConfig(config: ApiProviderConfig): ApiModelInfo[] {
  return (config.models ?? []).map((model) => toModelInfo(config, model.id));
}

export interface ApiRegistryOptions extends ApiClientOptions {
  log?: (message: string) => void;
  /** Injected for tests; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

export class ApiRegistry {
  private readonly configs = new Map<string, ApiProviderConfig>();
  private readonly keys = new Map<string, string>();
  private readonly cache = new Map<string, { baseUrl: string; models: ApiModelInfo[] }>();
  private readonly failures = new Map<string, string>();

  constructor(private readonly opts: ApiRegistryOptions = {}) {}

  /**
   * Replaces the configured endpoints.
   *
   * A key is kept for an endpoint that survives validation and dropped for one
   * that does not — a rejected endpoint must not leave a credential in memory.
   */
  setProviders(
    raw: unknown[],
    keys: Record<string, string> = {},
  ): { accepted: string[]; rejected: Array<{ id: string; error: string }> } {
    const accepted: string[] = [];
    const rejected: Array<{ id: string; error: string }> = [];
    const seen = new Set<string>();
    const next = new Map<string, ApiProviderConfig>();

    for (const item of raw) {
      const verdict = validateApiProvider(item);
      if (!verdict.ok) {
        const id = (item as { id?: unknown } | null)?.id;
        rejected.push({ id: typeof id === 'string' ? id : '?', error: verdict.error });
        continue;
      }
      if (seen.has(verdict.config.id)) {
        rejected.push({ id: verdict.config.id, error: 'duplicate id' });
        continue;
      }
      seen.add(verdict.config.id);
      next.set(verdict.config.id, verdict.config);
      accepted.push(verdict.config.id);
    }

    for (const [id, key] of Object.entries(keys)) {
      if (next.has(id) && key) this.keys.set(id, key);
    }
    for (const id of [...this.keys.keys()]) {
      if (!next.has(id)) this.keys.delete(id);
    }

    this.configs.clear();
    for (const [id, config] of next) this.configs.set(id, config);
    for (const id of [...this.cache.keys()]) {
      if (!this.configs.has(id)) this.cache.delete(id);
    }
    for (const id of [...this.failures.keys()]) {
      if (!this.configs.has(id)) this.failures.delete(id);
    }

    this.opts.log?.(
      `api: ${accepted.length} endpoint(s) accepted, ${rejected.length} rejected`,
    );
    return { accepted, rejected };
  }

  setKey(providerId: string, key: string): void {
    if (key) this.keys.set(providerId, key);
    else this.keys.delete(providerId);
  }

  /** In-memory key, else `AI_BRIDGE_API_KEY_<ID>`. Never the disk. */
  keyFor(config: ApiProviderConfig): string | undefined {
    const direct = this.keys.get(config.id);
    if (direct) return direct;
    const envName = `AI_BRIDGE_API_KEY_${config.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const fromEnv = (this.opts.env ?? process.env)[envName];
    return fromEnv || undefined;
  }

  signedIn(config: ApiProviderConfig): boolean {
    return config.noApiKey === true || Boolean(this.keyFor(config));
  }

  /** Drops a credential the server refused, so the next call reports signed out. */
  forgetRejected(providerId: string): boolean {
    return this.keys.delete(providerId);
  }

  providerList(): ApiProviderConfig[] {
    return [...this.configs.values()];
  }

  /** The picker's list: cached catalogues, explicit ones, nothing invented. */
  modelList(): ApiModelInfo[] {
    const models: ApiModelInfo[] = [];
    for (const config of this.configs.values()) {
      if (config.enabled === false) continue;
      const cached = this.cache.get(config.id);
      if (cached && cached.baseUrl === config.baseUrl) models.push(...cached.models);
      else models.push(...modelsFromConfig(config));
    }
    return models;
  }

  /**
   * Fetches catalogues. An endpoint with a pinned model list is never asked —
   * pinning is how a user keeps an OpenRouter-sized catalogue short.
   */
  async refresh(providerId?: string): Promise<ApiModelInfo[]> {
    const targets: ApiProviderConfig[] = [];
    if (providerId) {
      const one = this.configs.get(providerId);
      if (one) targets.push(one);
    } else {
      targets.push(...this.configs.values());
    }

    for (const config of targets) {
      if (config.enabled === false) continue;
      if (config.models?.length) {
        this.cache.set(config.id, {
          baseUrl: config.baseUrl,
          models: modelsFromConfig(config),
        });
        this.failures.delete(config.id);
        continue;
      }
      try {
        const ids = await listModels(config, this.keyFor(config), {
          ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
          ...(this.opts.idleTimeoutMs !== undefined
            ? { idleTimeoutMs: this.opts.idleTimeoutMs }
            : {}),
        });
        this.cache.set(config.id, {
          baseUrl: config.baseUrl,
          models: ids.map((id) => toModelInfo(config, id)),
        });
        this.failures.delete(config.id);
      } catch (err) {
        const message = (err as Error).message;
        this.failures.set(config.id, message);
        this.opts.log?.(`api: ${config.id} model list failed — ${message}`);
      }
    }

    return this.modelList();
  }

  /** Namespaced model id → the endpoint that serves it. */
  resolve(modelId: string): { config: ApiProviderConfig; upstreamId: string } | undefined {
    const parsed = fromApiModelId(modelId);
    if (!parsed) return undefined;
    const config = this.configs.get(parsed.providerId);
    if (!config || config.enabled === false) return undefined;
    return { config, upstreamId: parsed.upstreamId };
  }

  /** Streams one answer. A keyed endpoint with no key fails before any request. */
  async *stream(request: ApiRequest): AsyncIterable<ApiChunk> {
    const target = this.resolve(request.model);
    if (!target) throw new ConfigError(`unknown model "${request.model}"`);

    const key = this.keyFor(target.config);
    if (needsKey(target.config) && !key) throw new AuthExpiredError(target.config.id);

    try {
      yield* streamChatCompletion(target.config, key, request, this.opts);
      this.failures.delete(target.config.id);
    } catch (err) {
      this.failures.set(target.config.id, (err as Error).message);
      throw err;
    }
  }

  statuses(): ApiProviderStatus[] {
    return [...this.configs.values()].map((config) => {
      const cached = this.cache.get(config.id);
      const count =
        cached && cached.baseUrl === config.baseUrl
          ? cached.models.length
          : modelsFromConfig(config).length;
      const failure = this.failures.get(config.id);
      return {
        id: config.id,
        name: config.name,
        baseUrl: config.baseUrl,
        enabled: config.enabled !== false,
        signedIn: this.signedIn(config),
        modelCount: count,
        ...(failure ? { lastError: failure } : {}),
      };
    });
  }
}

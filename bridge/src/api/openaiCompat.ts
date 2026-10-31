/**
 * Batch 8.0 — the OpenAI-compatible client.
 *
 * Adapted from `src/providers/openai/OpenAICompatApiClient.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * What is deliberately kept from upstream:
 *
 *  - a bare origin gains `/v1` (`http://localhost:1234` and `.../v1` are one
 *    endpoint), while an existing `/vN` base is left alone;
 *  - tool calls are accumulated BY INDEX across chunks, because the arguments
 *    arrive in pieces and the name may arrive after the id;
 *  - reasoning is surfaced separately (`reasoning_content` or `reasoning`), never
 *    folded into the answer;
 *  - usage is reported when the endpoint sends it, and is `undefined` when it
 *    does not — never a fabricated zero.
 *
 * What differs: `fetch` is injectable (so a test drives a real socket without
 * patching globals), and a dropped connection is retried twice before it becomes
 * an error.
 */

import {
  ApiError,
  NetworkError,
  errToString,
  isAbortError,
  isNetworkFailure,
  throwForStatus,
} from './errors';
import { fromApiModelId } from './modelId';
import { readText, sseEvents } from './stream';
import type {
  ApiChunk,
  ApiMessage,
  ApiProviderConfig,
  ApiRequest,
  ApiStreamResult,
  ApiToolCall,
} from './types';

export type FetchLike = typeof fetch;

export interface ApiClientOptions {
  /** Injected by tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Max pause between reads on a stream. Defaults to 30 s. */
  idleTimeoutMs?: number;
  /** Delays for a dropped connection, before it surfaces. */
  networkRetryDelaysMs?: readonly number[];
}

const DEFAULT_NETWORK_RETRY_DELAYS_MS = [800, 2_500] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `http://localhost:1234` → `http://localhost:1234/v1`;
 * `https://openrouter.ai/api/v1` → unchanged.
 */
export function resolveBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/v\d+$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/** True when the endpoint needs a credential to be usable. */
export function needsKey(config: ApiProviderConfig): boolean {
  return config.noApiKey !== true;
}

export function authHeaders(
  config: ApiProviderConfig,
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.headers ?? {}),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/** The upstream id of a request whose `model` may or may not be namespaced. */
function upstreamIdOf(model: string): string {
  return fromApiModelId(model)?.upstreamId ?? model;
}

/** The chat-completions message shape, including tool traffic. */
function toOpenAiMessages(messages: ApiMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? 'call_0',
        content: message.content,
      };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/**
 * `GET {base}/models`.
 *
 * Accepts `{data:[{id}]}`, `{models:[{id}]}` and a bare array of strings, and
 * ignores anything else — a free tier that changes its catalogue shape should
 * produce an empty list, not an exception.
 */
export async function listModels(
  config: ApiProviderConfig,
  apiKey: string | undefined,
  opts: ApiClientOptions = {},
): Promise<string[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${resolveBaseUrl(config.baseUrl)}/models`;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: authHeaders(config, apiKey) });
  } catch (err) {
    if (isNetworkFailure(err)) throw new NetworkError(`${config.id}: ${errToString(err)}`);
    throw err;
  }
  throwForStatus(config.id, response);

  const payload = (await response.json().catch(() => ({}))) as {
    data?: unknown;
    models?: unknown;
  };
  const rows = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [];

  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row === 'string') {
      ids.push(row.trim());
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; name?: unknown };
    const id = typeof record.id === 'string' ? record.id : record.name;
    if (typeof id === 'string' && id.trim()) ids.push(id.trim());
  }
  return [...new Set(ids.filter(Boolean))];
}

interface OpenAiDelta {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAiPayload {
  choices?: Array<{ delta?: OpenAiDelta; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * `POST {base}/chat/completions` with `stream: true`, yielding typed chunks.
 *
 * A tool call is emitted once, at the end, after its arguments have finished
 * arriving — a caller that reacts to `tool_call` can therefore parse the
 * arguments immediately instead of reassembling them itself.
 */
export async function* streamChatCompletion(
  config: ApiProviderConfig,
  apiKey: string | undefined,
  request: ApiRequest,
  opts: ApiClientOptions = {},
): AsyncIterable<ApiChunk> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${resolveBaseUrl(config.baseUrl)}/chat/completions`;

  const body: Record<string, unknown> = {
    model: upstreamIdOf(request.model),
    messages: toOpenAiMessages(request.messages),
    stream: true,
    // Without this an OpenAI-compatible endpoint reports no usage at all.
    stream_options: { include_usage: true },
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
      },
    }));
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

  const delays = opts.networkRetryDelaysMs ?? DEFAULT_NETWORK_RETRY_DELAYS_MS;
  let response: Response | undefined;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: authHeaders(config, apiKey),
        body: JSON.stringify(body),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      break;
    } catch (err) {
      if (isAbortError(err, request.signal)) throw err;
      const delay = delays[attempt];
      if (delay === undefined || !isNetworkFailure(err)) {
        throw new NetworkError(`${config.id}: ${errToString(err)}`);
      }
      await sleep(delay);
    }
  }

  if (!response) throw new NetworkError(`${config.id}: no response`);
  throwForStatus(config.id, response);
  if (!response.body) throw new ApiError('ESTREAM', `${config.id}: response has no body`);

  const pending = new Map<number, ApiToolCall>();
  const idleTimeoutMs = opts.idleTimeoutMs;

  for await (const event of sseEvents(
    readText(response.body, {
      providerId: config.id,
      ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    }),
  )) {
    if (event.data === '[DONE]') break;

    let payload: OpenAiPayload;
    try {
      payload = JSON.parse(event.data) as OpenAiPayload;
    } catch {
      continue; // a keep-alive or a comment frame
    }

    const delta = payload.choices?.[0]?.delta;
    if (delta) {
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        yield { type: 'thinking', text: reasoning };
      }
      if (typeof delta.content === 'string' && delta.content) {
        yield { type: 'text', text: delta.content };
      }

      for (const call of delta.tool_calls ?? []) {
        const index = typeof call.index === 'number' ? call.index : 0;
        const current = pending.get(index) ?? {
          id: call.id ?? `call_${index}`,
          name: '',
          arguments: '',
        };
        if (call.id) current.id = call.id;
        const name = call.function?.name;
        if (name) {
          // Some endpoints resend the whole name, some stream it in pieces.
          if (!current.name) current.name = name;
          else if (name.length > current.name.length && name.startsWith(current.name)) {
            current.name = name;
          }
        }
        if (typeof call.function?.arguments === 'string') {
          current.arguments += call.function.arguments;
        }
        pending.set(index, current);
      }
    }

    if (payload.usage) {
      yield {
        type: 'usage',
        promptTokens: payload.usage.prompt_tokens ?? 0,
        completionTokens: payload.usage.completion_tokens ?? 0,
      };
    }
  }

  for (const [, call] of [...pending].sort((a, b) => a[0] - b[0])) {
    if (!call.name) continue;
    yield {
      type: 'tool_call',
      id: call.id,
      name: call.name,
      arguments: call.arguments || '{}',
    };
  }
}

/** Drains a chunk stream into one answer — for callers that do not render. */
export async function collectStream(
  stream: AsyncIterable<ApiChunk>,
  meta: { modelId: string; providerId: string; startedAt?: number },
): Promise<ApiStreamResult> {
  const startedAt = meta.startedAt ?? Date.now();
  let text = '';
  let thinking = '';
  const toolCalls: ApiToolCall[] = [];
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let firstTokenMs: number | null = null;

  for await (const chunk of stream) {
    if (chunk.type === 'text') {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
      text += chunk.text;
    } else if (chunk.type === 'thinking') {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
      thinking += chunk.text;
    } else if (chunk.type === 'tool_call') {
      toolCalls.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
    } else if (chunk.type === 'usage') {
      promptTokens = chunk.promptTokens;
      completionTokens = chunk.completionTokens;
    }
  }

  return {
    text,
    thinking,
    toolCalls,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    firstTokenMs,
    totalMs: Date.now() - startedAt,
    modelId: meta.modelId,
    providerId: meta.providerId,
  };
}

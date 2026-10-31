/**
 * Batch 8.0 — OpenAI-compatible API transport, shapes.
 *
 * Adapted from `src/providers/types.ts` and `src/providers/openai/customConfig.ts`
 * of AppsGanin/ai-free-vscode (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * Deliberately free of `vscode` and of `@ai-bridge/shared`: this module runs in
 * the bridge process and must stay host-neutral, so a second host (the panel, a
 * test, a future CLI) can drive it unchanged.
 */

export const DEFAULT_MAX_INPUT_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;

/** A model as the endpoint knows it, optionally pinned in configuration. */
export interface ApiModelConfig {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  thinking?: boolean;
}

/**
 * A user-defined endpoint that speaks `POST {baseUrl}/chat/completions`.
 *
 * Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, Groq, a corporate gateway —
 * anything OpenAI-compatible. Everything here is safe to put in settings; the
 * key is not part of this shape and never reaches the disk.
 */
export interface ApiProviderConfig {
  /** Slug, unique across endpoints. Part of every model id. */
  id: string;
  name: string;
  /** Base URL including the version segment, e.g. `http://localhost:1234/v1`. */
  baseUrl: string;
  enabled?: boolean;
  /** Local servers need no key; without this a keyless endpoint is "signed out". */
  noApiKey?: boolean;
  /** Explicit catalogue. When empty, models come from `GET {baseUrl}/models`. */
  models?: ApiModelConfig[];
  /** Defaults applied to every model of this endpoint. */
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  thinking?: boolean;
  /** Extra request headers, e.g. `HTTP-Referer` for OpenRouter. */
  headers?: Record<string, string>;
}

/** A model of a configured endpoint, as the picker sees it. */
export interface ApiModelInfo {
  /** Namespaced: `custom:<providerId>/<upstreamId>`. */
  id: string;
  label: string;
  providerId: string;
  upstreamId: string;
  /** Heuristic from the label — unknown counts as paid, as upstream does. */
  isFree: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  toolCalling: boolean;
  thinking: boolean;
  /** Whether the endpoint accepts images. Defaults to false — ask, do not assume. */
  imageInput: boolean;
}

export interface ApiToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the arguments. */
  parameters?: Record<string, unknown>;
}

export type ApiMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ApiToolCall {
  id: string;
  name: string;
  /** Raw JSON string as the model emitted it. */
  arguments: string;
}

/**
 * One part of a multimodal message.
 *
 * Batch 9.1 — images. `image_url.url` carries a `data:` URL, which is what every
 * OpenAI-compatible endpoint accepts for an inline image; there is no upload
 * step and nothing is fetched from anywhere.
 */
export type ApiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ApiMessage {
  role: ApiMessageRole;
  content: string | ApiContentPart[];
  /** For `role: 'tool'` — which call this answers. */
  toolCallId?: string;
  /** For `role: 'assistant'` — calls it made. */
  toolCalls?: ApiToolCall[];
}

export interface ApiRequest {
  /** Namespaced model id, as `ApiModelInfo.id`. */
  model: string;
  messages: ApiMessage[];
  tools?: ApiToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Ask for reasoning; ignored by endpoints that do not stream it. */
  thinking?: boolean;
  signal?: AbortSignal;
}

/** One piece of a streamed answer. */
export type ApiChunk =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number };

/** A whole answer, assembled — what a caller that is not streaming wants. */
export interface ApiStreamResult {
  text: string;
  thinking: string;
  toolCalls: ApiToolCall[];
  /** `undefined` when the endpoint did not report usage — never zero. */
  promptTokens?: number;
  completionTokens?: number;
  firstTokenMs: number | null;
  totalMs: number;
  modelId: string;
  providerId: string;
}

/** What the Providers tab needs to draw one endpoint. */
export interface ApiProviderStatus {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  /** A keyed endpoint with no key is signed out, not broken. */
  signedIn: boolean;
  modelCount: number;
  lastError?: string;
}

/**
 * Batch 8.2 — the thin `vscode` glue.
 *
 * Everything worth testing lives in `provider.ts`; this file only adapts the
 * editor's API to it, and is gated so that a VS Code without the language-model
 * API loads the extension exactly as before.
 *
 * Provenance: adapted in shape from AppsGanin/ai-free-vscode (MIT, commit
 * 6f53bad). See docs/batch8/attribution.md.
 */

import * as vscode from 'vscode';
import type { ControlEvent } from '@ai-bridge/shared';
import { AiBridgeLanguageModelProvider, VENDOR, lmRegistrar } from './provider';
import type {
  LmAskRequest,
  LmAskResult,
  LmBridge,
  LmBridgeModel,
  LmCancellation,
  LmPartFactory,
} from './types';

/** The slice of `BridgeClient` this batch uses, so the glue stays testable. */
export interface LmClient {
  request(message: unknown, timeoutMs?: number): Promise<unknown>;
  on(event: 'event', listener: (event: ControlEvent) => void): unknown;
  off?(event: 'event', listener: (event: ControlEvent) => void): unknown;
}

export interface RegisterOptions {
  /** Undefined until the bridge is up; the provider then lists nothing. */
  client(): LmClient | undefined;
  log(message: string): void;
}

const DOM_INPUT_TOKENS = 100_000;
const DOM_OUTPUT_TOKENS = 8_000;

/**
 * The editor's part classes, feature-detected.
 *
 * `LanguageModelThinkingPart` is the youngest of the three; when it is absent the
 * provider is built without a thinking channel rather than reporting a part the
 * editor cannot render.
 */
function partFactory(): LmPartFactory {
  const api = vscode as unknown as {
    LanguageModelTextPart?: new (value: string) => unknown;
    LanguageModelToolCallPart?: new (callId: string, name: string, input: unknown) => unknown;
    LanguageModelThinkingPart?: new (value: string) => unknown;
  };

  const Text = api.LanguageModelTextPart;
  const ToolCall = api.LanguageModelToolCallPart;
  const Thinking = api.LanguageModelThinkingPart;

  return {
    text: (value) => (Text ? new Text(value) : { value }),
    toolCall: (callId, name, input) =>
      ToolCall ? new ToolCall(callId, name, input) : { callId, name, input },
    ...(Thinking ? { thinking: (value: string) => new Thinking(value) } : {}),
  };
}

interface ApiModelRow {
  id: string;
  label: string;
  providerId: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
}

interface AdapterRow {
  id: string;
  label: string;
}

let sequence = 0;

function makeBridge(opts: RegisterOptions): LmBridge {
  return {
    async listModels(): Promise<LmBridgeModel[]> {
      const client = opts.client();
      if (!client) return [];
      const models: LmBridgeModel[] = [];

      // Endpoints (batch 8.0) — every discovered model is its own entry.
      try {
        const status = (await client.request({ op: 'ctl.api.status' })) as {
          models?: ApiModelRow[];
        };
        for (const row of status?.models ?? []) {
          models.push({
            id: row.id,
            label: row.label,
            kind: 'api',
            maxInputTokens: row.maxInputTokens ?? 128_000,
            maxOutputTokens: row.maxOutputTokens ?? 8_192,
            toolCalling: row.toolCalling !== false,
            source: row.providerId,
          });
        }
      } catch (err) {
        opts.log(`lm: endpoint models unavailable — ${(err as Error).message}`);
      }

      // Web chats — one entry per adapter. Which model answers is whatever the
      // tab has selected, so the label says so instead of inventing a name.
      try {
        const list = (await client.request({ op: 'ctl.adapters' })) as {
          adapters?: AdapterRow[];
        };
        for (const row of list?.adapters ?? []) {
          models.push({
            id: `dom:${row.id}`,
            label: `${row.label} (tab)`,
            kind: 'dom',
            maxInputTokens: DOM_INPUT_TOKENS,
            maxOutputTokens: DOM_OUTPUT_TOKENS,
            // The DOM path has no tool channel: `ctl.prompt` takes text only.
            toolCalling: false,
            source: row.id,
          });
        }
      } catch (err) {
        opts.log(`lm: adapters unavailable — ${(err as Error).message}`);
      }

      return models;
    },

    async ask(request: LmAskRequest, cancellation: LmCancellation): Promise<LmAskResult> {
      const client = opts.client();
      if (!client) throw new Error('ENOBRIDGE: the bridge is not running');

      if (request.model.kind === 'dom') {
        // A web chat takes one prompt and answers in prose. No tool channel, no
        // streaming contract — `ctl.prompt` settles the answer before returning.
        const result = (await client.request({
          op: 'ctl.prompt',
          adapterId: request.model.source,
          text: promptText(request),
          debounceMs: 400,
          timeoutMs: 120_000,
        })) as { text?: string };
        return {
          text: result?.text ?? '',
          thinking: '',
          toolCalls: [],
          cancelled: cancellation.isCancellationRequested,
        };
      }

      const requestId = `lm-${Date.now()}-${(sequence += 1)}`;
      const onEvent = (event: ControlEvent) => {
        const data = event.data as { requestId?: string; text?: string };
        if (data?.requestId !== requestId) return;
        if (event.kind === 'stream.delta' && typeof data.text === 'string') {
          request.onText?.(data.text);
        } else if (event.kind === 'stream.thinking' && typeof data.text === 'string') {
          request.onThinking?.(data.text);
        }
      };

      client.on('event', onEvent);
      const stopListening = () => client.off?.('event', onEvent);
      const cancelSubscription = cancellation.onCancellationRequested?.(() => {
        void client.request({ op: 'ctl.api.cancel', requestId }).catch(() => undefined);
      });

      try {
        const result = (await client.request({
          op: 'ctl.api.prompt',
          model: request.model.id,
          requestId,
          messages: apiMessages(request),
          ...(request.tools.length
            ? {
                tools: request.tools.map((tool) => ({
                  name: tool.name,
                  ...(tool.description ? { description: tool.description } : {}),
                  ...(tool.inputSchema !== undefined ? { parameters: tool.inputSchema } : {}),
                })),
              }
            : {}),
          promptToolProtocol: request.promptToolProtocol,
        })) as {
          text?: string;
          thinking?: string;
          cancelled?: boolean;
          toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
        };

        return {
          text: result?.text ?? '',
          thinking: result?.thinking ?? '',
          toolCalls: result?.toolCalls ?? [],
          cancelled: result?.cancelled === true || cancellation.isCancellationRequested,
        };
      } finally {
        stopListening();
        cancelSubscription?.dispose();
      }
    },
  };
}

/** Flattens parts into the wire message shape the bridge accepts. */
function apiMessages(request: LmAskRequest): Array<{ role: string; content: string; toolCallId?: string }> {
  const out: Array<{ role: string; content: string; toolCallId?: string }> = [];
  for (const message of request.messages) {
    for (const part of message.parts) {
      if (part.kind === 'text') {
        out.push({ role: message.role, content: part.text });
      } else if (part.kind === 'toolResult') {
        out.push({ role: 'tool', content: part.content, toolCallId: part.callId });
      }
    }
  }
  return out;
}

/** The single prompt string a web chat receives. */
function promptText(request: LmAskRequest): string {
  const lines: string[] = [];
  for (const message of request.messages) {
    const text = message.parts
      .map((part) => {
        if (part.kind === 'text') return part.text;
        if (part.kind === 'toolResult') return `[tool result ${part.callId}] ${part.content}`;
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (text.trim()) {
      lines.push(`${message.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`);
    }
  }
  return [...lines, 'Assistant:'].join('\n\n');
}

/**
 * Registers the provider when this VS Code can host one.
 *
 * @returns a disposable, or `undefined` on a version without the API — which is
 * a normal outcome, not an error.
 */
export function registerAiBridgeLanguageModel(
  opts: RegisterOptions,
): vscode.Disposable | undefined {
  const lm = (vscode as unknown as { lm?: unknown }).lm;
  const register = lmRegistrar(lm as never);
  if (!register) {
    opts.log('lm: this VS Code has no language-model provider API — skipping');
    return undefined;
  }

  const provider = new AiBridgeLanguageModelProvider({
    bridge: makeBridge(opts),
    parts: partFactory(),
    log: opts.log,
  });

  const disposable = register.call(lm, VENDOR, provider) as { dispose(): void } | undefined;
  opts.log(`lm: registered "${VENDOR}" with Copilot Chat`);
  return disposable as unknown as vscode.Disposable;
}

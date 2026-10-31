/**
 * Batch 8.1 — turning a provider's stream into what a chat host shows.
 *
 * Adapted from `src/providers/common/responseAssembler.ts` of
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * Host-neutral by design: the sink is three functions, so the bridge can turn
 * them into control events, a test into an array, and a future panel into
 * messages — without any of them knowing how a tool call is spelled.
 *
 * Two paths, one output:
 *
 *  - `assembleNative` — the endpoint speaks the tools API; calls arrive as
 *    chunks and only need re-typing.
 *  - `assemblePrompt` — the tools travelled as prompt text; calls have to be
 *    found and scrubbed, which is what the router is for.
 *
 * The prompt path also runs over the reasoning channel, because a model with
 * tools and thinking on will sometimes write the call inside its reasoning and
 * then answer as if it had called the tool.
 */

import type { ApiChunk, ApiToolDefinition } from '../api/types';
import { StreamingToolCallRouter } from './streamingRouter';
import { retypeArguments, type ParsedToolCall } from './toolCalling';

export interface AssembledToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** The raw JSON the model wrote, for a wire that expects a string. */
  raw: string;
}

export interface ResponseSink {
  text(part: string): void;
  thinking(part: string): void;
  toolCall(call: AssembledToolCall): void;
  usage?(promptTokens: number, completionTokens: number): void;
}

export interface AssembleOptions {
  tools?: ReadonlyArray<ApiToolDefinition>;
  /** True when tools travelled as prompt text and must be scrubbed from output. */
  promptToolProtocol: boolean;
  /** Polled per chunk; true stops reading (the user cancelled). */
  isCancelled?: () => boolean;
  /** Called when text was dropped as a transcript echo. */
  onDrop?: (reason: string, chars: number) => void;
}

export interface AssembledResult {
  textChars: number;
  thinkingChars: number;
  toolCalls: AssembledToolCall[];
  promptTokens?: number;
  completionTokens?: number;
}

function schemaFor(
  tools: ReadonlyArray<ApiToolDefinition> | undefined,
  name: string,
): Record<string, unknown> | undefined {
  return tools?.find((tool) => tool.name === name)?.parameters;
}

/** A counter shared by the sink and the result. */
class Tally {
  text = 0;
  thinking = 0;
  calls: AssembledToolCall[] = [];
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  private sequence = 0;

  nextCallId(): string {
    this.sequence += 1;
    return `call_${this.sequence}`;
  }
}

function makeSink(
  sink: ResponseSink,
  tally: Tally,
  tools: ReadonlyArray<ApiToolDefinition> | undefined,
): ResponseSink {
  return {
    text(part: string) {
      if (!part) return;
      tally.text += part.length;
      sink.text(part);
    },
    thinking(part: string) {
      if (!part) return;
      tally.thinking += part.length;
      sink.thinking(part);
    },
    toolCall(call: AssembledToolCall) {
      tally.calls.push(call);
      sink.toolCall(call);
    },
    usage(promptTokens: number, completionTokens: number) {
      tally.promptTokens = promptTokens;
      tally.completionTokens = completionTokens;
      sink.usage?.(promptTokens, completionTokens);
    },
  };
}

function toAssembled(
  call: ParsedToolCall,
  tools: ReadonlyArray<ApiToolDefinition> | undefined,
  id: string,
): AssembledToolCall {
  const args = retypeArguments(call.arguments, schemaFor(tools, call.name));
  return { id, name: call.name, arguments: args, raw: JSON.stringify(args) };
}

function result(tally: Tally): AssembledResult {
  return {
    textChars: tally.text,
    thinkingChars: tally.thinking,
    toolCalls: tally.calls,
    ...(tally.promptTokens !== undefined ? { promptTokens: tally.promptTokens } : {}),
    ...(tally.completionTokens !== undefined ? { completionTokens: tally.completionTokens } : {}),
  };
}

/**
 * The native path: text, reasoning, tool calls and usage arrive as typed chunks.
 *
 * With `promptToolProtocol` false this is close to a pass-through — the only
 * work is re-typing arguments against the schema, because a model that writes
 * `"limit": "20"` for a number is not a hypothetical.
 */
export async function assembleNative(
  stream: AsyncIterable<ApiChunk>,
  sink: ResponseSink,
  opts: AssembleOptions,
): Promise<AssembledResult> {
  const tally = new Tally();
  const out = makeSink(sink, tally, opts.tools);

  // Only used when the protocol is in the prompt: then even a "native" text
  // channel may carry a call, and reasoning is scanned too.
  const textRouter = opts.promptToolProtocol
    ? new StreamingToolCallRouter({
        sink: {
          text: (part) => out.text(part),
          toolCall: (call) => out.toolCall(toAssembled(call, opts.tools, tally.nextCallId())),
          ...(opts.onDrop ? { dropped: opts.onDrop } : {}),
        },
      })
    : undefined;

  const thinkingRouter = opts.promptToolProtocol
    ? new StreamingToolCallRouter({
        sink: {
          text: (part) => out.thinking(part),
          toolCall: (call) => out.toolCall(toAssembled(call, opts.tools, tally.nextCallId())),
          ...(opts.onDrop ? { dropped: opts.onDrop } : {}),
        },
      })
    : undefined;

  for await (const chunk of stream) {
    if (opts.isCancelled?.()) break;

    switch (chunk.type) {
      case 'text':
        if (textRouter) textRouter.push(chunk.text);
        else out.text(chunk.text);
        break;
      case 'thinking':
        if (thinkingRouter) thinkingRouter.push(chunk.text);
        else out.thinking(chunk.text);
        break;
      case 'tool_call':
        out.toolCall(
          toAssembled(
            { name: chunk.name, arguments: safeJson(chunk.arguments), raw: chunk.arguments },
            opts.tools,
            chunk.id || tally.nextCallId(),
          ),
        );
        break;
      case 'usage':
        out.usage?.(chunk.promptTokens, chunk.completionTokens);
        break;
      default:
        break;
    }
  }

  textRouter?.flush();
  thinkingRouter?.flush();
  return result(tally);
}

/**
 * The prompt path: a web chat answers in prose, and the call — if any — is text
 * that has to be found, parsed and removed before the user sees it.
 */
export async function assemblePrompt(
  chunks: AsyncIterable<string>,
  sink: ResponseSink,
  opts: AssembleOptions,
): Promise<AssembledResult> {
  const tally = new Tally();
  const out = makeSink(sink, tally, opts.tools);

  const router = new StreamingToolCallRouter({
    sink: {
      text: (part) => out.text(part),
      toolCall: (call) => out.toolCall(toAssembled(call, opts.tools, tally.nextCallId())),
      ...(opts.onDrop ? { dropped: opts.onDrop } : {}),
    },
  });

  for await (const chunk of chunks) {
    if (opts.isCancelled?.()) break;
    router.push(chunk);
  }
  router.flush();

  return result(tally);
}

/** Tool-call arguments as an object; a malformed string is kept, not thrown. */
function safeJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw };
  }
}

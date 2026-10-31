/**
 * Batch 8.2 — the language-model provider, free of `vscode`.
 *
 * Adapted in shape from `src/vscode/VSCodeLMAdapter.ts` and `UnifiedProvider.ts`
 * of AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 *
 * Why the host is injected rather than imported: this file is the part with the
 * logic worth testing — model listing, message conversion, the native/prompt
 * tool decision, part ordering — and none of it needs an editor to be true. The
 * glue that touches `vscode` is `register.ts`, and it is deliberately thin.
 */

import type {
  LmApi,
  LmAskRequest,
  LmBridge,
  LmBridgeModel,
  LmCancellation,
  LmMessage,
  LmModelInfo,
  LmPart,
  LmPartFactory,
  LmProgress,
  LmTool,
} from './types';

/** Vendor id; must match `contributes.languageModelChatProviders`. */
export const VENDOR = 'ai-bridge';

/** Chars per token. Crude, and honest about being crude — see `countTokens`. */
const CHARS_PER_TOKEN = 4;

/**
 * The runtime gate.
 *
 * Returns the registrar when the running VS Code has the API, and `undefined`
 * when it does not. Callers must treat `undefined` as normal: on 1.90–1.103 the
 * extension works exactly as it did before this batch.
 */
export function lmRegistrar(api: LmApi | undefined): LmApi['registerLanguageModelChatProvider'] {
  const register = api?.registerLanguageModelChatProvider;
  return typeof register === 'function' ? register : undefined;
}

/** True when this build of VS Code can host the provider at all. */
export function canRegisterLanguageModelProvider(api: LmApi | undefined): boolean {
  return lmRegistrar(api) !== undefined;
}

/**
 * Token estimate for the API's `provideTokenCount`.
 *
 * A real tokenizer per backend is not worth shipping for a number the editor
 * only uses to size its own budget; four characters per token is the usual
 * approximation and errs high for prose, low for code. It is labelled an
 * estimate wherever it surfaces.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** Normalises one part of a `vscode.LanguageModelChatMessage`. */
function toPart(raw: unknown): LmPart | undefined {
  if (typeof raw === 'string') return { kind: 'text', text: raw };
  if (!raw || typeof raw !== 'object') return undefined;
  const part = raw as Record<string, unknown>;

  // LanguageModelTextPart
  if (typeof part.value === 'string') return { kind: 'text', text: part.value };
  // A tool call: callId + name + input
  if (typeof part.callId === 'string' && typeof part.name === 'string') {
    return { kind: 'toolCall', callId: part.callId, name: part.name, input: part.input };
  }
  // A tool result: callId + content (string or an array of parts)
  if (typeof part.callId === 'string' && 'content' in part) {
    const content = Array.isArray(part.content)
      ? part.content
          .map((entry) => toPart(entry))
          .filter((entry): entry is LmPart => Boolean(entry) && entry!.kind === 'text')
          .map((entry) => (entry as { text: string }).text)
          .join('')
      : typeof part.content === 'string'
        ? part.content
        : JSON.stringify(part.content);
    return { kind: 'toolResult', callId: part.callId, content };
  }
  return undefined;
}

/** Normalises a whole message list. Roles may arrive as numbers. */
export function toMessages(raw: readonly unknown[]): LmMessage[] {
  const messages: LmMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const message = entry as Record<string, unknown>;
    const roleRaw = message.role;
    // vscode.LanguageModelChatMessageRole: User = 1, Assistant = 2
    const role: 'user' | 'assistant' =
      roleRaw === 2 || roleRaw === 'assistant' ? 'assistant' : 'user';
    const content = Array.isArray(message.content) ? message.content : [];
    const parts = content
      .map((part) => toPart(part))
      .filter((part): part is LmPart => Boolean(part));
    if (parts.length) messages.push({ role, parts });
  }
  return messages;
}

/** Flattens parts into the single prompt string a web chat needs. */
export function toPromptText(messages: LmMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = message.parts
      .map((part) => {
        if (part.kind === 'text') return part.text;
        if (part.kind === 'toolResult') return `[tool result ${part.callId}] ${part.content}`;
        return `[called ${part.name}]`;
      })
      .join('\n');
    if (!text.trim()) continue;
    lines.push(`${message.role === 'assistant' ? 'Assistant' : 'User'}: ${text}`);
  }
  return [...lines, 'Assistant:'].join('\n\n');
}

/** The tools an endpoint or a web chat should be told about. */
export function toTools(raw: readonly unknown[] | undefined): LmTool[] {
  if (!Array.isArray(raw)) return [];
  const tools: LmTool[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const tool = entry as Record<string, unknown>;
    if (typeof tool.name !== 'string') continue;
    tools.push({
      name: tool.name,
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
    });
  }
  return tools;
}

export interface ProviderOptions {
  bridge: LmBridge;
  parts: LmPartFactory;
  log?: (message: string) => void;
}

/**
 * The provider the editor talks to.
 *
 * Streaming is reported as it arrives; a tool call is reported whole, after its
 * arguments have finished, because a half-parsed call is worse than a late one.
 */
export class AiBridgeLanguageModelProvider {
  constructor(private readonly opts: ProviderOptions) {}

  /** The model picker. Only what is actually usable is listed. */
  async provideLanguageModelChatInformation(): Promise<LmModelInfo[]> {
    let models: LmBridgeModel[] = [];
    try {
      models = await this.opts.bridge.listModels();
    } catch (err) {
      this.opts.log?.(`lm: could not list models — ${(err as Error).message}`);
      return [];
    }
    return models.map((model) => ({
      id: model.id,
      name: model.label,
      family: model.kind === 'api' ? 'AI Bridge endpoint' : 'AI Bridge tab',
      version: '1',
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      detail: model.kind === 'api' ? `endpoint: ${model.source}` : `tab: ${model.source}`,
      tooltip: model.toolCalling
        ? `${model.label} — tool calling on`
        : `${model.label} — tools travel as prompt text`,
      // The DOM path has no tool channel, so Copilot must not offer tools for it.
      capabilities: { toolCalling: model.toolCalling },
    }));
  }

  /** One answer, streamed into `progress`. */
  async provideLanguageModelChatResponse(
    modelId: string,
    rawMessages: readonly unknown[],
    options: { tools?: readonly unknown[] },
    progress: LmProgress,
    cancellation: LmCancellation,
  ): Promise<void> {
    const models = await this.opts.bridge.listModels();
    const model = models.find((entry) => entry.id === modelId);
    if (!model) throw new Error(`ENOMODEL: "${modelId}" is no longer available`);

    const messages = toMessages(rawMessages);
    const tools = toTools(options?.tools);
    // A DOM tab and a keyless endpoint cannot take tools structurally, so the
    // protocol goes into the prompt and comes back scrubbed.
    const promptToolProtocol = !model.toolCalling || model.kind === 'dom';

    // Tracked so a streamed answer is not reported a second time at the end.
    let streamed = false;

    const request: LmAskRequest = {
      model,
      messages,
      tools,
      promptToolProtocol,
      onText: (chunk) => {
        streamed = true;
        progress.report(this.opts.parts.text(chunk));
      },
      ...(this.opts.parts.thinking
        ? { onThinking: (chunk: string) => progress.report(this.opts.parts.thinking!(chunk)) }
        : {}),
    };

    const answer = await this.opts.bridge.ask(request, cancellation);
    if (answer.cancelled) return;

    // A buffered answer (the DOM path settles before returning) has not been
    // streamed, so it is reported now — exactly once. A streamed one has already
    // reached the editor, and repeating it would duplicate the whole reply.
    if (answer.text && !streamed) progress.report(this.opts.parts.text(answer.text));

    for (const call of answer.toolCalls) {
      progress.report(this.opts.parts.toolCall(call.id, call.name, call.arguments));
    }
  }

  /** What the editor uses to size its own budget. */
  async provideTokenCount(_modelId: string, text: unknown): Promise<number> {
    if (typeof text === 'string') return countTokens(text);
    const messages = toMessages(Array.isArray(text) ? text : []);
    return countTokens(toPromptText(messages));
  }
}

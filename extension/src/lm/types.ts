/**
 * Batch 8.2 — structural types for the VS Code language-model API.
 *
 * Deliberately NOT imported from `@types/vscode`. The API this batch uses
 * (`vscode.lm.registerLanguageModelChatProvider`) is newer than the `^1.90`
 * typings this extension compiles against, and the decision recorded in
 * docs/batch8/batch-8.2-copilot-provider.md is to **runtime-gate**: keep
 * `engines.vscode` at ^1.90 so nobody loses the extension, and register the
 * provider only where the API exists.
 *
 * Declaring the shapes here keeps that promise honest — nothing compiles against
 * a type that may be absent at runtime, and the gate in `provider.ts` is the only
 * place that decides.
 */

/** What the picker shows. Mirrors `vscode.LanguageModelChatInformation`. */
export interface LmModelInfo {
  id: string;
  name: string;
  /** Groups models from one backend; VS Code shows it as the family. */
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  detail?: string;
  tooltip?: string;
  capabilities?: { toolCalling?: boolean; imageInput?: boolean };
}

/** One part of a message, normalised from the API's part classes. */
export type LmPart =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; callId: string; name: string; input: unknown }
  | { kind: 'toolResult'; callId: string; content: string };

export interface LmMessage {
  role: 'user' | 'assistant';
  parts: LmPart[];
}

export interface LmTool {
  name: string;
  description?: string;
  /** JSON Schema for the arguments, as the API supplies it. */
  inputSchema?: unknown;
}

/** `vscode.Progress<LanguageModelResponsePart>`, narrowed to what we report. */
export interface LmProgress {
  report(part: unknown): void;
}

/** What the API hands us for cancellation. */
export interface LmCancellation {
  readonly isCancellationRequested: boolean;
  onCancellationRequested?(listener: () => void): { dispose(): void };
}

/**
 * Turns a channel of our answer into the API's part objects.
 *
 * Injected so the provider itself stays free of `vscode` and can be driven by a
 * test — the same seam the bridge uses for the response sink.
 */
export interface LmPartFactory {
  text(value: string): unknown;
  /** Absent when the running VS Code has no thinking part. */
  thinking?(value: string): unknown;
  toolCall(callId: string, name: string, input: unknown): unknown;
}

/** The subset of the language-model namespace this batch needs. */
export interface LmApi {
  registerLanguageModelChatProvider?(vendor: string, provider: unknown): { dispose(): void };
}

/**
 * A model as the bridge knows it.
 *
 * `kind` decides the transport: `api` is an OpenAI-compatible endpoint from
 * batch 8.0, `dom` is a web chat driven through the tab the user is signed in to.
 */
export interface LmBridgeModel {
  id: string;
  label: string;
  kind: 'api' | 'dom';
  maxInputTokens: number;
  maxOutputTokens: number;
  toolCalling: boolean;
  /** For a DOM adapter, the adapter id; for an endpoint, the provider id. */
  source: string;
}

export interface LmBridgeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LmAskRequest {
  model: LmBridgeModel;
  messages: LmMessage[];
  tools: LmTool[];
  /** True when the tools have to travel as prompt text. */
  promptToolProtocol: boolean;
  onText?(chunk: string): void;
  onThinking?(chunk: string): void;
}

export interface LmAskResult {
  text: string;
  thinking: string;
  toolCalls: LmBridgeToolCall[];
  cancelled: boolean;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** What the provider needs from the bridge — implemented in `register.ts`. */
export interface LmBridge {
  listModels(): Promise<LmBridgeModel[]>;
  ask(request: LmAskRequest, cancellation: LmCancellation): Promise<LmAskResult>;
}

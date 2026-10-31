/**
 * Batch 8.2 — the Copilot Chat provider.
 *
 * `provider.ts` is host-free and tested; `register.ts` is the `vscode` glue and
 * is gated at runtime, so a VS Code without the language-model API loads this
 * extension exactly as it did before the batch.
 */

export * from './types';
export * from './provider';
export { registerAiBridgeLanguageModel, type LmClient, type RegisterOptions } from './register';

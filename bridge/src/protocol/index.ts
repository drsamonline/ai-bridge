/**
 * Batch 8.1 — the tool-call protocol.
 *
 * Pure text handling plus one state machine. Nothing here imports `vscode`,
 * `@ai-bridge/shared` or the API transport, so it can be driven by the bridge,
 * by a web-chat adapter, or by a test with an array of strings.
 *
 * Provenance: adapted from AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 */

export * from './toolCalling';
export * from './streamingRouter';
export * from './assembler';

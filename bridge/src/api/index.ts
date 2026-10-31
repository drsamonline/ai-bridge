/**
 * Batch 8.0 — the OpenAI-compatible API transport.
 *
 * Nothing outside this folder needs to know how a chunk is shaped, and nothing
 * inside it imports `vscode` or the shared contracts. That is what lets the
 * transport be driven by the bridge, a test, or a future host unchanged.
 *
 * Provenance: adapted from AppsGanin/ai-free-vscode (MIT, commit 6f53bad).
 * See docs/batch8/attribution.md.
 */

export * from './types';
export * from './errors';
export * from './modelId';
export * from './stream';
export * from './openaiCompat';
export * from './registry';

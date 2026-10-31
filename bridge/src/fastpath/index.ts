/**
 * Batch 9.0 — the fast path.
 *
 * Direct request first, replay in the owned tab when challenged, DOM adapter as
 * the floor. Nothing here ships a provider template: see types.ts for why.
 *
 * Provenance: the policy is adapted from AppsGanin/ai-free-vscode (MIT, commit
 * 6f53bad). See docs/batch8/attribution.md.
 */

export * from './types';
export * from './detect';
export * from './policy';
export * from './replay';

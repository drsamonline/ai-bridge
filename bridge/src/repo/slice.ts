/**
 * Snapshot slice ranker — SPEC v6 §7, work item 6.
 *
 * `relevance.ts` answers one question: is a repo bundle worth its tokens at all?
 * It returns `{ attach, reason }` — a boolean and a why. That is a gate, and §7
 * asks for more: a 15 KB slice for the planner, 30 KB for the auditor, ranked
 * against the current plan, with per-file token accounting and a rationale that
 * goes in the manifest.
 *
 * So the gate stays a gate and this is the ranker on top of it. The gate runs
 * first because it is free and decisive: a plan that talks about nothing in the
 * codebase gets no slice at all, which saves more tokens than any ranking can.
 *
 * Determinism matters more than cleverness. The same plan and the same bundle
 * must produce the same slice, or the auditor's objections stop being checkable
 * against a fixed artifact. Every score is derived from the text in front of it;
 * nothing is sampled, nothing is embedded, nothing goes to the network.
 */

import type { BundleFile, RepoBundle } from '@ai-bridge/shared';
import { contextWorthIt, queryTerms } from '@ai-bridge/shared';

export interface SliceOptions {
  /** The plan text to rank against — usually the whole current plan-vN. */
  planText: string;
  /** Hard cap on the slice body, in bytes. §7: 15 KB planner, 30 KB auditor. */
  budgetBytes: number;
  /** Belt and braces: even a small-file repo should not produce a thousand files. */
  maxFiles?: number;
}

export interface SliceFile {
  path: string;
  bytes: number;
  tokens: number;
  score: number;
  /** Why it scored: the terms that matched. Empty for a structural pick. */
  reasons: string[];
}

export interface Slice {
  /** False when the gate refused: the plan does not reference the codebase. */
  attach: boolean;
  /** The gate's one-line explanation, recorded either way. */
  gate: string;
  files: SliceFile[];
  /** Ranked but over budget, with the reason they were left out. */
  omitted: SliceFile[];
  bytes: number;
  tokens: number;
  /** The text to inject, with a path header per file. */
  text: string;
  rationale: {
    /** What the ranking was given, so a surprising slice can be explained. */
    scoringInput: string;
    included: string[];
    excluded: string[];
  };
}

const HEADER_BYTES = 48; // "### <path> (N bytes)\n" — counted, not guessed
const DEFAULT_MAX_FILES = 40;

/** Identifiers a plan is likely to name: snake_case, camelCase, CONSTANTS, calls. */
const IDENTIFIER = /\b(?:[a-z]+_[a-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*\(\))\b/g;

function identifiersIn(text: string): Set<string> {
  return new Set(text.match(IDENTIFIER) ?? []);
}

/**
 * Rank the bundle's files against the plan and cut to the budget.
 *
 * The weights are deliberately crude and readable. A file the plan names by path
 * outranks one it merely shares an identifier with, and both outrank a file that
 * only matched the search that built the bundle. Anything that cannot be
 * explained by a weight is a weight nobody can audit.
 */
export function rankSlice(bundle: RepoBundle, opts: SliceOptions): Slice {
  const gate = contextWorthIt(opts.planText);
  const empty = (why: string): Slice => ({
    attach: false,
    gate: why,
    files: [],
    omitted: [],
    bytes: 0,
    tokens: 0,
    text: '',
    rationale: { scoringInput: opts.planText.slice(0, 200), included: [], excluded: [] },
  });

  if (!gate.attach) return empty(gate.reason);

  const plan = opts.planText.toLowerCase();
  const planIds = identifiersIn(opts.planText);
  const terms = new Set(queryTerms(opts.planText).map((t) => t.toLowerCase()));

  const scored: SliceFile[] = bundle.files.map((file: BundleFile) => {
    const reasons: string[] = [];
    let score = 0;

    const lowerPath = file.path.toLowerCase();
    if (plan.includes(lowerPath)) {
      score += 10;
      reasons.push('path');
    } else {
      const base = lowerPath.split('/').pop() ?? lowerPath;
      if (base.length > 2 && plan.includes(base)) {
        score += 6;
        reasons.push('basename');
      }
    }

    // Identifiers the plan uses that this file actually declares.
    const declared = identifiersIn(file.signatures.join('\n'));
    let matched = 0;
    for (const id of declared) {
      if (planIds.has(id)) {
        matched += 1;
        if (matched <= 3) reasons.push(id);
      }
    }
    score += Math.min(matched, 5) * 2;

    // The search that built the bundle already found something here.
    if (file.hits > 0) {
      score += Math.min(file.hits, 3);
      reasons.push(`${file.hits} hits`);
    }

    for (const term of terms) {
      if (lowerPath.includes(term) || declared.has(term)) {
        score += 1;
        if (!reasons.includes(term)) reasons.push(term);
        break;
      }
    }

    return { path: file.path, bytes: file.bytes, tokens: file.tokens, score, reasons };
  });

  // Deterministic order: score, then path. Without the path tiebreak two files
  // with equal scores could swap between runs and the artifact would move.
  scored.sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path));

  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const included: SliceFile[] = [];
  const omitted: SliceFile[] = [];
  let bytes = 0;

  for (const file of scored) {
    if (included.length >= maxFiles) {
      omitted.push(file);
      continue;
    }
    const cost = file.bytes + HEADER_BYTES;
    if (bytes + cost > opts.budgetBytes) {
      // Over budget. Keep looking: a later, smaller file may still fit, and
      // dropping everything after the first overflow throws away usable context.
      omitted.push(file);
      continue;
    }
    included.push(file);
    bytes += cost;
  }

  const text = included
    .map((f) => `### ${f.path} (${f.bytes} bytes)\n`)
    .join('');

  return {
    attach: included.length > 0,
    gate: gate.reason,
    files: included,
    omitted,
    bytes,
    tokens: included.reduce((n, f) => n + f.tokens, 0),
    text,
    rationale: {
      scoringInput: opts.planText.slice(0, 200),
      included: included.map((f) => f.path),
      excluded: omitted.map((f) => f.path),
    },
  };
}

/**
 * The per-role budgets from §7, in bytes. Kept here rather than at the call site
 * so the numbers appear once and a test can assert them.
 */
export const ROLE_SLICE_BYTES = {
  planner: 15 * 1024,
  auditor: 30 * 1024,
  debater: 0,
} as const;

export type SliceRole = keyof typeof ROLE_SLICE_BYTES;

/** A debater's job is the argument, not the code, so it gets no slice at all. */
export function sliceForRole(bundle: RepoBundle, planText: string, role: SliceRole): Slice {
  const budget = ROLE_SLICE_BYTES[role];
  if (budget === 0) {
    return {
      attach: false,
      gate: 'role takes no snapshot slice',
      files: [],
      omitted: [],
      bytes: 0,
      tokens: 0,
      text: '',
      rationale: { scoringInput: planText.slice(0, 200), included: [], excluded: [] },
    };
  }
  return rankSlice(bundle, { planText, budgetBytes: budget });
}

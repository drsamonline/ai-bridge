/**
 * buildBoot() — the ≤4k continuation prompt (spec §4 `meta.bootTokenEstimate`,
 * §5.5 "buildBoot()≤4k", §9 glossary: "boot=≤4k continuation prompt").
 *
 * Shape: a fixed header, then sections in priority order. When the budget is
 * tight the tail is trimmed — but LOCKED DECISIONS and DOING are never dropped,
 * because those are exactly what a fresh chat must not lose. If even they cannot
 * fit, they are truncated with an explicit "(+N more)" marker rather than being
 * silently omitted.
 *
 * Token counting is deliberately conservative: the larger of chars/4 and
 * words×1.35. A real tokenizer would usually give a smaller number, so staying
 * under 4000 here keeps us under 4000 there.
 */

import type { ProjectState } from '@ai-bridge/shared';
import { countTokens } from '../text/tokens';

export const BOOT_BUDGET_TOKENS = 4000;

export { countTokens };

export interface BootOptions {
  budgetTokens?: number;
  /** Cap on how many items each list section may carry before trimming. */
  limits?: Partial<Record<Section, number>>;
  /** Extra line appended to the instruction block (used by tests and T2). */
  preamble?: string;
}

export type Section =
  | 'header'
  | 'decisions'
  | 'doing'
  | 'todo'
  | 'constraints'
  | 'deltas'
  | 'files'
  | 'glossary'
  | 'done';

/** Priority for trimming: last in this list is dropped first. */
const TRIM_ORDER: Section[] = ['done', 'glossary', 'files', 'deltas', 'constraints', 'todo'];

const DEFAULT_LIMITS: Record<Section, number> = {
  header: 1,
  decisions: 30,
  doing: 30,
  todo: 40,
  constraints: 20,
  deltas: 10,
  files: 40,
  glossary: 20,
  done: 6,
};

export interface BootResult {
  text: string;
  tokens: number;
  budgetTokens: number;
  /** Which sections made it in, in order. */
  sections: Section[];
  /** Sections dropped or truncated to fit. */
  trimmed: Section[];
  overBudget: boolean;
}

interface SectionText {
  section: Section;
  body: string;
}

function renderHeader(state: ProjectState, preamble?: string): string {
  const lines = [
    'You are resuming an in-progress engineering task. Read this state, then continue.',
    `Repo: ${state.repo.root || '(unknown)'}${state.repo.commit ? ` @ ${state.repo.commit.slice(0, 12)}` : ''}`,
    state.stack.length ? `Stack: ${state.stack.join(', ')}` : '',
    preamble ?? '',
    '',
    'First, restate in one short list: what is DOING right now, and what is next in TODO.',
    'Do not start work before restating. Do not contradict LOCKED DECISIONS.',
  ];
  return lines.filter(Boolean).join('\n');
}

function renderDecisions(state: ProjectState): string {
  if (state.decisions.length === 0) return '';
  return [
    '## LOCKED DECISIONS (must not be contradicted or removed)',
    ...state.decisions.map((d) => `- ${d.what}${d.why ? ` — because ${d.why}` : ''} [${d.id}]`),
  ].join('\n');
}

function renderDoing(state: ProjectState): string {
  if (state.doing.length === 0) return '';
  return ['## DOING (in flight right now)', ...state.doing.map((t) => `- ${taskLine(t.task)}${filesOf(t.files)}`)].join(
    '\n',
  );
}

function renderTodo(state: ProjectState): string {
  if (state.todo.length === 0) return '';
  return ['## TODO (next, in order)', ...state.todo.map((t) => `- ${taskLine(t.task)}${filesOf(t.files)}`)].join('\n');
}

function renderConstraints(state: ProjectState): string {
  if (state.constraints.length === 0) return '';
  return ['## CONSTRAINTS', ...state.constraints.map((c) => `- ${c}`)].join('\n');
}

function renderDeltas(state: ProjectState): string {
  const recent = state.deltas.slice(-12).reverse();
  if (recent.length === 0) return '';
  return [
    '## RECENT CHANGES (newest first)',
    ...recent.map((d) => `- ${d.op}${d.path ? ` ${d.path}` : ''}: ${d.summary}`),
  ].join('\n');
}

function renderFiles(state: ProjectState): string {
  if (state.files.length === 0) return '';
  return [
    '## FILES IN PLAY',
    // No shas: the model never uses them, the applier keeps its own copy, and
    // 8 chars × every file is pure weight in a prompt sent on every failover.
    ...state.files.map((f) => `- ${f.path}${f.role && f.role !== 'unknown' ? ` (${f.role})` : ''}`),
  ].join('\n');
}

function renderGlossary(state: ProjectState): string {
  const entries = Object.entries(state.glossary);
  if (entries.length === 0) return '';
  return ['## GLOSSARY', ...entries.map(([k, v]) => `- ${k} = ${v}`)].join('\n');
}

function renderDone(state: ProjectState): string {
  const done = state.done.slice(-6);
  if (done.length === 0) return '';
  return ['## DONE (recently)', ...done.map((t) => `- ${taskLine(t.task)}`)].join('\n');
}

/**
 * A task line is a reminder, not a transcript. Long descriptions are truncated so
 * one verbose item cannot crowd out ten short ones; the full text stays in state
 * and in the T3 export.
 */
const TASK_CHARS = 160;
function taskLine(task: string): string {
  const t = task.trim().replace(/\s+/g, ' ');
  return t.length <= TASK_CHARS ? t : `${t.slice(0, TASK_CHARS - 1).trimEnd()}\u2026`;
}

function filesOf(files: string[]): string {
  if (!files || files.length === 0) return '';
  const shown = files.slice(0, 3).join(', ');
  return `  [${shown}${files.length > 3 ? `, +${files.length - 3}` : ''}]`;
}

function buildSections(state: ProjectState, limits: Record<Section, number>, preamble?: string): SectionText[] {
  const cap = (items: string[], n: number) => {
    if (items.length <= n) return { lines: items, extra: 0 };
    return { lines: items.slice(0, n), extra: items.length - n };
  };

  const sections: SectionText[] = [
    { section: 'header', body: renderHeader(state, preamble) },
  ];

  const decisions = state.decisions.map((d) => `- ${d.what}${d.why ? ` — because ${d.why}` : ''} [${d.id}]`);
  const dCap = cap(decisions, limits.decisions);
  if (dCap.lines.length) {
    sections.push({
      section: 'decisions',
      body: ['## LOCKED DECISIONS (must not be contradicted or removed)', ...dCap.lines, dCap.extra ? `- (+${dCap.extra} more)` : '']
        .filter(Boolean)
        .join('\n'),
    });
  }

  const doing = state.doing.map((t) => `- ${taskLine(t.task)}${filesOf(t.files)}`);
  const doCap = cap(doing, limits.doing);
  if (doCap.lines.length) {
    sections.push({
      section: 'doing',
      body: ['## DOING (in flight right now)', ...doCap.lines, doCap.extra ? `- (+${doCap.extra} more)` : '']
        .filter(Boolean)
        .join('\n'),
    });
  }

  const todo = state.todo.map((t) => `- ${taskLine(t.task)}${filesOf(t.files)}`);
  const tCap = cap(todo, limits.todo);
  if (tCap.lines.length) {
    sections.push({
      section: 'todo',
      body: ['## TODO (next, in order)', ...tCap.lines, tCap.extra ? `- (+${tCap.extra} more)` : '']
        .filter(Boolean)
        .join('\n'),
    });
  }

  const constraints = state.constraints.map((c) => `- ${c}`);
  const cCap = cap(constraints, limits.constraints);
  if (cCap.lines.length) {
    sections.push({
      section: 'constraints',
      body: ['## CONSTRAINTS', ...cCap.lines, cCap.extra ? `- (+${cCap.extra} more)` : ''].filter(Boolean).join('\n'),
    });
  }

  const deltas = state.deltas
    .slice(-limits.deltas)
    .reverse()
    .map((d) => `- ${d.op}${d.path ? ` ${d.path}` : ''}: ${d.summary}`);
  if (deltas.length) {
    sections.push({ section: 'deltas', body: ['## RECENT CHANGES (newest first)', ...deltas].join('\n') });
  }

  const files = state.files
    .slice(0, limits.files)
    .map((f) => `- ${f.path}${f.sha ? ` (sha ${f.sha.slice(0, 8)})` : ''}`);
  if (files.length) {
    sections.push({ section: 'files', body: ['## FILES IN PLAY', ...files].join('\n') });
  }

  const glossary = Object.entries(state.glossary)
    .slice(0, limits.glossary)
    .map(([k, v]) => `- ${k} = ${v}`);
  if (glossary.length) {
    sections.push({ section: 'glossary', body: ['## GLOSSARY', ...glossary].join('\n') });
  }

  const done = state.done.slice(-limits.done).map((t) => `- ${t.task}`);
  if (done.length) {
    sections.push({ section: 'done', body: ['## DONE (recently)', ...done].join('\n') });
  }

  return sections;
}

const join = (sections: SectionText[]) => sections.map((s) => s.body).filter(Boolean).join('\n\n');

/**
 * Compose the continuation prompt. Trimming order is DONE → GLOSSARY → FILES →
 * DELTAS → CONSTRAINTS → TODO; decisions and doing survive to the end.
 */
export function buildBoot(state: ProjectState, opts: BootOptions = {}): BootResult {
  const budget = opts.budgetTokens ?? BOOT_BUDGET_TOKENS;
  const limits: Record<Section, number> = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  const trimmed: Section[] = [];

  let sections = buildSections(state, limits, opts.preamble);
  let text = join(sections);
  let tokens = countTokens(text);

  // 1. Halve and then drop whole sections, in priority order.
  for (const section of TRIM_ORDER) {
    if (tokens <= budget) break;
    const idx = sections.findIndex((s) => s.section === section);
    if (idx < 0) continue;

    // Halve first, so a big list shrinks before disappearing.
    const halves: number[] = [0.5, 0.25];
    for (const factor of halves) {
      if (tokens <= budget) break;
      const body = sections[idx]!.body;
      const lines = body.split('\n');
      const keep = Math.max(2, Math.ceil(lines.length * factor));
      const shrunk = [...lines.slice(0, keep), `- (+${Math.max(0, lines.length - keep)} more, trimmed to fit 4k)`].join('\n');
      const trial = sections.map((s, i) => (i === idx ? { ...s, body: shrunk } : s));
      const t = countTokens(join(trial));
      if (t < tokens) {
        sections = trial;
        text = join(trial);
        tokens = t;
        if (!trimmed.includes(section)) trimmed.push(section);
      }
    }

    if (tokens > budget) {
      sections = sections.filter((s) => s.section !== section);
      text = join(sections);
      tokens = countTokens(text);
      if (!trimmed.includes(section)) trimmed.push(section);
    }
  }

  // 2. Last resort: the header instruction is shrunk, never removed.
  if (tokens > budget) {
    const headerIdx = sections.findIndex((s) => s.section === 'header');
    if (headerIdx >= 0) {
      sections[headerIdx] = {
        ...sections[headerIdx]!,
        body: `You are resuming an in-progress task at ${state.repo.root}. Restate DOING and TODO before working.`,
      };
      text = join(sections);
      tokens = countTokens(text);
      trimmed.push('header');
    }
  }

  // 3. Hard guard: if even decisions+doing overflow, cut at a line boundary.
  if (tokens > budget) {
    const maxChars = budget * 4;
    const cut = text.slice(0, maxChars);
    text = cut.slice(0, Math.max(0, cut.lastIndexOf('\n'))) + '\n…(truncated to fit 4k)';
    tokens = countTokens(text);
  }

  return {
    text,
    tokens,
    budgetTokens: budget,
    sections: sections.map((s) => s.section),
    trimmed,
    overBudget: tokens > budget,
  };
}

export interface AckCheck {
  ok: boolean;
  /** Items the answer restated. */
  found: string[];
  /** Items the boot expected but the answer did not mention. */
  missing: string[];
  /** Whether the answer also invented items that were never in the boot. */
  extra: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Words too common to prove an item was restated. */
const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be', 'with',
  'add', 'update', 'fix', 'make', 'use', 'new', 'this', 'that', 'it', 'as', 'at', 'by',
]);

function distinctive(item: string): string[] {
  return norm(item)
    .split(' ')
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/**
 * Did the answer restate the state it was given? Compares the distinctive words
 * of each DOING/TODO item against the answer; an item counts as restated when at
 * least half its distinctive words appear.
 */
export function verifyAck(state: ProjectState, answer: string): AckCheck {
  const haystack = norm(answer);
  const expected = [...state.doing.map((t) => t.task), ...state.todo.map((t) => t.task)];
  const found: string[] = [];
  const missing: string[] = [];

  for (const item of expected) {
    const words = distinctive(item);
    if (words.length === 0) {
      // Nothing distinctive to look for — fall back to a substring test.
      if (haystack.includes(norm(item))) found.push(item);
      else missing.push(item);
      continue;
    }
    const hits = words.filter((w) => haystack.includes(w)).length;
    if (hits / words.length >= 0.5) found.push(item);
    else missing.push(item);
  }

  // Items the answer claims that were never in the boot: only meaningful for
  // bullets in the answer that look like tasks.
  const claimed = answer
    .split('\n')
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter((l) => l.length > 8);
  const expectedNorm = expected.map(norm);
  const extra = claimed.filter((c) => {
    const words = distinctive(c);
    if (words.length === 0) return false;
    return !expectedNorm.some((e) => words.filter((w) => e.includes(w)).length / words.length >= 0.5);
  });

  return { ok: missing.length === 0 && expected.length > 0, found, missing, extra };
}

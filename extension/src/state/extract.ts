/**
 * T1 extraction — spec §5.5's "every turn" tier.
 *
 * Pure, synchronous, regex-only: paths, code fences, TODO/DONE, "decided to",
 * constraints and stack mentions. No model, no I/O, no allocation of consequence,
 * which is why it can run on every turn inside the worker.
 *
 * Delta ops are constrained to §4's union (`edit|add|delete|decide|failover`):
 *   path mentioned        → 'edit'   (the AI is talking about that file)
 *   TODO captured         → 'add'    (new work item)
 *   DONE captured         → 'edit'   (an item changed state)
 *   "decided to …"        → 'decide'
 *   a file removed/renamed→ 'delete'
 */

import type { Delta } from '@ai-bridge/shared';
import { redact } from './redact';

export interface T1Input {
  text: string;
  role: 'user' | 'assistant' | 'system';
  t: number;
}

export interface T1Result {
  deltas: Delta[];
  paths: string[];
  fences: number;
  todos: string[];
  dones: string[];
  decisions: string[];
  constraints: string[];
  stack: string[];
  redactions: number;
}

const CODE_EXT =
  'ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|swift|kt|scala|c|h|cpp|hpp|m|mm|sh|bash|zsh|ps1|sql|md|json|jsonc|ya?ml|toml|ini|env|css|scss|sass|less|html|vue|svelte|xml|proto|graphql|tf|dockerfile|makefile';

// The lookahead must allow sentence punctuation: "see src/fox.ts?" is a path.
const PATH_RE = new RegExp(`(?:^|[\\s\`"'(\\[,])((?:[\\w.@-]+/)*[\\w.@-]+\\.(?:${CODE_EXT}))(?=$|[\\s\`"'),:;\\]}!?….*>])`, 'gi');
const FENCE_RE = /^```/gm;
const TODO_RE = /(?:^|\s)(?:TODO|FIXME|HACK)\b[:\s-]*(.{0,160})/gi;
const DONE_RE = /(?:^|\s)DONE\b[:\s-]*(.{0,160})/gi;
const CHECKBOX_OPEN_RE = /^\s*[-*]\s\[ \]\s+(.{1,160})$/gm;
const CHECKBOX_DONE_RE = /^\s*[-*]\s\[[xX]\]\s+(.{1,160})$/gm;
const DECIDED_RE = /\b(?:we\s+)?(?:decided\s+to|decision\s*:|i'?ll\s+go\s+with|let'?s\s+use)\s+([^\n.]{3,180})/gi;
const CONSTRAINT_RE = /\b(?:must\s+not|must|never|always|do\s+not|don'?t)\s+([^\n.]{3,140})/gi;
const DELETE_RE = /\b(?:deleted|removed|renamed)\s+((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z0-9]{1,6})\b/gi;

const STACK_TERMS: Array<[string, RegExp]> = [
  ['typescript', /\btypescript\b/i],
  ['javascript', /\bjavascript\b/i],
  ['node', /\bnode(?:\.js)?\b/i],
  ['react', /\breact\b/i],
  ['next', /\bnext\.?js\b/i],
  ['vscode', /\bvs\s?code\b|\bextension host\b/i],
  ['python', /\bpython\b/i],
  ['go', /\bgo(?:lang)?\b/i],
  ['rust', /\brust\b/i],
  ['postgres', /\bpostgres(?:ql)?\b/i],
  ['sqlite', /\bsqlite\b/i],
  ['playwright', /\bplaywright\b|\bcdp\b/i],
  ['vitest', /\bvitest\b/i],
  ['jest', /\bjest\b/i],
  ['docker', /\bdocker\b/i],
];

const EXT_STACK: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin', sql: 'sql', sh: 'shell',
  css: 'css', scss: 'css', html: 'html', vue: 'vue', svelte: 'svelte',
  proto: 'protobuf', tf: 'terraform', md: 'markdown',
};

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/[`*_]+/g, '').trim().slice(0, 180);
}

/** Pull everything T1 cares about out of one turn of text. */
export function extractT1(input: T1Input): T1Result {
  const raw = input.text ?? '';
  const { text, redactions } = redact(raw);
  const deltas: Delta[] = [];
  const t = input.t;

  // --- paths -------------------------------------------------------------
  const paths = new Set<string>();
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(text)) !== null) {
    const p = m[1]!.replace(/^\.\//, '');
    if (p.length < 3 || p.length > 200) continue;
    if (/^(?:https?|file):/i.test(p)) continue;
    paths.add(p);
    if (paths.size >= 25) break;
  }

  for (const p of paths) {
    deltas.push({ t, op: 'edit', path: p, summary: `${input.role} referenced ${p}` });
  }

  // --- deletions / renames ----------------------------------------------
  DELETE_RE.lastIndex = 0;
  while ((m = DELETE_RE.exec(text)) !== null) {
    const p = m[1]!;
    deltas.push({ t, op: 'delete', path: p, summary: `${input.role} reported ${p} removed` });
    if (deltas.length > 60) break;
  }

  // --- fences ------------------------------------------------------------
  FENCE_RE.lastIndex = 0;
  const fenceLines = (text.match(FENCE_RE) ?? []).length;
  const fences = Math.floor(fenceLines / 2);

  // --- TODO / DONE -------------------------------------------------------
  const todos: string[] = [];
  TODO_RE.lastIndex = 0;
  while ((m = TODO_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s) todos.push(s);
    if (todos.length >= 8) break;
  }
  CHECKBOX_OPEN_RE.lastIndex = 0;
  while ((m = CHECKBOX_OPEN_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s) todos.push(s);
    if (todos.length >= 12) break;
  }

  const dones: string[] = [];
  DONE_RE.lastIndex = 0;
  while ((m = DONE_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s) dones.push(s);
    if (dones.length >= 8) break;
  }
  CHECKBOX_DONE_RE.lastIndex = 0;
  while ((m = CHECKBOX_DONE_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s) dones.push(s);
    if (dones.length >= 12) break;
  }

  for (const s of todos) deltas.push({ t, op: 'add', summary: `TODO: ${s}` });
  for (const s of dones) deltas.push({ t, op: 'edit', summary: `DONE: ${s}` });

  // --- decisions ---------------------------------------------------------
  const decisions: string[] = [];
  DECIDED_RE.lastIndex = 0;
  while ((m = DECIDED_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s) decisions.push(s);
    if (decisions.length >= 6) break;
  }
  for (const s of decisions) deltas.push({ t, op: 'decide', summary: s });

  // --- constraints -------------------------------------------------------
  const constraints: string[] = [];
  CONSTRAINT_RE.lastIndex = 0;
  while ((m = CONSTRAINT_RE.exec(text)) !== null) {
    const s = clean(m[1] ?? '');
    if (s.length >= 6) constraints.push(s);
    if (constraints.length >= 6) break;
  }

  // --- stack -------------------------------------------------------------
  // Prose terms first, then what the mentioned files actually are: a turn that
  // only says "src/format.ts" is still a TypeScript turn.
  const stack = new Set(STACK_TERMS.filter(([, re]) => re.test(text)).map(([name]) => name));
  for (const p of paths) {
    const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
    const lang = EXT_STACK[ext];
    if (lang) stack.add(lang);
  }

  return {
    deltas,
    paths: [...paths],
    fences,
    todos,
    dones,
    decisions,
    constraints,
    stack: [...stack],
    redactions,
  };
}

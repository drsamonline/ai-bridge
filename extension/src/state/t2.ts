/**
 * T2 — the "every 5 turns, last-N → JSON" tier (§5.5).
 *
 * Three backends, picked by availability:
 *   ollama     local model over HTTP (the spec's first choice)
 *   tab        a throwaway browser tab driven through the bridge (spec's second)
 *   heuristic  rule-based, offline — always available, so the pipeline never
 *              silently stops producing state just because no model is running
 *
 * Every backend returns the SAME patch shape, and `mergePatch` is the only thing
 * that touches the state, so a bad or partial model answer cannot corrupt it.
 */

import * as http from 'node:http';
import type { ProjectState } from '@ai-bridge/shared';
import { extractT1 } from './extract';
import { redact } from './redact';

export interface T2Turn {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export interface T2Patch {
  doing: Array<{ task: string; files?: string[] }>;
  todo: Array<{ task: string; files?: string[] }>;
  done: string[];
  decisions: Array<{ what: string; why?: string }>;
  files: string[];
  glossary: Record<string, string>;
  notes?: string;
}

export interface T2Backend {
  readonly name: string;
  available(): Promise<boolean>;
  summarise(input: { state: ProjectState; turns: T2Turn[] }): Promise<T2Patch>;
}

export const EMPTY_PATCH: T2Patch = {
  doing: [],
  todo: [],
  done: [],
  decisions: [],
  files: [],
  glossary: {},
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ prompt */

export function buildT2Prompt(state: ProjectState, turns: T2Turn[]): string {
  const transcript = turns
    .slice(-12)
    .map((t) => `${t.role.toUpperCase()}: ${t.text.slice(0, 1200)}`)
    .join('\n\n');

  return [
    'You are a state extractor. Read the transcript and reply with ONE JSON object and nothing else.',
    'Schema:',
    '{"doing":[{"task":"...","files":["..."]}],"todo":[{"task":"...","files":["..."]}],',
    ' "done":["..."],"decisions":[{"what":"...","why":"..."}],"files":["..."],"glossary":{"term":"meaning"}}',
    '',
    'Rules: doing = work in flight now. todo = not started. done = finished in this transcript.',
    'Only include what the transcript supports. Omit keys you have nothing for. No prose, no markdown.',
    '',
    `Known decisions so far: ${state.decisions.map((d) => d.what).join(' | ') || '(none)'}`,
    `Known files so far: ${state.files.slice(0, 30).map((f) => f.path).join(', ') || '(none)'}`,
    '',
    '--- TRANSCRIPT ---',
    transcript,
  ].join('\n');
}

/** Pull the first JSON object out of a model answer (tolerates fences and prose). */
export function parsePatch(answer: string): T2Patch | null {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], answer];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const raw = JSON.parse(candidate.slice(start, end + 1)) as Partial<T2Patch>;
      return {
        doing: Array.isArray(raw.doing) ? raw.doing.filter((d) => d && typeof d.task === 'string') : [],
        todo: Array.isArray(raw.todo) ? raw.todo.filter((d) => d && typeof d.task === 'string') : [],
        done: Array.isArray(raw.done) ? raw.done.filter((d): d is string => typeof d === 'string') : [],
        decisions: Array.isArray(raw.decisions)
          ? raw.decisions.filter((d) => d && typeof d.what === 'string')
          : [],
        files: Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === 'string') : [],
        glossary:
          raw.glossary && typeof raw.glossary === 'object' && !Array.isArray(raw.glossary)
            ? Object.fromEntries(
                Object.entries(raw.glossary).filter(([, v]) => typeof v === 'string'),
              )
            : {},
        ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/* --------------------------------------------------------------- heuristic */

/**
 * Offline T2: reuses T1's extraction over the window and shapes it into a patch.
 * It cannot summarise the way a model does, but it never invents, never blocks
 * and keeps the tier honest when no model is reachable.
 */
export class HeuristicT2 implements T2Backend {
  readonly name = 'heuristic';

  async available(): Promise<boolean> {
    return true;
  }

  async summarise(input: { state: ProjectState; turns: T2Turn[] }): Promise<T2Patch> {
    const patch: T2Patch = { doing: [], todo: [], done: [], decisions: [], files: [], glossary: {} };
    const files = new Set<string>();

    for (const turn of input.turns) {
      const t1 = extractT1({ text: turn.text, role: turn.role, t: Date.now() });
      for (const p of t1.paths) files.add(p);
      for (const todo of t1.todos) patch.todo.push({ task: todo, files: t1.paths.slice(0, 3) });
      for (const done of t1.dones) patch.done.push(done);
      for (const d of t1.decisions) patch.decisions.push({ what: d });
      // An assistant turn that opens a code fence is working on something now.
      if (turn.role === 'assistant' && t1.fences > 0) {
        const first = t1.paths[0];
        patch.doing.push({
          task: first ? `editing ${first}` : 'editing code from the last answer',
          ...(first ? { files: [first] } : {}),
        });
      }
    }

    patch.files = [...files];
    // Deduplicate within the patch.
    patch.todo = dedupeBy(patch.todo, (x) => x.task);
    patch.doing = dedupeBy(patch.doing, (x) => x.task);
    patch.decisions = dedupeBy(patch.decisions, (x) => x.what);
    patch.done = [...new Set(patch.done)];
    return patch;
  }
}

/* ------------------------------------------------------------------ ollama */

export interface OllamaOptions {
  url?: string;
  model?: string;
  timeoutMs?: number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

export class OllamaT2 implements T2Backend {
  readonly name = 'ollama';
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OllamaOptions = {}) {
    this.url = opts.url ?? 'http://127.0.0.1:11434';
    this.model = opts.model ?? 'llama3.2';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async available(): Promise<boolean> {
    try {
      const body = await this.get('/api/tags');
      return typeof body === 'string' && body.includes('models');
    } catch {
      return false;
    }
  }

  private get(pathname: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: Number(new URL(this.url).port || 11434), path: pathname, timeout: 1500 }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ollama probe timed out'));
      });
      req.on('error', reject);
    });
  }

  async summarise(input: { state: ProjectState; turns: T2Turn[] }): Promise<T2Patch> {
    const prompt = buildT2Prompt(input.state, input.turns);
    const answer = await new Promise<string>((resolve, reject) => {
      const payload = JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0 },
      });
      const url = new URL(this.url);
      const req = http.request(
        {
          host: url.hostname,
          port: Number(url.port || 11434),
          path: '/api/generate',
          method: 'POST',
          timeout: this.timeoutMs,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(String((JSON.parse(body) as { response?: string }).response ?? ''));
            } catch (err) {
              reject(new Error(`ollama returned non-JSON: ${(err as Error).message}`));
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ollama timed out'));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    const patch = parsePatch(answer);
    if (!patch) throw new Error('ENOPATCH: ollama answer contained no JSON object');
    this.opts.log?.('info', `T2 patch from ollama (${this.model})`);
    return patch;
  }
}

/* --------------------------------------------------------------- tab (CDP) */

/** T2 through a throwaway browser tab, via an injected prompt function. */
export class TabT2 implements T2Backend {
  readonly name = 'tab';

  constructor(
    private readonly sendPrompt: (text: string) => Promise<string>,
    private readonly log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {}

  async available(): Promise<boolean> {
    return true;
  }

  async summarise(input: { state: ProjectState; turns: T2Turn[] }): Promise<T2Patch> {
    const answer = await this.sendPrompt(buildT2Prompt(input.state, input.turns));
    const patch = parsePatch(answer);
    if (!patch) throw new Error('ENOPATCH: tab answer contained no JSON object');
    this.log?.('info', 'T2 patch from a throwaway tab');
    return patch;
  }
}

/* ------------------------------------------------------------------ merge */

function dedupeBy<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = norm(key(item));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export interface MergeCounts {
  doing: number;
  todo: number;
  done: number;
  decisions: number;
  files: number;
  glossary: number;
}

/**
 * Apply a patch to the state. Only additive and de-duplicating: T2 may add work
 * items and decisions, but it can never delete a locked decision or drop a file
 * the user is working on.
 */
export function mergePatch(
  state: ProjectState,
  patch: T2Patch,
  nextId: () => string,
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
): MergeCounts {
  const counts: MergeCounts = { doing: 0, todo: 0, done: 0, decisions: 0, files: 0, glossary: 0 };

  const safeTask = (t: string) => redact(t).text.slice(0, 240);
  const exists = (list: Array<{ task: string }>, task: string) =>
    list.some((x) => norm(x.task) === norm(task));

  for (const d of patch.doing) {
    const task = safeTask(d.task);
    if (!task || exists(state.doing, task) || exists(state.todo, task)) continue;
    state.doing.push({ id: nextId(), task, files: (d.files ?? []).slice(0, 4) });
    counts.doing += 1;
  }

  for (const t of patch.todo) {
    const task = safeTask(t.task);
    if (!task || exists(state.todo, task) || exists(state.doing, task)) continue;
    state.todo.push({ id: nextId(), task, files: (t.files ?? []).slice(0, 4) });
    counts.todo += 1;
  }

  for (const raw of patch.done) {
    const task = safeTask(raw);
    if (!task) continue;
    const idx = state.todo.findIndex((x) => norm(x.task) === norm(task));
    if (idx >= 0) {
      const [moved] = state.todo.splice(idx, 1);
      state.done.push({ ...moved!, state: 'done' });
    } else if (!state.done.some((x) => norm(x.task) === norm(task))) {
      state.done.push({ id: nextId(), task, files: [], state: 'done' });
    } else {
      continue;
    }
    counts.done += 1;
  }

  for (const d of patch.decisions) {
    const what = redact(d.what).text.slice(0, 240);
    if (!what) continue;
    // A decision T2 proposes is recorded as a *note*, not auto-locked: locking is
    // the user's call (AI Bridge: Lock a Decision), and 2.3 enforces the guard.
    if (state.decisions.some((x) => norm(x.what) === norm(what))) continue;
    if (state.constraints.some((c) => norm(c) === norm(what))) continue;
    state.constraints.push(what);
    counts.decisions += 1;
  }

  for (const f of patch.files) {
    if (!f || state.files.some((x) => x.path === f)) continue;
    state.files.push({ path: f, role: 'unknown', sha: '', touchedBy: ['t2'] });
    counts.files += 1;
  }

  for (const [k, v] of Object.entries(patch.glossary)) {
    const key = k.trim().slice(0, 60);
    const value = redact(v).text.slice(0, 200);
    if (!key || !value || state.glossary[key]) continue;
    state.glossary[key] = value;
    counts.glossary += 1;
  }

  // Caps so a chatty model cannot grow the state without bound.
  if (state.todo.length > 100) state.todo.splice(0, state.todo.length - 100);
  if (state.doing.length > 20) state.doing.splice(0, state.doing.length - 20);
  if (state.done.length > 100) state.done.splice(0, state.done.length - 100);
  if (state.constraints.length > 60) state.constraints.splice(0, state.constraints.length - 60);

  log?.(
    'info',
    `T2 merged: +${counts.doing} doing, +${counts.todo} todo, ${counts.done} done, +${counts.decisions} notes, +${counts.files} files, +${counts.glossary} glossary`,
  );
  return counts;
}

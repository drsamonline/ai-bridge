/**
 * Project state schema — spec §4 `ProjectState`, v3.
 *
 * The interface itself lives in `shared/src/types.ts` and is frozen. This module
 * owns the runtime side of it: creation, validation, delta application with the
 * §4 cap, redaction, and the token estimate the boot prompt will need in 2.2.
 */

import type { Delta, ProjectState, TrackedFile } from '@ai-bridge/shared';
import { DELTA_CAP } from '@ai-bridge/shared';
import { redact } from './redact';

export { redact } from './redact';
export type { RedactionResult } from './redact';

export const STATE_VERSION = 3 as const;

export interface CreateStateOptions {
  id: string;
  root: string;
  commit?: string | null;
  dirtyHash?: string;
  now?: number;
}

export function createState(opts: CreateStateOptions): ProjectState {
  const now = opts.now ?? Date.now();
  return {
    v: STATE_VERSION,
    id: opts.id,
    repo: { root: opts.root, commit: opts.commit ?? null, dirtyHash: opts.dirtyHash ?? '' },
    stack: [],
    decisions: [],
    constraints: [],
    done: [],
    doing: [],
    todo: [],
    files: [],
    glossary: {},
    deltas: [],
    meta: { updatedAt: now, bootTokenEstimate: 0 },
  };
}

export class StateSchemaError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`state schema: ${message} (at ${path})`);
    this.name = 'StateSchemaError';
  }
}

/** Throws on anything that is not a usable v3 state. */
export function validateState(value: unknown): ProjectState {
  const fail = (msg: string, path = '$') => {
    throw new StateSchemaError(msg, path);
  };
  if (typeof value !== 'object' || value === null) fail('not an object');
  const s = value as Partial<ProjectState>;

  if (s.v !== STATE_VERSION) fail(`v must be ${STATE_VERSION}, got ${String(s.v)}`, '$.v');
  if (typeof s.id !== 'string' || s.id.length === 0) fail('id must be a non-empty string', '$.id');
  if (typeof s.repo !== 'object' || s.repo === null) fail('repo must be an object', '$.repo');
  if (typeof s.repo!.root !== 'string') fail('repo.root must be a string', '$.repo.root');
  if (!(s.repo!.commit === null || typeof s.repo!.commit === 'string'))
    fail('repo.commit must be string|null', '$.repo.commit');
  if (typeof s.repo!.dirtyHash !== 'string') fail('repo.dirtyHash must be a string', '$.repo.dirtyHash');

  for (const key of ['stack', 'constraints'] as const) {
    if (!Array.isArray(s[key]) || s[key]!.some((x) => typeof x !== 'string'))
      fail(`${key} must be string[]`, `$.${key}`);
  }
  for (const key of ['done', 'doing', 'todo'] as const) {
    if (!Array.isArray(s[key])) fail(`${key} must be an array`, `$.${key}`);
    for (const [i, task] of s[key]!.entries()) {
      if (typeof task?.id !== 'string' || typeof task?.task !== 'string' || !Array.isArray(task?.files))
        fail(`malformed task`, `$.${key}[${i}]`);
    }
  }
  if (!Array.isArray(s.decisions)) fail('decisions must be an array', '$.decisions');
  for (const [i, d] of s.decisions!.entries()) {
    if (typeof d?.id !== 'string' || typeof d?.what !== 'string' || d?.locked !== true)
      fail('malformed locked decision', `$.decisions[${i}]`);
  }
  if (!Array.isArray(s.files)) fail('files must be an array', '$.files');
  for (const [i, f] of s.files!.entries()) {
    if (typeof f?.path !== 'string' || typeof f?.sha !== 'string')
      fail('malformed tracked file', `$.files[${i}]`);
  }
  if (typeof s.glossary !== 'object' || s.glossary === null || Array.isArray(s.glossary))
    fail('glossary must be an object', '$.glossary');
  if (!Array.isArray(s.deltas)) fail('deltas must be an array', '$.deltas');
  for (const [i, d] of s.deltas!.entries()) {
    if (typeof d?.t !== 'number' || typeof d?.op !== 'string' || typeof d?.summary !== 'string')
      fail('malformed delta', `$.deltas[${i}]`);
  }
  if (typeof s.meta !== 'object' || s.meta === null) fail('meta must be an object', '$.meta');
  if (typeof s.meta!.updatedAt !== 'number') fail('meta.updatedAt must be a number', '$.meta.updatedAt');
  if (typeof s.meta!.bootTokenEstimate !== 'number')
    fail('meta.bootTokenEstimate must be a number', '$.meta.bootTokenEstimate');

  return s as ProjectState;
}

/** Append a delta, enforcing the §4 cap by dropping the oldest. */
export function pushDelta(state: ProjectState, delta: Delta): ProjectState {
  const safe: Delta = {
    t: delta.t,
    op: delta.op,
    ...(delta.path ? { path: delta.path } : {}),
    summary: redact(delta.summary).text.slice(0, 400),
  };
  state.deltas.push(safe);
  if (state.deltas.length > DELTA_CAP) {
    state.deltas.splice(0, state.deltas.length - DELTA_CAP);
  }
  state.meta.updatedAt = Math.max(state.meta.updatedAt, delta.t);
  return state;
}

/** Track (or refresh) a file's sha and who touched it. */
export function trackFile(state: ProjectState, path: string, sha: string, by: string): void {
  const existing = state.files.find((f) => f.path === path);
  if (existing) {
    existing.sha = sha;
    if (!existing.touchedBy.includes(by)) existing.touchedBy.push(by);
    return;
  }
  const file: TrackedFile = { path, role: 'unknown', sha, touchedBy: [by] };
  state.files.push(file);
  if (state.files.length > 500) state.files.splice(0, state.files.length - 500);
}

/** §4: `meta.bootTokenEstimate` — cheap estimate, refined by buildBoot in 2.2. */
export function estimateBootTokens(state: ProjectState): number {
  const shell = {
    ...state,
    deltas: state.deltas.slice(-20),
    files: state.files.slice(0, 50),
  };
  return Math.ceil(JSON.stringify(shell).length / 4);
}

export function touchMeta(state: ProjectState): ProjectState {
  state.meta.updatedAt = Date.now();
  state.meta.bootTokenEstimate = estimateBootTokens(state);
  return state;
}

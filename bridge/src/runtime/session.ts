/**
 * Sessions — roster, leases, persistence and reconstruction. SPEC v6 §4, §9, §18, §20.
 *
 * Deliberately free of CDP and playwright: nothing here opens a tab or touches a
 * page. Leases are accounted for here and *pinned* by the controller, which is
 * what lets the RAM projection run before the first tab exists (§18 requires the
 * rejection to happen before anything opens).
 *
 * Two decisions worth knowing:
 *
 *  - `providers` is per participant, not per session. §6 constrains failover to a
 *    participant's declared set so a debate participant cannot silently become a
 *    different model. The first entry is the primary; the rest are intra-set
 *    failover only.
 *  - Two participants may name the same provider, and therefore the same account.
 *    That is allowed but *reported* (`sharedAccounts`), because it is the open
 *    question in the spec: a shared account shares its quota, so one participant
 *    hitting a limit degrades the other.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Role, SessionState } from './stateMachine';
import { isTerminal } from './stateMachine';

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

export type Tier = 'visible' | 'background' | 'headless';

export interface ParticipantSpec {
  index: number;
  role: Role;
  label: string;
  /** Declared provider set, primary first. Never empty. */
  providers: string[];
  tier: Tier;
  /** For `headless`: which OS-level Chrome profile, so two never collide. */
  profile?: string;
}

export interface RosterConfig {
  participants: ParticipantSpec[];
  roundBudget?: number;
  wallClockMs?: number;
  ramCapBytes?: number;
}

export const DEFAULT_ROUND_BUDGET = 7;
export const DEFAULT_WALL_CLOCK_MS = 90 * 60 * 1000;
/** §18: the 500 MB default is not survivable for five participants. */
export const DEFAULT_RAM_CAP_BYTES = 2000 * 1024 * 1024;
export const MAX_PARTICIPANTS = 5;
export const MAX_VISIBLE = 2;
export const MAX_HEADLESS_PER_PROFILE = 1;
/** A rough figure for one signed-in consumer chat tab. Only used for projection. */
export const ESTIMATED_TAB_BYTES = 320 * 1024 * 1024;

export type RejectionCode =
  | 'PARTICIPANT_LIMIT'
  | 'VISIBLE_LIMIT'
  | 'PROFILE_CONTENTION'
  | 'ROLE_MISSING'
  | 'ROLE_DUPLICATE'
  | 'PROVIDER_EMPTY'
  | 'INDEX_DUPLICATE'
  | 'RAM_INSUFFICIENT';

export interface RosterRejection {
  ok: false;
  code: RejectionCode;
  detail: string;
}

export interface RosterAccepted {
  ok: true;
  participants: ParticipantSpec[];
  /** Providers named by more than one participant — shared quota, reported not blocked. */
  sharedAccounts: Array<{ provider: string; participants: number[] }>;
  projectedBytes: number;
}

/**
 * Configuration rejections. These are not halts: they change no state and open no
 * tab, which is why §16 files them separately from the other three classes.
 */
export function validateRoster(cfg: RosterConfig): RosterAccepted | RosterRejection {
  const ps = cfg.participants ?? [];

  if (ps.length === 0 || ps.length > MAX_PARTICIPANTS) {
    return { ok: false, code: 'PARTICIPANT_LIMIT', detail: `a session runs 1..${MAX_PARTICIPANTS} participants, not ${ps.length}` };
  }

  const seen = new Set<number>();
  for (const p of ps) {
    if (seen.has(p.index)) {
      return { ok: false, code: 'INDEX_DUPLICATE', detail: `participant index ${p.index} appears twice` };
    }
    seen.add(p.index);
    if (!p.providers || p.providers.length === 0) {
      return { ok: false, code: 'PROVIDER_EMPTY', detail: `participant ${p.index} declares no provider` };
    }
  }

  const planners = ps.filter((p) => p.role === 'planner');
  const auditors = ps.filter((p) => p.role === 'auditor');
  if (planners.length !== 1) {
    return { ok: false, code: planners.length === 0 ? 'ROLE_MISSING' : 'ROLE_DUPLICATE', detail: `exactly one planner is required, found ${planners.length}` };
  }
  if (auditors.length !== 1) {
    return { ok: false, code: auditors.length === 0 ? 'ROLE_MISSING' : 'ROLE_DUPLICATE', detail: `exactly one auditor is required, found ${auditors.length}` };
  }

  const visible = ps.filter((p) => p.tier === 'visible');
  if (visible.length > MAX_VISIBLE) {
    return { ok: false, code: 'VISIBLE_LIMIT', detail: `${visible.length} participants are visible; the cap is ${MAX_VISIBLE}` };
  }

  // One headless context per OS-level profile. Two on one profile is the
  // contention the spec calls out; two on different profiles is fine and is the
  // documented way to run more than one.
  const perProfile = new Map<string, number>();
  for (const p of ps.filter((x) => x.tier === 'headless')) {
    const key = p.profile ?? 'default';
    const n = (perProfile.get(key) ?? 0) + 1;
    perProfile.set(key, n);
    if (n > MAX_HEADLESS_PER_PROFILE) {
      return { ok: false, code: 'PROFILE_CONTENTION', detail: `profile "${key}" would host ${n} headless contexts; the limit is ${MAX_HEADLESS_PER_PROFILE}` };
    }
  }

  const projectedBytes = projectRam(ps);
  const cap = cfg.ramCapBytes ?? DEFAULT_RAM_CAP_BYTES;
  if (projectedBytes > cap) {
    return {
      ok: false,
      code: 'RAM_INSUFFICIENT',
      detail: `projected ${Math.round(projectedBytes / 1024 / 1024)} MB exceeds the ${Math.round(cap / 1024 / 1024)} MB cap`,
    };
  }

  return { ok: true, participants: [...ps].sort((a, b) => a.index - b.index), sharedAccounts: sharedAccounts(ps), projectedBytes };
}

/** Which providers two or more participants would drive through the same account. */
export function sharedAccounts(ps: ParticipantSpec[]): Array<{ provider: string; participants: number[] }> {
  const byProvider = new Map<string, number[]>();
  for (const p of ps) {
    for (const provider of new Set(p.providers)) {
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), p.index]);
    }
  }
  return [...byProvider.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([provider, indexes]) => ({ provider, participants: indexes.sort((a, b) => a - b) }));
}

/**
 * The pre-flight RAM figure. Visible and background tabs cost a real tab; a
 * headless context costs less because it carries no window. Crude on purpose: it
 * has to be decided before anything opens, so it cannot measure what is there.
 */
export function projectRam(ps: ParticipantSpec[]): number {
  return ps.reduce((total, p) => total + (p.tier === 'headless' ? ESTIMATED_TAB_BYTES * 0.7 : ESTIMATED_TAB_BYTES), 0);
}

/* ------------------------------------------------------------------ *
 * Leases
 * ------------------------------------------------------------------ */

export interface LeaseState {
  pinned: number[];
  projectedBytes: number;
  capBytes: number;
}

/**
 * Session-pinned tabs. §4: `closeIdleTabs` skips leased tabs, so a background
 * participant is not evicted while it waits its turn.
 */
export class LeaseLedger {
  private readonly pinned = new Set<number>();

  constructor(
    private readonly capBytes: number,
    private readonly perTabBytes: number = ESTIMATED_TAB_BYTES,
  ) {}

  acquire(index: number): { ok: true } | RosterRejection {
    if (this.pinned.has(index)) return { ok: true };
    const projected = (this.pinned.size + 1) * this.perTabBytes;
    if (projected > this.capBytes) {
      return { ok: false, code: 'RAM_INSUFFICIENT', detail: `leasing participant ${index} would project ${Math.round(projected / 1024 / 1024)} MB against a ${Math.round(this.capBytes / 1024 / 1024)} MB cap` };
    }
    this.pinned.add(index);
    return { ok: true };
  }

  release(index: number): void {
    this.pinned.delete(index);
  }

  releaseAll(): void {
    this.pinned.clear();
  }

  has(index: number): boolean {
    return this.pinned.has(index);
  }

  state(): LeaseState {
    return { pinned: [...this.pinned].sort((a, b) => a - b), projectedBytes: this.pinned.size * this.perTabBytes, capBytes: this.capBytes };
  }
}

/* ------------------------------------------------------------------ *
 * Identity and persistence
 * ------------------------------------------------------------------ */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48-bit millisecond timestamp + 80 bits of randomness, base32. */
export function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 bits of randomness, encoded exactly: 10 bytes as a BigInt, 5 bits at a
  // time. Shifting across byte boundaries by hand is where this kind of code
  // usually goes wrong, so it does not.
  const bytes = crypto.randomBytes(10);
  const n = BigInt(`0x${bytes.toString('hex')}`);
  let random = '';
  for (let i = 0; i < 16; i += 1) {
    random = CROCKFORD[Number((n >> BigInt(i * 5)) & 31n)] + random;
  }
  return time + random;
}

export interface SessionRecord {
  id: string;
  state: SessionState;
  reason?: string;
  createdAt: number;
  lastMutationAt: number;
  round: number;
  roundBudget: number;
  wallClockMs: number;
  ramCapBytes: number;
  participants: ParticipantSpec[];
  /** Per-participant sub-state, by index. */
  sub: Record<number, string>;
  planVersion: number;
  sharedAccounts: Array<{ provider: string; participants: number[] }>;
}

export const SESSION_FILE = 'session.json';
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function sessionDir(root: string, id: string): string {
  return path.join(root, 'sessions', id);
}

export function createSession(root: string, cfg: RosterConfig, now: number = Date.now()): { ok: true; record: SessionRecord } | RosterRejection {
  const roster = validateRoster(cfg);
  if (!roster.ok) return roster;

  const record: SessionRecord = {
    id: ulid(now),
    state: 'INITIALIZING',
    createdAt: now,
    lastMutationAt: now,
    round: 0,
    roundBudget: cfg.roundBudget ?? DEFAULT_ROUND_BUDGET,
    wallClockMs: cfg.wallClockMs ?? DEFAULT_WALL_CLOCK_MS,
    ramCapBytes: cfg.ramCapBytes ?? DEFAULT_RAM_CAP_BYTES,
    participants: roster.participants,
    sub: Object.fromEntries(roster.participants.map((p) => [p.index, 'HANDSHAKE_PENDING'])),
    planVersion: 0,
    sharedAccounts: roster.sharedAccounts,
  };

  const dir = sessionDir(root, record.id);
  fs.mkdirSync(path.join(dir, 'tx'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'plans'), { recursive: true });
  writeRecord(root, record);
  return { ok: true, record };
}

export function writeRecord(root: string, record: SessionRecord): void {
  const dir = sessionDir(root, record.id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, SESSION_FILE);
  const temp = `${target}.tmp`;
  // Write-then-rename: a killed process must not leave a half-written record
  // that the startup scan then reads as a live session.
  fs.writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, target);
}

export function loadSession(root: string, id: string): SessionRecord | null {
  const file = path.join(sessionDir(root, id), SESSION_FILE);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SessionRecord;
  } catch {
    return null;
  }
}

export function saveState(root: string, record: SessionRecord, state: SessionState, reason?: string, now: number = Date.now()): SessionRecord {
  const next = { ...record, state, reason, lastMutationAt: now };
  writeRecord(root, next);
  return next;
}

/**
 * Startup reconstruction (§9). A killed process cannot write SUSPENDED, so the
 * scan infers it: a non-terminal session whose last mutation predates this
 * process start was live when the last process died.
 */
export function reconstruct(root: string, processStartedAt: number): SessionRecord[] {
  const dir = path.join(root, 'sessions');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out: SessionRecord[] = [];
  for (const id of entries) {
    const record = loadSession(root, id);
    if (!record) continue;
    if (isTerminal(record.state)) continue;
    if (record.lastMutationAt >= processStartedAt) continue;
    const suspended: SessionRecord = { ...record, state: 'SUSPENDED' };
    writeRecord(root, suspended);
    out.push(suspended);
  }
  return out;
}

/**
 * Retention (§20): a finished session is kept seven days and then removed. Only
 * the local copy — the transcript that lives in five vendors' chat histories is
 * not ours to collect.
 */
export function gc(root: string, now: number = Date.now(), retentionMs: number = RETENTION_MS): string[] {
  const dir = path.join(root, 'sessions');
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const removed: string[] = [];
  for (const id of entries) {
    const record = loadSession(root, id);
    if (!record) continue;
    if (!isTerminal(record.state)) continue;
    if (now - record.lastMutationAt < retentionMs) continue;
    fs.rmSync(sessionDir(root, id), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    removed.push(id);
  }
  return removed;
}

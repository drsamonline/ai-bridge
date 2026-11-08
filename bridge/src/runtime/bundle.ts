/**
 * The handoff bundle — SPEC v6 §9.
 *
 * The product's actual output, and until now the one part of §9 with no code at
 * all: a session could reach CONSENSUS and stop, leaving a plan file and a pile of
 * transcript shards. This assembles those into the five artifacts the spec names,
 * hashes each one, and writes a manifest that says what the bundle is and what it
 * is not.
 *
 * The manifest is the honest part. It records the session's terminal state and
 * reason, which rounds were truncated, how many objections are unresolved, and the
 * snapshot hash the debate was actually conducted against — because the value of a
 * frozen snapshot is that an objection can be re-checked later, and that only
 * works if the bundle names it.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionRecord } from './session';
import { sessionDir } from './session';

export interface BundleObjection {
  participant: number;
  round: number;
  body: string;
  /** Set when a planner resolutions block answered it. */
  resolution?: string;
}

export interface BundleQuestion {
  id: string;
  round: number;
  askedBy: number;
  text: string;
  status: 'open' | 'answered' | 'dropped';
}

export interface BundleInput {
  root: string;
  record: SessionRecord;
  /** The plan to freeze. Defaults to the highest plan-vN on disk. */
  planVersion?: number;
  objections?: BundleObjection[];
  questions?: BundleQuestion[];
  /** The snapshot the session was conducted against, for the manifest. */
  snapshot?: { id: string; sha256: string; capturedAt: number } | null;
  now?: number;
}

export interface BundleArtifact {
  name: string;
  bytes: number;
  sha256: string;
}

export interface BundleManifest {
  sessionId: string;
  exportedAt: number;
  state: string;
  reason: string | null;
  round: number;
  planVersion: number;
  participants: Array<{ index: number; role: string; label: string; providers: string[]; tier: string }>;
  sharedAccounts: Array<{ provider: string; participants: number[] }>;
  artifacts: BundleArtifact[];
  transcript: { shards: number; rounds: number[] };
  objections: { total: number; resolved: number; open: number };
  questions: { total: number; open: number };
  snapshot: { id: string; sha256: string; capturedAt: number } | null;
  /** True when the plan shipped is not the one every participant agreed to. */
  planIsFrozenAfterConsensus: boolean;
}

export interface BundleResult {
  dir: string;
  manifest: BundleManifest;
  files: string[];
}

const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

/** `12-3-4.json` → round 12, participant 3, seq 4. */
function parseShard(name: string): { round: number; participant: number; seq: number } | null {
  const match = /^(\d+)-(\d+)-(\d+)\.json$/.exec(name);
  if (!match) return null;
  return { round: Number(match[1]), participant: Number(match[2]), seq: Number(match[3]) };
}

/** The transcript, assembled from the shards in round order. */
function buildTranscript(root: string, record: SessionRecord): { text: string; shards: number; rounds: number[] } {
  const txDir = path.join(sessionDir(root, record.id), 'tx');
  let names: string[] = [];
  try {
    names = fs.readdirSync(txDir).filter((n) => n.endsWith('.json'));
  } catch {
    return { text: '# Transcript\n\nNo turns were recorded.\n', shards: 0, rounds: [] };
  }

  const shards = names
    .map((name) => ({ name, at: parseShard(name) }))
    .filter((s): s is { name: string; at: { round: number; participant: number; seq: number } } => s.at !== null)
    .sort((a, b) => a.at.round - b.at.round || a.at.participant - b.at.participant || a.at.seq - b.at.seq);

  const rounds = [...new Set(shards.map((s) => s.at.round))].sort((a, b) => a - b);
  const lines: string[] = ['# Transcript', ''];

  for (const shard of shards) {
    let turn: { round: number; participant: number; token: string; text: string } | null = null;
    try {
      turn = JSON.parse(fs.readFileSync(path.join(txDir, shard.name), 'utf8'));
    } catch {
      continue; // a torn shard is skipped, and the manifest's shard count says so
    }
    if (!turn) continue;
    lines.push(`## Round ${turn.round} — participant ${turn.participant} — ${turn.token}`);
    lines.push('');
    lines.push(turn.text.trim());
    lines.push('');
  }

  return { text: `${lines.join('\n')}\n`, shards: shards.length, rounds };
}

function buildObjections(objections: BundleObjection[]): string {
  const lines = ['# Objections', ''];
  if (objections.length === 0) {
    lines.push('No objections were raised.');
    return `${lines.join('\n')}\n`;
  }
  for (const o of objections) {
    const id = `obj-${o.round}-${o.participant}`;
    if (o.resolution) {
      lines.push(`- **${id}** — ${o.body}`);
      lines.push(`  - Resolved: ${o.resolution}`);
    } else {
      lines.push(`- **${id}** — ${o.body}`);
      lines.push('  - **Open.** No planner turn answered this objection.');
    }
  }
  return `${lines.join('\n')}\n`;
}

function buildQuestions(questions: BundleQuestion[]): string {
  const lines = ['# Questions', ''];
  if (questions.length === 0) {
    lines.push('The auditor asked nothing that needed an answer.');
    return `${lines.join('\n')}\n`;
  }
  for (const q of questions) {
    lines.push(`- **${q.id}** (round ${q.round}, participant ${q.askedBy}) — ${q.status}: ${q.text}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The highest plan-vN on disk, or 0. */
export function latestPlanVersion(root: string, record: SessionRecord): number {
  const dir = path.join(sessionDir(root, record.id), 'plans');
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  return names.reduce((max, name) => {
    const match = /^plan-v(\d+)\.md$/.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

/**
 * Write the bundle. Idempotent: re-exporting overwrites, so a session that is
 * confirmed twice does not accumulate directories.
 */
export function exportBundle(input: BundleInput): BundleResult {
  const { root, record } = input;
  const now = input.now ?? Date.now();
  const dir = path.join(sessionDir(root, record.id), 'bundle');
  fs.mkdirSync(dir, { recursive: true });

  const planVersion = input.planVersion ?? latestPlanVersion(root, record);
  const planSource = path.join(sessionDir(root, record.id), 'plans', `plan-v${planVersion}.md`);
  let plan = '';
  try {
    plan = fs.readFileSync(planSource, 'utf8');
  } catch {
    plan = `# Plan\n\nNo plan artifact was written. The session ended ${record.state} before a planner turn completed.\n`;
  }

  const transcript = buildTranscript(root, record);
  const objections = input.objections ?? [];
  const questions = input.questions ?? [];
  const resolved = objections.filter((o) => o.resolution).length;

  const artifacts: Array<{ name: string; body: string }> = [
    { name: 'plan.md', body: plan },
    { name: 'transcript.md', body: transcript.text },
    { name: 'questions.md', body: buildQuestions(questions) },
    { name: 'objections-resolved.md', body: buildObjections(objections) },
  ];

  const written: BundleArtifact[] = [];
  for (const artifact of artifacts) {
    fs.writeFileSync(path.join(dir, artifact.name), artifact.body, { mode: 0o600 });
    written.push({ name: artifact.name, bytes: Buffer.byteLength(artifact.body), sha256: sha256(artifact.body) });
  }

  const manifest: BundleManifest = {
    sessionId: record.id,
    exportedAt: now,
    state: record.state,
    reason: record.reason ?? null,
    round: record.round,
    planVersion,
    participants: record.participants.map((p) => ({
      index: p.index,
      role: p.role,
      label: p.label,
      providers: p.providers,
      tier: p.tier,
    })),
    sharedAccounts: record.sharedAccounts ?? [],
    artifacts: written,
    transcript: { shards: transcript.shards, rounds: transcript.rounds },
    objections: { total: objections.length, resolved, open: objections.length - resolved },
    questions: { total: questions.length, open: questions.filter((q) => q.status === 'open').length },
    snapshot: input.snapshot ?? null,
    // A bundle exported from CONSENSUS ships the agreed plan. One exported from a
    // budget or wall-clock halt does not, and the manifest must not imply it does.
    planIsFrozenAfterConsensus: record.state === 'CONSENSUS' || record.state === 'AWAITING_HANDOFF_CONFIRM',
  };

  const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifestBody, { mode: 0o600 });

  return {
    dir,
    manifest,
    files: [...written.map((a) => a.name), 'manifest.json'],
  };
}

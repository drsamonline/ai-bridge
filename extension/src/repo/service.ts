/**
 * Repo service — the piece that turns an answer into a reviewable change.
 *
 *   contextFor(query)  → §5.7 bundle (signatures + bodies within budget)
 *   propose(answer)    → parse fenced blocks → plan (sha-verify, hunk match,
 *                        locked-decision guard) → card for the panel
 *   accept(id)         → ONE WorkspaceEdit, all files, one undo
 *   reject(id)         → drop the plan; nothing is written
 *
 * Nothing here writes to disk except `accept`.
 */

import * as vscode from 'vscode';
import { EditApplier, type HeldEdit, type LockedDecisionLite, type Plan } from './applier';
import { parseProposal, summarise, type Proposal } from './proposal';
import { RepoReader, type RepoBundle } from './reader';
import { createApplyPort, createDiffPort, createFsPort } from './vscodePorts';

export interface ProposalHunk {
  /** `path#index`, the key the applier uses. */
  key: string;
  path: string;
  index: number;
  added: number;
  removed: number;
  /** First line of the hunk, for the checkbox label. */
  preview: string;
}

export interface ProposalCard {
  id: string;
  summary: string;
  /** §6 Diff View: "accept/reject per hunk". */
  hunks: ProposalHunk[];
  canApply: boolean;
  files: Array<{ path: string; status: string; added: number; removed: number; reason?: string }>;
  refusals: Array<{ path: string; reason: string }>;
  /** Locked decisions that held this plan — the approval flow's input. */
  held: HeldEdit[];
  /** Decisions already waived by an explicit approval. */
  waived: string[];
  tokens: number;
}

/** Interim decision store. Batch 2.1 replaces the source with ProjectState. */
export class DecisionStore {
  private static KEY = 'aiBridge.lockedDecisions';

  constructor(private readonly memento: vscode.Memento) {}

  list(): LockedDecisionLite[] {
    return this.memento.get<LockedDecisionLite[]>(DecisionStore.KEY, []);
  }

  async add(what: string, why: string, paths: string[] = []): Promise<LockedDecisionLite> {
    const decision: LockedDecisionLite = {
      id: `d${Date.now().toString(36)}`,
      what,
      why,
      locked: true,
      paths,
    };
    await this.memento.update(DecisionStore.KEY, [...this.list(), decision]);
    return decision;
  }

  /** Used once by the 2.3 migration, after the state has taken ownership. */
  async clear(): Promise<void> {
    await this.memento.update(DecisionStore.KEY, []);
  }

  async remove(id: string): Promise<boolean> {
    const next = this.list().filter((d) => d.id !== id);
    const changed = next.length !== this.list().length;
    await this.memento.update(DecisionStore.KEY, next);
    return changed;
  }
}

export class RepoService {
  private readonly fs = createFsPort;
  private reader: RepoReader | null = null;
  private applier: EditApplier | null = null;
  private readonly pending = new Map<string, Plan>();
  private lastBundle: RepoBundle | null = null;

  private readonly proposals = new Map<string, Proposal>();

  constructor(
    private readonly root: vscode.Uri,
    /** §4 `ProjectState.decisions` from 2.3 on; the interim store only migrates. */
    private readonly decisions: () => LockedDecisionLite[],
    private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {}

  get indexed(): number {
    return this.reader?.indexedFiles ?? 0;
  }

  private ensure(): { reader: RepoReader; applier: EditApplier } {
    if (!this.reader || !this.applier) {
      const fsPort = this.fs(this.root, (m) => this.log('warn', m));
      this.reader = new RepoReader({ fs: fsPort, budgetTokens: 3000 });
      this.applier = new EditApplier({
        fs: fsPort,
        apply: createApplyPort(this.root),
        decisions: this.decisions,
        log: this.log,
      });
    }
    return { reader: this.reader, applier: this.applier };
  }

  async index(): Promise<{ files: number; tookMs: number }> {
    const { reader } = this.ensure();
    const res = await reader.index();
    this.log('info', `repo indexed: ${res.files} files in ${res.tookMs} ms`);
    return res;
  }

  async contextFor(
    query: string,
    opts: { maxFiles?: number; budgetTokens?: number } = {},
  ): Promise<RepoBundle> {
    const { reader } = this.ensure();
    if (reader.indexedFiles === 0) await this.index();
    const bundle = await reader.bundle(query, opts);
    this.lastBundle = bundle;
    this.log(
      'info',
      `repo context: ${bundle.files.length} file(s), ~${bundle.tokens} tokens — ${bundle.files.map((f) => f.path).join(', ')}`,
    );
    return bundle;
  }

  get bundle(): RepoBundle | null {
    return this.lastBundle;
  }

  /** Parse an answer and plan it. Returns null when the answer proposes nothing. */
  async propose(answer: string, id: string): Promise<ProposalCard | null> {
    const proposal: Proposal | null = parseProposal(answer, id);
    if (!proposal) {
      this.log('info', 'answer contained no edit blocks — nothing to apply');
      return null;
    }
    const { applier } = this.ensure();
    const plan = await applier.plan(proposal);
    this.pending.set(plan.id, plan);
    this.proposals.set(plan.id, proposal);
    const card = this.card(plan);
    this.log(
      plan.ok ? 'info' : 'warn',
      `proposal ${plan.id}: ${card.summary}${plan.refusals.length ? ` — ${plan.refusals.length} refusal(s)` : ''}`,
    );
    for (const r of plan.refusals) this.log('warn', `refused ${r.path}: ${r.reason}`);
    return card;
  }

  private card(plan: Plan): ProposalCard {
    return {
      id: plan.id,
      summary: summarise(plan.files.filter((f) => f.status !== 'refused')),
      hunks: plan.files
        .filter((f) => f.status !== 'refused')
        .flatMap((f) =>
          f.hunkList.map((h, i) => ({
            key: `${f.path}#${i}`,
            path: f.path,
            index: i,
            added: h.added,
            removed: h.removed,
            preview: (h.search.split('\n')[0] ?? '').trim().slice(0, 80) || '(new content)',
          })),
        ),
      canApply: plan.ok,
      files: plan.files.map((f) => ({
        path: f.path,
        status: f.status,
        added: f.added,
        removed: f.removed,
        ...(f.reason ? { reason: f.reason } : {}),
      })),
      refusals: plan.refusals,
      held: plan.held,
      waived: plan.waived,
      tokens: this.lastBundle?.tokens ?? 0,
    };
  }

  /**
   * The approval flow (§5.8, §2.3): the user has read the banner and chosen to
   * override one locked decision. Re-plan with that decision waived — the file is
   * still sha-verified and every other guard still applies.
   */
  async approve(
    id: string,
    decisionId: string,
  ): Promise<{ ok: boolean; card?: ProposalCard; decision?: HeldEdit; error?: string }> {
    const plan = this.pending.get(id);
    const proposal = this.proposals.get(id);
    if (!plan || !proposal) return { ok: false, error: `ENOPLAN: ${id} is not pending` };

    const held = plan.held.find((h) => h.decisionId === decisionId);
    if (!held) {
      return { ok: false, error: `ENOTHELD: ${decisionId} did not hold this proposal` };
    }

    const { applier } = this.ensure();
    const waived = [...new Set([...plan.waived, decisionId])];
    const replanned = await applier.plan(proposal, { waiveDecisions: waived });
    this.pending.set(id, replanned);
    this.log(
      'warn',
      `locked decision ${decisionId} ("${held.what}") waived by the user for ${id} — re-planned: ${replanned.ok ? 'applicable' : 'still refused'}`,
    );
    return { ok: replanned.ok, card: this.card(replanned), decision: held };
  }

  /** Which decisions held a proposal, for the banner. */
  heldFor(id: string): HeldEdit[] {
    return this.pending.get(id)?.held ?? [];
  }

  async accept(
    id: string,
    selection?: string[],
  ): Promise<{ ok: boolean; applied: number; error?: string; skipped?: number }> {
    const plan = this.pending.get(id);
    if (!plan) return { ok: false, applied: 0, error: `ENOPLAN: ${id} is not pending` };
    const { applier } = this.ensure();
    const res = await applier.apply(plan);
    if (res.ok) this.pending.delete(id);
    return res;
  }

  reject(id: string): boolean {
    return this.pending.delete(id);
  }

  async showDiff(id: string): Promise<boolean> {
    const plan = this.pending.get(id);
    if (!plan) return false;
    const edits = plan.files
      .filter((f) => f.status !== 'refused')
      .map((f) => ({ path: f.path, before: f.before, after: f.after, shaBefore: f.shaBefore }));
    await createDiffPort().show(`AI Bridge · ${summarise(plan.files)}`, edits);
    return true;
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

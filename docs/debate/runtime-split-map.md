# runtime.ts split map

Derived from `drsamonline/ai-bridge` at `0e37bd9`, `bridge/src/runtime.ts` (1,169 lines).
This is the implementation plan for SPEC v6 work items 1–4. It is grounded in the file
as it exists, not in the spec's description of it.

---

## 1. What is actually in runtime.ts

`BridgeRuntime` is one class holding three unrelated planes. The split is a
de-tangling, not a four-way partition.

| Lines | Member | Destination |
|---|---|---|
| 58–85 | `SwitchRecord`, `RuntimeOptions` | `runtime/types.ts` |
| 87–126 | class decl, fields: `controller`, `monitor`, `watchdog`, `adapters`, `router`, `api`, `fastpath`, `bus` | `runtime/index.ts` |
| 127–180 | `constructor` | `runtime/index.ts` |
| 181–205 | `wire()` — WS message dispatcher | `runtime/index.ts` |
| 206–217 | `start()`, `stop()` | `runtime/index.ts` |
| 218–222 | `adapterList()` | `runtime/index.ts` |
| 223–257 | `health()` | `runtime/index.ts` |
| 258–265 | `navigate()` | `relay.ts` |
| 266–276 | `send()` | `relay.ts` |
| 277–294 | `observe()` | `relay.ts` |
| 295–482 | `prompt()` — 188 lines: chain walk + rungs + failover | split: **policy → `scheduler.ts`**, **mechanics → `relay.ts`** |
| 483–584 | `tryRungs()` — fastpath rung selection, 102 lines | `relay.ts`, verbatim |
| 585–639 | `sendAndObserve()` — the dispatch/observe core, 55 lines | `relay.ts`, verbatim |
| 640–649 | `openProviderPage()` | `relay.ts` |
| 650–656 | `limitMessage()` | `scheduler.ts` — this is the limit→block/degrade decision |
| 657–665 | `requirePage()` | `relay.ts` |
| 666–675 | `status()` | `runtime/index.ts` |
| 676–692 | `fastpathList()` | `runtime/index.ts` |
| 693–705 | `recordApi()` | `runtime/index.ts` |
| 706–1169 | `control()` — 463 lines, 31 `ctl.*` cases | **split three ways, see §3** |

The single most important finding: `control()` is the largest block in the file and
the spec does not mention it. It cannot be left where it is, because it owns tab,
turn and lease commands that the scheduler and session registry must own.

---

## 2. Module boundaries

### `runtime/index.ts` — facade, keeps the wire

Owns `BridgeRuntime`, the event bus, `wire()`, `start`/`stop`, and the provider-plane
`ctl.*` cases. Everything else is delegated. Public surface does not change, so
`main.ts` and `server.ts` need no edit for step 1.

### `runtime/relay.ts` — dispatch and observation

```ts
export interface TurnPayload {
  plan: string;            // full or diff, per delta transport
  context: string;         // new messages only, or full block after reattach
  snapshot: string | null; // null when touched paths unchanged
  questions: string;
  suffix: string;          // protocol suffix + role line
  full: boolean;           // true on handshake / reattach / post-degrade
}

export interface TurnResult {
  text: string;
  settledBy: 'sentinel' | 'stop-gone' | 'debounce' | 'timeout';
  token: Token | null;     // null when settledBy === 'debounce' on first pass
  adapterId: string;
  ms: number;
}

export interface Relay {
  dispatch(participant: ParticipantId, payload: TurnPayload): Promise<TurnResult>;
  parseToken(text: string, settledBy: TurnResult['settledBy']): Token | null;
}
```

Carries `tryRungs`, `sendAndObserve`, `openProviderPage`, `requirePage`, `navigate`,
`send`, `observe` across unchanged. The only edit inside them is that the adapter
argument becomes a participant rather than a chain position.

### `runtime/scheduler.ts` — who speaks, and whether the round is over

```ts
export interface Scheduler {
  nextSpeaker(): ParticipantId | null;
  completeTurn(p: ParticipantId, token: Token): void;  // re-evaluates completion
  block(p: ParticipantId, reason: string): void;       // re-evaluates completion
  degrade(p: ParticipantId, reason: string): void;     // re-evaluates completion
  restore(p: ParticipantId): void;
  escalate(p: ParticipantId, accepted: boolean): void;
  forceRound(): void;
  snapshot(): { round: number; budget: number; escalates: number; expected: ParticipantId | null };
}
```

`completeTurn`, `block` and `degrade` all call one private `evaluateCompletion()`.
That single function is the fix for the round-never-completes hang, and it must be
the only place that decides a round has ended.

Completion predicate, per v6 §8:

```
roundComplete = every participant p in roster where
                  !degraded(p) && !blocked(p)
                has spoken in this round
```

Quorum predicate, used by consensus:

```
active = roster.filter(p => !degraded(p) && !blocked(p))
quorum = active.every(p => consensusThisRound.has(p)) && active.length >= 2
```

`active.length >= 2` is not in the spec; without it a roster where everyone but one
participant has degraded reaches "unanimous consensus" with a single voter. Add it
or reject the case explicitly.

### `runtime/stateMachine.ts` — pure, no I/O

```ts
export type SessionState =
  | 'IDLE' | 'INITIALIZING' | 'HANDSHAKE_PENDING' | 'AWAITING_LOGIN' | 'ACTIVE'
  | 'SUSPENDED' | 'NEEDS_USER' | 'STALLED' | 'WALL_CLOCK' | 'BUDGET_EXHAUSTED'
  | 'CONSENSUS' | 'AWAITING_HANDOFF_CONFIRM' | 'HANDED_OFF' | 'ABORTED';

export type SubState = 'HANDSHAKE_PENDING' | 'AWAITING_LOGIN' | 'BLOCKED'
                     | 'DEGRADED' | 'REATTACHING';

export function transition(
  state: SessionState,
  event: SessionEvent,
): { state: SessionState; reason?: string } | { rejected: string };
```

`transition` is total and throws on an unhandled `(state, event)` pair — an
unhandled pair is a spec bug and should fail a test, not silently return `state`.
No timers, no bus, no disk. Timers live in `session.ts` and call in.

### `runtime/session.ts` — registry, lifecycle, leases

Owns: the session directory, participant records, tier assignment, `threadKey`,
lease acquisition and release, the per-participant timers (60 s handshake, 5 min
block, 5 min login ceiling), SUSPENDED reconstruction at startup, and handoff.

```ts
export interface SessionRegistry {
  create(cfg: RosterConfig): Promise<SessionId>;
  load(id: SessionId): Promise<Session>;
  reconstruct(): Promise<SessionId[]>;   // scans sessions/ for non-terminal
  lease(participant: ParticipantId): Promise<void>;   // RAM check before any tab
  release(session: SessionId): Promise<void>;
  handoff(session: SessionId): Promise<BundlePath>;
}
```

`lease()` must run the RAM projection *before* `controller.newTab`, per v6 §18 —
that ordering is what makes `RAM_INSUFFICIENT` a pre-flight rejection rather than a
mid-session abort.

---

## 3. Where the 31 `ctl.*` cases go

| Case group | Destination | Why |
|---|---|---|
| `ctl.browser.launch`, `ctl.attach`, `ctl.detach`, `ctl.status`, `ctl.ram`, `ctl.tab.open`, `ctl.tab.close`, `ctl.turn`, `ctl.gc` | `session.ts` | tab and lease lifecycle |
| `ctl.adapters`, `ctl.health`, `ctl.diagnostics`, `ctl.limit` | `relay.ts` | adapter introspection |
| `ctl.models`, `ctl.providers.set`, `ctl.router`, `ctl.router.configure`, `ctl.router.clear`, `ctl.router.prewarm` | `runtime/index.ts` | provider plane, unchanged |
| `ctl.api.providers.set`, `ctl.api.detect`, `ctl.api.models`, `ctl.api.status`, `ctl.api.prompt`, `ctl.api.cancel` | `runtime/index.ts` | endpoint transport, unchanged |
| `ctl.fastpath.set`, `ctl.fastpath.status` | `runtime/index.ts` | fastpath config, unchanged |
| `ctl.prompt`, `ctl.config` | `runtime/index.ts` | facade entry points |

`ctl.prompt` is the v1 single-prompt path and stays. The debate path does not go
through it — it goes through `Scheduler` → `Relay`.

---

## 4. Order of work

The order matters because steps 1 and 2 must leave the 930-check suite green.
Step 4 is the first step allowed to change behaviour.

1. **Extract `runtime/index.ts`.** Pure move of §1's rows into the new file, no
   logic edits. Every existing suite must pass untouched. If a test needs editing
   here, the move was wrong.
2. **Extract `relay.ts`.** Move `tryRungs`, `sendAndObserve`, `openProviderPage`,
   `requirePage`, `navigate`, `send`, `observe` verbatim. `prompt()` still calls
   them in the same order; only its new home differs. Suite stays green.
3. **Add `stateMachine.ts` and `session.ts` with unit tests.** Wire them behind
   `wire()` but leave the debate path unused. New tests only, no existing test
   touched.
4. **Add `scheduler.ts` and switch the debate path onto it.** This is where the
   chain-walk is replaced by participant-boundary failover. Expect the existing
   provider failover tests to need a debate-specific sibling rather than an edit —
   the single-prompt path keeps the old behaviour through `ctl.prompt`.
5. **Extend `repo/relevance.ts` into a ranker, and add `nodeFsPort.ts`.**
   Independent of 1–4; can run in parallel with step 3.
6. **Harden `server.ts`** per v6 §13. Independent of everything above.

Steps 1 and 2 are pure refactors and should land as their own commits so that a
green suite is attributable.

---

## 5. Tests each module needs

- `stateMachine` — every row of v6 §9 as a case, plus a totality test asserting
  that unhandled pairs throw. Target: one test per row, 40-odd.
- `scheduler` — completion under degrade-during-turn (the v5 hang), block timeout
  re-evaluation, rotation fairness over 10 turns, escalate cap with accepted and
  rejected mixed, reservation turn before `BUDGET_EXHAUSTED`, quorum with 2
  degraded.
- `relay` — token parse per `settledBy` value, retry-once on `debounce`, plan
  extraction on a `CONSENSUS`-terminated planner turn, diff-vs-full payload
  selection across a reattach.
- `session` — lease pre-flight RAM rejection with no tab opened, SUSPENDED
  reconstruction from a fixture `sessions/` tree, 7-day GC, `ABORTED` closing only
  owned tabs.
- `server` — nonce single-use, `Origin` rejection, `Host` rejection (DNS rebinding),
  `/auth` POST then WS upgrade, CORS absent on all but `/auth`.

---

## 6. Decisions needed before step 4

1. **Declared provider set.** The spec fixes it at session start but does not name
   the field. Proposal: `RosterConfig.participants[i].providers: string[]`, first
   entry primary, rest used in order for intra-set failover. Confirm before
   `scheduler.ts` is written.
2. **`FsPort` owner.** v6 §2 says "new implementation by shell". A served web page
   cannot read the filesystem, and `reader.ts` shells out to `git` via
   `node:child_process`. Proposal: `nodeFsPort.ts` in the bridge; `ports.ts` stays
   as the interface only.
3. **`STREAM_TIMEOUT` class.** v6 has it degrading a participant (§9) and halting
   as user-gated (§16). Proposal: per-participant degrade; halt only when the
   participant is the planner or auditor.
4. **Quorum floor.** Proposal: quorum requires at least 2 active participants, so a
   roster reduced to one by degradation cannot reach "unanimous" consensus.

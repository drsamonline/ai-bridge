# Audit — product design and implementation

Scope: everything built in steps 1–6 of `runtime-split-map.md`, plus the product
surface the spec promises. Reviewed against SPEC v6. Every finding below is
pointed at a file and line, or at the absence of one; nothing here is a hunch.

Method: read the intent (SPEC v6, the split map), map what exists against it, then
hunt correctness and data loss first, security second, performance third, design
last. Verification run: `npm run clean && npm run build`, then all 41 suites.

**Baseline: 41/41 suites pass.** The green suite is not the finding. The finding is
what the green suite does not assert.

---

## Verdict

**Blocked for any session that needs a repo snapshot or a handoff.** Not blocked
for the turn loop itself, which is sound.

The engine can play a debate and stop on a rule. It cannot yet deliver the two
things the product is *for*: a slice of code for the auditor to check the plan
against, and a bundle for the builder at the end. Both are specified, both have
state-machine support, and neither is wired.

---

## Findings, in severity order

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | The snapshot slice contains no code — only file paths and byte counts | `bridge/src/repo/slice.ts:167` | **Blocking** |
| 2 | Participant sub-states are never persisted; the session record lies | `runner.ts` — no write to `record.sub` anywhere | **Blocking** |
| 3 | The handoff bundle does not exist; CONSENSUS halts and nothing is assembled | no `bundle.*` in `bridge/src` | **Blocking** |
| 4 | `finish()` assumes the planner is participant 0 | `runner.ts:316,326` | High |
| 5 | A refused state transition is silently dropped, so a disagreement between scheduler and machine disappears | `runner.ts:120` | High |
| 6 | Hitting `maxTurns` returns `ACTIVE` with no reason — a live session that is not running | `runner.ts:248` | High |
| 7 | Six session states are unreachable in code: `STALLED`, `WALL_CLOCK`, `AWAITING_LOGIN`, `AWAITING_HANDOFF_CONFIRM`, `HANDED_OFF`, `ABORTED` | `runner.ts` raises 10 events; `stateMachine.ts` defines 34 | High |
| 8 | `NEEDS_USER` has no exit: `user.resume` is never raised, so every session that asks a question is terminal in practice | no caller of `user.resume` | High |
| 9 | Slice accounting uses the file's size, not the bytes included, so a signatures-only file is charged and labelled as its full size | `shared/src/repo/reader.ts:212` (`bytes: stat.size`) vs `slice.ts:168` | Medium |
| 10 | `search({ regex: true })` builds a `RegExp` from caller text, and the caller is a model's plan | `nodeFsPort.ts:102` | Medium |
| 11 | Files over `maxFileBytes` vanish from the snapshot with no record | `nodeFsPort.ts:80` returns `null` | Medium |
| 12 | Two sources of truth for the RAM cap: roster validation and the lease ledger each default independently | `session.ts:190` vs `LeaseLedger` ctor | Low |
| 13 | The context block caps each message at 600 characters rather than applying §7's 6 KB block budget | `runner.ts` `contextBlock` | Low |
| 14 | No `questions.md` lifecycle, no `resolutions` parsing, no Jaccard stall detector | absent | Medium |
| 15 | Documentation coverage: modules are documented in code and in the split map, but there is no ADR for the seven `DECISION` points and no operator doc | `docs/debate/` | Low |

---

## The three blocking findings, explained

### 1. The slice is a table of contents

```ts
// bridge/src/repo/slice.ts:167
const text = included
  .map((f) => `### ${f.path} (${f.bytes} bytes)\n`)
  .join('');
```

`rankSlice` never reads `bundle.text`, and `BundleFile` carries no body. So the
text handed to a participant is a list of paths. The auditor is asked to check a
plan against code it was never shown — which is the exact failure the snapshot
was introduced to fix, reintroduced by the code that delivers it.

Why the suite missed it: `test/snapshot.cjs` asserts ordering, the budget and the
rationale, and never that the slice contains content. A test that checks a
transport's envelope and not its payload.

### 2. The session record's sub-states are fiction

`createSession` writes `sub: { 0: 'HANDSHAKE_PENDING', … }` and nothing ever
updates it. The runner degrades participants, blocks them, reattaches them, and
the persisted record still says every participant is mid-handshake. `reconstruct`
then reloads that fiction after a crash.

### 3. The deliverable is unimplemented

`HANDED_OFF` exists as a state; `AWAITING_HANDOFF_CONFIRM` exists; the bundle
(`plan-vN.md`, `transcript.md`, `questions.md`, `objections-resolved.md`,
`manifest.json`) is §9 of the spec and has no code at all. A session that reaches
CONSENSUS today produces a plan file and a directory of transcript shards, and
stops.

---

## What is genuinely solid

Worth saying, because the audit would otherwise read as uniformly negative.

- `stateMachine.ts` is total and tested against every state × event pair, and the
  four halt classes are data rather than a switch. The three `DECISION` points are
  resolved once, in one file.
- `token.ts` handles the two things that actually go wrong with a token protocol:
  a token inside a fenced plan block, and a response settled by `debounce`.
- `scheduler.ts` has exactly one completion decision point, which is the fix for
  the v5 hang, and the drop rotation is tested for fairness rather than assumed.
- `session.ts` writes atomically and reconstructs `SUSPENDED` from timestamps,
  which is the correct inference for a process that cannot write its own death.
- The 41-suite run is green after `npm run clean`, and the two teardown races
  that used to produce silent false negatives are gone.

---

## Unblock conditions

Ordered. The first three are the product; the rest are hardening.

1. `rankSlice` must include file bodies. `RepoReader.bodies(paths)` already
   returns them; the ranker needs to take them and build real content, and the
   test must assert content is present, not just ordering.
2. The runner must persist sub-state transitions, so `session.json` is true.
3. The bundle must be assembled on CONSENSUS, and `user.resume` /
   `user.confirm.bundle` / `handoff.confirmed` need callers.
4. `finish()` must resolve the planner by role, not index 0.
5. A refused transition must be raised as an event, not dropped.
6. `maxTurns` exhaustion must halt with a reason.
7. `search` must cap query length and reject a pattern that fails to compile.

Findings 12–15 are worth doing and do not block.

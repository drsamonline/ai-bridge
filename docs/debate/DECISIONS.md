# Decisions

Eight places where SPEC v6 was ambiguous, contradictory, or silent, and what the
code does instead. Each one is a `DECISION` comment at the point it is enforced;
this file is the index, because a decision you can only find by reading a module
is a decision the next person will re-litigate.

Format: what the spec says, what was decided, what it costs, where it lives.

---

## D1 — A required role dropping out goes to the user, not to a degrade

**Spec:** §8 says a degraded planner blocks consensus and halts to `NEEDS_USER`.
It says nothing about the auditor, and §9's per-participant rules read as though
any participant can degrade independently.

**Decision:** both required roles behave the same way. Losing the planner or the
auditor halts to `NEEDS_USER` with `PLANNER_DEGRADED` / `AUDITOR_DEGRADED`.

**Why:** the planner is the only writer of the plan artifact and the auditor is
the only participant that may raise an objection (§15). Losing either leaves a
session that can reach consensus over an artifact nobody wrote or nobody checked
— which is the failure the whole product exists to prevent.

**Cost:** a debate can be stopped by one participant, where a per-participant
degrade would have let the other four continue. Accepted: four participants
auditing nothing is not worth the tokens.

`bridge/src/runtime/stateMachine.ts` — `requiredRoleLost`, `isRequiredRole`.

---

## D2 — The login ceiling aborts for a required role, and writes no degrade

**Spec:** §9 has two rows for the same event: `AWAITING_LOGIN (i) 5 min ceiling →
DEGRADED (i)`, and `AWAITING_LOGIN (planner or auditor) 5 min ceiling → ABORTED
(AUTH_BLOCKED)`.

**Decision:** for a required role the abort wins and no `DEGRADED` sub-state is
written. For a debater, the degrade applies and the session continues.

**Why:** the two rows cannot both fire. Writing a degrade and then aborting would
leave a record claiming a participant is recoverable in a session that is over.

**Cost:** a user who fixes the planner's login four minutes and fifty seconds in
still loses the session. Accepted: the alternative is a session with no plan.

`stateMachine.ts` — `login.ceiling`.

---

## D3 — A settle timeout degrades a debater and escalates a required role

**Spec:** §9 says `ACTIVE settle timeout → STREAM_TIMEOUT (participant i →
DEGRADED)`. §16 files `STREAM_TIMEOUT` as a *user-gated halt*.

**Decision:** a debater timing out is a per-participant degrade and the round
continues; the planner or auditor timing out halts to `NEEDS_USER` with
`STREAM_TIMEOUT`.

**Why:** this is the only reading where both sections are true. A halt on every
debater timeout would make the roster fragile; a degrade on the planner would
leave the artifact stale.

`stateMachine.ts` — `settle.timeout`.

---

## D4 — Resuming from `SUSPENDED` puts every participant into `REATTACHING`

**Spec:** §9 says `SUSPENDED → REATTACHING per participant`, but `REATTACHING` is
a per-participant sub-state, not a session state.

**Decision:** the session returns to `ACTIVE` and each participant starts in
`REATTACHING`. Completion and quorum skip them until each passes its restatement
check.

**Why:** a session state of `REATTACHING` would stop dispatch to participants that
are already fine. The sub-state model exists precisely so one participant's
recovery does not block the others.

`stateMachine.ts` — `session.selected`.

---

## D5 — An open question gates consensus and does not halt dispatch

**Spec:** §14 says both "non-empty open moves session to `NEEDS_USER` at end of
current turn" and "questions block gates consensus without halting dispatch".

**Decision:** the ledger reading. An open question blocks consensus — unanimity on
a plan whose question nobody answered is not an agreement — and a session with
open questions runs to its budget, handing the questions to the user in the
bundle.

**Why:** moving to `NEEDS_USER` *is* halting dispatch, so the two sentences cannot
both hold. The second describes a ledger; the first describes a second `ASK_USER`,
which already exists.

**Cost:** a session can burn its budget while a question sits unanswered. The
bundle makes that visible rather than silent.

`bridge/src/runtime/questions.ts` — header, `blocksConsensus`.

---

## D6 — The reservation is one planner turn, not a whole round

**Spec:** §8 says one forced planner turn runs before `BUDGET_EXHAUSTED`, to stop
a plan shipping that predates the last debater's input.

**Decision:** the reservation phase is a single planner turn. When the planner has
spoken under it, the budget is exhausted.

**Why:** an earlier implementation returned the planner from `nextSpeaker()`
whenever the phase was `reservation`, so the runner asked for the planner again,
forever. Found by driving the scheduler from the runner, not by reading it.

`bridge/src/runtime/scheduler.ts` — `nextSpeaker`, `completeTurn`.

---

## D7 — A debater is sent no code at all

**Spec:** §7's table gives debaters a 0 KB snapshot slice and says their job is
the argument, not the code.

**Decision:** enforced, not merely budgeted. `payload.ts` omits the snapshot block
entirely for a debater — no empty fence, no header.

**Why:** a fence tagged `snapshot` with nothing in it reads as "the code was too
large to include", which invites a debater to speculate about what it could not
see. Absence is a clearer signal than emptiness.

`bridge/src/runtime/payload.ts` — `PAYLOAD_CAPS`, `buildPayload`.

---

## D8 — Failover never leaves a participant's declared provider set

**Spec:** §6 says failover is constrained to the participant's set and a
participant whose set is exhausted degrades. The runtime's own chain walk does the
opposite: it picks whichever provider answers.

**Decision:** `resolveParticipantProvider` returns a provider from the set or
`PROVIDER_SET_EXHAUSTED`, and the live dispatch throws a typed error rather than
borrowing another tab.

**Why:** the roster the user chose, the `[round n | role]` provenance in every
context block, and the plan artifact all say participant 2 is Claude. A silent
switch to GPT makes the transcript a lie and the objections uncheckable.

**Cost:** a session with one provider per participant is less resilient than one
that fails over globally. That is the trade the debate makes.

`scheduler.ts` — `resolveParticipantProvider`; `liveDispatch.ts`.

---

## Still undecided

- **Shared accounts.** Two participants may name the same provider, and therefore
  share a quota. `validateRoster` reports it (`sharedAccounts`) rather than
  blocking it. Whether the roster should *forbid* it is a product call nobody has
  made.
- **The stall threshold.** `STALL_THRESHOLD = 0.95` over two consecutive turns by
  the same participant. A debater legitimately repeating "no objection to this
  revision" will trip it. One constant if it proves too eager against real models.

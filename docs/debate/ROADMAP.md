# Roadmap — what to build, in the order that reduces risk fastest

Derived from `AUDIT.md` (findings 7, 9–15 open) and `runtime-split-map.md`
(step 7 outstanding). Ordered so that everything not needing a browser lands
before anything that does, and so the big batch has nothing cheap left inside it.

Sizes: **S** ≈ an hour, **M** ≈ half a day, **L** ≈ multi-day.

---

## Batch 1 — quick wins

**Done — `8a23229`.** All five landed with tests; 41/41 suites green after a clean
build. The context budget and the drop rotation are now live in the runner, the
port reports what it skipped, and there is one RAM cap.

Five small, independent, local fixes. No new surface, no browser, each one a
failing test first. This batch exists because every item is a correctness or
robustness hole that would otherwise be discovered in batch 5, when a real
session is running and debugging is expensive.

| # | Fix | Files | Acceptance | Size |
|---|---|---|---|---|
| 1.1 | `search({ regex: true })` builds a `RegExp` from a model's plan text. Cap the pattern length and compile inside a try/catch that falls back to a literal search. | `bridge/src/repo/nodeFsPort.ts` | A 10 KB pattern is refused; a syntactically invalid one does not throw; both fall back to literal | S |
| 1.2 | Files over `maxFileBytes` vanish from the snapshot with no record. Return them as `skipped: { path, bytes, reason }[]` and put that in the manifest. | `nodeFsPort.ts`, `slice.ts`, `bundle.ts` | A 2 MB file appears in `skipped`, not absent; the manifest carries it | S |
| 1.3 | Two sources of truth for the RAM cap — `validateRoster` and `LeaseLedger` each default independently. One `RamBudget` value passed to both. | `session.ts` | A roster that validates also leases; one test asserts they agree at the boundary | S |
| 1.4 | The context block caps each message at 600 characters, ignoring §7's 6 KB block budget. Apply the budget with a per-message share. | `runner.ts` | Five long messages produce a block ≤ 6 KB | S |
| 1.5 | `planContextDrops` is built and tested but never called. Wire the rotation into the runner's context block and persist `skip` across turns. | `runner.ts` | Rotation state carries between turns; the drop set is recorded | M |

**Unblocks:** nothing on its own. It stops batch 3 from shipping a manifest that
lies about what the auditor saw.

---

## Batch 2 — the unreachable states

**Done — `00b2b9c`.** All four landed. The runner now reaches 19 of the machine's
35 events; `AWAITING_LOGIN` and `ABORTED`-via-login remain for batch 5, and the
rest are gates the user drives rather than the loop.

Four pure-logic items, no browser. The state machine already has every transition;
the runner raises 14 of 35 events. This batch closes the gap between what the
machine models and what the loop can reach.

| # | Fix | Files | Acceptance | Size |
|---|---|---|---|---|
| 2.1 | `questions.md` ledger: append-only entries with `{id, round, askedBy, text, status}`; non-empty open blocks consensus; `NEEDS_USER` at end of turn. | `session.ts` or new `questions.ts`, `runner.ts`, `bundle.ts` | An open question diverts a consensus to `NEEDS_USER`; the bundle counts open vs answered | M |
| 2.2 | `resolutions` fenced block parsed from planner turns, mapping `obj-<round>-<participant>` to text. Unmatched objections ship open. | `token.ts`, `runner.ts`, `bundle.ts` | An answered objection appears resolved in `objections-resolved.md`; an unanswered one still ships open | S |
| 2.3 | `STALLED`: Jaccard on lowercased word tokens, > 0.95, two consecutive turns by the same participant. | `runner.ts` or new `stall.ts` | Two near-identical turns by one participant halt to `STALLED`; two similar turns by *different* participants do not | S |
| 2.4 | `WALL_CLOCK` via an injected clock, plus the `ABORTED` path and GC on startup. | `runner.ts`, `session.ts` | An exhausted wall clock halts with `WALL_CLOCK` and the last good plan; an aborted session releases leases and closes tabs | M |

**Not in this batch:** `AWAITING_LOGIN`. The transition exists and `signin.ts` can
detect a login page, but promotion to a visible tab is a browser operation. It
belongs to batch 5 or it will be written twice.

---

## Batch 3 — wire what already exists

**Mostly done — `1eb0931`.** 3.1, 3.2 and 3.3 landed. **3.4 moved to batch 5:**
`ctl.session.*` needs a `PROTOCOL_VERSION` bump against a file marked frozen, and
every useful op on it needs a `Dispatch`, which does not exist until 5.3. Doing
the protocol change before the seam it exposes would mean doing it twice.

Everything here is built and tested; none of it is connected. This is the batch
that makes the engine usable from outside without touching a browser.

| # | Fix | Files | Acceptance | Size |
|---|---|---|---|---|
| 3.1 | Snapshot slice into the turn payload: `reader.bodies()` → `rankSlice` with the per-role budget → `DispatchRequest.snapshotText`. Currently always empty. | `runner.ts`, new `snapshot.ts` glue | A run with a real repo produces a non-empty, under-budget, content-bearing slice for planner and auditor, and none for debaters | M |
| 3.2 | Leases wired to the controller so `closeIdleTabs` skips pinned tabs. | `session.ts`, `index.ts` | A leased tab survives an idle sweep; a released one does not | M |
| 3.3 | Move `extension/src/rotation/rotator.ts` into the bridge (map step 5, missed). | move + imports | Rotation suite green against the new path | S |
| 3.4 | `ctl.session.*` ops over the existing wire protocol: create, state, resume, bundle, handoff. | `index.ts`, `shared/src/types.ts` (additive), `shared/src/control.ts` | A session can be created, driven and bundled entirely over `ctl.*` with a fake dispatch | L |

**Unblocks:** the shell. After this, Option B's side panel has something to call.

---

## Batch 4 — the served shell's security

**Done — `6b2b18e`.** Guard module plus the wiring, 13 checks. The server had no
HTTP request handler at all, so this also added the minimal shell page the
authorisation path needed to be real.

Map step 7. Independent of everything above, and it should not wait for batch 5 —
it is a hole in a page the bridge already serves.

| # | Fix | Files | Acceptance | Size |
|---|---|---|---|---|
| 4.1 | Single-use nonce in the URL, `Origin`/`Host` validation on HTTP and WS, one `/auth` POST, CORS off elsewhere, bind 127.0.0.1 only. | `bridge/src/server.ts` | A request with a foreign `Origin` is refused; a replayed nonce is refused; `Host: evil.test` is refused (DNS rebinding) | M |

---

## Batch 5 — the large one

**Split — `02b2ae4`.** The code-shaped half landed: `payload.ts` (§7 assembly,
which did not exist) and `liveDispatch.ts` (written and typechecked, never run
against a page). The browser-shaped half is written down as
[`LIVE-GATE.md`](LIVE-GATE.md) instead of pretended: live selectors, one fastpath
template, and the first real session, each with what to run and what success
looks like.

Everything that needs a real browser. Do not start before batch 3, because the
payload is where the slice and the context block actually reach a participant.

| # | Fix | Acceptance | Size |
|---|---|---|---|
| 5.1 | Live selector validation against ChatGPT, Claude and Gemini; fix or replace the fixtures-only selectors | A real turn settles on each of the three | L |
| 5.2 | One fastpath provider template (captured cURL → replay) | A prompt is answered without typing; the DOM path is not used | M |
| 5.3 | A real `Dispatch`: wrap `Relay` behind the runner's seam | The runner drives a live page end to end | L |
| 5.4 | `AWAITING_LOGIN` with promotion and the 5-minute ceiling | A signed-out participant is promoted, logs in, and rejoins | M |
| 5.5 | First real session: five participants, one plan, one bundle | A bundle on disk that a human would accept | L |

---

## Sequencing rules

1. **Batch 1 before 3.** A manifest that silently omits the files the auditor
   needed is worse than no manifest.
2. **Batch 2 before 5.** A session that cannot detect a stall burns a wall clock
   on a live browser instead of a fake.
3. **Batch 4 anywhere after 1.** It touches one file and blocks nothing.
4. **Never start 5 with anything from 1–3 still open.** Every hour of debugging
   against five live tabs costs an afternoon; every hour against a fake costs
   minutes. That asymmetry is the whole reason for this order.

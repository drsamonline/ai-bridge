SPEC v6 — final

Supersedes v5. No diffs, no REMOVE/AMEND markers. This is the working spec.

---

1. Topology

Bridge Node process owns everything: playwright-core CDP connection, adapter registry, response observer, context assembler, router, RAM monitor, watchdog, transcript storage, session state, turn scheduler, repo snapshot provider, delta transport, rate-limit rotator, HTTP/WS server. Shell is a UI.

Option B (v1 shipping path): no MV3 extension. Side panel is a page served by the bridge at 127.0.0.1:47615. Removes packaging, Web Store review, native-messaging install, MV3 constraint surface.

Option A (v2+): MV3 side-panel client + native-messaging host that spawns the bridge. Bridge unchanged. Shell rewritten. Per-OS installer.

Both shells are UI clients over the same local protocol. Engine identical.

2. Reuse map

Path Status Role
shared/src/types.ts AMEND additively Frozen Adapter interface preserved; PROTOCOL_VERSION bump; new BridgeMsg variants appended
shared/src/client.ts KEPT Client to the bridge server
shared/src/lock.ts KEPT Auth token lock file
shared/src/control.ts KEPT Shell control messages
bridge/src/server.ts EXTEND Serves shell, HTTP, WS. Requires nonce issuance, Origin/Host validation, single /auth POST — see section 13. Prior specs omitted this file entirely from the map; it is the v1 shell's transport.
bridge/src/protocol/* KEPT Wire protocol
bridge/src/router/router.ts KEPT Message routing
bridge/src/ram/* KEPT, extended RAM monitor; block threshold session-configurable
bridge/src/watchdog.ts KEPT Watchdog
bridge/src/bootTransport.ts KEPT, extended Delta transport — see section 7
bridge/src/adapters/types.ts KEPT Frozen Adapter contract
bridge/src/adapters/registry.ts KEPT Adapter registry
bridge/src/adapters/models.ts KEPT Model metadata
bridge/src/adapters/chatgpt.ts KEPT, unverified live Participant adapter. Selector validation is a gate before first session.
bridge/src/adapters/claude.ts KEPT, unverified live Same gate
bridge/src/adapters/gemini.ts KEPT, unverified live Same gate
bridge/src/adapters/custom.ts KEPT Config-driven adapter for Sarvam and other sites
bridge/src/adapters/domAdapter.ts KEPT DOM floor fallback
bridge/src/adapters/observer.ts KEPT, extended settledBy promoted to first-class; token parse keyed to it
bridge/src/adapters/signin.ts KEPT URL heuristic
bridge/src/cdp/controller.ts KEPT, extended Owned-tabs map becomes participant registry; add lease. Header comment says "ATTACH ONLY" but cdp/launch.ts exists and imports launchBrowser; the comment is stale.
bridge/src/cdp/launch.ts KEPT Attach mode adopts contexts()[0]; launch mode not the default path
bridge/src/fastpath/* KEPT, inert Provider templates do not exist; fastpath is inert until one is authored. Prerequisite for the timing model.
bridge/src/runtime.ts SPLIT — single 1,169-line file Four modules. Preserve inside the split: fastpath rung selection, composeBoot composition, limit detection, retry internals. Failover policy changes at the participant boundary — section 6.
extension/src/rotation/rotator.ts MOVE → bridge/src/rotation/rotator.ts bridge/src/ratelimit/* does not exist. Extended for per-participant rate budgets.
extension/src/repo/reader.ts MOVE → bridge/src/repo/reader.ts Repo reader; zero VS Code references
extension/src/repo/relevance.ts MOVE → bridge/src/repo/relevance.ts, EXTEND Today is a gate: contextWorthIt(query) returns {attach, reason}. Extended into a ranker over RepoBundle files with per-file token accounting — see work item 6. v5 asked it to slice 15/30 KB per turn, which it cannot do today.
extension/src/repo/ports.ts MOVE → bridge/src/repo/ports.ts Port interface; new implementation by shell
extension/src/repo/service.ts NOT MOVED VS Code wiring
extension/src/repo/vscodePorts.ts NOT MOVED VS Code wiring
extension/src/repo/applier.ts NOT MOVED Write path; debate never writes files
extension/src/repo/proposal.ts NOT MOVED Write path; debate never writes files
extension/src/* (rest) RETIRED (B) / REWRITTEN (A) Option A is a rewrite, not a port
Test estate (930 / 34) KEPT, extended Add scheduler, state machine, relay, session, snapshot, security, delta-transport suites

3. Work items

Seven.

1. bridge/src/runtime/scheduler.ts — round-robin, expected_next_speaker, dispatch mutex, budget FIFO with sequence. Participant-boundary failover policy (section 6). Degraded/blocked skip and completion re-evaluation (section 8).
2. bridge/src/runtime/stateMachine.ts — states, transitions, timeouts. Section 9.
3. bridge/src/runtime/relay.ts — token parse, context assembly, dispatch, snapshot slicing, delta transport emit. Sections 5, 7, 10.
4. bridge/src/runtime/session.ts — session registry, participant lifecycle, tiers, threadKey, lease, handoff.
5. bridge/src/rotation/rotator.ts — moved; per-participant budgets across 5-way roster.
6. bridge/src/repo/relevance.ts — extended from gate to ranker. Input: RepoBundle files, current plan-vN, per-role slice budget. Output: ordered file list with per-file token counts, totals under budget. Existing contextWorthIt retained as a fast pre-filter. New suite.
7. bridge/src/server.ts — extended for served-shell security: nonce issuance, Origin/Host validation on HTTP and WS, single /auth POST, CORS disabled elsewhere, bind 127.0.0.1 only. See section 13.

4. Participants & tiers

Max 5. Roles: planner (1, required), auditor (1, required, Sarvam), debater (0–3).

Tiers:

· visible — max 2, user-arranged tabs. Split View is Option A only.
· background — leased, exempt from closeIdleTabs
· headless — max 1 per OS-level Chrome profile

Lease. lease.acquire(participantIndex, sessionId) pins an owned tab to the session. closeIdleTabs skips leased tabs. RamMonitor block threshold session-configurable, recommend 2000 MB for five participants. Session creation fails with RAM_INSUFFICIENT before any tab opens if lease acquisition would exceed threshold.

Roster fixed at session start, mutable at round boundaries only. Schema rejects visible > 2, headless > 1 per profile.

5. Protocol

Tokens, last non-whitespace line, outside any fenced block:

```
[[READY]]
[[REPLY]]
[[ASK_USER: question | options | default]]
[[ESCALATE: one sentence]]
[[OBJECTION: text | severity]]
[[CONSENSUS]]
```

[[READY]] valid only in HANDSHAKE_PENDING or REATTACHING.

Parse keyed to observer.settledBy:

· sentinel or stop-gone → trust token parse.
· debounce → retry once. Second debounce → MALFORMED_RESPONSE.
· timeout → STREAM_TIMEOUT.

Last non-whitespace line, outside fenced block, regex-anchored. Multiple tokens → last, warning logged. No token → retry path above.

Plan extraction. plan fenced block extracted from any planner turn, regardless of terminating token. A planner [[CONSENSUS]] turn updates plan-vN before consensus is evaluated. A planner [[REPLY]] without a plan block → retry once, second miss → MALFORMED_RESPONSE.

Word cap. 500 words per message, hard.

SCOPE_VIOLATION — per-participant degrade. Fires on:

· any fenced block with a programming-language tag (python, js, ts, java, go, rust, c, cpp, html, css), any length
· response over 500 words

Tracked alongside MALFORMED_RESPONSE as a distinct counter. Whichever threshold first degrades the participant.

ESCALATE acceptance. Accepted iff the text after the colon is non-empty after trimming. Accepted → budget +1. Rejected → no budget change, escalate counter +1. Cap 3 per session, both accepted and rejected count against cap.

6. Failover policy — participant boundary

runtime.ts internal failover serves a single-user prompt where any provider that answers is fine. In a five-participant debate this silently changes who is speaking — participant 3 was Claude, hits a limit, and the next context block is labelled participant 3 while containing GPT. Roster invariant and [round n | role] provenance break.

Policy:

· Failover constrained to a participant's declared provider set, fixed at session start.
· A participant whose declared provider set is exhausted transitions to PARTICIPANT_DEGRADED, not to a different model.
· detectLimit and the rotator are preserved; the chain-walk policy is not.
· Internal retry within the same provider (transient failure, rate-limit backoff) is preserved — it does not change who is speaking.

7. Context assembly & delta transport

Per-turn payload, per role. Hard caps.

Item Planner Auditor Debater
Snapshot slice 15 KB 30 KB 0
Plan block 6 KB 6 KB 6 KB
Context block 6 KB 2 KB 6 KB
Questions block 2 KB 2 KB 2 KB
Suffix + role line 1 KB 1 KB 1 KB
Turn total 30 KB 41 KB 15 KB

Delta transport. Full re-send per turn costs roughly 70,000 tokens per participant thread by round 7 — comfortable on a paid 128k window, not on free tiers this project targets, unbounded under user-forced rounds. bootTransport.ts already implements §6.2 delta transport (composeBoot, deltaLineCount) precisely to send what changed. Extended and used here:

· Plan block — sent as a diff against the previous plan-v(N-1). Full plan sent only on handshake and on plan-vN first creation. Debater/auditor receive diffs from the round they joined.
· Context block — new messages only since that participant's last turn. Full min(3, count) block sent only on handshake and after REATTACHING.
· Snapshot slice — sent only when the plan's touched paths changed since that participant's previous turn. Touched paths computed from the plan diff. Otherwise a two-line header names the frozen snapshot and omits the slice body.
· Questions block — new open entries only. Answered/dropped entries sent as id-only deltas.

Full-reboot re-send triggers: HANDSHAKE_PENDING, REATTACHING, first turn after PARTICIPANT_DEGRADED. Manifest records which turns were delta vs full.

Snapshot slice selection. bridge/src/repo/relevance.ts (work item 6) ranks RepoBundle files by relevance to the current plan-vN, with per-file token accounting. No compression on the slice — T0 is a lossy transform and an auditor objecting to an elided symbol is a real failure mode. Compress the conversation, not the artifact. Filter rationale (paths included, paths excluded, scoring input) recorded in manifest.

Auditor gets 2× planner slice because its job is checking the plan against the code. Debaters get none because their job is critique of the plan's reasoning.

Context block drop rules (when over cap):

· Included: last min(3, count) per other participant, round order.
· If over cap: drop messages round-robin by participant, oldest from the participant with most messages, iterating to budget.
· Rotation: participant whose oldest message was dropped in the previous turn is skipped in the current turn's drop pass.
· Rotation failsafe: if skipping the rotated-out participant cannot reach budget (that participant is the only one with droppable messages), rotation is ignored this turn and messages are dropped from the highest-count participant. Recorded in manifest.
· Manifest records dropped messages with round index and participant index.

8. Round mechanics

ROUND_BUDGET = 7 default.

Completion. Round completes when the last non-degraded, non-blocked participant in roster order completes a turn. PARTICIPANT_DEGRADED and PARTICIPANT_BLOCKED are skipped for completion and excluded from consensus quorum.

Degrade/block re-evaluation. On any degrade or block during a turn, completion is re-evaluated immediately. If remaining non-degraded, non-blocked participants have all spoken, round completes. Transition into degradation is a completion event.

Block timeout re-evaluation. The 5-minute block timeout, on firing, transitions the participant to PARTICIPANT_DEGRADED and re-evaluates completion.

Planner degrade. Degraded planner blocks CONSENSUS unconditionally. Session halts to NEEDS_USER with reason PLANNER_DEGRADED.

Reservation. One forced planner turn runs before BUDGET_EXHAUSTED. Prevents shipping plan-vN predating last debaters' input.

User Force Round. Unbounded, serialized through scheduler FIFO.

[[CONSENSUS]]. Valid when all active participants emit it within the same round, or user confirms at NEEDS_USER or WALL_CLOCK. Unilateral → NEEDS_USER. Quorum is active participants only.

Consensus reject. User at NEEDS_USER or WALL_CLOCK may decline. Decline logs reason, does not freeze, does not increment budget, returns to ACTIVE with expected_next_speaker unchanged. Distinct from Force Round: reject buys no budget.

STALLED. Two consecutive turns by the same participant with Jaccard token similarity above 0.95 on lowercased word tokens. No "sides" — roster is not two camps.

9. State machine

Session states: IDLE, INITIALIZING, HANDSHAKE_PENDING, AWAITING_LOGIN, ACTIVE, SUSPENDED, NEEDS_USER, STALLED, WALL_CLOCK, BUDGET_EXHAUSTED, CONSENSUS, AWAITING_HANDOFF_CONFIRM, HANDED_OFF, ABORTED.

Per-participant sub-states (session remains its session state; dispatch proceeds for other participants): HANDSHAKE_PENDING (participant i), BLOCKED (participant i), DEGRADED (participant i), REATTACHING (participant i).

Transitions:

From Event To
IDLE session.create INITIALIZING
INITIALIZING preamble sent to participant i HANDSHAKE_PENDING (i)
INITIALIZING participant i requires login AWAITING_LOGIN (i)
INITIALIZING RAM block exceeded ABORTED (RAM_INSUFFICIENT)
HANDSHAKE_PENDING (all) all [[READY]] exact ACTIVE
HANDSHAKE_PENDING (i) fails after retry, or 60 s DEGRADED (i)
HANDSHAKE_PENDING (i) all participants degraded ABORTED (HANDSHAKE_FAILED)
AWAITING_LOGIN (i) login success HANDSHAKE_PENDING (i)
AWAITING_LOGIN (i) 5 min poll ceiling DEGRADED (i)
AWAITING_LOGIN (planner or auditor) 5 min poll ceiling ABORTED (AUTH_BLOCKED)
any storage write fails ABORTED (STORAGE_FULL, path, round)
ACTIVE round == budget, reservation unused forced planner turn
ACTIVE budget reached after reservation BUDGET_EXHAUSTED
ACTIVE all active [[CONSENSUS]] same round CONSENSUS
ACTIVE unilateral [[CONSENSUS]] NEEDS_USER
ACTIVE any [[ASK_USER]] NEEDS_USER
ACTIVE stall fires (same participant, 2× > 0.95) STALLED
ACTIVE wall clock exhausted WALL_CLOCK
ACTIVE tab lost for participant i BLOCKED (i), re-evaluate completion
ACTIVE participant i degrades DEGRADED (i), re-evaluate completion
ACTIVE planner degrades NEEDS_USER (PLANNER_DEGRADED)
ACTIVE settle timeout STREAM_TIMEOUT (participant i → DEGRADED)
ACTIVE participant i emits [[ESCALATE: <non-empty>]] (≤3 session total) ACTIVE, budget +1
ACTIVE participant i emits [[ESCALATE:]] (empty) ACTIVE, escalate counter +1, budget unchanged
NEEDS_USER user resumes ACTIVE
NEEDS_USER user declines consensus ACTIVE (expected_next_speaker unchanged)
NEEDS_USER user confirms consensus CONSENSUS
STALLED user resumes ACTIVE
STALLED user forces round ACTIVE, budget +1
WALL_CLOCK user freezes CONSENSUS
WALL_CLOCK user declines ACTIVE (expected_next_speaker unchanged)
WALL_CLOCK user forces round ACTIVE, budget +1
WALL_CLOCK user aborts ABORTED
BUDGET_EXHAUSTED user forces round ACTIVE, budget +1
BUDGET_EXHAUSTED user confirms CONSENSUS
CONSENSUS user confirms bundle AWAITING_HANDOFF_CONFIRM
AWAITING_HANDOFF_CONFIRM user clicks "I confirmed" in shell HANDED_OFF
AWAITING_HANDOFF_CONFIRM 7 days elapsed HANDED_OFF
BLOCKED (i) target restored REATTACHING (i)
BLOCKED (i) 5 min timeout DEGRADED (i), re-evaluate completion
REATTACHING (i) [[READY]] + restatement passes ACTIVE (i)
REATTACHING (i) 2 failed attempts DEGRADED (i), re-evaluate completion
SUSPENDED session selected REATTACHING per participant
any user aborts ABORTED

Per-state timeouts:

· HANDSHAKE_PENDING (i): 60 s
· ACTIVE dispatch: observer.settledBy; timeout → STREAM_TIMEOUT
· AWAITING_LOGIN (i): 5 min poll ceiling
· BLOCKED (i): 5 min → DEGRADED (i)
· NEEDS_USER, STALLED, WALL_CLOCK, BUDGET_EXHAUSTED, CONSENSUS, AWAITING_HANDOFF_CONFIRM: user-gated, no timeout

SUSPENDED reconstruction. A killed process cannot write SUSPENDED. The bridge reconstructs at startup by scanning sessions/ for non-terminal sessions whose last mutation timestamp predates process start. Such sessions load as SUSPENDED. INITIALIZING is entered only from IDLE on session.create.

ABORTED semantics. Release all leases, close all owned tabs registered to the session, retain transcript and bundle in sessions/<id>/ for 7 days, then GC. ABORTED sessions do not participate in startup reconstruction. SUSPENDED sessions do.

Handoff confirmation mechanism. The bridge cannot observe confirmation inside Sarvam's UI. The shell exposes an "I confirmed build in Sarvam" button at AWAITING_HANDOFF_CONFIRM. Clicking it transitions to HANDED_OFF. The 7-day auto-transition covers the case where the user never clicks.

10. Snapshot & handshake

Repo snapshot captured at session create via bridge/src/repo/reader.ts and relevance.ts. Paths, branch, commit, file set, and content hashed into manifest.json under repoSnapshot. No compression on the snapshot path. Snapshot re-capture is a new session.

Handshake preamble (literal):

```
SESSION <sessionId> — PARTICIPANT <index> — ROLE <planner|auditor|debater>
You are one participant in a multi-AI planning debate.
You do not have live repo access. You have a frozen read-only snapshot:
  <snapshotId>, hash <sha256>, captured at <timestamp>, size <bytes>.
The snapshot is identical for all participants. It cannot be modified during the debate.
A relevance-filtered slice of the snapshot accompanies turns where the plan's touched paths change.
You do not write files.
You output exactly one control token at the end of every message, outside any code block:
[[READY]] | [[REPLY]] | [[ASK_USER: question | options | default]] | [[ESCALATE: one sentence]] | [[OBJECTION: text | severity]] | [[CONSENSUS]]
Messages cap at 500 words. No implementation code. Plan changes go in a fenced block tagged plan.
Reply with [[READY]] and nothing else.
```

Protocol suffix on every dispatch:

```
REMINDER — end with exactly one token. No code. 500 words max.
```

Sarvam handoff targets a fresh Sarvam thread, not the auditor thread. Auditor thread holds read-only framing; reusing it puts "do not write files" in context at the moment of asking it to build.

11. Auth

bridge/src/adapters/signin.ts URL heuristic. No probe, no 1-hour cache, no request budget.

First-run AWAITING_LOGIN (i): promote to visible, serialized one at a time. If both visible slots full, promote to focused background tab with banner. User focuses manually.

Poll 3 s → 15 s backoff, ceiling 5 min.

Ceiling → DEGRADED (i). Session aborts only if the degraded participant is the planner or auditor (AUTH_BLOCKED).

Demote to configured tier at round boundary after first successful turn.

headless participant with no prior auth must authenticate via visible tab first. Never construct a headless context with no session.

Launch mode. Attach mode adopting contexts()[0] (user's real profile). launchBrowser with ~/.ai-bridge/browser-profile is not the default — signed out of everything.

12. Chat lifecycle

sessionId ULID. threadKey = hash(sessionId + participantIndex + handshakeTs), stored in sessionStorage of participant tab. Survives in-origin navigation, dies on tab close.

Always newChat via cdp/controller.newTab, never reuse user thread.

[[READY]] exact match, one retry.

Attach/reattach/swap unified: [[READY]] + restatement paragraph. Entity coverage 0.7 against current plan-vN.md (capitalized tokens, snake_case identifiers, numbered task titles). One retry, then DEGRADED.

Browser restart → SUSPENDED (reconstructed). Resume per participant via rolling hash of min(3, count) messages. count === 0 → fresh attach.

Background-tab discard. Chrome Memory Saver discards background tabs. REATTACHING on restore is the normal path. CDP Target.targetInfoChanged triggers reattach. Lease mitigates but does not prevent.

13. Shell

Option B. Shell is a page served by the bridge at 127.0.0.1:47615. visible tier means two tabs the user arranges. Split View is not available over CDP. caps.splitView = true only when the shell is an extension.

Served-shell security — required:

· Single-use nonce in the URL at first load. Nonce generated per session launch, printed on CLI, required for page and WS handshake.
· Origin and Host validation on HTTP and WS handshakes. Reject any Origin not 127.0.0.1:47615 or localhost:47615. Reject any Host not in that set. Defeats DNS rebinding.
· Token never embedded in HTML. Nonce in URL; token exchanged via POST /auth once, held in memory by the shell.
· CORS disabled for all endpoints except /auth POST.
· Bind 127.0.0.1 only, never 0.0.0.0.

Option A. MV3 side-panel client + native-messaging host that spawns the bridge. Split View via chrome.tabs.create({ splitViewId }). Per-OS native-messaging installer.

14. questions.md lifecycle

Entry schema:

```
{ id, round, asked_by, text, options, default, status: open|answered|dropped }
```

Rules:

· Append-only. Auditor appends; no participant overwrites.
· Only user marks answered.
· Non-empty open moves session to NEEDS_USER at end of current turn.
· Non-empty open blocks CONSENSUS. [[CONSENSUS]] while open questions exist converts to NEEDS_USER.
· Dropped entries retained with reason.
· questions fenced block from auditor is the source. Prose questions in a [[REPLY]] body without a questions block are ignored and logged.

[[ASK_USER]] halts immediately. questions block gates consensus without halting dispatch.

15. Plan artifact & objections

Planner [[REPLY]] must contain fenced block tagged plan. Missing → retry once, second miss → MALFORMED_RESPONSE.

[[OBJECTION]] accepted only from auditor. Recorded with round index, severity.

Resolution mechanism. A planner turn may carry a fenced resolutions block mapping objection id to resolution text:

```
​```resolutions
obj-<round>-<seq>: <one-line resolution text>
obj-<round>-<seq>: <one-line resolution text>
​```
```

Objections without a matching entry ship in the bundle as open, carrying their round index and full objection text. objections-resolved.md generated deterministically from the token stream plus resolutions blocks. No prose parsing.

16. Halt taxonomy

Four classes.

Terminal: HANDSHAKE_FAILED (all participants), AUTH_BLOCKED (planner or auditor), STORAGE_FULL, RAM_INSUFFICIENT (session-create only).

Transient (per-participant): AWAITING_LOGIN, REATTACHING, BLOCKED, DEGRADED.

Configuration rejection: PARTICIPANT_LIMIT, VISIBLE_LIMIT, PROFILE_CONTENTION.

User-gated: NEEDS_USER, CONSENSUS, BUDGET_EXHAUSTED, STALLED, WALL_CLOCK, STREAM_TIMEOUT.

MALFORMED_RESPONSE and SCOPE_VIOLATION are per-participant degrade triggers, not halt reasons. Both feed DEGRADED (i); tracked as distinct counters. Degraded planner → NEEDS_USER (PLANNER_DEGRADED).

17. Humanization & trusted input

cdp/controller dispatches trusted events via Input.insertText by default. No content-script synthesis path. React value-setter handled by Playwright.

keystroke_delay off by default. When on: log-normal 30–150 ms inter-keystroke, word-boundary pauses, occasional backspace-retype. Anti-detection toggle, not a technical requirement. Wall-clock recommends 240 min when on.

Pre-send pause 800–2500 ms retained when keystroke_delay on.

fastpath replay, when provider template exists, skips typing entirely.

Automation infobar correction. buildLaunchArgs in cdp/launch.ts passes --remote-debugging-port, --user-data-dir, --no-first-run, --no-default-browser-check, --disable-features=Translate, --disable-background-mode. No --enable-automation. The "Chrome is being controlled by automated test software" banner originates from that flag, not CDP. Verify once on a real launch; if confirmed absent, no infobar cost applies in either attach or launch mode.

18. RAM

RamMonitor default 500 MB → session-configurable, recommend 2000 MB for five participants. Warn at 80% of configured. closeIdleTabs exempts leased tabs. Session-create fails with RAM_INSUFFICIENT if lease acquisition would exceed threshold. No mid-session eviction of leased participants.

19. Wall-clock budget

Default 90 min. User-selectable 30 / 90 / 240 / unlimited. Side panel shows ETA.

WALL_CLOCK is a state. ACTIVE → WALL_CLOCK on exhaustion. Carries last good plan-vN. User exits by freeze (→ CONSENSUS), decline (→ ACTIVE, expected_next_speaker unchanged), force round (→ ACTIVE, budget +1), or abort (→ ABORTED). No forced-consensus attempt — that costs another full round and can fail under unanimity.

20. Storage

Bridge process owns disk. Transcript sharded per message at sessions/<id>/tx/<round>-<participant>-<seq>.json. Index at sessions/<id>/tx/index.json (last 200 keys). Sharding required — single serialized key is O(n) per write.

Retention: active unlimited. HANDED_OFF and ABORTED retained 7 days, then GC.

Option A adds chrome.storage.local for shell UI state; unlimitedStorage not needed.

21. Readiness gates

Before first session:

1. Adapter selector validation against live sites. ChatGPT, Claude, Gemini adapters have run against fixtures only. Live validation required.
2. Fastpath provider template. Without one, fastpath is inert. Authoring one template is a prerequisite for the timing model as designed.

If gate 2 is not met, v6 runs with Input.insertText — trusted, near-instant — and the humanization story is weaker. Session completes.

22. Residual risks

· Option A only: Web Store review, native-messaging per-OS install.
· Vendor ToS prohibits automated access. Fastpath mitigates detection.
· Vendor chat history. Debate content, including any repo code pasted into a participant, persists in five vendors' logs. Free tiers may train on it. No technical mitigation.
· Stubborn participant blocks every session. Unanimous consensus with only user exit means a single dissenting active participant ends every session in NEEDS_USER. No technical mitigation.
· Typing without fastpath template. Input.insertText is fast and trusted but produces no keystroke cadence. Vendors with behavioural keystroke heuristics see a paste.
· Adapter selector drift. Consumer UI changes break adapters. Failures surface as MALFORMED_RESPONSE or STREAM_TIMEOUT, never silent.
· PROTOCOL_VERSION bump breaks any existing consumer compiling against frozen shared/src/types.ts. Amendment additive; version bump breaking by contract.
· Snapshot loses freshness. A session auditing a snapshot cannot catch repo drift mid-debate. Re-capture is a new session.
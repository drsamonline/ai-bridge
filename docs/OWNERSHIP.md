# Ownership and merge discipline

Two workstreams develop in this repository at the same time. They collided once,
on the landing page, and the collision was not obvious until both had been merged:
one session restored a screenshot the workflow named, the other replaced the
workflow's assertion and added a gallery. Same bug, two fixes, overlapping files.

This file exists so the next one is caught before it is merged.

---

## The two workstreams

### A — the extension and its transports

The VS Code product and the ways it talks to a model: adapters, API transports,
routing, rotation, compression, the chat panel.

**Owns:** `extension/**`, `bridge/src/api/**`, `bridge/src/adapters/**`,
`bridge/src/router/**`, `bridge/src/cdp/**`, `bridge/src/fastpath/**`,
`bridge/src/ram/**`, `shared/src/client.ts`, `shared/src/lock.ts`,
`shared/src/rotation/**`, `shared/src/repo/**`.

### B — the debate engine

Five participants arguing a plan to consensus. Spec in `docs/debate/`.

**Owns:** `bridge/src/runtime/**`, `bridge/src/repo/**`, `bridge/src/server/**`,
`docs/debate/**`, and the seven suites `test/{statemachine,session,scheduler,
snapshot,runner,sessions,payload,server-guard}.cjs`.

**The boundary already holds:** workstream A's code does not import from
`bridge/src/runtime`, and the extension imports nothing from `bridge/src` at all.
Keep it that way — it is what makes either side extractable later.

---

## The shared files, and the rule for each

These are the only places the two workstreams can collide. Everything else is
either owned outright or generated.

| File | Why it is shared | Rule |
|---|---|---|
| `package.json` — `test:all` | one chain, one line, both add suites | **Append at the end of the chain.** Never reorder, never reflow the line. One suite per commit. |
| `shared/src/types.ts` | `PROTOCOL_VERSION`, `BridgeMsg`, the frozen `Adapter` | **Append only**, and record the change in the version comment. Bumping the version is its own commit. |
| `shared/src/control.ts` | `ControlMsg` — every `ctl.*` op | **Append the new variants as one block**, after the last op. The debate engine added seven `ctl.session.*`; put the next family after them. |
| `bridge/src/runtime/index.ts` | the `control()` switch | **Append cases before `ctl.config`**, which is the last one. Do not reorder. |
| `docs/index.html` | the one landing page | **One workstream at a time.** Check for an open branch touching it before you start; this is the file that already bit us. |
| `docs/remaining.md`, `docs/release.md`, `docs/compression-bench.md`, `docs/batch-*.md` | rewritten by the suites on every run | **Never resolve a conflict here by hand** — run `git checkout -- docs/` first. They are generated; the suite regenerates them. |
| `test/release.cjs` | asserts things about the landing page and the workflows | **Change the assertion, not the artefact**, when a design change makes it wrong. It caught a real break twice. |

---

## Merge discipline

1. **Rebase onto `main` before you push.** A branch 37 commits behind is a
   conflict waiting for whoever merges it — both stale branches here were 37 and
   76 behind.
2. **`git checkout -- docs/` before any rebase, cherry-pick or merge.** The
   suites rewrite the evidence files, and a dirty tree blocks the operation. This
   cost two attempts while consolidating.
3. **A behaviour change lands with its test in the same commit.** A suite added
   without its `test:all` entry fails `contract.cjs`, which is deliberate.
4. **Clean build before claiming green.** `npm run clean && npm run build`, then
   the suite. An incremental build keeps compiled output for source files that no
   longer exist, and three suites passed for a day against stale `dist/`.
5. **Never commit generated evidence** in a feature commit. If `docs/batch-*.md`
   shows up in your diff, you ran the suite — reset it.

---

## Two release lines

The two workstreams release separately, and the separation is by workflow and tag
namespace rather than by repository.

| | Extension (A) | Engine (B) |
|---|---|---|
| version lives in | `package.json` + `extension/package.json` (must agree) | `packages/debate/package.json` |
| tag | `v0.48.0` | `debate-v0.1.0` |
| workflow | `release.yml` | `debate-release.yml` |
| artefact | `ai-bridge-<ver>.vsix` | `ai-bridge-debate-<ver>.tar.gz` |
| runs | the whole suite | the eight engine suites only |
| `latest` | yes | **never** — the extension is what people install by name |

Three rules keep them apart:

1. **The engine is never a workspace member.** `packages/debate` holds a version
   and a packaging manifest, not source. Adding it to `workspaces` would make
   `npm ci` resolve a package whose source lives in `bridge/src`.
2. **The engine's release is never `latest`.** Stealing the badge would point the
   extension's own install instructions at a tarball.
3. **A broken engine release cannot block an extension release.** Separate
   workflows, separate triggers, separate suite lists — which is the whole reason
   this is two files rather than two jobs.

`test/release.cjs` asserts all three, plus that the engine's version is semver and
that neither workflow shares the other's trigger.

When the engine stops needing the bridge's CDP connection, adapters and observer,
`packages/debate` becomes a real workspace member: the source moves under
`packages/debate/src/`, and the release flow above does not change.

## State as of the consolidation

- `fix/landing-shots-and-guard` — **subsumed.** Its workflow assertion and gallery
  are on `main` (`1e27e16`), with the gallery cache-busted (`4eb8b48`) because
  `release.cjs` requires it. Safe to delete.
- `licence/badge` — **already merged.** Its README badge has been on `main` since
  before the debate work started. Nothing to apply.
- `debate/step1-runtime-dir` — the debate engine's history, kept in sync with
  `main`. Redundant now that everything is on `main`; useful as a review branch.
- Windows CI is red on `repo-edit` (four checks, `The "string" argument must be of
  type string`). Pre-existing, unrelated to either workstream, and it hides real
  failures — worth fixing before the next feature.

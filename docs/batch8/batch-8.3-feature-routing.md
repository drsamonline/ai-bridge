# Batch 8.3 — per-feature model routing

**Status: specified. Blocked on 8.1.**

Acceptance: **a commit message never burns the chat model's quota; a model that
is unfit for chat still serves commits, fixes and suggestions.**

## Why

We choose one model and use it for everything. On a free tier that is the most
expensive mistake available: the strong model's daily allowance goes on commit
messages and one-line fixes, and is gone before the work that needed it.

Upstream routes by feature — `commit.model`, `suggestions.model`, `fix.model`,
each defaulting to `auto` — and every model declares which features it fits
(`chat | commit | suggestions | fix`). The flags are independent: a model hidden
from chat still works for the other three. Each picker lists only the fit ones.

## What lands

- `extension/src/features/` — commit message generation, inline suggestion,
  quick fix, each with its own model setting and its own prompt
  (upstream's Conventional Commits prompt is a good default and worth taking).
- **Capability flags on `ModelInfo`** in `shared/src/types.ts` — this is a shape
  change, so it is additive: `capabilities?: { chat, commit, suggestions, fix,
  thinking }`, absent meaning all true.
- **Service requests run thinking off.** `thinkingEnabled(models, id, hasTools,
  override)` returns false for `override: 'off'`, which every service request
  passes. Reasoning costs latency and quota and buys nothing for a commit subject.
- **Bounded generation:** suggestions stop at 30 s, 12 lines or 600 characters,
  whichever comes first. On a slow free backend an unbounded request is a hung
  editor.
- **Small payloads:** prefix 2 000 / suffix 800 characters by default, so the
  request stays inside a free tier's comfort zone.

## Acceptance checks

```
routing: commit uses commit.model, not chat
routing: fix uses fix.model
routing: suggestions use suggestions.model
routing: auto picks the first signed-in model fit for that feature
flags: a chat-hidden model still appears in the commit picker
flags: a model with no flags declared is fit for everything
flags: an unfit model is never selected by auto
thinking: a service request never enables thinking
thinking: chat enables thinking only when the model declares it
thinking: tools disable thinking even when the model declares it
bounds: a suggestion stops at 12 lines
bounds: a suggestion stops at 600 characters
bounds: a suggestion stops at 30 s and offers what arrived
prompt: the commit prompt asks for Conventional Commits and nothing else
```

## Risks

- More model choices means more ways to misconfigure. `auto` must always resolve
  to something; a feature whose model is missing falls back rather than failing.
- Feature traffic competes with chat for the same rate limit. 8.4's cooldown
  accounting is what stops one feature starving another.

## Result

**Status: routing core landed and tested; one feature shipped, two specified.**
Harness: `npm run test:features` (27/27).

### What landed

| Piece | Detail |
|---|---|
| `extension/src/features/routing.ts` | `resolveModel`, `isFit`, `FEATURE_POLICIES`, `clampText`, `thinkingFor` — pure, no `vscode` |
| `extension/src/features/service.ts` | `askFeature`: resolve → dispatch → clamp, with the model resolved *before* the prompt is sent |
| `extension/src/features/commit.ts` | `stagedDiff`, `truncateDiff`, `buildCommitPrompt`, `parseCommitMessage` |
| `extension.ts` | `aiBridge.commit.message` — the ✨ button in Source Control, plus the SCM input insertion |
| `extension/package.json` | command, `scm/title` menu, six feature settings |

The routing rule is the point: under `auto` a **free** model wins, then
declaration order. So the cheap tier absorbs the chores and the strong model is
left for chat — which is the whole reason this batch exists.

Two decisions worth recording:

- **Capability flags live in the router, not in `shared`.** `ModelInfo` in
  `shared/src/types.ts` is a frozen contract; `RoutableModel` adds `kind`,
  `source` and fit flags without touching it. A model with no flags is fit for
  everything — silence is not exclusion.
- **A subscription tab is not "free".** A web chat's quota is something the user
  already pays for, so `auto` prefers an endpoint that reports a free model, and
  only falls back to a tab when that is all there is.

### The feature that ships

`aiBridge.commit.message` reads the staged diff (falling back to the working
tree), asks for a Conventional Commit, cleans up the fences and quotes models add
anyway, and writes the result into the SCM box — or the clipboard when the git
extension is not available.

The git call is a plain function of a directory, so the harness builds a real
throwaway repository, stages a change and asserts on the real diff. That is the
only way to know `stagedDiff` works: a fixture would prove the regex, not the
call.

### Specified, not built — 8.3b

- **Inline suggestions.** Settings are declared (`features.suggestions.model`),
  and the policy exists (600 chars, 160 tokens, thinking off). The
  `InlineCompletionItemProvider` itself is not written.
- **Quick fixes.** Same: `features.fix.model` declared, policy in place, no
  `CodeActionProvider`.

Both are consumers of `askFeature`, which is tested and waiting for them.

### Not proven

- **The SCM button in a real editor.** The harness proves routing, the diff and
  the parsing; it does not prove the git extension's `inputBox` accepts the
  value, because that needs a running VS Code with a git repository open.
- **Whether the message is any good.** No model has answered a commit prompt in
  this environment.

### Verification

`test:features` 27/27, and the wider line unchanged: extension-smoke 40/40,
release 26/26, bundle 5/5, settings-panel 17/17, panel-virtual 29/29,
lm-provider 19/19, api-tools 34/34.

---

## 8.3b — inline suggestions and quick fixes

**Status: landed, tested at the pure boundary.** Harness: `npm run test:editor`
(19/19).

### What landed

| Piece | Detail |
|---|---|
| `extension/src/features/suggest.ts` | `buildSuggestionPrompt`, `cleanSuggestion`, `isUsable` — bounded to 12 lines / 600 chars |
| `extension/src/features/fix.ts` | `buildFixPrompt`, `extractReplacement`, `isUsableFix`, `describeFix` |
| `extension/src/features/editor.ts` | `SuggestProvider`, `FixProvider`, `runFix` — the `vscode` glue |
| `aiBridge.suggest` (`Ctrl+Alt+\`) | arms the provider, then triggers the editor |
| `aiBridge.fix` | the Quick Fix action on errors and warnings |

Three decisions worth recording:

- **Suggestions are armed, not always on.** The provider returns nothing unless a
  command armed it, and disarms after one answer. On a free backend that takes
  seconds, an automatic provider interrupts more often than it helps — so it
  never fires while typing.
- **A fix is previewed before it lands.** The replacement is shown in a modal with
  its line count, then applied as one `WorkspaceEdit` over one line range: one
  undo step, no partial state. A side-by-side diff is 8.3c; a modal with the exact
  text is the cheap version of the same guarantee.
- **An apology is never inserted.** `isUsableFix` refuses "Sorry, I cannot fix
  this", which is otherwise a perfectly valid string to write into someone's
  source file.

The fix prompt marks the diagnostic line with `>> ` and includes six lines of
context either side; the marker is stripped again on the way back, along with the
context indent, in case the model echoes the framing it was shown.

### A fixture bug this batch exposed

`extension-smoke` failed on activation with
`Cannot read properties of undefined (reading 'registerInlineCompletionItemProvider')`.
The stub modelled a VS Code 1.94 but had no `languages` namespace at all. Every
supported version has inline completions and code actions, so the **stub was
incomplete, not the code** — it now models `languages`, `CodeActionKind`,
`CodeAction`, `InlineCompletionItem` and `DiagnosticSeverity`, and records the
providers it is given.

### Not proven

- **No suggestion or fix has been produced by a model here.** The harness proves
  the prompts, the bounds and the cleanup; it does not prove a free model returns
  usable code at a given cursor.
- **The modal preview** has not been seen in a real editor.
- **Latency.** The 30-second ceiling lives in the transport, not here; how often a
  free tier answers inside it is unknown.

---

## 8.3c — a side-by-side diff before a fix lands

**Status: landed, registered and smoke-tested; the diff itself is unproven.**

### What landed

The fix flow now offers **Show diff** beside **Apply**. Choosing it opens
`vscode.diff` with the real file on the left and the file as it would be on the
right, then asks again before anything is written.

- `FixPreviewProvider` serves the proposed content read-only over the
  `ai-bridge-fix:` scheme. Nothing touches the disk: the document exists for as
  long as the editor keeps it open, and the apply path is still one
  `WorkspaceEdit` over one line range.
- The provider is registered at activation and disposed with the extension.
- Without a preview provider the modal is the whole interaction — the behaviour
  every earlier build had — so the change is additive.

### What the smoke test proves, and what it does not

`extension-smoke` now asserts the `ai-bridge-fix` provider is registered on the
workspace (41/41). That is the wiring.

It does **not** prove the diff renders, that the proposed document looks right in
the side-by-side, or that the second confirmation appears — all of which need a
real editor with a file open. The same caveat as every other editor surface in
this line.

### A fixture gap this exposed, again

The stub had no `workspace.registerTextDocumentContentProvider`, so activation
threw. Like the missing `languages` namespace in 8.3b, that was the stub being
incomplete rather than the code being wrong — every supported VS Code has it. The
stub now models it and records the schemes registered.

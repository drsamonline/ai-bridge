# Batch 8.2 — appear in Copilot Chat

**Status: specified. Blocked on 8.1. Needs a decision (below).**

Acceptance: **an ai-bridge provider is selectable in Copilot Chat, streams an
answer, and a tool call round-trips through Copilot's own tools.**

## Why

Today ai-bridge is invisible to Copilot. Our `extension/package.json` contributes
commands, configuration, views and keybindings — no `chatParticipants`, no
`languageModelChatProviders`. Everything we build is reachable only through our
own panel, so a user who lives in agent mode gets nothing from us.

Upstream registers one `languageModelChatProviders` entry and their models appear
next to paid ones. That is the cheapest large change in the whole roadmap: it
turns our providers into something the editor already knows how to drive.

## What lands

`extension/src/lm/` — adapted from `VSCodeLMAdapter.ts` (364),
`UnifiedProvider.ts` (262), `BaseAIProvider.ts`:

- `provider.ts` — the `LanguageModelChatProvider`: model list, token counting,
  `provideLanguageModelChatResponse` wired to our `BridgeClient`.
- `adapter.ts` — `AIMessage` ↔ `vscode.LanguageModelChatMessage`, including tool
  calls and results in native mode and prompt protocol otherwise.
- `stream.ts` — the buffering sink (`STREAM_BUFFER_CHARS = 360`,
  `UI_EMIT_CHUNK_LIMIT = 80 chars / 12 ms`) so our chunkier stream renders smoothly.
- `package.json` — `contributes.languageModelChatProviders` with vendor
  `ai-bridge`.

## The decision this batch needs

`languageModelChatProviders` is a recent API; upstream requires **VS Code
^1.105**, and we currently declare `^1.90`. Three ways forward:

1. **Raise `engines.vscode` to ^1.105.** One line, simplest, but it drops every
   user on 1.90–1.104 — and our badge promises 1.90+.
2. **Runtime-gate.** Keep `engines` at ^1.90, register the provider only when the
   API exists. Copilot support becomes an upgrade bonus, not a requirement.
3. **Second extension.** A tiny `ai-bridge-copilot` package that depends on the
   first. Cleanest for old versions, worst for install friction.

Recommendation: **2**, because it costs one feature-detect and keeps our
compatibility promise honest. It is your call — say which and I will build it.

## Acceptance checks

```
vendor: the provider appears under contributes.languageModelChatProviders
models: only signed-in providers' models are listed
models: a DOM adapter and an API endpoint appear in the same picker
count: tokens are counted including tool traffic
stream: text arrives in order through the buffer
stream: reasoning is emitted as a thinking part when the API exists
tools: a native tool call round-trips
tools: a prompt-protocol call round-trips and is scrubbed
cancel: a cancelled request stops the upstream
gate: with the API absent the extension loads and registers nothing
```

## Risks

- The LM API is young; a minor release can change part shapes. Every optional
  constructor is feature-detected rather than imported directly.
- Copilot can be active at the same time as our panel; two streams to the same
  tab would fight. The bridge serialises per tab already — this batch must not
  bypass that.

## Result

**Status: landed, tested at the provider boundary.** Harness: `npm run test:lm`
(19/19).

### The decision, taken

**Option 2 — runtime-gate.** `engines.vscode` stays at `^1.90`. The provider is
registered only where `vscode.lm.registerLanguageModelChatProvider` exists, so
1.90–1.103 loads the extension exactly as before and Copilot support appears as
an upgrade bonus rather than a new requirement. The README's compatibility
promise is unchanged.

Two consequences worth stating:

- The types are declared locally in `extension/src/lm/types.ts` rather than taken
  from a newer `@types/vscode`. Nothing compiles against a type that may be
  absent at runtime, and the gate is the only place that decides.
- `LanguageModelThinkingPart` is feature-detected separately from the provider
  API: when it is missing the provider is built without a reasoning channel
  instead of reporting a part the editor cannot render.

### What landed

| Piece | Detail |
|---|---|
| `contributes.languageModelChatProviders` | vendor `ai-bridge`, display name `AI Bridge` — six lines in the manifest |
| `extension/src/lm/types.ts` | structural LM types, no `@types/vscode` bump |
| `extension/src/lm/provider.ts` | host-free: model list, message conversion, native/prompt tool choice, part ordering, token estimate |
| `extension/src/lm/register.ts` | the `vscode` glue and the runtime gate |
| `bridge/src/runtime.ts` | `requestId` now rides on every stream delta, so Copilot beside our panel can pick out its own stream |
| `test/lm-provider.cjs` | 19 checks |

Model listing is honest about what it knows: each API model is its own entry
(`custom:<provider>/<model>`), and each web chat is **one** entry labelled
`ChatGPT (tab)` — because which model answers is whatever that tab has selected,
and inventing a name for it would be a lie the picker tells.

Tool calling is offered per model: `capabilities.toolCalling` is false for a DOM
model, because `ctl.prompt` takes text only. Copilot will not offer tools where
there is no channel for them.

### Not proven — and you should know it

**The provider has never run inside a real VS Code with Copilot Chat.** The
harness drives the provider directly with fake parts and a fake bridge; it proves
the logic, the part ordering and the tool decision, not that Copilot renders
them. This is the same honesty `docs/remaining.md` applies to the live selectors:
the boundary is tested, the integration is not.

Also open:

- **Images.** `imageInput` is not offered; a screenshot in Copilot Chat will not
  reach the model.
- **DOM streaming.** A web-chat answer is settled by `ctl.prompt` before it is
  returned, so it arrives in one part rather than token by token. The API path
  streams properly.
- **Tool results back to the model.** Still 8.1b — the loop is one-way today.

### Files touched

```
extension/package.json                   +languageModelChatProviders
extension/src/extension.ts               registration behind the gate
extension/src/lm/{types,provider,register,index}.ts   new
bridge/src/runtime.ts                    requestId on stream deltas
test/lm-provider.cjs                     new (19 checks)
package.json                             +test:lm, added to test:all
```

`engines.vscode` is unchanged at `^1.90`. The bridge, the adapters and the DOM
path are untouched.

---

## 9.1 — images

The provider advertised no image capability and silently dropped an image part.
Now:

- `LmPart` gained an `image` kind; `toPart` detects a data part by its `image/*`
  mime type **before** the text check, because a data part has no `value` and
  would otherwise fall through and vanish;
- `toWireMessages` sends an image as an inline `data:` URL — what an
  OpenAI-compatible endpoint accepts, with no upload step;
- the capability is per model and **off unless the endpoint declares it**
  (`imageInput` on the endpoint config), because a model that ignores an image
  looks exactly like a model that cannot see;
- a model that does not declare it — and the DOM path, always — refuses with
  `ENOIMAGE` naming the model, rather than answering as if it had looked.

Checks: `test:lm` 29/29 (4 new), `test:api` 34/34 (2 new: the flag defaults off,
and is honoured when declared).

Not proven: no real endpoint has received one of these requests. The wire shape
is the documented OpenAI one; whether a given free tier honours it is theirs to
say.

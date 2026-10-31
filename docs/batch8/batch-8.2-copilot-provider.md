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

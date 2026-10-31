# Batch 8.1 — the tool-call layer

**Status: specified. Blocked on 8.0 (done).**

Acceptance: **a free API endpoint calls a real tool and the panel shows the same
call a paid provider would; a web-chat provider calls the same tool through the
prompt protocol with no protocol text reaching the user.**

## Why

We have no tool layer at all — `grep -ril "toolCall|tool_call"` across `bridge`,
`shared` and `extension` returns nothing. The chat panel sends a prompt and
receives text; edits arrive through our own proposal cards, which the model never
sees as a tool. That is why a free tier does less useful work for us than for any
other client.

Upstream solved the hard half, and the hard half is not the happy path — it is
what web models actually emit.

## What lands

`bridge/src/protocol/`, ported from `ToolCalling.ts` (1 229 lines),
`StreamingToolCallRouter.ts` (446) and `responseAssembler.ts` (390):

| File | Role |
|---|---|
| `toolCalling.ts` | Marker detection across every dialect: fenced ` ```tool_call `, bare `<tool_call>`, `<function=>`, `<tool_name>`, Anthropic `<invoke>`, `<function_calls>`, JSON envelopes, namespaced `<ns:invoke>`; partial-marker handling for chunk-split markers; balanced-object extraction |
| `streamingRouter.ts` | Hold-and-release: `MAX_HOLD_CHARS = 4096`, hard cap `262144`, `MARKER_HOLDBACK_CHARS = 11`; releases held text when it stops looking like a call; transcript-echo cut with fence awareness |
| `assembler.ts` | The sink. Emits text / thinking / complete tool calls, retypes arguments against the tool schema, recovers calls that leaked into the reasoning channel |

## Contract decisions

- **One sink, two hosts.** The assembler writes to a `ResponseSink`; the bridge's
  implementation turns it into control events, the extension's into panel
  messages. That is upstream's design and it is the reason their provider code
  runs in four different hosts.
- **New control events, additive only:** `stream.thinking`, `tool.call`,
  `tool.result`. `ControlEventKind` is widened in `control.ts`; nothing existing
  is renamed.
- **`promptToolProtocol = toolsExpected && !nativeTools`** decides per provider.
  Native for 8.0's endpoints; prompt protocol for the three adapters. The flag is
  what makes agent mode possible on a web chat at all.

## Acceptance checks

```
markers: a fenced tool_call block is extracted
markers: a bare <tool_call> is extracted
markers: <function=> XML is extracted
markers: Anthropic <invoke> is extracted
markers: a namespaced <ns:invoke> is extracted
markers: a JSON envelope {"tool_call":{...}} is extracted with its wrapper
markers: a marker split across two chunks is still found
markers: a ``` fence that is not a call is not held
markers: a false marker in prose is released after MAX_HOLD_CHARS
hold: a 200 KB argument is held to the hard cap, not dropped
hold: the marker holdback is exactly len("```tool_call")-1
assemble: text order survives interleaved thinking
assemble: a call leaked into reasoning is recovered
assemble: arguments are retyped against the schema
assemble: a transcript echo is cut without touching a fenced block
assemble: the user never sees protocol text
prompt protocol: tools reach a web chat as text and are scrubbed on the way back
native: tools reach an API endpoint as JSON and come back as chunks
```

## Risks

- The marker list is tuned to four providers' habits. ChatGPT, Claude and Gemini
  in DOM mode emit differently; the list is additive, so expect additions rather
  than edits.
- The hold is the one place where a bug is visible to the user as a stalled
  stream. The release path is therefore the most-tested part of the port.

## Result

**Status: landed, tested.** Harness: `npm run test:tools`.

```
34/34 passed
```

30 of those exercise the protocol directly (marker dialects, the hold/release
machine, transcript echoes, both assembly paths); the last 4 drive the whole
thing through `BridgeRuntime.control()` against two loopback endpoints — one
native, one that only understands the prompt protocol — and assert the event
stream a panel would render.

The rest of the line is unaffected: `test:api` 32/32, handshake 12/12, router
35/35, custom-provider 12/12, settings-model 62/62.

### Three bugs the harness found, all real

1. **The orphaned fence.** The JSON scanner read the body of ```` ```tool_call ````
   before its closing fence had arrived, emitted the call, and then flushed the
   leftover ```` ``` ```` as text — three backticks appearing in the answer for
   no reason. Fixed with `unterminatedWrapper`: an open wrapper is not a finished
   call, whatever a prefix of it parses to.
2. **The whitespace seam.** `stripToolCallBlocks` blanked a call with spaces
   instead of removing it, leaving a visible gap mid-sentence. It splices now.
3. **The untrimmed echo cut.** A transcript cut sits on the newline before the
   marker, so the emitted prefix ended in whitespace that was never part of the
   answer.

### Files touched

```
bridge/src/protocol/toolCalling.ts       new  (~460 lines)
bridge/src/protocol/streamingRouter.ts   new  (~200 lines)
bridge/src/protocol/assembler.ts         new  (~250 lines)
bridge/src/protocol/index.ts             new
shared/src/control.ts                    +1 op, +4 event kinds
bridge/src/runtime.ts                    +1 case, +1 injectable seam
test/api-tools.cjs                       new
package.json                             +test:tools, added to test:all
```

`runtime.prompt()`, the adapters and `Settings` are untouched again. The one
production seam added is `RuntimeOptions.apiFetchImpl`, so a host can wrap the
transport's `fetch` — and so the harness can drive it where undici's WASM
allocation fails.

### Not done here

- The extension side of the panel (rendering `stream.thinking` / `tool.call`) —
  **8.1b**, with 8.2.
- Feeding a tool *result* back to the model — `tool.result` is declared as an
  event kind but nothing emits it yet; that is the loop-closing half of agent
  mode and belongs with the panel work.

---

## 8.1b — the loop closes

**Status: landed, tested.** Checks in `npm run test:lm` (25/25).

`tool.result` was a declared event kind with nothing emitting it, and the reason
was a real bug rather than a missing wire: the message mapping dropped the
assistant's own `toolCall`. So a tool result travelled back answering a call id
the provider had never issued — the first turn worked, the second was rejected
with no useful error.

- `toWireMessages` moved into the host-free `provider.ts`, so the mapping is
  testable and the assistant turn now carries its calls;
- `ctl.api.prompt` messages accept `toolCalls`, and the bridge passes them
  through to the endpoint;
- an empty turn is dropped rather than sent, and arguments already serialised are
  not double-encoded.

Images are the remaining half of this gap: a part carrying an image is **refused**
with `ENOIMAGE` rather than silently dropped, because a user who sends a
screenshot and gets an answer about text will believe the model saw it.

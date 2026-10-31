# Batch 8.0 — OpenAI-compatible API transport

**Status: implemented, tested.** Harness: `npm run test:api`.

Acceptance: **a free endpoint streams text, reasoning, tool calls and usage over
the loopback socket; a 429 cools for exactly as long as the provider asked; a
request that stalls errors instead of hanging.**

## Why this batch is first

Three web chats are the capacity ceiling, and every one of them can rate-limit
you into idleness. The free API tiers — OpenRouter's free pool, Groq, Google AI
Studio, Cerebras, GitHub Models, a local Ollama — are more capacity, they speak
the real tools API, and **they have no selectors, so they cannot break the way
our adapters can.** This batch is also the foundation for 8.1, 8.2 and 8.3, so it
goes first even though 8.1 is the more exciting one.

## What lands

| File | Lines (approx) | Role |
|---|---|---|
| `bridge/src/api/types.ts` | 120 | Config, model, request, chunk shapes. No `vscode`, no `shared` dependency. |
| `bridge/src/api/errors.ts` | 110 | Typed errors; status mapping; `retry-after`; network-failure test |
| `bridge/src/api/stream.ts` | 130 | Chunk reader with per-read idle timeout; SSE splitter |
| `bridge/src/api/openaiCompat.ts` | 260 | `listModels`, `streamChatCompletion`, `collectStream` |
| `bridge/src/api/registry.ts` | 220 | Validation, `custom:` namespacing, base-URL-keyed model cache, key handling |
| `bridge/src/api/index.ts` | 6 | Barrel |
| `test/api-openai.cjs` | 300 | The acceptance harness |

## Contract decisions

- **`BridgeMsg` is untouched.** `shared/src/types.ts` declares its shapes frozen.
  The three new operations are `ctl.api.providers.set`, `ctl.api.models` and
  `ctl.api.status`, declared in `shared/src/control.ts` — the second union, which
  exists for exactly this.
- **`Settings` is untouched.** Endpoint config has its own shape (`ApiProviderConfig`)
  and travels in the `ctl.api.*` payload. Widening `Settings` would have touched
  every consumer for no gain.
- **Keys never reach the disk.** They arrive in `ctl.api.providers.set`, live in a
  `Map` for the life of the bridge process, and fall back to
  `AI_BRIDGE_API_KEY_<ID>` from the environment. Persisting them is the
  extension's job in 8.0b via SecretStorage — over the socket that is already
  token-authenticated.
- **The DOM path is not in this diff.** `runtime.prompt()` is unchanged. The
  registry is a sibling, reachable through `ctl.*` only.

## Behaviour worth knowing

- `resolveBaseUrl` keeps a base that already ends in `/vN` and appends `/v1` to a
  bare origin — `http://localhost:1234` and `http://localhost:1234/v1` are the
  same endpoint.
- Model ids are namespaced `custom:<providerId>/<upstreamId>`, so `gpt-4o-mini`
  on two endpoints stays two models. Upstream ids containing `/` survive the
  round trip.
- The model cache is keyed on the base URL: re-pointing an endpoint drops the old
  catalogue instead of serving it from a stale entry.
- `retry-after` accepts seconds **or** an HTTP date. Upstream handles seconds
  only; the date form is what a CDN actually sends.
- A dropped connection is retried twice (800 ms, 2 500 ms) before it becomes an
  error — a single TLS reset must not surface as a chat failure.
- An endpoint with no key and `noApiKey` unset is reported **signed out** and
  throws `EAUTH` before any request is made.
- Thinking is surfaced separately: `reasoning_content` and `reasoning` both map
  to `thinking` chunks, never into the answer text.

## Acceptance checks

```
validate: a minimal config is accepted
validate: a missing baseUrl is rejected with a reason
validate: a non-http url is rejected
validate: an id with spaces is rejected
validate: a duplicate id is rejected
validate: a bare origin gains /v1, an /vN base is left alone
namespacing: provider and model round-trip
namespacing: an upstream id containing / round-trips
namespacing: a foreign id does not resolve
models: the catalogue is namespaced and marked free/paid
models: an explicit model list wins over the fetched one
cache: re-pointing an endpoint drops the old catalogue
stream: text deltas arrive in order
stream: reasoning is separated from the answer
stream: a tool call split across chunks assembles into one call
stream: tool-call arguments parse as JSON
stream: usage is reported by the provider
stream: an SSE stream split into 3-byte writes still parses
errors: 401 becomes EAUTH
errors: 429 becomes ERATELIMIT with the retry-after delay
errors: retry-after as an HTTP date is honoured
errors: a stalled stream fails on the idle timeout
errors: no key on a keyed endpoint is EAUTH before the request
```

## Out of scope (named so it is not forgotten)

- Settings UI fields and SecretStorage persistence — **8.0b**.
- Routing an API endpoint into `runtime.prompt()`'s chain — **8.1**, where the
  answer has to be assembled into tool calls and text anyway.
- Streaming an API endpoint into the chat panel — **8.1**.

## Risks

- A free tier can change its `models` payload; the parser accepts `{data:[{id}]}`
  and `{models:[{id}]}` and ignores anything else rather than throwing.
- Endpoints that ignore `stream_options.include_usage` simply report no usage;
  `collectStream` says so with `undefined`, never zero.
- Rate-limit accounting for API endpoints is not wired into the router yet, so a
  429 currently fails the request. **8.4** connects `retryAfterMs` to
  `router.markLimited`.

## Result

```
fetch: node:http shim        (this machine's undici cannot allocate WASM)
32/32 passed
```

The rest of the line is unaffected — handshake 12/12, router 35/35,
custom-provider 12/12, settings-model 62/62 — and `npm run build` is clean
(`tsc -b shared bridge extension`).

### Note on the harness

`canUseGlobalFetch()` probes in a child process, because undici's failure here is
an uncaught throw from a microtask rather than a rejection: the parent cannot try
it and catch it. A child that exits 0 has a usable `fetch`; anything else selects
a `node:http` shim that implements the small surface the transport reads. The
socket, the SSE framing, the 3-byte chunk boundaries and the idle timeout are
therefore all exercised for real either way. Force it with
`AI_BRIDGE_TEST_FETCH=global|shim`.

### Files touched

```
bridge/src/api/types.ts          new
bridge/src/api/errors.ts         new
bridge/src/api/stream.ts         new
bridge/src/api/modelId.ts        new
bridge/src/api/openaiCompat.ts   new
bridge/src/api/registry.ts       new
bridge/src/api/index.ts          new
shared/src/control.ts            +3 ops in the ctl.* union
bridge/src/runtime.ts            +1 field, +3 control cases
test/api-openai.cjs              new
package.json                     +test:api, added to test:all
```

No existing line was edited: `runtime.prompt()`, the adapters, the router and
`Settings` are exactly as they were.

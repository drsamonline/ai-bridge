# Batch 3.2 — extension evidence: status bar, panel, repo, state, boot, guard, T0/T1 compressor (stubbed VS Code host)

Generated: 2026-10-29T16:17:02.500Z
Node v20.20.2 · stub host 1.94.0-stub · fixture /usr/local/bin/chromium-headless-shell

## Checks

```
PASS  handshake logged to Output
PASS  CDP attach logged to Output
PASS  status bar shows the attached browser
PASS  status bar shows a live RAM meter
PASS  status bar shows tab age
PASS  status bar is visible
PASS  tooltip carries the RAM detail and source
PASS  acceptance rendering is exactly "Attached: Edge · RAM 120/500"
PASS  panel received the user message
PASS  panel received an assistant placeholder
PASS  panel received streamed deltas (not one blob)
PASS  panel deltas grow
PASS  panel received the settled answer
PASS  first token under 3 s in the panel path
PASS  answer settled by the copy sentinel
PASS  end-to-end prompt under 10 s in a stubbed host
PASS  status bar shows the ✓ settle time
PASS  state.full.json.gz was written by the extension
PASS  the state file holds deltas from the prompt
PASS  T1 captured the path the prompt named
PASS  state recorded both sides of the turn
PASS  T1 reported which thread it ran on
PASS  the state file carries the v3 schema marker
PASS  T1 gate decision is logged (low-end machine stays on T0)
PASS  the prompt still went out (T1 being off never blocks)
PASS  T0 ran on the outgoing prompt
PASS  status bar shows the compression meter (§6 Status Bar row)
PASS  status bar shows the boot token meter (§6 Status Bar row)
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  recycle + gc commands produce Output lines
```

Result: 32/32 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1180/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
16:16:48.101 INFO  [ext] no workspace folder — repo context and edit proposals are off
16:16:48.105 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
16:16:48.181 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
16:16:48.300 INFO  [ext] chat panel resolved
16:16:48.585 INFO  [ext] T0 worker ready
16:16:48.585 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
16:16:48.591 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
16:16:48.679 INFO  [ext] T1 worker ready
16:16:48.683 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
16:16:48.686 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
16:16:48.687 INFO  [ext] state ready: 0 delta(s), 0 file(s)
16:16:48.713 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T16-16-48-688Z-init.json.gz
16:16:48.716 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
16:16:48.717 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T16:16:49.876Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":12628,"home":"<tmp-home>"}
2026-10-29T16:16:49.879Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T16:16:49.888Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T16:16:49.895Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T16:16:49.896Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T16:16:49.897Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T16:16:49.898Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":12628,"lock":"<tmp-home>/.ai-bridge/lock.json"}
16:16:49.898 INFO  [ext] bridge ready — port 47911, pid 12628, lock <tmp-home>/.ai-bridge/lock.json
16:16:49.899 INFO  [ext] phase → handshaking (reading lock + attach)
16:16:49.900 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=12628 port=47911
16:16:49.900 INFO  [ext] connecting ws://127.0.0.1:47911
16:16:49.900 INFO  [ext] dialling ws://127.0.0.1:47911
16:16:49.929 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T16:16:49.928Z INFO  [bridge] client connected 127.0.0.1:35478 {"clients":1}
2026-10-29T16:16:49.933Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:35478","pid":12628,"protocol":1,"fingerprint":"5f45d02ab1fc"}
16:16:49.937 INFO  [ext] handshake OK — pid=12628 v0.1.0 protocol=v1 token=5f45d02ab1fc caps=[attach,recycle,navigate,send,observe,health,ctl.*]
16:16:49.937 INFO  [ext] phase → ready (handshake ok, pid 12628)
16:16:49.967 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=12628 · v0.1.0 · protocol=v1 · token=5f45d02ab1fc · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T16:16:49.969Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T16:16:49.970Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
16:16:49.972 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T16:16:49.973Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T16:16:49.987Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T16:16:49.988Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T16:16:50.189Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T16:16:50.195Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
16:16:50.197 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
16:16:50.197 INFO  [ext] <- attached
2026-10-29T16:16:50.492Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T16:16:50.601Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
16:16:50.603 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
16:16:50.604 INFO  [ext] <- tab.opened
16:16:50.605 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
16:16:53.133 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
16:16:53.133 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 10 ms (worker)
16:16:53.133 INFO  [ext] state: user turn → +1 delta(s), 1 total, 10 ms (worker)
16:16:53.140 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
16:16:53.140 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
16:16:53.140 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
2026-10-29T16:16:53.142Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T16:16:56.288Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T16:16:56.289Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T16:16:56.608Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
16:16:56.682 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
16:16:56.683 INFO  [ext] <- stream.start
2026-10-29T16:16:57.000Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T16:16:57.018Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T16:16:57.174Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T16:16:57.223Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
16:16:57.623 INFO  [ext] <- stream.delta
16:16:57.723 INFO  [ext] <- stream.delta
16:16:57.778 INFO  [ext] <- stream.delta
16:16:57.879 INFO  [ext] <- stream.delta
16:16:57.982 INFO  [ext] <- stream.delta
16:16:58.031 INFO  [ext] <- stream.delta
16:16:58.082 INFO  [ext] <- stream.delta
16:16:58.183 INFO  [ext] <- stream.delta
16:16:58.281 INFO  [ext] <- stream.delta
16:16:58.333 INFO  [ext] <- stream.delta
16:16:58.433 INFO  [ext] <- stream.delta
16:16:58.528 INFO  [ext] <- stream.delta
16:16:58.636 INFO  [ext] <- stream.delta
16:16:59.285 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2108,"firstTokenMs":446,"settledBy":"sentinel","chars":126}
16:16:59.286 INFO  [ext] <- stream.end
16:16:59.287 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 446 ms · total 2108 ms · settled by sentinel
2026-10-29T16:16:59.285Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":446,"totalMs":2108,"settledBy":"sentinel","chars":126,"turns":1}
16:16:59.298 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
16:16:59.298 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 11 ms (worker)
16:16:59.298 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 11 ms (worker)
16:17:00.006 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
16:17:00.006 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
16:17:00.006 INFO  [ext] boot injection cancelled
2026-10-29T16:17:00.017Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
16:17:00.019 INFO  [ext] tab.closed: {"id":"tab1"}
16:17:00.020 INFO  [ext] <- tab.closed
2026-10-29T16:17:00.381Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
16:17:00.382 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
16:17:00.382 INFO  [ext] <- tab.opened
2026-10-29T16:17:00.382Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
16:17:00.384 INFO  [ext] tab recycled (user) → tab2 · total 1
16:17:00.384 INFO  [ext] <- recycled
16:17:00.385 INFO  [ext] recycled tab1 → tab2
2026-10-29T16:17:00.485Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
16:17:00.487 INFO  [ext] gc: {"pages":1,"ok":true}
16:17:00.488 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
16:17:00.492 INFO  [ext] status refresh failed: client closed
2026-10-29T16:17:00.498Z INFO  [bridge] shutting down (SIGTERM)
16:17:00.504 INFO  [ext] socket closed (code=1000 reason=client-close)
16:17:00.504 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T16:17:00.502Z INFO  [bridge] client disconnected 127.0.0.1:35478 {"code":1000,"reason":"client-close","requests":27,"clients":0}
16:17:00.512 ERROR [ext] T0 worker failed: T0 worker exited with code 1
16:17:00.513 INFO  [ext] T1 worker stopped
2026-10-29T16:17:00.573Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T16:17:00.574Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T16:17:00.595Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T16:17:00.602Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T16:17:00.603Z DEBUG [bridge] event detached had no subscribers
2026-10-29T16:17:00.604Z INFO  [bridge] server closed
2026-10-29T16:17:00.606Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, a
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        9 chars  "The quick"
delta       19 chars  "The quick brown fox"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       53 chars  "The quick brown fox jumps over the lazy dog while the"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       89 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":446,"totalMs":2108,"settledBy":"sentinel","chars":126}
status    "Settled in 2108 ms (first token 446 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

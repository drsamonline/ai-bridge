# Batch 3.1 — extension evidence: status bar, panel, repo, state, boot, guard, compressor (stubbed VS Code host)

Generated: 2026-10-29T15:53:31.361Z
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
PASS  T0 ran on the outgoing prompt
PASS  status bar shows the compression meter (§6 Status Bar row)
PASS  status bar shows the boot token meter (§6 Status Bar row)
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  recycle + gc commands produce Output lines
```

Result: 30/30 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1178/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
15:53:15.992 INFO  [ext] no workspace folder — repo context and edit proposals are off
15:53:15.996 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
15:53:16.073 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
15:53:16.103 INFO  [ext] chat panel resolved
15:53:16.390 INFO  [ext] T0 worker ready
15:53:16.391 INFO  [ext] T0 compressor ready (worker thread), tier=T0, budget=4096 tokens
15:53:16.477 INFO  [ext] T1 worker ready
15:53:16.482 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
15:53:16.484 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
15:53:16.484 INFO  [ext] state ready: 0 delta(s), 0 file(s)
15:53:16.574 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T15-53-16-486Z-init.json.gz
15:53:16.577 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
15:53:16.578 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T15:53:17.678Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":11467,"home":"<tmp-home>"}
2026-10-29T15:53:17.682Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T15:53:17.692Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T15:53:17.699Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T15:53:17.700Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T15:53:17.701Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T15:53:17.702Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":11467,"lock":"<tmp-home>/.ai-bridge/lock.json"}
15:53:17.703 INFO  [ext] bridge ready — port 47911, pid 11467, lock <tmp-home>/.ai-bridge/lock.json
15:53:17.703 INFO  [ext] phase → handshaking (reading lock + attach)
15:53:17.706 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=11467 port=47911
15:53:17.706 INFO  [ext] connecting ws://127.0.0.1:47911
15:53:17.706 INFO  [ext] dialling ws://127.0.0.1:47911
15:53:17.736 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T15:53:17.738Z INFO  [bridge] client connected 127.0.0.1:38759 {"clients":1}
2026-10-29T15:53:17.742Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:38759","pid":11467,"protocol":1,"fingerprint":"08b85e227bcf"}
15:53:17.769 INFO  [ext] handshake OK — pid=11467 v0.1.0 protocol=v1 token=08b85e227bcf caps=[attach,recycle,navigate,send,observe,health,ctl.*]
15:53:17.769 INFO  [ext] phase → ready (handshake ok, pid 11467)
15:53:17.770 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=11467 · v0.1.0 · protocol=v1 · token=08b85e227bcf · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T15:53:17.771Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T15:53:17.772Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
15:53:17.775 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T15:53:17.776Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T15:53:17.790Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T15:53:17.790Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T15:53:17.911Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T15:53:17.971Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
15:53:17.973 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
15:53:17.973 INFO  [ext] <- attached
2026-10-29T15:53:18.331Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T15:53:18.370Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
15:53:18.372 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
15:53:18.373 INFO  [ext] <- tab.opened
15:53:18.374 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
15:53:20.931 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:53:20.932 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 10 ms (worker)
15:53:20.932 INFO  [ext] state: user turn → +1 delta(s), 1 total, 10 ms (worker)
15:53:20.939 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
15:53:20.939 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
2026-10-29T15:53:20.941Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T15:53:23.971Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T15:53:23.972Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T15:53:24.725Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
15:53:24.838 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
15:53:24.838 INFO  [ext] <- stream.start
2026-10-29T15:53:25.267Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T15:53:25.308Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T15:53:25.513Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T15:53:25.592Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
15:53:25.859 INFO  [ext] <- stream.delta
15:53:25.955 INFO  [ext] <- stream.delta
15:53:26.055 INFO  [ext] <- stream.delta
15:53:26.107 INFO  [ext] <- stream.delta
15:53:26.210 INFO  [ext] <- stream.delta
15:53:26.310 INFO  [ext] <- stream.delta
15:53:26.382 INFO  [ext] <- stream.delta
15:53:26.514 INFO  [ext] <- stream.delta
15:53:26.617 INFO  [ext] <- stream.delta
15:53:26.669 INFO  [ext] <- stream.delta
15:53:26.772 INFO  [ext] <- stream.delta
15:53:26.868 INFO  [ext] <- stream.delta
15:53:26.986 INFO  [ext] <- stream.delta
15:53:27.619 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2103,"firstTokenMs":342,"settledBy":"sentinel","chars":126}
15:53:27.620 INFO  [ext] <- stream.end
2026-10-29T15:53:27.619Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":342,"totalMs":2103,"settledBy":"sentinel","chars":126,"turns":1}
15:53:27.622 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 342 ms · total 2103 ms · settled by sentinel
15:53:27.659 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:53:27.659 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 37 ms (worker)
15:53:27.659 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 37 ms (worker)
15:53:28.268 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
15:53:28.269 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
15:53:28.269 INFO  [ext] boot injection cancelled
2026-10-29T15:53:28.314Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
15:53:28.323 INFO  [ext] tab.closed: {"id":"tab1"}
15:53:28.326 INFO  [ext] <- tab.closed
2026-10-29T15:53:29.080Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
15:53:29.084 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
15:53:29.085 INFO  [ext] <- tab.opened
2026-10-29T15:53:29.083Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
15:53:29.089 INFO  [ext] tab recycled (user) → tab2 · total 1
15:53:29.090 INFO  [ext] <- recycled
15:53:29.090 INFO  [ext] recycled tab1 → tab2
2026-10-29T15:53:29.296Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
15:53:29.298 INFO  [ext] gc: {"pages":1,"ok":true}
15:53:29.301 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
15:53:29.336 INFO  [ext] status refresh failed: client closed
2026-10-29T15:53:29.338Z INFO  [bridge] shutting down (SIGTERM)
15:53:29.380 INFO  [ext] socket closed (code=1000 reason=client-close)
15:53:29.380 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T15:53:29.369Z INFO  [bridge] client disconnected 127.0.0.1:38759 {"code":1000,"reason":"client-close","requests":27,"clients":0}
15:53:29.397 INFO  [ext] T1 worker stopped
15:53:29.402 ERROR [ext] T0 worker failed: T0 worker exited with code 1
2026-10-29T15:53:29.441Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T15:53:29.444Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T15:53:29.515Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T15:53:29.556Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T15:53:29.561Z DEBUG [bridge] event detached had no subscribers
2026-10-29T15:53:29.564Z INFO  [bridge] server closed
2026-10-29T15:53:29.571Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, a
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        3 chars  "The"
delta        9 chars  "The quick"
delta       19 chars  "The quick brown fox"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":342,"totalMs":2103,"settledBy":"sentinel","chars":126}
status    "Settled in 2103 ms (first token 342 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

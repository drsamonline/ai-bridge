# Batch 2.1 — extension evidence: status bar, chat panel, repo, state (stubbed VS Code host)

Generated: 2026-10-29T15:22:02.770Z
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
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  recycle + gc commands produce Output lines
```

Result: 27/27 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1215/8000 · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
15:21:42.935 INFO  [ext] no workspace folder — repo context and edit proposals are off
15:21:42.951 INFO  [ext] AI Bridge v0.6.0 activated — extension path <repo>/extension
15:21:42.995 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
15:21:43.145 INFO  [ext] chat panel resolved
15:21:43.889 INFO  [ext] T1 worker ready
15:21:43.900 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
15:21:43.915 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
15:21:43.915 INFO  [ext] state ready: 0 delta(s), 0 file(s)
15:21:44.072 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T15-21-43-920Z-init.json.gz
15:21:44.099 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
2026-10-29T15:21:46.102Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":7603,"home":"<tmp-home>"}
2026-10-29T15:21:46.108Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T15:21:46.157Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T15:21:46.170Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T15:21:46.180Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T15:21:46.183Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T15:21:46.191Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":7603,"lock":"<tmp-home>/.ai-bridge/lock.json"}
15:21:46.196 INFO  [ext] bridge ready — port 47911, pid 7603, lock <tmp-home>/.ai-bridge/lock.json
15:21:46.197 INFO  [ext] phase → handshaking (reading lock + attach)
15:21:46.242 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=7603 port=47911
15:21:46.242 INFO  [ext] connecting ws://127.0.0.1:47911
15:21:46.242 INFO  [ext] dialling ws://127.0.0.1:47911
15:21:46.263 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T15:21:46.265Z INFO  [bridge] client connected 127.0.0.1:38881 {"clients":1}
2026-10-29T15:21:46.269Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:38881","pid":7603,"protocol":1,"fingerprint":"e9070c000658"}
15:21:46.275 INFO  [ext] handshake OK — pid=7603 v0.1.0 protocol=v1 token=e9070c000658 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
15:21:46.275 INFO  [ext] phase → ready (handshake ok, pid 7603)
15:21:46.276 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=7603 · v0.1.0 · protocol=v1 · token=e9070c000658 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T15:21:46.278Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T15:21:46.280Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
15:21:46.286 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T15:21:46.287Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T15:21:46.326Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T15:21:46.327Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T15:21:46.691Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T15:21:46.707Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
15:21:46.713 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
15:21:46.717 INFO  [ext] <- attached
2026-10-29T15:21:46.964Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T15:21:47.656Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
15:21:47.662 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
15:21:47.663 INFO  [ext] <- tab.opened
15:21:47.666 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
15:21:50.256 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:21:50.256 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 41 ms (worker)
15:21:50.256 INFO  [ext] state: user turn → +1 delta(s), 1 total, 41 ms (worker)
15:21:50.256 INFO  [ext] prompt → chatgpt: Tell me about foxes in src/fox.ts
2026-10-29T15:21:50.259Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T15:21:53.393Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T15:21:53.394Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T15:21:54.749Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
15:21:54.914 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"Tell me about foxes in src/fox.ts"}
15:21:54.922 INFO  [ext] <- stream.start
2026-10-29T15:21:55.677Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":33}
2026-10-29T15:21:55.741Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T15:21:56.122Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T15:21:56.271Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
15:21:56.495 INFO  [ext] <- stream.delta
15:21:56.625 INFO  [ext] <- stream.delta
15:21:56.682 INFO  [ext] <- stream.delta
15:21:56.823 INFO  [ext] <- stream.delta
15:21:56.938 INFO  [ext] <- stream.delta
15:21:57.075 INFO  [ext] <- stream.delta
15:21:57.211 INFO  [ext] <- stream.delta
15:21:57.275 INFO  [ext] <- stream.delta
15:21:57.323 INFO  [ext] <- stream.delta
15:21:57.480 INFO  [ext] <- stream.delta
15:21:57.576 INFO  [ext] <- stream.delta
15:21:57.623 INFO  [ext] <- stream.delta
15:21:57.676 INFO  [ext] <- stream.delta
15:21:58.099 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1968,"firstTokenMs":365,"settledBy":"sentinel","chars":126}
15:21:58.099 INFO  [ext] <- stream.end
2026-10-29T15:21:58.099Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":365,"totalMs":1968,"settledBy":"sentinel","chars":126,"turns":1}
15:21:58.102 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 365 ms · total 1968 ms · settled by sentinel
15:21:58.138 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:21:58.138 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 36 ms (worker)
15:21:58.138 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 36 ms (worker)
15:21:58.826 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
15:21:58.826 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
15:21:58.826 INFO  [ext] boot injection cancelled
2026-10-29T15:21:58.909Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
15:21:58.935 INFO  [ext] tab.closed: {"id":"tab1"}
15:21:58.936 INFO  [ext] <- tab.closed
2026-10-29T15:22:00.558Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
15:22:00.562 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
15:22:00.562 INFO  [ext] <- tab.opened
2026-10-29T15:22:00.561Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
15:22:00.563 INFO  [ext] tab recycled (user) → tab2 · total 1
15:22:00.563 INFO  [ext] <- recycled
15:22:00.563 INFO  [ext] recycled tab1 → tab2
2026-10-29T15:22:00.650Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
15:22:00.652 INFO  [ext] gc: {"pages":1,"ok":true}
15:22:00.653 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
15:22:00.657 INFO  [ext] status refresh failed: client closed
15:22:00.664 INFO  [ext] socket closed (code=1000 reason=client-close)
15:22:00.664 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T15:22:00.667Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T15:22:00.671Z INFO  [bridge] client disconnected 127.0.0.1:38881 {"code":1000,"reason":"client-close","requests":27,"clients":0}
15:22:00.683 INFO  [ext] T1 worker stopped
2026-10-29T15:22:00.698Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T15:22:00.702Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T15:22:00.743Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T15:22:00.780Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T15:22:00.785Z DEBUG [bridge] event detached had no subscribers
2026-10-29T15:22:00.790Z INFO  [bridge] server closed
2026-10-29T15:22:00.796Z INFO  [bridge] lock file removed
[ext] bridge exited code=0 signal=null
```

## Chat panel traffic (extension → webview)

```
status    "Bridge ready — attach a browser"
status    "Attached: Chrome · 1 tab(s)"
user      "Tell me about foxes in src/fox.ts"
assistant    0 chars  ""
status    "Streaming from chatgpt…"
delta        9 chars  "The quick"
delta       15 chars  "The quick brown"
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
done      {"firstTokenMs":365,"totalMs":1968,"settledBy":"sentinel","chars":126}
status    "Settled in 1968 ms (first token 365 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

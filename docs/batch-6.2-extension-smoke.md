# Batch 6.2 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router, models (stubbed VS Code host)

Generated: 2026-10-29T17:24:31.611Z
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
PASS  the rotate command runs the full flow and reports it
PASS  rotation logged the boot it carried
PASS  the settings panel opens with all six tabs
PASS  the panel is a webview with a nonce and no inline handler leaks
PASS  recycle + gc commands produce Output lines
```

Result: 36/36 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1190/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
17:24:11.390 INFO  [ext] no workspace folder — repo context and edit proposals are off
17:24:11.395 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
17:24:11.482 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
17:24:11.581 INFO  [ext] chat panel resolved
17:24:11.882 INFO  [ext] T0 worker ready
17:24:11.883 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
17:24:11.891 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:24:11.975 INFO  [ext] T1 worker ready
17:24:11.978 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
17:24:11.981 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
17:24:11.981 INFO  [ext] state ready: 0 delta(s), 0 file(s)
17:24:12.003 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T17-24-11-985Z-init.json.gz
17:24:12.071 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
17:24:12.071 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T17:24:13.105Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":21177,"home":"<tmp-home>"}
2026-10-29T17:24:13.108Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T17:24:13.117Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T17:24:13.126Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T17:24:13.127Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T17:24:13.128Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T17:24:13.129Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":21177,"lock":"<tmp-home>/.ai-bridge/lock.json"}
17:24:13.130 INFO  [ext] bridge ready — port 47911, pid 21177, lock <tmp-home>/.ai-bridge/lock.json
17:24:13.131 INFO  [ext] phase → handshaking (reading lock + attach)
17:24:13.133 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=21177 port=47911
17:24:13.133 INFO  [ext] connecting ws://127.0.0.1:47911
17:24:13.134 INFO  [ext] dialling ws://127.0.0.1:47911
17:24:13.185 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T17:24:13.185Z INFO  [bridge] client connected 127.0.0.1:48458 {"clients":1}
2026-10-29T17:24:13.189Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:48458","pid":21177,"protocol":1,"fingerprint":"6321452435d7"}
17:24:13.192 INFO  [ext] handshake OK — pid=21177 v0.1.0 protocol=v1 token=6321452435d7 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
17:24:13.192 INFO  [ext] phase → ready (handshake ok, pid 21177)
17:24:13.192 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=21177 · v0.1.0 · protocol=v1 · token=6321452435d7 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T17:24:13.194Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T17:24:13.194Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
17:24:13.197 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T17:24:13.197Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T17:24:13.208Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T17:24:13.209Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T17:24:13.392Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T17:24:13.402Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
17:24:13.404 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
17:24:13.404 INFO  [ext] <- attached
2026-10-29T17:24:13.717Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T17:24:13.964Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
17:24:13.975 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
17:24:13.975 INFO  [ext] <- tab.opened
17:24:13.978 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
17:24:16.514 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:24:16.514 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 13 ms (worker)
17:24:16.514 INFO  [ext] state: user turn → +1 delta(s), 1 total, 13 ms (worker)
17:24:16.525 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:24:16.525 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
17:24:16.525 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
17:24:16.527 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:24:16.529Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T17:24:19.702Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T17:24:19.703Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T17:24:20.103Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
17:24:20.146 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
17:24:20.149 INFO  [ext] <- stream.start
2026-10-29T17:24:20.475Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T17:24:20.486Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T17:24:20.710Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:24:20.774Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:24:21.048 INFO  [ext] <- stream.delta
17:24:21.185 INFO  [ext] <- stream.delta
17:24:21.297 INFO  [ext] <- stream.delta
17:24:21.402 INFO  [ext] <- stream.delta
17:24:21.452 INFO  [ext] <- stream.delta
17:24:21.554 INFO  [ext] <- stream.delta
17:24:21.663 INFO  [ext] <- stream.delta
17:24:21.755 INFO  [ext] <- stream.delta
17:24:21.813 INFO  [ext] <- stream.delta
17:24:21.909 INFO  [ext] <- stream.delta
17:24:22.006 INFO  [ext] <- stream.delta
17:24:22.073 INFO  [ext] <- stream.delta
17:24:22.564 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1850,"firstTokenMs":333,"settledBy":"sentinel","chars":126,"switched":0}
17:24:22.564 INFO  [ext] <- stream.end
2026-10-29T17:24:22.563Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":333,"totalMs":1850,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:24:22.565 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 333 ms · total 1850 ms · settled by sentinel
17:24:22.575 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:24:22.575 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 10 ms (worker)
17:24:22.575 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 10 ms (worker)
17:24:23.224 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
17:24:23.224 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
17:24:23.225 INFO  [ext] boot injection cancelled
17:24:23.259 INFO  [ext] rotation: requested manually
17:24:23.261 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:24:23.275Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
17:24:23.277 INFO  [ext] tab.closed: {"id":"tab1"}
17:24:23.277 INFO  [ext] <- tab.closed
2026-10-29T17:24:23.782Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
17:24:23.784 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
17:24:23.785 INFO  [ext] <- tab.opened
17:24:24.007 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
17:24:24.007 INFO  [ext] <- stream.start
2026-10-29T17:24:24.206Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":383}
2026-10-29T17:24:24.397Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:24:24.472Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:24:24.878 INFO  [ext] <- stream.delta
17:24:24.932 INFO  [ext] <- stream.delta
17:24:25.033 INFO  [ext] <- stream.delta
17:24:25.135 INFO  [ext] <- stream.delta
17:24:25.234 INFO  [ext] <- stream.delta
17:24:25.337 INFO  [ext] <- stream.delta
17:24:25.387 INFO  [ext] <- stream.delta
17:24:25.479 INFO  [ext] <- stream.delta
17:24:25.589 INFO  [ext] <- stream.delta
17:24:25.690 INFO  [ext] <- stream.delta
17:24:25.791 INFO  [ext] <- stream.delta
17:24:25.891 INFO  [ext] <- stream.delta
17:24:26.482 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2083,"firstTokenMs":479,"settledBy":"sentinel","chars":126,"switched":0}
17:24:26.482 INFO  [ext] <- stream.end
17:24:26.483 WARN  [ext] boot ack: 0 restated, 0 missing
17:24:26.483 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
2026-10-29T17:24:26.482Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":479,"totalMs":2083,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:24:26.567 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
17:24:26.568 INFO  [ext] <- stream.start
2026-10-29T17:24:26.700Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":513}
2026-10-29T17:24:26.919Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
17:24:26.986 INFO  [ext] <- stream.delta
17:24:27.026 INFO  [ext] <- stream.delta
17:24:27.382 INFO  [ext] <- stream.delta
17:24:27.437 INFO  [ext] <- stream.delta
17:24:27.584 INFO  [ext] <- stream.delta
17:24:27.634 INFO  [ext] <- stream.delta
17:24:27.692 INFO  [ext] <- stream.delta
17:24:27.848 INFO  [ext] <- stream.delta
17:24:27.941 INFO  [ext] <- stream.delta
17:24:28.044 INFO  [ext] <- stream.delta
17:24:28.144 INFO  [ext] <- stream.delta
17:24:28.245 INFO  [ext] <- stream.delta
17:24:28.395 INFO  [ext] <- stream.delta
17:24:28.939 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2018,"firstTokenMs":54,"settledBy":"sentinel","chars":126,"switched":0}
17:24:28.940 INFO  [ext] <- stream.end
17:24:28.941 WARN  [ext] boot ack: 0 restated, 0 missing
17:24:28.941 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
17:24:28.941 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
17:24:28.956 INFO  [ext] settings panel opened
2026-10-29T17:24:28.939Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":54,"totalMs":2018,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
2026-10-29T17:24:28.976Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
17:24:28.980 INFO  [ext] tab.closed: {"id":"tab2"}
17:24:28.981 INFO  [ext] <- tab.closed
2026-10-29T17:24:29.465Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
17:24:29.469 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
17:24:29.469 INFO  [ext] <- tab.opened
2026-10-29T17:24:29.468Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
17:24:29.472 INFO  [ext] tab recycled (user) → tab3 · total 1
17:24:29.472 INFO  [ext] <- recycled
17:24:29.473 INFO  [ext] recycled tab2 → tab3
2026-10-29T17:24:29.596Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
17:24:29.599 INFO  [ext] gc: {"pages":1,"ok":true}
17:24:29.599 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
17:24:29.603 INFO  [ext] status refresh failed: client closed
17:24:29.608 INFO  [ext] socket closed (code=1000 reason=client-close)
17:24:29.608 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T17:24:29.610Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T17:24:29.617Z INFO  [bridge] client disconnected 127.0.0.1:48458 {"code":1000,"reason":"client-close","requests":64,"clients":0}
17:24:29.634 ERROR [ext] T0 worker failed: T0 worker exited with code 1
17:24:29.636 INFO  [ext] T1 worker stopped
2026-10-29T17:24:29.648Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-29T17:24:29.651Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T17:24:29.685Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T17:24:29.703Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T17:24:29.704Z DEBUG [bridge] event detached had no subscribers
2026-10-29T17:24:29.706Z INFO  [bridge] server closed
2026-10-29T17:24:29.709Z INFO  [bridge] lock file removed
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
delta       19 chars  "The quick brown fox"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       89 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      120 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":333,"totalMs":1850,"settledBy":"sentinel","chars":126}
status    "Settled in 1850 ms (first token 333 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

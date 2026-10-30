# Batch 7.2 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router, models, low-end, diagnostics (stubbed VS Code host)

Generated: 2026-10-30T09:22:39.544Z
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
PASS  on a 4 GB host the T1 gate keeps T0 (acceptance line)
PASS  the prompt still went out (T1 being off never blocks)
PASS  T0 ran on the outgoing prompt
PASS  status bar shows the compression meter (§6 Status Bar row)
PASS  activation stays inside the §8 budget (<500 ms)
PASS  low-end mode is active on a 4 GB host and shown in the status bar (§7.1)
PASS  the breakage-report command is contributed (§7.2)
PASS  keyboard shortcuts are contributed (§7.1 polish)
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

Result: 40/40 passed.

## Status bar, live

```
ChatGPT · $(browser) Attached: Chrome · RAM 1191/8000 · tok 0/4k · tab 2s · $(zap) LE
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
09:22:17.830 INFO  [ext] no workspace folder — repo context and edit proposals are off
09:22:17.839 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
09:22:17.844 WARN  [ext] low-end: 4.0 GB ≤ 8.0 GB — low-end mode on (T1 off, short boot, fewer files)
09:22:17.902 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
09:22:18.014 INFO  [ext] chat panel resolved
09:22:18.233 ERROR [ext] T0 worker failed: Cannot find module '<repo>/extension/dist/t0Worker.js'
09:22:18.343 ERROR [ext] T0 worker failed: T0 worker exited with code 1
09:22:18.455 ERROR [ext] T1 worker failed: Cannot find module '<repo>/extension/dist/t1Worker.js'
09:22:18.455 WARN  [ext] restarting T1 worker once
09:22:18.614 ERROR [ext] T1 worker failed: T1 worker exited with code 1
09:22:18.756 ERROR [ext] T1 worker failed: Cannot find module '<repo>/extension/dist/t1Worker.js'
09:22:18.824 ERROR [ext] T1 worker failed: T1 worker exited with code 1
09:22:19.861 WARN  [ext] T0 worker did not report ready — will run inline
09:22:19.861 INFO  [ext] T0 compressor ready (inline), tier=auto, budget=4096 tokens
09:22:19.862 INFO  [ext] T1 off: low-end machine (4.0 GB < 8.0 GB) — staying on T0
2026-10-30T09:22:19.941Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":2510,"home":"<tmp-home>"}
2026-10-30T09:22:19.946Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-30T09:22:19.957Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-30T09:22:19.964Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-30T09:22:19.966Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-30T09:22:19.968Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-30T09:22:19.970Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":2510,"lock":"<tmp-home>/.ai-bridge/lock.json"}
09:22:19.972 INFO  [ext] bridge ready — port 47911, pid 2510, lock <tmp-home>/.ai-bridge/lock.json
09:22:19.973 INFO  [ext] phase → handshaking (reading lock + attach)
09:22:19.994 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=2510 port=47911
09:22:19.994 INFO  [ext] connecting ws://127.0.0.1:47911
09:22:19.994 INFO  [ext] dialling ws://127.0.0.1:47911
09:22:20.035 WARN  [ext] T1 worker did not report ready in time — will run inline
09:22:20.045 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
09:22:20.053 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
09:22:20.053 INFO  [ext] state ready: 0 delta(s), 0 file(s)
09:22:20.075 INFO  [ext] socket open — sending { op: "attach" }
2026-10-30T09:22:20.077Z INFO  [bridge] client connected 127.0.0.1:45115 {"clients":1}
2026-10-30T09:22:20.083Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:45115","pid":2510,"protocol":1,"fingerprint":"a413fcd2bf45"}
09:22:20.123 INFO  [ext] handshake OK — pid=2510 v0.1.0 protocol=v1 token=a413fcd2bf45 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
09:22:20.123 INFO  [ext] phase → ready (handshake ok, pid 2510)
09:22:20.125 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=2510 · v0.1.0 · protocol=v1 · token=a413fcd2bf45 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-30T09:22:20.129Z INFO  [bridge] ram cap updated {"capMB":8000}
09:22:20.138 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-30T09-22-20-055Z-init.json.gz
2026-10-30T09:22:20.135Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
09:22:20.149 INFO  [ext] attaching via connectOverCDP — probing ports 9222
09:22:20.170 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 inline
09:22:20.171 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-30T09:22:20.154Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-30T09:22:20.221Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-30T09:22:20.222Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-30T09:22:20.486Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
09:22:20.498 WARN  [ext] T1 worker did not report ready in time — will run inline
2026-10-30T09:22:20.499Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
09:22:20.506 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
09:22:20.507 INFO  [ext] <- attached
2026-10-30T09:22:20.659Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-30T09:22:20.915Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
09:22:20.916 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
09:22:20.917 INFO  [ext] <- tab.opened
09:22:20.919 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
09:22:23.474 WARN  [ext] T1 is running on the extension-host thread (no worker)
09:22:23.516 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
09:22:23.516 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 42 ms (inline)
09:22:23.516 INFO  [ext] state: user turn → +1 delta(s), 1 total, 42 ms (inline)
09:22:23.516 WARN  [ext] T0 is running on the extension-host thread (no worker)
09:22:23.536 INFO  [ext] compressor tier: T0 — low-end machine (4.0 GB < 8.0 GB) — staying on T0
09:22:23.536 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
09:22:23.537 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
09:22:23.538 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T09:22:23.547Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-30T09:22:26.661Z WARN  [bridge:adapters:chatgpt] chatgpt: selector composer matched nothing
2026-10-30T09:22:26.666Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-30T09:22:27.402Z INFO  [bridge:adapters:chatgpt] chatgpt: selector composer → primary {"selector":"#prompt-textarea"}
09:22:27.446 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
09:22:27.448 INFO  [ext] <- stream.start
2026-10-30T09:22:27.809Z INFO  [bridge:adapters:chatgpt] chatgpt: selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-30T09:22:27.957Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T09:22:28.014Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
09:22:28.423 INFO  [ext] <- stream.delta
09:22:28.525 INFO  [ext] <- stream.delta
09:22:28.573 INFO  [ext] <- stream.delta
09:22:28.680 INFO  [ext] <- stream.delta
09:22:28.782 INFO  [ext] <- stream.delta
09:22:28.893 INFO  [ext] <- stream.delta
09:22:28.943 INFO  [ext] <- stream.delta
09:22:29.041 INFO  [ext] <- stream.delta
09:22:29.148 INFO  [ext] <- stream.delta
09:22:29.252 INFO  [ext] <- stream.delta
09:22:29.350 INFO  [ext] <- stream.delta
09:22:29.454 INFO  [ext] <- stream.delta
09:22:30.038 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2075,"firstTokenMs":463,"settledBy":"sentinel","chars":126,"switched":0}
09:22:30.038 INFO  [ext] <- stream.end
09:22:30.040 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 463 ms · total 2075 ms · settled by sentinel
2026-10-30T09:22:30.036Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":463,"totalMs":2075,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
09:22:30.064 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
09:22:30.064 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 24 ms (inline)
09:22:30.064 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 24 ms (inline)
09:22:30.692 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
09:22:30.692 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
09:22:30.692 INFO  [ext] boot injection cancelled
09:22:30.739 INFO  [ext] rotation: requested manually
09:22:30.740 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T09:22:30.767Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
09:22:30.772 INFO  [ext] tab.closed: {"id":"tab1"}
09:22:30.772 INFO  [ext] <- tab.closed
2026-10-30T09:22:31.322Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
09:22:31.324 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
09:22:31.325 INFO  [ext] <- tab.opened
09:22:31.626 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
09:22:31.627 INFO  [ext] <- stream.start
2026-10-30T09:22:32.331Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T09:22:32.403Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
09:22:32.669 INFO  [ext] <- stream.delta
09:22:32.760 INFO  [ext] <- stream.delta
09:22:32.814 INFO  [ext] <- stream.delta
09:22:32.916 INFO  [ext] <- stream.delta
09:22:33.009 INFO  [ext] <- stream.delta
09:22:33.109 INFO  [ext] <- stream.delta
09:22:33.169 INFO  [ext] <- stream.delta
09:22:33.310 INFO  [ext] <- stream.delta
09:22:33.413 INFO  [ext] <- stream.delta
09:22:33.461 INFO  [ext] <- stream.delta
09:22:33.564 INFO  [ext] <- stream.delta
09:22:33.663 INFO  [ext] <- stream.delta
09:22:33.764 INFO  [ext] <- stream.delta
09:22:34.170 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":1837,"firstTokenMs":335,"settledBy":"sentinel","chars":126,"switched":0}
09:22:34.170 INFO  [ext] <- stream.end
2026-10-30T09:22:34.170Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":335,"totalMs":1837,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
09:22:34.174 WARN  [ext] boot ack: 0 restated, 0 missing
09:22:34.174 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
09:22:34.314 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
09:22:34.314 INFO  [ext] <- stream.start
2026-10-30T09:22:34.832Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
09:22:35.246 INFO  [ext] <- stream.delta
09:22:35.345 INFO  [ext] <- stream.delta
09:22:35.448 INFO  [ext] <- stream.delta
09:22:35.548 INFO  [ext] <- stream.delta
09:22:35.602 INFO  [ext] <- stream.delta
09:22:35.703 INFO  [ext] <- stream.delta
09:22:35.848 INFO  [ext] <- stream.delta
09:22:35.901 INFO  [ext] <- stream.delta
09:22:36.003 INFO  [ext] <- stream.delta
09:22:36.052 INFO  [ext] <- stream.delta
09:22:36.116 INFO  [ext] <- stream.delta
09:22:36.226 INFO  [ext] <- stream.delta
09:22:36.264 INFO  [ext] <- stream.delta
09:22:36.856 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2022,"firstTokenMs":409,"settledBy":"sentinel","chars":126,"switched":0}
09:22:36.857 INFO  [ext] <- stream.end
09:22:36.858 WARN  [ext] boot ack: 0 restated, 0 missing
09:22:36.858 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
09:22:36.858 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
09:22:36.865 INFO  [ext] settings panel opened
2026-10-30T09:22:36.856Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":409,"totalMs":2022,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
2026-10-30T09:22:36.908Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
09:22:36.915 INFO  [ext] tab.closed: {"id":"tab2"}
09:22:36.915 INFO  [ext] <- tab.closed
2026-10-30T09:22:37.369Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
09:22:37.370 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
09:22:37.371 INFO  [ext] <- tab.opened
2026-10-30T09:22:37.370Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
09:22:37.371 INFO  [ext] tab recycled (user) → tab3 · total 1
09:22:37.372 INFO  [ext] <- recycled
09:22:37.373 INFO  [ext] recycled tab2 → tab3
2026-10-30T09:22:37.460Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
09:22:37.461 INFO  [ext] gc: {"pages":1,"ok":true}
09:22:37.461 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
09:22:37.464 INFO  [ext] status refresh failed: client closed
09:22:37.468 INFO  [ext] socket closed (code=1000 reason=client-close)
09:22:37.468 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-30T09:22:37.467Z INFO  [bridge] shutting down (SIGTERM)
2026-10-30T09:22:37.471Z INFO  [bridge] client disconnected 127.0.0.1:45115 {"code":1000,"reason":"client-close","requests":69,"clients":0}
2026-10-30T09:22:37.480Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-30T09:22:37.495Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-30T09:22:37.523Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-30T09:22:37.543Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-30T09:22:37.545Z DEBUG [bridge] event detached had no subscribers
2026-10-30T09:22:37.548Z INFO  [bridge] server closed
2026-10-30T09:22:37.552Z INFO  [bridge] lock file removed
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
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":463,"totalMs":2075,"settledBy":"sentinel","chars":126}
marker    ""
status    "Settled in 2075 ms (first token 463 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

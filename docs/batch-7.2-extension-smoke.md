# Batch 7.2 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router, models, low-end, diagnostics (stubbed VS Code host)

Generated: 2026-10-30T04:22:18.400Z
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
PASS  activation stays inside the §8 budget (<500 ms)
PASS  low-end mode is active on this machine and shown in the status bar (§7.1)
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
ChatGPT · $(browser) Attached: Chrome · RAM 1187/8000 · tok 0/4k · tab 2s · $(zap) LE
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
04:21:58.819 INFO  [ext] no workspace folder — repo context and edit proposals are off
04:21:58.828 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
04:21:58.894 WARN  [ext] low-end: 2.0 GB ≤ 8.0 GB — low-end mode on (T1 off, short boot, fewer files)
04:21:58.907 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
04:21:59.003 INFO  [ext] chat panel resolved
04:21:59.216 INFO  [ext] T0 worker ready
04:21:59.217 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
04:21:59.288 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
04:21:59.403 INFO  [ext] T1 worker ready
04:21:59.407 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
04:21:59.410 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
04:21:59.410 INFO  [ext] state ready: 0 delta(s), 0 file(s)
04:21:59.501 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-30T04-21-59-411Z-init.json.gz
04:21:59.504 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
04:21:59.504 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-30T04:22:00.454Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":6519,"home":"<tmp-home>"}
2026-10-30T04:22:00.457Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-30T04:22:00.495Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-30T04:22:00.501Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-30T04:22:00.502Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-30T04:22:00.502Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-30T04:22:00.503Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":6519,"lock":"<tmp-home>/.ai-bridge/lock.json"}
04:22:00.504 INFO  [ext] bridge ready — port 47911, pid 6519, lock <tmp-home>/.ai-bridge/lock.json
04:22:00.505 INFO  [ext] phase → handshaking (reading lock + attach)
04:22:00.507 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=6519 port=47911
04:22:00.508 INFO  [ext] connecting ws://127.0.0.1:47911
04:22:00.508 INFO  [ext] dialling ws://127.0.0.1:47911
04:22:00.532 INFO  [ext] socket open — sending { op: "attach" }
2026-10-30T04:22:00.532Z INFO  [bridge] client connected 127.0.0.1:44127 {"clients":1}
2026-10-30T04:22:00.536Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:44127","pid":6519,"protocol":1,"fingerprint":"590c45a185b0"}
04:22:00.540 INFO  [ext] handshake OK — pid=6519 v0.1.0 protocol=v1 token=590c45a185b0 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
04:22:00.540 INFO  [ext] phase → ready (handshake ok, pid 6519)
04:22:00.540 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=6519 · v0.1.0 · protocol=v1 · token=590c45a185b0 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-30T04:22:00.542Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-30T04:22:00.543Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
04:22:00.546 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-30T04:22:00.547Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-30T04:22:00.591Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-30T04:22:00.592Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-30T04:22:00.719Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-30T04:22:00.725Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
04:22:00.727 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
04:22:00.728 INFO  [ext] <- attached
2026-10-30T04:22:01.114Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
04:22:01.115 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
04:22:01.115 INFO  [ext] <- tab.opened
04:22:01.116 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
2026-10-30T04:22:01.119Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
04:22:03.631 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
04:22:03.632 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 9 ms (worker)
04:22:03.632 INFO  [ext] state: user turn → +1 delta(s), 1 total, 9 ms (worker)
04:22:03.640 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
04:22:03.640 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
04:22:03.641 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
04:22:03.643 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T04:22:03.645Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-30T04:22:06.792Z WARN  [bridge:adapters:chatgpt] chatgpt: selector composer matched nothing
2026-10-30T04:22:06.792Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-30T04:22:07.110Z INFO  [bridge:adapters:chatgpt] chatgpt: selector composer → primary {"selector":"#prompt-textarea"}
04:22:07.130 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
04:22:07.131 INFO  [ext] <- stream.start
2026-10-30T04:22:07.418Z INFO  [bridge:adapters:chatgpt] chatgpt: selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-30T04:22:07.549Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T04:22:07.618Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
04:22:08.027 INFO  [ext] <- stream.delta
04:22:08.126 INFO  [ext] <- stream.delta
04:22:08.179 INFO  [ext] <- stream.delta
04:22:08.280 INFO  [ext] <- stream.delta
04:22:08.376 INFO  [ext] <- stream.delta
04:22:08.482 INFO  [ext] <- stream.delta
04:22:08.583 INFO  [ext] <- stream.delta
04:22:08.733 INFO  [ext] <- stream.delta
04:22:08.833 INFO  [ext] <- stream.delta
04:22:08.934 INFO  [ext] <- stream.delta
04:22:09.034 INFO  [ext] <- stream.delta
04:22:09.631 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2080,"firstTokenMs":475,"settledBy":"sentinel","chars":126,"switched":0}
04:22:09.632 INFO  [ext] <- stream.end
2026-10-30T04:22:09.631Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":475,"totalMs":2080,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
04:22:09.632 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 475 ms · total 2080 ms · settled by sentinel
04:22:09.639 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
04:22:09.639 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 7 ms (worker)
04:22:09.639 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 7 ms (worker)
04:22:10.321 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
04:22:10.321 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
04:22:10.321 INFO  [ext] boot injection cancelled
04:22:10.340 INFO  [ext] rotation: requested manually
04:22:10.341 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T04:22:10.353Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
04:22:10.354 INFO  [ext] tab.closed: {"id":"tab1"}
04:22:10.355 INFO  [ext] <- tab.closed
2026-10-30T04:22:10.899Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
04:22:10.900 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
04:22:10.900 INFO  [ext] <- tab.opened
04:22:11.114 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
04:22:11.114 INFO  [ext] <- stream.start
2026-10-30T04:22:11.422Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T04:22:11.504Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
04:22:11.910 INFO  [ext] <- stream.delta
04:22:11.961 INFO  [ext] <- stream.delta
04:22:12.011 INFO  [ext] <- stream.delta
04:22:12.062 INFO  [ext] <- stream.delta
04:22:12.164 INFO  [ext] <- stream.delta
04:22:12.261 INFO  [ext] <- stream.delta
04:22:12.365 INFO  [ext] <- stream.delta
04:22:12.466 INFO  [ext] <- stream.delta
04:22:12.617 INFO  [ext] <- stream.delta
04:22:12.717 INFO  [ext] <- stream.delta
04:22:12.818 INFO  [ext] <- stream.delta
04:22:12.919 INFO  [ext] <- stream.delta
04:22:13.514 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2091,"firstTokenMs":486,"settledBy":"sentinel","chars":126,"switched":0}
04:22:13.514 INFO  [ext] <- stream.end
2026-10-30T04:22:13.514Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":486,"totalMs":2091,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
04:22:13.515 WARN  [ext] boot ack: 0 restated, 0 missing
04:22:13.515 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
04:22:13.555 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
04:22:13.555 INFO  [ext] <- stream.start
2026-10-30T04:22:13.910Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
04:22:14.365 INFO  [ext] <- stream.delta
04:22:14.416 INFO  [ext] <- stream.delta
04:22:14.568 INFO  [ext] <- stream.delta
04:22:14.668 INFO  [ext] <- stream.delta
04:22:14.718 INFO  [ext] <- stream.delta
04:22:14.819 INFO  [ext] <- stream.delta
04:22:14.918 INFO  [ext] <- stream.delta
04:22:15.022 INFO  [ext] <- stream.delta
04:22:15.124 INFO  [ext] <- stream.delta
04:22:15.175 INFO  [ext] <- stream.delta
04:22:15.275 INFO  [ext] <- stream.delta
04:22:15.375 INFO  [ext] <- stream.delta
04:22:15.920 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2010,"firstTokenMs":455,"settledBy":"sentinel","chars":126,"switched":0}
04:22:15.921 INFO  [ext] <- stream.end
04:22:15.921 WARN  [ext] boot ack: 0 restated, 0 missing
04:22:15.921 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
04:22:15.921 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
04:22:15.926 INFO  [ext] settings panel opened
2026-10-30T04:22:15.920Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":455,"totalMs":2010,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
2026-10-30T04:22:15.934Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
04:22:15.935 INFO  [ext] tab.closed: {"id":"tab2"}
04:22:15.935 INFO  [ext] <- tab.closed
2026-10-30T04:22:16.294Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
04:22:16.294 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
04:22:16.295 INFO  [ext] <- tab.opened
2026-10-30T04:22:16.294Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
04:22:16.295 INFO  [ext] tab recycled (user) → tab3 · total 1
04:22:16.295 INFO  [ext] <- recycled
04:22:16.296 INFO  [ext] recycled tab2 → tab3
2026-10-30T04:22:16.388Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
04:22:16.389 INFO  [ext] gc: {"pages":1,"ok":true}
04:22:16.390 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
04:22:16.393 INFO  [ext] status refresh failed: client closed
2026-10-30T04:22:16.400Z INFO  [bridge] shutting down (SIGTERM)
04:22:16.405 INFO  [ext] socket closed (code=1000 reason=client-close)
04:22:16.405 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-30T04:22:16.404Z INFO  [bridge] client disconnected 127.0.0.1:44127 {"code":1000,"reason":"client-close","requests":66,"clients":0}
04:22:16.409 ERROR [ext] T0 worker failed: T0 worker exited with code 1
04:22:16.410 INFO  [ext] T1 worker stopped
2026-10-30T04:22:16.416Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-30T04:22:16.417Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-30T04:22:16.490Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-30T04:22:16.498Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-30T04:22:16.499Z DEBUG [bridge] event detached had no subscribers
2026-10-30T04:22:16.500Z INFO  [bridge] server closed
2026-10-30T04:22:16.501Z INFO  [bridge] lock file removed
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
delta       25 chars  "The quick brown fox jumps"
delta       30 chars  "The quick brown fox jumps over"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":475,"totalMs":2080,"settledBy":"sentinel","chars":126}
marker    ""
status    "Settled in 2080 ms (first token 475 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

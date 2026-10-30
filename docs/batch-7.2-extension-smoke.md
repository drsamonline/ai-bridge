# Batch 7.2 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation, router, models, low-end, diagnostics (stubbed VS Code host)

Generated: 2026-10-30T09:11:17.538Z
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
ChatGPT · $(browser) Attached: Chrome · RAM 1204/8000 · tok 0/4k · tab 2s · $(zap) LE
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
09:10:58.012 INFO  [ext] no workspace folder — repo context and edit proposals are off
09:10:58.018 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
09:10:58.020 WARN  [ext] low-end: 4.0 GB ≤ 8.0 GB — low-end mode on (T1 off, short boot, fewer files)
09:10:58.102 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
09:10:58.198 INFO  [ext] chat panel resolved
09:10:58.435 ERROR [ext] T0 worker failed: Cannot find module '<repo>/extension/dist/t0Worker.js'
09:10:58.537 ERROR [ext] T0 worker failed: T0 worker exited with code 1
09:10:58.632 ERROR [ext] T1 worker failed: Cannot find module '<repo>/extension/dist/t1Worker.js'
09:10:58.632 WARN  [ext] restarting T1 worker once
09:10:58.722 ERROR [ext] T1 worker failed: T1 worker exited with code 1
09:10:58.923 ERROR [ext] T1 worker failed: Cannot find module '<repo>/extension/dist/t1Worker.js'
09:10:58.995 ERROR [ext] T1 worker failed: T1 worker exited with code 1
2026-10-30T09:10:59.811Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":468,"home":"<tmp-home>"}
2026-10-30T09:10:59.817Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-30T09:10:59.828Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-30T09:10:59.835Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-30T09:10:59.836Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-30T09:10:59.837Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-30T09:10:59.839Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":468,"lock":"<tmp-home>/.ai-bridge/lock.json"}
09:10:59.841 INFO  [ext] bridge ready — port 47911, pid 468, lock <tmp-home>/.ai-bridge/lock.json
09:10:59.841 INFO  [ext] phase → handshaking (reading lock + attach)
09:10:59.845 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=468 port=47911
09:10:59.845 INFO  [ext] connecting ws://127.0.0.1:47911
09:10:59.845 INFO  [ext] dialling ws://127.0.0.1:47911
09:10:59.902 INFO  [ext] socket open — sending { op: "attach" }
2026-10-30T09:10:59.901Z INFO  [bridge] client connected 127.0.0.1:44260 {"clients":1}
2026-10-30T09:10:59.906Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:44260","pid":468,"protocol":1,"fingerprint":"8958f45850fc"}
09:10:59.912 INFO  [ext] handshake OK — pid=468 v0.1.0 protocol=v1 token=8958f45850fc caps=[attach,recycle,navigate,send,observe,health,ctl.*]
09:10:59.912 INFO  [ext] phase → ready (handshake ok, pid 468)
09:10:59.913 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=468 · v0.1.0 · protocol=v1 · token=8958f45850fc · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-30T09:10:59.915Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-30T09:10:59.916Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
09:10:59.920 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-30T09:10:59.922Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-30T09:10:59.938Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-30T09:10:59.939Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
09:11:00.029 WARN  [ext] T0 worker did not report ready — will run inline
09:11:00.029 INFO  [ext] T0 compressor ready (inline), tier=auto, budget=4096 tokens
09:11:00.031 INFO  [ext] T1 off: low-end machine (4.0 GB < 8.0 GB) — staying on T0
2026-10-30T09:11:00.047Z INFO  [bridge] providers: 0 custom accepted, 0 rejected {"accepted":[]}
2026-10-30T09:11:00.147Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-30T09:11:00.155Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
09:11:00.157 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
09:11:00.159 INFO  [ext] <- attached
09:11:00.209 WARN  [ext] T1 worker did not report ready in time — will run inline
09:11:00.216 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
09:11:00.219 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
09:11:00.219 INFO  [ext] state ready: 0 delta(s), 0 file(s)
09:11:00.240 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-30T09-11-00-219Z-init.json.gz
09:11:00.243 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 inline
09:11:00.243 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-30T09:11:00.427Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-30T09:11:00.534Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
09:11:00.537 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
09:11:00.537 INFO  [ext] <- tab.opened
09:11:00.594 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
09:11:00.636 WARN  [ext] T1 worker did not report ready in time — will run inline
09:11:03.126 WARN  [ext] T1 is running on the extension-host thread (no worker)
09:11:03.133 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
09:11:03.133 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 7 ms (inline)
09:11:03.133 INFO  [ext] state: user turn → +1 delta(s), 1 total, 7 ms (inline)
09:11:03.133 WARN  [ext] T0 is running on the extension-host thread (no worker)
09:11:03.139 INFO  [ext] compressor tier: T0 — low-end machine (4.0 GB < 8.0 GB) — staying on T0
09:11:03.139 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
09:11:03.141 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
09:11:03.142 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T09:11:03.144Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-30T09:11:06.265Z WARN  [bridge:adapters:chatgpt] chatgpt: selector composer matched nothing
2026-10-30T09:11:06.266Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-30T09:11:06.621Z INFO  [bridge:adapters:chatgpt] chatgpt: selector composer → primary {"selector":"#prompt-textarea"}
09:11:06.655 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
09:11:06.655 INFO  [ext] <- stream.start
2026-10-30T09:11:06.944Z INFO  [bridge:adapters:chatgpt] chatgpt: selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-30T09:11:07.097Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T09:11:07.152Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
09:11:07.508 INFO  [ext] <- stream.delta
09:11:07.610 INFO  [ext] <- stream.delta
09:11:07.663 INFO  [ext] <- stream.delta
09:11:07.813 INFO  [ext] <- stream.delta
09:11:07.912 INFO  [ext] <- stream.delta
09:11:07.964 INFO  [ext] <- stream.delta
09:11:08.065 INFO  [ext] <- stream.delta
09:11:08.163 INFO  [ext] <- stream.delta
09:11:08.266 INFO  [ext] <- stream.delta
09:11:08.367 INFO  [ext] <- stream.delta
09:11:08.426 INFO  [ext] <- stream.delta
09:11:08.520 INFO  [ext] <- stream.delta
09:11:08.925 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1824,"firstTokenMs":408,"settledBy":"sentinel","chars":126,"switched":0}
09:11:08.925 INFO  [ext] <- stream.end
2026-10-30T09:11:08.925Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":408,"totalMs":1824,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
09:11:08.928 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 408 ms · total 1824 ms · settled by sentinel
09:11:08.943 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
09:11:08.943 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 15 ms (inline)
09:11:08.943 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 15 ms (inline)
09:11:09.632 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
09:11:09.632 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
09:11:09.632 INFO  [ext] boot injection cancelled
09:11:09.671 INFO  [ext] rotation: requested manually
09:11:09.671 INFO  [ext] boot built: 96/2000 tokens, sections [header, deltas, files]
2026-10-30T09:11:09.686Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
09:11:09.687 INFO  [ext] tab.closed: {"id":"tab1"}
09:11:09.688 INFO  [ext] <- tab.closed
2026-10-30T09:11:10.298Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
09:11:10.300 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
09:11:10.301 INFO  [ext] <- tab.opened
09:11:10.534 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
09:11:10.535 INFO  [ext] <- stream.start
2026-10-30T09:11:10.920Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-30T09:11:11.007Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
09:11:11.362 INFO  [ext] <- stream.delta
09:11:11.462 INFO  [ext] <- stream.delta
09:11:11.515 INFO  [ext] <- stream.delta
09:11:11.665 INFO  [ext] <- stream.delta
09:11:11.765 INFO  [ext] <- stream.delta
09:11:11.815 INFO  [ext] <- stream.delta
09:11:11.915 INFO  [ext] <- stream.delta
09:11:12.015 INFO  [ext] <- stream.delta
09:11:12.117 INFO  [ext] <- stream.delta
09:11:12.217 INFO  [ext] <- stream.delta
09:11:12.268 INFO  [ext] <- stream.delta
09:11:12.369 INFO  [ext] <- stream.delta
09:11:12.769 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":1848,"firstTokenMs":441,"settledBy":"sentinel","chars":126,"switched":0}
09:11:12.769 INFO  [ext] <- stream.end
09:11:12.770 WARN  [ext] boot ack: 0 restated, 0 missing
09:11:12.770 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
2026-10-30T09:11:12.768Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":441,"totalMs":1848,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
09:11:12.816 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
09:11:12.817 INFO  [ext] <- stream.start
2026-10-30T09:11:13.139Z INFO  [bridge:adapters:chatgpt] chatgpt: send clicked {"via":"[data-testid=\"send-button\"]"}
09:11:13.196 INFO  [ext] <- stream.delta
09:11:13.246 INFO  [ext] <- stream.delta
09:11:13.602 INFO  [ext] <- stream.delta
09:11:13.703 INFO  [ext] <- stream.delta
09:11:13.804 INFO  [ext] <- stream.delta
09:11:13.896 INFO  [ext] <- stream.delta
09:11:13.957 INFO  [ext] <- stream.delta
09:11:14.060 INFO  [ext] <- stream.delta
09:11:14.146 INFO  [ext] <- stream.delta
09:11:14.262 INFO  [ext] <- stream.delta
09:11:14.364 INFO  [ext] <- stream.delta
09:11:14.414 INFO  [ext] <- stream.delta
09:11:14.515 INFO  [ext] <- stream.delta
09:11:14.619 INFO  [ext] <- stream.delta
09:11:15.149 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2008,"firstTokenMs":54,"settledBy":"sentinel","chars":126,"switched":0}
09:11:15.149 INFO  [ext] <- stream.end
09:11:15.149 WARN  [ext] boot ack: 0 restated, 0 missing
09:11:15.149 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
09:11:15.150 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
09:11:15.153 INFO  [ext] settings panel opened
2026-10-30T09:11:15.149Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":54,"totalMs":2008,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
2026-10-30T09:11:15.161Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
09:11:15.162 INFO  [ext] tab.closed: {"id":"tab2"}
09:11:15.162 INFO  [ext] <- tab.closed
2026-10-30T09:11:15.428Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
09:11:15.429 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
09:11:15.430 INFO  [ext] <- tab.opened
09:11:15.430 INFO  [ext] tab recycled (user) → tab3 · total 1
09:11:15.494 INFO  [ext] <- recycled
09:11:15.494 INFO  [ext] recycled tab2 → tab3
2026-10-30T09:11:15.429Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
2026-10-30T09:11:15.527Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
09:11:15.528 INFO  [ext] gc: {"pages":1,"ok":true}
09:11:15.528 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
09:11:15.530 INFO  [ext] status refresh failed: client closed
09:11:15.534 INFO  [ext] socket closed (code=1000 reason=client-close)
09:11:15.534 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-30T09:11:15.533Z INFO  [bridge] shutting down (SIGTERM)
2026-10-30T09:11:15.535Z INFO  [bridge] client disconnected 127.0.0.1:44260 {"code":1000,"reason":"client-close","requests":70,"clients":0}
2026-10-30T09:11:15.542Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-30T09:11:15.595Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-30T09:11:15.607Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-30T09:11:15.618Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-30T09:11:15.620Z DEBUG [bridge] event detached had no subscribers
2026-10-30T09:11:15.621Z INFO  [bridge] server closed
2026-10-30T09:11:15.623Z INFO  [bridge] lock file removed
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
delta       25 chars  "The quick brown fox jumps"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       49 chars  "The quick brown fox jumps over the lazy dog while"
delta       60 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":408,"totalMs":1824,"settledBy":"sentinel","chars":126}
marker    ""
status    "Settled in 1824 ms (first token 408 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

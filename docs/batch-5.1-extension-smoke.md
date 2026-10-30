# Batch 5.1 — extension evidence: status bar, panel, repo, state, boot, guard, compressor, settings, rotation (stubbed VS Code host)

Generated: 2026-10-29T17:02:13.662Z
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
17:01:53.684 INFO  [ext] no workspace folder — repo context and edit proposals are off
17:01:53.689 INFO  [ext] AI Bridge v0.8.0 activated — extension path <repo>/extension
17:01:53.731 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
17:01:53.813 INFO  [ext] chat panel resolved
17:01:54.210 INFO  [ext] T0 worker ready
17:01:54.216 INFO  [ext] T0 compressor ready (worker thread), tier=auto, budget=4096 tokens
17:01:54.230 INFO  [ext] T1 off: low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:01:54.272 INFO  [ext] T1 worker ready
17:01:54.283 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
17:01:54.289 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
17:01:54.289 INFO  [ext] state ready: 0 delta(s), 0 file(s)
17:01:54.372 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T17-01-54-290Z-init.json.gz
17:01:54.377 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
17:01:54.377 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T17:01:55.426Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":17045,"home":"<tmp-home>"}
2026-10-29T17:01:55.433Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T17:01:55.444Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T17:01:55.451Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T17:01:55.467Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T17:01:55.467Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T17:01:55.469Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":17045,"lock":"<tmp-home>/.ai-bridge/lock.json"}
17:01:55.470 INFO  [ext] bridge ready — port 47911, pid 17045, lock <tmp-home>/.ai-bridge/lock.json
17:01:55.470 INFO  [ext] phase → handshaking (reading lock + attach)
17:01:55.472 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=17045 port=47911
17:01:55.473 INFO  [ext] connecting ws://127.0.0.1:47911
17:01:55.473 INFO  [ext] dialling ws://127.0.0.1:47911
17:01:55.496 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T17:01:55.496Z INFO  [bridge] client connected 127.0.0.1:16460 {"clients":1}
2026-10-29T17:01:55.500Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:16460","pid":17045,"protocol":1,"fingerprint":"be1a8ff476db"}
17:01:55.503 INFO  [ext] handshake OK — pid=17045 v0.1.0 protocol=v1 token=be1a8ff476db caps=[attach,recycle,navigate,send,observe,health,ctl.*]
17:01:55.503 INFO  [ext] phase → ready (handshake ok, pid 17045)
17:01:55.504 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=17045 · v0.1.0 · protocol=v1 · token=be1a8ff476db · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T17:01:55.505Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T17:01:55.506Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
17:01:55.508 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T17:01:55.509Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T17:01:55.527Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T17:01:55.528Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T17:01:55.693Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T17:01:55.700Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
17:01:55.702 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
17:01:55.702 INFO  [ext] <- attached
2026-10-29T17:01:56.091Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T17:01:56.097Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
17:01:56.098 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
17:01:56.098 INFO  [ext] <- tab.opened
17:01:56.100 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
17:01:58.695 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:01:58.695 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 8 ms (worker)
17:01:58.695 INFO  [ext] state: user turn → +1 delta(s), 1 total, 8 ms (worker)
17:01:58.702 INFO  [ext] compressor tier: T0 — low-end machine (2.0 GB < 8.0 GB) — staying on T0
17:01:58.702 INFO  [ext] T0: 41→14 tokens (⇣66%) · 1 span(s) protected · 0 dup line(s)
17:01:58.702 INFO  [ext] prompt → chatgpt: Hi there! Please could you kindly tell me about the foxes in src/fox.ts? I would like you to keep it short, and I hope t
17:01:58.704 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:01:58.705Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T17:02:01.813Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T17:02:01.815Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T17:02:02.210Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
17:02:02.269 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","phase":"prompt","prompt":"tell me about the foxes in src/fox.ts? keep it short,!"}
17:02:02.270 INFO  [ext] <- stream.start
2026-10-29T17:02:02.601Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":54}
2026-10-29T17:02:02.639Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T17:02:02.794Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:02:02.890Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:02:03.253 INFO  [ext] <- stream.delta
17:02:03.354 INFO  [ext] <- stream.delta
17:02:03.454 INFO  [ext] <- stream.delta
17:02:03.555 INFO  [ext] <- stream.delta
17:02:03.654 INFO  [ext] <- stream.delta
17:02:03.704 INFO  [ext] <- stream.delta
17:02:03.805 INFO  [ext] <- stream.delta
17:02:03.901 INFO  [ext] <- stream.delta
17:02:04.014 INFO  [ext] <- stream.delta
17:02:04.116 INFO  [ext] <- stream.delta
17:02:04.216 INFO  [ext] <- stream.delta
17:02:04.266 INFO  [ext] <- stream.delta
17:02:04.902 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":2107,"firstTokenMs":454,"settledBy":"sentinel","chars":126,"switched":0}
17:02:04.903 INFO  [ext] <- stream.end
2026-10-29T17:02:04.902Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":454,"totalMs":2107,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:02:04.903 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 454 ms · total 2107 ms · settled by sentinel
17:02:04.918 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
17:02:04.918 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 15 ms (worker)
17:02:04.918 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 15 ms (worker)
17:02:05.627 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
17:02:05.627 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
17:02:05.627 INFO  [ext] boot injection cancelled
17:02:05.665 INFO  [ext] rotation: requested manually
17:02:05.665 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
2026-10-29T17:02:05.683Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
17:02:05.684 INFO  [ext] tab.closed: {"id":"tab1"}
17:02:05.685 INFO  [ext] <- tab.closed
2026-10-29T17:02:06.207Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html","tabs":1}
17:02:06.209 INFO  [ext] tab.opened: {"id":"tab2","url":"http://127.0.0.1:47806/chatgpt.html"}
17:02:06.209 INFO  [ext] <- tab.opened
17:02:06.475 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"You are resuming an in-progress engineering task. Read this state, then continue.\nRepo: (unknown)\nStack: typescript\nFirst, restate i
17:02:06.476 INFO  [ext] <- stream.start
2026-10-29T17:02:06.688Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":383}
2026-10-29T17:02:06.899Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T17:02:06.971Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
17:02:07.327 INFO  [ext] <- stream.delta
17:02:07.427 INFO  [ext] <- stream.delta
17:02:07.478 INFO  [ext] <- stream.delta
17:02:07.627 INFO  [ext] <- stream.delta
17:02:07.738 INFO  [ext] <- stream.delta
17:02:07.880 INFO  [ext] <- stream.delta
17:02:07.980 INFO  [ext] <- stream.delta
17:02:08.080 INFO  [ext] <- stream.delta
17:02:08.181 INFO  [ext] <- stream.delta
17:02:08.232 INFO  [ext] <- stream.delta
17:02:08.332 INFO  [ext] <- stream.delta
17:02:08.734 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":1834,"firstTokenMs":426,"settledBy":"sentinel","chars":126,"switched":0}
17:02:08.734 INFO  [ext] <- stream.end
17:02:08.736 WARN  [ext] boot ack: 0 restated, 0 missing
17:02:08.736 WARN  [ext] rotation: attempt 1 did not restate 0 item(s)
2026-10-29T17:02:08.734Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":426,"totalMs":1834,"settledBy":"sentinel","chars":126,"turns":1,"switched":"none"}
17:02:08.789 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab2","phase":"prompt","prompt":"Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\nYou
17:02:08.789 INFO  [ext] <- stream.start
2026-10-29T17:02:08.980Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":513}
2026-10-29T17:02:09.187Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
17:02:09.591 INFO  [ext] <- stream.delta
17:02:09.692 INFO  [ext] <- stream.delta
17:02:09.792 INFO  [ext] <- stream.delta
17:02:09.843 INFO  [ext] <- stream.delta
17:02:09.944 INFO  [ext] <- stream.delta
17:02:10.044 INFO  [ext] <- stream.delta
17:02:10.146 INFO  [ext] <- stream.delta
17:02:10.195 INFO  [ext] <- stream.delta
17:02:10.246 INFO  [ext] <- stream.delta
17:02:10.297 INFO  [ext] <- stream.delta
17:02:10.397 INFO  [ext] <- stream.delta
17:02:10.448 INFO  [ext] <- stream.delta
17:02:10.498 INFO  [ext] <- stream.delta
17:02:10.599 INFO  [ext] <- stream.delta
17:02:11.197 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab2","totalMs":2008,"firstTokenMs":403,"settledBy":"sentinel","chars":126,"switched":0}
17:02:11.197 INFO  [ext] <- stream.end
17:02:11.197 WARN  [ext] boot ack: 0 restated, 0 missing
17:02:11.197 WARN  [ext] rotation: attempt 2 did not restate 0 item(s)
17:02:11.198 WARN  [ext] rotation (manual): rotated=true preview=false ack=false tokens=96 tab=tab2 — rotated, but the fresh chat never restated the state (0 missing)
17:02:11.201 INFO  [ext] settings panel opened
2026-10-29T17:02:11.196Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":403,"totalMs":2008,"settledBy":"sentinel","chars":126,"turns":2,"switched":"none"}
2026-10-29T17:02:11.208Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
17:02:11.210 INFO  [ext] tab.closed: {"id":"tab2"}
17:02:11.210 INFO  [ext] <- tab.closed
2026-10-29T17:02:11.505Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
17:02:11.507 INFO  [ext] tab.opened: {"id":"tab3","url":"about:blank"}
17:02:11.507 INFO  [ext] <- tab.opened
2026-10-29T17:02:11.507Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab2","opened":"tab3"}
17:02:11.508 INFO  [ext] tab recycled (user) → tab3 · total 1
17:02:11.508 INFO  [ext] <- recycled
17:02:11.509 INFO  [ext] recycled tab2 → tab3
2026-10-29T17:02:11.604Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
17:02:11.608 INFO  [ext] gc: {"pages":1,"ok":true}
17:02:11.609 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
17:02:11.625 INFO  [ext] status refresh failed: client closed
2026-10-29T17:02:11.628Z INFO  [bridge] shutting down (SIGTERM)
2026-10-29T17:02:11.634Z INFO  [bridge] client disconnected 127.0.0.1:16460 {"code":1000,"reason":"client-close","requests":64,"clients":0}
17:02:11.667 INFO  [ext] socket closed (code=1000 reason=client-close)
17:02:11.667 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T17:02:11.674Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
17:02:11.677 ERROR [ext] T0 worker failed: T0 worker exited with code 1
17:02:11.679 INFO  [ext] T1 worker stopped
2026-10-29T17:02:11.675Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T17:02:11.687Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T17:02:11.696Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T17:02:11.698Z DEBUG [bridge] event detached had no subscribers
2026-10-29T17:02:11.704Z INFO  [bridge] server closed
2026-10-29T17:02:11.706Z INFO  [bridge] lock file removed
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
done      {"firstTokenMs":454,"totalMs":2107,"settledBy":"sentinel","chars":126}
status    "Settled in 2107 ms (first token 454 ms) · sentinel"
status    "Rotating session…"
status    "Rotated but context incomplete — 0 item(s) missing"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **warn**: AI Bridge: rotated, but the fresh chat did not restate 0 item(s): 
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

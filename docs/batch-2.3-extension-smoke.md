# Batch 2.3 — extension evidence: status bar, panel, repo, state, boot, guard (stubbed VS Code host)

Generated: 2026-10-29T15:36:37.731Z
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
PASS  status bar shows the boot token meter (§6 Status Bar row)
PASS  boot preview opens a continuation prompt
PASS  boot prompt is under 4k tokens
PASS  boot prompt names the repo context
PASS  recycle + gc commands produce Output lines
```

Result: 28/28 passed.

## Status bar, live

```
$(browser) Attached: Chrome · RAM 1205/8000 · tok 0/4k · tab 2s
```

## Acceptance rendering (unit, fixed inputs Edge / 120 MB / 500 MB cap)

```
$(browser) Attached: Edge · RAM 120/500 · tab 4m
```

## "AI Bridge" Output channel — captured verbatim

```
15:36:23.587 INFO  [ext] no workspace folder — repo context and edit proposals are off
15:36:23.597 INFO  [ext] AI Bridge v0.7.0 activated — extension path <repo>/extension
15:36:23.617 INFO  [ext] phase → starting (spawn)
[ext] spawning bridge: node <repo>/bridge/dist/main.js
15:36:23.696 INFO  [ext] chat panel resolved
15:36:24.119 INFO  [ext] T1 worker ready
15:36:24.123 INFO  [ext] T2 backend: heuristic (no Ollama on 127.0.0.1:11434)
15:36:24.175 INFO  [ext] no state at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz — starting fresh
15:36:24.175 INFO  [ext] state ready: 0 delta(s), 0 file(s)
15:36:24.224 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/snapshots/snap-2026-10-29T15-36-24-180Z-init.json.gz
15:36:24.268 INFO  [ext] state: 0 delta(s) at <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz · T1 on a worker thread
15:36:24.268 INFO  [ext] locked decisions: 0 (source: project state)
2026-10-29T15:36:25.333Z INFO  [bridge] AI Bridge starting {"version":"0.1.0","node":"v20.20.2","pid":9442,"home":"<tmp-home>"}
2026-10-29T15:36:25.337Z DEBUG [bridge] no usable existing lock {"reason":"no lock file at <tmp-home>/.ai-bridge/lock.json"}
2026-10-29T15:36:25.346Z INFO  [bridge] listening on ws://127.0.0.1:47911 {"protocol":1,"maxPayload":8388608}
2026-10-29T15:36:25.352Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47911}
2026-10-29T15:36:25.352Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47911","hint":"waiting for { op: \"attach\" }"}
2026-10-29T15:36:25.353Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-29T15:36:25.354Z INFO  [bridge:ram] RAM monitor started {"pollMs":3000,"capMB":8000}
AI_BRIDGE_READY {"port":47911,"pid":9442,"lock":"<tmp-home>/.ai-bridge/lock.json"}
15:36:25.355 INFO  [ext] bridge ready — port 47911, pid 9442, lock <tmp-home>/.ai-bridge/lock.json
15:36:25.355 INFO  [ext] phase → handshaking (reading lock + attach)
15:36:25.359 INFO  [ext] lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=9442 port=47911
15:36:25.359 INFO  [ext] connecting ws://127.0.0.1:47911
15:36:25.359 INFO  [ext] dialling ws://127.0.0.1:47911
15:36:25.398 INFO  [ext] socket open — sending { op: "attach" }
2026-10-29T15:36:25.398Z INFO  [bridge] client connected 127.0.0.1:35332 {"clients":1}
2026-10-29T15:36:25.403Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:35332","pid":9442,"protocol":1,"fingerprint":"3b2206818e66"}
15:36:25.408 INFO  [ext] handshake OK — pid=9442 v0.1.0 protocol=v1 token=3b2206818e66 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
15:36:25.408 INFO  [ext] phase → ready (handshake ok, pid 9442)
15:36:25.409 INFO  [ext] ✅ HANDSHAKE PROOF — op=attach accepted · pid=9442 · v0.1.0 · protocol=v1 · token=3b2206818e66 · caps=[attach, recycle, navigate, send, observe, health, ctl.*]
2026-10-29T15:36:25.410Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-29T15:36:25.411Z INFO  [bridge:ram] RAM monitor started {"pollMs":500,"capMB":8000}
15:36:25.414 INFO  [ext] attaching via connectOverCDP — probing ports 9222
2026-10-29T15:36:25.416Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-29T15:36:25.439Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-29T15:36:25.440Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-29T15:36:25.634Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":1}
2026-10-29T15:36:25.642Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
15:36:25.644 INFO  [ext] attached: Chrome HeadlessChrome/153.0.8010.12 on 127.0.0.1:9222 · contexts=1
15:36:25.645 INFO  [ext] <- attached
2026-10-29T15:36:25.927Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-29T15:36:26.024Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
15:36:26.029 INFO  [ext] tab.opened: {"id":"tab1","url":"about:blank"}
15:36:26.032 INFO  [ext] <- tab.opened
15:36:26.034 INFO  [ext] ✅ ATTACH PROOF — Chrome HeadlessChrome/153.0.8010.12 · port 9222 · contexts 1 · tabs 1
15:36:28.640 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:36:28.640 INFO  [ext] T1 turn 1: +1 delta(s) → 1 total, 9 ms (worker)
15:36:28.640 INFO  [ext] state: user turn → +1 delta(s), 1 total, 9 ms (worker)
15:36:28.640 INFO  [ext] prompt → chatgpt: Tell me about foxes in src/fox.ts
2026-10-29T15:36:28.641Z INFO  [bridge:adapters] lazy-loading adapter chatgpt
2026-10-29T15:36:31.799Z WARN  [bridge:adapters:chatgpt] selector composer: nothing matched
2026-10-29T15:36:31.800Z INFO  [bridge] adapter not ready — connecting {"adapterId":"chatgpt","url":"about:blank"}
2026-10-29T15:36:32.147Z INFO  [bridge:adapters:chatgpt] selector composer → primary {"selector":"#prompt-textarea"}
15:36:32.253 INFO  [ext] stream.start: {"adapterId":"chatgpt","tabId":"tab1","prompt":"Tell me about foxes in src/fox.ts"}
15:36:32.254 INFO  [ext] <- stream.start
2026-10-29T15:36:32.541Z INFO  [bridge:adapters:chatgpt] prompt written to composer {"chars":33}
2026-10-29T15:36:32.566Z INFO  [bridge:adapters:chatgpt] selector send → primary {"selector":"[data-testid=\"send-button\"]"}
2026-10-29T15:36:32.690Z INFO  [bridge:adapters:chatgpt] send clicked {"via":"[data-testid=\"send-button\"]"}
2026-10-29T15:36:32.787Z DEBUG [bridge:adapters:chatgpt:observe] observer installed
15:36:33.143 INFO  [ext] <- stream.delta
15:36:33.244 INFO  [ext] <- stream.delta
15:36:33.313 INFO  [ext] <- stream.delta
15:36:33.445 INFO  [ext] <- stream.delta
15:36:33.557 INFO  [ext] <- stream.delta
15:36:33.698 INFO  [ext] <- stream.delta
15:36:33.800 INFO  [ext] <- stream.delta
15:36:33.900 INFO  [ext] <- stream.delta
15:36:34.008 INFO  [ext] <- stream.delta
15:36:34.085 INFO  [ext] <- stream.delta
15:36:34.157 INFO  [ext] <- stream.delta
15:36:34.557 INFO  [ext] stream.end: {"adapterId":"chatgpt","tabId":"tab1","totalMs":1864,"firstTokenMs":449,"settledBy":"sentinel","chars":126}
15:36:34.558 INFO  [ext] <- stream.end
2026-10-29T15:36:34.557Z INFO  [bridge] prompt settled {"adapterId":"chatgpt","firstTokenMs":449,"totalMs":1864,"settledBy":"sentinel","chars":126,"turns":1}
15:36:34.560 INFO  [ext] ✅ STREAM PROOF — 126 chars · first token 449 ms · total 1864 ms · settled by sentinel
15:36:34.573 INFO  [ext] state saved: <tmp-state-home>/.ai-bridge/state/8001c2743965/state.full.json.gz
15:36:34.574 INFO  [ext] T1 turn 2: +0 delta(s) → 1 total, 14 ms (worker)
15:36:34.574 INFO  [ext] state: assistant turn → +0 delta(s), 1 total, 14 ms (worker)
15:36:35.208 INFO  [ext] boot built: 96/4000 tokens, sections [header, deltas, files]
15:36:35.208 INFO  [ext] boot: 96/4000 tokens, sections [header, deltas, files]
15:36:35.208 INFO  [ext] boot injection cancelled
2026-10-29T15:36:35.219Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
15:36:35.221 INFO  [ext] tab.closed: {"id":"tab1"}
15:36:35.222 INFO  [ext] <- tab.closed
2026-10-29T15:36:35.617Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"about:blank","tabs":1}
15:36:35.618 INFO  [ext] tab.opened: {"id":"tab2","url":"about:blank"}
15:36:35.618 INFO  [ext] <- tab.opened
2026-10-29T15:36:35.618Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab1","opened":"tab2"}
15:36:35.619 INFO  [ext] tab recycled (user) → tab2 · total 1
15:36:35.619 INFO  [ext] <- recycled
15:36:35.619 INFO  [ext] recycled tab1 → tab2
2026-10-29T15:36:35.712Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
15:36:35.714 INFO  [ext] gc: {"pages":1,"ok":true}
15:36:35.715 INFO  [ext] <- gc
[ext] stopping bridge (SIGTERM)
15:36:35.719 INFO  [ext] status refresh failed: client closed
2026-10-29T15:36:35.722Z INFO  [bridge] shutting down (SIGTERM)
15:36:35.724 INFO  [ext] socket closed (code=1000 reason=client-close)
15:36:35.724 INFO  [ext] socket closed during shutdown (code 1000)
2026-10-29T15:36:35.726Z INFO  [bridge] client disconnected 127.0.0.1:35332 {"code":1000,"reason":"client-close","requests":25,"clients":0}
15:36:35.730 INFO  [ext] T1 worker stopped
2026-10-29T15:36:35.782Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":0}
2026-10-29T15:36:35.782Z DEBUG [bridge] event tab.closed had no subscribers
2026-10-29T15:36:35.801Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-29T15:36:35.819Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-29T15:36:35.821Z DEBUG [bridge] event detached had no subscribers
2026-10-29T15:36:35.823Z INFO  [bridge] server closed
2026-10-29T15:36:35.825Z INFO  [bridge] lock file removed
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
delta       19 chars  "The quick brown fox"
delta       25 chars  "The quick brown fox jumps"
delta       39 chars  "The quick brown fox jumps over the lazy"
delta       53 chars  "The quick brown fox jumps over the lazy dog while the"
delta       73 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       81 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta       94 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      104 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      114 chars  "The quick brown fox jumps over the lazy dog while the bridge"
delta      126 chars  "The quick brown fox jumps over the lazy dog while the bridge"
done      {"firstTokenMs":449,"totalMs":1864,"settledBy":"sentinel","chars":126}
status    "Settled in 1864 ms (first token 449 ms) · sentinel"
```

## Toasts raised

- **info**: AI Bridge attached to Chrome on 127.0.0.1:9222.
- **info**: AI Bridge: tab recycled in the same context.
- **info**: AI Bridge: garbage collected 1 tab(s).

# Batch 0.2 — CDP attach acceptance evidence

Generated: 2026-11-09T20:28:02.454Z
Node v20.20.2 · fixture: /usr/local/bin/chromium-headless-shell --headless=new --remote-debugging-port=9222

The harness launches the browser as a stand-in for the user's already-open
browser. The bridge under test only attaches (`connectOverCDP`).

## Checks

```
PASS  attach reports an attached browser
PASS  browser identified from CDP version string
PASS  attached on the probed port
PASS  protocol version captured
PASS  one tab opened eagerly by the bridge
PASS  context is reused, never recreated
PASS  second tab tracked
PASS  tab url recorded
PASS  explicit tab close removes the tab
PASS  tab count back to one
PASS  turns accumulate below the limit
PASS  recycle fires at 50 turns (§5.2)
PASS  recycled counter incremented
PASS  recycle reason recorded
PASS  §4 { op: "recycle" } closes and reopens a tab
PASS  user tab still open after open/close/recycle
PASS  RSS is a positive number
PASS  RSS comes from the OS process accounting
PASS  process tree has browser+renderer+utility procs
PASS  renderer share identified
PASS  percent computed against the cap
PASS  idle soak stays under the running cap
PASS  no runaway growth while idle (<10% drift)
PASS  80% raises a warn event
PASS  warn reports eviction + GC work
PASS  warn measures what was freed
PASS  watchdog escalates to a tab recycle when still high
PASS  escalated warn is flagged as such
PASS  100% raises a block event
PASS  opening a tab is refused while blocked (ERAMBLOCK)
PASS  recovery unblocks and emits ram.ok
PASS  level is ok again after recovery
PASS  detach closed the bridge-owned tabs
PASS  detach reports the browser still running
PASS  browser CDP endpoint answers after detach
PASS  user tab still open after detach
PASS  attach with no endpoint fails with ENOCDP
PASS  bridge launched no browser of its own
PASS  no launch() call anywhere in bridge/src (attach-only policy)
```

Result: 39/39 passed.

Memory metric used: **procfs-rss** (6 processes, 1505 MB). This kernel exposes neither `smaps_rollup` nor shared-page counts, so the number is an RSS upper bound. The watchdog checks below drive the cap RELATIVE to the measured baseline, so they test the threshold logic, not the absolute figure.

## Bridge log (tail)

```
2026-11-09T20:27:37.075Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-11-09T20:27:37.076Z INFO  [bridge:ram] RAM monitor started {"pollMs":400,"capMB":8000}
AI_BRIDGE_READY {"port":47802,"pid":214,"lock":"<tmp-home>/.ai-bridge/lock.json"}
2026-11-09T20:27:37.168Z INFO  [bridge] client connected undefined:undefined {"clients":1}
2026-11-09T20:27:37.171Z INFO  [bridge] handshake OK — socket peer {"remote":"undefined:undefined","pid":214,"protocol":1,"fingerprint":""}
2026-11-09T20:27:37.177Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-11-09T20:27:37.188Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-11-09T20:27:37.189Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/156.0.8078.4","protocol":"1.3"}
2026-11-09T20:27:37.351Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":2}
2026-11-09T20:27:37.357Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/156.0.8078.4","port":9222,"contexts":1}
2026-11-09T20:27:37.534Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-11-09T20:27:37.724Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
2026-11-09T20:27:38.136Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"data:text/html,<h1>second</h1>","tabs":2}
2026-11-09T20:27:38.222Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":1}
2026-11-09T20:27:38.246Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
2026-11-09T20:27:38.636Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
2026-11-09T20:27:38.637Z INFO  [bridge:cdp] recycled active tab {"reason":"turns>=50","closed":"tab1","opened":"tab3"}
2026-11-09T20:27:38.652Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-11-09T20:27:39.030Z INFO  [bridge:cdp] tab opened {"id":"tab4","url":"about:blank","tabs":1}
2026-11-09T20:27:39.031Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab3","opened":"tab4"}
2026-11-09T20:27:59.401Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-11-09T20:27:59.413Z INFO  [bridge] ram cap updated {"capMB":1770}
2026-11-09T20:27:59.552Z WARN  [bridge:watchdog] RAM at 80% — evicting idle tabs and collecting garbage {"usedMB":1504,"capMB":1770,"percent":85}
2026-11-09T20:27:59.580Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
2026-11-09T20:27:59.953Z WARN  [bridge:watchdog] still above 80% after eviction — recycling active tab
2026-11-09T20:27:59.960Z INFO  [bridge:cdp] tab closed {"id":"tab4","remaining":0}
2026-11-09T20:28:00.273Z INFO  [bridge:cdp] tab opened {"id":"tab5","url":"about:blank","tabs":1}
2026-11-09T20:28:00.274Z INFO  [bridge:cdp] recycled active tab {"reason":"ram>=80%","closed":"tab4","opened":"tab5"}
2026-11-09T20:28:00.330Z INFO  [bridge] ram cap updated {"capMB":1354}
2026-11-09T20:28:00.362Z ERROR [bridge:watchdog] RAM cap reached — requests blocked {"usedMB":1505,"capMB":1354,"percent":111.1}
2026-11-09T20:28:00.400Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
2026-11-09T20:28:00.433Z WARN  [bridge] op ctl.tab.open failed: ERAMBLOCK: RAM cap reached — close a tab or raise the cap before opening another
2026-11-09T20:28:00.435Z INFO  [bridge] ram cap updated {"capMB":3009}
2026-11-09T20:28:00.761Z INFO  [bridge:watchdog] RAM back under the warn line — unblocked {"percent":50}
2026-11-09T20:28:00.856Z INFO  [bridge:cdp] tab closed {"id":"tab5","remaining":0}
2026-11-09T20:28:00.868Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-11-09T20:28:00.879Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-11-09T20:28:02.350Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-11-09T20:28:02.353Z WARN  [bridge:cdp] no CDP endpoint answered {"ports":[9222]}
2026-11-09T20:28:02.355Z WARN  [bridge] op ctl.attach failed: ENOCDP: nothing listening on 127.0.0.1:9222. Chrome 136+ ignores --remote-debugging-port on the default profile, so the flag alone will not open a port. Either start Chrome with BOTH switches — --remote-debugging-port=9222 --user-data-dir=<a folder of its own> — and sign in there once, or set aiBridge.browser.mode to "launch" and run AI Bridge: Launch Browser, which passes both.
2026-11-09T20:28:02.436Z INFO  [bridge] shutting down (SIGTERM)
2026-11-09T20:28:02.439Z INFO  [bridge] client disconnected undefined:undefined {"code":1000,"reason":"client-close","requests":33,"clients":0}
2026-11-09T20:28:02.439Z INFO  [bridge] server closed
2026-11-09T20:28:02.441Z INFO  [bridge] lock file removed
2026-11-09T20:28:02.441Z INFO  [bridge] socket removed
```

## Extension-side client log

```
INFO  lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=214 port=47802
INFO  dialling <tmp-home>/.ai-bridge/bridge.sock
INFO  socket open — sending { op: "attach" }
INFO  handshake OK — pid=214 v0.1.0 protocol=v1 token= caps=[attach,recycle,navigate,send,observe,health,ctl.*]
INFO  <- attached
INFO  <- tab.opened
INFO  <- tab.opened
INFO  <- tab.closed
INFO  <- tab.closed
INFO  <- tab.opened
INFO  <- recycled
INFO  <- tab.closed
INFO  <- tab.opened
INFO  <- recycled
INFO  <- gc
INFO  <- ram.warn
INFO  <- tab.closed
INFO  <- tab.opened
INFO  <- recycled
INFO  <- ram.warn
INFO  <- ram.block
INFO  <- gc
INFO  <- ram.ok
INFO  <- tab.closed
INFO  <- detached
INFO  socket closed (code=1000 reason=client-close)
```

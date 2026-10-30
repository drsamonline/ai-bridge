# Batch 0.2 — CDP attach acceptance evidence

Generated: 2026-10-30T04:21:56.288Z
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

Memory metric used: **procfs-rss** (6 processes, 1432 MB). This kernel exposes neither `smaps_rollup` nor shared-page counts, so the number is an RSS upper bound. The watchdog checks below drive the cap RELATIVE to the measured baseline, so they test the threshold logic, not the absolute figure.

## Bridge log (tail)

```
2026-10-30T04:21:30.523Z INFO  [bridge] lock file written {"path":"<tmp-home>/.ai-bridge/lock.json","mode":"0600","port":47802}
2026-10-30T04:21:30.523Z INFO  [bridge] bridge ready {"address":"ws://127.0.0.1:47802","hint":"waiting for { op: \"attach\" }"}
2026-10-30T04:21:30.524Z INFO  [bridge:watchdog] watchdog armed {"warn":"80%","block":"100%"}
2026-10-30T04:21:30.525Z INFO  [bridge:ram] RAM monitor started {"pollMs":400,"capMB":8000}
AI_BRIDGE_READY {"port":47802,"pid":6410,"lock":"<tmp-home>/.ai-bridge/lock.json"}
2026-10-30T04:21:30.621Z INFO  [bridge] client connected 127.0.0.1:61265 {"clients":1}
2026-10-30T04:21:30.625Z INFO  [bridge] handshake OK — token accepted {"remote":"127.0.0.1:61265","pid":6410,"protocol":1,"fingerprint":"cdc7674c0b64"}
2026-10-30T04:21:30.631Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-30T04:21:30.642Z INFO  [bridge:cdp] CDP endpoints found {"candidates":["Chrome@9222"]}
2026-10-30T04:21:30.643Z INFO  [bridge:cdp] attaching via connectOverCDP to Chrome on 127.0.0.1:9222 {"version":"HeadlessChrome/153.0.8010.12","protocol":"1.3"}
2026-10-30T04:21:30.811Z INFO  [bridge:cdp] context adopted {"contexts":1,"reused":true,"pagesInContext":2}
2026-10-30T04:21:30.816Z INFO  [bridge:cdp] attached {"name":"Chrome","version":"HeadlessChrome/153.0.8010.12","port":9222,"contexts":1}
2026-10-30T04:21:31.012Z WARN  [bridge:ram] RSS metric: PSS and shared-page accounting unavailable on this kernel; this is an RSS upper bound (shared pages counted per process)
2026-10-30T04:21:31.198Z INFO  [bridge:cdp] tab opened {"id":"tab1","url":"about:blank","tabs":1}
2026-10-30T04:21:31.693Z INFO  [bridge:cdp] tab opened {"id":"tab2","url":"data:text/html,<h1>second</h1>","tabs":2}
2026-10-30T04:21:31.714Z INFO  [bridge:cdp] tab closed {"id":"tab2","remaining":1}
2026-10-30T04:21:31.811Z INFO  [bridge:cdp] tab closed {"id":"tab1","remaining":0}
2026-10-30T04:21:32.219Z INFO  [bridge:cdp] tab opened {"id":"tab3","url":"about:blank","tabs":1}
2026-10-30T04:21:32.221Z INFO  [bridge:cdp] recycled active tab {"reason":"turns>=50","closed":"tab1","opened":"tab3"}
2026-10-30T04:21:32.294Z INFO  [bridge:cdp] tab closed {"id":"tab3","remaining":0}
2026-10-30T04:21:32.704Z INFO  [bridge:cdp] tab opened {"id":"tab4","url":"about:blank","tabs":1}
2026-10-30T04:21:32.705Z INFO  [bridge:cdp] recycled active tab {"reason":"user","closed":"tab3","opened":"tab4"}
2026-10-30T04:21:53.076Z INFO  [bridge] ram cap updated {"capMB":8000}
2026-10-30T04:21:53.088Z INFO  [bridge] ram cap updated {"capMB":1684}
2026-10-30T04:21:53.419Z WARN  [bridge:watchdog] RAM at 80% — evicting idle tabs and collecting garbage {"usedMB":1431,"capMB":1684,"percent":85}
2026-10-30T04:21:53.444Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
2026-10-30T04:21:53.819Z WARN  [bridge:watchdog] still above 80% after eviction — recycling active tab
2026-10-30T04:21:53.825Z INFO  [bridge:cdp] tab closed {"id":"tab4","remaining":0}
2026-10-30T04:21:54.107Z INFO  [bridge:cdp] tab opened {"id":"tab5","url":"about:blank","tabs":1}
2026-10-30T04:21:54.108Z INFO  [bridge:cdp] recycled active tab {"reason":"ram>=80%","closed":"tab4","opened":"tab5"}
2026-10-30T04:21:54.202Z INFO  [bridge] ram cap updated {"capMB":1288}
2026-10-30T04:21:54.221Z ERROR [bridge:watchdog] RAM cap reached — requests blocked {"usedMB":1431,"capMB":1288,"percent":111.1}
2026-10-30T04:21:54.242Z INFO  [bridge:cdp] gc requested {"pages":1,"ok":true}
2026-10-30T04:21:54.304Z WARN  [bridge] op ctl.tab.open failed: ERAMBLOCK: RAM cap reached — close a tab or raise the cap before opening another
2026-10-30T04:21:54.306Z INFO  [bridge] ram cap updated {"capMB":2862}
2026-10-30T04:21:54.623Z INFO  [bridge:watchdog] RAM back under the warn line — unblocked {"percent":50}
2026-10-30T04:21:54.725Z INFO  [bridge:cdp] tab closed {"id":"tab5","remaining":0}
2026-10-30T04:21:54.737Z DEBUG [bridge:cdp] CDP session closed by detach()
2026-10-30T04:21:54.746Z INFO  [bridge:cdp] detached {"closedTabs":1,"browserStillRunning":true}
2026-10-30T04:21:56.114Z INFO  [bridge:cdp] discovering CDP endpoints {"ports":[9222]}
2026-10-30T04:21:56.117Z WARN  [bridge:cdp] no CDP endpoint answered {"ports":[9222]}
2026-10-30T04:21:56.117Z WARN  [bridge] op ctl.attach failed: ENOCDP: nothing listening on 127.0.0.1:9222. Start Chrome/Edge with --remote-debugging-port=9222 and stay logged in. The bridge attaches to an existing browser and never launches one.
2026-10-30T04:21:56.236Z INFO  [bridge] shutting down (SIGTERM)
2026-10-30T04:21:56.237Z INFO  [bridge] server closed
2026-10-30T04:21:56.239Z INFO  [bridge] lock file removed
```

## Extension-side client log

```
INFO  lock file read: <tmp-home>/.ai-bridge/lock.json (mode 0600) pid=6410 port=47802
INFO  dialling ws://127.0.0.1:47802
INFO  socket open — sending { op: "attach" }
INFO  handshake OK — pid=6410 v0.1.0 protocol=v1 token=cdc7674c0b64 caps=[attach,recycle,navigate,send,observe,health,ctl.*]
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

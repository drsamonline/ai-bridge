# Batch 0.2 — 3-minute idle soak

Generated: 2026-10-30T03:24:48.902Z
Host: linux x64 · 2098 MB RAM · node v20.20.2
Fixture: /usr/local/bin/chromium-headless-shell --headless=new --remote-debugging-port=9222

Memory metric: **procfs-rss** (RSS upper bound on this kernel)

| check | result | detail |
|---|---|---|
| every sample under the cap | PASS | 1202 MB max vs 8000 MB |
| no runaway drift (<10% start→end) | PASS | -0.1% |
| never hit the block threshold | PASS | no block samples |

Samples: 60 · min 1200 MB · max 1202 MB · last 1200 MB

## Sample trace

```
t+   0s   1202 MB  15%  ok
t+   3s   1202 MB  15%  ok
t+   6s   1202 MB  15%  ok
t+   9s   1202 MB  15%  ok
t+  12s   1202 MB  15%  ok
t+  15s   1202 MB  15%  ok
t+  18s   1202 MB  15%  ok
t+  21s   1202 MB  15%  ok
t+  24s   1202 MB  15%  ok
t+  27s   1202 MB  15%  ok
t+  30s   1202 MB  15%  ok
t+  33s   1202 MB  15%  ok
t+  36s   1202 MB  15%  ok
t+  39s   1202 MB  15%  ok
t+  42s   1202 MB  15%  ok
t+  45s   1202 MB  15%  ok
t+  48s   1202 MB  15%  ok
t+  51s   1202 MB  15%  ok
t+  54s   1202 MB  15%  ok
t+  57s   1202 MB  15%  ok
t+  60s   1200 MB  15%  ok
t+  63s   1200 MB  15%  ok
t+  66s   1200 MB  15%  ok
t+  69s   1200 MB  15%  ok
t+  72s   1200 MB  15%  ok
t+  75s   1200 MB  15%  ok
t+  78s   1200 MB  15%  ok
t+  81s   1200 MB  15%  ok
t+  84s   1200 MB  15%  ok
t+  87s   1200 MB  15%  ok
t+  90s   1200 MB  15%  ok
t+  93s   1200 MB  15%  ok
t+  96s   1200 MB  15%  ok
t+  99s   1200 MB  15%  ok
t+ 102s   1200 MB  15%  ok
t+ 105s   1200 MB  15%  ok
t+ 108s   1200 MB  15%  ok
t+ 111s   1200 MB  15%  ok
t+ 114s   1200 MB  15%  ok
t+ 117s   1200 MB  15%  ok
t+ 120s   1200 MB  15%  ok
t+ 123s   1200 MB  15%  ok
t+ 126s   1200 MB  15%  ok
t+ 129s   1200 MB  15%  ok
t+ 132s   1200 MB  15%  ok
t+ 135s   1200 MB  15%  ok
t+ 138s   1200 MB  15%  ok
t+ 141s   1200 MB  15%  ok
t+ 144s   1200 MB  15%  ok
t+ 147s   1200 MB  15%  ok
t+ 150s   1200 MB  15%  ok
t+ 153s   1200 MB  15%  ok
t+ 156s   1200 MB  15%  ok
t+ 159s   1200 MB  15%  ok
t+ 162s   1200 MB  15%  ok
t+ 165s   1200 MB  15%  ok
t+ 168s   1200 MB  15%  ok
t+ 171s   1200 MB  15%  ok
t+ 174s   1200 MB  15%  ok
t+ 177s   1200 MB  15%  ok
```

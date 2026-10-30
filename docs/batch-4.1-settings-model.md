# Batch 4.1 — settings panel (model + validation)

Generated: 2026-10-30T03:45:10.053Z

Acceptance: **Round-trip every field; invalid → inline error.**

## Checks

```
PASS  the field table covers all six tabs
PASS  every field declares a §4 path, a key and a help line
PASS  keys are unique
PASS  round-trip: aiBridge.providers.list
PASS  round-trip: aiBridge.browser.ports
PASS  round-trip: aiBridge.custom.providers
PASS  round-trip: aiBridge.adapter.id
PASS  round-trip: aiBridge.router.strategy
PASS  round-trip: aiBridge.router.retries
PASS  round-trip: aiBridge.router.backoff
PASS  round-trip: aiBridge.chat.debounceMs
PASS  round-trip: aiBridge.router.failover
PASS  round-trip: aiBridge.rotation.enabled
PASS  round-trip: aiBridge.rotation.preview
PASS  round-trip: aiBridge.compressor.enabled
PASS  round-trip: aiBridge.compressor.tier
PASS  round-trip: aiBridge.compressor.budgetTokens
PASS  round-trip: aiBridge.compressor.glossary
PASS  round-trip: aiBridge.t1.mode
PASS  round-trip: aiBridge.t1.backend
PASS  round-trip: aiBridge.t1.model
PASS  round-trip: aiBridge.t1.minRamGb
PASS  round-trip: aiBridge.state.location
PASS  round-trip: aiBridge.state.maxSnapshots
PASS  round-trip: aiBridge.state.encrypt
PASS  round-trip: aiBridge.state.snapshotEvery
PASS  round-trip: aiBridge.repo.contextMode
PASS  round-trip: aiBridge.repo.context
PASS  round-trip: aiBridge.repo.edits
PASS  round-trip: aiBridge.ramCap.browser
PASS  round-trip: aiBridge.ramCap.extension
PASS  round-trip: aiBridge.watchdog.pollMs
PASS  round-trip: aiBridge.ui.lowEndMode
PASS  round-trip: aiBridge.ui.statusBar
PASS  round-trip: aiBridge.ui.showCompressionPreview
PASS  round-trip: aiBridge.bridge.port
PASS  round-trip: aiBridge.bridge.autostart
PASS  invalid value refused inline: aiBridge.bridge.port = 99999
PASS  invalid value refused inline: aiBridge.bridge.port = "not-a-number"
PASS  invalid value refused inline: aiBridge.ramCap.browser = 5
PASS  invalid value refused inline: aiBridge.router.retries = 2.5
PASS  invalid value refused inline: aiBridge.compressor.tier = "T9"
PASS  invalid value refused inline: aiBridge.t1.model = "   "
PASS  invalid value refused inline: aiBridge.browser.ports = "[70000]"
PASS  invalid value refused inline: aiBridge.providers.list = "[{\"id\":\"x\"}]"
PASS  invalid value refused inline: aiBridge.providers.list = "not json"
PASS  invalid value refused inline: aiBridge.state.location = "cloud"
PASS  an invalid value leaves the previous value intact
PASS  a rejected edit does not disturb the stored value
PASS  a read-only field is refused with a clear message
PASS  §4 protectCode cannot be turned off
PASS  an unknown key is reported rather than silently ignored
PASS  reset restores that tab to defaults
PASS  reset leaves other tabs alone
PASS  typing does not write on every keystroke
PASS  the last value is written once after the debounce
PASS  disposing flushes a pending write
PASS  readSettings returns the complete §4 shape
PASS  readAll is a superset that still carries every §4 value
PASS  the panel state carries values, errors and live data
PASS  an action runs and reports status
PASS  a failing action reports the failure instead of throwing
```

Result: 62/62 passed.

## Fields round-tripped: 34

| config key | wrote | read back | §4 path |
|---|---|---|---|
| `aiBridge.providers.list` | [{"id":"chatgpt","enabled":true,"priority":1,"cooldownMs":60000}] | [{"id":"chatgpt","enabled":true,"priority":1,"cooldownMs":60000}] | [{"id":"chatgpt","enabled":true,"priority":1,"cooldownMs":60000}] |
| `aiBridge.browser.ports` | [9333] | [9333] | [9333] |
| `aiBridge.custom.providers` | [{"id":"mychat","label":"My Chat","url":"https://mychat.example/","selectors":{"composer":{"primary":"#ask"},"send":{"primary":"#go"}}}] | [{"id":"mychat","label":"My Chat","url":"https://mychat.example/","selectors":{"composer":{"primary":"#ask"},"send":{"primary":"#go"}}}] | [{"id":"mychat","label":"My Chat","url":"https://mychat.example/","selectors":{"composer":{"primary":"#ask"},"send":{"primary":"#go"}}}] |
| `aiBridge.adapter.id` | "chatgpt" | "chatgpt" | "chatgpt" |
| `aiBridge.router.strategy` | "round-robin" | "round-robin" | "round-robin" |
| `aiBridge.router.retries` | 3 | 3 | 3 |
| `aiBridge.router.backoff` | "linear" | "linear" | "linear" |
| `aiBridge.chat.debounceMs` | 950 | 950 | 950 |
| `aiBridge.router.failover` | false | false | false |
| `aiBridge.rotation.enabled` | false | false | false |
| `aiBridge.rotation.preview` | "always" | "always" | "always" |
| `aiBridge.compressor.enabled` | false | false | false |
| `aiBridge.compressor.tier` | "T0" | "T0" | "T0" |
| `aiBridge.compressor.budgetTokens` | 4224 | 4224 | 4224 |
| `aiBridge.compressor.glossary` | {"the extension host":"EH"} | {"the extension host":"EH"} | {"the extension host":"EH"} |
| `aiBridge.t1.mode` | "on" | "on" | "on" |
| `aiBridge.t1.backend` | "llamacpp" | "llamacpp" | "llamacpp" |
| `aiBridge.t1.model` | "llama3.2-alt" | "llama3.2-alt" | "llama3.2-alt" |
| `aiBridge.t1.minRamGb` | 9 | 9 | 9 |
| `aiBridge.state.location` | "global" | "global" | "global" |
| `aiBridge.state.maxSnapshots` | 11 | 11 | 11 |
| `aiBridge.state.encrypt` | false | false | false |
| `aiBridge.state.snapshotEvery` | 11 | 11 | 11 |
| `aiBridge.repo.contextMode` | "always" | "always" | "always" |
| `aiBridge.repo.context` | false | false | false |
| `aiBridge.repo.edits` | false | false | false |
| `aiBridge.ramCap.browser` | 550 | 550 | 550 |
| `aiBridge.ramCap.extension` | 1088 | 1088 | 1088 |
| `aiBridge.watchdog.pollMs` | 3500 | 3500 | 3500 |
| `aiBridge.ui.lowEndMode` | "on" | "on" | "on" |
| `aiBridge.ui.statusBar` | false | false | false |
| `aiBridge.ui.showCompressionPreview` | false | false | false |
| `aiBridge.bridge.port` | 47616 | 47616 | 47616 |
| `aiBridge.bridge.autostart` | false | false | false |

## Invalid values refused

```
aiBridge.bridge.port = 99999  →  matches /at most 65535/
aiBridge.bridge.port = "not-a-number"  →  matches /Must be a number/
aiBridge.ramCap.browser = 5  →  matches /at least 100/
aiBridge.router.retries = 2.5  →  matches /whole number/
aiBridge.compressor.tier = "T9"  →  matches /Must be one of/
aiBridge.t1.model = "   "  →  matches /Cannot be empty/
aiBridge.browser.ports = "[70000]"  →  matches /not a valid port/
aiBridge.providers.list = "[{\"id\":\"x\"}]"  →  matches /enabled must be true or false/
aiBridge.providers.list = "not json"  →  matches /Not valid JSON/
aiBridge.state.location = "cloud"  →  matches /Must be one of/
```

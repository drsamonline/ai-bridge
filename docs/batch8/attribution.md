# Attribution and port map

## Upstream

**AI Free VSCode** — <https://github.com/AppsGanin/ai-free-vscode>
Commit `6f53bad24073ed4b1d93213d432947f55d86764b`, version 0.10.4, MIT.

```
MIT License

Copyright (c) 2026 AppsGanin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

This repository is PolyForm Noncommercial 1.0.0. MIT is permissive and imposes no
copyleft, so MIT code may be incorporated here; the notice above and the file
map below must travel with the incorporated parts. Each ported file also carries
a header naming its upstream source.

## File map

Mode is one of:

- **ported** — structure and logic taken over, edited for our types and host.
- **adapted** — the idea and the hard-won constants taken, the code rewritten.
- **reference** — read for the policy; no code taken.

| Our file | Upstream | Mode | What changed |
|---|---|---|---|
| `bridge/src/api/stream.ts` | `src/providers/common/stream.ts` | ported | Idle timeout per read kept; boundary detection now handles `\r\n\r\n` as well as `\n\n`; `ReadOptions` carries our provider id |
| `bridge/src/api/errors.ts` | `src/providers/common/http.ts` | adapted | `vscode`-free; `retry-after` accepts an HTTP date as well as seconds (upstream: seconds only); `errToString` inlined |
| `bridge/src/api/types.ts` | `src/providers/types.ts`, `src/providers/openai/customConfig.ts` | adapted | `vscode`-free; the `custom:<provider>/<model>` namespacing is kept verbatim in spirit; tokens default 128k in / 8k out |
| `bridge/src/api/openaiCompat.ts` | `src/providers/openai/OpenAICompatApiClient.ts` | adapted | `fetch` injectable for tests; tool-call accumulation by index; usage chunks surfaced |
| `bridge/src/api/registry.ts` | `src/providers/openai/OpenAICompatProvider.ts`, `customConfig.ts` | adapted | Model cache keyed on base URL (their trick, kept); keys in memory + env only, never on disk |
| `test/api-openai.cjs` | `test/providers/openai.test.ts` | reference | Their canned-stream idea; rewritten as a real loopback server so the socket path is exercised |
| *(8.1)* `bridge/src/protocol/*` | `src/providers/common/ToolCalling.ts`, `StreamingToolCallRouter.ts`, `responseAssembler.ts` | planned port | Sink becomes bridge bus events; marker list and hold constants kept |
| *(8.2)* `extension/src/lm/*` | `src/vscode/VSCodeLMAdapter.ts`, `UnifiedProvider.ts` | planned adaptation | Host seam kept; our bridge client behind it |
| *(8.3)* `extension/src/features/*` | `src/vscode/CommitMessageGenerator.ts`, `InlineCompletionProvider.ts`, `FixProblemProvider.ts` | planned adaptation | Per-feature model + capability flags |
| *(8.4)* router | `src/providers/common/http.ts`, `rejectedAuth.ts` | planned | `retryAfterMs` into the router's cooldown |
| *(9.0)* fast path | `src/providers/qwen/QwenApiClient.ts`, `QwenBrowserBridge.ts` | reference | Policy only: direct → challenge → replay in the real session |

## Not taken

`src/providers/common/browserAuth.ts` (persistent-profile launcher), `stealth.ts`
(we drive the user's own Chrome, already trusted), `src/vscode/SettingsPanel.ts`,
`dsh-plugin/`, `esbuild.js` provider toggles (we may add later for VSIX size),
`src/providers/zai/ZaiBrowserBridge.ts` (their DOM-driven provider — instructive,
but our adapters already do this job).

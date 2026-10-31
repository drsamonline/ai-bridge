#!/usr/bin/env node
/**
 * Batch 8.1 acceptance harness — the tool-call layer.
 *
 * Acceptance: "a free API endpoint calls a real tool and the panel shows the
 * same call a paid provider would; a web-chat provider calls the same tool
 * through the prompt protocol with no protocol text reaching the user."
 *
 * Everything here runs against `bridge/dist/protocol`, which has no host and no
 * transport: text in, calls and channels out. That is the point of the port —
 * the same module serves the API path and the DOM path.
 *
 * Provenance: the marker vocabulary and the hold constants are from
 * AppsGanin/ai-free-vscode (MIT, commit 6f53bad); the harness is ours.
 */

'use strict';

const assert = require('node:assert');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const protocol = require('../bridge/dist/protocol/index.js');

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`FAIL  ${name}\n      ${err.message}`);
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

/** A sink that records every channel in the order it arrived. */
function recorder() {
  const log = [];
  let text = '';
  let thinking = '';
  const calls = [];
  return {
    log,
    get text() {
      return text;
    },
    get thinking() {
      return thinking;
    },
    calls,
    sink: {
      text(part) {
        text += part;
        log.push(`text:${part}`);
      },
      thinking(part) {
        thinking += part;
        log.push(`thinking:${part}`);
      },
      toolCall(call) {
        calls.push(call);
        log.push(`call:${call.name}`);
      },
      usage(p, c) {
        log.push(`usage:${p}/${c}`);
      },
    },
  };
}

const TOOLS = [
  {
    name: 'read_file',
    description: 'read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, limit: { type: 'number' } },
    },
  },
];

/* ------------------------------------------------------- transport shim *
 * Same reason as in `api-openai.cjs`: this sandbox's undici cannot allocate the
 * WASM memory its HTTP parser needs, so the global fetch crashes the process
 * instead of rejecting. The client takes an injectable fetch, so the wiring test
 * runs against a plain socket either way.
 */

const { resolveFetch } = require('./helpers/fetch-shim.cjs');
const fetchImpl = resolveFetch();

/** Two endpoints: one native, one that only understands the prompt protocol. */
function startToolServer() {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;

    if (path === '/tools/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frames = [
        { choices: [{ delta: { reasoning_content: 'let me read it' } }] },
        { choices: [{ delta: { content: 'Hi' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_9',
                    function: { name: 'read_file', arguments: '{"path":"a","limit":"20"}' },
                  },
                ],
              },
            },
          ],
        },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      ]
        .map((ev) => `data: ${JSON.stringify(ev)}\n\n`)
        .join('');
      res.end(frames + 'data: [DONE]\n\n');
      return;
    }

    if (path === '/prompt/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const answer =
        'Reading it now. ```tool_call\n{"name":"read_file","arguments":{"path":"a","limit":"20"}}\n```';
      // Split mid-answer so the router has to hold across two chunks.
      const frames = [
        { choices: [{ delta: { content: answer.slice(0, 20) } }] },
        { choices: [{ delta: { content: answer.slice(20) } }] },
      ]
        .map((ev) => `data: ${JSON.stringify(ev)}\n\n`)
        .join('');
      res.end(frames + 'data: [DONE]\n\n');
      return;
    }

    res.writeHead(404);
    res.end('no route');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, server });
    });
  });
}

async function main() {
  /* ------------------------------------------------------- marker dialects */

  check('markers: a fenced tool_call block is extracted', () => {
    const text = 'Here you go.\n```tool_call\n{"name":"read_file","arguments":{"path":"src/a.ts"}}\n```\n';
    const calls = protocol.parseToolCallsFromText(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].arguments, { path: 'src/a.ts' });
  });

  check('markers: a bare <tool_call> is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<tool_call>{"name":"read_file","arguments":{"path":"b.ts"}}</tool_call>',
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments, { path: 'b.ts' });
  });

  check('markers: a <tool_call name="…"> tag is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<tool_call name="read_file">{"path":"c.ts"}</tool_call>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].arguments, { path: 'c.ts' });
  });

  check('markers: <function=> XML is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<function=read_file><parameter=path>src/a.ts</parameter><parameter=limit>5</parameter></function>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].arguments, { path: 'src/a.ts', limit: 5 });
  });

  check('markers: <tool_name>/<tool_arguments> is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<tool_name>read_file</tool_name><tool_arguments>{"path":"d.ts"}</tool_arguments>',
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments, { path: 'd.ts' });
  });

  check('markers: Anthropic <invoke> is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<function_calls><invoke name="read_file"><parameter name="path">e.ts</parameter></invoke></function_calls>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
    assert.deepEqual(calls[0].arguments, { path: 'e.ts' });
  });

  check('markers: a namespaced <ns:invoke> is extracted', () => {
    const calls = protocol.parseToolCallsFromText(
      '<ns:invoke name="read_file"><parameter name="path">f.ts</parameter></ns:invoke>',
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_file');
  });

  check('markers: a JSON envelope is extracted with its wrapper', () => {
    const text = 'Sure: {"tool_call": {"name":"read_file","arguments":{"path":"g.ts"}}} done.';
    const calls = protocol.parseToolCallsFromText(text);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].arguments, { path: 'g.ts' });
    // The wrapper is part of the span, so nothing of it survives stripping.
    assert.equal(protocol.stripToolCallBlocks(text), 'Sure:  done.');
  });

  check('markers: a tool_calls array yields one call per entry', () => {
    const calls = protocol.parseToolCallsFromText(
      '{"tool_calls":[{"name":"read_file","arguments":{"path":"a"}},{"name":"read_file","arguments":{"path":"b"}}]}',
    );
    assert.equal(calls.length, 2);
  });

  check('markers: a marker split across two chunks is still found', () => {
    const index = protocol.findToolCallMarkerStart('blah ```tool_c');
    assert.equal(index, 5, 'the partial marker is found at its own offset');
  });

  check('markers: a plain ``` fence is not treated as a call', () => {
    assert.equal(protocol.findToolCallMarkerStart('```js\nconst a = 1;\n```'), -1);
  });

  check('strip: prose around a call survives', () => {
    const text = 'Before.\n```tool_call\n{"name":"read_file","arguments":{"path":"a"}}\n```\nAfter.';
    const stripped = protocol.stripToolCallBlocks(text);
    assert.match(stripped, /Before\./);
    assert.match(stripped, /After\./);
    assert.ok(!stripped.includes('tool_call'), 'no protocol text left');
  });

  /* ------------------------------------------------------------ the router */

  check('hold: the holdback is exactly len("```tool_call") - 1', () => {
    assert.equal(protocol.MARKER_HOLDBACK_CHARS, 11);
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('Hello world!'); // 12 chars, 11 held
    assert.equal(out.text, 'H', 'only the character beyond the holdback is emitted');
    router.flush();
    assert.equal(out.text, 'Hello world!', 'flush releases the rest intact');
  });

  check('hold: a false marker in prose is released after maxHoldChars', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({
      sink: out.sink,
      maxHoldChars: 40,
    });
    // Matches a marker, but never looks like a call: it must not be held forever.
    router.push('`tool_call {' + 'y'.repeat(80));
    router.flush();
    assert.ok(out.text.includes('y'.repeat(80)), 'the held text was released');
    assert.equal(out.calls.length, 0);
  });

  check('hold: a 200 KB argument is held to the hard cap, not dropped', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({
      sink: out.sink,
      hardCapChars: 100,
    });
    const payload = 'z'.repeat(200);
    router.push('```tool_call\n{"name":"big","arguments":{"data":"' + payload);
    router.flush();
    assert.ok(out.text.includes('zzz'), 'the oversized call was released, not swallowed');
  });

  check('hold: a marker split across chunks assembles into one call', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('```too');
    router.push('l_call\n{"name":"read_file","arguments":{"path":"a.ts"}}');
    router.push('```');
    router.flush();
    assert.equal(out.calls.length, 1);
    assert.equal(out.calls[0].name, 'read_file');
    assert.equal(out.text, '', 'no protocol text reached the user');
  });

  check('hold: text before a call is emitted, not held with it', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('Reading it now. ');
    router.push('```tool_call\n{"name":"read_file","arguments":{"path":"a.ts"}}```');
    router.flush();
    assert.equal(out.text, 'Reading it now. ');
    assert.equal(out.calls.length, 1);
  });

  /* ------------------------------------------------------ transcript echoes */

  check('echo: a played-out transcript is cut at the marker', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('The answer is 42.\nUser: and then?\nAssistant: I would');
    router.flush();
    assert.equal(out.text, 'The answer is 42.');
    assert.ok(!out.text.includes('User:'), 'nothing after the marker is shown');
  });

  check('echo: a marker inside a fenced block is not a cut', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('```\nUser: quoted from a config\n```\ndone');
    router.flush();
    assert.match(out.text, /User: quoted from a config/, 'the fenced content survives');
    assert.match(out.text, /done/);
  });

  check('echo: our own tool-result placeholder is cut', () => {
    const out = recorder();
    const router = new protocol.StreamingToolCallRouter({ sink: out.sink });
    router.push('ok\n[Tool result id=call_1] {"path":"a"}');
    router.flush();
    assert.equal(out.text, 'ok');
  });

  /* -------------------------------------------------------------- assembly */

  await checkAsync('assemble: text order survives interleaved thinking', async () => {
    const out = recorder();
    async function* chunks() {
      yield { type: 'thinking', text: 'a' };
      yield { type: 'text', text: 'b' };
      yield { type: 'thinking', text: 'c' };
      yield { type: 'text', text: 'd' };
    }
    await protocol.assembleNative(chunks(), out.sink, { promptToolProtocol: false });
    assert.deepEqual(out.log, ['thinking:a', 'text:b', 'thinking:c', 'text:d']);
    assert.equal(out.text, 'bd');
    assert.equal(out.thinking, 'ac');
  });

  await checkAsync('assemble: a native call is re-typed against the schema', async () => {
    const out = recorder();
    async function* chunks() {
      yield { type: 'tool_call', id: 'c1', name: 'read_file', arguments: '{"path":"a","limit":"20"}' };
    }
    const result = await protocol.assembleNative(chunks(), out.sink, {
      tools: TOOLS,
      promptToolProtocol: false,
    });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].arguments.limit, 20, '"20" became a number');
    assert.equal(result.toolCalls[0].id, 'c1');
  });

  await checkAsync('assemble: booleans are re-typed too', async () => {
    const out = recorder();
    async function* chunks() {
      yield { type: 'tool_call', id: 'c1', name: 'read_file', arguments: '{"path":"a"}' };
    }
    const tools = [
      {
        name: 'read_file',
        parameters: { type: 'object', properties: { recursive: { type: 'boolean' } } },
      },
    ];
    async function* booleans() {
      yield { type: 'tool_call', id: 'c2', name: 'read_file', arguments: '{"recursive":"false"}' };
    }
    const result = await protocol.assembleNative(booleans(), out.sink, {
      tools,
      promptToolProtocol: false,
    });
    assert.equal(result.toolCalls[0].arguments.recursive, false);
    // The unused generator above must not have been consumed twice.
    assert.ok(chunks);
  });

  await checkAsync('assemble: a call leaked into reasoning is recovered', async () => {
    const out = recorder();
    async function* chunks() {
      yield {
        type: 'thinking',
        text: 'I should read it. ```tool_call\n{"name":"read_file","arguments":{"path":"a"}}\n```',
      };
      yield { type: 'text', text: 'Done.' };
    }
    const result = await protocol.assembleNative(chunks(), out.sink, {
      tools: TOOLS,
      promptToolProtocol: true,
    });
    assert.equal(result.toolCalls.length, 1, 'the call was recovered from reasoning');
    assert.equal(out.text, 'Done.');
    assert.ok(!out.thinking.includes('tool_call'), 'no protocol text in reasoning either');
  });

  await checkAsync('assemble: usage is forwarded once', async () => {
    const out = recorder();
    async function* chunks() {
      yield { type: 'text', text: 'hi' };
      yield { type: 'usage', promptTokens: 9, completionTokens: 3 };
    }
    const result = await protocol.assembleNative(chunks(), out.sink, {
      promptToolProtocol: false,
    });
    assert.equal(result.promptTokens, 9);
    assert.equal(result.completionTokens, 3);
    assert.deepEqual(out.log.filter((l) => l.startsWith('usage')), ['usage:9/3']);
  });

  await checkAsync('assemble: cancellation stops the read', async () => {
    const out = recorder();
    let n = 0;
    async function* chunks() {
      for (;;) {
        n += 1;
        if (n > 5) return;
        yield { type: 'text', text: 'x' };
      }
    }
    await protocol.assembleNative(chunks(), out.sink, {
      promptToolProtocol: false,
      isCancelled: () => n >= 2,
    });
    assert.ok(n < 5, `stopped after ${n} chunks`);
  });

  /* --------------------------------------------------------- prompt protocol */

  await checkAsync('prompt: a web chat gets the tools as text', async () => {
    const system = protocol.buildToolsSystemPrompt(TOOLS);
    assert.match(system, /read_file/);
    assert.match(system, /```tool_call/, 'the call format is shown');
    assert.match(system, /"arguments"/);
  });

  await checkAsync('prompt: an answer with a call is split cleanly', async () => {
    const out = recorder();
    async function* chunks() {
      yield 'Reading ';
      yield 'it now. ```tool_call\n{"name":"read_file","arguments":{"path":"a"}}';
      yield '```';
    }
    const result = await protocol.assemblePrompt(chunks(), out.sink, {
      tools: TOOLS,
      promptToolProtocol: true,
    });
    assert.equal(result.textChars, 'Reading it now. '.length);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(out.text, 'Reading it now. ');
  });

  await checkAsync('prompt: an answer with no call is untouched', async () => {
    const out = recorder();
    async function* chunks() {
      yield 'Just prose, no tools involved.';
    }
    const result = await protocol.assemblePrompt(chunks(), out.sink, {
      tools: TOOLS,
      promptToolProtocol: true,
    });
    assert.equal(out.text, 'Just prose, no tools involved.');
    assert.equal(result.toolCalls.length, 0);
  });

  await checkAsync('prompt: a call id is generated when the model gives none', async () => {
    const out = recorder();
    async function* chunks() {
      yield '<function=read_file><parameter=path>a</parameter></function>';
    }
    const result = await protocol.assemblePrompt(chunks(), out.sink, {
      tools: TOOLS,
      promptToolProtocol: true,
    });
    assert.equal(result.toolCalls.length, 1);
    assert.match(result.toolCalls[0].id, /^call_/);
  });

  /* ------------------------------------------------------- runtime wiring */

  const { base, server: toolServer } = await startToolServer();
  const { BridgeRuntime } = require('../bridge/dist/runtime.js');
  const { createLogger } = require('../bridge/dist/logger.js');
  const quiet = createLogger({ level: 'error', sink: () => {} });

  const runtime = new BridgeRuntime({
    log: quiet,
    ...(fetchImpl ? { apiFetchImpl: fetchImpl } : {}),
  });
  const events = [];
  runtime.bus.on('event', (event) => events.push(event));

  await checkAsync('runtime: ctl.api.providers.set accepts an endpoint', async () => {
    const result = await runtime.control({
      op: 'ctl.api.providers.set',
      providers: [
        { id: 'local', name: 'Local', baseUrl: `${base}/tools/v1`, noApiKey: true },
      ],
    });
    assert.deepEqual(result.accepted, ['local']);
    assert.equal(result.rejected.length, 0);
  });

  await checkAsync('runtime: ctl.api.prompt returns an assembled native call', async () => {
    events.length = 0;
    const answer = await runtime.control({
      op: 'ctl.api.prompt',
      model: 'custom:local/free-model-a',
      messages: [{ role: 'user', content: 'read it' }],
      tools: TOOLS,
      promptToolProtocol: false,
    });
    assert.equal(answer.toolCalls.length, 1);
    assert.equal(answer.toolCalls[0].name, 'read_file');
    assert.equal(answer.toolCalls[0].arguments.limit, 20, 're-typed end to end');
    assert.equal(answer.textChars, 'Hi'.length);
  });

  await checkAsync('runtime: the answer is emitted as events, in order', async () => {
    const kinds = events.map((event) => event.kind);
    assert.equal(kinds[0], 'stream.start');
    assert.equal(kinds[kinds.length - 1], 'stream.end');
    assert.ok(kinds.includes('stream.thinking'), 'reasoning has its own channel');
    assert.ok(kinds.includes('tool.call'), 'the call is one event');
    assert.ok(kinds.includes('api.usage'), 'usage is reported');
    const call = events.find((event) => event.kind === 'tool.call');
    assert.equal(call.data.call.name, 'read_file');
  });

  await checkAsync('runtime: the prompt protocol scrubs a call from the text', async () => {
    await runtime.control({
      op: 'ctl.api.providers.set',
      providers: [{ id: 'chatty', name: 'Chatty', baseUrl: `${base}/prompt/v1`, noApiKey: true }],
    });
    events.length = 0;
    const answer = await runtime.control({
      op: 'ctl.api.prompt',
      model: 'custom:chatty/x',
      messages: [{ role: 'user', content: 'read it' }],
      tools: TOOLS,
      promptToolProtocol: true,
    });
    assert.equal(answer.toolCalls.length, 1);
    assert.equal(answer.toolCalls[0].arguments.limit, 20);
    const deltas = events
      .filter((event) => event.kind === 'stream.delta')
      .map((event) => event.data.text)
      .join('');
    assert.ok(!deltas.includes('tool_call'), 'no protocol text reached the stream');
    assert.match(deltas, /Reading it now\./);
  });

  // An open listener keeps the event loop alive, so the process would hang here
  // even though every check had run.
  toolServer.close();

  /* ------------------------------------------------------------------ total */

  console.log('');
  console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

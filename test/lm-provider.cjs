#!/usr/bin/env node
/**
 * Batch 8.2 acceptance harness — the Copilot Chat provider.
 *
 * Acceptance: "an ai-bridge provider is selectable in Copilot Chat, streams an
 * answer, and a tool call round-trips through Copilot's own tools."
 *
 * Only `extension/dist/lm/provider.js` is exercised, on purpose: it is the part
 * with the logic, and it has no `vscode` import, so the harness needs no editor.
 * The `vscode` glue in `register.js` is thin and cannot be loaded outside an
 * extension host.
 */

'use strict';

const assert = require('node:assert');
const providerModule = require('../extension/dist/lm/provider.js');

const results = [];
let failures = 0;

async function check(name, fn) {
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

/** Parts the editor would build, as plain objects. */
const parts = {
  text: (value) => ({ kind: 'text', text: value }),
  thinking: (value) => ({ kind: 'thinking', text: value }),
  toolCall: (callId, name, input) => ({ kind: 'toolCall', callId, name, input }),
};

const API_MODEL = {
  id: 'custom:groq/llama-3.3-70b',
  label: 'llama-3.3-70b',
  kind: 'api',
  maxInputTokens: 128000,
  maxOutputTokens: 8192,
  toolCalling: true,
  source: 'groq',
};

const API_TEXT_ONLY = {
  id: 'custom:local/tiny',
  label: 'tiny',
  kind: 'api',
  maxInputTokens: 32000,
  maxOutputTokens: 4096,
  toolCalling: false,
  source: 'local',
};

const DOM_MODEL = {
  id: 'dom:chatgpt',
  label: 'ChatGPT (tab)',
  kind: 'dom',
  maxInputTokens: 100000,
  maxOutputTokens: 8000,
  toolCalling: false,
  source: 'chatgpt',
};

/** A bridge that records what it was asked and answers from a script. */
function fakeBridge(models, script) {
  const seen = [];
  return {
    seen,
    async listModels() {
      return models;
    },
    async ask(request) {
      seen.push(request);
      return script(request);
    },
  };
}

function makeProvider(bridge) {
  return new providerModule.AiBridgeLanguageModelProvider({ bridge, parts });
}

const userMessage = (text) => ({ role: 1, content: [{ value: text }] });

async function main() {
  /* ------------------------------------------------------------ runtime gate */

  await check('gate: an editor without the API is not an error', () => {
    assert.equal(providerModule.canRegisterLanguageModelProvider(undefined), false);
    assert.equal(providerModule.canRegisterLanguageModelProvider({}), false);
    assert.equal(providerModule.lmRegistrar({}), undefined);
  });

  await check('gate: an editor with the API registers', () => {
    const api = { registerLanguageModelChatProvider: () => ({ dispose() {} }) };
    assert.equal(providerModule.canRegisterLanguageModelProvider(api), true);
    assert.equal(typeof providerModule.lmRegistrar(api), 'function');
  });

  await check('gate: a non-function registrar is treated as absent', () => {
    assert.equal(
      providerModule.canRegisterLanguageModelProvider({
        registerLanguageModelChatProvider: 'nope',
      }),
      false,
    );
  });

  /* ------------------------------------------------------------------ models */

  await check('models: endpoints and tabs are both listed, and distinguishable', async () => {
    const provider = makeProvider(fakeBridge([API_MODEL, DOM_MODEL], async () => ({
      text: '',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    })));
    const list = await provider.provideLanguageModelChatInformation();
    assert.equal(list.length, 2);
    const api = list.find((m) => m.id === API_MODEL.id);
    const dom = list.find((m) => m.id === DOM_MODEL.id);
    assert.equal(api.family, 'AI Bridge endpoint');
    assert.equal(dom.family, 'AI Bridge tab');
    assert.equal(api.maxInputTokens, 128000);
    assert.match(dom.detail, /tab: chatgpt/);
  });

  await check('models: tool calling is offered only where it exists', async () => {
    const provider = makeProvider(fakeBridge([API_MODEL, DOM_MODEL], async () => ({
      text: '',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    })));
    const list = await provider.provideLanguageModelChatInformation();
    assert.equal(list.find((m) => m.id === API_MODEL.id).capabilities.toolCalling, true);
    assert.equal(
      list.find((m) => m.id === DOM_MODEL.id).capabilities.toolCalling,
      false,
      'the DOM path has no tool channel, so Copilot must not offer one',
    );
  });

  await check('models: a bridge that cannot list yields an empty picker, not a throw', async () => {
    const provider = makeProvider({
      async listModels() {
        throw new Error('bridge down');
      },
      async ask() {
        throw new Error('unused');
      },
    });
    assert.deepEqual(await provider.provideLanguageModelChatInformation(), []);
  });

  /* ---------------------------------------------------------------- response */

  await check('response: streamed text reaches the editor in order', async () => {
    const bridge = fakeBridge([API_MODEL], async (request) => {
      request.onText('Hel');
      request.onText('lo');
      return { text: 'Hello', thinking: '', toolCalls: [], cancelled: false };
    });
    const provider = makeProvider(bridge);
    const reported = [];
    await provider.provideLanguageModelChatResponse(
      API_MODEL.id,
      [userMessage('hi')],
      { tools: [] },
      { report: (part) => reported.push(part) },
      { isCancellationRequested: false },
    );
    const text = reported.filter((p) => p.kind === 'text').map((p) => p.text).join('');
    assert.equal(text, 'Hello', 'the answer appears exactly once');
    assert.equal(reported.length, 2, 'two streamed parts, no repetition at the end');
  });

  await check('response: a buffered answer is reported once', async () => {
    const bridge = fakeBridge([DOM_MODEL], async () => ({
      text: 'the whole answer',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    }));
    const provider = makeProvider(bridge);
    const reported = [];
    await provider.provideLanguageModelChatResponse(
      DOM_MODEL.id,
      [userMessage('hi')],
      {},
      { report: (part) => reported.push(part) },
      { isCancellationRequested: false },
    );
    assert.equal(reported.length, 1);
    assert.equal(reported[0].text, 'the whole answer');
  });

  await check('response: reasoning has its own channel', async () => {
    const bridge = fakeBridge([API_MODEL], async (request) => {
      request.onThinking?.('weighing');
      request.onText('answer');
      return { text: 'answer', thinking: 'weighing', toolCalls: [], cancelled: false };
    });
    const provider = makeProvider(bridge);
    const reported = [];
    await provider.provideLanguageModelChatResponse(
      API_MODEL.id,
      [userMessage('hi')],
      { tools: [] },
      { report: (part) => reported.push(part) },
      { isCancellationRequested: false },
    );
    assert.equal(reported[0].kind, 'thinking');
    assert.equal(reported[1].kind, 'text');
  });

  await check('response: a tool call becomes a tool-call part', async () => {
    const bridge = fakeBridge([API_MODEL], async () => ({
      text: 'reading',
      thinking: '',
      toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { path: 'src/a.ts' } }],
      cancelled: false,
    }));
    const provider = makeProvider(bridge);
    const reported = [];
    await provider.provideLanguageModelChatResponse(
      API_MODEL.id,
      [userMessage('read it')],
      { tools: [{ name: 'read_file', inputSchema: { type: 'object' } }] },
      { report: (part) => reported.push(part) },
      { isCancellationRequested: false },
    );
    const call = reported.find((part) => part.kind === 'toolCall');
    assert.ok(call, 'the call was reported');
    assert.equal(call.name, 'read_file');
    assert.deepEqual(call.input, { path: 'src/a.ts' });
  });

  await check('response: a cancelled answer reports nothing', async () => {
    const bridge = fakeBridge([API_MODEL], async () => ({
      text: 'partial',
      thinking: '',
      toolCalls: [],
      cancelled: true,
    }));
    const provider = makeProvider(bridge);
    const reported = [];
    await provider.provideLanguageModelChatResponse(
      API_MODEL.id,
      [userMessage('hi')],
      { tools: [] },
      { report: (part) => reported.push(part) },
      { isCancellationRequested: true },
    );
    assert.equal(reported.length, 0);
  });

  await check('response: an unknown model is a clear error', async () => {
    const provider = makeProvider(fakeBridge([API_MODEL], async () => ({})));
    await assert.rejects(
      () =>
        provider.provideLanguageModelChatResponse(
          'custom:gone/x',
          [userMessage('hi')],
          {},
          { report() {} },
          { isCancellationRequested: false },
        ),
      /ENOMODEL/,
    );
  });

  /* -------------------------------------------------------- tool protocol */

  await check('protocol: a tool-capable endpoint takes tools natively', async () => {
    const bridge = fakeBridge([API_MODEL], async () => ({
      text: '',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    }));
    await makeProvider(bridge).provideLanguageModelChatResponse(
      API_MODEL.id,
      [userMessage('hi')],
      { tools: [{ name: 'read_file', inputSchema: { type: 'object' } }] },
      { report() {} },
      { isCancellationRequested: false },
    );
    assert.equal(bridge.seen[0].promptToolProtocol, false);
    assert.equal(bridge.seen[0].tools.length, 1);
  });

  await check('protocol: an endpoint without tools gets the prompt protocol', async () => {
    const bridge = fakeBridge([API_TEXT_ONLY], async () => ({
      text: '',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    }));
    await makeProvider(bridge).provideLanguageModelChatResponse(
      API_TEXT_ONLY.id,
      [userMessage('hi')],
      { tools: [{ name: 'read_file' }] },
      { report() {} },
      { isCancellationRequested: false },
    );
    assert.equal(bridge.seen[0].promptToolProtocol, true);
  });

  await check('protocol: a web chat always gets the prompt protocol', async () => {
    const bridge = fakeBridge([DOM_MODEL], async () => ({
      text: 'ok',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    }));
    await makeProvider(bridge).provideLanguageModelChatResponse(
      DOM_MODEL.id,
      [userMessage('hi')],
      {},
      { report() {} },
      { isCancellationRequested: false },
    );
    assert.equal(bridge.seen[0].promptToolProtocol, true);
  });

  /* -------------------------------------------------------------- messages */

  await check('messages: roles are normalised and parts flattened', async () => {
    const bridge = fakeBridge([API_MODEL], async () => ({
      text: '',
      thinking: '',
      toolCalls: [],
      cancelled: false,
    }));
    await makeProvider(bridge).provideLanguageModelChatResponse(
      API_MODEL.id,
      [
        { role: 1, content: [{ value: 'first' }] },
        { role: 2, content: [{ value: 'second' }] },
        { role: 1, content: [{ value: 'third' }] },
      ],
      { tools: [] },
      { report() {} },
      { isCancellationRequested: false },
    );
    const sent = bridge.seen[0].messages;
    assert.deepEqual(sent.map((m) => m.role), ['user', 'assistant', 'user']);
    assert.deepEqual(sent.map((m) => m.parts[0].text), ['first', 'second', 'third']);
  });

  await check('messages: a tool result keeps its call id', () => {
    const messages = providerModule.toMessages([
      { role: 1, content: [{ callId: 'call_9', content: 'file contents' }] },
    ]);
    assert.equal(messages[0].parts[0].kind, 'toolResult');
    assert.equal(messages[0].parts[0].callId, 'call_9');
  });

  await check('messages: a prompt string ends with the assistant turn', () => {
    const text = providerModule.toPromptText([
      { role: 'user', parts: [{ kind: 'text', text: 'hello' }] },
      { role: 'assistant', parts: [{ kind: 'text', text: 'hi' }] },
    ]);
    assert.match(text, /^User: hello/);
    assert.match(text, /Assistant:$/);
  });

  /* ------------------------------------------------------------ token count */

  await check('count: a token estimate is reported and labelled as one', async () => {
    const provider = makeProvider(fakeBridge([API_MODEL], async () => ({})));
    assert.equal(await provider.provideTokenCount(API_MODEL.id, ''), 0);
    assert.equal(await provider.provideTokenCount(API_MODEL.id, 'abcd'), 1);
    assert.equal(await provider.provideTokenCount(API_MODEL.id, 'a'.repeat(400)), 100);
    assert.equal(providerModule.countTokens('x'), 1, 'never zero for a non-empty string');
  });

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

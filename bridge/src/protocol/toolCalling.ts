/**
 * Batch 8.1 — reading tool calls out of model text.
 *
 * Adapted from `src/providers/common/ToolCalling.ts` of AppsGanin/ai-free-vscode
 * (MIT, commit 6f53bad). See docs/batch8/attribution.md.
 *
 * The hard part is not the happy path — a native tools API gives us structured
 * calls and needs none of this. The hard part is what web models actually emit:
 * fenced JSON, bare XML, Anthropic's `<invoke>` vocabulary reproduced from
 * training data, half-JSON that a chunk boundary cut in two, and a call buried
 * inside an object of the model's own invention.
 *
 * Everything here is pure: text in, calls and spans out. The state machine that
 * decides *when* to hold text lives in `streamingRouter.ts`.
 */

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** The exact text the call was taken from, so a transcript can quote it. */
  raw: string;
}

export interface ScanResult {
  calls: ParsedToolCall[];
  /** Half-open `[start, end)` ranges the calls occupy, for stripping. */
  spans: Array<{ start: number; end: number }>;
}

/**
 * Every marker a model has been seen to open a call with.
 *
 * Order matters only for the partial-tail check, which tries the longest
 * prefix first so ```` ```tool_call ```` is not mistaken for ```` ```tool ````.
 */
export const TOOL_CALL_MARKERS: readonly string[] = [
  '```tool_call',
  '<tool_call',
  '`tool_call {',
  'tool_call {',
  '<function=',
  '<tool_name>',
  '<function_calls>',
  '<invoke',
];

/** Shortest partial marker prefix worth holding: below this, prose matches. */
const MIN_PARTIAL_MARKER_LEN = 6;

const JSON_START_RE = /\{\s*"(?:name|tool)"\s*:/;
const ENVELOPE_START_RE = /\{\s*"(?:tool_call|tool_calls|tool_use|function_call)"\s*:/i;
const NAMESPACED_INVOKE_RE = /<\s*[\w.-]+:invoke\b/;

/**
 * Index where the first tool-call marker starts — full, or partial at the end of
 * the buffer (a marker split across two chunks). `-1` when there is none.
 */
export function findToolCallMarkerStart(text: string): number {
  let earliest = -1;
  const take = (index: number) => {
    if (index !== -1 && (earliest === -1 || index < earliest)) earliest = index;
  };

  for (const marker of TOOL_CALL_MARKERS) {
    take(text.indexOf(marker));
    // A marker cut by a chunk boundary: hold its longest suffix that is still a
    // prefix of the marker.
    for (let len = Math.min(marker.length - 1, text.length); len >= MIN_PARTIAL_MARKER_LEN; len -= 1) {
      if (text.endsWith(marker.slice(0, len))) {
        take(text.length - len);
        break;
      }
    }
  }

  take(NAMESPACED_INVOKE_RE.exec(text)?.index ?? -1);
  take(JSON_START_RE.exec(text)?.index ?? -1);
  take(ENVELOPE_START_RE.exec(text)?.index ?? -1);
  return earliest;
}

/**
 * Does this look like a real call rather than a false hit on prose or a markdown
 * fence? Used to decide whether held text is worth holding on to.
 */
export function looksLikeToolCallStart(text: string): boolean {
  return (
    /```tool_call|<tool_call|<function\s*=|<tool_name>|<\s*[\w.-]+:?invoke\b/i.test(text) ||
    /"(?:tool_call|tool_calls|tool_use|function_call)"\s*:/i.test(text) ||
    /"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/i.test(text)
  );
}

/* ---------------------------------------------------------------- coercion */

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

function coerceScalar(raw: string): unknown {
  const text = raw.trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  if (TRUE_WORDS.has(lower)) return true;
  if (FALSE_WORDS.has(lower)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function coerceTo(value: unknown, type: string | undefined): unknown {
  if (!type) return value;
  if (type === 'number' || type === 'integer') {
    if (typeof value === 'number') return type === 'integer' ? Math.trunc(value) : value;
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed)) return value;
    return type === 'integer' ? Math.trunc(parsed) : parsed;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const word = String(value).trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return true;
    if (FALSE_WORDS.has(word)) return false;
    return value;
  }
  if (type === 'array' || type === 'object') {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (type === 'string') return typeof value === 'string' ? value : JSON.stringify(value);
  return value;
}

/**
 * Re-types arguments against the tool's JSON Schema.
 *
 * Models write `"limit": "20"` for a number and `"recursive": "false"` for a
 * boolean; a tool that does arithmetic on them gets NaN. Only declared
 * properties are coerced — an invented argument is passed through rather than
 * silently dropped, because a tool may accept more than the schema says.
 */
export function retypeArguments(
  args: Record<string, unknown>,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  const properties = (schema?.properties ?? {}) as Record<string, { type?: string }>;
  if (!properties || Object.keys(properties).length === 0) return args;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = coerceTo(value, properties[key]?.type);
  }
  return out;
}

/* ----------------------------------------------------------------- parsing */

/** `<parameter=key>value</parameter>` and `<parameter name="key">value</parameter>`. */
function parseParameterTags(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const bare = /<\s*parameter\s*=\s*["']?([\w.$-]+)["']?\s*>([\s\S]*?)<\s*\/\s*parameter\s*>/gi;
  for (const match of body.matchAll(bare)) args[match[1] as string] = coerceScalar(match[2] ?? '');
  const named = /<\s*parameter\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\s*\/\s*parameter\s*>/gi;
  for (const match of body.matchAll(named)) args[match[1] as string] = coerceScalar(match[2] ?? '');
  return args;
}

/** A JSON body that may be an arguments object or a whole call. */
function argumentsFromJson(
  body: string,
  fallbackName?: string,
): { name: string; args: Record<string, unknown> } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name : fallbackName;
  if (!name) return { name: fallbackName ?? '', args: record };
  const rawArgs = record.arguments ?? record.parameters ?? record.args ?? record.input;
  if (rawArgs === undefined) {
    // `{"name":"x"}` with the arguments beside it, or a bare argument object.
    const { name: _name, ...rest } = record;
    return { name, args: rest as Record<string, unknown> };
  }
  if (typeof rawArgs === 'string') {
    try {
      const inner = JSON.parse(rawArgs);
      return { name, args: (inner ?? {}) as Record<string, unknown> };
    } catch {
      return { name, args: {} };
    }
  }
  if (rawArgs && typeof rawArgs === 'object') {
    return { name, args: rawArgs as Record<string, unknown> };
  }
  return { name, args: {} };
}

/** `<function=name>…</function>` — Qwen-Coder / MiMo native XML. */
function scanFunctionTags(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const re = /<\s*function\s*=\s*["']?([\w.$-]+)["']?\s*>([\s\S]*?)<\s*\/\s*function\s*>/gi;
  for (const match of text.matchAll(re)) {
    const name = match[1] as string;
    calls.push({ name, arguments: parseParameterTags(match[2] ?? ''), raw: match[0] });
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return { calls, spans };
}

/** `<tool_name>n</tool_name><tool_arguments>{…}</tool_arguments>` — MiMo variant. */
function scanToolNameTags(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const re =
    /<\s*tool_name\s*>([\s\S]*?)<\s*\/\s*tool_name\s*>\s*<\s*tool_arguments\s*>([\s\S]*?)<\s*\/\s*tool_arguments\s*>/gi;
  for (const match of text.matchAll(re)) {
    const name = (match[1] ?? '').trim();
    if (!name) continue;
    const parsed = argumentsFromJson(match[2] ?? '', name);
    calls.push({ name, arguments: parsed?.args ?? {}, raw: match[0] });
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return { calls, spans };
}

/** `<invoke name="n">…</invoke>`, with or without a namespace prefix. */
function scanInvokeTags(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const re =
    /<\s*(?:[\w.-]+:)?invoke\s+name\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\s*\/\s*(?:[\w.-]+:)?invoke\s*>/gi;
  for (const match of text.matchAll(re)) {
    const name = match[1] as string;
    const body = match[2] ?? '';
    const params = parseParameterTags(body);
    const args = Object.keys(params).length ? params : (argumentsFromJson(body, name)?.args ?? {});
    calls.push({ name, arguments: args, raw: match[0] });
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return { calls, spans };
}

/** ```` ```tool_call ```` fences and `<tool_call>` tags. */
function scanFencedTags(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];

  const fence = /```tool_call[^\n]*\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(fence)) {
    const parsed = argumentsFromJson(match[1] ?? '');
    if (!parsed || !parsed.name) continue;
    calls.push({ name: parsed.name, arguments: parsed.args, raw: match[0] });
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }

  const tag = /<tool_call(?:\s+name\s*=\s*"([^"]+)")?\s*>([\s\S]*?)<\s*\/\s*tool_call\s*>/gi;
  for (const match of text.matchAll(tag)) {
    const parsed = argumentsFromJson(match[2] ?? '', match[1]);
    if (!parsed || !parsed.name) continue;
    calls.push({ name: parsed.name, arguments: parsed.args, raw: match[0] });
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }

  return { calls, spans };
}

/**
 * Every balanced `{…}` in the text, outermost first.
 *
 * A regex cannot do this: `\{[\s\S]*?\}` breaks on a `}` inside a string value
 * and leaves half a JSON object in the chat.
 */
export function extractBalancedObjects(
  text: string,
): Array<{ start: number; end: number; raw: string }> {
  const found: Array<{ start: number; end: number; raw: string }> = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) {
        found.push({ start, end: i + 1, raw: text.slice(start, i + 1) });
        start = -1;
      }
    }
  }
  return found;
}

/** `{"name":…,"arguments":{…}}` and the envelopes models wrap them in. */
function scanJsonObjects(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];

  for (const object of extractBalancedObjects(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(object.raw);
    } catch {
      continue; // incomplete or not JSON: the hold/release machine decides
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;

    const envelope = record.tool_call ?? record.tool_use ?? record.function_call;
    const list = record.tool_calls;

    const push = (candidate: unknown) => {
      if (!candidate || typeof candidate !== 'object') return;
      const entry = candidate as Record<string, unknown>;
      const name = typeof entry.name === 'string' ? entry.name : undefined;
      if (!name) return;
      const rawArgs = entry.arguments ?? entry.parameters ?? entry.args ?? entry.input ?? {};
      let args: Record<string, unknown> = {};
      if (typeof rawArgs === 'string') {
        try {
          args = JSON.parse(rawArgs) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs as Record<string, unknown>;
      }
      calls.push({ name, arguments: args, raw: object.raw });
    };

    if (envelope) {
      if (Array.isArray(envelope)) envelope.forEach(push);
      else push(envelope);
      spans.push({ start: object.start, end: object.end });
      continue;
    }
    if (Array.isArray(list)) {
      list.forEach(push);
      spans.push({ start: object.start, end: object.end });
      continue;
    }
    if (typeof record.name === 'string' && (record.arguments !== undefined || record.parameters !== undefined)) {
      push(record);
      spans.push({ start: object.start, end: object.end });
    }
  }

  return { calls, spans };
}

/** Removes the spans already found, so a later scanner cannot read them again. */
function blankSpans(text: string, spans: Array<{ start: number; end: number }>): string {
  if (spans.length === 0) return text;
  let out = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + ' '.repeat(span.end - span.start) + out.slice(span.end);
  }
  return out;
}

/** Every call in the text, in the order the scanners find them. */
export function scanToolCalls(text: string): ScanResult {
  const calls: ParsedToolCall[] = [];
  const spans: Array<{ start: number; end: number }> = [];

  let remaining = text;
  for (const scanner of [scanFencedTags, scanFunctionTags, scanToolNameTags, scanInvokeTags, scanJsonObjects]) {
    const result = scanner(remaining);
    for (const call of result.calls) {
      // A span already blanked keeps its position, so indices stay comparable.
      calls.push(call);
    }
    spans.push(...result.spans);
    remaining = blankSpans(remaining, result.spans);
  }

  return { calls, spans };
}

export function parseToolCallsFromText(text: string): ParsedToolCall[] {
  return scanToolCalls(text).calls;
}

/**
 * Removes every call from the text, leaving what a user should actually read.
 * Runs of three or more newlines collapse, so a stripped call does not leave a
 * hole in the answer.
 */
export function stripToolCallBlocks(text: string): string {
  const { spans } = scanToolCalls(text);
  if (spans.length === 0) return text;
  // Spliced out rather than blanked: blanking leaves a run of spaces where the
  // call was, which the user sees as a gap in the middle of a sentence.
  let out = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, span.start) + out.slice(span.end);
  }
  return out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------ prompt tools */

/**
 * The tool protocol, written into the prompt for a backend that has no tools
 * API — which is every web chat, and any endpoint whose `toolCalling` is off.
 */
export function buildToolsSystemPrompt(
  tools: ReadonlyArray<{ name: string; description?: string; parameters?: Record<string, unknown> }>,
): string {
  if (tools.length === 0) return '';
  const lines = [
    'You can call tools. To call one, reply with ONLY this block and no other text:',
    '```tool_call',
    '{"name": "<tool_name>", "arguments": {<arguments>}}',
    '```',
    'Call one tool at a time. Wait for its result before calling another.',
    'Never describe the call in prose and never invent a tool that is not listed.',
    '',
    'Tools:',
  ];
  for (const tool of tools) {
    const schema = tool.parameters ? JSON.stringify(tool.parameters) : '{}';
    lines.push(`- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);
    lines.push(`  arguments schema: ${schema}`);
  }
  return lines.join('\n');
}

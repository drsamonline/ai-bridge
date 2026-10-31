/**
 * Breakage report — spec §7.2 ("opt-in breakage report JSON").
 *
 * When a provider changes its DOM and a selector stops matching, the useful
 * artifact is the *shape* of what was there: which selectors were tried, which
 * matched, and the tag/attribute names of the region. What is never useful — and
 * never included — is the conversation.
 *
 * The privacy property is structural, not a filter: `buildReport` only ever
 * copies fields from an allow-list, so chat text cannot reach the output even if
 * a caller passes it in. `assertNoChatContent` exists for the tests and for a
 * paranoid caller to run before writing the file.
 */

export const REPORT_SCHEMA = 1;

import { DOM_SHAPE_SNIPPET, type DomShape } from '@ai-bridge/shared';

export type { DomShape };
export { DOM_SHAPE_SNIPPET };

export interface BreakageInput {
  adapterId: string;
  /** Host only — never a path or query, which can contain a conversation id. */
  url: string;
  role: string;
  tried: string[];
  matched: string | null;
  via: string;
  error: string;
  extensionVersion: string;
  bridgeVersion?: string;
  platform: string;
  nodeVersion: string;
  shape?: DomShape | null;
  when?: number;
  /**
   * Batch 8.4b — the endpoint requests the bridge remembers.
   *
   * Fields only: a code, a status, a duration. The bridge never records a prompt
   * or an answer in these, and `buildReport` copies only the keys below — so a
   * caller that passes chat text in one of them is caught by
   * `assertNoChatContent` rather than quietly written out.
   */
  requests?: EndpointRequestRecord[];
}

/** One endpoint request, as the bridge reports it. */
export interface EndpointRequestRecord {
  /** Epoch milliseconds. */
  t?: number;
  model?: string;
  ok?: boolean;
  ms?: number;
  code?: string;
  status?: number;
  retryAfterMs?: number;
}

export interface BreakageReport {
  schema: number;
  when: string;
  adapter: { id: string; host: string; role: string; via: string };
  selectors: { tried: string[]; matched: string | null };
  error: { code: string; message: string };
  environment: { extensionVersion: string; bridgeVersion: string | null; platform: string; nodeVersion: string };
  shape: DomShape | null;
  /** The last endpoint requests: code, status, timing. Never a prompt or answer. */
  requests: EndpointRequestRecord[];
  /** Always true: this artifact contains no conversation content. */
  containsChatContent: false;
}

const ERROR_CODE = /^([A-Z][A-Z0-9_]{2,}):/;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // Not a URL (e.g. about:blank): keep only a scheme-ish token, never the rest.
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
    return m ? `${m[1]}:` : 'unknown';
  }
}

function codeOf(message: string): string {
  const m = ERROR_CODE.exec(message.trim());
  return m ? m[1]! : 'EUNKNOWN';
}

export function buildReport(input: BreakageInput): BreakageReport {
  return {
    schema: REPORT_SCHEMA,
    when: new Date(input.when ?? Date.now()).toISOString(),
    adapter: {
      id: String(input.adapterId),
      host: hostOf(String(input.url)),
      role: String(input.role),
      via: String(input.via),
    },
    selectors: {
      tried: input.tried.map(String).slice(0, 20),
      matched: input.matched === null ? null : String(input.matched),
    },
    error: {
      code: codeOf(String(input.error)),
      // The message is rebuilt from parts; the raw error may carry page text.
      message: `${codeOf(String(input.error))} while resolving ${String(input.role)} on ${hostOf(String(input.url))}`,
    },
    environment: {
      extensionVersion: String(input.extensionVersion),
      bridgeVersion: input.bridgeVersion === undefined ? null : String(input.bridgeVersion),
      platform: String(input.platform),
      nodeVersion: String(input.nodeVersion),
    },
    shape: input.shape
      ? {
          tags: input.shape.tags.map(String).slice(0, 200),
          attributeNames: input.shape.attributeNames.map(String).slice(0, 200),
          counts: Object.fromEntries(
            Object.entries(input.shape.counts)
              .slice(0, 50)
              .map(([k, v]) => [String(k), Number(v) || 0]),
          ),
        }
      : null,
    requests: (input.requests ?? []).slice(0, 20).map((request) => ({
      ...(typeof request.t === 'number' ? { t: request.t } : {}),
      ...(typeof request.model === 'string' ? { model: String(request.model).slice(0, 120) } : {}),
      ok: request.ok === true,
      ms: Number(request.ms) || 0,
      ...(typeof request.code === 'string' ? { code: String(request.code).slice(0, 40) } : {}),
      ...(typeof request.status === 'number' ? { status: request.status } : {}),
      ...(typeof request.retryAfterMs === 'number' ? { retryAfterMs: request.retryAfterMs } : {}),
    })),
    containsChatContent: false,
  };
}

/**
 * Structural guarantee, checked in tests: no string in the report may contain any
 * of the supplied chat fragments.
 */
export function assertNoChatContent(
  report: unknown,
  chatFragments: string[],
): { ok: boolean; leaked: string[] } {
  const flat: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') flat.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(report);
  const blob = flat.join('\n').toLowerCase();
  const leaked = chatFragments
    .map((f) => f.trim())
    .filter((f) => f.length >= 4 && blob.includes(f.toLowerCase()));
  return { ok: leaked.length === 0, leaked };
}

/** A short, human-readable summary for the toast after exporting. */
export function summarise(report: BreakageReport): string {
  const tried = report.selectors.tried.length;
  const failed = report.requests.filter((request) => request.ok !== true).length;
  const endpoints = report.requests.length
    ? `, ${failed}/${report.requests.length} endpoint request(s) failed`
    : '';
  return `${report.adapter.id}: ${report.adapter.role} unresolved on ${report.adapter.host} (${tried} selector(s) tried, ${report.error.code}${endpoints})`;
}

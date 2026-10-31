/**
 * Batch 9.0 — replaying a request inside the tab we already own.
 *
 * This is the half we are better placed for than the upstream project: they had
 * to launch a browser with a persistent profile to get a trusted session. We
 * attach to a tab the user opened and signed into, so `fetch` run inside that
 * page carries their cookies and their fingerprint without a stealth script.
 *
 * Two evaluates, not one: `start` returns as soon as the request is issued, and
 * `poll` drains whatever has arrived. Awaiting the fetch inside a single
 * evaluate would block the read loop until the answer was complete, which
 * defeats the point of streaming.
 */

import { ApiError } from '../api/errors';

/**
 * The slice of a playwright `Page` this needs — so a test can stand in for it.
 *
 * `evaluate` returns `unknown` on purpose: the result crosses a process boundary
 * as JSON, so it is asserted at the call site rather than trusted by the type.
 */
export interface ReplayPage {
  evaluate(pageFunction: (arg: never) => unknown, arg?: unknown): Promise<unknown>;
}

export interface ReplayRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ReplayOptions {
  pollMs?: number;
  /** Max time with nothing arriving. */
  idleTimeoutMs?: number;
  /** Max time for the whole replay. */
  totalTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface ReplayPoll {
  text: string;
  done: boolean;
  error: string | null;
  status: number | null;
}

const DEFAULT_POLL_MS = 50;
const DEFAULT_IDLE_MS = 30_000;
const DEFAULT_TOTAL_MS = 180_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Starts the request in the page and returns immediately.
 *
 * `credentials: 'include'` is the whole point: the browser attaches the cookies
 * the session already has, and the request is same-origin from the provider's
 * point of view.
 */
const START = (request: ReplayRequest): boolean => {
  const scope = window as unknown as Record<string, unknown>;
  const state = { text: '', done: false, error: null as string | null, status: null as number | null };
  scope.__aiBridgeReplay = state;

  void (async () => {
    try {
      const response = await fetch(request.url, {
        method: request.method || 'POST',
        headers: request.headers || {},
        ...(request.body !== undefined ? { body: request.body } : {}),
        credentials: 'include',
      });
      state.status = response.status;
      if (!response.body) {
        state.done = true;
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) state.text += decoder.decode(value, { stream: true });
      }
      state.text += decoder.decode();
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.done = true;
    }
  })();

  return true;
};

/** Drains what has arrived and reports whether the replay is finished. */
const POLL = (): ReplayPoll => {
  const scope = window as unknown as Record<string, { text: string; done: boolean; error: string | null; status: number | null } | undefined>;
  const state = scope.__aiBridgeReplay;
  if (!state) return { text: '', done: true, error: 'no collector in the page', status: null };
  const text = state.text;
  state.text = '';
  return { text, done: state.done, error: state.error, status: state.status };
};

/**
 * Replays `request` in `page`, yielding the answer as it arrives.
 *
 * A stalled replay fails on the idle timeout rather than holding a socket open —
 * the same rule the direct path follows, for the same reason.
 */
export async function* replayInPage(
  page: ReplayPage,
  request: ReplayRequest,
  opts: ReplayOptions = {},
): AsyncIterable<string> {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const totalMs = opts.totalTimeoutMs ?? DEFAULT_TOTAL_MS;

  const startedAt = Date.now();
  let lastActivity = startedAt;

  await page.evaluate(START as never, request);

  for (;;) {
    if (opts.signal?.aborted) return;

    const poll = (await page.evaluate(POLL as never)) as ReplayPoll;
    if (poll.text) {
      lastActivity = Date.now();
      yield poll.text;
    }

    if (poll.error) {
      throw new ApiError('EREPLAY', `replay failed: ${poll.error}`);
    }
    if (poll.done) return;

    const now = Date.now();
    if (now - lastActivity > idleMs) {
      throw new ApiError('EIDLE', `replay idle for ${idleMs} ms`);
    }
    if (now - startedAt > totalMs) {
      throw new ApiError('ETIMEOUT', `replay exceeded ${totalMs} ms`);
    }
    await sleep(pollMs);
  }
}

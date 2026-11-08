/**
 * The live Dispatch — batch 5.3, the seam the runner has been waiting for.
 *
 * Everything up to here was proven against a fake. This is the adapter that makes
 * a turn real: it assembles the §7 payload, resolves which provider and page a
 * participant speaks through, sends, and settles.
 *
 * Two rules it enforces that the runtime's own prompt path does not:
 *
 *  - failover stays inside the participant's declared provider set (§6), because
 *    a debate participant must not silently become a different model;
 *  - a participant with no page, or whose set is exhausted, throws a typed error
 *    the runner turns into a degrade, rather than falling back to another tab.
 *
 * NOT verified against a live chat UI. The sandbox this was written in can reach
 * neither chatgpt.com nor claude.ai, so the integration test is the readiness gate
 * in §21: it runs on a machine that is signed in, and until it does, this file is
 * reviewed code rather than proven code.
 */

import type { Adapter, Page } from '@ai-bridge/shared';
import type { AdapterRegistry } from '../adapters/registry';
import type { Logger } from '../logger';
import type { Relay } from './relay';
import type { Dispatch, DispatchRequest, DispatchResult } from './runner';
import { resolveParticipantProvider } from './scheduler';
import { buildPayload } from './payload';
import type { SettleBy } from './token';

export interface LiveDispatchDeps {
  relay: Pick<Relay, 'sendAndObserve'>;
  adapters: AdapterRegistry;
  /** The page a participant is speaking through, by participant index. */
  pageFor: (participant: number) => Page | null;
  /** Router cooldown and the rotator's budget. Defaults to "everything is available". */
  available?: (provider: string) => boolean;
  log: Logger;
  debounceMs?: number;
  timeoutMs?: number;
  /** Stream events, so the shell can render progress. */
  onStream?: (kind: string, data: unknown) => void;
}

const SETTLES: readonly SettleBy[] = ['sentinel', 'stop-gone', 'debounce', 'timeout', 'no-stream'];

const asSettle = (value: string): SettleBy =>
  (SETTLES as readonly string[]).includes(value) ? (value as SettleBy) : 'no-stream';

export function createLiveDispatch(deps: LiveDispatchDeps): Dispatch {
  return async function dispatch(req: DispatchRequest): Promise<DispatchResult> {
    const payload = buildPayload({
      role: req.participant.role,
      planText: req.planText,
      contextText: req.contextText,
      questionsText: req.questionsText,
      snapshotText: req.snapshotText,
      retry: req.retry,
    });

    if (payload.truncated) {
      deps.log.warn('turn payload truncated to fit §7 caps', {
        participant: req.participant.index,
        blocks: payload.blocks.filter((b) => b.truncated).map((b) => b.name),
      });
    }

    // §6: the provider comes from the participant's own set, never from the
    // router's global chain.
    const choice = resolveParticipantProvider(
      { index: req.participant.index, role: req.participant.role, providers: req.participant.providers },
      deps.available ?? (() => true),
    );
    if (!choice.ok) {
      throw new Error(`EPROVIDER: ${req.participant.index} exhausted ${choice.attempted.join(', ')}`);
    }

    const page = deps.pageFor(req.participant.index);
    if (!page) throw new Error(`ENOTAB: participant ${req.participant.index} has no leased tab`);

    const adapter: Adapter = await deps.adapters.get(choice.provider);
    if (!(await adapter.isReady(page))) await adapter.connect(page);

    const limit = await adapter.detectLimit(page);
    if (limit.limited) {
      const when = limit.resetAt ? ` (resets ${new Date(limit.resetAt).toISOString()})` : '';
      throw new Error(`ELIMIT: ${choice.provider} is ${limit.kind ?? 'limited'}${when}`);
    }

    const result = await deps.relay.sendAndObserve(adapter, page, payload.text, {
      ...(deps.debounceMs !== undefined ? { debounceMs: deps.debounceMs } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      adapterId: choice.provider,
      phase: 'prompt',
      push: deps.onStream ?? (() => {}),
    });

    deps.log.info('turn dispatched', {
      participant: req.participant.index,
      provider: choice.provider,
      bytes: payload.bytes,
      settledBy: result.settledBy,
      chars: result.text.length,
    });

    return { text: result.text, settledBy: asSettle(result.settledBy) };
  };
}

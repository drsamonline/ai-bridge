/**
 * Session rotation — spec §5.1 / §5.9.
 *
 *   detectLimit() per adapter; on limit → boot → new page → inject
 *   ✅ Simulated limit → context preserved, preview shown
 *
 * The orchestration lives here, behind ports, so the whole flow can be driven
 * with fakes and also against a real browser. The order matters and is fixed:
 *
 *   1. confirm the limit (a rotation on a hunch throws away a good page)
 *   2. build the boot from state — this is what "context preserved" means
 *   3. show the editable preview (§6: Boot Preview is visible on failover)
 *   4. open a NEW page (the old one is limit-bound; reusing it defeats the point)
 *   5. inject the boot, and check the fresh chat restated it (retry once, §2.3)
 *
 * If the ack fails the rotation is still reported as done — a page is open and
 * the user can carry on — but `contextPreserved` is false, because it is.
 */

export type RotationTrigger = 'limit' | 'manual';

export interface LimitInfo {
  limited: boolean;
  kind?: 'quota' | 'rate' | 'error' | string;
  resetAt?: number;
}

export interface RotationPorts {
  /** §5.1: per-adapter limit probe. */
  detectLimit(): Promise<LimitInfo>;
  /** The ≤4k continuation prompt built from project state. */
  buildBoot(): Promise<{ text: string; tokens: number; budgetTokens: number }>;
  /** Show the editable preview; resolve with the text to inject, or null to cancel. */
  preview?(boot: string, meta: { tokens: number; trigger: RotationTrigger }): Promise<string | null>;
  /** Close owned tabs and open a fresh one. */
  newPage(): Promise<{ id: string }>;
  /** Send the boot to the fresh page and return what came back. */
  inject(boot: string): Promise<string>;
  /** Did the fresh chat restate DOING/TODO? */
  ack(answer: string): { ok: boolean; found: string[]; missing: string[] };
  log(level: 'info' | 'warn' | 'error', msg: string): void;
}

export interface RotationResult {
  rotated: boolean;
  reason: string;
  previewShown: boolean;
  /** True when the user edited the boot before injecting. */
  edited: boolean;
  attempts: number;
  ackOk: boolean;
  contextPreserved: boolean;
  missing: string[];
  tokens: number;
  newTabId: string | null;
  tookMs: number;
  limit?: LimitInfo;
}

export interface RotationOptions {
  /** One retry, matching the bootstrap ack rule (§2.3). */
  maxRetries?: number;
  /** Show the editable preview before injecting (default true). */
  showPreview?: boolean;
}

export const RETRY_PREAMBLE =
  'Your previous reply did not restate the project state. Restate DOING and TODO exactly as listed, one bullet each, then continue.\n\n';

export class SessionRotator {
  constructor(
    private readonly ports: RotationPorts,
    private readonly opts: RotationOptions = {},
  ) {}

  async rotate(trigger: RotationTrigger = 'manual'): Promise<RotationResult> {
    const started = Date.now();
    const empty = (reason: string, extra: Partial<RotationResult> = {}): RotationResult => ({
      rotated: false,
      reason,
      previewShown: false,
      edited: false,
      attempts: 0,
      ackOk: false,
      contextPreserved: false,
      missing: [],
      tokens: 0,
      newTabId: null,
      tookMs: Date.now() - started,
      ...extra,
    });

    // 1. Confirm the limit before throwing a page away.
    const limit = await this.ports.detectLimit().catch((err: Error) => {
      this.ports.log('warn', `rotation: limit probe failed (${err.message})`);
      return { limited: false } as LimitInfo;
    });
    if (trigger === 'limit' && !limit.limited) {
      return empty('no limit detected — page kept');
    }
    this.ports.log(
      'info',
      trigger === 'limit'
        ? `rotation: limit detected (${limit.kind ?? 'unknown'}) — rotating`
        : 'rotation: requested manually',
    );

    // 2. The boot IS the preserved context.
    let boot: { text: string; tokens: number; budgetTokens: number };
    try {
      boot = await this.ports.buildBoot();
    } catch (err) {
      return empty(`could not build the boot: ${(err as Error).message}`, { limit });
    }
    if (!boot.text.trim()) {
      return empty('boot was empty — nothing to inject', { limit, tokens: boot.tokens });
    }

    // 3. Editable preview (§6: shown on failover).
    let text = boot.text;
    let previewShown = false;
    let edited = false;
    if (this.opts.showPreview !== false && this.ports.preview) {
      previewShown = true;
      const chosen = await this.ports.preview(boot.text, { tokens: boot.tokens, trigger });
      if (chosen === null) {
        this.ports.log('info', 'rotation: cancelled at the preview — page kept');
        return empty('cancelled at the boot preview', { limit, previewShown, tokens: boot.tokens });
      }
      edited = chosen !== boot.text;
      text = chosen;
      if (edited) this.ports.log('info', 'rotation: using the edited boot');
    }

    // 4. A fresh page. The limit-bound one cannot be reused.
    let tab: { id: string };
    try {
      tab = await this.ports.newPage();
    } catch (err) {
      return empty(`could not open a new page: ${(err as Error).message}`, {
        limit,
        previewShown,
        edited,
        tokens: boot.tokens,
      });
    }

    // 5. Inject, and check the fresh chat actually restated the state.
    const maxRetries = Math.max(0, this.opts.maxRetries ?? 1);
    let attempts = 0;
    let lastAck = { ok: false, found: [] as string[], missing: [] as string[] };

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      attempts = attempt;
      const prompt = attempt === 1 ? text : `${RETRY_PREAMBLE}${text}`;
      let answer: string;
      try {
        answer = await this.ports.inject(prompt);
      } catch (err) {
        this.ports.log('error', `rotation: injection failed on attempt ${attempt} (${(err as Error).message})`);
        if (attempt > maxRetries) {
          return {
            rotated: true,
            reason: `injected but the page errored: ${(err as Error).message}`,
            previewShown,
            edited,
            attempts,
            ackOk: false,
            contextPreserved: false,
            missing: [],
            tokens: boot.tokens,
            newTabId: tab.id,
            tookMs: Date.now() - started,
            limit,
          };
        }
        continue;
      }

      lastAck = this.ports.ack(answer);
      if (lastAck.ok) {
        this.ports.log(
          'info',
          `rotation: context preserved — restated ${lastAck.found.length} item(s) on attempt ${attempt}`,
        );
        break;
      }
      this.ports.log(
        'warn',
        `rotation: attempt ${attempt} did not restate ${lastAck.missing.length} item(s)`,
      );
    }

    return {
      rotated: true,
      reason: lastAck.ok
        ? `rotated; fresh chat restated ${lastAck.found.length} item(s)`
        : `rotated, but the fresh chat never restated the state (${lastAck.missing.length} missing)`,
      previewShown,
      edited,
      attempts,
      ackOk: lastAck.ok,
      contextPreserved: lastAck.ok,
      missing: lastAck.missing,
      tokens: boot.tokens,
      newTabId: tab.id,
      tookMs: Date.now() - started,
      limit,
    };
  }
}

/**
 * Batch 9.0 — which rung to try.
 *
 * Pure state: the rung that last worked for a provider is preferred next time,
 * and the cheapest available rung is tried first. Kept separate from the
 * transport so the preference can be tested without a browser or a socket.
 *
 * The point of remembering is cost. A provider that is always challenged should
 * be always on the DOM rung; re-learning that on every request would mean paying
 * a failed round trip each time.
 */

import { RUNG_ORDER, type Rung } from './types';

export interface RungStatus {
  providerId: string;
  /** The rung that last worked, if any. */
  rung: Rung | null;
  /** How many times each rung has answered. */
  answered: Record<Rung, number>;
  /** How many times each rung fell through to the next. */
  fellThrough: Record<Rung, number>;
}

function emptyCounts(): Record<Rung, number> {
  return { fast: 0, replay: 0, dom: 0 };
}

export class RungPolicy {
  private readonly state = new Map<
    string,
    { rung: Rung | null; answered: Record<Rung, number>; fellThrough: Record<Rung, number> }
  >();

  private entry(providerId: string) {
    let current = this.state.get(providerId);
    if (!current) {
      current = { rung: null, answered: emptyCounts(), fellThrough: emptyCounts() };
      this.state.set(providerId, current);
    }
    return current;
  }

  /**
   * The next rung to try, given what this provider can actually do.
   *
   * `available` is ordered cheapest-first by the caller's capability, not by us:
   * a provider with no template has no `fast` rung at all, and one with no tab
   * attached has no `replay` or `dom`.
   */
  choose(providerId: string, available: readonly Rung[]): Rung | undefined {
    if (available.length === 0) return undefined;
    const entry = this.entry(providerId);

    // The rung that worked last time wins, if it is still on offer.
    if (entry.rung && available.includes(entry.rung)) return entry.rung;

    // Otherwise the cheapest available, in the declared order.
    return RUNG_ORDER.find((rung) => available.includes(rung));
  }

  /** Records that `rung` produced an answer for this provider. */
  record(providerId: string, rung: Rung): void {
    const entry = this.entry(providerId);
    entry.rung = rung;
    entry.answered[rung] += 1;
  }

  /** Records that `rung` was tried and had to fall through. */
  recordFallThrough(providerId: string, rung: Rung): void {
    this.entry(providerId).fellThrough[rung] += 1;
  }

  status(): RungStatus[] {
    return [...this.state.entries()].map(([providerId, entry]) => ({
      providerId,
      rung: entry.rung,
      answered: { ...entry.answered },
      fellThrough: { ...entry.fellThrough },
    }));
  }

  reset(providerId?: string): void {
    if (providerId) this.state.delete(providerId);
    else this.state.clear();
  }
}

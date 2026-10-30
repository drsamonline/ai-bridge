/**
 * Delta-only transport — spec §6.2.
 *
 * After a boot is injected, a failover must not re-send the whole state: it sends
 * the boot plus only what changed since. This is the one place that composition
 * happens, so "all deltas present" is a property of a pure function.
 */

export const DELTA_HEADING = '## Since the boot';

export function composeBoot(boot: string, delta?: string): string {
  const base = boot.trimEnd();
  const d = (delta ?? '').trim();
  if (!d) return base;
  return `${base}\n\n${DELTA_HEADING}\n${d}`;
}

/** How many delta lines a composed payload carries (for logging/telemetry). */
export function deltaLineCount(delta?: string): number {
  const d = (delta ?? '').trim();
  if (!d) return 0;
  return d.split('\n').filter((l) => l.trim().length > 0).length;
}

/** Every delta line must appear verbatim in what was sent. */
export function deltaLinesPresent(composed: string, delta: string): { ok: boolean; missing: string[] } {
  const lines = delta
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const missing = lines.filter((l) => !composed.includes(l));
  return { ok: missing.length === 0, missing };
}

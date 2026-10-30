/**
 * Token counting, in one place.
 *
 * Deliberately conservative: the larger of chars/4 and words×1.35. A real
 * tokenizer usually returns less, so budgets enforced with this number are safe.
 * Lives in its own module so both the boot builder and the compressor share one
 * definition (and so the compressor's worker stays dependency-free).
 */

export function countTokens(text: string): number {
  if (!text) return 0;
  const chars = Math.ceil(text.length / 4);
  const words = text.trim().split(/\s+/).length;
  return Math.max(chars, Math.ceil(words * 1.35));
}

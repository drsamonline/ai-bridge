/**
 * The questions ledger — SPEC v6 §14.
 *
 * The auditor may ask things that only the user can answer. Until now those
 * questions existed only as prose in a turn: nothing collected them, nothing
 * blocked consensus on them, and the bundle had nothing to put in questions.md.
 *
 * One ambiguity in §14 is resolved here rather than at the call site, marked
 * DECISION. The section says both "non-empty open moves session to NEEDS_USER at
 * end of current turn" and "questions block gates consensus without halting
 * dispatch". Those cannot both hold: moving to NEEDS_USER *is* halting dispatch.
 * The second sentence is the one that describes a ledger rather than a second
 * ASK_USER, so an open question gates consensus and never halts a round in
 * progress. A session with open questions runs to its budget and hands the
 * questions to the user in the bundle, instead of stopping the debate to ask.
 */

export type QuestionStatus = 'open' | 'answered' | 'dropped';

export interface Question {
  id: string;
  round: number;
  askedBy: number;
  text: string;
  options?: string[];
  fallback?: string;
  status: QuestionStatus;
  answer?: string;
  dropReason?: string;
}

/**
 * A fenced `questions` block, one question per line:
 *
 *     ```questions
 *     Which database? | postgres | sqlite
 *     Do we keep the v1 endpoint? | yes | no
 *     ```
 *
 * The pipe-separated tail is options; anything after a second pipe would be a
 * default, which is not worth a grammar of its own until something needs it.
 */
export function parseQuestionsBlock(body: string): Array<{ text: string; options?: string[] }> {
  return (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [text, ...rest] = line.split('|').map((part) => part.trim());
      const options = rest.filter((part) => part.length > 0);
      return {
        text: text ?? '',
        ...(options.length > 0 ? { options } : {}),
      };
    })
    .filter((q) => q.text.length > 0);
}

export class QuestionLedger {
  private readonly entries: Question[] = [];

  /** Append-only: the same question asked twice in one round is recorded once. */
  add(round: number, askedBy: number, text: string, options?: string[]): Question {
    const existing = this.entries.find(
      (q) => q.round === round && q.askedBy === askedBy && q.text === text,
    );
    if (existing) return existing;

    const question: Question = {
      id: `q-${round}-${askedBy}-${this.entries.length + 1}`,
      round,
      askedBy,
      text,
      status: 'open',
      ...(options && options.length > 0 ? { options } : {}),
    };
    this.entries.push(question);
    return question;
  }

  /** Only the user answers. Nothing in a debate turn can close a question. */
  answer(id: string, answer: string): boolean {
    const question = this.entries.find((q) => q.id === id);
    if (!question || question.status !== 'open') return false;
    question.status = 'answered';
    question.answer = answer;
    return true;
  }

  /** Dropped entries are retained with a reason, never removed. */
  drop(id: string, reason: string): boolean {
    const question = this.entries.find((q) => q.id === id);
    if (!question || question.status !== 'open') return false;
    question.status = 'dropped';
    question.dropReason = reason;
    return true;
  }

  open(): Question[] {
    return this.entries.filter((q) => q.status === 'open');
  }

  all(): Question[] {
    return [...this.entries];
  }

  /** §14: a consensus claim with an open question is a question for the user. */
  blocksConsensus(): boolean {
    return this.open().length > 0;
  }

  toMarkdown(): string {
    const lines = ['# Questions', ''];
    if (this.entries.length === 0) {
      lines.push('The auditor asked nothing that needed an answer.');
      return `${lines.join('\n')}\n`;
    }
    for (const q of this.entries) {
      const options = q.options && q.options.length > 0 ? ` (${q.options.join(' / ')})` : '';
      lines.push(`- **${q.id}** — round ${q.round}, participant ${q.askedBy} — ${q.status}${options}`);
      lines.push(`  - ${q.text}`);
      if (q.answer) lines.push(`  - Answer: ${q.answer}`);
      if (q.dropReason) lines.push(`  - Dropped: ${q.dropReason}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

/* ------------------------------------------------------------------ *
 * Stall detection — §8
 * ------------------------------------------------------------------ */

/** Lowercased word tokens. Punctuation is noise for this comparison. */
export function words(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Jaccard similarity over word **trigrams**, 0..1.
 *
 * Trigrams rather than word sets, and this is the change that matters (D12). A word
 * set says "the same vocabulary", so a paraphrase scores high and a genuine repeat
 * scores no higher. Trigrams say "the same phrases in the same order", which is what
 * repetition actually looks like — and it is what every streaming loop detector
 * compares.
 *
 * Deterministic and local on purpose: an embedding would be neither, and the point of
 * the check is to catch a participant repeating itself, which is a property of the
 * text in front of us.
 */
/** Word trigrams of a reply, as a set. Falls back to the whole string when short. */
export function trigrams(text: string): Set<string> {
  const tokens = words(text);
  const out = new Set<string>();
  if (tokens.length < 3) {
    if (tokens.length > 0) out.add(tokens.join(' '));
    return out;
  }
  for (let i = 0; i <= tokens.length - 3; i += 1) {
    out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return out;
}

/** Normalised length, for the floor that keeps short agreements out of the check. */
export function normalisedLength(text: string): number {
  return words(text).join(' ').length;
}

export function jaccard(a: string, b: string): number {
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) if (setB.has(word)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Below this many characters a reply is not evidence of anything.
 *
 * The old check could fire on "No objection to this revision" said twice — two
 * near-identical strings and no stalling at all. Short agreement text is
 * near-identical by nature, which is why streaming detectors ignore short segments
 * entirely rather than tuning a threshold around them.
 */
export const STALL_MIN_CHARS = 120;

/**
 * 0.85 over trigrams, not 0.95 over word sets.
 *
 * The convention for near-duplicate comparison is 0.8–0.85, and it is only meaningful
 * once the comparison is positional. Raising it back to 0.95 over trigrams would mean
 * a repeat has to be almost verbatim, which misses the reshuffled-paragraph case this
 * exists to catch.
 */
export const STALL_THRESHOLD = 0.85;
/**
 * §8 says "two consecutive per side" in the older drafts; with a roster rather
 * than two camps, the honest reading is two consecutive turns by the *same*
 * participant that each repeat the turn before them. One repeat is a model being
 * terse; two is a participant that has stopped moving.
 */
export const STALL_RUNS = 2;

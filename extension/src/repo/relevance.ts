/**
 * Should the repo bundle be attached at all?
 *
 * The benchmark (docs/compression-bench.md) shows where the tokens really are:
 * compressing a chatty prompt saves ~30% of ~30 tokens, while a repo bundle is
 * 500–900 tokens on *every* prompt. Not sending a bundle that the question does
 * not need saves more than any amount of compressing it.
 *
 * This is a relevance gate, not a compressor: it decides whether the context is
 * worth its tokens, and says why.
 */

const CODE_EXT = /\b[\w./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|cs|rb|php|kt|swift|sh|sql|md|json|ya?ml|toml|css|scss|html|vue|svelte)\b/i;
// CamelCase, snake_case, CONSTANTS, a `call()`, or a backticked token.
const SYMBOL = /\b(?:[A-Za-z_]\w*[A-Z]\w*|[a-z]\w*_[a-z]\w*|[A-Z]{3,}_[A-Z0-9_]+)\b|\b[a-z_]\w*\(\)|`[^`\n]+`/;
const CODE_TALK = /\b(function|class|method|interface|module|package|import|export|refactor|rename|debug|error|exception|stack|traceback|compile|build|test|spec|migrate|api|endpoint|schema|query|regex|type|enum|hook|component|props|state)\b/i;
const TRIVIAL = /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|cool)[\s!.?]*$/i;

export interface Relevance {
  attach: boolean;
  reason: string;
}

export function contextWorthIt(query: string): Relevance {
  const q = query.trim();
  if (q.length === 0) return { attach: false, reason: 'empty query' };
  if (TRIVIAL.test(q)) return { attach: false, reason: 'pleasantry — no context needed' };

  const path = CODE_EXT.exec(q);
  if (path) return { attach: true, reason: `names a file (${path[0]})` };

  const sym = SYMBOL.exec(q);
  if (sym) return { attach: true, reason: `names a symbol (${sym[0]})` };

  const talk = CODE_TALK.exec(q);
  if (talk) return { attach: true, reason: `asks about code (${talk[0].toLowerCase()})` };

  return { attach: false, reason: 'no file, symbol or code term — context would be dead weight' };
}

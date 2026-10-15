/** Test-only support checker. It compares words, not meaning, and is not qualified to judge support.
 * It misses paraphrase (false unsupported) and accepts reworded falsehoods that reuse the source's words
 * (false supported); scope, attribution and most negation errors pass undetected. */
import { contentWords, wordTokens } from './text.js';

const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'nor', 'without', "isn't", "aren't", "wasn't", "weren't", "doesn't",
  "don't", "didn't", "cannot", "can't", "won't"]);
const numeric = token => /^\p{N}/u.test(token);

export function createLexicalSupportChecker({ supportedAt = 0.8, unsupportedBelow = 0.5 } = {}) {
  if (!(unsupportedBelow > 0 && unsupportedBelow <= supportedAt && supportedAt <= 1)) throw new Error('Invalid lexical support thresholds');
  return Object.freeze({
    id: 'reploid.lexical-overlap-test', version: '1', qualified: false,
    async check({ claim, source }) {
      const words = contentWords(claim), passage = new Set(wordTokens(source.passage));
      if (!words.length) return { verdict: 'unverified', reason: 'The claim has no checkable words.' };
      const missingNumbers = words.filter(word => numeric(word) && !passage.has(word));
      if (missingNumbers.length) return { verdict: 'unsupported', reason: `The source does not contain ${missingNumbers.join(', ')}.` };
      const negation = words.find(word => NEGATIONS.has(word) && !passage.has(word));
      if (negation) return { verdict: 'unverified', reason: `The claim says "${negation}" and the source does not.` };
      const found = words.filter(word => passage.has(word)).length, share = found / words.length;
      const reason = `${found} of ${words.length} claim words appear in the source.`;
      if (share >= supportedAt) return { verdict: 'supported', reason };
      return { verdict: share < unsupportedBelow ? 'unsupported' : 'unverified', reason };
    }
  });
}

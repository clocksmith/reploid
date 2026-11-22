import { confusableGroups } from './unicode/confusables.js';

// The judge runs outside inference. Never put the target or banned words in model input.
export const PROFILE = Object.freeze({
  modelId: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16',
  modelIdentity: 'sha256:cdda7ddc748f581e3c79b5067fc8647a20d43c7030644e0c48b1560a1ac30d7d',
  runtimeArchive: '73de585574bc4a290fb06e923c853b94f061726a446bc8481bdc2de4632f1449',
  system: "Answer the user's prompt directly. Return only the requested answer, without explanation.",
  maxOutputTokens: 16, temperature: 0, topK: 1, topP: 1, thinking: false, context: 'fresh',
});
/** Submitted turns per verified player per UTC day: room to learn from each answer without brute-force search. */
export const TURNS_PER_DAY = 5;
export const RULE_VERSION = 'reploid.daily-english/v1';

export function normalizeAnswer(output) {
  return output.trim().normalize('NFC').toLowerCase().replace(/\p{P}$/u, '');
}

export function scoreOutput(output, target) {
  return typeof output === 'string' && normalizeAnswer(output) === normalizeAnswer(target);
}

const wordsOf = value => value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [];
const withoutAccents = value => value.normalize('NFD').replace(/\p{M}/gu, '');
const fold = word => withoutAccents(word).toLowerCase();
const skeleton = new Map();
for (const [replacement, characters] of Object.entries(confusableGroups)) {
  for (const character of characters) skeleton.set(character, replacement);
}

export function bannedFor(target) {
  const words = wordsOf(target).map(fold);
  if (words.includes('resign')) words.push('resigns', 'resigned', 'resigning', 'resignation', 'resignations');
  return [...new Set(words)];
}

// Preserve both case-insensitive spelling and the visual form of a non-ASCII capital.
// Greek capital nu resembles N, while its lowercase form resembles v. Choosing just
// one conversion would miss a visually spelled word on either side of a case change.
function letterForms(letter) {
  const lower = letter.toLowerCase();
  const canonical = skeleton.get(lower) ?? lower;
  const visual = skeleton.get(letter);
  return visual && letter.codePointAt(0) > 127 && visual !== canonical ? [canonical, visual] : [canonical];
}

function containsBannedWord(words, target) {
  const compareWords = words.map(word => Array.from(withoutAccents(word), letterForms));
  const banned = bannedFor(target).map(word => Array.from(word, letter => skeleton.get(letter) ?? letter).join(''));
  // Only start and finish on whole word boundaries. Matching can continue through
  // separators, so both single letters and longer fragments can spell a banned word.
  for (let start = 0; start < words.length; start++) {
    let remaining = new Set(banned);
    for (let i = start; i < words.length && remaining.size; i++) {
      for (const forms of compareWords[i]) {
        const next = new Set();
        for (const suffix of remaining) {
          for (const form of forms) if (suffix.startsWith(form)) next.add(suffix.slice(form.length));
        }
        remaining = next;
        if (!remaining.size) break;
      }
      if (remaining.has('')) return true;
    }
  }
  return false;
}

export function judgePrompt(value, target) {
  if (typeof value !== 'string' || value.length > 1024) throw new Error('Enter a prompt of at most 240 characters.');
  const prompt = value.trim().normalize('NFC');
  const characters = [...prompt].length;
  if (!characters || characters > 240) throw new Error('Enter a prompt of 1 to 240 characters.');
  // Whitespace can separate words. Hidden controls, bidi overrides and invisible
  // formatting have no place in the displayed game move. Real script letters and marks do.
  if (/[\p{C}\p{Default_Ignorable_Code_Point}]/u.test(prompt.replace(/[\t\n\r]/g, ''))) {
    throw new Error('Remove invisible formatting or control characters from your prompt.');
  }
  const words = wordsOf(prompt);
  if (!words.length) throw new Error('Enter at least one word.');
  // Symbols can look like letters too (℮ → e). Check both readings so a visual
  // substitution can neither spell a target nor hide a literal banned word.
  const canonical = prompt.normalize('NFKC');
  const visual = canonical.replace(/[^\p{L}\p{N}]/gu, ch => skeleton.get(ch) ?? ch);
  if (containsBannedWord(words, target) || visual !== canonical && containsBannedWord(wordsOf(visual), target)) {
    throw new Error('Your prompt contains a banned word or a split spelling.');
  }
  return {prompt, words: words.length, characters};
}

export function dayUTC(now = Date.now()) { return new Date(now).toISOString().slice(0, 10); }

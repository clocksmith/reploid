/** Enforce docs/EMOJI.md: no emoji, and only approved pictographic symbols, in tracked source and documentation. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(?:[cm]?js|ts|css|html|md|json|txt|ya?ml|sh|svg)$/;
// Retained evidence records what was observed; the Doppler mirror is its own project's source.
const RECORDS = /^(?:artifacts|docs\/status|reports|shared\/vendor\/doppler)\//;
// Files where an emoji code point is data rather than decoration, with the reason.
const DATA = Object.freeze({
  'self/blueprints/0x00003B-dogs-cats-browser-parser.md': 'DOGS/CATS bundle markers are part of the bundle format this blueprint specifies'
});
// Unicode properties change between Node releases, so the ranges are pinned in JSON.
const RANGES = JSON.parse(readFileSync(path.join(ROOT, 'scripts/symbol-ranges.json'), 'utf8'));
const parseRanges = (list) => list.map((item) => {
  const [start, end = start] = item.split('..').map((value) => Number.parseInt(value, 16));
  return [start, end];
});
const PICTOGRAPHIC = parseRanges(RANGES.extendedPictographic);
const PRESENTATION = parseRanges(RANGES.emojiPresentation);
const within = (ranges, codePoint) => ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
const VARIATION_SELECTOR = 0xFE0F;

/** Every symbol listed in the policy's tables (first column, space-separated pairs included). */
export function approvedSymbols(policy) {
  const symbols = new Set();
  for (const line of policy.split('\n')) {
    const cell = line.match(/^\|\s*([^|]+?)\s*\|\s*U\+/u);
    if (cell) for (const token of cell[1].split(/\s+/u)) for (const symbol of token) symbols.add(symbol);
  }
  return symbols;
}

export function findEmoji({ root = ROOT, files } = {}) {
  const approved = approvedSymbols(readFileSync(path.join(root, 'docs/EMOJI.md'), 'utf8'));
  const listed = files || execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const violations = [];
  for (const file of listed) {
    if (!file || !TEXT.test(file) || RECORDS.test(file) || DATA[file]) continue;
    let text;
    try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, index) => {
      for (const symbol of line) {
        const codePoint = symbol.codePointAt(0);
        if (codePoint < 0xA9) continue;
        const emoji = codePoint === VARIATION_SELECTOR || within(PRESENTATION, codePoint);
        if (!emoji && (!within(PICTOGRAPHIC, codePoint) || approved.has(symbol))) continue;
        violations.push({ file, line: index + 1, symbol, kind: emoji ? 'emoji' : 'unapproved' });
      }
    });
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = findEmoji();
  if (violations.length) {
    console.error('[emoji] Use an approved symbol from docs/EMOJI.md instead of:');
    for (const { file, line, symbol, kind } of violations) {
      console.error(`- ${file}:${line} U+${symbol.codePointAt(0).toString(16).toUpperCase()} (${kind})`);
    }
    process.exitCode = 1;
  } else console.log('[emoji] Only approved symbols in tracked source and documentation');
}

/** Enforce docs/EMOJI.md: tracked source and documentation contain no emoji. */
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
// Emoji presentation, the emoji variation selector, and supplementary-plane pictographs.
const EMOJI = /\p{Emoji_Presentation}|\uFE0F|(?=\p{Extended_Pictographic})[\u{1F000}-\u{1FAFF}]/u;

export function findEmoji({ root = ROOT, files } = {}) {
  const listed = files || execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const violations = [];
  for (const file of listed) {
    if (!file || !TEXT.test(file) || RECORDS.test(file) || DATA[file]) continue;
    let text;
    try { text = readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    if (!EMOJI.test(text)) continue;
    text.split('\n').forEach((line, index) => {
      const match = line.match(EMOJI);
      if (match) violations.push({ file, line: index + 1, symbol: match[0] });
    });
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = findEmoji();
  if (violations.length) {
    console.error('[emoji] Use an approved symbol from docs/EMOJI.md instead of:');
    for (const { file, line, symbol } of violations) console.error(`- ${file}:${line} U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
    process.exitCode = 1;
  } else console.log('[emoji] No emoji in tracked source or documentation');
}

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { approvedSymbols, findEmoji } from '../../scripts/verify-emoji.js';

const POLICY = [
  '| Symbol | Code | HTML Entity | Usage |',
  '|--------|------|-------------|-------|',
  '| \u2713 | U+2713 | `&#10003;` | Confirm |',
  '| \u2328 | U+2328 | `&#9000;` | Keyboard |',
  '| \u00AB \u00BB | U+00AB U+00BB | `&#171;` `&#187;` | Quotes |'
].join('\n');

describe('emoji policy check', () => {
  it('reads every approved symbol, including paired cells', () => {
    expect([...approvedSymbols(POLICY)].sort()).toEqual(['\u00AB', '\u00BB', '\u2328', '\u2713'].sort());
  });

  it('reports emoji, emoji selectors and unapproved pictographs; allows approved symbols, escapes and records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-emoji-'));
    try {
      const files = {
        'docs/EMOJI.md': POLICY,
        'src/approved.js': "const icons = { ok: '\u2713', keys: '\u2328' };\n",
        'src/emoji.js': "const icon = '\u{1F504}';\n",
        'docs/selector.md': '# Heading\n\n\u2713\uFE0F Note\n',
        'src/unapproved.js': "const shuffle = '\u2684';\n",
        'src/escaped.test.js': "const input = 'ab\\u{1F600}cd';\n",
        'artifacts/run/report.json': '{"observed":"\u2705"}\n'
      };
      for (const [file, text] of Object.entries(files)) {
        await fs.mkdir(path.join(root, path.dirname(file)), { recursive: true });
        await fs.writeFile(path.join(root, file), text);
      }
      const violations = findEmoji({ root, files: Object.keys(files) });
      expect(violations).toEqual([
        { file: 'src/emoji.js', line: 1, symbol: '\u{1F504}', kind: 'emoji' },
        { file: 'docs/selector.md', line: 3, symbol: '\uFE0F', kind: 'emoji' },
        { file: 'src/unapproved.js', line: 1, symbol: '\u2684', kind: 'unapproved' }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

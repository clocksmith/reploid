import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findEmoji } from '../../scripts/verify-emoji.js';

describe('emoji policy check', () => {
  it('reports emoji and emoji-presentation selectors, and allows approved symbols and records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-emoji-'));
    try {
      const files = {
        'src/approved.js': "const icons = { ok: '✓', stop: '■', keys: '⌨', info: '☛' };\n",
        'src/emoji.js': "const icon = '\u{1F504}';\n",
        'docs/selector.md': '# Heading\n\n☛\uFE0F Note\n',
        'docs/supplementary.md': 'A pictograph without default emoji presentation: \u{1F5C2}\n',
        'src/escaped.test.js': "const input = 'ab\\u{1F600}cd';\n",
        'artifacts/run/report.json': '{"observed":"\u2705"}\n'
      };
      for (const [file, text] of Object.entries(files)) {
        await fs.mkdir(path.join(root, path.dirname(file)), { recursive: true });
        await fs.writeFile(path.join(root, file), text);
      }
      const violations = findEmoji({ root, files: Object.keys(files) });
      expect(violations).toEqual([
        { file: 'src/emoji.js', line: 1, symbol: '\u{1F504}' },
        { file: 'docs/selector.md', line: 3, symbol: '\uFE0F' },
        { file: 'docs/supplementary.md', line: 1, symbol: '\u{1F5C2}' }
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('passes on the repository', () => {
    expect(findEmoji()).toEqual([]);
  });
});

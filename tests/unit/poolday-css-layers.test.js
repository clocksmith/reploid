import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

describe('Poolday CSS design-system layers', () => {
  it('holds the tokens -> primitives -> components consumption contract', () => {
    const run = () => execFileSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'verify-poolday-css-layers.js')],
      { encoding: 'utf8' }
    );
    expect(run).not.toThrow();
  });
});

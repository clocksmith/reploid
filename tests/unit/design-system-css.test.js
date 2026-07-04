import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const readRepoFile = (relativePath) => readFileSync(
  path.resolve(__dirname, '../../', relativePath),
  'utf8'
);

describe('RD stylesheet ownership', () => {
  it('keeps rd.css as the standalone base design system', () => {
    const rd = readRepoFile('self/styles/rd.css');
    const stylesRoot = path.resolve(__dirname, '../../self/styles');

    expect(rd).not.toMatch(/@import\b/);
    expect(existsSync(path.join(stylesRoot, 'rd-tokens.css'))).toBe(false);
    expect(existsSync(path.join(stylesRoot, 'rd-primitives.css'))).toBe(false);
    expect(existsSync(path.join(stylesRoot, 'rd-components.css'))).toBe(false);
    expect(rd).toContain('/* === RD TOKENS === */');
    expect(rd).toContain('/* === RD PRIMITIVES === */');
    expect(rd).toContain('/* === RD COMPONENTS === */');
    expect(rd).toContain('--fg:');
    expect(rd).toContain('.panel {');
    expect(rd).toContain('.btn {');
  });

  it('keeps Poolday visuals as an extension of rd.css', () => {
    const rd = readRepoFile('self/styles/rd.css');
    const boot = readRepoFile('self/styles/boot.css');
    const poolday = readRepoFile('self/styles/poolday.css');
    const index = readRepoFile('self/index.html');
    const poolEntry = readRepoFile('self/pool-entry.html');

    expect(rd).not.toContain('.pool-home');
    expect(rd).not.toContain('--pool-');
    expect(boot).not.toContain('.pool-home');
    expect(poolday).toContain('.pool-home');
    expect(poolday).toContain('var(--space-lg)');
    expect(index).toContain('ensurePooldayStylesheet');
    expect(poolEntry).toContain('/styles/poolday.css');
  });
});

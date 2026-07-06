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
    expect(poolday).toContain('.pool-shape-action');
    expect(poolday).toContain('.pool-shape-action--circle');
    expect(poolday).toContain('.pool-shape-action--square');
    expect(poolday).not.toContain('.pool-shape-action--hex');
    expect(poolday).not.toContain('clip-path: polygon');
    expect(poolday).toContain('.pool-home-stage');
    expect(poolday).toContain('.pool-home-toolbar');
    expect(poolday).toContain('.pool-home-toolbar-leading');
    expect(poolday).toContain('.pool-home-toolbar-center');
    expect(poolday).toContain('.pool-home-toolbar-right');
    expect(poolday).not.toContain('.pool-home-status');
    expect(poolday).toContain('.pool-hot-path');
    expect(poolday).toContain('.pool-hot-path-step.is-active');
    expect(poolday).toMatch(/\.pool-home-toolbar\s*\{[\s\S]*?grid-template-columns: minmax\(10rem, 1fr\) minmax\(20rem, 34rem\) minmax\(10rem, 1fr\);/);
    expect(poolday).toMatch(/\.pool-home-toolbar\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toMatch(/\.pool-simulation-shell\s*\{[\s\S]*?overflow: hidden;/);
    expect(poolday).toMatch(/\.pool-simulation-shell\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toMatch(/\.pool-simulation-canvas\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toMatch(/\.pool-room-details\s*\{[\s\S]*?flex: 0 0 auto;/);
    expect(poolday).toMatch(/\.pool-room-details\[open\]\s*\{[\s\S]*?display: flex;/);
    expect(poolday).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.pool-room-details\[open\]\s*\{[\s\S]*?display: grid;/);
    expect(poolday).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.pool-ledger table\s*\{[\s\S]*?table-layout: fixed;/);
    expect(poolday).toContain('family=Michroma');
    expect(poolday).toContain('.pool-home-brand-word');
    expect(poolday).toContain('--pool-wordmark-optical-left');
    expect(poolday).toContain('font-family: \'Michroma\', var(--pool-font)');
    expect(poolday).toContain('.pool-nav-toggle');
    expect(poolday).toContain('var(--pool-shape-surface) padding-box');
    expect(poolday).toContain('.pool-contribution-metric');
    expect(poolday).toContain('var(--space-lg)');
    expect(index).toContain('ensurePooldayStylesheet');
    expect(poolEntry).toContain('/styles/poolday.css');
  });
});

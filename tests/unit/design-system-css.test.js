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
    const stylesRoot = path.resolve(__dirname, '../../self/styles');
    // Poolday is split into the three design-system layers; the legacy
    // single-file bundle must stay retired.
    expect(existsSync(path.join(stylesRoot, 'poolday.css'))).toBe(false);
    const poolday = ['tokens', 'primitives', 'components']
      .map((layer) => readRepoFile(`self/styles/poolday/${layer}.css`))
      .join('\n');
    const index = readRepoFile('self/index.html');
    const poolEntry = readRepoFile('self/pool-entry.html');

    expect(rd).not.toContain('.pool-home');
    expect(rd).not.toContain('--pool-');
    expect(boot).not.toContain('.pool-home');
    expect(poolday).toContain('.pool-home');
    expect(poolday).toContain('.pool-shape-action');
    expect(poolday).toContain('.pool-shape-action--circle');
    expect(poolday).not.toContain('.pool-shape-action--square');
    expect(poolday).not.toContain('.pool-shape-action--hex');
    expect(poolday).not.toContain('clip-path: polygon');
    expect(poolday).toContain('.pool-home-stage');
    expect(poolday).toContain('.pool-home-toolbar');
    expect(poolday).toContain('.pool-home-toolbar-leading');
    expect(poolday).toContain('.pool-home-ask-dock');
    expect(poolday).not.toContain('.pool-home-toolbar-right');
    expect(poolday).not.toContain('.pool-home-status');
    expect(poolday).not.toContain('.pool-hot-path');
    expect(poolday).not.toContain('.pool-home-network-badge');
    expect(poolday).toMatch(/\.pool-home-toolbar\s*\{[\s\S]*?grid-template-columns: minmax\(10rem, 1fr\) auto auto;/);
    expect(poolday).toMatch(/\.pool-home-toolbar\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toMatch(/\.pool-home-ask-dock\s*\{[\s\S]*?position: absolute;[\s\S]*?bottom: var\(--pool-home-ask-inset\);[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
    expect(poolday).toMatch(/\.pool-simulation-shell\s*\{[\s\S]*?overflow: hidden;/);
    expect(poolday).toMatch(/\.pool-simulation-shell\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toMatch(/\.pool-simulation-canvas\s*\{[\s\S]*?background: var\(--bg\);/);
    expect(poolday).toContain('.pool-nav-more');
    expect(poolday).toContain('.pool-room-context');
    expect(poolday).toContain('.pool-record-timeline');
    expect(poolday).toContain('.pool-record-event');
    expect(poolday).toContain('.pool-home-result-panel');
    expect(poolday).toContain("[data-pool-run-surface][data-run-state='idle']");
    expect(poolday).toContain(".pool-home-stage[data-run-state='running'][data-run-phase='verify']");
    expect(poolday).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.pool-ledger table\s*\{[\s\S]*?table-layout: fixed;/);
    expect(poolday).toContain('family=Michroma');
    expect(poolday).toContain('.pool-home-brand-word');
    expect(poolday).toContain('--pool-wordmark-optical-left');
    expect(poolday).toContain('font-family: \'Michroma\', var(--pool-font)');
    expect(poolday).toContain('.pool-nav-toggle');
    expect(poolday).toMatch(/\.pool-nav-rail\s*\{[\s\S]*?top: 0;[\s\S]*?bottom: 0;[\s\S]*?height: 100dvh;/);
    expect(poolday).toMatch(/\.pool-nav-rail\s*\{[\s\S]*?border-right: 1px solid/);
    expect(poolday).toMatch(/\.pool-nav-toggle\s*\{[\s\S]*?width: 100%;[\s\S]*?box-shadow: none;/);
    expect(poolday).toMatch(/\.pool-nav-rail\.is-open \.pool-nav-toggle\s*\{[\s\S]*?width: 100%;/);
    expect(poolday).toMatch(/\.pool-nav-rail\.is-open \.pool-nav-description\s*\{[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;/);
    expect(poolday).toContain('.pool-nav-top');
    expect(poolday).toContain('.pool-nav-bottom');
    expect(poolday).not.toContain('.pool-nav-view-context');
    expect(poolday).toContain('.pool-room-context-heading');
    expect(poolday).toMatch(/\.pool-nav-rail\.is-open \.pool-nav-mark-seven-top\s*\{[\s\S]*?font-size: 26px;[\s\S]*?translate\(8px, 8px\)/);
    expect(poolday).toMatch(/\.pool-nav-rail\.is-open \.pool-nav-mark-seven-bottom\s*\{[\s\S]*?font-size: 16px;[\s\S]*?translate\(1px, 0\)/);
    expect(poolday).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.pool-nav-toggle/);
    expect(poolday).toContain('var(--pool-shape-surface) padding-box');
    expect(poolday).toContain('.pool-contribution-metric');
    expect(poolday).toContain('var(--space-lg)');
    expect(index).toContain('ensurePooldayStylesheet');
    expect(poolEntry).toContain('/styles/poolday/tokens.css');
    expect(poolEntry).toContain('/styles/poolday/primitives.css');
    expect(poolEntry).toContain('/styles/poolday/components.css');
  });
});

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
  it('keeps Zero self-contained and binds its styles to defined RD or Zero tokens', () => {
    const rd = readRepoFile('self/styles/rd.css');
    const zero = readRepoFile('self/styles/zero.css');
    const definitions = new Set([...`${rd}\n${zero}`.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
    expect(zero).not.toMatch(/@import\b/);
    expect(zero).not.toContain('--opacity-secondary');
    expect(zero).toContain('--zero-text-secondary-opacity: var(--opacity-soft)');
    const components = zero.split('/* Components and page composition. */')[1];
    expect(components).not.toMatch(/#[\da-f]{3,8}\b/i);
    for (const [, name] of zero.matchAll(/var\(\s*(--[\w-]+)/g)) {
      expect(definitions.has(name), `Zero references undefined token ${name}`).toBe(true);
    }
  });
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
    expect(rd).toMatch(/^\.panel\b/m);
    expect(rd).toMatch(/^\.btn\b/m);
  });

  it('keeps Poolday visuals independent of rd.css', () => {
    const rd = readRepoFile('self/styles/rd.css');
    const boot = readRepoFile('self/styles/boot.css');
    const stylesRoot = path.resolve(__dirname, '../../self/styles');
    // Poolday is split into the three design-system layers; the legacy
    // single-file bundle must stay retired.
    expect(existsSync(path.join(stylesRoot, 'poolday.css'))).toBe(false);
    const layers = JSON.parse(readRepoFile('self/styles/poolday/layers.json'));
    const poolday = [layers.tokens, ...layers.primitives, ...layers.compositions]
      .map((file) => readRepoFile(`self/styles/poolday/${file}`))
      .join('\n');
    const index = readRepoFile('self/index.html');
    const poolEntry = readRepoFile('self/pool-entry.html');

    // rd.css and boot.css mention Poolday only to exclude its subtree from every selector.
    const poolExclusion = ':where(:not(.pool-home, .pool-home *))';
    expect(rd.replaceAll(poolExclusion, '')).not.toContain('.pool-home');
    expect(rd).not.toContain('--pool-');
    expect(boot.replaceAll(poolExclusion, '')).not.toContain('.pool-home');
    expect(poolday).toContain('.pool-home');
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
    expect(poolday).toMatch(/\.pool-home-toolbar\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
    expect(poolday).toMatch(/\.pool-home-ask-dock\s*\{[\s\S]*?position: absolute;[\s\S]*?bottom: var\(--pool-param-ask-inset\);[\s\S]*?left: 50%;[\s\S]*?transform: translateX\(-50%\);/);
    expect(poolday).toMatch(/\.pool-simulation-shell\s*\{[\s\S]*?overflow: hidden;/);
    expect(poolday).toContain('.pool-nav-more');
    expect(poolday).toContain('.pool-room-context');
    expect(poolday).toContain('.pool-record-timeline');
    expect(poolday).toContain('.pool-record-event');
    expect(poolday).toContain('.pool-home-result-panel');
    expect(poolday).toContain('var(--pool-param-ask-dock-height)');
    expect(poolday).toContain("[data-pool-run-surface][data-run-state='idle']");
    expect(poolday).toMatch(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.pool-ledger table\s*\{[\s\S]*?table-layout: fixed;/);
    expect(poolday).not.toContain('@import');
    expect(poolday).toContain('.pool-home-brand-word');
    expect(poolday).toContain('--pool-param-wordmark-optical-left');
    expect(poolday).toContain('font-family: var(--pool-font-display), var(--pool-font-ui)');
    expect(poolday).toContain('.pool-nav-toggle');
    expect(poolday).toMatch(/\.pool-nav-rail\s*\{[\s\S]*?top: 0;[\s\S]*?bottom: 0;[\s\S]*?height: 100dvh;/);
    expect(poolday).toMatch(/\.pool-nav-rail\.is-open \.pool-nav-toggle\s*\{[\s\S]*?width: 100%;/);
    expect(poolday).not.toContain('.pool-nav-view-context');
    expect(poolday).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.pool-nav-toggle/);
    expect(poolday).toContain('.pool-contribution-metric');
    expect(index).toContain('ensurePooldayStylesheet');
    expect(poolEntry).toContain('/styles/poolday/tokens.css');
  });
});

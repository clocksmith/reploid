import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SELF_BOOT_SPEC } from '../../src/self/boot-spec.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const readRepoFile = (relativePath) => readFileSync(
  path.resolve(__dirname, '../../', relativePath),
  'utf8'
);

describe('self-first boot shell', () => {
  it('publishes the root base href through the self boot spec', () => {
    expect(SELF_BOOT_SPEC.baseHref).toBe('/');
  });

  it('boots both HTML entry shells from /self/kernel/boot.js', () => {
    const selfKernelHtml = readRepoFile('src/self/kernel/index.html');
    const sourceIndexHtml = readRepoFile('src/index.html');

    expect(selfKernelHtml).toContain('href="/"');
    expect(selfKernelHtml).toMatch(/src="\/self\/kernel\/boot\.js\?v=\d+"/);
    expect(sourceIndexHtml).toContain('href="/"');
    expect(sourceIndexHtml).toMatch(/src="\/self\/kernel\/boot\.js\?v=\d+"/);
  });
});

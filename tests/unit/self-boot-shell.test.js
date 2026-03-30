import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SELF_BOOT_SPEC, toSourceWebPath } from '../../self/boot-spec.js';
import { SELF_SOURCE_MIRRORS } from '../../self/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const readRepoFile = (relativePath) => readFileSync(
  path.resolve(__dirname, '../../', relativePath),
  'utf8'
);

describe('self-first boot shell', () => {
  it('publishes the root base href through the self boot spec', () => {
    expect(SELF_BOOT_SPEC.baseHref).toBe('/');
  });

  it('boots both HTML entry shells from /kernel/boot.js', () => {
    const selfKernelHtml = readRepoFile('self/kernel/index.html');
    const sourceIndexHtml = readRepoFile('self/index.html');

    expect(selfKernelHtml).toContain('href="/"');
    expect(selfKernelHtml).toMatch(/src="\/kernel\/boot\.js\?v=\d+"/);
    expect(sourceIndexHtml).toContain('href="/"');
    expect(sourceIndexHtml).toMatch(/src="\/kernel\/boot\.js\?v=\d+"/);
  });

  it('maps canonical /self files to the public browser tree', () => {
    expect(toSourceWebPath('/self/runtime.js')).toBe('/runtime.js');
    expect(toSourceWebPath('/self/host/start-app.js')).toBe('/host/start-app.js');
    expect(toSourceWebPath('/core/utils.js')).toBe('/core/utils.js');
    expect(SELF_SOURCE_MIRRORS.every(({ webPath }) => !webPath.startsWith('/src/'))).toBe(true);
  });

  it('provides a root service worker wrapper', () => {
    const wrapper = readRepoFile('self/sw.js');
    expect(wrapper).toContain("importScripts(`/host/sw-module-loader.js${suffix}`);");
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { resolveDopplerBrowserAssets } from '../../self/config/doppler-local-models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readRepoFile = (relativePath) =>
  readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8');

describe('Pinned Doppler asset resolution', () => {
  it('pool-entry uses the shared resolver before importing the application', () => {
    const html = readRepoFile('self/pool-entry.html');
    expect(html).toContain('resolveDopplerBrowserAssets({');
    expect(html).toContain("['reset', 'clear', 'default', 'local'].includes(queryBase)");
    expect(html).toContain("localStorage.removeItem('DOPPLER_BASE_URL')");
    expect(html.indexOf('resolveDopplerBrowserAssets({')).toBeLessThan(html.indexOf("import('/ui/pool-home/index.js')"));
  });

  it('kernel boot uses the shared resolver without changing unrelated storage', () => {
    const bootJs = readRepoFile('self/kernel/boot.js');
    expect(bootJs).toContain('const installDopplerImportMap = () =>');
    expect(bootJs).toContain("['reset', 'clear', 'default', 'local'].includes(fromQuery)");
    expect(bootJs).toContain("localStorage.removeItem('DOPPLER_BASE_URL')");
    expect(bootJs).toContain('resolveDopplerBrowserAssets({');
    expect(resolveDopplerBrowserAssets({ pageUrl: 'http://localhost:8000/' }).moduleUrl)
      .toBe('http://localhost:8000/vendor/doppler/0.6.2/src/index.js');
  });

  it('VFS uses the same asset owner and preserves explicit developer endpoints', () => {
    const vfsJs = readRepoFile('self/host/vfs-bootstrap.js');
    expect(vfsJs).toContain('const getDopplerBaseUrl = () =>');
    expect(vfsJs).toContain('resolveDopplerBrowserAssets({');
    expect(resolveDopplerBrowserAssets({ pageUrl: 'http://localhost:8000/', explicitBase: 'http://localhost:8011' }).moduleUrl)
      .toBe('http://localhost:8011/src/index.js');
  });

  it('runtime preserves the import cause and never falls back to an unpinned local checkout', () => {
    const runtimeJs = readRepoFile('self/infrastructure/doppler-runtime-service.js');
    expect(runtimeJs).toContain('const defaultLoadModule = async () =>');
    expect(runtimeJs).toContain('Inspect the first failed module request.');
    expect(runtimeJs).toContain('{ cause }');
    expect(runtimeJs.includes("import('/doppler/src/index.js')")).toBe(false);
  });


  it('public provider also preserves the configured source on failure', () => {
    const providerJs = readRepoFile('self/providers/doppler-reploid.js');
    expect(providerJs).toContain('tryImport(primaryUrl)');
    expect(providerJs.includes("tryImport('/doppler/src/index.js')")).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SELF_BOOT_SPEC, toSourceWebPath } from '../../self/boot-spec.js';
import { PROTO_RUNTIME_SELF_MIRROR_RULES, buildRuntimeSelfMirrors } from '../../self/lab/mirrors.js';
import { SELF_SOURCE_MIRRORS } from '../../self/manifest.js';
import { readServedTextSync } from '../helpers/served-browser-files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// self/<path> names the browser file served at <path>; assertions read it as served.
const readRepoFile = (relativePath) => (relativePath.startsWith('self/')
  ? readServedTextSync(relativePath.slice('self/'.length))
  : readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8'));

describe('self-first boot shell', () => {
  it('publishes the root base href through the self boot spec', () => {
    expect(SELF_BOOT_SPEC.baseHref).toBe('/');
  });

  it('boots the kernel shell directly and routes the public shell at runtime', () => {
    const selfKernelHtml = readRepoFile('self/kernel/index.html');
    const sourceIndexHtml = readRepoFile('self/index.html');
    const poolEntryHtml = readRepoFile('self/pool-entry.html');

    expect(selfKernelHtml).toContain('href="/"');
    expect(selfKernelHtml).toMatch(/src="\/kernel\/boot\.js\?v=\d+"/);
    expect(sourceIndexHtml).toContain('href="/"');
    expect(sourceIndexHtml).toContain("import('/ui/pool-home/app.bundle.js')");
    expect(poolEntryHtml).toContain("import('/ui/pool-home/app.bundle.js')");
    expect(sourceIndexHtml).toContain('const bootPath = `/kernel/boot.js?v=${window.REPLOID_BUILD_VERSION}`;');
    expect(sourceIndexHtml).toContain('await import(bootPath);');
  });

  describe.each([
    ['index.html', 'http://reploid.test/'],
    ['pool-entry.html', 'http://reploid.test/pool-entry.html']
  ])('public-route boot recovery served at %s', (servedPath, pageUrl) => {
    afterEach(() => { vi.useRealTimers(); });

    // Runs the page's served module script against an injected page: the product bundle import,
    // location, history, storage and timers are ports; the recovery logic is the shipped script.
    const bootPage = ({ url = pageUrl, initPoolHome, importFails = false, storageDenied = false } = {}) => {
      const html = readRepoFile(`self/${servedPath}`);
      const buildVersion = html.match(/REPLOID_BUILD_VERSION = '([^']+)'/)[1];
      const script = [...html.matchAll(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/g)].at(-1)[1]
        .replace(/^\s*import\s+\{[^}]*\}\s+from\s+'[^']+';\s*$/gm, '')
        .replace(/\bimport\(/g, 'importModule(');
      const values = new Map();
      const sessionStorage = {
        getItem: (key) => { if (storageDenied) throw new Error('Storage denied'); return values.get(key) ?? null; },
        setItem: (key, value) => { if (storageDenied) throw new Error('Storage denied'); values.set(key, String(value)); },
        removeItem: (key) => { if (storageDenied) throw new Error('Storage denied'); values.delete(key); }
      };
      const location = { href: url, get pathname() { return new URL(this.href).pathname; }, replace: vi.fn(), reload: vi.fn() };
      const history = { state: null, replaceState: vi.fn((_, __, next) => { location.href = new URL(next, location.href).href; }) };
      const win = { REPLOID_BUILD_VERSION: buildVersion, location, history,
        setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: (id) => globalThis.clearTimeout(id) };
      const appRoot = document.createElement('div');
      const doc = { title: '', head: { appendChild() {} }, getElementById: (id) => (id === 'app' ? appRoot : null),
        createElement: (tag) => document.createElement(tag) };
      const imports = [];
      const importModule = async (specifier) => {
        imports.push(specifier);
        if (importFails) throw new TypeError('Failed to fetch dynamically imported module');
        return { initPoolHome };
      };
      const run = new (Object.getPrototypeOf(async () => {}).constructor)(
        'window', 'document', 'location', 'navigator', 'sessionStorage', 'localStorage', 'importModule', 'resolveDopplerBrowserAssets',
        script
      )(win, doc, location, {}, sessionStorage, sessionStorage, importModule, () => ({}));
      return { run, appRoot, location, history, values, imports, buildVersion };
    };
    const retryUrlOf = (page) => new URL(page.location.replace.mock.calls[0][0]);

    it('retries a failed product bundle once with the build-bound retry marker', async () => {
      const page = bootPage({ importFails: true });
      await page.run;
      expect(page.imports).toEqual(['/ui/pool-home/app.bundle.js']);
      expect(page.location.replace).toHaveBeenCalledTimes(1);
      expect(retryUrlOf(page).searchParams.get('reploidBootRetry')).toBe(page.buildVersion);
      expect(page.appRoot.querySelector('[role="alert"]')).toBeNull();
    });

    it('shows one alert instead of a second retry when the retried boot fails, even without storage', async () => {
      const firstPage = bootPage({ importFails: true, storageDenied: true });
      await firstPage.run;
      const page = bootPage({ url: retryUrlOf(firstPage).href, importFails: true, storageDenied: true });
      await expect(page.run).rejects.toThrow();
      expect(page.location.replace).not.toHaveBeenCalled();
      const alerts = page.appRoot.querySelectorAll('[role="alert"]');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].classList.contains('pool-boot-failure')).toBe(true);
      expect(alerts[0].textContent).toBe('Reploid could not load. Reload the page to try again.');
    });

    it('bounds a product initialization that never settles at 10 seconds and aborts it', async () => {
      vi.useFakeTimers();
      let signal;
      const page = bootPage({ initPoolHome: (_root, options) => { signal = options.signal; return new Promise(() => {}); } });
      await vi.advanceTimersByTimeAsync(9999);
      expect(page.location.replace).not.toHaveBeenCalled();
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await page.run;
      expect(signal.aborted).toBe(true);
      expect(retryUrlOf(page).searchParams.get('reploidBootRetry')).toBe(page.buildVersion);
    });

    it('clears the retry marker after a successful retried boot', async () => {
      const firstPage = bootPage({ importFails: true });
      await firstPage.run;
      const page = bootPage({ url: retryUrlOf(firstPage).href, initPoolHome: async () => {} });
      await page.run;
      expect(new URL(page.location.href).searchParams.has('reploidBootRetry')).toBe(false);
      expect([...page.values.keys()]).toEqual([]);
      expect(page.appRoot.querySelector('[role="alert"]')).toBeNull();
    });
  });

  it('keeps the public release and kernel fallback on one build version', () => {
    const sourceIndexHtml = readRepoFile('self/index.html');
    const kernelBoot = readRepoFile('self/kernel/boot.js');
    const publicVersion = sourceIndexHtml.match(/REPLOID_BUILD_VERSION = '([^']+)'/)?.[1];
    const kernelVersion = kernelBoot.match(/const BUILD_VERSION = '([^']+)'/)?.[1];

    expect(publicVersion).toMatch(/^\d{10}$/);
    expect(kernelVersion).toBe(publicVersion);
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

  it('routes lab shadow modules and self UI mirror misses through the service worker', () => {
    const loader = readRepoFile('self/host/sw-module-loader.js');

    expect(loader).toContain("'/shadow/'");
    expect(loader).toContain('SELF_MIRROR_SOURCE_PREFIXES');
    expect(loader).toContain("targetPrefix: '/self/ui/components/'");
    expect(loader).toContain("targetPrefix: '/self/ui/panels/'");
    expect(loader).toContain("targetPrefix: '/self/ui/proto/'");
    expect(loader).toContain("sourcePrefix: '/ui/proto/'");
    expect(loader).toContain('X-VFS-Mirror-Fallback');
  });

  it('mirrors proto shared UI dependencies into /self', () => {
    const files = ['/ui/toast.js', '/ui/components/button.js', '/ui/panels/trace.js'];
    const mirrors = buildRuntimeSelfMirrors(PROTO_RUNTIME_SELF_MIRROR_RULES, files);
    for (const sourcePath of files) {
      expect(mirrors).toContainEqual({ sourcePath, targetPath: `/self${sourcePath}` });
    }
  });

  it('checks the network shell version before trusting warm VFS boot', () => {
    const seedVfs = readRepoFile('self/host/seed-vfs.js');

    expect(seedVfs).toContain('recoverFromStaleNetworkVersion');
    expect(seedVfs).toContain("headers: { [VFS_BYPASS_HEADER]: '1' }");
    expect(seedVfs).toContain('releaseBootServiceWorkers');
    expect(seedVfs).toContain('REPLOID_NETWORK_VERSION_RELOAD');
    expect(seedVfs).toContain("bootProfile === 'zero_home'");
    expect(seedVfs).toContain("bootProfile === 'x_home'");
  });

  it('stops boot backgrounds through declared browser globals only', () => {
    const startApp = readRepoFile('self/host/start-app.js');

    expect(startApp).toContain('const stopBootBackgrounds = () =>');
    expect(startApp).toContain('window.REPLOID_POOL_SIMULATION_STOP');
    expect(startApp).toContain('window.stopParticleBg');
    expect(startApp).not.toContain('if (stopParticleBg)');
    expect(startApp.replaceAll('window.stopParticleBg', '')).not.toContain('stopParticleBg = null');
  });

  it('routes Zero through a dedicated shell without statically importing identity', () => {
    const startApp = readRepoFile('self/host/start-app.js');

    expect(startApp).toContain("'/ui/zero-home/index.js'");
    const launcher = readRepoFile('self/host/reploid-launch.js');
    expect(startApp).toContain("from './reploid-launch.js'");
    expect(launcher).toContain("await import('../identity.js')");
    expect(launcher).not.toMatch(/import\s+[^;]+\s+from\s+['"]\.\.\/identity\.js['"]/);
    expect(startApp).not.toContain("import { rotateIdentityBundle } from '../identity.js'");
  });

  it('does not invalidate service worker modules for non-module VFS logs', () => {
    const startApp = readRepoFile('self/host/start-app.js');

    expect(startApp).toContain('const MODULE_INVALIDATION_PREFIXES');
    expect(startApp).toContain('const isModuleInvalidationPath = (path) =>');
    const invalidateIndex = startApp.indexOf("void postServiceWorkerMessage('INVALIDATE_MODULE'");
    const guardIndex = startApp.lastIndexOf('if (isModuleInvalidationPath(path))', invalidateIndex);
    expect(invalidateIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
  });

  it('batches timeline persistence and telemetry panel renders', () => {
    const timeline = readRepoFile('self/infrastructure/telemetry-timeline.js');
    const telemetryPanel = readRepoFile('self/ui/proto/telemetry.js');

    expect(timeline).toContain('const _pendingEntries = []');
    expect(timeline).toContain('const _appendEntries = async (entries) =>');
    expect(timeline).toContain('flush,');
    expect(telemetryPanel).toContain('scheduleTelemetryRender');
    expect(telemetryPanel).toContain('requestAnimationFrame');
  });

  it('seeds only the declared active self-source before awaken', () => {
    const bootHome = readRepoFile('self/ui/zero-home/index.js');

    expect(bootHome).toContain('getBootSourceManifest(bootProfile)');
    expect(bootHome).toContain('pickBootSeedFiles(manifest.files, bootProfile)');
    expect(bootHome).toContain('seedVfsFromManifest({ files }');
    expect(bootHome).not.toContain('seedVfsFromManifest(manifest,');
  });

  it('places the awaken action inside the goal editor on the boot home', () => {
    const bootHome = readRepoFile('self/ui/boot-home/index.js');
    const goalStep = readRepoFile('self/ui/boot-wizard/steps/goal.js');
    const styles = readRepoFile('self/styles/boot.css');

    expect(bootHome).toContain('const renderAwakenButton = (state, options = {}) =>');
    expect(bootHome).toContain('primaryActionHtml: renderRunReplayImportControl(state) + renderAwakenButton');
    expect(bootHome).not.toContain('wizard-awaken-simple');
    expect(goalStep).toContain('const primaryActionHtml = options.primaryActionHtml ||');
    expect(goalStep).toContain('goal-primary-action');
    expect(styles).toContain('.goal-primary-action');
  });
});

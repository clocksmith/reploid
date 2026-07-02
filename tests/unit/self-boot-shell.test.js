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

  it('boots the kernel shell directly and routes the public shell at runtime', () => {
    const selfKernelHtml = readRepoFile('self/kernel/index.html');
    const sourceIndexHtml = readRepoFile('self/index.html');

    expect(selfKernelHtml).toContain('href="/"');
    expect(selfKernelHtml).toMatch(/src="\/kernel\/boot\.js\?v=\d+"/);
    expect(sourceIndexHtml).toContain('href="/"');
    expect(sourceIndexHtml).toContain("import('/ui/pool-home/index.js')");
    expect(sourceIndexHtml).toContain('const bootPath = `/kernel/boot.js?v=${window.REPLOID_BUILD_VERSION}`;');
    expect(sourceIndexHtml).toContain('await import(bootPath);');
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
    const mirrors = readRepoFile('self/lab/mirrors.js');

    expect(mirrors).toContain("sourcePath: '/ui/toast.js', targetPath: '/self/ui/toast.js'");
    expect(mirrors).toContain("sourcePrefix: '/ui/components/'");
    expect(mirrors).toContain("sourcePrefix: '/ui/panels/'");
  });

  it('checks the network shell version before trusting warm VFS boot', () => {
    const seedVfs = readRepoFile('self/host/seed-vfs.js');

    expect(seedVfs).toContain('recoverFromStaleNetworkVersion');
    expect(seedVfs).toContain("headers: { [VFS_BYPASS_HEADER]: '1' }");
    expect(seedVfs).toContain('releaseBootServiceWorkers');
    expect(seedVfs).toContain('REPLOID_NETWORK_VERSION_RELOAD');
  });

  it('stops boot backgrounds through declared browser globals only', () => {
    const startApp = readRepoFile('self/host/start-app.js');

    expect(startApp).toContain('const stopBootBackgrounds = () =>');
    expect(startApp).toContain('window.REPLOID_POOL_SIMULATION_STOP');
    expect(startApp).toContain('window.stopParticleBg');
    expect(startApp).not.toContain('if (stopParticleBg)');
    expect(startApp.replaceAll('window.stopParticleBg', '')).not.toContain('stopParticleBg = null');
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

  it('mirrors the active locked-route runtime UI before awaken', () => {
    const bootHome = readRepoFile('self/ui/boot-home/index.js');

    expect(bootHome).toContain('getRuntimeSelfMirrorsByBootProfile(bootProfile');
    expect(bootHome).not.toContain("getRuntimeSelfMirrorsByBootProfile('zero_home'");
  });

  it('places the awaken action inside the goal editor on the boot home', () => {
    const bootHome = readRepoFile('self/ui/boot-home/index.js');
    const goalStep = readRepoFile('self/ui/boot-wizard/steps/goal.js');
    const styles = readRepoFile('self/styles/boot.css');

    expect(bootHome).toContain('const renderAwakenButton = (state, options = {}) =>');
    expect(bootHome).toContain('primaryActionHtml: renderAwakenButton');
    expect(bootHome).not.toContain('wizard-awaken-simple');
    expect(goalStep).toContain('const primaryActionHtml = options.primaryActionHtml ||');
    expect(goalStep).toContain('goal-primary-action');
    expect(styles).toContain('.goal-primary-action');
  });
});

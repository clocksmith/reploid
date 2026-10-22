import { expect } from '@playwright/test';
import { getLabRouteCases } from '../../self/lab/profiles.js';

export const DB_PREFIX = 'reploid-vfs-v0';

export const LAB_ROUTE_CASES = getLabRouteCases();

export const sanitizeInstanceId = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

export async function readInstanceVfs(page, surface, instanceId) {
  return page.evaluate(async (dbName) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('files', 'readonly').objectStore('files').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(Object.fromEntries(request.result.map(({ path, content }) => [path, content])));
      });
    } finally { db.close(); }
  }, `${DB_PREFIX}--${surface}--${instanceId}`);
}

// A saved-work sentinel exercises the nonempty legacy branch, not restoration of
// a complete historical image. Boot and tool verification remain unmodified.
export async function bootLegacyZeroInstance(page, instanceId) {
  const fixturePath = '/__e2e__/legacy-zero-instance';
  const savedPath = '/artifacts/legacy-saved-work.txt';
  const savedText = `Saved before compact Zero: ${instanceId}`;
  const renderFixture = route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Legacy instance fixture</title>' });
  await page.route(`**${fixturePath}`, renderFixture);
  try {
    await page.goto(fixturePath);
    await page.evaluate(async ({ dbName, path, content }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').add({ path, content, size: content.length, updated: Date.now(), type: 'file' });
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, { dbName: `${DB_PREFIX}--zero--${instanceId}`, path: savedPath, content: savedText });
  } finally { await page.unroute(`**${fixturePath}`, renderFixture); }

  await bootRouteWithServiceWorker(page, '/zero', instanceId);
  await expect(page.locator('.wizard-home-provider')).toBeVisible();
  const files = await readInstanceVfs(page, 'zero', instanceId);
  expect(files[savedPath]).toBe(savedText);
  expect(files['/zero/source.json']).toBeUndefined();
  await expect(page.locator('.zero-capsule')).toHaveCount(0);
}

export async function bootRouteWithServiceWorker(page, route, instanceId) {
  await page.goto(`${route}?instance=${encodeURIComponent(instanceId)}`);
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are not available');
    }
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 2000);
      });
    }
  });

  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  }

  await expect.poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), {
    timeout: 20000
  }).toBe(true);
}

export async function assertRouteContract(page, expected) {
  await expect(page).toHaveTitle(expected.title);

  const actual = await page.evaluate(() => ({
    mode: typeof window.getReploidMode === 'function' ? window.getReploidMode() : null,
    routeMode: typeof window.getReploidRouteMode === 'function' ? window.getReploidRouteMode() : null,
    bootProfile: typeof window.getReploidBootProfile === 'function' ? window.getReploidBootProfile() : null,
    genesisLevel: typeof window.getGenesisLevel === 'function' ? window.getGenesisLevel() : null
  }));

  expect(actual).toEqual({
    mode: expected.mode,
    routeMode: expected.mode,
    bootProfile: expected.bootProfile,
    genesisLevel: expected.genesisLevel
  });
}

export async function awakenWithoutGoal(page) {
  await expect.poll(async () => page.evaluate(() => typeof window.triggerAwaken === 'function'), {
    timeout: 30000
  }).toBe(true);

  await page.evaluate(async () => {
    await window.triggerAwaken('');
  });

  await expect.poll(async () => page.evaluate(() => ({
    hasContainer: !!window.REPLOID?.container,
    hasAgent: !!window.REPLOID?.agent,
    hasToolRunner: !!window.REPLOID?.toolRunner,
    hasVfs: !!window.REPLOID?.vfs
  })), {
    timeout: 60000
  }).toEqual({
    hasContainer: true,
    hasAgent: true,
    hasToolRunner: true,
    hasVfs: true
  });
}

export async function collectBootProbe(page, routeCase) {
  return page.evaluate(async (expected) => {
    const bootSpecModule = await import('/boot-spec.js?bootstrapper=1');
    const bootSpec = bootSpecModule.SELF_BOOT_SPEC;
    const container = window.REPLOID?.container || null;
    const toolRunner = window.REPLOID?.toolRunner || null;
    const moduleNames = [...expected.requiredModules, ...expected.forbiddenModules];
    const modulePresence = Object.fromEntries(moduleNames.map((name) => [
      name,
      typeof container?.hasModule === 'function' ? container.hasModule(name) : null
    ]));
    const toolsLoaded = typeof toolRunner?.list === 'function' ? toolRunner.list() : [];
    const uiMode = document.querySelector('.zero-shell')
      ? 'zero'
      : document.querySelector('.app-shell')
        ? 'proto'
        : null;

    return {
      route: window.location.pathname,
      bootProfile: typeof window.getReploidBootProfile === 'function' ? window.getReploidBootProfile() : null,
      genesisLevel: typeof window.getGenesisLevel === 'function' ? window.getGenesisLevel() : null,
      uiMode,
      modulesLoaded: modulePresence,
      toolsLoaded,
      writableRoots: bootSpec.writableRoots,
      serviceWorkerReady: !!navigator.serviceWorker?.controller,
      vfsReady: !!window.REPLOID?.vfs,
      agentLoopReady: !!window.REPLOID?.agent
    };
  }, routeCase);
}

export async function executeToolResult(page, name, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    try {
      return {
        ok: true,
        value: await window.REPLOID.toolRunner.execute(name, args)
      };
    } catch (error) {
      return {
        ok: false,
        name: error?.name || 'Error',
        message: String(error?.message || error)
      };
    }
  }, { name, args });
}

export async function runTransitiveImportSmoke(page, instanceId, prefix) {
  return page.evaluate(async ({ instanceId, prefix, dbPrefix }) => {
    const openDb = () => new Promise((resolve, reject) => {
      const pathname = String(window.location.pathname || '/').replace(/\/+$/, '') || '/';
      const surfaceId = pathname.startsWith('/zero')
        ? 'zero'
        : pathname.startsWith('/x')
          ? 'x'
          : 'poolday';
      const dbName = `${dbPrefix}--${surfaceId}--${instanceId}`;
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    const db = await openDb();
    const writeFile = (path, content) => new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put({
        path,
        content,
        size: content.length,
        updated: Date.now(),
        type: 'file'
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const entryPath = `${prefix}/hmr-entry.js`;
    const depPath = `${prefix}/hmr-dep.js`;
    await writeFile(entryPath, "import { value } from './hmr-dep.js';\nexport default value;\n");
    await writeFile(depPath, "export const value = 'before';\n");

    const before = await import(`${entryPath}?v=before&instance=${instanceId}`);
    await writeFile(depPath, "export const value = 'after';\n");
    const after = await import(`${entryPath}?v=after&instance=${instanceId}`);
    db.close();

    return {
      before: before.default,
      after: after.default
    };
  }, { instanceId, prefix, dbPrefix: DB_PREFIX });
}

export async function installMockLLMProvider(page, responses) {
  const responseList = Array.isArray(responses) ? responses : [responses];
  await page.evaluate((items) => {
    window.MockLLMProvider = {
      calls: [],
      responses: [],
      async chat(messages, modelConfig) {
        const index = this.calls.length;
        const fallback = 'DONE: mock complete';
        const content = String(items[Math.min(index, items.length - 1)] || fallback);
        this.calls.push({ messages, modelConfig, timestamp: Date.now() });
        const response = {
          content,
          raw: content,
          provider: 'mock',
          model: modelConfig?.id || 'mock-model',
          usage: {
            inputTokens: Math.ceil(JSON.stringify(messages || []).length / 4),
            outputTokens: Math.ceil(content.length / 4)
          }
        };
        this.responses.push(response);
        return response;
      },
      getCapabilities() {
        return { available: true, initialized: true, currentModelId: 'mock-model' };
      }
    };
    window.MOCK_LLM_INJECTED = true;
  }, responseList);
}

export async function setMockSelectedModel(page, instanceId, options = {}) {
  await page.evaluate(({ instanceId, options }) => {
    const prefix = instanceId ? `REPLOID_INSTANCE_${instanceId}::` : '';
    localStorage.setItem(`${prefix}SELECTED_MODELS`, JSON.stringify([{
      id: options.id || 'mock-model',
      name: options.name || 'Mock Model',
      provider: 'mock',
      hostType: 'browser-local',
      maxIterations: options.maxIterations || 1
    }]));
  }, { instanceId, options });
}

export async function awakenWithMockGoal(page, route, instanceId, goal, responses, modelOptions = {}) {
  await bootRouteWithServiceWorker(page, route, instanceId);
  await expect.poll(async () => page.evaluate(() => typeof window.triggerAwaken === 'function'), {
    timeout: 30000
  }).toBe(true);
  await installMockLLMProvider(page, responses);
  await setMockSelectedModel(page, instanceId, modelOptions);
  await page.evaluate(async (nextGoal) => {
    await window.triggerAwaken(nextGoal);
  }, goal);
}

export async function waitForVfsPath(page, path, timeout = 60000) {
  await expect.poll(async () => page.evaluate(async (targetPath) => (
    !!(await window.REPLOID?.vfs?.exists?.(targetPath).catch(() => false))
  ), path), { timeout }).toBe(true);
}

export async function readVfsText(page, path) {
  return page.evaluate(async (targetPath) => window.REPLOID.vfs.read(targetPath), path);
}

export async function readVfsJson(page, path) {
  const text = await readVfsText(page, path);
  return JSON.parse(text);
}

export function getCycleArtifactPath(cycle = 1, artifact = 'audit.json') {
  return `/cycles/cycle-${String(cycle).padStart(6, '0')}/${artifact}`;
}

/**
 * E2E Test: VFS service-worker module reload
 * Covers browser ESM registry behavior that unit tests cannot exercise.
 */
import { test, expect } from '@playwright/test';

const DB_PREFIX = 'reploid-vfs-v0';
const ROUTE_CASES = Object.freeze([
  {
    route: '/0',
    label: 'zero',
    title: 'Zero',
    mode: 'zero',
    bootProfile: 'zero_home',
    genesisLevel: 'spark'
  },
  {
    route: '/x',
    label: 'x',
    title: 'X',
    mode: 'x',
    bootProfile: 'x_home',
    genesisLevel: 'full'
  }
]);

const sanitizeInstanceId = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

async function bootRouteWithServiceWorker(page, route, instanceId) {
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

async function runTransitiveImportSmoke(page, instanceId, prefix) {
  return page.evaluate(async ({ instanceId, prefix, dbPrefix }) => {
    const openDb = () => new Promise((resolve, reject) => {
      const dbName = `${dbPrefix}--${instanceId}`;
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

async function assertRouteContract(page, expected) {
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

test.describe('VFS HMR routes', () => {
  for (const routeCase of ROUTE_CASES) {
    test(`${routeCase.route} uses its lab contract and cache-busts transitive VFS imports`, async ({ page }, testInfo) => {
      const { route, label } = routeCase;
      const instanceId = sanitizeInstanceId(`e2e-${label}-${testInfo.project.name}-${Date.now()}`);
      const prefix = `/shadow/e2e-${label}-${testInfo.project.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

      await bootRouteWithServiceWorker(page, route, instanceId);
      await assertRouteContract(page, routeCase);
      const result = await runTransitiveImportSmoke(page, instanceId, prefix);

      expect(result).toEqual({
        before: 'before',
        after: 'after'
      });
    });
  }
});

/**
 * Source-only browser proof. No repository server, provider, or inference required.
 * Run with REPLOID_E2E_SKIP_LOCAL_SERVER=1 and the normal Playwright config.
 * REPLOID_E2E_CHROMIUM_EXECUTABLE_PATH can select a system Chromium installation.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import { test, expect } from '@playwright/test';
import { exportSelfImage, materializeSelfImage } from '../../self/image/export.js';

// Keep browser sandboxing enabled. A restricted runner must report its blocker.
test.use({ launchOptions: {
  chromiumSandbox: true,
  args: [],
  ...(process.env.REPLOID_E2E_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.REPLOID_E2E_CHROMIUM_EXECUTABLE_PATH } : {})
} });

async function exportRepositorySource() {
  const selfRoot = new URL('../../self/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('config/self-source-manifest.json', selfRoot), 'utf8'));
  const source = new Map();
  for (let index = 0; index < manifest.files.length; index += 1) {
    source.set(`/${manifest.seedFiles[index]}`, await readFile(new URL(manifest.files[index], selfRoot), 'utf8'));
  }
  return exportSelfImage({}, {
    VFS: { list: async () => [...source.keys()] },
    readFile: async ({ path }) => ({ content: source.get(path) })
  });
}

async function serveSourceImage(image) {
  const host = await materializeSelfImage(image);
  const missing = [];
  const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
    '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/plain' };
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const path = pathname === '/' ? '/index.html' : pathname;
    // Every successful response comes from the frozen export map, never the repository.
    if (!Object.hasOwn(host.files, path)) {
      missing.push(path);
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not in the exported source image');
      return;
    }
    response.writeHead(200, { 'Content-Type': (path === '/x' || path === '/zero') ? 'text/html' : types[extname(path)] || 'text/plain',
      'Cache-Control': 'no-store' });
    response.end(host.files[path]);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    missing,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function coldBoot(browser, host, instance, evidence) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') evidence.push({ instance, error: message.text() });
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.origin !== host.origin) {
        externalRequests.push(url.href);
        return route.abort();
      }
    }
    return route.continue();
  });
  try {
    await page.goto(`${host.origin}/x?instance=${instance}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.triggerAwaken === 'function', null, { timeout: 20000 });
    // Empty goal initializes real services and UI without selecting a provider or running inference.
    await page.evaluate(() => window.triggerAwaken(''));
    await page.waitForFunction(() => !!window.REPLOID_UI && !!window.REPLOID?.vfs, null, { timeout: 20000 });
    expect(await page.evaluate(() => window.getReploidMode())).toBe('x');
    expect(errors, `${instance}: uncaught browser errors`).toEqual([]);
    expect(externalRequests, `${instance}: undeclared external requests`).toEqual([]);
    expect(host.missing, `${instance}: sources missing from the export`).toEqual([]);
    const descendant = await page.evaluate(async () => {
      const { exportSelfImage } = await import('/image/export.js');
      const vfs = window.REPLOID.vfs;
      return exportSelfImage({}, {
        VFS: vfs,
        readFile: async ({ path }) => ({ content: await vfs.read(path) })
      });
    });
    return descendant;
  } finally {
    evidence.push({ instance, pageErrors: errors, externalRequests, missing: [...host.missing] });
    await context.close();
  }
}

test('X boots from its source export and exports a descendant that cold-boots on another origin', async ({ browser }, testInfo) => {
  test.setTimeout(90000);
  const evidence = [];
  const ancestor = await exportRepositorySource();
  const firstHost = await serveSourceImage(ancestor);
  let secondHost;
  try {
    const descendant = await coldBoot(browser, firstHost, 'source-parent', evidence);
    expect(descendant.files).toEqual(ancestor.files);
    secondHost = await serveSourceImage(descendant);
    expect(secondHost.origin).not.toBe(firstHost.origin);
    const grandchild = await coldBoot(browser, secondHost, 'source-child', evidence);
    expect(grandchild.files).toEqual(descendant.files);
  } finally {
    await secondHost?.close();
    await firstHost.close();
    await testInfo.attach('source-reproduction-evidence', {
      body: JSON.stringify(evidence, null, 2), contentType: 'application/json'
    });
  }
});

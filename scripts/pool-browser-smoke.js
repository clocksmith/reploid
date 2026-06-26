#!/usr/bin/env node

const args = process.argv.slice(2);
const allowLocal = args.includes('--allow-local') || process.env.REPLOID_POOL_SMOKE_ALLOW_LOCAL === '1';
const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = (positionalUrl || process.env.REPLOID_POOL_SMOKE_URL || '').replace(/\/+$/, '');

if (!baseUrl) {
  console.error('REPLOID_POOL_SMOKE_URL or first argument is required');
  process.exit(1);
}

const routes = ['/', '/run', '/contribute', '/agents', '/receipts', '/reputation', '/0'];
const requiredText = {
  '/': 'Reploid',
  '/run': 'Prompt',
  '/contribute': 'Contribute',
  '/agents': 'Submit',
  '/receipts': 'Record',
  '/reputation': 'Record',
  '/0': 'Reploid'
};

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript(() => {
  const model = {
    modelId: 'gemma-3-270m-it-q4k-ehf16-af32',
    modelHash: 'sha256:b55fde5809dbc198f880b08af21e40e3175a6d2f9f88a9fad59fa0afd7190dc9',
    manifestHash: 'sha256:abac153d8cee1b6cc4fd2743defa84b91f67b3d030af028bbd5ed8ba8cabee6b',
    contextLength: 32768,
    quantization: 'q4k',
    runtime: 'doppler',
    backend: 'browser-webgpu'
  };
  window.REPLOID_DOPPLER_RUNTIME = {
    isReady: () => true,
    loadModel: async () => ({ ok: true, model }),
    getModelInfo: () => model,
    getRuntimeInfo: () => ({
      runtime: 'doppler',
      backend: 'browser-webgpu',
      publicApi: 'generate',
      profile: { smoke: true }
    }),
    getRuntimeProfile: async () => ({
      runtimeProfile: {
        profileVersion: 'pool-smoke',
        model,
        runtime: { runtime: 'doppler', backend: 'browser-webgpu' },
        device: { hasWebGPU: true, probeStatus: 'smoke' },
        browser: { userAgent: 'pool-smoke' }
      },
      runtimeProfileHash: 'sha256:pool_smoke_runtime'
    }),
    getDeviceInfo: async () => ({ hasWebGPU: true, probeStatus: 'smoke' }),
    generate: async ({ prompt }) => ({
      outputText: `smoke:${prompt}`,
      tokenIds: [101, 102, 103],
      transcript: {
        outputText: `smoke:${prompt}`,
        tokenIds: [101, 102, 103]
      },
      tokenCounts: {
        input: 8,
        output: 3
      },
      timing: {
        startedAt: '2026-06-14T00:00:00.000Z',
        completedAt: '2026-06-14T00:00:01.000Z'
      },
      status: 'completed'
    })
  };
});
const page = await context.newPage();
const failures = [];

const gotoRoute = async (targetPage, route) => {
  const response = await targetPage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) failures.push(`${route} returned ${response?.status() || 'no response'}`);
  if (route === '/0') {
    await targetPage.waitForSelector('.wizard-home-provider [data-action="choose-proxy"]', { timeout: 30000 });
    return response;
  }
  await targetPage.waitForSelector('.pool-home', { timeout: 30000 });
  return response;
};

for (const route of routes) {
  try {
    await gotoRoute(page, route);
    const expected = String(requiredText[route] || '').toLowerCase();
    await page.waitForFunction((text) => document.body.textContent.toLowerCase().includes(text), expected);
    const body = String(await page.textContent('body') || '').toLowerCase();
    if (!body.includes(expected)) {
      failures.push(`${route} did not include expected text: ${requiredText[route]}`);
    }
  } catch (error) {
    failures.push(`${route} failed: ${error.message}`);
  }
}

try {
  await gotoRoute(page, '/');
  await page.evaluate(() => {
    window.__REPLOID_POOL_SMOKE_MARKER = 'same-document-route';
  });
  await page.click('[data-pool-route-link="/run"]');
  await page.waitForFunction(() => window.location.pathname === '/run');
  const runMarker = await page.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (runMarker !== 'same-document-route') failures.push('route toggle to /run reloaded the boot document');
  await page.click('[data-pool-route-link="/mesh"]');
  await page.waitForFunction(() => window.location.pathname === '/mesh');
  const meshMarker = await page.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (meshMarker !== 'same-document-route') failures.push('route toggle to /mesh reloaded the boot document');
} catch (error) {
  failures.push(`same-document route smoke failed: ${error.message}`);
}

try {
  const room = `pool-smoke-${Date.now().toString(36)}`;
  const provider = await context.newPage();
  const requester = await context.newPage();
  await provider.goto(`${baseUrl}/contribute?room=${room}`, { waitUntil: 'domcontentloaded' });
  await provider.waitForSelector('.pool-home', { timeout: 30000 });
  await provider.waitForSelector('#pool-provider-worker-start');
  await provider.click('#pool-provider-worker-start');
  await provider.waitForFunction(() => document.body.textContent.includes('peer_room_listening'));
  await requester.goto(`${baseUrl}/run?room=${room}`, { waitUntil: 'domcontentloaded' });
  await requester.waitForSelector('.pool-home', { timeout: 30000 });
  await requester.waitForSelector('#pool-run-submit');
  await requester.fill('#pool-run-prompt', 'browser peer smoke');
  await requester.click('#pool-run-submit');
  await requester.waitForFunction(() => document.body.textContent.includes('smoke:browser peer smoke'));
  await requester.goto(`${baseUrl}/reputation?room=${room}`, { waitUntil: 'domcontentloaded' });
  await requester.waitForSelector('.pool-home', { timeout: 30000 });
  await requester.waitForSelector('#pool-peer-ledger', { timeout: 30000, state: 'attached' });
  const peerLedger = await requester.evaluate(() => {
    const ledger = document.querySelector('#pool-peer-ledger');
    return {
      exists: !!ledger,
      hasLedgerTable: !!ledger?.querySelector('[aria-label="Local peer ledger"]'),
      text: ledger?.textContent || ''
    };
  });
  if (!peerLedger.exists || (!peerLedger.hasLedgerTable && !peerLedger.text.includes('local peer ledger'))) {
    failures.push('reputation route did not expose local peer ledger');
  }
  await provider.close();
  await requester.close();
} catch (error) {
  failures.push(`peer browser smoke failed: ${error.message}`);
}

try {
  const deployment = await page.evaluate(async () => {
    const response = await fetch('/pool/deployment/check');
    return response.json();
  });
  if (allowLocal) {
    if (!deployment.config?.version && !deployment.configVersion) failures.push('/pool/deployment/check did not expose config version');
  } else {
    if (deployment.ok !== true) failures.push('/pool/deployment/check did not return ok=true');
    if (deployment.store?.commitReveal?.supported !== true) failures.push('commit-reveal support missing from deployment check');
    if (deployment.identity?.serverAuth?.required !== true) failures.push('server auth is not required in deployment check');
  }
} catch (error) {
  failures.push(`deployment check failed in browser: ${error.message}`);
}

await browser.close();

if (failures.length > 0) {
  console.error('Pool browser smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Pool browser smoke passed for ${baseUrl}`);

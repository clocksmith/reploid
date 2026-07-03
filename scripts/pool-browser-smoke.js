#!/usr/bin/env node

const args = process.argv.slice(2);
const allowLocal = args.includes('--allow-local') || process.env.REPLOID_POOL_SMOKE_ALLOW_LOCAL === '1';
const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = (positionalUrl || process.env.REPLOID_POOL_SMOKE_URL || '').replace(/\/+$/, '');

if (!baseUrl) {
  console.error('REPLOID_POOL_SMOKE_URL or first argument is required');
  process.exit(1);
}

const { LAUNCH_MODEL } = await import('../self/pool/model-contract.js');
const routes = ['/', '/ask', '/compute', '/history', '/network', '/zero'];
const requiredText = {
  '/': 'Run browser models together',
  '/ask': 'Prompt',
  '/compute': 'Worker',
  '/history': 'History',
  '/network': 'Network',
  '/zero': 'Zero'
};

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const context = await browser.newContext();
await context.addInitScript((launchModel) => {
  const model = { ...launchModel };
  const textEncoder = new TextEncoder();
  const bytesToHex = (bytes) => Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const canonicalize = (value) => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  };
  const sha256Hex = async (value) => {
    const input = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', input);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  };
  const hashJson = async (value) => sha256Hex(canonicalize(value));
  const buildRuntimeProfile = () => ({
    profileVersion: 'pool-smoke',
    model,
    runtime: {
      runtime: model.runtime,
      backend: model.backend,
      publicApi: 'generate'
    },
    device: { hasWebGPU: true, probeStatus: 'smoke' },
    browser: { userAgent: 'pool-smoke' }
  });
  window.REPLOID_POOL_RELAY_MODE = 'local';
  window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
  window.REPLOID_POOL_RECEIPT_WINDOW_MS = 30000;
  window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
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
    getRuntimeProfile: async () => {
      const runtimeProfile = buildRuntimeProfile();
      return {
        runtimeProfile,
        runtimeProfileHash: await hashJson(runtimeProfile)
      };
    },
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
}, LAUNCH_MODEL);
const page = await context.newPage();
const failures = [];

const gotoRoute = async (targetPage, route) => {
  const response = await targetPage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) failures.push(`${route} returned ${response?.status() || 'no response'}`);
  if (route === '/zero') {
    await targetPage.waitForFunction(() => document.title === 'Zero' || document.body.textContent.includes('Zero'));
    return response;
  }
  await targetPage.waitForSelector('.pool-home', { timeout: 30000 });
  return response;
};

const clickPoolRoute = async (targetPage, route) => {
  const nav = targetPage.locator('.pool-nav-rail');
  await nav.waitFor({ timeout: 30000 });
  const isOpen = await nav.evaluate((node) => node.classList.contains('is-open'));
  if (!isOpen) await nav.locator('.pool-nav-toggle').click();
  await targetPage.locator(`[data-pool-route-link="${route}"]`).click();
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
  const routePage = await context.newPage();
  await gotoRoute(routePage, '/');
  await routePage.evaluate(() => {
    window.__REPLOID_POOL_SMOKE_MARKER = 'same-document-route';
  });
  await clickPoolRoute(routePage, '/ask');
  await routePage.waitForFunction(() => window.location.pathname === '/ask');
  const runMarker = await routePage.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (runMarker !== 'same-document-route') failures.push('route toggle to /ask reloaded the boot document');
  await clickPoolRoute(routePage, '/compute');
  await routePage.waitForFunction(() => window.location.pathname === '/compute');
  const meshMarker = await routePage.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (meshMarker !== 'same-document-route') failures.push('route toggle to /compute reloaded the boot document');
  await routePage.close();
} catch (error) {
  failures.push(`same-document route smoke failed: ${error.message}`);
}

try {
  const room = `pool-smoke-${Date.now().toString(36)}`;
  const provider = await context.newPage();
  const requester = await context.newPage();
  await provider.goto(`${baseUrl}/compute?room=${room}`, { waitUntil: 'domcontentloaded' });
  await provider.waitForSelector('.pool-home', { timeout: 30000 });
  await provider.waitForSelector('#pool-provider-worker-start');
  await provider.click('#pool-provider-worker-start');
  await provider.waitForFunction(() => document.body.textContent.includes('peer_room_listening'));
  await requester.goto(`${baseUrl}/ask?room=${room}`, { waitUntil: 'domcontentloaded' });
  await requester.waitForSelector('.pool-home', { timeout: 30000 });
  await requester.waitForSelector('#pool-run-submit');
  await requester.fill('#pool-run-prompt', 'browser peer smoke');
  await requester.click('#pool-run-submit');
  await requester.waitForFunction(() => document.body.textContent.includes('smoke:browser peer smoke'));
  await requester.goto(`${baseUrl}/network?room=${room}`, { waitUntil: 'domcontentloaded' });
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
    failures.push('network route did not expose local peer ledger');
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

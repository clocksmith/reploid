#!/usr/bin/env node

const baseUrl = (process.argv[2] || process.env.REPLOID_POOL_SMOKE_URL || '').replace(/\/+$/, '');

if (!baseUrl) {
  console.error('REPLOID_POOL_SMOKE_URL or first argument is required');
  process.exit(1);
}

const routes = ['/', '/run', '/contribute', '/reputation', '/0'];
const requiredText = {
  '/': 'provider tabs',
  '/run': 'Submit text',
  '/contribute': 'Provider',
  '/reputation': 'History',
  '/0': 'Reploid'
};

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];

for (const route of routes) {
  const url = `${baseUrl}${route}`;
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    if (!response || !response.ok()) failures.push(`${route} returned ${response?.status() || 'no response'}`);
    const body = String(await page.textContent('body') || '').toLowerCase();
    const expected = String(requiredText[route] || '').toLowerCase();
    if (!body.includes(expected)) {
      failures.push(`${route} did not include expected text: ${requiredText[route]}`);
    }
  } catch (error) {
    failures.push(`${route} failed: ${error.message}`);
  }
}

try {
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__REPLOID_POOL_SMOKE_MARKER = 'same-document-route';
  });
  await page.click('[data-pool-route="/run"]');
  await page.waitForFunction(() => window.location.pathname === '/run');
  const runMarker = await page.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (runMarker !== 'same-document-route') failures.push('route toggle to /run reloaded the boot document');
  await page.click('[data-pool-route="/contribute"]');
  await page.waitForFunction(() => window.location.pathname === '/contribute');
  const contributeMarker = await page.evaluate(() => window.__REPLOID_POOL_SMOKE_MARKER);
  if (contributeMarker !== 'same-document-route') failures.push('route toggle to /contribute reloaded the boot document');
} catch (error) {
  failures.push(`same-document route smoke failed: ${error.message}`);
}

try {
  const deployment = await page.evaluate(async () => {
    const response = await fetch('/pool/deployment/check');
    return response.json();
  });
  if (deployment.ok !== true) failures.push('/pool/deployment/check did not return ok=true');
  if (deployment.store?.commitReveal?.supported !== true) failures.push('commit-reveal support missing from deployment check');
  if (deployment.identity?.serverAuth?.required !== true) failures.push('server auth is not required in deployment check');
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

#!/usr/bin/env node

const baseUrl = (process.argv[2] || process.env.REPLOID_POOL_SMOKE_URL || '').replace(/\/+$/, '');

if (!baseUrl) {
  console.error('REPLOID_POOL_SMOKE_URL or first argument is required');
  process.exit(1);
}

const routes = ['/', '/run', '/contribute', '/agents', '/receipts', '/reputation', '/0'];
const requiredText = {
  '/': 'Browser-local inference',
  '/run': 'Requester',
  '/contribute': 'Provider',
  '/agents': 'Agent',
  '/receipts': 'Receipt',
  '/reputation': 'Reputation',
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
    const body = await page.textContent('body');
    if (!String(body || '').includes(requiredText[route])) {
      failures.push(`${route} did not include expected text: ${requiredText[route]}`);
    }
  } catch (error) {
    failures.push(`${route} failed: ${error.message}`);
  }
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

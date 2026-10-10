#!/usr/bin/env node

const args = process.argv.slice(2);
const allowLocal = args.includes('--allow-local') || process.env.REPLOID_POOL_SMOKE_ALLOW_LOCAL === '1';
const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = (positionalUrl || process.env.REPLOID_POOL_SMOKE_URL || '').replace(/\/+$/, '');

if (!baseUrl) {
  console.error('REPLOID_POOL_SMOKE_URL or first argument is required');
  process.exit(1);
}

// Deployment checks exercise the real application without injecting a model.
// The separate distributed test proves acquisition, generation and recovery.
const routes = ['/', '/work', '/network', '/improve', '/examples', '/ask', '/compute', '/records', '/room-1', '/history'];
const requiredSelectors = {
  '/': '[data-composer-form]',
  '/work': '[data-composer-form]',
  '/network': '[data-network-workspace]',
  '/improve': '[data-work-history]',
  '/examples': '#pool-home-ask-form',
  '/ask': '#pool-run-prompt',
  '/compute': '#pool-provider-worker-toggle',
  '/records': '#pool-record-ledger',
  '/room-1': '#pool-room-1-request',
  '/history': '#pool-record-ledger'
};

const { chromium, expect } = await import('@playwright/test');
const channel = args.find(arg => arg.startsWith('--channel='))?.slice('--channel='.length);
const browser = await chromium.launch({ ...(channel ? { channel } : {}) });
const context = await browser.newContext();
const weightRequests = [], browserErrors = [];
context.on('request', request => {
  if (/huggingface\.co|shard_\d+\.bin/.test(request.url())) weightRequests.push(request.url());
});
context.on('page', page => page.on('pageerror', error => browserErrors.push(error.message)));
const page = await context.newPage();
const failures = [];

const gotoRoute = async (targetPage, route) => {
  const response = await targetPage.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
  if (!response || !response.ok()) failures.push(`${route} returned ${response?.status() || 'no response'}`);
  await targetPage.waitForSelector('.pool-home', { timeout: 30000 });
  return response;
};

for (const route of routes) {
  const routePage = await context.newPage();
  try {
    console.log(`[pool-smoke] route ${route}`);
    await gotoRoute(routePage, route);
    await routePage.waitForSelector(requiredSelectors[route], { timeout: 30000, state: 'attached' });
    if (route === '/network') {
      const inspector = routePage.locator('[data-network-workspace]');
      await expect(inspector).toBeVisible();
      await expect(inspector.locator('[data-inspector-pane="participants"]')).toBeVisible();
      await inspector.locator('[data-inspector-section="device"]').click();
      for (const selector of ['[data-toggle-contribution]', '[data-toggle-file-contribution]']) {
        await expect(inspector.locator(selector)).toBeVisible();
        await expect(inspector.locator(selector)).toHaveAttribute('aria-checked', 'false');
      }
      await inspector.locator('[data-close-inspector]').click();
      await expect(inspector).toBeHidden();
      await expect(routePage.locator('[data-composer-input]')).toBeVisible();
    }
    for (const width of [1440, 390]) {
      await routePage.setViewportSize({ width, height: 1000 });
      const frame = await routePage.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const header = document.querySelector('.pool-primary-nav').getBoundingClientRect();
        const content = document.querySelector('.pool-route-content');
        const page = content.firstElementChild.getBoundingClientRect();
        const bounds = content.getBoundingClientRect();
        return { header: { x: header.x, width: header.width }, content: { x: bounds.x, width: bounds.width },
          page: { x: page.x, width: page.width } };
      });
      if (Math.abs(frame.header.x - frame.content.x) > 1 || Math.abs(frame.header.width - frame.content.width) > 1) {
        failures.push(route + ' at ' + width + 'px: content does not match the header: ' + JSON.stringify(frame));
      }
      const headerCenter = frame.header.x + frame.header.width / 2;
      const pageCenter = frame.page.x + frame.page.width / 2;
      if (Math.abs(headerCenter - pageCenter) > 1) {
        failures.push(route + ' at ' + width + 'px: page is not centered under the header: ' + JSON.stringify(frame));
      }
    }
    if (route === '/' || route === '/work') {
      for (const selector of ['[data-composer-input]', '[data-composer-files]', '[data-composer-send]', '[data-message-stream]']) {
        await routePage.waitForSelector(selector, { timeout: 30000, state: 'attached' });
      }
      if (await routePage.locator('[data-work-example]').count()) failures.push(route + ' still exposes prompt-only task buttons');
    }
    console.log(`[pool-smoke] route passed ${route}`);
  } catch (error) {
    failures.push(`${route} failed: ${error.message}`);
  } finally {
    await routePage.close();
  }
}

try {
  console.log('[pool-smoke] ordinary conversation and unsent draft');
  await gotoRoute(page, '/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await expect(page.locator('[data-active-model-select]')).toBeAttached();
  await expect(page.locator('[data-new-thread]')).toBeVisible();
  await expect(page.locator('[data-chat-approval]')).toBeHidden();
  await expect(page.locator('[data-mesh-invite]')).toBeHidden();
  await page.locator('[data-toggle-inspector]').click();
  for (const selector of ['[data-toggle-contribution]', '[data-toggle-file-contribution]']) {
    await expect(page.locator(selector)).toHaveAttribute('aria-checked', 'false');
  }
  await expect(page.locator('[data-contrib-label]')).toHaveText('Not sharing');
  await expect(page.locator('[data-file-contribution-label]')).toHaveText('Not sharing');
  await expect(page.locator('[data-contribution-model] option')).not.toHaveCount(0);
  await page.locator('[data-close-inspector]').click();
  const draft = 'Unsent deployment check: retain this draft across reload and navigation.';
  await page.locator('[data-composer-input]').fill(draft);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
  await gotoRoute(page, '/work');
  await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
  await expect(page.locator('[data-message-stream] .chat-message-row')).toHaveCount(0);
  await expect(page.locator('[data-chat-approval]')).toBeHidden();
  console.log('[pool-smoke] conversation controls, optional contribution and draft persistence passed');
} catch (error) {
  failures.push(`conversation browser smoke failed: ${error.message}`);
}

try {
  console.log('[pool-smoke] deployment check');
  await gotoRoute(page, '/');
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
  console.log('[pool-smoke] deployment check passed');
} catch (error) {
  failures.push(`deployment check failed in browser: ${error.message}`);
}

if (weightRequests.length) failures.push(`Idle requester downloaded model weights: ${weightRequests.join(', ')}`);
if (browserErrors.length) failures.push(`Browser errors: ${browserErrors.join('; ')}`);
await browser.close();

if (failures.length > 0) {
  console.error('Pool browser smoke failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Application browser smoke passed for ${baseUrl}; no model execution asserted`);

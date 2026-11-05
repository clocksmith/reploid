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

// Home, /work and /network render the conversation workspace. It renders no app bar:
// its own toolbar carries the brand, Threads, New thread, Computers and Settings, and
// the inspector stays closed until one of those opens it. On phones the toolbar docks
// below the conversation. Every other route keeps the app bar above its content.
const WORKSPACE_ROUTES = ['/', '/work', '/network'];
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const PHONE_MAX_WIDTH = 760;
const workspaceToolbarControls = {
  brand: '.pool-primary-brand[aria-label="Reploid home"]',
  threads: '[data-toggle-thread-rail]',
  newThread: '[data-new-thread]',
  computers: '[data-toggle-inspector][data-inspector-section="participants"]',
  settings: '[data-inspector-section="settings"]'
};

const checkWorkspaceAtLoad = async (routePage, route) => {
  const workspace = routePage.locator('[data-chat-workspace]');
  await expect(workspace).toBeVisible();
  await expect(routePage.locator('.pool-primary-nav')).toHaveCount(0);
  const toolbar = routePage.locator('[data-chat-rail-toolbar]');
  await expect(toolbar).toBeVisible();
  for (const selector of Object.values(workspaceToolbarControls)) await expect(toolbar.locator(selector)).toBeVisible();
  await expect(toolbar.locator(workspaceToolbarControls.brand)).toHaveAttribute('href', '/');
  await expect(routePage.locator('[data-network-workspace]')).toBeHidden();
  await expect(routePage.locator('.pool-home')).not.toHaveAttribute('data-network-panel-open', '');
  await expect(routePage.locator('[data-toggle-inspector]')).toHaveAttribute('aria-expanded', 'false');
  // Shared models come first; device contribution sits below the shared choices.
  const shared = routePage.locator('[data-production-shared]');
  await expect(shared).toBeVisible();
  const order = await routePage.evaluate(() => {
    const shared = document.querySelector('[data-production-shared]');
    const follows = selector => Boolean(shared.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { composer: follows('[data-composer-area]'), device: follows('[data-production-device]') };
  });
  if (!order.composer || !order.device) failures.push(`${route}: shared models do not precede the composer and device contribution: ${JSON.stringify(order)}`);
};

const workspaceFrameFailures = async (routePage, route, width) => {
  const frame = await routePage.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { toolbar: box('[data-chat-rail-toolbar]'), page: document.querySelector('.pool-route-content').firstElementChild.getBoundingClientRect().toJSON(),
      area: box('[data-conversation-area]'), composer: box('[data-composer-area]'), input: box('[data-composer-input]'), send: box('[data-composer-send]'),
      shared: box('[data-production-shared]'), viewport: { width: innerWidth, height: innerHeight }, overflowX: document.documentElement.scrollWidth - innerWidth };
  });
  const found = [], at = `${route} at ${width}px`, center = rect => rect.x + rect.width / 2, detail = JSON.stringify(frame);
  if (frame.overflowX > 1) found.push(`${at}: page scrolls horizontally: ${detail}`);
  if (Math.abs(center(frame.toolbar) - center(frame.page)) > 1) found.push(`${at}: conversation is not centered under the workspace toolbar: ${detail}`);
  if (Math.abs(center(frame.composer) - center(frame.area)) > 1) found.push(`${at}: composer is not centered in the conversation: ${detail}`);
  if (frame.composer.right > frame.viewport.width - 8) found.push(`${at}: composer reaches the viewport edge: ${detail}`);
  if (frame.shared.bottom > frame.composer.y + 1) found.push(`${at}: shared models do not sit above the composer: ${detail}`);
  if (width > PHONE_MAX_WIDTH) {
    if (frame.toolbar.y > frame.area.y) found.push(`${at}: workspace toolbar is not above the conversation: ${detail}`);
    if (frame.area.y < frame.toolbar.bottom + 8) found.push(`${at}: conversation overlaps the workspace toolbar: ${detail}`);
  } else {
    // The phone dock sits at the bottom of the first screen, with the input and Send above it.
    if (frame.toolbar.bottom > frame.viewport.height + 1 || frame.toolbar.y < frame.area.bottom - 1) found.push(`${at}: workspace toolbar is not docked below the conversation: ${detail}`);
    for (const name of ['input', 'send']) {
      if (frame[name].y < 0 || frame[name].bottom > frame.toolbar.y + 1) found.push(`${at}: ${name} is not on the first screen above the dock: ${detail}`);
    }
  }
  return found;
};

const appBarFrameFailures = async (routePage, route, width) => {
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
  const found = [];
  if (Math.abs(frame.header.x - frame.content.x) > 1 || Math.abs(frame.header.width - frame.content.width) > 1) {
    found.push(route + ' at ' + width + 'px: content does not match the header: ' + JSON.stringify(frame));
  }
  const headerCenter = frame.header.x + frame.header.width / 2;
  const pageCenter = frame.page.x + frame.page.width / 2;
  if (Math.abs(headerCenter - pageCenter) > 1) {
    found.push(route + ' at ' + width + 'px: page is not centered under the header: ' + JSON.stringify(frame));
  }
  return found;
};

// /network opens the same workspace; its Computers control opens the inspector,
// which takes the conversation column until it closes.
const checkNetworkInspector = async (routePage) => {
  const inspector = routePage.locator('[data-network-workspace]');
  const computers = routePage.locator(`[data-chat-rail-toolbar] ${workspaceToolbarControls.computers}`);
  await computers.click();
  await expect(inspector).toBeVisible();
  await expect(computers).toHaveAttribute('aria-expanded', 'true');
  await expect(routePage.locator('#network-inspector-title')).toHaveText('Computers');
  const participants = inspector.locator('[data-inspector-pane="participants"]');
  await expect(participants).toBeVisible();
  const panel = await routePage.evaluate(() => ({ area: document.querySelector('[data-conversation-area]').getBoundingClientRect().width,
    slot: document.querySelector('[data-chat-inspector-slot]').getBoundingClientRect().toJSON(), width: innerWidth,
    open: document.querySelector('.pool-home').hasAttribute('data-network-panel-open') }));
  if (!panel.open || panel.area !== 0 || !(panel.slot.width > 0) || panel.slot.right > panel.width - 8) {
    failures.push('/network: the open inspector does not take the conversation column: ' + JSON.stringify(panel));
  }
  // This device's compute sharing sits in a disclosure under Computers; file sharing
  // sits with Storage in Settings. Both default on, but an idle visitor has nothing
  // cached to share.
  await participants.locator('details:has([data-toggle-contribution]) > summary').click();
  await expect(participants.locator('[data-toggle-contribution]')).toBeVisible();
  await expect(participants.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'true');
  await routePage.locator(`[data-chat-rail-toolbar] ${workspaceToolbarControls.settings}`).click();
  const settings = inspector.locator('[data-inspector-pane="settings"]');
  await expect(settings).toBeVisible();
  await expect(participants).toBeHidden();
  await expect(routePage.locator('#network-inspector-title')).toHaveText('Settings');
  await expect(settings.locator('[data-settings-storage] [data-toggle-file-contribution]')).toBeVisible();
  await expect(settings.locator('[data-toggle-file-contribution]')).toHaveAttribute('aria-checked', 'true');
  await inspector.locator('[data-close-inspector]').click();
  await expect(inspector).toBeHidden();
  await expect(routePage.locator('.pool-home')).not.toHaveAttribute('data-network-panel-open', '');
  await expect(routePage.locator('[data-composer-input]')).toBeVisible();
};

for (const route of routes) {
  const routePage = await context.newPage();
  try {
    console.log(`[pool-smoke] route ${route}`);
    await gotoRoute(routePage, route);
    await routePage.waitForSelector(requiredSelectors[route], { timeout: 30000, state: 'attached' });
    const workspace = WORKSPACE_ROUTES.includes(route);
    if (workspace) await checkWorkspaceAtLoad(routePage, route);
    for (const viewport of VIEWPORTS) {
      await routePage.setViewportSize(viewport);
      failures.push(...await (workspace ? workspaceFrameFailures : appBarFrameFailures)(routePage, route, viewport.width));
    }
    if (workspace) {
      for (const selector of ['[data-composer-input]', '[data-composer-files]', '[data-composer-send]', '[data-message-stream]']) {
        await routePage.waitForSelector(selector, { timeout: 30000, state: 'attached' });
      }
      if (await routePage.locator('[data-work-example]').count()) failures.push(route + ' still exposes prompt-only task buttons');
    }
    if (route === '/network') {
      await routePage.setViewportSize(VIEWPORTS[0]);
      await checkNetworkInspector(routePage);
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
  // Cached compute and file sharing default on; an idle visitor waits with nothing to share.
  for (const selector of ['[data-toggle-contribution]', '[data-toggle-file-contribution]']) {
    await expect(page.locator(selector)).toHaveAttribute('aria-checked', 'true');
  }
  await expect(page.locator('[data-contrib-label]')).toHaveText('On · waiting for a downloaded model');
  await expect(page.locator('[data-file-contribution-label]')).toHaveText('On · waiting for cached files');
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
    const auth = deployment.identity?.serverAuth;
    if (auth?.protectedDefault !== 'authentication-required' || auth.verifierConfigured !== true
      || !Array.isArray(auth.publicExceptions) || auth.localDevelopment?.configured !== false) {
      failures.push('deployment auth policy lacks protected authentication, explicit exceptions, or permits hosted local bypass');
    }
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

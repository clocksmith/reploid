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
  '/': '[data-composer-area]',
  '/work': '[data-composer-area]',
  '/network': '[data-network-workspace]',
  // Past attempts render only once this visitor has some; a fresh release visitor has none.
  '/improve': '[data-route-page-content="improve"]',
  '/examples': '[data-pool-home-ask-form]',
  '/ask': '[data-pool-run-prompt]',
  '/compute': '[data-pool-provider-worker-toggle]',
  '/records': '[data-pool-record-ledger]',
  '/room-1': '[data-pool-room-1-request]',
  '/history': '[data-pool-record-ledger]'
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

// Home, /work and /network are the React conversation workspace. It renders no app bar:
// its own bar carries Threads, Conversation details, Computers and Settings, and every
// drawer stays closed until one of those opens it. On phones the bar docks below the
// conversation. Every other route is the vanilla shell, with the app bar above its content.
const WORKSPACE_ROUTES = ['/', '/work', '/network'];
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const PHONE_MAX_WIDTH = 760;
const workspaceToolbarControls = {
  threads: '[data-toggle-thread-rail]',
  computers: '[data-workspace-view="computers"]',
  settings: '[data-inspector-section="settings"]'
};

const checkWorkspaceAtLoad = async (routePage, route) => {
  const workspace = routePage.locator('[data-chat-workspace]');
  await expect(workspace).toBeVisible();
  await expect(routePage.locator('.pool-primary-nav')).toHaveCount(0);
  const toolbar = routePage.locator('[data-chat-rail-toolbar]');
  await expect(toolbar).toBeVisible();
  for (const selector of Object.values(workspaceToolbarControls)) await expect(toolbar.locator(selector)).toBeVisible();
  await expect(toolbar.locator(workspaceToolbarControls.threads)).toHaveAttribute('href', /[?&]view=threads(?:&|$)/);
  await expect(toolbar.locator('[data-new-thread]')).toHaveCount(0);
  await expect(routePage.locator('[data-new-thread]')).toHaveCount(1);
  await expect(routePage.locator('[data-threads-dialog]')).toBeHidden();
  await expect(routePage.locator('[data-network-workspace]:visible')).toHaveCount(0);
  await expect(routePage.locator('.pool-workspace[data-end-open]')).toHaveCount(0);
  await expect(routePage.locator(workspaceToolbarControls.computers)).not.toHaveAttribute('aria-current', 'page');
  // One chooser belongs to the composer; the removed model-card list must not return.
  await expect(routePage.locator('[data-production-shared]')).toHaveCount(0);
  await expect(routePage.locator('[data-production-device]')).toBeHidden();
  const chooser = routePage.locator('[data-open-model]');
  await expect(chooser).toHaveCount(1);
  await expect(routePage.locator('[data-composer-area] [data-open-model]')).toBeVisible();
  await expect(routePage.locator('[data-model-picker]')).toBeHidden();
  await chooser.focus();
  await chooser.press('Enter');
  await expect(routePage.locator('[data-model-picker]')).toBeVisible();
  await routePage.keyboard.press('Escape');
  await expect(routePage.locator('[data-model-picker]')).toBeHidden();
  await expect(chooser).toBeFocused();
};

const workspaceFrameFailures = async (routePage, route, width) => {
  const frame = await routePage.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { toolbar: box('[data-chat-rail-toolbar]'), page: document.querySelector('.pool-workspace-main').getBoundingClientRect().toJSON(),
      area: box('[data-conversation-area]'), composer: box('[data-composer-area]'), input: box('[data-composer-input]'), send: box('[data-composer-send]'),
      model: box('[data-open-model]'), viewport: { width: innerWidth, height: innerHeight }, overflowX: document.documentElement.scrollWidth - innerWidth };
  });
  const found = [], at = `${route} at ${width}px`, center = rect => rect.x + rect.width / 2, detail = JSON.stringify(frame);
  if (frame.overflowX > 1) found.push(`${at}: page scrolls horizontally: ${detail}`);
  if (Math.abs(center(frame.toolbar) - center(frame.page)) > 1) found.push(`${at}: conversation is not centered under the workspace toolbar: ${detail}`);
  if (Math.abs(center(frame.composer) - center(frame.area)) > 1) found.push(`${at}: composer is not centered in the conversation: ${detail}`);
  if (frame.composer.right > frame.viewport.width - 8) found.push(`${at}: composer reaches the viewport edge: ${detail}`);
  if (frame.model.left < frame.composer.left - 1 || frame.model.right > frame.composer.right + 1
    || frame.model.top < frame.composer.top - 1 || frame.model.bottom > frame.composer.bottom + 1) {
    found.push(`${at}: model chooser escapes the composer: ${detail}`);
  }
  if (width > PHONE_MAX_WIDTH) {
    // Desktop navigation rail sits along the start edge beside the conversation without overlapping it.
    if (frame.toolbar.right > frame.area.x + 1) found.push(`${at}: workspace rail overlaps the conversation: ${detail}`);
  } else {
    // Mobile visible navigation bar docks at the bottom of the first screen, with input, Send and model above it.
    if (frame.toolbar.bottom > frame.viewport.height + 1 || frame.toolbar.y < frame.area.bottom - 1) found.push(`${at}: workspace bar is not docked below the conversation: ${detail}`);
    for (const name of ['input', 'send', 'model']) {
      if (frame[name].y < 0 || frame[name].bottom > frame.toolbar.y + 1) found.push(`${at}: ${name} is not on the first screen above the dock: ${detail}`);
    }
  }
  return found;
};

const appBarFrameFailures = async (routePage, route, width) => {
  const frame = await routePage.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // A specialist page: vertical navigation rail on desktop or bottom navigation bar on mobile.
    const header = document.querySelector('[data-route-page] [data-app-bar]').getBoundingClientRect();
    const content = document.querySelector('[data-route-page] .pool-workspace-main');
    const page = content.firstElementChild.getBoundingClientRect();
    const bounds = content.getBoundingClientRect();
    return { header: { x: header.x, y: header.y, width: header.width, right: header.right, bottom: header.bottom },
      content: { x: bounds.x, y: bounds.y, width: bounds.width, bottom: bounds.bottom },
      page: { x: page.x, width: page.width } };
  });
  const found = [];
  if (width > PHONE_MAX_WIDTH) {
    if (frame.header.right > frame.content.x + 1) {
      found.push(route + ' at ' + width + 'px: navigation rail overlaps content: ' + JSON.stringify(frame));
    }
  } else if (frame.header.y < frame.content.bottom - 1) {
    found.push(route + ' at ' + width + 'px: mobile navigation bar overlaps content: ' + JSON.stringify(frame));
  }
  const contentCenter = frame.content.x + frame.content.width / 2;
  const pageCenter = frame.page.x + frame.page.width / 2;
  if (Math.abs(contentCenter - pageCenter) > 1) {
    found.push(route + ' at ' + width + 'px: page is not centered in content column: ' + JSON.stringify(frame));
  }
  return found;
};

// /network opens the same workspace; its Computers control opens the inspector,
// which preserves the center conversation while the right drawer is open.
const checkNetworkInspector = async (routePage) => {
  const computers = routePage.locator(`[data-chat-rail-toolbar] ${workspaceToolbarControls.computers}`);
  await computers.click();
  const participants = routePage.locator('[data-inspector-pane="participants"]');
  await expect(participants).toBeVisible();
  await expect(computers).toHaveAttribute('aria-current', 'page');
  await expect(participants.locator('h2').first()).toHaveText('Computers');
  await expect.poll(async () => {
    const rect = await participants.boundingBox();
    return rect ? rect.x + rect.width : Infinity;
  }).toBeLessThanOrEqual(routePage.viewportSize().width);
  const panel = await routePage.evaluate(() => ({ area: document.querySelector('[data-conversation-area]').getBoundingClientRect().width,
    slot: document.querySelector('[data-inspector-pane="participants"]').getBoundingClientRect().toJSON(), width: innerWidth,
    open: !!document.querySelector('.pool-workspace[data-end-open]') }));
  if (!panel.open || !(panel.area > 0) || !(panel.slot.width > 0) || panel.slot.right > panel.width) {
    failures.push('/network: the open inspector does not preserve the conversation within the viewport: ' + JSON.stringify(panel));
  }
  // Computers owns contribution and Settings owns file sharing.
  // Both start off: serving is the producer's choice.
  await participants.locator('details:has([data-toggle-contribution]) > summary').click();
  await expect(participants.locator('[data-toggle-contribution]')).toBeVisible();
  await expect(participants.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'false');
  await routePage.locator(`[data-chat-rail-toolbar] ${workspaceToolbarControls.settings}`).click();
  const settings = routePage.locator('[data-inspector-pane="settings"]');
  await expect(settings).toBeVisible();
  await expect(participants).toBeHidden();
  await expect(settings.locator('h2').first()).toHaveText('Settings');
  const fileSharing = settings.locator('[data-toggle-file-contribution]');
  await expect(fileSharing).toBeVisible();
  await expect(participants.locator('[data-toggle-file-contribution]')).toHaveCount(0);
  await expect(fileSharing).toHaveAttribute('aria-checked', 'false');
  await settings.locator('[data-close-inspector]').click();
  await expect(settings).toBeHidden();
  await expect(routePage.locator('.pool-workspace[data-end-open]')).toHaveCount(0);
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
  await expect(page.locator('[data-open-model]')).toBeAttached();
  await page.locator('[data-toggle-thread-rail]').click();
  await expect(page.locator('[data-threads-dialog]')).toBeVisible();
  await expect(page.locator('[data-new-thread]')).toBeVisible();
  await page.locator('[data-new-thread]').click();
  await expect(page.locator('[data-threads-dialog]')).toBeHidden();
  await expect(page.locator('[data-composer-input]')).toBeFocused();
  await expect(page.locator('[data-chat-approval]')).toBeHidden();
  await expect(page.locator('[data-mesh-invite]')).toBeHidden();
  // A new visitor serves nothing until they choose to: compute sharing in Computers, file sharing in Settings.
  await page.locator(workspaceToolbarControls.computers).click();
  const computersPane = page.locator('[data-inspector-pane="participants"]');
  await computersPane.locator('details:has([data-toggle-contribution]) > summary').click();
  await expect(computersPane.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'false');
  await page.locator(workspaceToolbarControls.settings).click();
  const settingsPane = page.locator('[data-inspector-pane="settings"]');
  await expect(settingsPane.locator('[data-toggle-file-contribution]')).toHaveAttribute('aria-checked', 'false');
  await settingsPane.locator('[data-close-inspector]').click();
  const draft = 'Unsent deployment check: retain this draft across reload and navigation.';
  await page.locator('[data-composer-input]').fill(draft);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
  await gotoRoute(page, '/work');
  await expect(page.locator('[data-composer-input]')).toHaveValue(draft);
  await expect(page.locator('[data-message-stream] [data-message-id]')).toHaveCount(0);
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

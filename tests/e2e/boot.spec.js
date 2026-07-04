/**
 * E2E Test: Boot Flow
 * Covers the current wizard homepage and product mode switch.
 */
import { test, expect } from '@playwright/test';

const APP_PATH = '/index.html';
const HOME_PATH = '/index.html?profile=reploid-home';
const PRODUCT_HOME_PATH = '/';
const DEFAULT_HOME_GOAL_SNIPPET = 'Start from the blueprint index';

async function openBoot(page) {
  await page.goto(APP_PATH);
  await page.waitForSelector('.boot-mode-btn[data-mode="reploid"]', { timeout: 20000 });
}

async function openHome(page) {
  await page.goto(HOME_PATH);
  await page.waitForSelector('.inference-bar', { timeout: 20000 });
}

async function unlockGoalSection(page) {
  await openBoot(page);
  await page.click('[data-action="choose-browser"]');
  await page.click('[data-model="smollm2-360m"]');
  await expect(page.locator('#goal-input')).toBeVisible();
}

async function unlockAwakenSection(page) {
  await unlockGoalSection(page);
  await page.locator('#goal-input').fill('Boot into capsule');
  await expect(page.locator('#awaken-btn')).toBeVisible();
}

test.describe('Boot Screen', () => {
  test('loads with product modes and no duplicate mode heading', async ({ page }) => {
    await openBoot(page);

    await expect(page).toHaveTitle(/Reploid/i);
    await expect(page.locator('.wizard-mode-title')).toHaveCount(0);
    await expect(page.locator('.wizard-mode-copy .type-h1')).toHaveText('Choose runtime mode');
    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');

    const bootModes = page.locator('.boot-mode-btn[data-mode]');
    await expect(bootModes).toHaveCount(3);
  });

  test('has Reploid selected by default', async ({ page }) => {
    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="reploid"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');
  });

  test('ignores stale saved mode and genesis on first load', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('REPLOID_MODE', 'zero');
      localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    });

    await openBoot(page);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="reploid"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="reploid"] .boot-mode-label')).toContainText('Reploid');
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Verify default mode mapping');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('capsule');
  });

  test('shows all three product modes', async ({ page }) => {
    await openBoot(page);

    await expect(page.locator('.boot-mode-btn[data-mode="reploid"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="x"]')).toBeVisible();
  });

  test('allows switching modes with single selection', async ({ page }) => {
    await openBoot(page);

    const zeroMode = page.locator('.boot-mode-btn[data-mode="reploid"]');
    const xMode = page.locator('.boot-mode-btn[data-mode="x"]');

    await expect(zeroMode).toHaveClass(/selected/);
    await xMode.click();
    await expect(xMode).toHaveClass(/selected/);
    await expect(zeroMode).not.toHaveClass(/selected/);
  });
});

test.describe('Route Entry Points', () => {
  test('product root renders the Reploid serving surface', async ({ page }) => {
    await page.goto(PRODUCT_HOME_PATH);
    await page.waitForSelector('.pool-home', { timeout: 20000 });

    await expect(page).toHaveTitle(/^Reploid$/i);
    const nav = page.locator('.pool-nav-rail');
    await expect(nav).toBeVisible();
    await expect(page.locator('.pool-topbar')).toHaveCount(0);
    await expect(page.locator('.pool-home')).toHaveAttribute('data-pool-route-id', 'home');
    await expect(nav.locator('.pool-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.locator('.pool-nav-mark-seven-top')).toHaveText('7');
    await expect(nav.locator('.pool-nav-mark-seven-bottom')).toHaveText('7');
    await expect(nav.locator('.pool-nav-menu')).toBeHidden();
    await expect(page.locator('.pool-home-cta-row').getByRole('link', { name: 'Ask', exact: true })).toHaveAttribute('href', '/ask');
    await expect(page.locator('.pool-home-cta-row').getByRole('link', { name: 'See the Network', exact: true })).toHaveAttribute('href', '/network');
    await nav.locator('.pool-nav-toggle').click();
    await expect(nav.locator('.pool-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Ask', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Compute', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'History', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Network', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Zero' })).toHaveAttribute('href', '/zero');
    await expect(nav.getByRole('link', { name: 'X', exact: true })).toHaveAttribute('href', '/x');
    await expect(page.locator('.pool-home-overlay')).toContainText('Reploid');
    await expect(page.locator('.pool-home-overlay')).toContainText('Run browser models together.');
    await expect(page.locator('[data-pool-flow-label]')).toHaveCount(12);
    await expect.poll(async () => page.locator('[data-pool-flow-label]').evaluateAll((labels) => {
      const counts = labels.reduce((acc, label) => {
        const text = label.textContent.trim();
        acc[text] = (acc[text] || 0) + 1;
        return acc;
      }, {});
      return {
        request: counts.Request || 0,
        policy: counts.Policy || 0,
        match: counts.Match || 0,
        infer: counts.Infer || 0,
        verify: counts.Verify || 0,
        history: counts.History || 0,
        consumer: counts.Consumer || 0,
        producer: counts.Producer || 0,
        provider: counts.Provider || 0,
        settlement: counts.Settlement || 0,
        ledger: counts.Ledger || 0
      };
    })).toEqual({
      request: 1,
      policy: 1,
      match: 1,
      infer: 4,
      verify: 3,
      history: 2,
      consumer: 0,
      producer: 0,
      provider: 0,
      settlement: 0,
      ledger: 0
    });
    await expect(page.locator('body')).not.toContainText('Poolday');
  });

  test('product navigation is collapsed and opens without covering the canvas controls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(PRODUCT_HOME_PATH);
    await page.waitForSelector('.pool-nav-rail', { timeout: 20000 });

    const desktop = await page.evaluate(() => {
      const rail = document.querySelector('.pool-nav-rail').getBoundingClientRect();
      const open = document.querySelector('.pool-nav-rail').classList.contains('is-open');
      return {
        height: rail.height,
        open,
        width: rail.width,
        x: rail.x,
        y: rail.y,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    });
    expect(desktop.open).toBe(false);
    expect(desktop.x).toBeLessThan(24);
    expect(desktop.y).toBeLessThan(24);
    expect(desktop.height).toBeLessThan(48);
    expect(desktop.width).toBeLessThan(56);
    expect(desktop.overflowX).toBe(false);

    await page.locator('.pool-nav-toggle').click();
    await expect(page.locator('.pool-nav-rail')).toHaveClass(/is-open/);
    await expect(page.locator('.pool-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('link', { name: 'Network', exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForSelector('.pool-nav-rail', { timeout: 20000 });

    const mobile = await page.evaluate(() => {
      const rail = document.querySelector('.pool-nav-rail').getBoundingClientRect();
      const canvas = document.querySelector('.pool-simulation-canvas').getBoundingClientRect();
      const shell = document.querySelector('.pool-simulation-shell').getBoundingClientRect();
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0
      );
      return {
        canvasHeight: canvas.height,
        canvasTop: canvas.top,
        height: rail.height,
        left: rail.left,
        open: document.querySelector('.pool-nav-rail').classList.contains('is-open'),
        right: window.innerWidth - rail.right,
        scrollHeight,
        shellHeight: shell.height,
        shellTop: shell.top,
        viewportHeight: window.innerHeight,
        width: rail.width,
        y: rail.y,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        overflowY: scrollHeight > window.innerHeight + 1
      };
    });
    expect(mobile.open).toBe(false);
    expect(mobile.y).toBeLessThan(16);
    expect(mobile.left).toBeLessThan(16);
    expect(mobile.right).toBeGreaterThan(330);
    expect(mobile.height).toBeLessThan(54);
    expect(mobile.width).toBeLessThan(56);
    expect(mobile.overflowX).toBe(false);
    expect(mobile.overflowY).toBe(false);
    expect(Math.abs(mobile.canvasTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(mobile.shellTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(mobile.canvasHeight - mobile.viewportHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(mobile.shellHeight - mobile.viewportHeight)).toBeLessThanOrEqual(1);
    expect(mobile.scrollHeight).toBeLessThanOrEqual(mobile.viewportHeight + 1);
    const mobileNav = page.locator('.pool-nav-rail');
    await mobileNav.locator('.pool-nav-toggle').click();
    await expect(mobileNav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Ask', exact: true })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Compute', exact: true })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'History', exact: true })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Network', exact: true })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'Zero' })).toBeVisible();
    await expect(mobileNav.getByRole('link', { name: 'X', exact: true })).toBeVisible();
  });

  test('product routes hide raw payloads and hosted controls by default', async ({ page }) => {
    for (const route of ['/ask', '/compute', '/history', '/network']) {
      await page.goto(route);
      await page.waitForSelector('.pool-home', { timeout: 20000 });

      await expect(page.locator('details.pool-raw-details[open]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Firestore');
      await expect(page.locator('body')).not.toContainText('firestore');
      await expect(page.getByRole('button', { name: 'Register', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Heartbeat', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Next Job', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Deploy Check', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Metrics', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Points', exact: true })).toHaveCount(0);
    }
  });

  test('ask and compute are presented as local peer-room flows', async ({ page }) => {
    await page.goto('/ask');
    await page.waitForSelector('.pool-home', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Ask', exact: true })).toBeVisible();
    await expect(page.locator('.pool-page-heading .pool-eyebrow')).toHaveCount(0);
    await expect(page.getByLabel('Ask controls')).toContainText('Ask');
    await expect(page.locator('#pool-run-result-raw')).toBeHidden();
    await expect(page.locator('#pool-run-poll')).toHaveCount(0);
    await expect(page.locator('#pool-run-max-spend')).toHaveCount(0);

    await page.goto('/compute');
    await page.waitForSelector('.pool-home', { timeout: 20000 });
    await expect(page.locator('.pool-home')).toHaveAttribute('data-pool-route-id', 'compute');
    await page.locator('.pool-nav-toggle').click();
    await expect(page.getByRole('link', { name: 'Compute', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: 'Compute', exact: true })).toBeVisible();
    await expect(page.locator('.pool-page-heading .pool-eyebrow')).toHaveCount(0);
    await expect(page.locator('[data-pool-simulation]')).toHaveCount(0);
    await expect(page.locator('[data-pool-provider-status]')).toHaveText('Idle');
    await expect(page.locator('#pool-provider-worker-start')).toBeVisible();
    await expect(page.locator('#pool-provider-worker-start')).toHaveText('Start helping');
    await expect(page.locator('#pool-provider-worker-stop')).toBeVisible();
    await expect(page.locator('#pool-provider-load')).toHaveCount(0);
    await expect(page.locator('#pool-provider-profile')).toHaveCount(0);
    await expect(page.locator('#pool-agent-submit')).toHaveCount(0);
    await expect(page.locator('[data-pool-node-grid]')).toHaveCount(0);

    await page.goto('/history');
    await page.waitForSelector('.pool-home', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await expect(page.locator('.pool-page-heading .pool-eyebrow')).toHaveCount(0);
    await expect(page.locator('#pool-peer-ledger')).toHaveCount(0);

    await page.goto('/network');
    await page.waitForSelector('.pool-home', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible();
    await expect(page.locator('.pool-route-cta-row').getByRole('link', { name: 'Share Compute', exact: true })).toHaveAttribute('href', '/compute');
    await expect(page.locator('#pool-peer-ledger')).toBeVisible();
  });

  test('home route boots without early VFS misses for instance-scoped runtime modules', async ({ page }) => {
    const vfsMisses = [];
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[SW] Missing module in VFS:')) {
        vfsMisses.push(text);
      }
    });

    await openHome(page);
    await page.waitForTimeout(250);

    expect(
      vfsMisses.filter((text) => (
        text.includes('/self/instance.js') || text.includes('/core/utils.js')
      ))
    ).toEqual([]);
  });

  test('home route boots Reploid with minimal ring controls', async ({ page }) => {
    await openHome(page);

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page).toHaveTitle(/^Reploid$/i);
    await expect(page.locator('.wizard-intro')).toContainText('blueprint-first runtime');
    await expect(page.locator('.inference-bar .type-h2')).toHaveText('Runtime');
    await expect(page.locator('.inference-bar-label')).toHaveText('Seed');
    await expect(page.locator('.inference-bar-model')).toContainText('peer-assisted');
    await expect(page.locator('.inference-bar-note')).toContainText('Waiting for remote host slots');
    await expect(page.locator('.ring-slot-token')).toHaveCount(0);
    await expect(page.locator('.rgr-status-strip')).toContainText('Mode');
    await expect(page.locator('.rgr-status-strip')).toContainText('7 remote');
    await expect(page.locator('.rgr-status-strip')).toContainText('consumer');
    await expect(page.locator('.rgr-status-strip')).toContainText('waiting for host');
    await expect(page.locator('.rgr-status-strip')).not.toContainText('Dream');
    await expect(page.locator('.dream-instance-panel')).toHaveCount(0);
    await expect(page.getByText('Dream instance')).toHaveCount(0);
    await expect(page.locator('.inference-bar-shared-details')).toHaveCount(0);
    await expect(page.locator('#reploid-use-own-inference')).toBeVisible();
    await expect(page.locator('#reploid-swarm-enabled')).toBeVisible();
    await expect(page.locator('#reploid-swarm-enabled')).toBeChecked();
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect(page.locator('[data-action="choose-browser"]')).toHaveCount(0);
    await expect(page.locator('#goal-input')).toHaveValue(new RegExp(DEFAULT_HOME_GOAL_SNIPPET));
    await expect(page.locator('[data-action="generate-goal"]')).toBeVisible();
    await expect(page.locator('[data-action="shuffle-goals"]')).toHaveCount(0);
    await expect(page.locator('[data-action="toggle-goal-category"]')).toHaveCount(0);
    await expect(page.locator('.goal-level-dropdown')).toHaveCount(0);
    await expect(page.locator('.seed-browser-panel')).not.toHaveAttribute('open', '');
    await expect(page.locator('#awaken-btn')).toBeEnabled();
    await expect(page.locator('.seed-browser-actions #awaken-btn')).toBeVisible();
    await expect(page.locator('.wizard-awaken')).toHaveCount(0);
    await expect(page.locator('#environment-input')).toHaveCount(0);
    await expect(page.locator('.seed-browser-panel')).toContainText('Seed files');
    await expect(page.getByRole('link', { name: 'fresh peer' })).toBeVisible();
  });

  test('home route clears direct inference keys when disabled', async ({ page }) => {
    await openHome(page);

    await page.locator('#reploid-use-own-inference').click();
    await page.locator('#direct-key').fill('test-secret-key');
    await expect.poll(async () => page.evaluate(() => (
      Object.keys(localStorage)
        .filter((key) => key.endsWith('SELECTED_MODELS'))
        .map((key) => localStorage.getItem(key))
    ))).toEqual([expect.stringContaining('test-secret-key')]);

    await page.locator('#reploid-use-own-inference').click();
    await expect(page.locator('#direct-key')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => (
      Object.keys(localStorage).filter((key) => key.endsWith('SELECTED_MODELS'))
    ))).toEqual([]);
  });

  test('home route self browser previews selected files', async ({ page }) => {
    await openHome(page);

    await page.locator('.seed-browser-panel summary').click();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/self/self.json');
    await expect(page.locator('.seed-file-viewer')).toContainText('"visibleTools"');

    await page.locator('[data-action="select-self-path"][data-path="/self/runtime.js"]').click();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/self/runtime.js');
    await expect(page.locator('.seed-viewer-panel')).toContainText('source preview');
    await expect(page.locator('.seed-file-viewer')).toContainText('Dedicated Reploid self runtime');
  });

  test('home route recovers from awaken failure', async ({ page }) => {
    await openHome(page);
    await page.evaluate(() => {
      window.triggerAwaken = async () => {
        throw new Error('<img src=x onerror=alert(1)> bad awaken');
      };
    });

    await page.locator('#goal-input').fill('Force awaken failure');
    await page.locator('#awaken-btn').click();
    await expect(page.locator('#awaken-btn')).toHaveText('Awaken');
    await expect(page.locator('#awaken-btn')).toBeEnabled();
    await expect(page.locator('.goal-toolbar-status')).toContainText('Awaken failed: <img src=x onerror=alert(1)> bad awaken');
    await expect(page.locator('.goal-toolbar-status img')).toHaveCount(0);
  });

  test('home route can draft a seeded goal before inference is configured', async ({ page }) => {
    await openHome(page);

    const goalInput = page.locator('#goal-input');
    await goalInput.fill('');
    await page.locator('[data-action="generate-goal"]').click();

    await expect(goalInput).not.toHaveValue('');
    await expect(page.locator('.goal-toolbar-status')).toHaveText('');
  });

  test('home route preserves the goal input node while typing', async ({ page }) => {
    await openHome(page);

    const goalInput = page.locator('#goal-input');
    await goalInput.click();
    await page.evaluate(() => {
      window.__bootGoalInput = document.getElementById('goal-input');
    });

    await goalInput.pressSequentially(' faster');

    expect(await page.evaluate(() => (
      window.__bootGoalInput === document.getElementById('goal-input')
    ))).toBe(true);
    await expect(goalInput).toHaveValue(/faster/);
  });

  test('home route can awaken with remote slots and no local inference', async ({ page }) => {
    await openHome(page);

    const swarmCheckbox = page.locator('#reploid-swarm-enabled');
    await page.locator('#goal-input').fill('Wait for remote host slots');
    await expect(swarmCheckbox).toBeChecked();
    expect(await swarmCheckbox.evaluate((input) => {
      const styles = getComputedStyle(input);
      return styles.appearance || styles.getPropertyValue('-webkit-appearance') || '';
    })).not.toBe('none');
    await expect(page.locator('.inference-bar-label')).toHaveText('Seed');
    await expect(page.locator('.inference-bar-model')).toContainText('peer-assisted');
    await expect(page.locator('.inference-bar-note')).toContainText('Waiting for remote host slots');
    await expect(page.locator('.rgr-status-strip')).toContainText('7 remote');
    await expect(page.locator('#awaken-btn')).toBeEnabled();
    await expect(page.locator('.wizard-awaken')).toHaveCount(0);
  });

  test('/zero locks the boot mode to Zero', async ({ page }) => {
    const startupDiscoveryRequests = [];
    await page.addInitScript(() => {
      window.__zeroPreHydrationBootVisible = false;
      const hydrationDone = () => window.REPLOID_VFS_FULL_SEED_PROGRESS?.phase === 'mirror:done';
      const inspectBootContainer = () => {
        if (hydrationDone()) return;
        const el = document.getElementById('wizard-container');
        if (!el) return;
        const hasRenderedBoot = el.children.length > 0 || String(el.textContent || '').trim().length > 0;
        if (!hasRenderedBoot) return;
        const visible = window.getComputedStyle(el).display !== 'none';
        if (visible) {
          window.__zeroPreHydrationBootVisible = true;
        }
      };
      const observer = new MutationObserver(inspectBootContainer);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
      document.addEventListener('DOMContentLoaded', inspectBootContainer);
    });
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('localhost:11434/api/tags')
        || url.includes('localhost:8000/api/health')
        || url.includes('localhost:8080/api/health')
        || url.includes('/doppler/src/client/doppler-provider.js')
      ) {
        startupDiscoveryRequests.push(url);
      }
    });
    await page.goto('/zero');
    await page.waitForSelector('.wizard-home-provider [data-action="choose-proxy"]', { timeout: 20000 });
    expect(await page.evaluate(() => window.__zeroPreHydrationBootVisible)).toBe(false);

    await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
    await expect(page.locator('.wizard-brand')).toHaveCount(0);
    await expect(page).toHaveTitle(/^Zero$/i);
    await expect(page.locator('.wizard-home-provider .type-h1')).toHaveText('Choose inference');
    await expect(page.locator('[data-action="choose-proxy"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-proxy"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-direct"]')).toHaveCount(0);
    await expect(page.locator('.wizard-proxy .type-h1')).toHaveText('Server proxy');
    await expect(page.locator('#proxy-url')).toHaveValue(/\/zero\/gemini$/);
    await expect(page.locator('#proxy-provider')).toHaveValue('gemini');
    await expect(page.locator('#proxy-model')).toHaveValue('gemini-3.5-flash');
    await expect(page.locator('#goal-input')).toBeVisible();
    await page.locator('#goal-input').fill('');
    await page.locator('[data-action="generate-goal"]').click();
    await expect(page.locator('#goal-input')).not.toHaveValue('');
    await expect(page.locator('#goal-input')).not.toHaveValue('[object Object]');
    await expect(page.locator('#awaken-btn')).toBeEnabled();
    await expect(page.locator('#reploid-swarm-enabled')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'new peer' })).toHaveCount(0);
    await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => window.getReploidMode())).toBe('zero');
    expect(startupDiscoveryRequests).toEqual([]);
  });

  test('/zero awakens with the complete DI dependency closure', async ({ page }) => {
    const pageErrors = [];
    const selfVfsMisses = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const text = message.text();
      if (text.includes('[SW] Missing module in VFS: /self/')) {
        selfVfsMisses.push(text);
      }
    });

    await page.goto('/zero');
    await page.waitForSelector('.wizard-home-provider [data-action="choose-proxy"]', { timeout: 20000 });
    await page.locator('#goal-input').fill('Inspect the live seed and stop after the first observation.');
    await page.locator('#awaken-btn').click();

    await page.waitForFunction(() => !!window.REPLOID?.container, { timeout: 30000 });
    await expect(page.locator('body')).not.toContainText(/Boot Failure|Module not found/i);

    const resolvedServices = await page.evaluate(async () => {
      const container = window.REPLOID?.container;
      const names = ['ContextManager', 'PersonaManager', 'CircuitBreaker', 'ToolWriter', 'SubstrateLoader'];
      const results = {};
      for (const name of names) {
        try {
          results[name] = !!(await container.resolve(name));
        } catch (error) {
          results[name] = error?.message || String(error);
        }
      }
      try {
        const toolRunner = await container.resolve('ToolRunner');
        results.tools = toolRunner.list();
      } catch (error) {
        results.tools = error?.message || String(error);
      }
      return results;
    });

    expect(resolvedServices.ContextManager).toBe(true);
    expect(resolvedServices.PersonaManager).toBe(true);
    expect(resolvedServices.CircuitBreaker).toBe(true);
    expect(resolvedServices.ToolWriter).toBe(true);
    expect(resolvedServices.SubstrateLoader).toBe(true);
    expect(resolvedServices.tools).toEqual(expect.arrayContaining([
      'ReadFile',
      'WriteFile',
      'EditFile',
      'ListFiles',
      'Grep',
      'ListTools',
      'CreateTool',
      'LoadModule',
      'Promote'
    ]));
    expect(resolvedServices.tools).not.toEqual(expect.arrayContaining([
      'DeleteFile',
      'MakeDirectory',
      'CopyFile',
      'MoveFile',
      'Head',
      'Tail',
      'Find',
      'git'
    ]));

    const liveToolResult = await page.evaluate(async () => {
      const container = window.REPLOID?.container;
      const toolRunner = await container.resolve('ToolRunner');
      const vfs = window.REPLOID?.vfs;
      const createCode = `
export const tool = {
  name: 'EchoProbe',
  description: 'E2E probe tool',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
};

export default async function(args) {
  return { echo: args.value || '' };
}
`;
      const loadCode = `
export const tool = {
  name: 'LoadedProbe',
  description: 'E2E loaded self tool',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
};

export default async function(args) {
  return { loaded: args.value || '' };
}
`;
      const created = await toolRunner.execute('CreateTool', {
        name: 'EchoProbe',
        code: createCode
      });
      const hasEchoBeforePromote = toolRunner.list().includes('EchoProbe');
      await vfs.write('/shadow/tools/LoadedProbe.js', loadCode);
      await vfs.write('/artifacts/LoadedProbe-evidence.json', JSON.stringify({
        candidatePath: '/shadow/tools/LoadedProbe.js',
        targetPath: '/self/tools/LoadedProbe.js',
        evidencePath: '/artifacts/LoadedProbe-evidence.json',
        replayPassed: true
      }));
      const promoted = await toolRunner.execute('Promote', {
        candidatePath: '/shadow/tools/LoadedProbe.js',
        targetPath: '/self/tools/LoadedProbe.js',
        evidencePath: '/artifacts/LoadedProbe-evidence.json'
      });
      const loaded = await toolRunner.execute('LoadModule', { path: '/self/tools/LoadedProbe.js' });
      const loadedResult = await toolRunner.execute('LoadedProbe', { value: 'self' });
      return {
        created,
        hasEchoBeforePromote,
        promoted,
        loaded,
        loadedResult,
        tools: toolRunner.list(),
        hasZeroSelfUi: await vfs.exists('/self/ui/zero/index.js'),
        hasZeroSelfStyles: await vfs.exists('/self/styles/zero.css')
      };
    });

    expect(liveToolResult.created).toMatchObject({
      success: true,
      name: 'EchoProbe',
      path: '/shadow/tools/EchoProbe.js',
      staged: true,
      toolLoaded: false
    });
    expect(liveToolResult.hasEchoBeforePromote).toBe(false);
    expect(liveToolResult.promoted).toMatchObject({ ok: true, promoted: true });
    expect(liveToolResult.loadedResult).toEqual({ loaded: 'self' });
    expect(liveToolResult.tools).toContain('LoadedProbe');
    expect(liveToolResult.tools).not.toContain('EchoProbe');
    expect(liveToolResult.hasZeroSelfUi).toBe(true);
    expect(liveToolResult.hasZeroSelfStyles).toBe(true);
    expect(selfVfsMisses).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('/x locks the boot mode to X without boot failures', async ({ page }) => {
    const pageErrors = [];
    const startupDiscoveryRequests = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('localhost:11434/api/tags')
        || url.includes('localhost:8000/api/health')
        || url.includes('localhost:8080/api/health')
        || url.includes('/doppler/src/client/doppler-provider.js')
      ) {
        startupDiscoveryRequests.push(url);
      }
    });
    for (const route of ['/x', '/x/']) {
      await page.goto(route);
      await page.waitForSelector('.wizard-home-provider [data-action="choose-direct"]', { timeout: 20000 });

      await expect(page.locator('.boot-mode-btn[data-mode]')).toHaveCount(0);
      await expect(page.locator('.wizard-brand')).toHaveCount(0);
      await expect(page).toHaveTitle(/^X$/i);
      await expect(page.locator('.wizard-home-provider .type-h1')).toHaveText('Choose inference provider');
      await expect(page.locator('[data-action="choose-direct"]')).toBeVisible();
      await expect(page.locator('[data-action="advanced-settings"]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/Boot Failure|Boot failed|Module not found/i);
      await expect.poll(async () => page.evaluate(() => window.getReploidMode())).toBe('x');
      await expect.poll(async () => page.evaluate(() => window.getReploidRouteMode())).toBe('x');
    }
    expect(pageErrors).toEqual([]);
    expect(startupDiscoveryRequests).toEqual([]);
  });
});

test.describe('Same-Origin Multi-Peer', () => {
  test('opens a new peer in the same browser context with isolated instance, identity, and self state', async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
        peerId: 'peer:legacy-shared',
        publicJwk: { x: 'legacy' },
        privateJwk: { d: 'legacy' },
        contribution: {}
      }));
    });
    const page = await context.newPage();

    const getPeerState = async (targetPage) => targetPage.evaluate(async () => {
      const instanceId = window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null;
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.() || null;
      const dbName = instanceId ? `reploid-vfs-v0--${instanceId}` : 'reploid-vfs-v0';

      const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readEntry = async (db, path) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(path);
        request.onsuccess = () => resolve(request.result?.content || null);
        request.onerror = () => reject(request.error);
      });

      const db = await openDb();
      return {
        instanceId,
        dbName,
        snapshot: snapshot ? {
          instanceId: snapshot.instanceId,
          peerId: snapshot.swarm?.peerId || null
        } : null,
        selfJson: await readEntry(db, '/self/self.json')
      };
    });

    try {
      await openHome(page);

      const [peerPage] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('link', { name: 'new peer' }).click()
      ]);

      await peerPage.waitForLoadState('domcontentloaded');
      await peerPage.waitForSelector('.inference-bar', { timeout: 20000 });

      const firstInstanceId = await page.evaluate(() => window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null);
      const secondInstanceId = await peerPage.evaluate(() => window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null);

      expect(firstInstanceId).toBeTruthy();
      expect(secondInstanceId).toBeTruthy();
      expect(firstInstanceId).not.toBe(secondInstanceId);

      await page.locator('#goal-input').fill('Peer alpha objective');
      await page.locator('#reploid-swarm-enabled').check();
      await page.locator('#awaken-btn').click();

      await peerPage.locator('#goal-input').fill('Peer beta objective');
      await peerPage.locator('#reploid-swarm-enabled').check();
      await peerPage.locator('#awaken-btn').click();

      await page.waitForSelector('#app.active', { timeout: 20000 });
      await peerPage.waitForSelector('#app.active', { timeout: 20000 });
      await expect.poll(async () => page.evaluate(() => (
        window.REPLOID?.runtime?.getSnapshot?.()?.instanceId || null
      )), { timeout: 20000 }).toBe(firstInstanceId);
      await expect.poll(async () => peerPage.evaluate(() => (
        window.REPLOID?.runtime?.getSnapshot?.()?.instanceId || null
      )), { timeout: 20000 }).toBe(secondInstanceId);

      const firstPeer = await getPeerState(page);
      const secondPeer = await getPeerState(peerPage);
      const firstSelf = JSON.parse(firstPeer.selfJson);
      const secondSelf = JSON.parse(secondPeer.selfJson);

      expect(firstPeer.instanceId).toBe(firstInstanceId);
      expect(secondPeer.instanceId).toBe(secondInstanceId);
      expect(firstPeer.dbName).not.toBe(secondPeer.dbName);
      expect(firstPeer.snapshot?.instanceId).toBe(firstInstanceId);
      expect(secondPeer.snapshot?.instanceId).toBe(secondInstanceId);
      expect(firstPeer.snapshot?.peerId).toBeTruthy();
      expect(secondPeer.snapshot?.peerId).toBeTruthy();
      expect(firstPeer.snapshot?.peerId).not.toBe(secondPeer.snapshot?.peerId);
      expect(firstSelf.goal).toContain('Peer alpha objective');
      expect(secondSelf.goal).toContain('Peer beta objective');
      expect(firstSelf.instanceId).toBe(firstInstanceId);
      expect(secondSelf.instanceId).toBe(secondInstanceId);
    } finally {
      await context.close();
    }
  });

  test('rotates the active peer identity after awaken instead of keeping the legacy peer', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
        peerId: 'peer:legacy-shared',
        publicJwk: { x: 'legacy' },
        privateJwk: { d: 'legacy' },
        contribution: {}
      }));
    });

    await openHome(page);
    await page.locator('#goal-input').fill('Rotate the active peer identity');
    await page.locator('#reploid-swarm-enabled').check();
    await page.locator('#awaken-btn').click();
    await page.waitForSelector('#app.active', { timeout: 20000 });

    await expect.poll(async () => page.evaluate(() => (
      window.REPLOID?.runtime?.getSnapshot?.()?.swarm?.peerId || null
    ))).toBe('peer:legacy-shared');

    const rotateButton = page.getByRole('button', { name: 'Rotate peer ID' });
    await expect(rotateButton).toBeEnabled();
    await rotateButton.click();

    await expect.poll(async () => page.evaluate(() => (
      window.REPLOID?.runtime?.getSnapshot?.()?.swarm?.peerId || null
    ))).not.toBe('peer:legacy-shared');
  });

  test('same-origin provider and consumer discover each other over swarm transport', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const getSwarmSnapshot = async (targetPage) => targetPage.evaluate(() => {
      const swarm = window.REPLOID?.runtime?.getSnapshot?.()?.swarm || null;
      return swarm ? {
        role: swarm.role,
        peerCount: swarm.peerCount,
        providerCount: swarm.providerCount,
        transport: swarm.transport,
        connectionState: swarm.connectionState,
        peerId: swarm.peerId
      } : null;
    });

    try {
      await openHome(page);

      const [peerPage] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('link', { name: 'new peer' }).click()
      ]);

      await peerPage.waitForLoadState('domcontentloaded');
      await peerPage.waitForSelector('.inference-bar', { timeout: 20000 });

      await page.locator('#goal-input').fill('Serve swarm peers');
      await page.locator('#reploid-use-own-inference').click();
      await page.selectOption('#direct-provider', 'gemini');
      await expect(page.locator('#direct-model')).toHaveValue('gemini-3.5-flash');
      await page.locator('#direct-key').fill('test-key');
      await page.locator('#reploid-swarm-enabled').check();
      await page.locator('#awaken-btn').click();

      await peerPage.locator('#goal-input').fill('Borrow swarm inference');
      await peerPage.locator('#reploid-swarm-enabled').check();
      await peerPage.locator('#awaken-btn').click();

      await page.waitForSelector('#app.active', { timeout: 20000 });
      await peerPage.waitForSelector('#app.active', { timeout: 20000 });

      await expect.poll(async () => {
        const swarm = await getSwarmSnapshot(page);
        return swarm ? {
          role: swarm.role,
          peerCount: swarm.peerCount,
          transport: swarm.transport,
          connectionState: swarm.connectionState,
          peerId: swarm.peerId
        } : null;
      }, { timeout: 20000 }).toEqual(expect.objectContaining({
        role: 'provider',
        peerCount: 1,
        connectionState: 'connected'
      }));

      await expect.poll(async () => {
        const swarm = await getSwarmSnapshot(peerPage);
        return swarm ? {
          role: swarm.role,
          peerCount: swarm.peerCount,
          providerCount: swarm.providerCount,
          transport: swarm.transport,
          connectionState: swarm.connectionState,
          peerId: swarm.peerId
        } : null;
      }, { timeout: 20000 }).toEqual(expect.objectContaining({
        role: 'consumer',
        peerCount: 1,
        providerCount: 1,
        connectionState: 'connected'
      }));
    } finally {
      await context.close();
    }
  });
});

test.describe('Connection Selection', () => {
  test('shows Doppler, direct, and proxy brain options', async ({ page }) => {
    await openBoot(page);

    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-browser"]')).toContainText('Doppler');
    await expect(page.locator('[data-action="choose-direct"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-proxy"]')).toBeVisible();
  });

  test('does not show a separate Doppler local-model path in direct mode', async ({ page }) => {
    await openBoot(page);

    await page.click('[data-action="choose-direct"]');

    await expect(page.locator('#enable-doppler')).toHaveCount(0);
    await expect(page.locator('#doppler-model-inline')).toHaveCount(0);
  });

  test('selects Gemini 3.5 Flash by default for direct Gemini inference', async ({ page }) => {
    await openBoot(page);

    await page.click('[data-action="choose-direct"]');
    await page.selectOption('#direct-provider', 'gemini');

    await expect(page.locator('#direct-model')).toHaveValue('gemini-3.5-flash');
  });
});

test.describe('Advanced Mapping', () => {
  test('defaults Reploid to the capsule genesis level', async ({ page }) => {
    await unlockAwakenSection(page);

    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('capsule');
  });

  test('maps X to the full genesis level', async ({ page }) => {
    await openBoot(page);

    await page.click('.boot-mode-btn[data-mode="x"]');
    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await page.locator('#goal-input').fill('Boot into X');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('full');
  });
});

test.describe('Goal Input', () => {
  test('shows ordered placeholders and unlocks the goal input after inference config', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await openBoot(page);
    const goalInput = page.locator('#goal-input');

    if (await goalInput.isVisible().catch(() => false)) {
      await expect(goalInput).toBeVisible();
      return;
    }

    await page.click('[data-action="choose-browser"]');
    await page.click('[data-model="smollm2-360m"]');
    await expect(goalInput).toBeVisible();
  });

  test('shows the self tree browser in Reploid', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('.seed-browser-panel')).toBeVisible();
    await expect(page.locator('.seed-browser-panel')).toContainText('Self tree');
    await expect(page.locator('.seed-browser-panel')).toContainText('/self/self.json');
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/boot.json"]')).toBeVisible();
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/runtime.js"]')).toBeVisible();
    await expect(page.locator('[data-action="select-self-path"][data-path="/self/capsule/index.js"]')).toBeVisible();
    await expect(page.locator('.seed-viewer-panel')).toContainText('/self/self.json');
    await expect(page.locator('.seed-viewer-panel')).toContainText('"visibleTools"');
    await expect(page.locator('.boot-debug-panel')).not.toHaveAttribute('open', '');
    await expect(page.locator('.seed-viewer-panel')).toContainText('"selfHosted": true');
  });

  test('shows Reploid environment editor without bootstrapper toggle', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('#environment-input')).toBeVisible();
    await expect(page.locator('[data-action="apply-environment-template"]')).toHaveCount(5);
    await expect(page.locator('#include-bootstrapper-within-self')).toHaveCount(0);
  });

  test('shows runtime preset rail and a single dropdown for the active level', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('[data-action="toggle-goal-category"]')).toHaveCount(5);
    await expect(page.locator('.goal-level-dropdown')).toBeVisible();
    await expect(page.locator('.goal-level-dropdown')).toContainText('L0: Basic Functions');
    expect(await page.locator('.goal-level-dropdown-list .goal-chip').count()).toBeGreaterThanOrEqual(5);
  });

  test('shows generated-goal action', async ({ page }) => {
    await unlockGoalSection(page);

    await expect(page.locator('[data-action="shuffle-goals"]')).toBeVisible();
    await expect(page.locator('[data-action="generate-goal"]')).toBeVisible();
    await expect(page.locator('[data-action="generate-goal"]')).toHaveText('Draft');
  });

  test('shuffle presets updates the goal input', async ({ page }) => {
    await unlockGoalSection(page);

    const goalInput = page.locator('#goal-input');
    await goalInput.fill('');
    await page.locator('[data-action="shuffle-goals"]').click();
    await expect(goalInput).not.toHaveValue('');
  });

  test('switches the preset dropdown when choosing a different runtime level', async ({ page }) => {
    await unlockGoalSection(page);

    await page.locator('[data-action="toggle-goal-category"][data-category="L2: Substrate"]').click();
    await expect(page.locator('.goal-level-dropdown')).toContainText('L2: Substrate');
    expect(await page.locator('.goal-level-dropdown-list .goal-chip').count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('.goal-level-dropdown')).toContainText('Twin capsule lab');
  });

  test('awaken button exists', async ({ page }) => {
    await unlockAwakenSection(page);

    await expect(page.locator('#awaken-btn')).toBeVisible();
  });

  test('enforces goal maxlength (500 chars)', async ({ page }) => {
    await unlockGoalSection(page);

    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toHaveAttribute('maxlength', '500');
  });
});

test.describe('Reploid Runtime', () => {
  test('awakens into capsule instead of the zero shell', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await openHome(page);
    await page.locator('#goal-input').fill('Boot into Capsule');
    await page.locator('#reploid-swarm-enabled').check();
    await page.locator('#awaken-btn').click();

    await page.waitForSelector('#app.active', { timeout: 20000 });
    await expect(page.locator('.capsule-shell')).toBeVisible();
    await expect(page.locator('.capsule-rsi-panel')).toBeVisible();
    await expect(page.locator('.capsule-rsi-panel')).toContainText('RSI Progress');
    await expect(page.locator('.capsule-rsi-panel')).toContainText('Objective');
    await expect(page.locator('.capsule-rsi-panel')).toContainText('Boot into Capsule');
    await expect(page.locator('.capsule-rsi-panel')).toContainText('Evidence');
    await expect(page.locator('.capsule-rsi-panel')).toContainText('Next');
    await expect(page.locator('.capsule-rgr-panel')).toBeVisible();
    await expect(page.locator('.capsule-rgr-panel')).toContainText('Mode');
    await expect(page.locator('.capsule-rgr-panel')).toContainText('Topology');
    await expect(page.locator('.capsule-rgr-panel')).toContainText('Gate');
    await expect(page.locator('.capsule-rgr-panel')).toContainText('Archive');
    await expect(page.locator('.capsule-rgr-panel')).toContainText('Anchors');
    await expect(page.locator('.capsule-slot-row')).toHaveCount(7);
    await expect(page.locator('.capsule-slot-row').first()).toContainText('elite');
    await expect(page.locator('.zero-shell')).toHaveCount(0);
    await expect(page.locator('#history-container')).toBeVisible();
    await expect(page.locator('#zero-human-form')).toHaveCount(0);
    await page.waitForFunction(() => {
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.();
      return !!(snapshot && snapshot.context?.length >= 1 && snapshot.renderedText?.includes('[BOOT]'));
    }, { timeout: 5000 });

    const capsuleSnapshot = await page.evaluate(() => {
      const snapshot = window.REPLOID?.runtime?.getSnapshot?.();
      if (!snapshot) return null;
      return {
        renderedText: snapshot.renderedText,
        context: snapshot.context.map(({ role, origin, content }) => ({ role, origin, content }))
      };
    });

    const vfsState = await page.evaluate(async () => {
      const openDb = () => new Promise((resolve, reject) => {
        const instanceId = window.getReploidInstanceId?.() || window.REPLOID_INSTANCE_ID || null;
        const dbName = instanceId ? `reploid-vfs-v0--${instanceId}` : 'reploid-vfs-v0';
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readEntry = async (db, path) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(path);
        request.onsuccess = () => resolve(request.result?.content || null);
        request.onerror = () => reject(request.error);
      });
      const listKeys = async (db) => new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      const db = await openDb();
      return {
        self: await readEntry(db, '/self/self.json'),
        keys: await listKeys(db)
      };
    });

    const self = JSON.parse(vfsState.self);
    expect(capsuleSnapshot).not.toBeNull();
    expect(capsuleSnapshot.renderedText).toContain('[BOOT]');
    expect(capsuleSnapshot.renderedText).toContain('Self:');
    expect(capsuleSnapshot.renderedText).toContain('Bootstrap context:');
    expect(capsuleSnapshot.renderedText).toContain('/self/prompts/kernel.md');
    expect(capsuleSnapshot.renderedText).toContain('/self/blueprints/rgr-runtime-contract.md');
    expect(capsuleSnapshot.renderedText).toContain('/self/blueprints/rgr-slot-topology.md');
    expect(capsuleSnapshot.renderedText).not.toContain('/self/blueprints/rgr-dream-instance-manifest.md');
    expect(capsuleSnapshot.renderedText).not.toContain('Goal:');
    expect(capsuleSnapshot.renderedText).not.toContain('Environment:');
    expect(capsuleSnapshot.renderedText).not.toContain('[USER]');
    expect(capsuleSnapshot.renderedText).not.toContain('[ASSISTANT]');
    expect(capsuleSnapshot.context.slice(0, 1).map((msg) => msg.origin)).toEqual(['bootstrap']);
    expect(capsuleSnapshot.context.some((msg) => msg.origin === 'system')).toBe(true);
    expect(vfsState.keys).not.toContain('/.system/prompt.txt');
    expect(vfsState.keys).not.toContain('/.system/goal.txt');
    expect(vfsState.keys).not.toContain('/.system/environment.txt');
    expect(vfsState.keys).toContain('/self/self.json');
    expect(vfsState.keys).not.toContain('/self/instances/dream/default.instance.json');
    expect(vfsState.keys).toContain('/self/boot.json');
    expect(vfsState.keys).toContain('/self/identity.json');
    expect(vfsState.keys.some((key) => key.startsWith('/bootstrapper/'))).toBe(false);
    expect(self.bootstrapperIncluded).toBeUndefined();
    expect(self.selfPath).toBe('/self/self.json');
    expect(self.productModel).toBe('Reploid');
    expect(self.coreInvariant).toBe('Start small, read blueprints on demand, stage candidates under /shadow.');
    expect(self.blueprints?.indexPath).toBe('/self/blueprint-index.json');
    expect(self.instances).toBeUndefined();
    expect(self.dream).toBeUndefined();
    expect(self.bootPath).toBe('/self/boot.json');
    expect(self.boot.host.startEntry).toBe('/self/host/start-app.js');
    expect(self.boot.kernel.bootEntry).toBe('/self/kernel/boot.js');
    expect(self.goal).toContain('Boot into Capsule');
    expect(self.environment).toContain('Browser-hosted JavaScript runtime with VFS and OPFS.');
    expect(self.selfHosted).toBe(true);
    expect(self.selfModifiable).toBe(true);
    expect(self.networkMode).toBe('swarm');
  });
});

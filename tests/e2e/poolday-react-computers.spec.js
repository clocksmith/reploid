// The React Computers drawer on the real route: its pairing, network and contribution controls, a desktop's
// pairing link, and a box that stays put while it loads and changes. Ports of the Computers parts of
// chat-material, workspace-navigation and poolday-layout-stability.
import { test, expect } from '@playwright/test';
import { privateRoom } from '../fixtures/current-contribution.js';

const react = async page => page.addInitScript(() => {
  localStorage.setItem('reploid.auto-download.v1', 'off');
});

async function offline(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
}

const pane = page => page.locator('[data-inspector-pane="participants"]');

for (const [width, height] of [[1280, 800], [390, 844]]) {
  test(`Computers drawer at ${width}px: pairing, network and contribution controls`, async ({ page, baseURL }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewportSize({ width, height });
    await react(page); await offline(page, baseURL);
    await page.goto(privateRoom('react-computers'));
    await expect(page.locator('[data-react-shell] [data-chat-workspace]')).toBeVisible({ timeout: 30000 });
    const computers = page.locator('[data-workspace-view="computers"]');
    await computers.click();
    await expect(page).toHaveURL(/view=computers/);
    await expect(computers).toHaveAttribute('aria-current', 'page');
    const drawer = pane(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Computers', exact: true })).toBeVisible();

    // Your computers: Connect a desktop opens its link field; file sharing lives in Settings, never here.
    const pairing = drawer.locator('[data-owner-pairing]');
    await pairing.locator(':scope > summary').click();
    await expect(drawer.getByLabel('Pairing link')).toBeVisible();
    await drawer.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(drawer.locator('[data-owner-pairing-status]')).toHaveText('Paste the pairing link from your desktop, or enter its ID and code by hand.');
    await expect(drawer.locator('[data-pairing-manual]')).toHaveAttribute('open', '');
    await expect(drawer.locator('[data-toggle-file-contribution]')).toHaveCount(0);

    // Public network: the discovery switch states its connection; external traffic is blocked, so none is found.
    await expect(drawer.getByRole('switch', { name: 'Public network' })).toBeVisible();
    await expect(drawer.locator('[data-peer-readiness]')).toHaveText('0 computers ready');
    await expect(drawer.locator('[data-mesh-invite]')).toHaveText('Copy private invitation');

    // This computer: the contribution switches and the models this device could share.
    await drawer.locator('[data-production-device] > summary').click();
    await expect(drawer.getByRole('switch', { name: 'Answer requests' })).toHaveAttribute('aria-checked', 'true');
    await expect(drawer.getByRole('switch', { name: 'Help peers connect' })).toBeVisible();
    await expect(drawer.locator('[data-device-usage-scope]')).toContainText('Output tokens from up to the latest');

    // Keyboard: Escape closes the drawer and keeps the conversation.
    await drawer.getByRole('switch', { name: 'Help peers connect' }).focus();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/view=computers/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const foreign = await page.evaluate(() => [...document.querySelectorAll('[data-inspector-pane="participants"] [class]')]
      .flatMap(node => [...node.classList]).filter(name => !/^(pool|btn)-/.test(name)));
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });
}

// A desktop's fresh pairing link is covered by chat-material.spec.js ('a fresh mobile pairing link opens one action…').

/** Start sampling the element's box on every frame, from the frame after its first paint. */
async function watchBox(locator) {
  await locator.evaluate(node => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const box = () => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; };
    const watch = window.__poolBoxWatch = { first: box(), worst: 0, running: true };
    const tick = () => {
      if (!watch.running) return;
      const current = box();
      watch.worst = Math.max(watch.worst, ...current.map((value, index) => Math.abs(value - watch.first[index])));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    resolve();
  }))));
}

/** Rows whose icon, text or trailing control is off the row's centre line. */
async function misalignedRows(root) {
  return root.evaluate(scope => {
    const centre = rect => (rect.top + rect.bottom) / 2;
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const problems = [];
    for (const row of scope.querySelectorAll('.pool-option, .pool-toggle-row, .pool-action-row')) {
      if (!visible(row)) continue;
      const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
      const middle = (rect.top + parseFloat(style.paddingTop) + rect.bottom - parseFloat(style.paddingBottom)) / 2;
      for (const child of row.children) {
        if (child.matches('input') || !visible(child)) continue;
        const offset = Math.abs(centre(child.getBoundingClientRect()) - middle);
        if (offset > 1) problems.push(`${row.textContent.trim().slice(0, 40)}: ${child.className || child.tagName} ${offset.toFixed(1)}px off centre`);
      }
    }
    return problems;
  });
}

for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  test(`the React Computers drawer keeps its box while it loads and while its choices change (${name})`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await react(page); await offline(page, baseURL);
    await page.goto('/?view=computers');
    const drawer = pane(page);
    await expect(drawer).toBeVisible({ timeout: 30000 });
    await watchBox(drawer);
    await page.waitForTimeout(2500);
    await drawer.locator('[data-production-device] > summary').click();
    await drawer.getByRole('switch', { name: 'Help peers connect' }).focus();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => { const watch = window.__poolBoxWatch; watch.running = false; return watch.worst; })).toBe(0);
    expect(await misalignedRows(drawer)).toEqual([]);
  });
}

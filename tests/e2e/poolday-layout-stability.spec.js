import { test, expect } from '@playwright/test';

/*
 * Poolday panels and dialogs keep their box after first paint: while their data loads and while a person
 * changes the choices in them. Rows built from the choice primitives keep icons, text and trailing
 * controls on one centre line, within 1 px. Run against a local server; external traffic is blocked so
 * discovery fails the same way every time.
 */

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

async function open(page, baseURL, path = '/') {
  const origin = new URL(baseURL).origin;
  // Settled boxes only: entrance motion is off, as it is for anyone who prefers reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('reploid.auto-download.v1', 'off'));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto(path);
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
}

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

async function boxChange(page) {
  return page.evaluate(() => { const watch = window.__poolBoxWatch; watch.running = false; return watch.worst; });
}

/** Rows whose icon, text or trailing control is off the row's centre line, and icons off their box centre. */
async function misalignedRows(root) {
  return root.evaluate(scope => {
    const centre = rect => (rect.top + rect.bottom) / 2;
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const problems = [];
    for (const row of scope.querySelectorAll('.pool-option, .pool-toggle-row, .pool-action-row')) {
      if (!visible(row)) continue;
      const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
      const top = rect.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
      const bottom = rect.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
      const middle = (top + bottom) / 2;
      for (const child of row.children) {
        if (child.matches('input') || !visible(child)) continue;
        const offset = Math.abs(centre(child.getBoundingClientRect()) - middle);
        if (offset > 1) problems.push(`${row.textContent.trim().slice(0, 40)}: ${child.className || child.tagName} ${offset.toFixed(1)}px off centre`);
      }
      for (const box of row.querySelectorAll('.pool-icon-box, .pool-option-mark')) {
        const icon = box.querySelector('svg');
        if (!icon || !visible(box)) continue;
        const offset = Math.abs(centre(icon.getBoundingClientRect()) - centre(box.getBoundingClientRect()));
        if (offset > 1) problems.push(`${row.textContent.trim().slice(0, 40)}: icon ${offset.toFixed(1)}px off its box centre`);
      }
    }
    for (const button of scope.querySelectorAll('.pool-button:not(.pool-icon)')) {
      const icon = button.querySelector(':scope > svg'), label = button.querySelector(':scope > span');
      // Only an icon beside its label shares the label's line; a stacked tile puts the icon above it.
      if (!icon || !label || !visible(button) || !visible(label) || getComputedStyle(button).flexDirection.startsWith('column')) continue;
      const offset = Math.abs(centre(icon.getBoundingClientRect()) - centre(label.getBoundingClientRect()));
      if (offset > 1) problems.push(`${button.textContent.trim().slice(0, 40)}: icon ${offset.toFixed(1)}px off its label`);
    }
    return problems;
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`Poolday layout stability (${name})`, () => {
    test.use({ viewport });

    for (const view of ['settings', 'computers', 'conversation', 'threads']) {
      test(`the ${view} panel keeps its box while it loads and while its choices change`, async ({ page, baseURL }) => {
        await open(page, baseURL, `/?view=${view}`);
        const panel = page.locator(view === 'threads' ? '[data-threads-dialog]' : '#network-inspector-panel');
        await expect(panel).toBeVisible();
        await watchBox(panel);
        await page.waitForTimeout(2500);
        if (view === 'settings') {
          await panel.locator('[data-pool-theme-choice=dark]').check();
          await panel.locator('[data-pool-theme-choice=light]').check();
          await panel.locator('[data-settings-advanced] > summary').click();
          await panel.locator('[data-web-search-config] > summary').click();
          await panel.locator('[data-model-sharing-limits] > summary').click();
          const bounded = panel.locator('[data-file-mode][value=bounded-acquisition]');
          if (await bounded.isEnabled()) await bounded.check();
        }
        if (view === 'computers') {
          await panel.locator('[data-production-device] > summary').click();
          await panel.locator('[data-toggle-introductions]').focus();
        }
        if (view === 'threads') await page.locator('[data-show-archived]').click();
        await page.waitForTimeout(500);
        expect(await boxChange(page)).toBe(0);
        expect(await misalignedRows(panel)).toEqual([]);
      });
    }

    test('"Who can read it" keeps its box while presets are compared, and says why confidential execution is unavailable', async ({ page, baseURL }) => {
      await open(page, baseURL);
      await page.locator('[data-open-model]').click();
      await page.locator('[data-model-picker] [data-open-privacy]').click();
      const dialog = page.locator('[data-privacy-dialog]');
      await expect(dialog).toBeVisible();
      // The exposure statement waits collapsed; opened, it keeps one height whichever preset is chosen.
      await expect(dialog.locator('[data-privacy-detail]')).not.toHaveAttribute('open', '');
      await dialog.locator('[data-privacy-detail] > summary').click();
      await watchBox(dialog);
      await expect(dialog.locator('[data-preset-status=no-device]')).toHaveText(/^Not available yet\. Planned:/);
      await expect(dialog.locator('[value=no-device]')).toBeDisabled();
      for (const preset of ['standard', 'own-devices', 'standard']) {
        await dialog.locator(`[value=${preset}]`).check();
        await expect(dialog.locator(`[data-preset-note=${preset}]`)).toBeVisible();
      }
      await page.waitForTimeout(500);
      expect(await boxChange(page)).toBe(0);
      expect(await misalignedRows(dialog)).toEqual([]);
      await dialog.locator('[data-dialog-close]').click();
      await expect(dialog).toBeHidden();
    });

    test('the download and sharing dialog keeps its box while its size check runs and its options change', async ({ page, baseURL }) => {
      await open(page, baseURL, '/?view=computers');
      await page.locator('[data-production-device] > summary').click();
      const choice = page.locator('[data-production-model]:not(:disabled)').first();
      test.skip(await choice.count() === 0, 'No model can be offered for sharing on this server.');
      await choice.click();
      const dialog = page.locator('[data-model-dialog]');
      await expect(dialog).toBeVisible();
      await watchBox(dialog);
      const files = dialog.locator('[data-download-files]');
      if (await files.isEnabled()) { await files.check(); await files.uncheck(); }
      await page.waitForTimeout(2500);
      expect(await boxChange(page)).toBe(0);
      expect(await misalignedRows(dialog)).toEqual([]);
      // The primary acts, or the footer says why it cannot.
      const confirm = dialog.locator('[data-download-confirm]');
      if (await confirm.isDisabled()) await expect(dialog.locator('[data-download-size]')).not.toHaveText('');
    });

    test('confirmation dialogs keep their box when an error appears', async ({ page, baseURL }) => {
      await open(page, baseURL, '/?view=settings');
      for (const selector of ['[data-storage-dialog]', '[data-data-dialog]']) {
        const dialog = page.locator(selector);
        await dialog.evaluate(node => node.showModal());
        await watchBox(dialog);
        await dialog.locator('[role=alert]').evaluate(node => { node.textContent = 'In use by another tab'; node.hidden = false; });
        await page.waitForTimeout(200);
        expect(await boxChange(page)).toBe(0);
        await dialog.locator('[data-dialog-close]').click();
        await expect(dialog).toBeHidden();
      }
    });
  });
}

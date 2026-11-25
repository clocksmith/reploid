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
        const panel = page.locator(view === 'threads' ? '[data-threads-dialog]' : `#workspace-${view}`);
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

    test('Answer on: every computer and model is one single-select row, and nothing floats beside a row', async ({ page, baseURL }) => {
      await open(page, baseURL);
      await page.locator('[data-open-model]').click();
      const picker = page.locator('[data-model-picker]');
      await expect(picker).toBeVisible();
      await watchBox(picker);
      // It never opens with a computer and a model that disagree, and the composer chip names the same computer.
      const opening = await picker.evaluate(node => {
        const computer = node.querySelector('[data-execution-location] input:checked')?.closest('[data-execution-choice]')?.dataset.executionChoice;
        const model = [...node.querySelectorAll('[data-next-model] input')].find(input => input.checked);
        return { computer, group: model?.closest('[data-choice-group]')?.dataset.choiceGroup ?? null,
          chip: document.querySelector('[data-composer-model-source]')?.textContent };
      });
      const agrees = { local: ['local', 'download'], network: ['shared', 'private'], desktop: ['shared', 'private', 'local'] }[opening.computer] || [];
      expect(opening.group === null || agrees.includes(opening.group), JSON.stringify(opening)).toBe(true);
      expect(opening.chip).toBe({ local: 'This device', network: 'Contributors' }[opening.computer] ?? opening.chip);
      await expect(picker.locator('[data-execution-location]')).toHaveAttribute('role', 'radiogroup');
      await expect(picker.locator('[data-execution-choice] input').first()).toHaveAttribute('type', 'radio');
      await picker.locator('[data-execution-choice=network]').click();
      await picker.locator('[data-execution-choice=local]').click();
      await page.waitForTimeout(1500);
      expect(await boxChange(page)).toBe(0);
      expect(await misalignedRows(picker)).toEqual([]);
      // A model's computer count is part of its status line; the only thing beside a row is its trailing chevron.
      const floating = await picker.locator('[data-inspect-model-providers]:not([hidden])').evaluateAll(nodes => nodes.filter(node => {
        const row = node.closest('.pool-choice-row').querySelector('.pool-option').getBoundingClientRect(), box = node.getBoundingClientRect();
        return box.right > row.right + 1 || box.left < row.left || box.top < row.top - 1 || box.bottom > row.bottom + 1;
      }).length);
      expect(floating).toBe(0);
    });

    test('"Who can read it" keeps its box while routes are compared, and says why each unavailable protection is unavailable', async ({ page, baseURL }) => {
      await open(page, baseURL);
      await page.locator('[data-composer-field] [data-open-privacy]').click();
      const dialog = page.locator('[data-privacy-dialog]');
      await expect(dialog).toBeVisible();
      // The exposure statement waits collapsed; opened, it keeps one height whichever preset is chosen.
      await expect(dialog.locator('[data-privacy-detail]')).not.toHaveAttribute('open', '');
      await dialog.locator('[data-privacy-detail] > summary').click();
      await watchBox(dialog);
      for (const protection of ['secret-sharing', 'homomorphic', 'attested']) {
        await expect(dialog.locator(`[data-protection-status=${protection}]`)).toHaveText(/\. Unavailable: \S/);
        await expect(dialog.locator(`[data-privacy-protection][value=${protection}]`)).toBeDisabled();
      }
      // Let it choose names what the approved computers see; This device names what stays here.
      for (const [route, note] of [['auto', 'standard'], ['local', 'own-devices'], ['auto', 'standard']]) {
        await dialog.locator(`[data-privacy-route][value=${route}]`).check();
        await expect(dialog.locator(`[data-preset-note=${note}]`)).toBeVisible();
      }
      await expect(dialog.locator('[data-privacy-route][value=split-local-edges]')).toBeDisabled();
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
      const files = dialog.locator('[data-download-files] input');
      if (await files.isEnabled()) { await files.check(); await files.uncheck(); }
      await page.waitForTimeout(2500);
      expect(await boxChange(page)).toBe(0);
      expect(await misalignedRows(dialog)).toEqual([]);
      // The primary acts, or the footer says why it cannot.
      const confirm = dialog.locator('[data-download-confirm]');
      if (await confirm.isDisabled()) await expect(dialog.locator('[data-download-size]')).not.toHaveText('');
    });

    test('confirmation dialogs keep their box when an error appears', async ({ page, baseURL }) => {
      // Every dialog shares one shell whose footer reserves the line an error takes. A real refusal shows it: a
      // protection this browser cannot run is refused on Apply, and nothing moves.
      await open(page, baseURL);
      await page.locator('[data-composer-field] [data-open-privacy]').click();
      const dialog = page.locator('[data-privacy-dialog]');
      await expect(dialog).toBeVisible();
      await dialog.evaluate(node => {
        const input = node.querySelector('[data-privacy-protection][value=homomorphic]');
        input.disabled = false; input.click();
      });
      await watchBox(dialog);
      await dialog.locator('[data-privacy-apply]').click();
      await expect(dialog.locator('[data-privacy-error]')).toContainText('unavailable here');
      await page.waitForTimeout(200);
      expect(await boxChange(page)).toBe(0);
      await dialog.locator('[data-dialog-close]').click();
      await expect(dialog).toBeHidden();
    });
  });
}

/*
 * Opening a side drawer never moves the conversation, and never leaves a composer control under the drawer. A window
 * wide enough holds the drawers in its side margins; a narrower one lets the drawer lie over the conversation's edge,
 * and the composer gives up that strip.
 */
for (const width of [800, 1100, 1280, 1366, 1440, 1728]) {
  test(`drawers leave the conversation in place and the composer's controls uncovered at ${width} px`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, baseURL, '/?view=chat');
    await expect(page.locator('[data-composer-input]')).toBeVisible();
    // Two frames first: with reduced motion a changed box settles on the frame after the change, not within it.
    const measure = () => page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const edges = node => { const box = node.getBoundingClientRect(); return { left: Math.round(box.left), right: Math.round(box.right) }; };
      const drawers = [...document.querySelectorAll('.pool-drawer')].filter(node => !node.hidden && node.getBoundingClientRect().width);
      const under = [];
      for (const control of document.querySelectorAll('[data-composer-area] :is(button, textarea, select)')) {
        const box = control.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        for (const drawer of drawers) {
          const cover = drawer.getBoundingClientRect();
          if (Math.min(box.right, cover.right) - Math.max(box.left, cover.left) > 0.5) under.push(control.getAttribute('aria-label') || control.tagName);
        }
      }
      const toolbar = document.querySelector('[data-composer-field] .pool-toolbar');
      return { composer: edges(document.querySelector('[data-composer-area]')), transcript: edges(document.querySelector('[data-chat-transcript]')),
        drawers: drawers.length, under, toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth };
    });
    const closed = await measure();
    expect(closed.drawers).toBe(0);
    for (const view of ['computers', 'settings', 'threads']) {
      await page.locator(`[data-workspace-view="${view}"]:visible`).first().click();
      await expect(page.locator(view === 'threads' ? '[data-threads-dialog]' : `#workspace-${view}`)).toBeVisible();
      const opened = await measure();
      expect(opened.drawers, `${view}: a drawer is open`).toBeGreaterThan(0);
      expect(opened.composer, `${view}: the composer's box`).toEqual(closed.composer);
      expect(opened.transcript, `${view}: the transcript's box`).toEqual(closed.transcript);
      expect(opened.under, `${view}: composer controls under a drawer`).toEqual([]);
      expect(opened.toolbarOverflow, `${view}: the composer's toolbar fits its row`).toBeLessThanOrEqual(1);
    }
  });
}

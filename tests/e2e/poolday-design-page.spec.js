// The /design page: built from @reploid/poolday-ui, ordered tokens -> primitives -> compositions,
// each shown in use, one current navigator item, both themes, wide and narrow, keyboard operable.
import { test, expect } from '@playwright/test';

const errorsOf = page => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
};

const openDesign = async page => {
  await page.goto('/design');
  await expect(page.locator('[data-design-page]')).toBeVisible();
  // Token values arrive from the served tokens.css.
  await expect(page.locator('[data-token="--pool-size-4"]')).toContainText('4px');
};

for (const [width, height] of [[1280, 800], [390, 844]]) {
  test(`design page at ${width}px: ordered, in use, system-only, one current item`, async ({ page }) => {
    const errors = errorsOf(page);
    await page.setViewportSize({ width, height });
    await openDesign(page);
    const order = await page.evaluate(() => ['tokens', 'primitives', 'compositions'].map(id => document.getElementById(id)?.getBoundingClientRect().top ?? -1));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);

    // Each layer is shown in use: a token names the primitives that read it, a primitive renders
    // a specimen and names its compositions, a composition renders and names its primitives.
    const use = await page.evaluate(() => {
      const all = selector => [...document.querySelectorAll(selector)];
      return {
        tokens: all('[data-token]').length,
        tokensInUse: all('[data-token]').filter(node => /Used by: /.test(node.textContent) && node.querySelector('.pool-swatch')).length,
        primitives: all('[data-primitive]').length,
        primitivesInUse: all('[data-primitive]').filter(node => /Used in: /.test(node.textContent)).length,
        compositions: all('[data-composition]').length,
        compositionsInUse: all('[data-composition]').filter(node => /Composed of: /.test(node.textContent) && node.querySelector('figure')?.textContent.trim()).length,
      };
    });
    expect(use.tokens).toBeGreaterThan(90);
    expect(use.tokensInUse).toBe(use.tokens);
    expect(use.primitives).toBeGreaterThan(30);
    expect(use.primitivesInUse).toBe(use.primitives);
    expect(use.compositions).toBeGreaterThan(5);
    expect(use.compositionsInUse).toBe(use.compositions);

    const nav = page.getByRole('navigation', { name: 'Design system sections' });
    for (const anchor of ['primitive-Sheet', 'composition-AnswerOnSheet']) {
      await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start' }), anchor);
      await expect.poll(() => nav.locator('[aria-current]').count()).toBe(1);
    }
    // At the end of the page the last section is the current one.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(nav.locator(width > 760 ? '[aria-current]' : '[data-contains-current]')).toHaveText(width > 760 ? 'ComputePage' : 'Compositions');
    await expect(nav.locator('[aria-current]')).toHaveCount(1);

    // Built only from the system: its classes, its stylesheets, and no style beyond component parameters.
    const built = await page.evaluate(() => ({
      foreignClasses: [...document.querySelectorAll('#app [class]')].flatMap(node => [...node.classList]).filter(name => !/^(pool|btn)-/.test(name)),
      styleProperties: [...new Set([...document.querySelectorAll('#app [style]')].flatMap(node => [...node.style]))].filter(name => !name.startsWith('--pool-param-')),
      styleElements: document.querySelectorAll('style').length,
      stylesheets: [...document.styleSheets].map(sheet => new URL(sheet.href).pathname).filter(path => !path.startsWith('/styles/poolday/')),
    }));
    expect(built).toEqual({ foreignClasses: [], styleProperties: [], styleElements: 0, stylesheets: [] });
    // Nothing overflows the viewport horizontally.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`design page at ${width}px: the keyboard reaches and operates the interactive examples`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openDesign(page);
    const primitive = name => page.locator(`[data-primitive="${name}"]`);

    // Tab enters the page at the navigator, and Enter on a destination moves reading there.
    await page.keyboard.press('Tab');
    const nav = page.getByRole('navigation', { name: 'Design system sections' });
    await expect(nav.getByRole('link', { name: 'Tokens', exact: true })).toBeFocused();
    await nav.getByRole('link', { name: 'Compositions', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#compositions')).toBeFocused();
    await expect(page).toHaveURL(/#compositions$/);

    // A switch toggles with Space; radios move with arrows; a check box toggles with Space.
    const toggle = primitive('Toggle').getByRole('switch').first();
    const was = await toggle.getAttribute('aria-checked');
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
    const computers = primitive('SingleChoice').getByRole('radiogroup', { name: 'Computer' });
    await computers.getByRole('radio', { name: 'This device' }).focus();
    await page.keyboard.press('ArrowDown');
    // The disabled option is skipped.
    await expect(computers.getByRole('radio', { name: 'Contributors' })).toBeChecked();
    await expect(computers.locator('input:checked')).toHaveCount(1);
    const share = primitive('MultiChoice').getByRole('checkbox').first();
    const shared = await share.isChecked();
    await share.focus();
    await page.keyboard.press('Space');
    expect(await share.isChecked()).toBe(!shared);

    // Fields take typing; a disclosure opens with Enter.
    const field = primitive('Field').getByRole('textbox').first();
    await field.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('typed');
    await expect(field).toHaveValue('typed');
    const details = primitive('Disclosure').locator('details').first();
    await details.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');

    // A dialog opens with Enter, holds focus, closes with Escape and returns focus to its opener.
    for (const name of ['Open the dialog', 'Open the sheet']) {
      const open = page.getByRole('button', { name });
      await open.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('dialog[open]')).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]')) || document.activeElement === document.body)).toBe(true);
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      await expect(open).toBeFocused();
    }

    // Compositions are live: the workspace sends on Enter, and a state is chosen with arrows.
    const workspace = page.locator('[data-composition="ChatWorkspace"]');
    await workspace.getByRole('textbox', { name: 'Message' }).focus();
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    await expect(workspace.locator('[data-composer-stop]')).toBeVisible();
    const states = page.locator('[data-composition="ComposerBar"]').getByRole('radiogroup', { name: 'ComposerBar State' });
    await states.getByRole('radio', { name: 'Ready on this device' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(states.getByRole('radio', { name: 'Finding computers' })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test('at phone width a navigator jump stops the section below the pinned bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDesign(page);
  for (const id of ['compositions', 'primitives']) {
    await page.locator(`.pool-sidebar-nav a[href="#${id}"]`).click();
    await expect.poll(() => page.evaluate(target => {
      const bar = document.querySelector('.pool-sidebar-nav').getBoundingClientRect();
      const heading = document.getElementById(target).getBoundingClientRect();
      return bar.top === 0 && heading.top >= bar.bottom - 1 && heading.top < window.innerHeight / 2;
    }, id)).toBe(true);
  }
});

test('design page switches theme and frame width from the keyboard', async ({ page }) => {
  await openDesign(page);
  const themes = page.locator('[data-design-theme]');
  await themes.getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-reploid-theme', 'light');
  await expect(page.locator('[data-design-page]')).toHaveAttribute('data-pool-theme', 'light');
  // Arrow keys move the choice within a radio group.
  await themes.getByRole('radio', { name: 'Light' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(themes.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.locator('[data-design-page]')).toHaveAttribute('data-pool-theme', 'dark');
  // The choice survives a reload.
  await themes.getByRole('radio', { name: 'Light' }).check();
  await page.reload();
  await expect(page.locator('[data-design-page]')).toHaveAttribute('data-pool-theme', 'light');
  const frame = page.locator('[data-composition="ConversationDetailsPanel"] figure');
  const wide = (await frame.boundingBox()).width;
  await page.locator('[data-design-width]').getByRole('radio', { name: 'Wide' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await frame.boundingBox()).width).toBeLessThan(wide);
});

test('the Zero / X RD specimen moved to /x/design, and the old Poolday address redirects', async ({ page }) => {
  const response = await page.goto('/x/design');
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle('RD Design System');
  await page.goto('/design/poolday');
  await expect(page).toHaveURL(/\/design$/);
  await expect(page).toHaveTitle('Poolday design system');
});

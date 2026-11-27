// Every route is the React product: the workspace opens the real host, renders only @reploid/poolday-ui
// classes, and its Answer on sheet works by keyboard at both widths; a specialist route loads the same bundle.
import { test, expect } from '@playwright/test';
import { privateRoom } from '../fixtures/current-contribution.js';

const bundlesOf = page => {
  const requested = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/ui/')) requested.push(path);
  });
  return requested;
};

for (const [width, height] of [[1280, 800], [390, 844]]) {
  test(`React workspace at ${width}px: chat on the real host, Answer on by keyboard`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const requested = bundlesOf(page);
    await page.setViewportSize({ width, height });
    // A private room: the page cannot reach unrelated public computers.
    await page.goto(privateRoom('react-shell'));
    await expect(page.locator('[data-react-shell] [data-chat-workspace]')).toBeVisible({ timeout: 30000 });
    expect(requested).toEqual(['/ui/react/app.js']);
    const foreign = await page.evaluate(() => [...document.querySelectorAll('[data-react-shell] [class]')].flatMap(node => [...node.classList]).filter(name => !/^(pool|btn)-/.test(name)));
    expect(foreign).toEqual([]);
    const answerOn = page.locator('[data-open-model]');
    await answerOn.focus();
    await page.keyboard.press('Enter');
    const sheet = page.locator('dialog[open][data-model-picker]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-execution-location] input:checked')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(answerOn).toBeFocused();
    const composer = page.getByRole('textbox', { name: 'Message' });
    await composer.fill('Hello');
    await expect(composer).toHaveValue('Hello');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a specialist route is the same React bundle and loads no other interface module', async ({ page }) => {
  const requested = bundlesOf(page);
  await page.goto('/examples' + privateRoom('react-shell-examples').slice(1));
  await expect(page.locator('[data-react-shell] [data-route-page]')).toBeVisible({ timeout: 30000 });
  expect(requested).toEqual(['/ui/react/app.js']);
});

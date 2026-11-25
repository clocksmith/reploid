import { test, expect } from '@playwright/test';

for (const width of [1440, 320]) test(`optional context controls at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.evaluate(async () => {
    const { mountPoolday } = await import('/ui/react/app.js');
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    const session = createChatSession({ storage: null, models: [CANONICAL_CHAT_MODELS[1]] });
    session.createThread({ sharingScope: 'local' });
    window.contextSession = session;
    window.disposeContext = mountPoolday(root, { host: { chat: session, close: async () => {} } });
  });
  await page.locator('[data-chat-rail-toolbar] [data-inspector-section="conversation"]').click();
  const pane = page.locator('[data-inspector-pane="conversation"]');
  const enabled = pane.locator('[data-context-enabled] [role=switch]');
  const cap = words => pane.locator(`[data-context-cap="${words}"]`);
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await expect(cap(16).locator('input')).toBeChecked();
  await expect(cap(16).locator('input')).toBeEnabled();
  for (const words of [16, 32, 64]) {
    await cap(words).click();
    await expect(cap(words).locator('input')).toBeChecked();
    const text = await pane.locator('[data-context-preview]').innerText();
    expect(text.trim().split(/\s+/u).length).toBeLessThanOrEqual(words);
    expect(text).toContain('Reploid');
    await expect(pane.locator('[data-context-count]')).toContainText('Replies are not limited');
    const box = await pane.locator('[data-context-controls]').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath(`context-${width}.png`), fullPage: true });
  await enabled.click();
  await expect(pane.locator('[data-context-preview]')).toHaveText('Off. No app context is added.');
  await page.evaluate(async () => { window.disposeContext(); await window.contextSession.close(); });
});

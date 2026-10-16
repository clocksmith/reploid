import { test, expect } from '@playwright/test';

for (const width of [1440, 320]) test(`optional context controls at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.evaluate(async () => {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const root = document.querySelector('.pool-home');
    const railToggle = root.querySelector('[data-toggle-thread-rail]').cloneNode(true);
    const fixture = root.cloneNode(false);
    fixture.innerHTML = root.querySelector('.pool-primary-nav').outerHTML
      + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>';
    // The bound page has already moved this control out of the original nav.
    fixture.querySelector('.pool-primary-nav').append(railToggle);
    document.body.replaceChildren(fixture);
    const session = createChatSession({ storage: null, models: [CANONICAL_CHAT_MODELS[1]] });
    session.createThread({ sharingScope: 'local' });
    window.contextSession = session;
    window.disposeContext = bindConversationWorkspace(fixture, session);
  });
  await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-conversation-actions] > summary').click();
  const enabled = page.locator('[data-context-enabled]');
  const cap = page.locator('[data-context-cap]');
  await expect(enabled).toBeChecked();
  await expect(cap).toHaveValue('16');
  await expect(cap).toBeEnabled();
  for (const words of [16, 32, 64]) {
    await cap.selectOption(String(words));
    const text = await page.locator('[data-context-preview]').innerText();
    expect(text.trim().split(/\s+/u).length).toBeLessThanOrEqual(words);
    expect(text).toContain('Reploid');
    await expect(page.locator('[data-context-count]')).toContainText('Replies are not limited');
    const box = await page.locator('[data-context-controls]').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath(`context-${width}.png`), fullPage: true });
  await enabled.uncheck();
  await expect(page.locator('[data-context-preview]')).toHaveText('Off. No app context is added.');
  await page.evaluate(async () => { window.disposeContext(); await window.contextSession.close(); });
});

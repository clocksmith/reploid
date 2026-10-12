import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`${theme} independent rails and readable approval at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    await expect(page.locator('[data-thread-sidebar]')).toBeHidden();
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-thread-sidebar]')).toBeVisible();
    await page.locator('[data-pool-settings] > summary').click();
    await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
    await expect(page.locator('[data-thread-sidebar]')).toBeVisible();
    await page.locator('[data-inspector-section="participants"]').click();
    if (width > 760) {
      const panel = await page.locator('[data-contextual-inspector]').boundingBox();
      const composer = await page.locator('[data-composer-area]').boundingBox();
      expect(composer.x + composer.width).toBeLessThanOrEqual(panel.x);
    }
    await expect(page.locator('[data-mesh-connect]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('both-rails.png'), fullPage: true });
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-thread-sidebar]')).toBeVisible();
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-thread-sidebar]')).toBeHidden();
    await expect(page.locator('[data-composer-input]')).toBeInViewport();
    // Bind a scoped presentation fixture; no model or disclosure is executed.
    await page.evaluate(async () => {
      const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
      const { attachmentInput, comparisonSources } = await import('/host/document-comparison.js');
      const root = document.querySelector('.pool-route-content');
      root.innerHTML = renderConversationWorkspace();
      const model = { id: 'fixture', name: 'Qwen', availability: 'ready' };
      const input = attachmentInput('Compare these quotes.', [{ name: 'Maple.txt', text: '$42 including materials.\n\n' + 'Source passage. '.repeat(300) }, { name: 'Cedar.txt', text: '$54, excluding permits.' }]);
      const thread = { id: 'thread', model, messages: [{ id: 'm1', role: 'user', content: input }], attempts: [{ id: 'a1', status: 'approval', approval: { id: 'p1', peerId: 'peer-A', reusable: true, disclosure: 'partition-activations-and-tokens', input: { messages: [{ role: 'user', content: input }], recipients: ['peer-A', 'peer-B'] } } }], grants: [] };
      const state = { models: [model], threads: [thread], activeThread: thread, selectedId: 'thread', runningIds: ['thread'], network: {} };
      window.disposeReview = bindConversationWorkspace(root, { getState: () => state, subscribe(fn) { fn(state); return () => {}; }, getDocumentSources: comparisonSources });
    });
    await expect(page.locator('[data-permission-review-label]')).toHaveText('Review 1 message · 2 attachments');
    await expect(page.locator('[data-composer-area]')).toBeHidden();
    await expect(page.locator('[data-approval-send]')).toBeInViewport();
    await page.locator('[data-permission-review-label]').click();
    await expect(page.locator('[data-permission-content]')).not.toContainText('reploid-document-sources');
    await page.locator('[data-permission-content] summary').first().click();
    const nested = await page.locator('[data-chat-transcript]').evaluate(root => [...root.querySelectorAll('*')].filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).map(node => node.className));
    expect(nested).toEqual([]);
    await page.locator('[data-approval-send]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-approval-send]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath('approval.png'), fullPage: true });
  });
}

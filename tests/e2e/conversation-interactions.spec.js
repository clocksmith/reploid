import { test, expect } from '@playwright/test';

test('optional and specialist routes still mount their existing views', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const route of ['/network', '/improve', '/examples', '/ask', '/compute', '/records', '/history', '/room-1']) {
    await page.goto(route);
    const content = page.locator('.pool-route-content');
    await expect(content).toBeVisible();
    await expect(content.locator('section').first()).toBeVisible();
    await expect(content).not.toContainText('Could not open this view');
  }
  expect(errors).toEqual([]);
});

test('ordinary entry stays focused, and route navigation preserves a draft', async ({ page }) => {
  const modules = [];
  page.on('request', request => modules.push(new URL(request.url()).pathname));
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  expect(modules).not.toContain('/ui/pool-home/controls.js');
  expect(modules).not.toContain('/ui/pool-home/view.js');
  expect(modules).not.toContain('/ui/pool-home/prism.js');
  const ribbon = page.locator('[data-ribbon-trigger]');
  await ribbon.focus(); await expect(page.locator('[data-ribbon-details]')).toBeHidden();
  await ribbon.press('Enter'); await expect(page.locator('[data-ribbon-details]')).toBeVisible();
  await ribbon.press('Escape'); await expect(page.locator('[data-ribbon-details]')).toBeHidden();
  await expect(ribbon).toBeFocused();
  await page.locator('[data-composer-input]').fill('Keep my question while I inspect the network');
  await page.locator('[data-pool-settings] summary').click();
  await page.locator('[data-pool-settings] [data-pool-route-link="/network"]').click();
  await expect(page.locator('[data-network-workspace]')).toBeVisible();
  await page.locator('.pool-primary-brand').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep my question while I inspect the network');
  await page.reload();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep my question while I inspect the network');
});

test('phone thread drawer preserves drafts, streaming nodes, and isolated Stop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderConversationWorkspace();
    const model = { id: 'fixture', name: 'Test model', availability: 'ready' };
    const threads = ['one', 'two'].map(id => ({ id, purpose: id, model, messages: [
      { id: `${id}-question`, role: 'user', content: 'Question' },
      { id: `${id}-reply`, role: 'assistant', content: 'First words', attemptId: id }
    ], attempts: [{ id, status: 'executing' }] }));
    const listeners = new Set(), drafts = new Map();
    const state = { threads, selectedId: 'one', activeThread: threads[0], runningIds: ['one', 'two'], models: [model], network: {} };
    const emit = () => listeners.forEach(fn => fn(state));
    window.advanceConversation = () => { threads[0].messages[1].content += ' and more'; emit(); };
    window.conversationState = state;
    bindConversationWorkspace(root, {
      getState: () => state, subscribe: fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
      select(id) { state.selectedId = id; state.activeThread = threads.find(thread => thread.id === id); emit(); },
      saveDraft: (id, value) => drafts.set(id, structuredClone(value)), getDraft: id => drafts.get(id),
      cancel(id) { state.runningIds = state.runningIds.filter(value => value !== id); threads.find(thread => thread.id === id).attempts[0].status = 'cancelled'; emit(); }
    });
  });
  await expect(page.locator('[data-thread-sidebar]')).toBeHidden();
  await page.locator('[data-composer-input]').fill('Draft one');
  await page.locator('[data-open-threads]').click();
  await expect(page.locator('[data-thread-dialog]')).toBeVisible();
  await page.locator('[data-thread-item-id="two"]').click();
  await expect(page.locator('[data-thread-dialog]')).toBeHidden();
  await page.locator('[data-composer-input]').fill('Draft two');
  await page.locator('[data-open-threads]').click();
  await page.locator('[data-thread-item-id="one"]').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Draft one');
  await page.evaluate(() => {
    const node = document.querySelector('[data-message-id="one-reply"] [data-text-block] span').firstChild;
    window.savedTextNode = node;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.advanceConversation();
  });
  expect(await page.evaluate(() => ({ same: window.savedTextNode === document.querySelector('[data-message-id="one-reply"] [data-text-block] span').firstChild,
    selection: getSelection().toString() }))).toEqual({ same: true, selection: 'First' });
  await page.locator('[data-composer-stop]').click();
  expect(await page.evaluate(() => window.conversationState.runningIds)).toEqual(['two']);
  await page.locator('[data-open-threads]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-thread-dialog]')).toBeHidden();
  await expect(page.locator('[data-open-threads]')).toBeFocused();
});

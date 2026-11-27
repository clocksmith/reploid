import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) test(`model picker retains unavailable choices and the original thread at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.evaluate(async () => {
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const [first, second] = CANONICAL_CHAT_MODELS;
    const peer = (model, index) => ({ peerId: `fixture-${index}`, model: model.id, modelIdentity: model.identity,
      readiness: 'ready', hasInference: true, availableSlots: 1, identityProtocol: 1, admissionProtocol: 2 });
    let peers = [peer(first, 0), peer(second, 1)];
    const session = createChatSession({ storage: null, swarm: { getState: () => ({ consumer: { peers } }) } });
    const original = session.createThread({ model: first });
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const dispose = mountPoolday(root, { host: { chat: session, close: () => session.close() } });
    window.modelPickerFixture = {
      first: first.id, second: second.id, secondName: second.name,
      setCapacity(ready) { peers = ready ? [peer(first, 0), peer(second, 1)] : [peer(first, 0)]; session.refreshNetwork(); },
      original() { session.select(original); return session.getState().activeThread.model.id; },
      async close() { dispose(); await session.close(); }
    };
  });
  const { first, second, secondName } = await page.evaluate(() => ({ first: window.modelPickerFixture.first, second: window.modelPickerFixture.second, secondName: window.modelPickerFixture.secondName }));
  await page.locator('[data-composer-input]').fill('Keep this original draft');
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  await expect(page.locator('[data-next-model] input:checked')).toHaveValue(first);
  // The picker shows its choices as radios, one per model.
  const choice = page.locator(`[data-model-picker] [data-model-choice="${second}"]`);
  await choice.locator('input').check();
  await page.evaluate(() => window.modelPickerFixture.setCapacity(false));
  await expect(page.locator('[data-next-model] input:checked')).toHaveValue(second);
  // With its shared capacity gone, the choice stays listed under its download group; the sheet names the fix.
  await expect(choice.locator('.pool-row-status')).toHaveText('Download required');
  await expect(page.locator('[data-next-model-status]')).toBeVisible();
  await expect(page.locator('[data-change-model]')).toHaveText('Download');
  await page.evaluate(() => window.modelPickerFixture.setCapacity(true));
  await expect(page.locator('[data-next-model] input:checked')).toHaveValue(second);
  // The thread is on "Only your devices"; using the shared model is the named preset change, never a silent one.
  await expect(page.locator('[data-next-model-status]')).toHaveText(/^Only your devices can read this chat/);
  await expect(page.locator('[data-change-model]')).toHaveText('Use contributors');
  await page.locator('[data-change-model]').click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  await expect(page.locator('[data-composer-model-name]')).toHaveText(secondName);
  expect(await page.evaluate(() => window.modelPickerFixture.original())).toBe(first);
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this original draft');
  await page.evaluate(() => window.modelPickerFixture.close());
});

test('optional and specialist routes still mount their existing views', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // /network is the conversation workspace (the React product); the rest keep their vanilla views.
  await page.goto('/network');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  // Recent jobs (also /history) and Research Room-1 are React pages: each mounts its page content beneath the app bar.
  for (const [route, page_] of [['/records', 'records'], ['/history', 'records'], ['/room-1', 'room-1']]) {
    await page.goto(route);
    await expect(page.locator(`[data-route-page="${page_}"] [data-route-page-content="${page_}"]`)).toBeVisible();
    await expect(page.locator('[data-route-page]')).not.toContainText('Could not open this view');
  }
  for (const route of ['/improve', '/examples', '/ask', '/compute']) {
    await page.goto(route);
    // A route the React product has moved shows its page beneath the app bar; the rest keep their vanilla view.
    const content = page.locator('.pool-route-content, [data-route-page]');
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
  // Conversation details is a destination in the bar; it opens by keyboard and Escape returns to it.
  const ribbon = page.locator('[data-inspector-section="conversation"]');
  const inspector = page.locator('[data-contextual-inspector]:visible');
  await ribbon.focus(); await expect(inspector).toHaveCount(0);
  await ribbon.press('Enter'); await expect(inspector).toBeVisible();
  await page.keyboard.press('Escape'); await expect(inspector).toHaveCount(0);
  await expect(ribbon).toBeFocused();
  await page.locator('[data-composer-input]').fill('Keep my question while I inspect the network');
  await page.locator('[data-inspector-section="participants"]').click();
  await expect(page.locator('[data-network-workspace]:visible')).toBeVisible();
  await page.locator('[data-close-inspector]:visible').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep my question while I inspect the network');
  await page.reload();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep my question while I inspect the network');
});

test('phone thread drawer preserves drafts, streaming nodes, and isolated Stop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.evaluate(async () => {
    const { mountPoolday } = await import('/ui/react/app.js');
    const root = document.createElement('div'); document.body.replaceChildren(root);
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
    mountPoolday(root, { host: { close: async () => {}, chat: {
      getState: () => state, subscribe: fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
      select(id) { state.selectedId = id; state.activeThread = threads.find(thread => thread.id === id); emit(); },
      saveDraft: (id, value) => drafts.set(id, structuredClone(value)), getDraft: id => drafts.get(id),
      cancel(id) { state.runningIds = state.runningIds.filter(value => value !== id); threads.find(thread => thread.id === id).attempts[0].status = 'cancelled'; emit(); }
    } } });
  });
  // Threads open as a workspace destination from the toolbar, which itself stays in place.
  const threads = page.locator('[data-threads-dialog]');
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await expect(threads).toBeHidden();
  await page.locator('[data-composer-input]').fill('Draft one');
  await page.locator('[data-toggle-thread-rail]').click();
  await expect(threads).toBeVisible();
  await page.locator('[data-thread-item-id="two"]').click();
  await expect(threads).toBeHidden();
  await page.locator('[data-composer-input]').fill('Draft two');
  await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-thread-item-id="one"]').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Draft one');
  await page.evaluate(() => {
    const node = document.querySelector('[data-message-id="one-reply"] .pool-prose [data-text-block]').firstChild;
    window.savedTextNode = node;
    const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, 5);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.advanceConversation();
  });
  expect(await page.evaluate(() => ({ same: window.savedTextNode === document.querySelector('[data-message-id="one-reply"] .pool-prose [data-text-block]').firstChild,
    selection: getSelection().toString() }))).toEqual({ same: true, selection: 'First' });
  // The selected answer's Stop (in the transcript, or the composer's while that one is out of view) stops only it.
  await page.locator('[data-composer-stop], [data-message-id="one-reply"] [data-answer-stop]').filter({ visible: true }).first().click();
  expect(await page.evaluate(() => window.conversationState.runningIds)).toEqual(['two']);
  await page.locator('[data-toggle-thread-rail]').click();
  await page.keyboard.press('Escape');
  await expect(threads).toBeHidden();
  await expect(page.locator('[data-toggle-thread-rail]')).toBeFocused();
});

test('picker lists the catalog adapter beneath its base with purpose, version, availability and evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  const adapter = await page.evaluate(async () => {
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const base = CANONICAL_CHAT_MODELS.find(model => model.availableAdapters?.length), entry = base.availableAdapters[0];
    let peers = [];
    const session = createChatSession({ storage: null, swarm: { getState: () => ({ consumer: { peers } }) } });
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const dispose = mountPoolday(root, { host: { chat: session, close: () => session.close() } });
    window.adapterPickerFixture = {
      serve(on) { peers = on ? [{ peerId: 'fixture-adapter', model: base.id, modelIdentity: base.identity, readiness: 'ready', hasInference: true,
        availableSlots: 1, adapterIdentities: [entry.identity] }] : []; session.refreshNetwork(); },
      async close() { dispose(); await session.close(); }
    };
    return { selectionId: base.id + '/' + entry.id, name: entry.name, version: entry.manifest.version, purpose: entry.purpose.statement };
  });
  await page.locator('[data-open-model]').click();
  const choice = page.locator(`[data-model-picker] [data-model-choice="${adapter.selectionId}"]`);
  await expect(choice).toHaveAttribute('data-choice-adapter', '');
  await expect(choice.locator('.pool-row-status')).toHaveText('No computer serves it now');
  await expect(choice.locator('[data-choice-facts]')).toHaveText(`Adapter · v${adapter.version}`);
  await expect(choice.locator('[data-choice-note]')).toHaveText('No evaluation evidence');
  await choice.locator('input').check();
  const details = page.locator('[data-model-picker] [data-model-adapter-details]');
  await expect(details.locator('[data-adapter-purpose]')).toContainText(adapter.purpose);
  await expect(details.locator('[data-adapter-evidence]')).toHaveText('Evaluation: No evaluation evidence');
  await expect(details.locator('[data-adapter-availability]')).toContainText('the base model is not used instead');
  await expect(page.locator('[data-change-model]')).toBeDisabled();
  await page.evaluate(() => window.adapterPickerFixture.serve(true));
  await expect(choice.locator('.pool-row-status')).toHaveText('Ready');
  await expect(details.locator('[data-adapter-availability]')).toHaveText('Served now by 1 computer');
  // The execution routes sit in Model details.
  await page.locator('[data-model-picker] [data-model-details] > summary').click();
  await expect(page.locator('[data-model-picker] [data-model-details]')).toContainText('Whole model');
  await expect(page.locator('[data-change-model]')).toBeEnabled();
  await page.locator('[data-change-model]').click();
  await expect(page.locator('[data-composer-model-name]')).toHaveText(adapter.name);
  await page.evaluate(() => window.adapterPickerFixture.close());
});

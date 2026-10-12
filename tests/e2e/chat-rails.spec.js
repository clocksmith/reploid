import { test, expect } from '@playwright/test';

// Real host/workspace path with an injected executor. This proves interaction,
// authorization and layout; it does not claim model or physical GPU execution.
async function installChat(page) {
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    document.querySelector('[data-shell-inspector]')?.remove();
    const { createChatSession } = await import('/host/chat-session.js');
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const a = 'peer:' + 'a'.repeat(24), b = 'peer:' + 'b'.repeat(24);
    const model = { id: 'fixture', name: 'Qwen 3.5 0.8B', provider: 'doppler', identity: 'sha256:' + 'c'.repeat(64), availability: 'ready',
      partition: { planId: 'sha256:' + 'd'.repeat(64), participantA: a, participantB: b, splitLayer: 12 } };
    const fixture = { hold: false, previews: [], phases: [] };
    const partitions = {
      getModels: () => [model], subscribe: () => () => {},
      async generate(request, controls) {
        const preview = { id: crypto.randomUUID(), threadId: request.threadId, attemptId: request.attemptId,
          peerId: a, recipientIdentity: a, operation: 'generate-partition', disclosure: 'partition-activations-and-tokens',
          ...model.partition, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], expiresAt: Date.now() + 30000,
          input: { messages: request.messages, recipients: [a, b] } };
        fixture.previews.push(preview);
        if (!await controls.requestApproval(preview)) throw Error('Disclosure declined');
        const execution = { placement: 'two-device-layer-partition', participantA: a, participantB: b, requesterId: 'requester', splitLayer: 12 };
        controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing', execution });
        const content = fixture.hold ? 'Checking the request…' : 'Hello. Your message reached the selected contributors.';
        controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: 0, text: content });
        if (fixture.hold) await new Promise(resolve => controls.signal.addEventListener('abort', resolve, { once: true }));
        controls.signal.throwIfAborted();
        return { threadId: request.threadId, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity,
          adapterIdentities: [], content, execution };
      }
    };
    const session = createChatSession({ storage: null, models: [], partitions });
    session.subscribe(state => fixture.phases.push(state.activeThread?.attempts.at(-1)?.status));
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderConversationWorkspace();
    fixture.dispose = bindConversationWorkspace(root, session); fixture.session = session;
    window.chatFixture = fixture;
  });
}

async function checkComposer(page, button) {
  const field = await page.locator('[data-composer-field]').boundingBox();
  const action = await page.locator(button).boundingBox();
  const attach = await page.locator('.chat-file-label').boundingBox();
  expect(Math.abs(action.y + action.height / 2 - field.y - field.height / 2)).toBeLessThanOrEqual(1);
  for (const control of [action, attach]) {
    expect(control.x).toBeGreaterThanOrEqual(field.x);
    expect(control.x + control.width).toBeLessThanOrEqual(field.x + field.width);
    expect(control.y).toBeGreaterThanOrEqual(field.y);
    expect(control.y + control.height).toBeLessThanOrEqual(field.y + field.height);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  expect(action.x).toBeGreaterThan(attach.x + attach.width);
  await expect(page.locator('[data-composer-area]')).toBeInViewport();
}

for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
  test(`${theme} direct chat and floating composer at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    await installChat(page);
    const rail = await page.locator('[data-toggle-thread-rail]').boundingBox();
    const settings = await page.locator('[data-pool-settings] > summary').boundingBox();
    expect(rail.x).toBeGreaterThanOrEqual(16); expect(rail.y).toBeGreaterThanOrEqual(16);
    expect(width - settings.x - settings.width).toBeGreaterThanOrEqual(16);
    await checkComposer(page, '[data-composer-send]');
    await page.locator('[data-composer-input]').fill('hi');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.is-assistant .chat-message-content')).toContainText('Hello.');
    expect(await page.evaluate(() => chatFixture.phases.includes('approval'))).toBe(false);
    const state = await page.evaluate(() => chatFixture.session.getState());
    expect(state.activeThread.attempts[0].authorization).toMatchObject({ kind: 'once', source: 'send' });
    expect(state.activeThread.grants).toEqual([]);
    await expect(page.locator('[data-chat-approval]')).toHaveCount(0);
    const user = await page.locator('.chat-message-row.is-user').boundingBox();
    const assistant = await page.locator('.chat-message-row.is-assistant').boundingBox();
    expect(user.height).toBeLessThanOrEqual(100); expect(user.width).toBeLessThan(assistant.width);
    await page.screenshot({ path: info.outputPath('conversation.png'), fullPage: true });
    await page.evaluate(() => { chatFixture.hold = true; });
    await page.locator('[data-composer-input]').fill('Continue'); await page.locator('[data-composer-input]').press('Enter');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await checkComposer(page, '[data-composer-stop]');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('.is-assistant').last()).toContainText('Stopped.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('both sevens move symmetrically on hover and remain expanded, with reduced motion support', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  const left = page.locator('[data-toggle-thread-rail]');
  const transform = locator => locator.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m42);
  await left.hover();
  await expect.poll(() => transform(left.locator('.pool-seven-main'))).toBe(6);
  expect(await transform(left.locator('.pool-seven-small'))).toBe(-6);
  await left.click(); await page.mouse.move(600, 300);
  expect(await transform(left.locator('.pool-seven-main'))).toBe(6);
  expect(await transform(left.locator('.pool-seven-small'))).toBe(-6);
  await left.click(); await page.mouse.move(600, 300);
  await expect.poll(() => transform(left.locator('.pool-seven-main'))).toBe(2);
  const right = page.locator('[data-pool-settings] > summary');
  await right.click(); await page.mouse.move(600, 300);
  await expect.poll(() => transform(right.locator('.pool-seven-main'))).toBe(6);
  expect(await transform(right.locator('.pool-seven-small'))).toBe(-6);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await right.locator('.pool-seven-main').evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
});

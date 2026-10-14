/* global chatFixture */
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
    const settings = await page.locator('[data-toggle-inspector]').boundingBox();
    expect(rail.x).toBeGreaterThanOrEqual(16); expect(rail.y).toBeGreaterThanOrEqual(16);
    expect(width - settings.x - settings.width).toBeGreaterThanOrEqual(16);
    await checkComposer(page, '[data-composer-send]');
    await page.locator('[data-composer-input]').fill('hi');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    // The first remote request explains the contributor permission once; nothing is created or sent until Allow.
    const permission = page.locator('[data-remote-permission]');
    await expect(permission).toBeVisible(); await expect(permission).toBeInViewport();
    await expect(permission.locator('[data-remote-permission-title]')).toHaveText("Answer with contributors' computers?");
    await expect(permission.locator('[data-remote-permission-who]')).toHaveText('The first computer receives the text. The second receives the same content as model tokens, which read back as text, plus intermediate results.');
    for (const name of ['Allow', 'Keep answers local']) await expect(permission.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => chatFixture.previews.length)).toBe(0);
    await page.screenshot({ path: info.outputPath('permission.png'), fullPage: true });
    await permission.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.locator('.is-assistant .chat-message-content')).toContainText('Hello.');
    const state = await page.evaluate(() => chatFixture.session.getState());
    expect(state.activeThread.attempts[0].authorization).toMatchObject({ kind: 'permission', source: 'permission',
      permissionId: state.remotePermissions[0].id, recipients: ['peer:' + 'a'.repeat(24), 'peer:' + 'b'.repeat(24)] });
    expect(state.activeThread.grants).toEqual([]);
    expect(await page.evaluate(() => chatFixture.phases.includes('approval'))).toBe(false);
    await expect(permission).toBeHidden();
    const user = await page.locator('.chat-message-row.is-user').boundingBox();
    const assistant = await page.locator('.chat-message-row.is-assistant').boundingBox();
    expect(user.height).toBeLessThanOrEqual(100); expect(user.width).toBeLessThan(assistant.width);
    await page.screenshot({ path: info.outputPath('conversation.png'), fullPage: true });
    await page.evaluate(() => { chatFixture.hold = true; });
    await page.locator('[data-composer-input]').fill('Continue'); await page.locator('[data-composer-input]').press('Enter');
    // Follow-ups are sent under the stored permission with no dialog.
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(permission).toBeHidden();
    await checkComposer(page, '[data-composer-stop]');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.locator('.is-assistant').last()).toContainText('Stopped.');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

for (const width of [1440, 320]) for (const theme of ['light', 'dark']) {
  test(`${theme} rail settings, keyboard access and navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    const left = page.locator('[data-toggle-thread-rail]');
    const right = page.locator('[data-toggle-inspector]');
    const sidebar = page.locator('[data-thread-sidebar]');
    const rail = page.locator('[data-network-rail]');
    const collapsedWidth = (await sidebar.boundingBox()).width;
    await left.click();
    await expect(left).toHaveAttribute('aria-expanded', 'true');
    expect((await sidebar.boundingBox()).width).toBeGreaterThan(collapsedWidth);
    await expect(page.locator('[data-new-thread]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(left).toHaveAttribute('aria-expanded', 'false');
    await right.click();
    await expect(right).toHaveAttribute('aria-expanded', 'true');
    await expect(rail.locator('[data-mesh-connect]')).toBeVisible();
    const settings = rail.locator('[data-pool-settings] > summary');
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true });
    for (const panel of [sidebar, rail]) {
      const box = await panel.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(16);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
      expect(box.y + box.height).toBeLessThanOrEqual(844 - 16);
    }
    await page.locator('[data-inspector-pane="settings"] a[href="/examples"]').click();
    await expect(page.locator('.pool-home')).toHaveAttribute('data-pool-route-id', 'examples');
    await expect(page.locator('.pool-primary-nav .pool-primary-actions')).toBeVisible();
    await expect(page.locator('[data-toggle-inspector]')).toBeHidden();
    await page.locator('.pool-primary-brand').click();
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await page.keyboard.press('Tab'); await left.focus();
    expect(await left.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    expect(await left.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await left.click();
    expect(await left.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
    await page.keyboard.press('Escape'); await right.click();
    expect(await page.locator('[data-contextual-inspector]').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

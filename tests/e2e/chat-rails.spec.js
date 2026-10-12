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

for (const width of [1440, 320]) for (const theme of ['light', 'dark']) {
  test(`${theme} stationary rail controls and raised panels at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await page.evaluate(theme => { document.querySelector('.pool-home').dataset.poolTheme = theme; }, theme);
    const left = page.locator('[data-toggle-thread-rail]');
    const right = page.locator('[data-pool-settings] > summary');
    const shadow = node => node.evaluate(element => getComputedStyle(element).boxShadow);
    const material = (node, kind) => node.evaluate((element, kind) => {
      const probe = document.createElement('span');
      probe.style.boxShadow = `var(--pool-surface-shadow-${kind})`;
      element.append(probe); const value = getComputedStyle(probe).boxShadow; probe.remove(); return value;
    }, kind);
    const glyphs = node => node.locator('.pool-seven-main, .pool-seven-small').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return [rect.x, rect.y, getComputedStyle(element).transform];
    }));
    const initial = [await glyphs(left), await glyphs(right)];
    await page.mouse.move(width / 2, 400);
    for (const [index, control] of [left, right].entries()) {
      await expect.poll(() => shadow(control)).toBe('none');
      await control.hover();
      await expect.poll(() => shadow(control)).toBe(await material(control, 'raised'));
      expect(await glyphs(control)).toEqual(initial[index]);
      await page.screenshot({ path: info.outputPath(`hover-${index}.png`), fullPage: true });
      await page.mouse.down();
      await expect.poll(() => shadow(control)).toBe(await material(control, 'inset'));
      await page.mouse.up();
      await expect(control).toHaveAttribute('aria-expanded', 'true');
      await page.mouse.move(width / 2, 400);
      expect(await shadow(control)).toBe(await material(control, 'inset'));
      expect(await glyphs(control)).toEqual(initial[index]);
    }
    const sidebar = page.locator('[data-chat-workspace] > [data-thread-sidebar]');
    const inspector = page.locator('.network-inspector[open]');
    for (const panel of [sidebar, inspector]) {
      await expect(panel).toBeVisible();
      await panel.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
      expect(await shadow(panel)).toBe(await material(panel, 'raised'));
      const geometry = await panel.evaluate(node => ({ padding: parseFloat(getComputedStyle(node).paddingLeft), box: node.getBoundingClientRect().toJSON() }));
      expect(geometry.padding).toBeGreaterThanOrEqual(16);
      expect(geometry.box.x).toBeGreaterThanOrEqual(16);
      expect(geometry.box.x + geometry.box.width).toBeLessThanOrEqual(width - 16);
    }
    await page.screenshot({ path: info.outputPath('both-open.png'), fullPage: true });
    await left.click();
    await expect(left).toHaveAttribute('aria-expanded', 'false');
    await expect(right).toHaveAttribute('aria-expanded', 'true');
    await right.click();
    await expect(right).toHaveAttribute('aria-expanded', 'false');
    await page.mouse.move(width / 2, 400);
    await page.keyboard.press('Tab'); await left.focus();
    expect(await left.evaluate(node => node.matches(':focus-visible'))).toBe(true);
    expect(await left.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    expect(await glyphs(left)).toEqual(initial[0]);
    await page.screenshot({ path: info.outputPath('keyboard-focus.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await left.click(); await right.click();
    expect(await left.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
    expect(await inspector.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    expect(await glyphs(left)).toEqual(initial[0]);
    expect(await glyphs(right)).toEqual(initial[1]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

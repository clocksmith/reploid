import { test, expect } from '@playwright/test';

// Explicit host-state fixtures exercise presentation, not model inference.
async function installConversation(page, theme) {
  await page.evaluate(async theme => {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const { bindExecutionRibbon } = await import('/ui/pool-home/execution-ribbon.js');
    const root = document.querySelector('.pool-home');
    const fixture = root.cloneNode(false);
    fixture.dataset.poolTheme = theme;
    fixture.innerHTML = root.querySelector('.pool-primary-nav').outerHTML
      + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>';
    document.body.replaceChildren(fixture);
    const model = { id: 'fixture-model', name: 'Presentation model', identity: 'sha256:' + 'a'.repeat(64), availability: 'ready' };
    let state;
    const listeners = new Set();
    const session = {
      getState: () => state,
      subscribe(callback) { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
      cancel() { window.setVisualState('cancelled'); }
    };
    window.setVisualState = mode => {
      const busy = ['queued', 'loading', 'executing', 'approval', 'cancelling'].includes(mode);
      const thread = { id: 'thread', purpose: 'Review the formatter', model,
        permissions: { sharingScope: 'mesh' }, grants: [],
        messages: [{ id: 'question', role: 'user', content: 'Check the formatter against malformed JSON.' },
          { id: 'response', role: 'assistant', content: mode === 'completed' ? 'Valid values are preserved. Two malformed inputs need a clearer error.' : 'Checking edge cases…' }],
        attempts: [{ id: 'attempt', status: mode, execution: { placement: 'two-device-layer-partition', participantA: 'fixture-A', participantB: 'fixture-B', requesterId: 'requester', splitLayer: 12 },
          approval: mode === 'approval' ? { id: 'approval', peerId: 'fixture-peer', modelId: model.id,
            input: 'Check these public JSON edge cases.', options: {}, limits: { maxOutputTokens: 1024 } } : null }] };
      state = { models: [{ ...model, availability: mode === 'empty' ? 'unavailable' : 'ready' }], defaultModel: model,
        threads: mode === 'empty' ? [] : [thread], selectedId: mode === 'empty' ? null : thread.id,
        activeThread: mode === 'empty' ? null : thread, runningIds: busy ? [thread.id] : [],
        network: { consumer: { peers: [] } } };
      listeners.forEach(callback => callback(state));
    };
    window.setVisualState('empty');
    window.disposeVisual = bindConversationWorkspace(fixture, session);
    const ribbon = bindExecutionRibbon(fixture); session.subscribe(state => ribbon.update(state));
  }, theme);
}

const animation = (locator, pseudo = '::after') => locator.evaluate((node, pseudo) => getComputedStyle(node, pseudo).animationName, pseudo);

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`${theme} conversation materials at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await installConversation(page, theme);
    const field = page.locator('[data-composer-field]');
    for (const state of ['empty', 'queued', 'loading', 'executing', 'approval', 'completed']) {
      await page.evaluate(state => window.setVisualState(state), state);
      await expect(field).toHaveAttribute('data-activity', state === 'executing' ? 'executing' : 'idle');
      expect(await animation(field)).toBe(state === 'executing' ? 'pool-optical-flow' : 'none');
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        nav: document.querySelector('.pool-primary-nav').getBoundingClientRect().toJSON(),
        content: document.querySelector('.pool-route-content').getBoundingClientRect().toJSON(),
        composer: document.querySelector('[data-composer-area]').getBoundingClientRect().toJSON(), height: innerHeight
      }));
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.height);
      expect(geometry.nav.left).toBe(geometry.content.left);
      expect(geometry.nav.width).toBe(geometry.content.width);
      if (state === 'approval') {
        await expect(page.locator('[data-chat-approval]')).toBeVisible();
        await expect(page.locator('[data-approval-send]')).toBeDisabled();
      }
      if (['empty', 'executing', 'approval'].includes(state)) {
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${state}.png`), fullPage: true });
      }
    }
    // Prove composable material actually wins the cascade, including the focus modifier.
    const textarea = page.locator('[data-composer-input]');
    await textarea.focus();
    const focused = await textarea.evaluate(node => {
      const css = getComputedStyle(node);
      return { background: css.backgroundImage, outline: css.outlineStyle, height: node.getBoundingClientRect().height };
    });
    expect(focused.background).toContain('linear-gradient');
    expect(focused.outline).toBe('solid');
    expect(focused.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('[data-active-model-select]').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
    const glassFill = await page.locator('[data-active-model-select]').evaluate(node => getComputedStyle(node).backgroundImage);
    const modelControl = page.locator('[data-active-model-select]');
    // Focus has a stronger edge; compare the two unfocused glass surfaces.
    await textarea.blur();
    expect(await textarea.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(glassFill);
    await page.locator('[data-current-model]').hover();
    expect(await textarea.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(glassFill);
    await page.locator('[data-toggle-inspector]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    for (const control of await page.locator('.pool-button:visible').all()) {
      expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('activity settles, stops on cancel and respects accessibility settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'light');
  const model = page.locator('[data-model-control]'), field = page.locator('[data-composer-field]');
  await page.evaluate(() => window.setVisualState('completed'));
  expect(await animation(model)).toBe('pool-optical-ready');
  await expect.poll(() => model.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('0');
  await page.evaluate(() => window.setVisualState('executing'));
  expect(await animation(field)).toBe('pool-optical-flow');
  await page.locator('[data-composer-stop]').click();
  expect(await animation(field)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.setVisualState('executing'));
  expect(await animation(field)).toBe('none');
  expect(await animation(model)).toBe('none');
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await field.evaluate(node => getComputedStyle(node, '::after').display)).toBe('none');
  await page.evaluate(() => window.disposeVisual());
  await expect(field).toHaveAttribute('data-activity', 'idle');
});


test('bounded inspector and reduced viewport preserve a long conversation and composer', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'dark');
  await page.evaluate(() => window.setVisualState('executing'));
  await page.evaluate(() => {
    const stream = document.querySelector('[data-message-stream]');
    for (let i = 0; i < 100; i++) { const p = document.createElement('p'); p.textContent = `Earlier message ${i}`; stream.append(p); }
    stream.scrollTop = 100;
  });
  const before = await page.locator('[data-composer-area]').boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-toggle-inspector]').click();
    await page.locator('[data-inspector-section=conversation]').click();
    await expect(page.locator('[data-inspector-route]')).toContainText('Peer A');
    await page.keyboard.press('Escape'); await expect(page.locator('[data-toggle-inspector]')).toBeFocused();
  }
  expect(await page.locator('[data-composer-area]').boundingBox()).toEqual(before);
  expect(await page.locator('[data-message-stream]').evaluate(node => node.scrollTop)).toBe(100);
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator('[data-composer-input]').focus();
  const composer = await page.locator('[data-composer-area]').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(460);
  expect((await page.locator('[data-message-stream]').boundingBox()).height).toBeGreaterThanOrEqual(60);
  await expect(page.locator('[data-composer-stop]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('reduced-viewport.png'), fullPage: true });
});

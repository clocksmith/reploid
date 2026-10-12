import { test, expect } from '@playwright/test';
import { openParticipantControls } from '../fixtures/signaling-interruption.js';

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
    const drafts = new Map();
    const session = {
      getState: () => state,
      subscribe(callback) { listeners.add(callback); callback(state); return () => listeners.delete(callback); },
      cancel() { window.setVisualState('cancelled'); },
      getDraft: id => drafts.get(id),
      saveDraft: (id, draft) => drafts.set(id, draft),
      getDocumentSources: content => content === 'Document question' ? {
        question: 'What does the supplied document say?',
        documents: [{ name: 'Notes.md', passages: [{ id: 'D1:P1', text: 'Keep the original amount of 42 dollars.' }] }]
      } : null
    };
    window.setVisualMessages = (question, answer) => {
      state.activeThread.messages[0].content = question;
      state.activeThread.messages[1].content = answer;
      listeners.forEach(callback => callback(state));
    };
    window.setVisualState = mode => {
      const busy = ['queued', 'loading', 'executing', 'approval', 'cancelling'].includes(mode);
      const empty = ['empty', 'unavailable', 'preparing'].includes(mode);
      const thread = { id: 'thread', purpose: 'Review the formatter', model,
        permissions: { sharingScope: 'mesh' }, grants: [],
        messages: [{ id: 'question', role: 'user', content: 'Check the formatter against malformed JSON.' },
          { id: 'response', role: 'assistant', attemptId: 'attempt', content: mode === 'completed' ? 'Valid values are preserved. Two malformed inputs need a clearer error.' : 'Checking edge cases…' }],
        attempts: [{ id: 'attempt', status: mode, execution: { placement: 'two-device-layer-partition', participantA: 'fixture-A', participantB: 'fixture-B', requesterId: 'requester', splitLayer: 12 },
          approval: mode === 'approval' ? { id: 'approval', peerId: 'fixture-peer', modelId: model.id,
            input: 'Check these public JSON edge cases.', options: {}, limits: { maxOutputTokens: 1024 } } : null }] };
      state = { models: [{ ...model, availability: mode === 'preparing' ? 'preparing' : empty ? 'unavailable' : 'ready' }], defaultModel: model,
        threads: empty ? [] : [thread], selectedId: empty ? null : thread.id,
        activeThread: empty ? null : thread, runningIds: busy ? [thread.id] : [],
        network: { consumer: { peers: [] } } };
      listeners.forEach(callback => callback(state));
    };
    window.setVisualState('empty');
    window.disposeVisual = bindConversationWorkspace(fixture, session);
    const ribbon = bindExecutionRibbon(fixture); session.subscribe(state => ribbon.update(state));
  }, theme);
}

const animation = (locator, pseudo = '::after') => locator.evaluate((node, pseudo) => getComputedStyle(node, pseudo).animationName, pseudo);

test('compact workspace presents availability once and keeps attempt status visible', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 460 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'light');
  for (const [mode, label] of [['empty', 'No model ready'], ['queued', 'Queued'],
    ['executing', 'Executing'], ['cancelling', 'Stopping'], ['cancelled', 'Stopped']]) {
    await page.evaluate(mode => window.setVisualState(mode), mode);
    const status = page.locator('[data-ribbon-status]');
    await expect(status).toHaveText(label);
    if (mode === 'empty') {
      await expect(status).toBeHidden();
      await expect(page.locator('[data-model-status]')).toBeVisible();
      await expect(page.locator('[data-message-stream]')).toBeEmpty();
    } else {
      await expect(status).toBeVisible();
      await expect(status).toBeInViewport();
    }
    await expect(page.locator('[data-composer-input]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const trigger = await page.locator('[data-ribbon-trigger]').boundingBox();
    for (const participant of await page.locator('[data-ribbon-route] .execution-ribbon-participant').all()) {
      const node = await participant.boundingBox();
      expect(node.x).toBeGreaterThanOrEqual(trigger.x);
      expect(node.x + node.width).toBeLessThanOrEqual(trigger.x + trigger.width);
    }
    if (mode === 'empty') await expect(page.locator('.execution-ribbon-node')).toHaveCount(0);
    if (mode === 'cancelling') await page.screenshot({ path: info.outputPath('compact-stopping.png'), fullPage: true });
  }
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`${theme} conversation materials at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await installConversation(page, theme);
    const field = page.locator('[data-composer-field]');
    for (const state of ['empty', 'unavailable', 'preparing', 'queued', 'loading', 'executing', 'approval', 'interrupted', 'completed']) {
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
      const guidance = page.locator('[data-model-status]');
      if (width < 760 && await guidance.isVisible()) {
        const hint = await guidance.boundingBox();
        const toolbar = await page.locator('.chat-composer-toolbar').boundingBox();
        expect(hint.width).toBeGreaterThanOrEqual(geometry.composer.width - 1);
        expect(hint.y + hint.height).toBeLessThanOrEqual(toolbar.y);
      }
      expect(geometry.nav.left).toBe(geometry.content.left);
      expect(geometry.nav.width).toBe(geometry.content.width);
      if (state === 'executing') {
        const attach = await page.locator('.chat-file-label').boundingBox();
        const stop = await page.locator('[data-composer-stop]').boundingBox();
        expect(stop.y).toBe(attach.y);
        expect(stop.x).toBeGreaterThan(attach.x + attach.width);
      }
      if (state === 'approval') {
        await expect(page.locator('[data-chat-approval]')).toBeVisible();
        await expect(page.locator('[data-approval-send]')).toBeDisabled();
      }
      if (['empty', 'unavailable', 'preparing', 'executing', 'approval', 'interrupted', 'completed'].includes(state)) {
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
    await openParticipantControls(page);
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    await page.locator('[data-inspector-section="device"]').click();
    await openParticipantControls(page);
    await expect(page.locator('[data-mesh-connect]')).toBeVisible();
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

test('reading and phone controls retain long answers, code, sources and a saved draft', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  await page.evaluate(() => {
    window.setVisualState('completed');
    window.setVisualMessages('Document question', '## Reviewed answer\n\nThe amount remains 42 dollars. [D1:P1]\n\n'
      + '```js\nconst amount = 42;\n```\n\n' + Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: Preserve the supplied conditions and explain each change clearly.\n\n`).join(''));
  });
  const stream = page.locator('[data-message-stream]');
  await stream.evaluate(node => { node.scrollTop = 0; });
  await page.locator('[data-composer-input]').fill('Keep this draft while I read.');
  await expect(page.locator('[data-copy-code]')).toHaveText('Copy code');
  await page.locator('[data-source-reference]').click();
  await expect(page.locator('#source-question-D1-P1')).toBeFocused();
  await expect(page.locator('.chat-message-content details')).toHaveAttribute('open', '');
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I read.');
  expect((await stream.boundingBox()).width).toBeLessThanOrEqual(768);
  await page.screenshot({ path: info.outputPath('desktop-reading.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 460 });
  await expect(page.locator('[data-composer-input]')).toBeInViewport();
  await expect(page.locator('[data-thread-sidebar]')).not.toBeVisible();
  await page.locator('[data-open-threads]').click();
  await expect(page.locator('[data-thread-dialog]')).toBeVisible();
  await page.locator('[data-close-threads]').click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I read.');
  await page.locator('[data-conversation-actions] > summary').click();
  await expect(page.locator('[data-network-header] [data-conversation-actions]')).toBeVisible();
  await expect(page.locator('[data-show-archived]')).toBeVisible();
  await expect(page.locator('[data-conversation-download]')).toBeVisible();
  await expect(page.locator('[data-conversation-download]')).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-conversation-actions] > summary')).toBeFocused();
  await page.screenshot({ path: info.outputPath('phone-reading-keyboard.png'), fullPage: true });
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

test('keyboard-sized visual viewport compacts the workspace without resizing the layout viewport', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  await page.evaluate(() => window.setVisualState('executing'));
  await page.locator('[data-composer-input]').fill('Keep this draft');
  // Explicit viewport fixture: models keyboards that leave CSS height queries unchanged.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 460 });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  expect(await page.evaluate(() => innerHeight)).toBe(844);
  const composer = await page.locator('[data-composer-area]').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(460);
  expect((await page.locator('[data-message-stream]').boundingBox()).height).toBeGreaterThanOrEqual(60);
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft');
  await page.screenshot({ path: info.outputPath('visual-viewport-keyboard.png'), fullPage: true });
  await page.evaluate(() => {
    delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize'));
  });
  expect((await page.locator('[data-composer-area]').boundingBox()).y).toBeGreaterThan(460);
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft');
});

test('Verification Worker accepts the conversation presentation module', async ({ page }, info) => {
  await page.goto('/');
  const verification = await page.evaluate(async () => {
    const file = '/self/ui/pool-home/conversation-workspace.js';
    const response = await fetch('/ui/pool-home/conversation-workspace.js');
    if (!response.ok) throw new Error(`Missing presentation module: ${response.status}`);
    const code = await response.text();
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot: { [file]: code } });
    });
  });
  expect(verification.passed, JSON.stringify(verification)).toBe(true);
  await info.attach('presentation-verification', { body: JSON.stringify(verification, null, 2), contentType: 'application/json' });
});

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
    const { renderNav } = await import('/ui/pool-home/shell-view.js');
    fixture.innerHTML = renderNav('home')
      + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>';
    document.body.replaceChildren(fixture);
    const model = { id: 'fixture-model', name: 'Presentation model', identity: 'sha256:' + 'a'.repeat(64), availability: 'ready', contextLength: 4096 };
    let state;
    const listeners = new Set();
    const drafts = new Map();
    const session = {
      getState: () => state,
      select(id) { state.selectedId = id; state.activeThread = state.threads.find(thread => thread.id === id) || null; listeners.forEach(callback => callback(state)); },
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
    window.setVisualTiming = timing => {
      state.activeThread.attempts[0].execution.timing = timing;
      listeners.forEach(callback => callback(state));
    };
    window.setVisualMetrics = metrics => {
      state.activeThread.attempts[0].execution.stepSummary = { metrics };
      listeners.forEach(callback => callback(state));
    };
    window.setVisualThreads = (count = 6) => {
      const template = state.activeThread;
      const purposes = ['Compare weekend plans', 'Review the formatter', 'Notes for the next meeting', 'Summarize the reading', 'Check the itinerary', 'Follow up on the proposal'];
      state.threads = Array.from({ length: count }, (_, index) => ({
        ...structuredClone(template), id: 'recent-' + index, purpose: purposes[index % purposes.length], createdAt: 10 - index,
        messages: template.messages.map(message => ({ ...message, ...(message.attemptId ? { attemptId: 'attempt-' + index } : {}) })),
        attempts: template.attempts.map(attempt => ({ ...attempt, id: 'attempt-' + index, status: index === 0 ? attempt.status : 'completed' }))
      }));
      state.selectedId = state.threads[0].id; state.activeThread = state.threads[0];
      state.runningIds = state.activeThread.attempts[0].status === 'executing' ? [state.selectedId] : [];
      listeners.forEach(callback => callback(state));
    };
    window.setVisualState = mode => {
      const busy = ['queued', 'loading', 'executing', 'approval', 'cancelling'].includes(mode);
      const empty = ['empty', 'unavailable', 'preparing'].includes(mode);
      const thread = { id: 'thread', purpose: 'Review the formatter', model,
        permissions: { sharingScope: 'mesh' }, grants: [],
        messages: [{ id: 'question', role: 'user', content: 'Check the formatter against malformed JSON.' },
          { id: 'response', role: 'assistant', attemptId: 'attempt', content: mode === 'completed' ? 'Valid values are preserved. Two malformed inputs need a clearer error.' : 'Checking edge cases…' }],
        attempts: [{ id: 'attempt', status: mode, execution: { placement: 'two-device-layer-partition', participantA: 'fixture-A', participantB: 'fixture-B', requesterId: 'requester', splitLayer: 12, ...(mode === 'completed' ? { completion: { promptTokenCount: 768, generatedTokenCount: 256 } } : {}) },
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
    const ribbon = bindExecutionRibbon(fixture, { labelSession: session }); session.subscribe(state => ribbon.update(state));
  }, theme);
}

const animation = (locator, pseudo = '::after') => locator.evaluate((node, pseudo) => getComputedStyle(node, pseudo).animationName, pseudo);

test('compact chat keeps attempt status reachable and composer visible', async ({ page, baseURL }, info) => {
  const origin = new URL(baseURL).origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url()); url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    if (url.origin === origin) socket.connectToServer(); else socket.close();
  });
  await page.setViewportSize({ width: 320, height: 460 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'light');
  for (const [mode, label] of [['empty', 'No model ready'], ['queued', 'Queued'],
    ['executing', 'Executing'], ['cancelling', 'Stopping'], ['cancelled', 'Stopped']]) {
    await page.evaluate(mode => window.setVisualState(mode), mode);
    const status = page.locator('[data-execution-activity]:not([hidden]) [data-execution-trigger]');
    if (mode !== 'empty') {
      await expect(status).toContainText(mode === 'executing' ? 'Generating' : label);
      await expect(status).toBeVisible();
      await status.scrollIntoViewIfNeeded();
      await expect(status).toBeInViewport();
    }
    if (mode === 'empty') {
      await expect(page.locator('[data-model-status]')).toBeVisible();
      await expect(page.locator('[data-model-status]')).toHaveText('Model unavailable.');
      await expect(page.locator('[data-message-stream]')).toBeEmpty();
      await expect(page.locator('[data-composer-input]')).toHaveAttribute('placeholder', 'Ask a question…');
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
    for (const state of ['empty', 'unavailable', 'preparing', 'queued', 'loading', 'executing', 'interrupted', 'completed']) {
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
        expect(hint.width).toBeGreaterThan(0);
        expect(hint.x).toBeGreaterThanOrEqual(geometry.composer.x);
        expect(hint.x + hint.width).toBeLessThanOrEqual(geometry.composer.right);
      }
      expect(geometry.nav.left).toBe(geometry.content.left);
      expect(geometry.nav.width).toBe(geometry.content.width);
      if (state === 'executing') {
        const attach = await page.locator('.chat-file-label').boundingBox();
        const stop = await page.locator('[data-composer-stop]').boundingBox();
        expect(stop.y).toBe(attach.y);
        expect(stop.x).toBeGreaterThan(attach.x + attach.width);
      }
      if (['empty', 'unavailable', 'preparing', 'executing', 'interrupted', 'completed'].includes(state)) {
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}-${state}.png`), fullPage: true });
      }
    }
    // Prove composable material actually wins the cascade, including the focus modifier.
    const textarea = page.locator('[data-composer-input]');
    await textarea.focus();
    const focused = await field.evaluate(node => {
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
    expect(await field.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(glassFill);
    await page.locator('[data-open-model]').click();
    await page.locator('[data-current-model]').hover();
    await page.locator('[data-toggle-thread-rail]').click();
    expect(await field.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(glassFill);
    await openParticipantControls(page);
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    await page.locator('[data-inspector-section="participants"]').click();
    await expect(page.locator('[data-inspector-pane="participants"]')).toBeVisible();
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
  await page.locator('[data-chat-transcript]').evaluate(node => { node.scrollTop = 0; });
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
  await expect(page.locator('[data-thread-sidebar]')).toBeVisible();
  await expect(page.locator('[data-thread-list]')).toBeHidden();
  await page.locator('[data-toggle-thread-rail]').click();
  await expect(page.locator('[data-thread-sidebar]')).toBeVisible();
  await page.locator('[data-toggle-thread-rail]').click();
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
    document.querySelector('[data-chat-transcript]').scrollTop = 100;
  });
  const before = await page.locator('[data-composer-area]').boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.locator('[data-toggle-inspector]').click();
    await page.locator('[data-inspector-section=conversation]').click();
    await expect(page.locator('[data-inspector-route]')).toContainText('Computer 1');
    await page.keyboard.press('Escape'); await expect(page.locator('[data-inspector-section=conversation]')).toBeFocused();
  }
  expect(await page.locator('[data-composer-area]').boundingBox()).toEqual(before);
  expect(await page.locator('[data-chat-transcript]').evaluate(node => node.scrollTop)).toBe(100);
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator('[data-composer-input]').focus();
  const composer = await page.locator('[data-composer-area]').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(460);
  expect((await page.locator('[data-chat-transcript]').boundingBox()).height).toBeGreaterThanOrEqual(60);
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
  expect((await page.locator('[data-chat-transcript]').boundingBox()).height).toBeGreaterThanOrEqual(60);
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


test('answer activity shows observed shares and preserves its disclosure during updates', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'dark');
  await page.evaluate(() => window.setVisualState('executing'));
  const activity = page.locator('[data-execution-activity]:not([hidden])');
  await expect(activity.locator('[data-activity-detail]')).not.toBeVisible();
  const trigger = activity.locator('[data-execution-trigger]');
  expect(await trigger.evaluate(node => getComputedStyle(node).boxShadow)).toBe('none');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(activity.locator('.chat-distribution')).toHaveCount(0);
  await page.evaluate(() => window.setVisualMetrics({ localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } }));
  await expect(activity.locator('[data-activity-detail]')).toBeVisible();
  await expect(activity.getByRole('img')).toHaveAttribute('aria-label', 'Recorded step time share: Computer 1 25%, Computer 2 75%');
  await expect(activity).toContainText('25% · 4.0 steps/s');
  await expect(activity).toContainText('75% · 1.3 steps/s');
  const panel = await activity.locator('[data-activity-detail]').boundingBox();
  expect(panel.width).toBeLessThanOrEqual(320);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('activity.png'), fullPage: true });
  await trigger.press('Space');
  await expect(activity.locator('[data-activity-detail]')).not.toBeVisible();
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`recent thread rail and live digests ${theme} ${width}`, async ({ page, baseURL }, info) => {
    const origin = new URL(baseURL).origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await installConversation(page, theme);
    const threads = page.locator('[data-thread-item-id]:visible');
    for (const mode of ['empty', 'executing', 'interrupted', 'completed']) {
      await page.evaluate(mode => { window.setVisualState(mode); if (mode !== 'empty') window.setVisualThreads(); }, mode);
      await expect(threads).toHaveCount(mode === 'empty' ? 0 : 6);
      const rail = await page.locator('[data-thread-sidebar]').boundingBox();
      const settings = await page.locator('[data-inspector-section="settings"]').boundingBox();
      expect(rail.y + rail.height - settings.y - settings.height).toBeLessThanOrEqual(12);
      await page.screenshot({ path: info.outputPath(`rail-${mode}-collapsed.png`) });
      await page.locator('[data-toggle-thread-rail]').click();
      await expect(threads).toHaveCount(mode === 'empty' ? 0 : 6);
      await expect(page.locator('[data-rail-digest="conversation"]')).toBeVisible();
      await expect(page.locator('[data-context-percent]')).toHaveText(mode === 'completed' ? '25%' : '—');
      await expect(page.locator('[data-composer-area] [data-execution-location]')).toHaveCount(0);
      await expect(page.locator('[data-rail-digest="conversation"]')).toHaveText({ empty: 'No model ready', executing: 'Executing', interrupted: 'Interrupted', completed: 'Complete' }[mode]);
      await expect(page.locator('[data-contextual-inspector]')).not.toBeVisible();
      const expanded = await page.locator('[data-thread-sidebar]').boundingBox();
      const create = await page.locator('[data-new-thread]').boundingBox();
      expect(create.x + create.width).toBeLessThanOrEqual(expanded.x + expanded.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (mode === 'executing') {
        await expect(page.locator('[data-thread-item-id="recent-0"]')).toHaveAttribute('data-activity', 'executing');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await animation(page.locator('[data-thread-item-id="recent-0"]'))).toBe('none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      await page.screenshot({ path: info.outputPath(`rail-${mode}-expanded.png`) });
      await page.locator('[data-toggle-thread-rail]').click();
    }
    await page.evaluate(() => { window.setVisualState('executing'); window.setVisualThreads(); });
    await threads.nth(1).click();
    await expect(page.locator('[data-thread-item-id="recent-1"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-thread-item-id="recent-0"]')).toHaveAttribute('data-activity', 'executing');
    await page.locator('[data-composer-input]').fill('Keep this draft');
    const compactRail = await page.locator('[data-thread-sidebar]').boundingBox();
    for (const section of ['model', 'conversation', 'participants', 'device', 'settings']) {
      const destination = page.locator(`[data-inspector-section="${section}"]`);
      await destination.click();
      await expect(page.locator(`[data-inspector-pane="${section}"]`)).toBeVisible();
      await expect(destination).toHaveAttribute('aria-current', 'true');
      await expect(page.locator('#network-inspector-title')).toBeFocused();
      await expect(page.locator('[data-conversation-area]')).toBeHidden();
      expect(await page.locator('[data-thread-sidebar]').boundingBox()).toEqual(compactRail);
      const content = await page.locator('[data-chat-inspector-slot]').boundingBox();
      expect(content.x).toBeGreaterThanOrEqual(compactRail.x + compactRail.width);
      expect(content.x + content.width).toBeLessThanOrEqual(width);
      await expect(page.locator('[data-thread-item-id="recent-0"]')).toHaveAttribute('data-activity', 'executing');
      await destination.click();
      await expect(page.locator(`[data-inspector-pane="${section}"]`)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`destination-${section}.png`) });
    }
    await threads.nth(1).click();
    await expect(page.locator('[data-conversation-area]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft');
    await expect(page.locator('[data-contextual-inspector]')).not.toBeVisible();
    await expect(page.locator('[data-thread-item-id="recent-1"]')).toHaveAttribute('aria-current', 'true');
    // A long history uses the gap without moving the fixed destination controls.
    await page.evaluate(() => window.setVisualThreads(30));
    const settingsBefore = await page.locator('[data-inspector-section="settings"]').boundingBox();
    const list = page.locator('[data-thread-list]');
    expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    expect(await list.evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe('none');
    await list.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await page.locator('[data-thread-item-id="recent-29"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-thread-item-id="recent-29"]')).toBeInViewport();
    expect(await page.locator('[data-inspector-section="settings"]').boundingBox()).toEqual(settingsBefore);
    const listBox = await list.boundingBox();
    const controls = await page.locator('.chat-rail-footer').boundingBox();
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(controls.y);
    await page.screenshot({ path: info.outputPath('rail-overflow.png') });
  });
}

test('answer measurements and bottom-centered thread badges stay stable while loading', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await installConversation(page, theme);
    await page.evaluate(() => window.setVisualState('loading'));
    const row = page.locator('.chat-message-row.is-assistant');
    const bounds = () => page.evaluate(() => {
      const box = selector => {
        const { x, width } = document.querySelector(selector).getBoundingClientRect(); return { x, width };
      };
      return { transcript: box('.chat-transcript'), composer: box('.chat-composer-area'), details: box('.is-assistant [data-execution-trigger]'), copy: box('.is-assistant [data-copy-message]') };
    });
    await page.evaluate(() => window.setVisualMessages('Question', ''));
    const initial = await bounds();
    await page.evaluate(() => window.setVisualState('completed'));
    await page.evaluate(() => window.setVisualMessages('Question', 'A longer answer. '.repeat(700)));
    await page.evaluate(() => window.setVisualTiming({ generatedTokenCount: 256, totalMs: 21700 }));
    expect(await bounds()).toEqual(initial);
    expect(await row.locator('.chat-message-meta').evaluate(node => getComputedStyle(node).display)).toBe('grid');
    const metric = row.locator('[data-metric="tokens"]');
    await expect(metric).toHaveText('256');
    expect(await metric.evaluate(node => getComputedStyle(node).cursor)).toBe('help');
    const details = row.locator('[data-execution-trigger]');
    expect(await details.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    await details.click();
    await expect(row.locator('[popover]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.locator('[popover]')).not.toBeVisible();
    await page.evaluate(() => window.setVisualThreads(4));
    const thread = page.locator('[data-thread-item-id="recent-1"]');
    await expect(thread.locator('[data-thread-monogram]')).toHaveText('R');
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('[data-toggle-thread-rail]').click();
      const badge = await thread.evaluate(node => {
        const icon = node.querySelector('.chat-thread-shortcut').getBoundingClientRect();
        const mark = node.querySelector('[data-thread-unread]').getBoundingClientRect();
        return { center: Math.abs(icon.x + icon.width / 2 - mark.x - mark.width / 2), below: mark.y >= icon.y + icon.height / 2 };
      });
      expect(badge.center).toBeLessThan(1); expect(badge.below).toBe(true);
    }
    await page.locator('[data-toggle-thread-rail]').click();
    await page.evaluate(() => window.setVisualMessages('What should we watch?', 'A short list based on your shared preferences.'));
    await page.screenshot({ path: info.outputPath(`cohesive-${width}-${theme}.png`) });
  }
});

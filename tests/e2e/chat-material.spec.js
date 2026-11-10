import { test, expect } from '@playwright/test';
import { openParticipantControls } from '../fixtures/signaling-interruption.js';
import { participantLabel } from '../../apps/poolday/ui/pool-home/computer-labels.js';

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
    window.setVisualAcquisition = acquisition => { state.acquisition = acquisition; listeners.forEach(callback => callback(state)); };
    window.setVisualSupply = count => {
      state.models = Array.from({ length: count }, (_, i) => ({ ...model, id: 'ready-' + i, name: 'Ready model ' + i, availability: 'ready', networkAvailability: 'ready' }));
      state.defaultModel = state.models[0] || model;
      listeners.forEach(callback => callback(state));
    };
    window.setVisualSources = ({ local = false, shared = true } = {}) => {
      const base = { ...model, name: 'Qwen 3.5 0.8B', localCached: local,
        availability: local ? 'cached' : shared ? 'ready' : 'unavailable', networkAvailability: shared ? 'ready' : 'unavailable' };
      state.models = [base]; state.defaultModel = base; state.peerDiscoveryTimedOut = true;
      state.network = { consumer: { connectionState: 'connected', peers: [] } };
      listeners.forEach(callback => callback(state));
    };
    window.setVisualTiming = timing => {
      state.activeThread.attempts[0].execution.timing = timing;
      listeners.forEach(callback => callback(state));
    };
    window.addLaterAnswer = () => {
      const earlier = state.activeThread.attempts[0];
      state.activeThread.attempts.push({ ...structuredClone(earlier), id: 'later', execution: { ...earlier.execution, completion: { promptTokenCount: 123, generatedTokenCount: 45 } } });
      state.activeThread.messages.push({ id: 'later-answer', role: 'assistant', attemptId: 'later', content: 'A later answer' });
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
    // Home renders no app bar; the execution ribbon exists only on routes that keep one.
    if (fixture.querySelector('[data-execution-ribbon]')) { const ribbon = bindExecutionRibbon(fixture, { labelSession: session }); session.subscribe(state => ribbon.update(state)); }
  }, theme);
}

const animation = (locator, pseudo = '::after') => locator.evaluate((node, pseudo) => getComputedStyle(node, pseudo).animationName, pseudo);

test('mobile bottom navigation preserves chat width and composer clearance', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'light');
  await page.evaluate(() => { window.setVisualState('completed'); window.setVisualThreads(20); });
  const rail = page.locator('[data-thread-sidebar]');
  const composer = page.locator('[data-composer-area]');
  for (const height of [844, 460]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(async () => { const bar = await rail.boundingBox(); return bar.y + bar.height; }).toBeLessThanOrEqual(height);
    await expect.poll(async () => (await composer.boundingBox()).y + (await composer.boundingBox()).height)
      .toBeLessThan((await rail.boundingBox()).y);
    const area = await page.locator('[data-conversation-area]').boundingBox();
    expect(area.width).toBeGreaterThan(350);
    const bar = await rail.boundingBox();
    expect(bar.y + bar.height).toBeLessThanOrEqual(height);
    expect(bar.height).toBeLessThan(80);
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-thread-panel]')).toBeVisible();
    expect((await rail.boundingBox()).y).toBeGreaterThanOrEqual(0);
    const threads = page.locator('[data-thread-list]');
    expect(await threads.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
    await page.locator('[data-thread-item-id]').nth(1).click();
    await expect(page.locator('[data-thread-panel]')).toBeHidden();
    await page.locator('[data-inspector-section="settings"]').click();
    await expect(page.locator('[data-chat-inspector-slot]')).toBeVisible();
    await page.locator('[data-close-inspector]').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('mobile-bottom-navigation.png') });
  // On a desktop the same controls form one slim top bar.
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await rail.boundingBox()).height).toBeLessThan(80);
  expect((await rail.boundingBox()).width).toBeGreaterThan(900);
});

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
      // One status line under the composer explains a disabled Send.
      await expect(page.locator('[data-model-status]')).toHaveText('Model unavailable.');
      await expect(page.locator('[data-message-stream]')).toBeEmpty();
      await expect(page.locator('[data-composer-input]')).toHaveAttribute('placeholder', 'Ask a question…');
    }
    await expect(page.locator('[data-composer-input]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    // Attempt status lives in the answer's footer on this route; there is no app bar ribbon to overflow.
    await expect(page.locator('[data-execution-ribbon]')).toHaveCount(0);
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
      await expect(field).toHaveAttribute('data-activity', 'idle');
      expect(await animation(field)).toBe('none');
      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        bar: document.querySelector('[data-chat-rail-toolbar]').getBoundingClientRect().toJSON(),
        content: document.querySelector('.pool-route-content').getBoundingClientRect().toJSON(),
        composer: document.querySelector('[data-composer-area]').getBoundingClientRect().toJSON(), height: innerHeight, width: innerWidth
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
      // One bar spans the workspace: it sits inside the page gutters and the composer column sits inside it.
      expect(geometry.bar.left).toBeGreaterThanOrEqual(8);
      expect(geometry.bar.right).toBeLessThanOrEqual(geometry.width - 8);
      expect(geometry.composer.x).toBeGreaterThanOrEqual(geometry.bar.left - 1);
      expect(geometry.composer.right).toBeLessThanOrEqual(geometry.bar.right + 1);
      if (state === 'executing') {
        await expect(page.locator('.is-assistant [data-answer-stop]')).toBeVisible();
        await expect(page.locator('[data-composer-stop]')).toBeHidden();
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
    await page.locator('[data-model-picker] .chat-model-choice').first().hover();
    await page.locator('[data-model-picker-close]').click();
    await page.locator('[data-toggle-thread-rail]').click();
    expect(await field.evaluate(node => getComputedStyle(node).backgroundImage)).toBe(glassFill);
    await page.locator('[data-close-threads]').click();
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
  // One animation belongs to the active answer; model choice and composer stay still.
  const model = page.locator('[data-open-model]'), field = page.locator('[data-composer-field]');
  await page.evaluate(() => window.setVisualState('completed'));
  expect(await animation(model)).toBe('none');
  await page.evaluate(() => window.setVisualState('executing'));
  const status = page.locator('.is-assistant [data-tool-status]');
  expect(await animation(status, '::before')).toBe('pool-dot-pulse');
  await page.locator('.is-assistant [data-answer-stop]').click();
  expect(await animation(field)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.setVisualState('executing'));
  expect(await animation(field)).toBe('none');
  expect(await animation(model)).toBe('none');
  expect(await animation(status, '::before')).toBe('none');
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
  // Threads and their conversation actions open as one dialog over the phone-sized viewport.
  await page.locator('[data-toggle-thread-rail]').click();
  await expect(page.locator('[data-threads-dialog]')).toBeVisible();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I read.');
  await page.locator('[data-conversation-actions] > summary').click();
  await expect(page.locator('[data-network-header] [data-conversation-actions]')).toBeVisible();
  await expect(page.locator('[data-show-archived]')).toBeVisible();
  await expect(page.locator('[data-conversation-download]')).toBeVisible();
  await expect(page.locator('[data-conversation-download]')).toBeInViewport();
  await page.locator('[data-close-threads]').click();
  await expect(page.locator('[data-toggle-thread-rail]')).toBeFocused();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I read.');
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
    // The conversation pane opens from the composer's context indicator; the rail keeps Computers and Settings.
    await page.locator('[data-context-indicator]').click();
    await expect(page.locator('[data-inspector-route]')).toContainText(participantLabel('fixture-A'));
    await page.keyboard.press('Escape'); await expect(page.locator('[data-context-indicator]')).toBeFocused();
  }
  expect(await page.locator('[data-composer-area]').boundingBox()).toEqual(before);
  expect(await page.locator('[data-chat-transcript]').evaluate(node => node.scrollTop)).toBe(100);
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator('[data-composer-input]').focus();
  const composer = await page.locator('[data-composer-area]').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(460);
  expect((await page.locator('[data-chat-transcript]').boundingBox()).height).toBeGreaterThanOrEqual(60);
  await expect.poll(() => page.locator('[data-composer-stop],.is-assistant [data-answer-stop]').evaluateAll(nodes => nodes.some(node => {
    const box = node.getBoundingClientRect(); return box.width > 0 && box.top >= 0 && box.bottom <= innerHeight;
  }))).toBe(true);
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
    const paths = ['pool-home/conversation-workspace.js', 'pool-home/index.js', 'pool-home/shell-view.js', 'pool-home/network-inspector.js', 'components/button-feedback.js', 'components/drawer.js', 'pool-home/workspace-navigation.js', 'pool-home/message-list.js', 'pool-home/execution-activity.js', 'pool-home/contribution-models.js', 'components/model-select.js'].map(path => '/ui/' + path).concat('/host/chat-session.js');
    const snapshot = Object.fromEntries(await Promise.all(paths.map(async path => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Missing presentation module: ${path} ${response.status}`);
      return [path, await response.text()];
    })));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
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
  const activity = page.locator('[data-inspected-activity]');
  await expect(activity).not.toBeVisible();
  const trigger = page.locator('[data-execution-trigger]:visible');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(activity.locator('.chat-distribution')).toHaveCount(0);
  await page.evaluate(() => window.setVisualMetrics({ localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } }));
  await expect(activity).toBeVisible();
  await expect(activity.getByRole('img')).toHaveAttribute('aria-label', `Recorded step time share: ${participantLabel('fixture-A')} 25%, ${participantLabel('fixture-B')} 75%`);
  await expect(activity).toContainText('25% · 4.0 steps/s');
  await expect(activity).toContainText('75% · 1.3 steps/s');
  await expect.poll(() => page.locator('[data-drawer-moving]').count()).toBe(0);
  const panel = await activity.boundingBox();
  expect(panel.width).toBeLessThanOrEqual(350);
  expect(panel.x + panel.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('activity.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(activity).not.toBeVisible();
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
      // Threads live in a drawer; before it opens they exist but are not visible.
      await expect(page.locator('[data-thread-item-id]')).toHaveCount(mode === 'empty' ? 0 : 6);
      const rail = await page.locator('[data-thread-sidebar]').boundingBox();
      const settings = await page.locator('[data-inspector-section="settings"]').boundingBox();
      expect(rail.y + rail.height - settings.y - settings.height).toBeLessThanOrEqual(12);
      await page.screenshot({ path: info.outputPath(`rail-${mode}-collapsed.png`) });
      await page.locator('[data-toggle-thread-rail]').click();
      await expect(threads).toHaveCount(mode === 'empty' ? 0 : 6);
      await expect(page.locator('[data-context-percent]')).toHaveText(mode === 'completed' ? '25%' : '—');
      await expect(page.locator('[data-composer-area] [data-execution-location]')).toHaveCount(0);
      await expect(page.locator('[data-contextual-inspector]')).not.toBeVisible();
      const expanded = await page.locator('[data-threads-dialog]').boundingBox();
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
      await page.locator('[data-close-threads]').click();
    }
    await page.evaluate(() => { window.setVisualState('executing'); window.setVisualThreads(); });
    await page.locator('[data-toggle-thread-rail]').click();
    await threads.nth(1).click();
    await expect(page.locator('[data-thread-item-id="recent-1"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-thread-item-id="recent-0"]')).toHaveAttribute('data-activity', 'executing');
    await page.locator('[data-composer-input]').fill('Keep this draft');
    const compactRail = await page.locator('[data-thread-sidebar]').boundingBox();
    for (const section of ['participants', 'settings']) {
      const destination = page.locator(`[data-inspector-section="${section}"]`);
      await destination.click();
      await expect(page.locator(`[data-inspector-pane="${section}"]`)).toBeVisible();
      await expect(destination).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#network-inspector-title')).toBeFocused();
      await expect(page.locator('[data-conversation-area]')).toBeVisible();
      expect(await page.locator('[data-thread-sidebar]').boundingBox()).toEqual(compactRail);
      await expect.poll(() => page.locator('[data-drawer-moving]').count()).toBe(0);
      const content = await page.locator('[data-chat-inspector-slot]').boundingBox();
      // The panel never overlaps the toolbar: below it on a desktop, above it on a phone.
      expect(content.y >= compactRail.y + compactRail.height - 1 || content.y + content.height <= compactRail.y + 1).toBe(true);
      expect(content.x + content.width).toBeLessThanOrEqual(width);
      await expect(page.locator('[data-thread-item-id="recent-0"]')).toHaveAttribute('data-activity', 'executing');
      await destination.click();
      await expect(page.locator(`[data-inspector-pane="${section}"]`)).toBeVisible();
      await page.screenshot({ path: info.outputPath(`destination-${section}.png`) });
    }
    await page.locator('[data-toggle-thread-rail]').click();
    await threads.nth(1).click();
    await expect(page.locator('[data-conversation-area]')).toBeVisible();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft');
    await expect(page.locator('[data-contextual-inspector]')).not.toBeVisible();
    await expect(page.locator('[data-thread-item-id="recent-1"]')).toHaveAttribute('aria-current', 'true');
    // A long history uses the gap without moving the fixed destination controls.
    await page.evaluate(() => window.setVisualThreads(30));
    const settingsBefore = await page.locator('[data-inspector-section="settings"]').boundingBox();
    await page.locator('[data-toggle-thread-rail]').click();
    const list = page.locator('[data-thread-list]');
    expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await list.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await page.locator('[data-thread-item-id="recent-29"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-thread-item-id="recent-29"]')).toBeInViewport();
    expect(await page.locator('[data-inspector-section="settings"]').boundingBox()).toEqual(settingsBefore);
    const listBox = await list.boundingBox();
    const dialogBox = await page.locator('[data-threads-dialog]').boundingBox();
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
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
        const node = document.querySelector(selector); if (!node) return null;
        const { x, width } = node.getBoundingClientRect(); return { x, width };
      };
      return { transcript: box('.chat-transcript'), composer: box('.chat-composer-area'), details: box('.is-assistant [data-execution-trigger]'), copy: box('.is-assistant [data-copy-message]') };
    });
    await page.evaluate(() => window.setVisualMessages('Question', ''));
    const initial = await bounds();
    await page.evaluate(() => window.setVisualState('completed'));
    await page.evaluate(() => window.setVisualMessages('Question', 'A longer answer. '.repeat(700)));
    await page.evaluate(() => window.setVisualTiming({ generatedTokenCount: 256, totalMs: 21700 }));
    // Columns and the details control keep their place as the answer and its measurements arrive.
    const settled = await bounds();
    for (const key of ['transcript', 'composer', 'details']) expect(settled[key]).toEqual(initial[key]);
    expect(settled.copy).not.toBeNull();
    expect(await row.locator('.chat-message-meta').evaluate(node => getComputedStyle(node).display)).toBe('flex');
    const metric = row.locator('[data-metric="tokens"]');
    await expect(metric).toHaveText('256 tokens');
    const details = row.locator('[data-execution-trigger]');
    expect(await details.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    await details.click();
    await expect(page.locator('[data-inspected-activity]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-inspected-activity]')).not.toBeVisible();
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
    await page.locator('[data-close-threads]').click();
    await page.evaluate(() => window.setVisualMessages('What should we watch?', 'A short list based on your shared preferences.'));
    await page.screenshot({ path: info.outputPath(`cohesive-${width}-${theme}.png`) });
  }
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`one composer chooser stays reachable at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await installConversation(page, 'light');
    await page.evaluate(() => window.setVisualSupply(3));
    await expect(page.locator('[data-production-shared]')).toHaveCount(0);
    await expect(page.locator('[data-open-model]')).toHaveCount(1);
    const composer = await page.locator('[data-composer-area]').boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(viewport.height);
    const area = await page.locator('[data-conversation-area]').boundingBox();
    expect(area.y + area.height - composer.y - composer.height).toBeLessThanOrEqual(24);
    expect(Math.abs(composer.x + composer.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
    for (const prompt of await page.locator('[data-starting-prompt]').all()) {
      await prompt.scrollIntoViewIfNeeded();
      expect(await prompt.evaluate(node => node.scrollHeight <= node.clientHeight)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('home-composer.png'), fullPage: true });
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`integrated composer and contextual inspection at ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await page.goto('/');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'dark');
    await page.evaluate(() => window.setVisualState('completed'));
    const input = page.locator('[data-composer-input]'); await input.fill('Keep my exact draft');
    await input.evaluate(node => node.setSelectionRange(5, 9));
    const field = await page.locator('[data-composer-field]').boundingBox();
    const text = await input.boundingBox();
    for (const selector of ['.chat-file-label', '[data-open-model]', '[data-context-indicator]', '[data-composer-send]']) {
      const rect = await page.locator(selector).boundingBox();
      expect(rect.y).toBeGreaterThanOrEqual(text.y + text.height);
      expect(rect.x).toBeGreaterThanOrEqual(field.x); expect(rect.x + rect.width).toBeLessThanOrEqual(field.x + field.width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('[data-context-indicator]').click();
    await expect(page.locator('[data-conversation-area]')).toBeVisible();
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    const chat = await page.locator('[data-conversation-area]').boundingBox(), pane = await page.locator('[data-chat-inspector-slot]').boundingBox();
    if (viewport.width >= 1100) expect(pane.x).toBeGreaterThanOrEqual(chat.x + chat.width);
    else { expect(pane.x).toBeGreaterThanOrEqual(0); expect(pane.y + pane.height).toBeLessThanOrEqual(viewport.height); }
    expect(await page.locator('[data-inspector-route]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('conversation-inspection.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-context-indicator]')).toBeFocused();
    await expect(input).toHaveValue('Keep my exact draft');
    expect(await input.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([5, 9]);
    await page.locator('[data-open-model]').click();
    await expect(page.locator('[data-model-picker-close]')).toBeInViewport();
    await expect(page.locator('[data-change-model]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('browser storage leases prevent removal across tabs until every owner releases', async ({ page, context }) => {
  await context.route('**/storage-proof.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Storage lock proof</title>' }));
  await page.goto('/storage-proof.html');
  const other = await context.newPage(); await other.goto('/storage-proof.html');
  for (const tab of [page, other]) await tab.evaluate(async () => {
    const { retainModelStorage } = await import('/infrastructure/model-storage-lock.js');
    window.releaseStorageProof = await retainModelStorage();
  });
  const attempt = () => page.evaluate(async () => {
    const { withUnusedModelStorage } = await import('/infrastructure/model-storage-lock.js');
    try { return await withUnusedModelStorage(() => 'unused'); } catch (error) { return error.message; }
  });
  expect(await attempt()).toContain('in use');
  await page.evaluate(() => window.releaseStorageProof()); expect(await attempt()).toContain('in use');
  await other.evaluate(() => window.releaseStorageProof()); expect(await attempt()).toBe('unused'); await other.close();
});

for (const width of [1280, 390, 320]) test(`two drawers preserve conversation and history at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, width === 390 ? 'dark' : 'light');
  await page.evaluate(() => { window.setVisualState('completed'); window.setVisualThreads(); });
  const input = page.locator('[data-composer-input]'), left = page.locator('[data-threads-dialog]'), right = page.locator('[data-chat-inspector-slot]');
  await input.fill('Preserve this draft'); await input.evaluate(node => { window.originalComposer = node; node.setSelectionRange(3, 7); });
  await page.locator('[data-toggle-thread-rail]').click(); await expect(left).toBeVisible();
  await expect(page.locator('[data-show-active]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-inspector-section="settings"]').click(); await expect(right).toBeVisible();
  if (width >= 1200) { await expect(left).toBeVisible(); await expect(page).toHaveURL(/view=settings&threads=open/); }
  else { await expect(left).toBeHidden(); await expect(page).toHaveURL(/view=settings$/); }
  await expect(page.locator('[data-conversation-area]')).toBeVisible();
  await page.locator('[data-inspector-tab="settings"]').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-inspector-pane="participants"]')).toBeVisible();
  await expect(page.locator('[data-inspector-tab="participants"]')).toBeFocused();
  await page.goBack(); await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
  await page.goForward(); await expect(page.locator('[data-inspector-pane="participants"]')).toBeVisible();
  await expect.poll(() => right.getAttribute('data-drawer-moving')).toBeNull();
  const l = await left.boundingBox(), r = await right.boundingBox(), c = await page.locator('[data-conversation-area]').boundingBox();
  expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(width);
  if (width >= 1200) { expect(c.x).toBeGreaterThanOrEqual(l.x + l.width); expect(c.x + c.width).toBeLessThanOrEqual(r.x); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`two-drawers-${width}.png`) });
  await page.locator('[data-close-inspector]').click();
  if (width >= 1200) await page.locator('[data-close-threads]').click();
  await expect(input).toHaveValue('Preserve this draft');
  expect(await input.evaluate(node => [node === window.originalComposer, node.selectionStart, node.selectionEnd])).toEqual([true, 3, 7]);
});

test('drawer sevens mirror, reverse without stale hiding, and respect reduced motion', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  const motion = await page.evaluate(() => {
    document.querySelector('[data-toggle-thread-rail]').click();
    document.querySelector('[data-inspector-section="settings"]').click();
    return [...document.querySelectorAll('[data-drawer-side]')].map(node => {
      const markRoot = node.dataset.drawerSide === 'left' ? document.querySelector('[data-thread-rail-brand]') : node.querySelector('[data-drawer-mark]');
      const slide = node.getAnimations()[0], marks = [...markRoot.querySelectorAll('.pool-seven-main, .pool-seven-small')];
      const keyframes = marks.map(mark => mark.getAnimations()[0].effect.getKeyframes()[1].transform);
      for (const animation of [...node.getAnimations({ subtree: true }), ...markRoot.getAnimations({ subtree: true })]) { animation.pause(); animation.currentTime = 168; }
      return { side: node.dataset.drawerSide, start: slide.effect.getKeyframes()[0].transform, keyframes };
    });
  });
  expect(motion.map(item => item.start)).toEqual(['translateX(-110%)', 'translateX(110%)']);
  expect(motion[0].keyframes).toEqual(['translate(12px, -8px) scale(0.85)', 'translate(-12px, 8px) scale(1.15)']);
  expect(motion[1].keyframes).toEqual(['translate(-12px, -8px) scale(0.85)', 'translate(12px, 8px) scale(1.15)']);
  await page.screenshot({ path: info.outputPath('mirrored-sevens-midpoint.png') });
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) {
      document.querySelector('[data-close-threads]').click(); document.querySelector('[data-toggle-thread-rail]').click();
      document.querySelector('[data-close-inspector]').click(); document.querySelector('[data-inspector-section="settings"]').click();
    }
  });
  await expect.poll(() => page.locator('[data-drawer-moving]').count()).toBe(0);
  await expect(page.locator('[data-threads-dialog]')).toBeVisible(); await expect(page.locator('[data-chat-inspector-slot]')).toBeVisible();
  expect(await page.locator('[data-drawer-mark]').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations({ subtree: true })).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.querySelector('[data-close-threads]').click(); document.querySelector('[data-toggle-thread-rail]').click();
    document.querySelector('[data-close-inspector]').click(); document.querySelector('[data-inspector-section="settings"]').click();
  });
  expect(await page.locator('[data-drawer-moving]').count()).toBe(0);
  expect(await page.locator('[data-drawer-side]').evaluateAll(nodes => nodes.flatMap(node => [...node.getAnimations(), ...[...node.querySelectorAll('[data-drawer-mark] span, [data-drawer-mark] sup')].flatMap(mark => mark.getAnimations())]).length)).toBe(0);
  await page.evaluate(() => window.disposeVisual());
  await expect(page.locator('[data-threads-dialog]')).toBeHidden(); await expect(page.locator('[data-chat-inspector-slot]')).toBeHidden();
});


test('answer inspection stays bound to the selected receipt as later answers arrive', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  await page.evaluate(() => { window.setVisualState('completed'); window.setVisualTiming({ generatedTokenCount: 256, totalMs: 21700, firstTokenMs: 250, prefillMs: 200 }); });
  await page.locator('[data-execution-trigger]:visible').click();
  const detail = page.locator('[data-inspector-context-detail]');
  await expect(detail).toContainText('Selected answer used 1,024 tokens');
  await page.evaluate(() => window.addLaterAnswer());
  await expect(detail).toContainText('Selected answer used 1,024 tokens');
  await expect(page.locator('[data-inspected-activity]')).toContainText('768');
  await expect(page.locator('[data-inspected-activity]')).toContainText('First token0.25 s');
  await page.locator('[data-close-inspector]').click();
  await page.locator('[data-execution-trigger]:visible').last().click();
  await expect(detail).toContainText('Selected answer used 168 tokens');
  await expect(page.locator('[data-inspected-activity]')).toContainText('123');
  await expect(page.locator('[popover]')).toHaveCount(0);
});

for (const width of [1280, 390, 320]) test(`composer stays anchored across discovery and loading at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  const input = page.locator('[data-composer-input]'), field = page.locator('[data-composer-field]');
  await input.fill('Keep this draft');
  const before = await field.boundingBox();
  for (const mode of ['preparing', 'unavailable', 'completed', 'loading', 'executing']) {
    await page.evaluate(mode => window.setVisualState(mode), mode);
    const box = await field.boundingBox();
    expect(box.height).toBe(before.height); expect(box.y + box.height).toBe(before.y + before.height);
  }
  await input.fill('A deliberately multiline draft\n'.repeat(6));
  expect((await field.boundingBox()).height).toBeGreaterThan(before.height);
  const expanded = await field.boundingBox();
  await page.evaluate(() => window.setVisualMetrics({}));
  expect(await field.boundingBox()).toEqual(expanded);
  await page.screenshot({ path: info.outputPath(`stable-composer-${width}.png`) });
});


for (const width of [1440, 390, 320]) test(`discovered models stay in the sole composer picker at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'dark');
  const field = page.locator('[data-composer-field]'), before = await field.boundingBox();
  for (const count of [1, 3, 8, 2]) {
    await page.evaluate(count => window.setVisualSupply(count), count);
    await expect(page.locator('[data-active-model-select]')).toHaveValue('ready-0');
    await expect(page.locator('[data-composer-send]')).toBeEnabled();
    await expect(page.locator('[data-production-shared]')).toHaveCount(0);
    await page.locator('[data-open-model]').click();
    await expect(page.locator('[data-next-model] + .chat-model-choices label[data-choice-key] > input[type=radio]')).toHaveCount(count);
    const last = page.locator('[data-next-model] + .chat-model-choices label[data-choice-key] > input[type=radio]').last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.locator('[data-next-model]')).toHaveValue(`ready-${count - 1}`);
    await page.locator('[data-model-picker-close]').click();
    expect(await field.boundingBox()).toEqual(before);
    if (count === 3) await page.screenshot({ path: info.outputPath(`complete-models-${width}.png`) });
  }
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-next-model]')).toHaveValue('ready-0');
});

for (const width of [1440, 390]) test(`one brand and one drawer new-thread action at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'dark');
  await page.evaluate(() => window.setVisualSupply(3));
  await expect(page.locator('[data-new-thread]')).toHaveCount(1);
  await expect(page.locator('[data-thread-sidebar] [data-new-thread]')).toHaveCount(0);
  await page.locator('[data-toggle-thread-rail]').click();
  await expect(page.locator('[data-threads-dialog]')).toHaveAccessibleName('Threads');
  await expect(page.locator('[data-threads-dialog] h2, [data-threads-dialog] .pool-seven-main')).toHaveCount(0);
  await expect(page.locator('[data-new-thread]')).toBeFocused();
  await expect(page.locator('[data-drawer-moving]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`single-drawer-header-${width}.png`) });
  await page.locator('[data-new-thread]').click();
  await expect(page.locator('[data-threads-dialog]')).toBeHidden();
  await expect(page.locator('[data-composer-input]')).toBeFocused();
});


test('unchanged provider updates preserve a reader near the transcript bottom', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  await page.evaluate(async () => {
    await document.fonts.ready; window.setVisualState('completed');
    window.setVisualMessages('Question', 'A paragraph of the answer.\n\n'.repeat(100));
  });
  const stream = page.locator('[data-chat-transcript]');
  const before = await stream.evaluate(node => { node.scrollTop = node.scrollHeight - node.clientHeight - 50; return node.scrollTop; });
  expect(before).toBeGreaterThan(0);
  for (let i = 0; i < 3; i++) await page.evaluate(() => window.setVisualMetrics({}));
  expect(await stream.evaluate(node => node.scrollTop)).toBe(before);
});


test('composer shrinks and rewraps after drawer changes without losing text', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  const input = page.locator('[data-composer-input]');
  const baseline = (await input.boundingBox()).height;
  await input.fill('Wrapped draft text with several words. '.repeat(6));
  const wide = (await input.boundingBox()).height;
  await page.locator('[data-toggle-thread-rail]').click(); await page.locator('[data-workspace-view=settings]').click();
  await expect.poll(async () => (await input.boundingBox()).height).toBeGreaterThan(wide);
  await page.locator('[data-close-inspector]').click(); await page.locator('[data-close-threads]').click();
  await expect.poll(async () => (await input.boundingBox()).height).toBe(wide);
  await input.fill('Short'); await expect.poll(async () => (await input.boundingBox()).height).toBe(baseline);
});

for (const height of [844, 460]) test(`download progress and attachment help preserve the composer bottom edge at ${height}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  const field = page.locator('[data-composer-field]'), before = await field.boundingBox();
  for (const phase of ['downloading', 'failed', 'cancelled']) {
    await page.evaluate(phase => window.setVisualAcquisition({ phase, modelId: 'fixture-model', error: 'Download interrupted', progress: { message: 'Receiving model files', receivedBytes: 50, totalBytes: 100 } }), phase);
    const box = await field.boundingBox(); expect(box.height).toBe(before.height); expect(box.y + box.height).toBe(before.y + before.height);
  }
  await page.locator('[data-composer-files]').focus();
  await expect(page.locator('[data-attachment-help]')).toBeVisible();
  const box = await field.boundingBox(); expect(box.height).toBe(before.height); expect(box.y + box.height).toBe(before.y + before.height);
});


test('typing and deleting preserve suggestion space without exposing draft-replacement actions', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'light');
  const prompts = page.locator('[data-starting-prompts]'), input = page.locator('[data-composer-input]');
  const bounds = () => prompts.evaluate(node => { const { y, height } = node.getBoundingClientRect(); return { y, height }; });
  const before = await bounds();
  await input.fill('a'); expect(await bounds()).toEqual(before);
  await expect(prompts).toHaveAttribute('inert', '');
  await expect(prompts).not.toBeVisible();
  await input.fill(''); expect(await bounds()).toEqual(before);
  await expect(prompts).toBeVisible();
});


for (const width of [1280, 390, 320]) test(`model source, selection and composer agree at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible(); await installConversation(page, 'dark');
  await page.evaluate(() => window.setVisualSources({ local: true }));
  const input = page.locator('[data-composer-input]'), source = page.locator('[data-composer-model-source]');
  const openModel = async () => { await page.locator('[data-open-model]').click();
    if (!await page.locator('[data-model-details]').evaluate(node => node.open)) await page.locator('[data-model-details] > summary').click(); };
  await input.fill('hi'); const field = await page.locator('[data-composer-field]').boundingBox();
  await expect(source).toHaveText(' · This device');
  await openModel();
  await page.locator('[data-execution-choice=network]').click();
  await page.locator('[data-change-model]').click();
  await expect(source).toHaveText(' · Public network');
  await expect(page.locator('[data-composer-send]')).toBeEnabled();
  await expect(page.locator('[data-model-status]')).toBeHidden();
  await expect(page.locator('[data-download-local]')).toBeHidden();
  await openModel();
  await page.locator('[data-execution-choice=local]').click();
  await expect(source).toHaveText(' · Public network');
  await page.locator('[data-model-picker-close]').click();
  await expect(source).toHaveText(' · Public network');
  await expect(input).toHaveValue('hi');
  const bounds = await source.boundingBox(), button = await page.locator('[data-open-model]').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(button.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(button.x + button.width);
  await page.screenshot({ path: info.outputPath(`shared-ready-${width}.png`) });
  await page.evaluate(() => window.setVisualSources({ local: true, shared: false }));
  await expect(page.locator('[data-composer-send]')).toBeDisabled();
  await expect(source).toHaveText(' · Unavailable');
  await expect(page.locator('[data-model-status]')).toHaveText('No shared computer can answer with this model right now.');
  await expect(page.locator('[data-download-local]')).toBeHidden();
  await expect(page.locator('[data-retry-connection]')).toBeHidden();
  expect(await page.locator('[data-composer-field]').boundingBox()).toEqual(field);
  await page.screenshot({ path: info.outputPath(`shared-departed-${width}.png`) });
  await openModel();
  await expect(page.locator('[data-execution-choice=network]')).toBeDisabled();
  await page.locator('[data-execution-choice=local]').click();
  await page.locator('[data-change-model]').click();
  await expect(source).toHaveText(' · This device');
  await expect(page.locator('[data-composer-send]')).toBeEnabled();
  await expect(input).toHaveValue('hi');
  await page.screenshot({ path: info.outputPath(`this-device-${width}.png`) });
});

for (const width of [1440, 390, 320]) test(`focused chat controls: help, picker and one answer status at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installConversation(page, 'light');
  await page.evaluate(() => { window.setVisualState('executing'); window.setVisualMessages('Check the formatter.', ''); });
  const status = page.locator('.is-assistant [data-tool-status]');
  await expect(status).toHaveText('Generating');
  await expect(page.locator('.is-assistant [data-answer-stop]')).toBeVisible();
  await expect(page.locator('[data-composer-stop]')).toBeHidden();
  expect(await status.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('pool-dot-pulse');
  await page.screenshot({ path: info.outputPath(`progress-${width}.png`), fullPage: true });
  await page.locator('.is-assistant [data-answer-stop]').click();
  await expect(page.locator('.is-assistant [data-answer-stop]')).toBeHidden();
  await expect(page.locator('.is-assistant [data-system-status]')).toContainText('Stopped');

  await page.locator('.chat-composer-status-line [data-open-control-help]').click();
  await expect(page.locator('[data-control-help]')).toBeVisible();
  await expect(page.locator('[data-control-help]')).toContainText('Tap an answer’s speed');
  await page.locator('[data-close-control-help]').click();
  await expect(page.locator('.chat-composer-status-line [data-open-control-help]')).toBeFocused();

  await page.evaluate(() => { window.setVisualState('empty'); window.setVisualSupply(24); });
  const opener = page.locator('[data-open-model]');
  await page.locator('[data-composer-input]').focus();
  await opener.hover();
  await expect(page.getByRole('tooltip')).toContainText('Choose model');
  await page.mouse.move(1, 1);
  await expect(page.getByRole('tooltip')).toBeHidden();
  await opener.focus();
  await expect(page.getByRole('tooltip')).toContainText('Choose model');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await opener.press('Enter');
  const picker = page.locator('[data-model-picker]');
  await expect(picker).toBeVisible();
  await expect(picker.locator('[data-model-details]')).not.toHaveAttribute('open');
  await expect(picker.locator('.chat-model-choice input:checked')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(picker.locator('.chat-model-choice input:checked')).toBeFocused();
  expect(await picker.locator('[data-choice-facts]:visible').count()).toBe(0);
  await expect(picker.locator('[data-change-model]')).toBeInViewport();
  await picker.locator('[data-model-details] > summary').click();
  await expect(picker.locator('[data-execution-location]')).toBeVisible();
  await expect(picker.locator('[data-change-model]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`picker-${width}.png`), fullPage: true });
  await picker.locator('[data-model-details] > summary').click();
  await picker.locator('[data-open-control-help]').click();
  await expect(page.locator('[data-control-help]')).toBeVisible();
  await page.locator('[data-close-control-help]').click();
  await picker.locator('[data-model-picker-close]').click();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.setVisualState('executing'));
  expect(await status.evaluate(node => getComputedStyle(node, '::before').animationName)).toBe('none');
});


test('touch help and model choices work without hover', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await installConversation(page, 'dark');
    await page.evaluate(() => { window.setVisualState('completed'); window.setVisualTiming({ generatedTokenCount: 92, totalMs: 5000 }); });
    await page.locator('.is-assistant [data-metric="tokens"]').tap();
    await expect(page.getByRole('tooltip')).toHaveText('92 generated tokens');
    await page.locator('.chat-composer-status-line [data-open-control-help]').tap();
    await expect(page.locator('[data-control-help]')).toBeVisible();
    await page.screenshot({ path: info.outputPath('touch-help.png'), fullPage: true });
    await page.locator('[data-close-control-help]').tap();
    await page.locator('[data-open-model]').tap();
    await expect(page.locator('[data-model-picker]')).toBeVisible();
    await expect(page.locator('[data-model-details]')).not.toHaveAttribute('open');
    await page.locator('[data-model-picker-close]').tap();
    await expect(page.locator('[data-open-model]')).toBeFocused();
  } finally { await context.close(); }
});

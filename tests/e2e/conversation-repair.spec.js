import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readServedText } from '../helpers/served-browser-files.js';

async function installFixture(page) {
  // State-only screenshots: no peer connection, model download or inference.
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { mountPoolday } = await import('/ui/react/app.js');
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const model = { id: 'fixture', name: 'Qwen 3.5 2B', identity: 'sha256:' + 'a'.repeat(64), availability: 'ready' };
    let state, listener;
    const session = {
      getState: () => state,
      subscribe(callback) { listener = callback; callback(state); return () => {}; },
      select(id) { state.selectedId = id; state.activeThread = state.threads.find(row => row.id === id); listener(state); },
      cancel(id) { window.cancelledThread = id; },
      approve(...args) { window.approvedAttempt = args; }
    };
    window.setConversationPhase = phase => {
      const busy = ['active', 'approval'].includes(phase);
      const attempt = { id: 'attempt-A', status: phase === 'approval' ? 'approval' : busy ? 'executing' : 'completed',
        execution: { peerId: 'peer-B' },
        approval: phase === 'approval' ? { id: 'preview-A', peerId: 'peer-B', input: 'Compare these two approaches.', expiresAt: Date.now() + 60000 } : null };
      const thread = { id: 'thread-A', model, purpose: 'Compare approaches', attempts: [attempt], messages: [
        { id: 'question-A', role: 'user', content: 'Compare these two approaches.' },
        { id: 'reply-A', attemptId: 'attempt-A', role: 'assistant', content: phase === 'completed' ? 'The first uses less memory. The second avoids repeated transfers.' : phase === 'active' ? 'Comparing memory use and transfer costs…' : '' }
      ] };
      state = { models: [model], defaultModel: model, selectedId: phase === 'empty' ? null : thread.id,
        activeThread: phase === 'empty' ? null : thread, threads: phase === 'empty' ? [] : [thread],
        runningIds: busy ? [thread.id] : [], network: { sharing: false, consumer: { peers: [{ peerId: 'peer-B', model: model.name }] } } };
      listener?.(state);
    };
    window.setConversationPhase('empty');
    mountPoolday(root, { host: { chat: session, close: async () => {} } });
  });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: aligned material and open composer`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('reploid.appearance.v1', theme), theme);
    await page.goto('/');
    await page.locator('[data-composer-input]').waitFor();
    await installFixture(page);
    for (const phase of ['empty', 'active', 'completed']) {
      await page.evaluate(phase => window.setConversationPhase(phase), phase);
      await expect(page.locator('[data-composer-input]')).toBeVisible();
      await expect(page.locator('[data-contextual-inspector]:visible')).toHaveCount(0);
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { root: rect('[data-chat-workspace]'), conversation: rect('[data-conversation-area]'),
          scroll: document.documentElement.scrollWidth, width: innerWidth,
          depth: getComputedStyle(document.querySelector('[data-conversation-area]')).boxShadow,
          barControls: [...document.querySelectorAll('[data-chat-rail-toolbar] a, [data-chat-rail-toolbar] button')]
            .map(node => node.getBoundingClientRect().toJSON()).filter(rect => rect.width && rect.height) };
      });
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      expect(geometry.root.left).toBeGreaterThanOrEqual(0);
      expect(geometry.root.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.conversation.left).toBeGreaterThanOrEqual(geometry.root.left);
      expect(geometry.conversation.right).toBeLessThanOrEqual(geometry.root.right);
      expect(geometry.depth).toBe('none');
      geometry.barControls.forEach((a, index) => geometry.barControls.slice(index + 1).forEach(b => {
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      }));
      if (width > 760) {
        expect(geometry.conversation.height).toBeGreaterThan(0);
      }
      if (phase === 'active') {
        await page.locator('[data-composer-stop]:visible, [data-answer-stop]:visible').first().click();
        expect(await page.evaluate(() => window.cancelledThread)).toBe('thread-A');
      }
      await page.screenshot({ path: info.outputPath(`${theme}-${width}-${phase}.png`), fullPage: true });
    }
    await page.locator('[data-chat-rail-toolbar] [data-inspector-section="participants"]').click();
    await expect(page.locator('[data-contextual-inspector]:visible')).toHaveCount(1);
    await page.locator('[data-close-inspector]:visible').click();
    await expect(page.locator('[data-contextual-inspector]:visible')).toHaveCount(0);
  });
}

test('320px layout contains native inputs and allows a first message without creating a thread first', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await page.locator('[data-composer-input]').waitFor();
  await installFixture(page);
  await expect(page.locator('[data-composer-send]')).toBeEnabled();
  const dimensions = await page.evaluate(() => {
    const attach = document.querySelector('[data-composer-attach]').getBoundingClientRect();
    const file = document.querySelector('[data-composer-files]').getBoundingClientRect();
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, attach: attach.toJSON(), file: file.toJSON() };
  });
  expect(dimensions.scroll).toBe(dimensions.width);
  expect(dimensions.file.width).toBeLessThanOrEqual(dimensions.attach.width);
  await expect(page.locator('[data-chat-workspace]')).not.toContainText('Distributed Intelligence');
  await expect(page.locator('[data-chat-workspace]')).not.toContainText('Mesh Active');
});

test('browser host preserves files and followups across reload with injected execution', async ({ page }) => {
  const install = async () => {
    await page.locator('[data-chat-workspace]').waitFor();
    await page.evaluate(async () => {
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const service = { async open({ options, source }) {
      options.onProgress?.({ stage: 'manifest', progress: 0.05, message: 'Parsing manifest...' });
      options.onProgress?.({ stage: 'weights', progress: 0.5, message: 'Loading weights...' });
      return { loaded: true, modelId: source, manifestHash: CANONICAL_CHAT_MODELS[0].identity.slice(7),
      resetGenerationState() {}, async *stream(messages) {
      yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'Injected answer: ' + messages.at(-1).content };
      yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: 'Injected answer: ' + messages.at(-1).content };
    } }; }, async close() {} };
    // Availability is explicit test input; this fixture does not prove discovery or inference.
    const swarm = { getState: () => ({ consumer: { peers: [{ peerId: 'fixture',
      model: CANONICAL_CHAT_MODELS[0].id, modelIdentity: CANONICAL_CHAT_MODELS[0].identity,
      readiness: 'ready', hasInference: true, availableSlots: 1 }] } }) };
    const session = createChatSession({ service, swarm, storage: localStorage });
    const root = document.createElement('div'); document.body.replaceChildren(root);
    // The model is stored here, so the answer runs on this device through the injected service.
    session.setCachedModels([CANONICAL_CHAT_MODELS[0]]);
    mountPoolday(root, { host: { chat: session, close: async () => {} } });
    });
  };
  await page.goto('/'); await install();
  await page.locator('[data-composer-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Attached evidence') });
  await expect(page.locator('[data-attachments-preview]')).toContainText('notes.txt');
  const question = 'Read the attachment.\nInclude exclusions.\n\nCheck the date.';
  await page.locator('[data-composer-input]').fill(question);
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-role="assistant"]')).toContainText('Attached evidence');
  await expect(page.locator('[data-message-role="user"]').first()).toContainText(question);
  await expect(page.locator('[data-message-role="user"]').first()).not.toContainText('Treat attached passages');
  await page.locator('[data-composer-input]').fill('Follow up');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(2);
  await page.reload(); await install();
  if (!await page.locator('[data-thread-item-id]').first().isVisible()) await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-thread-item-id]').click();
  await expect(page.locator('[data-message-role="assistant"]')).toHaveCount(2);
  await expect(page.locator('[data-message-role="user"]').first()).toContainText('Attached evidence');
  await expect(page.locator('[data-message-role="user"]').first()).toContainText(question);
});

test('Verification Worker accepts repaired application modules', async ({ page }) => {
  const paths = [
    ...['attachments', 'model-select'].map(name => `ui/components/${name}.js`),
    ...['execution-ribbon', 'message-list', 'network-controls']
      .map(name => `ui/pool-home/${name}.js`),
    ...['chat-session', 'document-comparison', 'product-context', 'product-session', 'work-model-files', 'work-swarm', 'decisions/conversation-controller'].map(name => `host/${name}.js`)
  ];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async path => ['/' + path, await readServedText(path)])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});

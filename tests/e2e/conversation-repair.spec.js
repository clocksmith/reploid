import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function installFixture(page) {
  // State-only screenshots: no peer connection, model download or inference.
  await page.evaluate(async () => {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const root = document.querySelector('.pool-route-content');
    root.innerHTML = renderConversationWorkspace();
    const model = { id: 'fixture', name: 'Qwen 3.5 2B', identity: 'sha256:' + 'a'.repeat(64) };
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
        { role: 'user', content: 'Compare these two approaches.' },
        { role: 'assistant', content: phase === 'completed' ? 'The first uses less memory. The second avoids repeated transfers.' : phase === 'active' ? 'Comparing memory use and transfer costs…' : '' }
      ] };
      state = { models: [model], defaultModel: model, selectedId: phase === 'empty' ? null : thread.id,
        activeThread: phase === 'empty' ? null : thread, threads: phase === 'empty' ? [] : [thread],
        runningIds: busy ? [thread.id] : [], network: { sharing: false, consumer: { peers: [{ peerId: 'peer-B', model: model.name }] } } };
      listener?.(state);
    };
    window.setConversationPhase('empty');
    bindConversationWorkspace(root, { ...session, createThread: options => session.createThread({ ...options, sharingScope: 'local' }) });
  });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: aligned material, contextual approvals and open composer`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.locator('[data-composer-input]').waitFor();
    await page.locator(`[data-pool-theme-choice="${theme}"]`).click();
    await installFixture(page);
    for (const phase of ['empty', 'active', 'approval', 'completed']) {
      await page.evaluate(phase => window.setConversationPhase(phase), phase);
      await expect(page.locator('[data-composer-input]')).toBeVisible();
      await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
      const geometry = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { nav: rect('.pool-primary-nav'), root: rect('[data-chat-workspace]'),
          sidebar: rect('[data-thread-sidebar]'), conversation: rect('[data-conversation-area]'),
          scroll: document.documentElement.scrollWidth, width: innerWidth,
          depth: getComputedStyle(document.querySelector('[data-conversation-area]')).boxShadow };
      });
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      expect(geometry.nav.left).toBe(geometry.root.left);
      expect(geometry.nav.width).toBe(geometry.root.width);
      expect(geometry.depth).not.toBe('none');
      if (width > 760) {
        expect(geometry.sidebar.top).toBe(geometry.conversation.top);
        expect(geometry.sidebar.bottom).toBe(geometry.conversation.bottom);
      }
      if (phase === 'approval') {
        await expect(page.locator('[data-chat-approval]')).toBeVisible();
        await expect(page.locator('[data-approval-send]')).toBeDisabled();
        await page.locator('[data-approval-consent]').check();
        await page.locator('[data-approval-send]').click();
        expect(await page.evaluate(() => window.approvedAttempt)).toEqual(['thread-A', 'attempt-A', 'preview-A', true, { remember: undefined }]);
      }
      if (phase === 'active') {
        await page.locator('[data-composer-stop]').click();
        expect(await page.evaluate(() => window.cancelledThread)).toBe('thread-A');
      }
      await page.screenshot({ path: info.outputPath(`${theme}-${width}-${phase}.png`), fullPage: true });
    }
    await page.locator('[data-toggle-inspector]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeVisible();
    await expect(page.locator('[data-contrib-label]')).toHaveText('Not sharing');
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
  });
}

test('320px layout contains native inputs and allows a first message without creating a thread first', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-composer-send]')).toBeEnabled();
  const dimensions = await page.evaluate(() => {
    const attach = document.querySelector('.chat-file-label').getBoundingClientRect();
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
    const { createChatSession } = await import('/host/chat-session.js');
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const service = { async open({ options, source }) {
      options.onProgress?.({ stage: 'manifest', progress: 0.05, message: 'Parsing manifest...' });
      options.onProgress?.({ stage: 'weights', progress: 0.5, message: 'Loading weights...' });
      return { loaded: true, modelId: source, manifestHash: '502fbd6d4c9ed6a890931665995c8ebb42a30e5cda23aa2cfd8e680bee7fa5bc',
      resetGenerationState() {}, async *stream(messages) {
      yield { type: 'text-delta', text: 'Injected answer: ' + messages.at(-1).content };
    } }; }, async close() {} };
    const session = createChatSession({ service, storage: localStorage });
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderConversationWorkspace();
    bindConversationWorkspace(root, { ...session, createThread: options => session.createThread({ ...options, sharingScope: 'local' }) });
    });
  };
  await page.goto('/'); await install();
  await page.locator('[data-composer-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Attached evidence') });
  await expect(page.locator('[data-attachments-preview]')).toContainText('notes.txt');
  await page.locator('[data-composer-input]').fill('Read the attachment');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('.is-assistant')).toContainText('Attached evidence');
  await page.locator('[data-composer-input]').fill('Follow up');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('.is-assistant')).toHaveCount(2);
  await page.reload(); await install();
  await page.locator('[data-thread-item-id]').click();
  await expect(page.locator('.is-assistant')).toHaveCount(2);
  await expect(page.locator('.is-user').first()).toContainText('Attached evidence');
});

test('Verification Worker accepts repaired application modules', async ({ page }) => {
  const paths = ['ui/pool-home/conversation-workspace.js', 'ui/pool-home/index.js', 'host/chat-session.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async path => ['/' + path, await readFile('self/' + path, 'utf8')])));
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

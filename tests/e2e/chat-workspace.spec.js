import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('browser chat owner retains separate conversations across reload without redispatch', async ({ page }) => {
  await page.goto('/');
  const original = await page.evaluate(async () => {
    const { createChatWorkspace } = await import('/vendor/reploid/chat/index.js');
    const app = createChatWorkspace({ meshId: 'test-mesh', participantId: 'alice',
      store: { load: () => null, save: value => localStorage.setItem('chat-test', JSON.stringify(value)) },
      async execute(request, controls) {
        const text = 'Injected answer: ' + request.messages.at(-1).content;
        controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: 0, text });
        return { threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
          modelIdentity: request.model.identity, adapterIdentities: [], content: text };
      } });
    const model = { id: 'injected-model', name: 'Injected test model', identity: 'sha256:' + 'a'.repeat(64) };
    const first = app.createThread({ model }), second = app.createThread({ model });
    await Promise.all([app.send(first, 'Conversation A'), app.send(second, 'Conversation B')]);
    const state = app.getState(); await app.close(); return state.threads;
  });
  await page.reload();
  const restored = await page.evaluate(async () => {
    const { createChatWorkspace } = await import('/vendor/reploid/chat/index.js');
    let executions = 0;
    const app = createChatWorkspace({ meshId: 'test-mesh', participantId: 'alice',
      store: { load: () => JSON.parse(localStorage.getItem('chat-test')), save: value => localStorage.setItem('chat-test', JSON.stringify(value)) },
      async execute() { executions++; throw new Error('Reload must not execute'); } });
    const state = app.getState(); await app.close(); return { state, executions };
  });
  expect(restored.executions).toBe(0);
  expect(restored.state.selectedId).toBe(null);
  expect(restored.state.threads).toEqual(original);
});

test('Verification Worker accepts the conversation and scheduler modules', async ({ page }) => {
  const files = ['index.js', 'workspace.js', 'scheduler.js', 'thread-grants.js'];
  const snapshot = Object.fromEntries(await Promise.all(files.map(async file => [
    '/vendor/reploid/chat/' + file, await readFile('packages/reploid/src/chat/' + file, 'utf8')
  ])));
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

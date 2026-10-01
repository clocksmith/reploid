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
  for (const file of ['host/chat-session.js', 'host/work-model-files.js', 'providers/work-resident-provider.js',
    'infrastructure/pack-transfer-storage.js', 'ui/pool-home/conversation-workspace.js', 'vendor/reploid/artifacts/custody/exchange.js']) {
    snapshot['/' + file] = await readFile('self/' + file, 'utf8');
  }
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

test('file checkpoints remain bounded and release storage across successful transfers', async ({ page }) => {
  await page.goto('/config/chat-files.json');
  const result = await page.evaluate(async () => {
    const { openPeerPackFileCheckpoints } = await import('/infrastructure/pack-transfer-storage.js');
    const { sha256Hex } = await import('/pool/inference-receipt.js');
    const maxBytes = 2 * 1024 * 1024;
    const store = await openPeerPackFileCheckpoints({ name: 'checkpoint-regression', maxBytes });
    let first;
    for (let i = 0; i < 4; i++) {
      const bytes = new Uint8Array(1024 * 1024).fill(i);
      const chunk = { hash: await sha256Hex(bytes), sizeBytes: bytes.length };
      if (!first) first = chunk;
      await store.putChunk(chunk, bytes);
      if ((await store.getStats()).storedBytes > maxBytes) throw new Error('Staging exceeded its budget');
      if ((await store.getChunk(chunk))[0] !== i) throw new Error('Staged bytes changed');
    }
    const evicted = await store.getChunk(first);
    store.close();
    const restored = await openPeerPackFileCheckpoints({ name: 'checkpoint-regression', maxBytes });
    const before = await restored.getStats();
    for (let i = 2; i < 4; i++) {
      const bytes = new Uint8Array(1024 * 1024).fill(i);
      await restored.deleteChunk({ hash: await sha256Hex(bytes), sizeBytes: bytes.length });
    }
    const after = await restored.getStats(); restored.close();
    return { evicted, before, after };
  });
  expect(result.evicted).toBeNull();
  expect(result.before).toMatchObject({ storedBytes: 2 * 1024 * 1024, chunks: 2 });
  expect(result.after).toMatchObject({ storedBytes: 0, chunks: 0 });
});

test('file checkpoints repair missing and truncated files without stale index entries', async ({ page }) => {
  await page.goto('/config/chat-files.json');
  const result = await page.evaluate(async () => {
    const { openPeerPackFileCheckpoints } = await import('/infrastructure/pack-transfer-storage.js');
    const { sha256Hex } = await import('/pool/inference-receipt.js');
    const name = 'checkpoint-repair', bytes = new Uint8Array(32).fill(7);
    const chunk = { hash: await sha256Hex(bytes), sizeBytes: bytes.length };
    const store = await openPeerPackFileCheckpoints({ name, maxBytes: 64 });
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    await store.putChunk(chunk, bytes);
    await directory.removeEntry(chunk.hash.slice(7));
    // A put must restore the file even if nobody has noticed its eviction yet.
    await store.putChunk(chunk, bytes);
    const repairedMissing = [...await store.getChunk(chunk)];
    const writer = await (await directory.getFileHandle(chunk.hash.slice(7))).createWritable();
    await writer.write(bytes.subarray(0, 1)); await writer.close();
    const truncated = await store.getChunk(chunk);
    await store.putChunk(chunk, bytes);
    const repairedTruncated = [...await store.getChunk(chunk)];
    const stats = await store.getStats(); store.close();
    return { repairedMissing, truncated, repairedTruncated, stats };
  });
  expect(result.repairedMissing).toEqual(Array(32).fill(7));
  expect(result.truncated).toBeNull();
  expect(result.repairedTruncated).toEqual(Array(32).fill(7));
  expect(result.stats).toMatchObject({ storedBytes: 32, chunks: 1 });
});

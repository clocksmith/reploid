import { test, expect } from '@playwright/test';
import { observeMeshProtocol, expectMeshDiscovery } from '../fixtures/mesh-discovery.js';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';
import { privateRoom, expectCachedSharingDefault, contributeModel, seedModelFiles, waitContributionReady, chooseModel,
  admitRemote, openComputers, networkProblem } from '../fixtures/current-contribution.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveServedFile } from '../../server/browser-roots.js';

// Three browser contexts in one private discovery room: C seeds the base model and
// the catalog adapter (Settings → Storage), B contributes the adapter variant
// (Computers → Contribute this computer) from pieces C supplies with its own
// origins blocked, and A asks the adapted and the base model in separate threads.
const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
test('three Chrome tabs supply files, execute Doppler and receive independent adapted and base conversations', async ({ browser }, testInfo) => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Explicit real GPU/model-download opt-in required');
  test.setTimeout(1200000);
  const requesterContext = await browser.newContext(), supplierContext = await browser.newContext(), filesContext = await browser.newContext();
  const a = await requesterContext.newPage(), b = await supplierContext.newPage(), c = await filesContext.newPage();
  const errors = [], modelRequests = [], executorRequests = [], seedOrigin = [];
  const base = 'qwen-3-5-0-8b-q4k-ehaf16', specialist = base + '/qwen35-0-8b-ner-json-lora';
  const model = JSON.parse(await readFile(resolveServedFile('config/chat-models.json'), 'utf8')).find(item => item.id === base);
  const room = privateRoom('real-adapter');
  b.on('console', message => {
    if (/LoRA|loaded|failed|Error|Memory \(loading\)/i.test(message.text())) console.log('[contributor]', message.text());
  });
  const weights = url => /huggingface\.co|shard_\d+\.bin|\/model-files\//.test(url);
  a.on('request', request => { if (weights(request.url())) modelRequests.push(request.url()); });
  b.on('request', request => { if (weights(request.url())) executorRequests.push(request.url()); });
  for (const page of [a, b, c]) page.on('pageerror', error => errors.push(error.message));
  // The executor's origins are unavailable: everything it runs must come from the mesh.
  await supplierContext.route('https://huggingface.co/**', route => route.abort('internetdisconnected'));
  await supplierContext.route(model.source.baseUrl + '*', route => route.abort('internetdisconnected'));
  if (directory) await filesContext.route(model.source.baseUrl + '*', async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!/^[\w.-]+$/.test(filename)) throw new Error('Invalid fixture path');
    seedOrigin.push(filename);
    await route.fulfill({ body: await readFile(path.join(directory, filename)),
      contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  const history = page => readChatWorkspace(page);
  const send = async (selection, message) => {
    if (!await a.locator('[data-new-thread]').isVisible()) await a.locator('[data-toggle-thread-rail]').click();
    await a.locator('[data-new-thread]').click();
    await chooseModel(a, selection);
    await a.locator('[data-composer-input]').fill(message);
    await expect(a.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    await a.locator('[data-composer-send]').click();
    await admitRemote(a, async () => !!(await history(a))?.threads.some(thread => thread.messages[0]?.content === message));
    return (await history(a)).threads.find(thread => thread.messages[0].content === message).id;
  };
  const completed = id => expect.poll(async () => {
    const attempt = (await history(a)).threads.find(thread => thread.id === id).attempts.at(-1);
    if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(`Attempt ${attempt.status}: ${attempt.error}`);
    return attempt.status;
  }, { timeout: 180000 }).toBe('completed');
  try {
    for (const page of [a, b, c]) await observeMeshProtocol(page);
    await Promise.all([a.goto(room), b.goto(room), c.goto(room)]);
    for (const page of [a, b, c]) {
      await page.locator('[data-chat-workspace]').waitFor();
      await expectMeshDiscovery(page, { minimum: 2 });
      await expectCachedSharingDefault(page);
    }
    expect(modelRequests).toEqual([]); expect(executorRequests).toEqual([]);
    // The seed only stores and shares files: its compute switch is turned off.
    await openComputers(c);
    await c.locator('[data-toggle-contribution]').click();
    await expect(c.locator('[data-contrib-label]')).toHaveText('Not sharing');
    await seedModelFiles(c, specialist, 2048);
    await expect.poll(async () => {
      const label = await c.locator('[data-file-contribution-label]').textContent();
      const problem = await networkProblem(c);
      if (problem || !['Preparing', 'Sharing', 'Not sharing', 'Stopping'].includes(label)) throw new Error(`Seed failed: ${problem || label}`);
      return label;
    }, { timeout: 600000 }).toBe('Sharing');
    await contributeModel(b, specialist);
    await waitContributionReady(b, { log: state => console.log('[contributor]', JSON.stringify(state)) });
    await expect(c.locator('[data-contrib-label]')).toHaveText('Not sharing');
    const adapted = await send(specialist, 'Extract people and cities as JSON: Alice visited Bob in Paris.');
    const plain = await send(base, 'Reply with a short greeting.');
    await completed(adapted); await completed(plain);
    const state = await history(a);
    const adaptedThread = state.threads.find(thread => thread.id === adapted), plainThread = state.threads.find(thread => thread.id === plain);
    expect(adaptedThread.attempts.at(-1).execution.adapterIdentities).toEqual([model.availableAdapters[0].identity]);
    expect(plainThread.attempts.at(-1).execution.adapterIdentities).toEqual([]);
    for (const thread of [adaptedThread, plainThread]) {
      expect(thread.attempts.at(-1).execution.placement).toBe('peer-whole-request');
      expect(thread.messages.at(-1).content.trim()).not.toBe('');
    }
    expect(modelRequests).toEqual([]); expect(executorRequests).toEqual([]); expect(errors).toEqual([]);
    const acquiredFiles = await b.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
      const files = [];
      for await (const [name, handle] of folder.entries()) files.push({ name, bytes: (await handle.getFile()).size });
      return files;
    });
    expect(acquiredFiles.some(file => file.name === 'sha256-' + model.availableAdapters[0].artifact.hash.slice(7))).toBe(true);
    expect(acquiredFiles.some(file => file.name.startsWith('blake3-') || file.name.startsWith('sha256-'))).toBe(true);
    await a.reload();
    await a.locator('[data-chat-workspace]').waitFor();
    expect((await history(a)).threads).toEqual(state.threads);
    await testInfo.attach('real-chat-evidence', { body: JSON.stringify({ physicalDevices: 1, tabs: 3, discovery: 'private room on local signaling',
      storageIsolation: 'separate Chrome contexts', execution: 'real WebGPU', state, modelRequests, executorRequests, seedOrigin, acquiredFiles, errors }, null, 2), contentType: 'application/json' });
  } finally { await requesterContext.close(); await supplierContext.close(); await filesContext.close(); }
});

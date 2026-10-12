import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('https://replo.id'); await page.locator('[data-chat-workspace]').waitFor();
  const before = await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const bundle = await (await fetch('/config/browser-bundle-manifest.json', { cache: 'no-store' })).json();
    const { createChatWorkspace } = await import('/vendor/reploid/chat/workspace.js');
    const { CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const key = 'reploid.chat-workspace:v1';
    const workspace = createChatWorkspace({ meshId: 'reploid-local-mesh', participantId: 'local-user',
      store: { load: () => null, save: data => localStorage.setItem(key, JSON.stringify(data)) },
      execute: async request => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
        modelIdentity: request.model.identity, adapterIdentities: [], content: 'Saved UI regression answer.' }) });
    const id = workspace.createThread({ model: CANONICAL_CHAT_MODELS[0], purpose: 'Returning UI regression' });
    await workspace.send(id, 'Saved UI regression question.'); await workspace.close();
    localStorage.setItem(key + ':drafts', JSON.stringify({ [id]: { text: 'Unsent returning draft.', files: [] } }));
    return { bundleHash: bundle.bundleHash, id, saved: JSON.parse(localStorage.getItem(key)) };
  });
  await page.reload(); await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-thread-item-id="' + before.id + '"]').click();
  await page.getByText('Saved UI regression answer.', { exact: true }).waitFor();
  if (await page.locator('[data-composer-input]').inputValue() !== 'Unsent returning draft.') throw Error('Pre-upgrade draft missing');
  await context.storageState({ path: 'artifacts/chat-rail-materials-20261013/deployment/returning-storage.json' });
  fs.writeFileSync('artifacts/chat-rail-materials-20261013/deployment/before.json', JSON.stringify({ scope: 'Isolated returning-browser fixture, no model inference or real-user data', ...before }, null, 2)+'\n');
  console.log(JSON.stringify({ before: before.bundleHash, history: true, draft: true }));
} finally { await browser.close(); }

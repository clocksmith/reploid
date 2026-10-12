import { chromium } from 'playwright';
import fs from 'node:fs';
const root = 'artifacts/chat-rail-materials-20261013/deployment/';
const expected = JSON.parse(fs.readFileSync('self/config/browser-bundle-manifest.json')).bundleHash;
const before = JSON.parse(fs.readFileSync(root + 'before.json'));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const receipts = [];
try {
  for (const returning of [false, true]) {
    const context = await browser.newContext({ viewport: { width: returning ? 1440 : 320, height: 844 }, ...(returning ? { storageState: root + 'returning-storage.json' } : {}) });
    const page = await context.newPage();
    let weightRequests = 0;
    page.on('request', request => { if (/\.(?:bin|safetensors)(?:\?|$)/u.test(request.url())) weightRequests++; });
    await page.goto('https://replo.id'); await page.locator('[data-chat-workspace]').waitFor();
    if (returning) {
      await page.locator('[data-toggle-thread-rail]').click();
      await page.locator('[data-thread-item-id="' + before.id + '"]').click();
      await page.getByText('Saved UI regression answer.', { exact: true }).waitFor();
      if (await page.locator('[data-composer-input]').inputValue() !== 'Unsent returning draft.') throw Error('Returning draft changed');
    }
    await page.locator('[data-conversation-actions] > summary').click();
    if (await page.locator('[data-context-enabled]').isChecked()) throw Error('Context enabled without choice');
    await page.locator('[data-context-enabled]').check();
    const preview = await page.locator('[data-context-preview]').innerText();
    if (preview.trim().split(/\s+/u).length !== 16) throw Error('Wrong default context');
    await page.screenshot({ path: root + (returning ? 'returning.png' : 'fresh-phone.png'), fullPage: true });
    if (returning) {
      await page.reload(); await page.locator('[data-toggle-thread-rail]').click();
      await page.locator('[data-thread-item-id="' + before.id + '"]').click();
      await page.getByText('Saved UI regression answer.', { exact: true }).waitFor();
      await page.locator('[data-conversation-actions] > summary').click();
      if (!await page.locator('[data-context-enabled]').isChecked()) throw Error('Context choice not restored');
      if (await page.locator('[data-composer-input]').inputValue() !== 'Unsent returning draft.') throw Error('Draft lost after context reload');
    }
    const state = await page.evaluate(async () => ({
      bundleHash: (await (await fetch('/config/browser-bundle-manifest.json', { cache: 'no-store' })).json()).bundleHash,
      pin: await (await fetch('/config/doppler-package.json', { cache: 'no-store' })).json(),
      workspace: JSON.parse(localStorage.getItem('reploid.chat-workspace:v1'))
    }));
    if (state.bundleHash !== expected) throw Error('Unexpected live bundle');
    if (returning && JSON.stringify(state.workspace.threads[0].messages) !== JSON.stringify(before.saved.threads[0].messages)) throw Error('History changed');
    if (weightRequests) throw Error('UI test downloaded weights');
    receipts.push({ returning, bundleHash: state.bundleHash, runtime: state.pin, defaultPreview: preview, weightRequests,
      historyAndDraftPreserved: returning ? true : null, contextPersisted: returning ? true : null });
    await context.close();
  }
  fs.writeFileSync(root + 'live.json', JSON.stringify({ scope: 'Fresh and returning saved-state fixtures on public UI; no inference. Returning fixture seeded after deployment, not a physical upgrade observation.', revision: '0790710539bf861ba2fcfb853c225a67456b220f', receipts }, null, 2)+'\n');
  console.log(JSON.stringify({ passed: true, bundleHash: expected, cases: receipts.length }));
} finally { await browser.close(); }

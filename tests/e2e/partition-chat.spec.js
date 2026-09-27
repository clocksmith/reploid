import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('split chat composes real peer authentication, grants, binary transfer and persisted conversations', async ({ context }, testInfo) => {
  test.setTimeout(60000);
  await context.route('**/partition-chat-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Partition chat API proof</title>' }));
  for (const [url, file] of [['partition-browser-fixture.js', 'partition-browser.js'], ['partition-runtime-fixture.js', 'partition-runtime.js']]) {
    await context.route('**/' + url, async route => route.fulfill({ contentType: 'text/javascript', body: await readFile('tests/fixtures/' + file, 'utf8') }));
  }
  const a = await context.newPage(), b = await context.newPage(), errors = [];
  try {
    const identities = await Promise.all([a, b].map(async (page, index) => {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/partition-chat-probe');
      return page.evaluate(async index => {
        const { start } = await import('/partition-browser-fixture.js');
        window.partitionTest = await start(index); return window.partitionTest.identity.peerId;
      }, index);
    }));
    await a.evaluate(id => { window.partitionTest.remoteId = id; }, identities[1]);
    await b.evaluate(id => { window.partitionTest.remoteId = id; }, identities[0]);
    const offer = await a.evaluate(() => window.partitionTest.describe('offer'));
    await b.evaluate(offer => window.partitionTest.pc.setRemoteDescription(offer), offer);
    const answer = await b.evaluate(() => window.partitionTest.describe('answer'));
    await a.evaluate(answer => window.partitionTest.pc.setRemoteDescription(answer), answer);
    await Promise.all([a, b].map(page => page.waitForFunction(() => window.partitionTest.main.readyState === 'open')));
    await a.evaluate(() => window.partitionTest.connect());
    expect(await a.evaluate(() => window.partitionTest.proofs)).toEqual([identities[1]]);
    expect(await b.evaluate(() => window.partitionTest.proofs)).toEqual([identities[0]]);
    const threads = await a.evaluate(() => ['1', '10'].map(content => window.partitionTest.send(content)));
    await a.waitForFunction(() => window.partitionTest.session.getState().threads.every(thread => thread.attempts[0].approval));
    expect(await b.evaluate(() => window.partitionTest.factory.log.steps)).toEqual([]);
    await a.evaluate(ids => ids.forEach(id => window.partitionTest.approve(id)), threads);
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    const first = await a.evaluate(() => window.partitionTest.snapshot());
    expect(first.workspace.threads.map(t => t.attempts[0].status)).toEqual(['completed', 'completed']);
    expect(first.workspace.threads.map(t => t.messages.at(-1).content)).toEqual(['2 3 4 ', '11 12 13 ']);
    expect(first.workspace.threads.every(t => t.grants[0].disclosure === 'partition-activations')).toBe(true);
    await expect(a.locator('[data-message-stream]')).toContainText('11 12 13');

    await b.evaluate(() => { window.partitionTest.held = true; });
    await a.evaluate(id => window.partitionTest.send('20', id), threads[0]);
    await b.waitForFunction(() => window.partitionTest.entered);
    await a.evaluate(id => {
      const s = window.partitionTest.session;
      s.revokeGrant(id, s.getState().threads.find(t => t.id === id).grants[0].id);
    }, threads[0]);
    await a.waitForFunction(() => window.partitionTest.session.getState().threads[0].attempts.at(-1).status === 'cancelling');
    await b.evaluate(() => window.partitionTest.release());
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads[0].attempts.at(-1).status)).toBe('cancelled');
    await a.evaluate(id => window.partitionTest.send('30', id), threads[0]);
    await a.waitForFunction(() => window.partitionTest.session.getState().threads[0].attempts.at(-1).approval);
    await a.evaluate(id => window.partitionTest.approve(id), threads[0]);
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    const before = await a.evaluate(() => window.partitionTest.session.getState().threads);
    await a.evaluate(async () => { const s = window.partitionTest; await s.session.close(); s.mount(); });
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads)).toEqual(before);
    expect(await a.evaluate(() => window.partitionTest.factory.log.opens)).toEqual([0]);
    expect(await b.evaluate(() => window.partitionTest.factory.log.opens)).toEqual([1]);
    const limits = await Promise.all([a, b].map(page => page.evaluate(() =>
      window.partitionTest.factory.log.steps.map(step => step.maxTokens))));
    expect(limits[0].length).toBeGreaterThan(0);
    expect(limits[1].length).toBeGreaterThan(0);
    expect(limits.flat().every(value => Number.isSafeInteger(value) && value > 0)).toBe(true);
    expect([...new Set(limits[0])]).toEqual([...new Set(limits[1])]);

    await b.evaluate(() => { window.partitionTest.held = true; window.partitionTest.entered = false; });
    await a.evaluate(id => window.partitionTest.send('40', id), threads[1]);
    await b.waitForFunction(() => window.partitionTest.entered);
    await b.evaluate(() => window.partitionTest.pc.close());
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads[1].attempts.at(-1).status)).toBe('failed');
    await b.evaluate(() => window.partitionTest.release());
    expect(errors).toEqual([]);
    const snapshots = await Promise.all([a, b].map(page => page.evaluate(() => window.partitionTest.snapshot())));
    await testInfo.attach('partition-chat.json', { contentType: 'application/json', body: JSON.stringify({
      scope: 'Reploid integration: real RTC certificate-bound peer proofs and signed grants, injected Doppler execution', snapshots,
      actualModelInference: false, physicalDevices: 1,
    }, null, 2) });
  } finally {
    await b.evaluate(() => window.partitionTest?.release?.()).catch(() => {});
    await Promise.all([a, b].map(async page => { await page.evaluate(() => window.partitionTest?.close()).catch(() => {}); await page.close(); }));
  }
});

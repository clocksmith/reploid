/** Two browser tabs, installed Doppler resident math, existing Reploid RTC coordinator. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

const directory = process.env.DOPPLER_PARTITION_MODEL_DIR;
test.skip(!directory, 'Set DOPPLER_PARTITION_MODEL_DIR to the identified local model directory.');

test('ordinary split chat uses real Doppler residents in two browser tabs', async ({ context }, testInfo) => {
  await context.route('**/partition-chat-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Real partition chat</title>' }));
  for (const [url, file] of [['partition-browser-fixture.js', 'partition-browser.js'],
    ['partition-runtime-fixture.js', 'partition-runtime.js'], ['partition-real-browser-fixture.js', 'partition-real-browser.js']]) {
    await context.route('**/' + url, async route => route.fulfill({
      contentType: 'text/javascript', body: await readFile('tests/fixtures/' + file, 'utf8') }));
  }
  await context.route('**/partition-model/*', async route => {
    const filename = path.basename(new URL(route.request().url()).pathname);
    const file = path.join(directory, filename);
    const details = await fs.stat(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), details.size - 1) : details.size - 1;
    if (start > end || end >= details.size) throw new Error('Invalid local model range');
    const handle = await fs.open(file, 'r');
    let body;
    try {
      body = Buffer.alloc(end - start + 1);
      let received = 0;
      while (received < body.length) {
        const { bytesRead } = await handle.read(body, received, body.length - received, start + received);
        if (!bytesRead) throw new Error('Local model file ended during a range read');
        received += bytesRead;
      }
    }
    finally { await handle.close(); }
    await route.fulfill({ status: range ? 206 : 200, body, headers: {
      'content-type': filename.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      'accept-ranges': 'bytes', 'content-length': String(body.length),
      ...(range ? { 'content-range': `bytes ${start}-${end}/${details.size}` } : {}),
    } });
  });
  const a = await context.newPage(), b = await context.newPage(), errors = [];
  const reference = JSON.parse(await readFile('artifacts/partition-resident/20260927/installed-physical.json', 'utf8'));
  try {
    const identities = await Promise.all([a, b].map(async (page, index) => {
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/partition-chat-probe');
      return page.evaluate(async index => {
        const { startReal } = await import('/partition-real-browser-fixture.js');
        window.partitionTest = await startReal(index);
        return window.partitionTest.identity.peerId;
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
    const threads = await a.evaluate(() => [
      window.partitionTest.send('The color of the sky is'),
      window.partitionTest.send('The capital of France is'),
    ]);
    await a.waitForFunction(() => window.partitionTest.session.getState().threads.every(thread => thread.attempts[0].approval));
    await a.evaluate(ids => ids.forEach(id => window.partitionTest.approve(id)), threads);
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    const requester = await a.evaluate(() => window.partitionTest.snapshot());
    const contributor = await b.evaluate(() => window.partitionTest.snapshot());
    await testInfo.attach('partition-chat-real.json', { contentType: 'application/json',
      body: JSON.stringify({ actualModelInference: true, publicCapsuleAcquisition: false,
        physicalDevices: 1, requester, contributor, errors }, null, 2) });
    expect(requester.workspace.threads.map(thread => thread.attempts[0].status)).toEqual(['completed', 'completed']);
    expect(requester.workspace.threads[0].messages.at(-1).content).toBe(reference.result.content);
    expect(requester.workspace.threads[0].attempts[0].execution.steps.map(step => step.tokenId))
      .toEqual(reference.result.tokenIds);
    expect(requester.workspace.threads[1].messages.at(-1).content).toBe(reference.additionalReference.content);
    expect(requester.workspace.threads[1].attempts[0].execution.steps.map(step => step.tokenId))
      .toEqual(reference.additionalReference.tokenIds);
    expect(requester.workspace.threads.every(thread => thread.grants[0].disclosure === 'partition-activations-and-tokens'))
      .toBe(true);
    expect(requester.log.opens).toEqual([0]);
    expect(contributor.log.opens).toEqual([1]);
    expect(requester.peer.receipt.sentFrames).toBeGreaterThan(0);
    await b.evaluate(() => window.partitionTest.factory.holdNext());
    const cancelledThread = await a.evaluate(() => window.partitionTest.send('Cancellation probe'));
    await a.waitForFunction(() => window.partitionTest.session.getState().threads.at(-1).attempts[0].approval);
    await a.evaluate(id => window.partitionTest.approve(id), cancelledThread);
    await b.waitForFunction(() => window.partitionTest.factory.entered);
    await a.evaluate(id => {
      const session = window.partitionTest.session;
      const thread = session.getState().threads.find(item => item.id === id);
      session.revokeGrant(id, thread.grants[0].id);
    }, cancelledThread);
    await a.waitForFunction(() => window.partitionTest.session.getState().threads.at(-1).attempts[0].status === 'cancelling');
    await b.evaluate(() => window.partitionTest.factory.release());
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads.at(-1).attempts[0].status))
      .toBe('cancelled');
    await testInfo.attach('partition-cancellation.json', { contentType: 'application/json',
      body: JSON.stringify({ requester: await a.evaluate(() => window.partitionTest.snapshot()),
        contributor: await b.evaluate(() => window.partitionTest.snapshot()) }, null, 2) });
    await b.evaluate(() => window.partitionTest.factory.holdNext());
    const departedThread = await a.evaluate(() => window.partitionTest.send('Departure probe'));
    await a.waitForFunction(() => window.partitionTest.session.getState().threads.at(-1).attempts[0].approval);
    await a.evaluate(id => window.partitionTest.approve(id), departedThread);
    await b.waitForFunction(() => window.partitionTest.factory.entered);
    await b.evaluate(() => window.partitionTest.pc.close());
    await a.waitForFunction(() => window.partitionTest.session.getState().runningIds.length === 0);
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads.at(-1).attempts[0].status))
      .toBe('failed');
    expect(await a.evaluate(() => window.partitionTest.session.getState().threads.slice(0, 2).map(thread => thread.attempts[0].status)))
      .toEqual(['completed', 'completed']);
    await b.evaluate(() => window.partitionTest.factory.release());
    await testInfo.attach('partition-departure.json', { contentType: 'application/json',
      body: JSON.stringify({ requester: await a.evaluate(() => window.partitionTest.snapshot()),
        contributor: await b.evaluate(() => window.partitionTest.snapshot()) }, null, 2) });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([a, b].map(async page => {
      await page.evaluate(() => window.partitionTest?.close()).catch(() => {}); await page.close();
    }));
  }
});

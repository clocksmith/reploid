import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
let server, origin;
test.beforeAll(async () => {
  const root = path.resolve('.');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Introductions</title>'); return; }
      const file = path.resolve(root, pathname.slice(1));
      if (![path.join(root, 'self') + path.sep, path.join(root, 'tests/fixtures') + path.sep].some(prefix => file.startsWith(prefix))) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });

test('browsers introduce peers over existing channels with all signaling servers blocked', async ({ browser }, testInfo) => {
  const contexts = [], pages = [], contacts = [], manual = [];
  try {
    for (const id of ['b', 'a', 'c']) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage(); pages.push(page);
      await page.goto(origin);
      await page.exposeFunction('deliverIntroduction', async envelope => {
        manual.push(envelope);
        const destination = pages[['b', 'a', 'c'].indexOf(envelope.record.body.to)];
        // Out-of-band invitations carry opaque encrypted records for first pairing only.
        destination.evaluate(value => window.introductions.receive(value), envelope).catch(error => console.error(error));
        return true;
      });
      contacts.push(await page.evaluate(async ({ id, bootstrapContact }) => {
        window.introductions = await import('/tests/fixtures/peer-introductions-browser.js');
        return window.introductions.start(id, bootstrapContact);
      }, { id, bootstrapContact: id === 'c' ? contacts[0] : null }));
    }
    await pages[1].evaluate(contact => window.introductions.connect(contact), contacts[0]);
    await expect.poll(() => pages[1].evaluate(() => window.introductions.peers())).toContain('b');
    await expect.poll(() => pages[1].evaluate(() => window.introductions.peers())).toContain('c');
    await expect.poll(() => pages[2].evaluate(() => window.introductions.peers())).toContain('a');
    expect(manual.every(message => message.record.body.from === 'b' || message.record.body.to === 'b')).toBe(true);
    expect(JSON.stringify(manual)).not.toContain('a=fingerprint');
    const bootstrap = await pages[2].evaluate(() => window.introductions.events.filter(event => event.type === 'swarm:bootstrap-state'));
    expect(bootstrap.map(event => event.payload.state)).toEqual(['connecting', 'unavailable', 'connecting', 'connected']);
    await pages[0].evaluate(() => window.introductions.close());
    expect(await pages[1].evaluate(() => window.introductions.send('c', { text: 'after-introducer-removal' }))).toBe(true);
    await expect.poll(() => pages[2].evaluate(() => window.introductions.messages)).toContainEqual({ from: 'a', value: { text: 'after-introducer-removal' } });
    expect(await pages[1].evaluate(() => window.introductions.echo('c'))).toEqual([1, 3, 5, 7]);
    const observations = await Promise.all(pages.map(page => page.evaluate(() => ({ peers: window.introductions.peers(),
      errors: window.introductions.errors, events: window.introductions.events }))));
    await testInfo.attach('introductions', { body: JSON.stringify({ executionClass: 'three-isolated-browser-contexts-real-webrtc',
      signalingServer: false, modelInference: false, observations }, null, 2), contentType: 'application/json' });
    expect(observations.flatMap(item => item.events.filter(event => event.type === 'swarm:introduction-error'))).toEqual([]);
  } finally {
    for (const page of pages) await page.evaluate(() => window.introductions?.close()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});

test('reports connection failure when policy requires a relay and none is configured', async ({ browser }, testInfo) => {
  const contexts = [], pages = [], contacts = [];
  try {
    for (const id of ['a', 'b']) {
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage(); pages.push(page); await page.goto(origin);
      await page.exposeFunction('deliverIntroduction', async envelope => {
        pages[['a', 'b'].indexOf(envelope.record.body.to)].evaluate(value => window.introductions.receive(value), envelope).catch(() => {});
        return true;
      });
      contacts.push(await page.evaluate(async id => {
        window.introductions = await import('/tests/fixtures/peer-introductions-browser.js');
        return window.introductions.start(id, null, true);
      }, id));
    }
    await pages[0].evaluate(contact => window.introductions.connect(contact), contacts[1]);
    await expect.poll(() => pages[0].evaluate(() => window.introductions.events.some(event => event.type === 'swarm:connection-failed'))).toBe(true);
    expect(await pages[0].evaluate(() => window.introductions.peers())).toEqual([]);
    expect(await pages[0].evaluate(() => window.introductions.send('b', { text: 'must-not-arrive' }))).toBe(false);
    await testInfo.attach('restricted-connectivity', { body: JSON.stringify({ scenario: 'relay-required-without-a-relay',
      externalNATTest: false, events: await pages[0].evaluate(() => window.introductions.events) }, null, 2), contentType: 'application/json' });
  } finally {
    for (const page of pages) await page.evaluate(() => window.introductions?.close()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});

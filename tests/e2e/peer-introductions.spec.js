import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { physicalEmbeddingAssets } from '../fixtures/physical-embedding-assets.js';
import { connectPhysicalBrowser } from '../fixtures/physical-webgpu-browser.js';
let server, origin, remoteBrowser, physicalConfig;
const hostScope = process.env.REPLOID_EXECUTOR_WS ? 'two-physical-hosts' : 'one-host';
const createContext = (browser, index) => (index === 1 && remoteBrowser ? remoteBrowser : browser).newContext();
test.beforeAll(async () => {
  const root = path.resolve('.');
  const assets = await physicalEmbeddingAssets(process.env.REPLOID_UNITS_PHYSICAL_CONFIG);
  physicalConfig = assets.configuration;
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (assets.serve(pathname, response)) return;
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Introductions</title><script type="importmap">{"imports":{"reploid/jobs":"/self/vendor/reploid/mesh/jobs/index.js"}}</script>'); return; }
      const file = path.resolve(root, pathname.slice(1));
      if (![path.join(root, 'self') + path.sep, path.join(root, 'tests/fixtures') + path.sep].some(prefix => file.startsWith(prefix))) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript'); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(Number(process.env.REPLOID_INTRODUCTIONS_PORT || 0), '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  if (process.env.REPLOID_EXECUTOR_WS) remoteBrowser = await connectPhysicalBrowser(chromium, process.env.REPLOID_EXECUTOR_WS);
});
test.afterAll(async () => {
  await remoteBrowser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
});

test('browsers introduce peers over existing channels with all signaling servers blocked', async ({ browser }, testInfo) => {
  const contexts = [], pages = [], contacts = [], manual = [];
  try {
    for (const id of ['b', 'a', 'c']) {
      const context = await createContext(browser, contexts.length); contexts.push(context);
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
    await testInfo.attach('introductions', { body: JSON.stringify({ executionClass: 'three-isolated-browser-contexts-real-webrtc', hostScope,
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
      const context = await createContext(browser, contexts.length); contexts.push(context);
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
      hostScope, externalNATTest: false, events: await pages[0].evaluate(() => window.introductions.events) }, null, 2), contentType: 'application/json' });
  } finally {
    for (const page of pages) await page.evaluate(() => window.introductions?.close()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});

test('ordinary product host uses independent bootstrap and ICE without granting compute or file sharing', async ({ browser }, testInfo) => {
  const contexts = [], pages = [], external = [];
  try {
    for (let index = 0; index < 2; index++) {
      const context = await createContext(browser, index); contexts.push(context);
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage(); pages.push(page); await page.goto(origin);
      await page.exposeFunction('deliverIntroduction', envelope => {
        const receiver = pages[index === 0 ? 1 : 0];
        receiver.evaluate(envelope => window.introductions.receiveHost(envelope), envelope).catch(error => console.error(error));
        return true;
      });
      await page.evaluate(async () => { window.introductions = await import('/tests/fixtures/peer-introductions-browser.js'); });
    }
    const contact = await pages[0].evaluate(() => window.introductions.startHost(null));
    const hosted = await pages[1].evaluate(contact => window.introductions.startHost(contact), contact);
    await expect.poll(() => pages[0].evaluate(() => window.introductions.hostState().peers)).toContain(hosted.body.peerId);
    await expect.poll(() => pages[1].evaluate(() => window.introductions.hostState().peers)).toContain(contact.body.peerId);
    expect(await pages[1].evaluate(() => window.introductions.hostState())).toMatchObject({
      sharing: false, introductionAssistance: false, files: { sharing: false }, contributionPhase: 'idle'
    });
    await pages[1].evaluate(() => window.introductions.allowHostIntroductions(true));
    expect(await pages[1].evaluate(() => window.introductions.hostState())).toMatchObject({
      sharing: false, introductionAssistance: true, files: { sharing: false }, contributionPhase: 'idle'
    });
    const events = await pages[1].evaluate(() => window.introductions.events);
    expect(events.filter(event => event.type === 'swarm:bootstrap-state').map(event => event.payload.state))
      .toEqual(['connecting', 'unavailable', 'connecting', 'connected']);
    expect(events.some(event => event.type === 'host:rtc-config')).toBe(true);
    expect(external).toEqual([]);
    await testInfo.attach('ordinary-host-bootstrap', { body: JSON.stringify({
      executionClass: 'ordinary-product-host-two-browser-contexts-real-webrtc',
      hostScope, modelInference: false, externalNATTest: false, configuredParticipant: true, externalRequests: external,
      state: await pages[1].evaluate(() => window.introductions.hostState()), events
    }, null, 2), contentType: 'application/json' });
  } finally {
    await pages[1]?.evaluate(() => window.introductions?.closeHost()).catch(() => {});
    await pages[0]?.evaluate(() => window.introductions?.closeHost()).catch(() => {});
    for (const context of contexts) await context.close();
  }
});

test('source-validated embedding job crosses introduced peers after the introducer leaves', async ({}, testInfo) => {
  test.skip(!physicalConfig || !remoteBrowser, 'Requires the accepted embedding configuration and an explicit remote requester browser.');
  test.setTimeout(physicalConfig.config.timeoutMs);
  const local = await chromium.launch({ headless: true, args: physicalConfig.config.launchArgs });
  const contexts = [], pages = [], contacts = [], external = [], requesterWeights = [];
  try {
    for (const id of ['b', 'a', 'c']) {
      const context = await createContext(local, contexts.length); contexts.push(context);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { external.push(url.href); return route.abort(); }
        if (id === 'a' && url.pathname.startsWith('/capsule/')) {
          requesterWeights.push(url.pathname); return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage(); pages.push(page); await page.goto(origin);
      await page.exposeFunction('deliverIntroduction', envelope => {
        const destination = pages[['b', 'a', 'c'].indexOf(envelope.record.body.to)];
        destination.evaluate(value => window.introductions.receive(value), envelope).catch(error => console.error(error));
        return true;
      });
      contacts.push(await page.evaluate(async ({ id, bootstrapContact }) => {
        window.introductions = await import('/tests/fixtures/peer-introductions-browser.js');
        return window.introductions.start(id, bootstrapContact);
      }, { id, bootstrapContact: id === 'c' ? contacts[0] : null }));
    }
    await pages[1].evaluate(contact => window.introductions.connect(contact), contacts[0]);
    await expect.poll(() => pages[1].evaluate(() => window.introductions.peers())).toContain('c');
    await expect.poll(() => pages[2].evaluate(() => window.introductions.peers())).toContain('a');
    await pages[0].evaluate(() => window.introductions.close());
    await expect.poll(() => pages[1].evaluate(() => window.introductions.peers())).not.toContain('b');
    const requester = await pages[1].evaluate(async () => {
      window.job = await import('/tests/fixtures/introduced-embedding-job.js'); return window.job.prepareRequester();
    });
    const descriptor = await pages[2].evaluate(async requesterId => {
      window.job = await import('/tests/fixtures/introduced-embedding-job.js');
      return window.job.prepareProvider({ requesterId, remotePeerId: 'a', approveModelOpening: true });
    }, requester.keyId);
    await pages[1].evaluate(model => window.job.connectRequester({ remotePeerId: 'c', model }), descriptor.model);
    await expect.poll(() => pages[2].evaluate(() => window.job.ready())).toBe(true);
    const advert = await pages[2].evaluate(() => window.job.advert());
    const denied = await pages[1].evaluate(async ({ advert, descriptor }) => {
      try { await window.job.run(advert, descriptor, false); return null; } catch (error) { return error.message; }
    }, { advert, descriptor });
    expect(denied).toMatch(/consent|public/i);
    await pages[1].evaluate(({ advert, descriptor }) => {
      window.deniedController = new AbortController();
      window.deniedOutcome = window.job.run(advert, descriptor, true, window.deniedController.signal)
        .then(() => null, error => error.message);
    }, { advert, descriptor });
    await expect.poll(() => pages[2].evaluate(() => window.job.status().errors
      .some(error => error.includes('did not authorize public delegation')))).toBe(true);
    const noCompute = await pages[1].evaluate(async () => {
      window.deniedController.abort(new Error('Denied computation control settled'));
      return window.deniedOutcome;
    });
    expect(noCompute).toBe('Denied computation control settled');
    expect(await pages[2].evaluate(() => window.job.status().calls)).toBe(0);
    await pages[2].evaluate(() => window.job.allowComputation(true));
    const result = await pages[1].evaluate(({ advert, descriptor }) => window.job.run(advert, descriptor, true), { advert, descriptor });
    expect(result.comparison.passed).toBe(true);
    expect(result.result.execution.request.assignment).not.toBeNull();
    const provider = await pages[2].evaluate(() => window.job.status());
    expect(provider.calls).toBe(1);
    expect(provider.buffers.peakBytesAllocated).toBeLessThanOrEqual(1420000000);
    expect(external).toEqual([]); expect(requesterWeights).toEqual([]);
    await testInfo.attach('introduced-physical-embedding', { body: JSON.stringify({ hostScope,
      executionClass: 'signed-source-validated-embedding-over-introduced-webrtc', modelInference: true,
      chatAcceptance: false, publicBootstrap: false, descriptor, denied, noCompute, result, provider,
      runtimePackage: physicalConfig.runtimePackage, externalRequests: external, requesterWeightRequests: requesterWeights
    }, null, 2), contentType: 'application/json' });
  } catch (error) {
    await testInfo.attach('introduced-embedding-failure', { body: JSON.stringify({ error: error.message,
      provider: await pages[2]?.evaluate(() => window.job?.status()).catch(() => null), external, requesterWeights }), contentType: 'application/json' });
    throw error;
  } finally {
    for (const page of pages) await page.evaluate(() => window.job?.close()).catch(() => {});
    for (const page of pages) await page.evaluate(() => window.introductions?.close()).catch(() => {});
    for (const context of contexts) await context.close();
    await local.close();
  }
});

import { test, expect, chromium } from '@playwright/test';
import { inspectConnections } from '../fixtures/capacity-observer.js';

test('measures signed chunk pipelining with an unchanged payload and physical connection', async ({ browser }, info) => {
  test.skip(!process.env.REPLOID_EXECUTOR_WS, 'Physical comparison requires the remote browser');
  test.setTimeout(300000);
  const remote = await chromium.connect(process.env.REPLOID_EXECUTOR_WS);
  const contexts = await Promise.all([browser.newContext(), remote.newContext()]);
  if (process.env.REPLOID_E2E_RTC_CONFIG_FILE) {
    const { readFile } = await import('node:fs/promises');
    const rtc = JSON.parse(await readFile(process.env.REPLOID_E2E_RTC_CONFIG_FILE, 'utf8'));
    for (const context of contexts) await context.addInitScript(config => { globalThis.REPLOID_POOL_RTC_CONFIG = config; }, rtc);
  }
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [], modelRequests = [];
  try {
    for (const page of pages) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/failed|error|Initializing/i.test(message.text())) console.log(message.text()); });
      page.on('request', request => { if (/\/vendor\/doppler\/|huggingface/.test(request.url())) modelRequests.push(request.url()); });
      // A real HTTP document retains Chrome's loopback address-space identity;
      // fulfilling the navigation synthetically causes LNA to block WebSocket.
      await page.goto('/config/chat-files.json');
      await page.evaluate(async () => {
        const { createSwarmTransport } = await import('/vendor/reploid/transport/index.js');
        const { createLegacyNetworkOptions } = await import('/capabilities/communication/library-adapter.js');
        const { default: Utils } = await import('/core/utils.js');
        const { default: EventBus } = await import('/infrastructure/event-bus.js');
        const { createCustodyExchange } = await import('/vendor/reploid/artifacts/custody/runtime.js');
        const { createPeerPackSupplier, createPeerPackArtifactStore } = await import('/pool/peer-pack-custody.js');
        const { createPeerPackDataChannel } = await import('/pool/peer-pack-data-channel.js');
        const { createSigningKeyPair, exportPublicKey, sha256Hex } = await import('/pool/inference-receipt.js');
        const { hashDopplerEvidence } = await import('/pool/executable-pack.js');
        const policy = await (await fetch('/config/chat-files.json')).json();
        const utils = Utils.factory({}), events = EventBus.factory({ Utils: utils });
        const transport = createSwarmTransport(createLegacyNetworkOptions({ Utils: utils, EventBus: events, peerId: crypto.randomUUID() }));
        await transport.init();
        const pair = await createSigningKeyPair(), receipts = [];
        const bytes = new Uint8Array(4194304).fill(37);
        const descriptor = { path: 'fixture.bin', role: 'model-weights', sizeBytes: bytes.length,
          hashAlgorithm: 'sha256', hash: (await sha256Hex(bytes)).slice(7) };
        const publicKey = await exportPublicKey(pair.publicKey);
        const create = maxPendingRequests => createCustodyExchange({ transport, policy: { ...policy,
          channel: { ...policy.channel, maxPendingRequests } },
          identity: { peerId: transport._getPeerId(), publicKey, privateKey: pair.privateKey },
          ports: { createSupplier: createPeerPackSupplier, createStore: options => createPeerPackArtifactStore({ ...options, maxConcurrentChunks: window.fixture.maxConcurrentChunks }),
            createChannel: createPeerPackDataChannel, hash: hashDopplerEvidence, hashBytes: sha256Hex,
            readArtifact: async () => bytes.slice(),
            verifyArtifact: async (file, data) => { if (await sha256Hex(data) !== 'sha256:' + file.hash) throw new Error('integrity'); },
            observe: receipt => receipts.push(receipt) } });
        window.fixture = { transport, create, descriptor, receipts, sha256Hex, exchange: null, maxConcurrentChunks: 2 };
      });
    }
    for (const page of pages) await expect.poll(() => page.evaluate(() => window.fixture.transport.getConnectedPeers().length)).toBe(1);
    const measurements = [];
    for (const page of pages) await page.evaluate(() => { const f = window.fixture; f.exchange = f.create(2); });
    for (const page of pages) await page.evaluate(() => window.fixture.exchange.offer([window.fixture.descriptor]));
    for (const page of pages) await expect.poll(() => page.evaluate(() => window.fixture.exchange.has(window.fixture.descriptor))).toBe(true);
    for (const concurrency of [1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2, 1]) {
      await pages[1].evaluate(value => { window.fixture.maxConcurrentChunks = value; }, concurrency);
      const row = await pages[1].evaluate(async () => {
        const { exchange, descriptor, sha256Hex, receipts } = window.fixture;
        const started = performance.now();
        const hash = await sha256Hex(await exchange.acquire(descriptor, { signal: new AbortController().signal }));
        return { hash, elapsedMs: performance.now() - started, receipt: receipts.at(-1) };
      });
      expect(row.receipt.receivedBytes).toBe(4194304);
      expect(row.receipt.maxConcurrentChunks).toBe(concurrency);
      measurements.push({ concurrency, ...row });
      console.log(JSON.stringify({ concurrency, elapsedMs: row.elapsedMs, transferMs: row.receipt.elapsedMs }));
    }
    expect(new Set(measurements.map(row => row.hash)).size).toBe(1);
    expect(errors).toEqual([]); expect(modelRequests).toEqual([]);
    const connections = await Promise.all(pages.map(inspectConnections));
    await info.attach('custody-throughput.json', { contentType: 'application/json', body: JSON.stringify({
      scope: 'signed synthetic 4 MiB payload over physical WebRTC; no model inference; same retained channel, fresh per-file grants and empty checkpoints', measurements, connections, errors
    }, null, 2) });
  } finally {
    await Promise.all(pages.map(page => page.evaluate(async () => {
      await window.fixture?.exchange?.close(); window.fixture?.transport.disconnect();
    }).catch(() => {})));
    await Promise.all(contexts.map(context => context.close()));
    await remote.close();
  }
});

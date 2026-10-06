import { test, expect } from '@playwright/test';

test('actual swarm channels exchange signed synthetic files in both directions with distinct clocks and no channel glare', async ({ browser }, info) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [], modelRequests = [];
  try {
    for (const [index, page] of pages.entries()) {
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (/failed|error|Initializing/i.test(message.text())) console.log(message.text()); });
      page.on('request', request => { if (/\/vendor\/doppler\/|huggingface/.test(request.url())) modelRequests.push(request.url()); });
      // A real HTTP document retains Chrome's loopback address-space identity;
      // fulfilling the navigation synthetically causes LNA to block WebSocket.
      await page.goto('/config/chat-files.json');
      await page.evaluate(async clockOffset => {
        const { createSwarmTransport } = await import('/vendor/reploid/transport/index.js');
        const { createLegacyNetworkOptions } = await import('/capabilities/communication/library-adapter.js');
        const { default: Utils } = await import('/core/utils.js');
        const { default: EventBus } = await import('/infrastructure/event-bus.js');
        const { createCustodyExchange } = await import('/vendor/reploid/artifacts/custody/runtime.js');
        const { createPeerPackSupplier, createPeerPackArtifactStore } = await import('/pool/peer-pack-custody.js');
        const { createPeerPackDataChannel } = await import('/pool/peer-pack-data-channel.js');
        const { createSigningKeyPair, exportPublicKey, sha256Hex } = await import('/pool/inference-receipt.js');
        const { hashDopplerEvidence } = await import('/pool/executable-pack.js');
        const { openPeerPackFileCheckpoints } = await import('/infrastructure/pack-transfer-storage.js');
        const policy = await (await fetch('/config/chat-files.json')).json();
        const utils = Utils.factory({}), events = EventBus.factory({ Utils: utils });
        const transport = createSwarmTransport(createLegacyNetworkOptions({ Utils: utils, EventBus: events, peerId: crypto.randomUUID() }));
        await transport.init();
        const pair = await createSigningKeyPair(), receipts = [];
        const bytes = new Uint8Array(262145).fill(37);
        const descriptor = { path: 'fixture.bin', role: 'model-weights', sizeBytes: bytes.length,
          hashAlgorithm: 'sha256', hash: (await sha256Hex(bytes)).slice(7) };
        const checkpoints = await openPeerPackFileCheckpoints({ name: 'custody-eviction-contract', maxBytes: bytes.length });
        const exchange = createCustodyExchange({ transport, policy,
          identity: { peerId: transport._getPeerId(), publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey },
          ports: { now: () => Date.now() + clockOffset,
            createSupplier: createPeerPackSupplier, createStore: createPeerPackArtifactStore,
            createChannel: createPeerPackDataChannel, hash: hashDopplerEvidence, hashBytes: sha256Hex,
            readArtifact: async () => bytes.slice(),
            checkpoints,
            verifyArtifact: async (file, data) => { if (await sha256Hex(data) !== 'sha256:' + file.hash) throw new Error('integrity'); },
            observe: receipt => receipts.push(receipt) } });
        window.fixture = { transport, exchange, descriptor, receipts, sha256Hex, checkpoints };
      }, index * 250);
    }
    for (const page of pages) await expect.poll(() => page.evaluate(() => window.fixture.transport.getConnectedPeers().length)).toBe(1);
    for (const page of pages) await page.evaluate(() => window.fixture.exchange.offer([window.fixture.descriptor]));
    for (const page of pages) await expect.poll(() => page.evaluate(() => window.fixture.exchange.has(window.fixture.descriptor))).toBe(true);
    // Reproduce the restart boundary: the supplier still has the file, but
    // the consumer's browser-managed checkpoint index has disappeared.
    for (const page of pages) await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await (await root.getDirectoryHandle('custody-eviction-contract')).removeEntry('index.json');
    });
    const hashes = await Promise.all(pages.map(page => page.evaluate(async () => {
      const { exchange, descriptor, sha256Hex } = window.fixture;
      return sha256Hex(await exchange.acquire(descriptor, { signal: new AbortController().signal }));
    })));
    expect(hashes[0]).toBe(hashes[1]);
    const receipts = await Promise.all(pages.map(page => page.evaluate(() => window.fixture.receipts)));
    expect(receipts.flat().map(receipt => receipt.receivedBytes)).toEqual([262145, 262145]);
    expect(errors).toEqual([]); expect(modelRequests).toEqual([]);
    await info.attach('custody-exchange-evidence', { contentType: 'application/json', body: JSON.stringify({
      execution: 'synthetic files, real WebRTC and signatures; no model inference', checkpointIndexRemovedBeforeAcquisition: true,
      clockOffsetsMs: [0, 250], hashes, receipts, errors
    }, null, 2) });
  } finally {
    await Promise.all(pages.map(page => page.evaluate(async () => {
      await window.fixture?.exchange.close(); window.fixture?.transport.disconnect();
      window.fixture?.checkpoints.close();
    }).catch(() => {})));
    await Promise.all(contexts.map(context => context.close()));
  }
});

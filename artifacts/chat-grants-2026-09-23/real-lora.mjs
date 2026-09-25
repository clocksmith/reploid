/** Same-device real adapter custody and GPU application; no inference substitution. */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const record = JSON.parse(await readFile('docs/artifact-custody/network-canaries-v1.json', 'utf8')).artifacts.find(a => a.id === 'qwen35-0.8b-ner-json-lora');
record.transferUrl = 'https://huggingface.co/' + record.source.repository + '/resolve/' + record.source.revision + '/adapter_model.safetensors';
const selectedModel = JSON.parse(await readFile('self/config/chat-models.json', 'utf8')).find(model => model.id === 'qwen-3-5-0-8b-q4k-ehaf16');
const model = { id: selectedModel.id, identity: selectedModel.identity,
  url: 'https://huggingface.co/clocksmith/rdrr/resolve/80d7716270b6371d541de979eff3370edaf34e13/models/qwen-3-5-0-8b-q4k-ehaf16/manifest.json' };
const files = ['self/config/chat-models.json', 'self/config/doppler-local-models.js', 'self/vendor/reploid/artifacts/custody/runtime.js', 'self/pool/peer-pack-data-channel.js',
  'self/infrastructure/pack-transfer-storage.js', 'self/infrastructure/doppler-runtime-service.js'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const evidence = { startedAt: new Date().toISOString(), physicalDevices: 1, sourceHashes: await hashes(), errors: [],
  executionClass: 'real-signed-custody-real-adapter-real-webgpu', runtimeVersion: '0.6.2', model,
  adapter: { id: record.id, sha256: record.sha256, sizeBytes: record.sizeBytes, origin: record.transferUrl }, recipientAdapterOriginRequests: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'] });
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const [source, recipient] = await Promise.all(contexts.map(context => context.newPage()));
try {
  for (const [i, page] of [source, recipient].entries()) {
    page.on('pageerror', error => evidence.errors.push({ i, error: error.message }));
    page.on('console', event => { if (event.text().startsWith('PHYSICAL ')) console.log(i, event.text()); });
    if (i === 1) page.on('request', request => { if (request.url().includes('/clocksmith/lora/') || request.url().includes('/Mike0021/')) evidence.recipientAdapterOriginRequests++; });
    await page.route('**/physical-adapter-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Physical adapter probe</title>' }));
    await page.goto('http://localhost:8000/physical-adapter-probe');
    await page.evaluate(async ({ role, record, model }) => {
      const { createSigningKeyPair, exportPublicKey, sha256Hex } = await import('/pool/inference-receipt.js');
      const { hashDopplerEvidence } = await import('/pool/executable-pack.js');
      const { createPeerPackSupplier, createPeerPackArtifactStore } = await import('/pool/peer-pack-custody.js');
      const { createPeerPackDataChannel } = await import('/pool/peer-pack-data-channel.js');
      const { openPeerPackCheckpoints } = await import('/infrastructure/pack-transfer-storage.js');
      const pair = await createSigningKeyPair(), identity = { peerId: role, publicKey: await exportPublicKey(pair.publicKey) };
      const limits = { maxFrameBytes: 16384, maxControlBytes: 32768, maxChunkBytes: 262144,
        maxBufferedBytes: 1048576, maxPendingRequests: 2, maxTransferBytes: 134217728, timeoutMs: 30000 };
      const held = new Map(); let supplier, bus, connection, custody, checkpoints, session, service;
      const check = (value, message) => { if (!value) throw new Error(message); };
      async function gathered() {
        if (connection.iceGatheringState !== 'complete') await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('ICE timeout')), 10000);
          connection.addEventListener('icegatheringstatechange', () => { if (connection.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
        });
        return connection.localDescription.toJSON();
      }
      const install = channel => channel.addEventListener('open', () => {
        bus = createPeerPackDataChannel({ channel, limits, serve: supplier ? request => supplier.serve(request) : null });
      }, { once: true });
      window.probe = { identity,
        async provision(receiver) {
          const specifications = [
            { artifactId: record.id, role: 'lora-weights', path: 'adapter_model.safetensors', hash: 'sha256:' + record.sha256,
              sizeBytes: record.sizeBytes, url: record.transferUrl },
            { artifactId: 'base-manifest', role: 'model-manifest', path: 'manifest.json', hash: model.identity, url: model.url }
          ];
          const artifacts = [];
          for (const specification of specifications) {
            console.log('PHYSICAL fetching', specification.artifactId);
            const response = await fetch(specification.url); check(response.ok, 'Origin HTTP ' + response.status);
            const bytes = new Uint8Array(await response.arrayBuffer());
            check(await sha256Hex(bytes) === specification.hash, 'Origin artifact hash mismatch');
            if (specification.sizeBytes) check(bytes.length === specification.sizeBytes, 'Origin artifact size mismatch');
            held.set(specification.artifactId, bytes);
            const { url, ...artifact } = specification; artifacts.push({ ...artifact, sizeBytes: bytes.length });
          }
          const artifactSet = { schema: 'reploid.pool.artifact-set/v1', identity: await hashDopplerEvidence(artifacts), artifacts };
          const index = { schema: 'reploid.pool.pack-custody-index/v2', artifactSetIdentity: artifactSet.identity, artifacts: [] };
          for (const artifact of artifacts) {
            const bytes = held.get(artifact.artifactId), chunks = [];
            for (let offset = 0; offset < bytes.length; offset += limits.maxChunkBytes) {
              const slice = bytes.slice(offset, offset + limits.maxChunkBytes);
              chunks.push({ index: chunks.length, offset, sizeBytes: slice.length, hash: await sha256Hex(slice) });
            }
            index.artifacts.push({ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: artifact.sizeBytes, chunks });
          }
          const authorization = { schema: 'reploid.pool.pack-custody-authorization/v2', artifactSet,
            transferId: crypto.randomUUID(), attempt: 1, expiresAt: Date.now() + 1800000,
            requester: receiver, suppliers: [identity], indexDigest: await hashDopplerEvidence(index),
            limits: { maxArtifactBytes: 67108864, maxChunkBytes: limits.maxChunkBytes, maxTransferBytes: 134217728, requestTimeoutMs: 30000 } };
          supplier = await createPeerPackSupplier({ authorization, index, peerId: identity.peerId, privateKey: pair.privateKey,
            inventory: { expiresAt: authorization.expiresAt, maxBytes: 134217728,
              artifacts: index.artifacts.map(a => ({ artifactId: a.artifactId, chunkIndexes: a.chunks.map(c => c.index) })) },
            readChunk: async (id, chunk) => held.get(id).slice(chunk.offset, chunk.offset + chunk.sizeBytes) });
          return { authorization, index, inventories: [supplier.inventory] };
        },
        configure(value) { custody = value; },
        async offer() { connection = new RTCPeerConnection({ iceServers: [] }); install(connection.createDataChannel('verified-adapter', { ordered: true }));
          await connection.setLocalDescription(await connection.createOffer()); return gathered(); },
        async answer(offer) { connection = new RTCPeerConnection({ iceServers: [] }); connection.addEventListener('datachannel', event => install(event.channel));
          await connection.setRemoteDescription(offer); await connection.setLocalDescription(await connection.createAnswer()); return gathered(); },
        async accept(answer) { await connection.setRemoteDescription(answer); },
        ready: () => !!bus,
        async acquire(interrupt = false) {
          checkpoints = await openPeerPackCheckpoints({ name: 'physical-lora-' + identity.peerId, maxBytes: 67108864 });
          const controller = new AbortController(); let requests = 0, failure = null;
          const store = await createPeerPackArtifactStore({ ...custody, requesterPrivateKey: pair.privateKey,
            checkpoints, signal: controller.signal, maxConcurrentChunks: 1,
            requestChunk: async (_peer, request, controls) => {
              if (interrupt && requests === 1) { controller.abort(new Error('Deliberate transfer interruption')); throw controller.signal.reason; }
              requests++; return bus.requestChunk(request, controls);
            } });
          try { for (const artifact of custody.authorization.artifactSet.artifacts) held.set(artifact.artifactId, await store.readArtifact(artifact)); }
          catch (error) { failure = error.message; }
          const receipt = store.getReceipt(), storage = await checkpoints.getStats(); store.close(); checkpoints.close();
          return { requests, failure, receipt, storage, held: [...held.keys()] };
        },
        disconnect() { supplier?.close(); bus?.close(); connection?.close(); },
        async execute() {
          const { createReploidDopplerRuntimeService } = await import('/infrastructure/doppler-runtime-service.js');
          const { loadLoRAFromManifest } = await import('/vendor/doppler/0.6.2/src/experimental/adapters/lora-loader.js');
          const bytes = held.get(record.id); check(bytes && await sha256Hex(bytes) === 'sha256:' + record.sha256, 'Missing verified adapter');
          const manifestText = new TextDecoder().decode(held.get('base-manifest'));
          const manifest = JSON.parse(manifestText);
          check(manifest.modelId === model.id, 'Base model file mismatch');
          const options = { weightsLayout: 'peft', readOPFS: undefined, writeOPFS: undefined,
            fetchUrl: async url => { check(url === record.runtimeManifest.weightsPath, 'Unapproved adapter dependency'); return bytes.slice().buffer; } };
          const expectedIdentity = (await loadLoRAFromManifest(record.runtimeManifest, options)).identity;
          check(expectedIdentity.schema === 'doppler.lora-execution-identity/v1' && expectedIdentity.id === record.runtimeManifest.id
            && /^sha256:[a-f0-9]{64}$/.test(expectedIdentity.digest), 'Doppler adapter execution identity missing');
          console.log('PHYSICAL loading base model');
          service = createReploidDopplerRuntimeService();
          const start = Date.now(); session = await service.open({ scope: 'physical-lora', source: { manifest, manifestText, manifestHash: model.identity, baseUrl: new URL('.', model.url).href } });
          const loadMs = Date.now() - start;
          check('sha256:' + session.manifestHash.replace(/^sha256:/, '') === model.identity, 'Runtime base artifact mismatch');
          const messages = [{ role: 'user', content: 'Extract the people, places, and dates as JSON: Alice met Bob in Paris on July 4, 2025. /no_think' }];
          const generation = { maxTokens: 32, temperature: 0, topK: 1, topP: 1, useChatTemplate: true };
          const run = async () => { await session.resetGenerationState(); return session.generate(messages, generation); };
          const base = await run();
          console.log('PHYSICAL applying transferred adapter');
          await session.loadLoRA(record.runtimeManifest, options);
          const adapted = await run();
          check(adapted.evidence.runtimeProfile.model.activeAdapterDigest === expectedIdentity.digest, 'Executed adapter tensor identity mismatch');
          await session.unloadLoRA();
          const restored = await run();
          check(restored.evidence.runtimeProfile.model.activeAdapterDigest === null && session.activeLoRA === null, 'Adapter state leaked');
          check(JSON.stringify(base.tokenIds) === JSON.stringify(restored.tokenIds), 'Unloaded base result differs');
          return { loadMs, expectedIdentity, base, adapted, restored, device: session.deviceInfo };
        },
        async close() { supplier?.close(); bus?.close(); connection?.close(); checkpoints?.close(); await service?.close('physical-lora'); }
      };
    }, { role: i === 0 ? 'source' : 'recipient', record, model });
  }
  const receiver = await recipient.evaluate(() => window.probe.identity);
  const custody = await source.evaluate(receiver => window.probe.provision(receiver), receiver);
  evidence.authorization = custody.authorization;
  await recipient.evaluate(custody => window.probe.configure(custody), custody);
  const offer = await recipient.evaluate(() => window.probe.offer());
  const answer = await source.evaluate(offer => window.probe.answer(offer), offer);
  await recipient.evaluate(answer => window.probe.accept(answer), answer);
  await Promise.all([source, recipient].map(page => page.waitForFunction(() => window.probe.ready())));
  evidence.interrupted = await recipient.evaluate(() => window.probe.acquire(true));
  if (!evidence.interrupted.failure || evidence.interrupted.storage.storedBytes !== 262144) throw new Error('Interruption checkpoint failed');
  evidence.resumed = await recipient.evaluate(() => window.probe.acquire());
  if (evidence.resumed.failure || evidence.resumed.receipt.cacheBytes !== 262144) throw new Error('Resume failed');
  await source.evaluate(() => window.probe.disconnect());
  evidence.cached = await recipient.evaluate(() => window.probe.acquire());
  if (evidence.cached.failure || evidence.cached.requests !== 0) throw new Error('Offline reuse failed');
  await writeFile(new URL('./real-lora.json', import.meta.url), JSON.stringify(evidence, null, 2));
  evidence.execution = await recipient.evaluate(() => window.probe.execute());
  evidence.ok = evidence.recipientAdapterOriginRequests === 0 && evidence.errors.length === 0;
} catch (error) { evidence.ok = false; evidence.failure = error.message; console.error(error.message); }
finally {
  await Promise.allSettled([source, recipient].map(page => page.evaluate(() => window.probe?.close())));
  evidence.sourceStable = JSON.stringify(evidence.sourceHashes) === JSON.stringify(await hashes());
  evidence.ok &&= evidence.sourceStable;
  evidence.finishedAt = new Date().toISOString();
  await writeFile(new URL('./real-lora.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ ok: evidence.ok, failure: evidence.failure, resumedBytes: evidence.resumed?.receipt.receivedBytes, cachedBytes: evidence.cached?.receipt.cacheBytes }));
process.exitCode = evidence.ok ? 0 : 1;

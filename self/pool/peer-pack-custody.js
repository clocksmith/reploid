/**
 * Peer-only dependency transport for Doppler's artifactStore port.
 * authorization is an authenticated requester/control-plane input, never a peer advert.
 * Its indexDigest pins chunk commitments to the exact Pack closure. Doppler still
 * owns Pack signature verification, final artifact verification, and verified caching.
 */
import { hashDopplerEvidence, validateExecutablePack, executablePacksMatch } from './executable-pack.js';
import { sha256Hex, signCanonical, verifyCanonicalSignature } from './inference-receipt.js';

const PREFIX = 'reploid.pool.pack-custody';
const digest = (value) => /^sha256:[0-9a-f]{64}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const clone = (value) => structuredClone(value);
const assert = (condition, message) => { if (!condition) throw new Error(`Pack custody: ${message}`); };
const unsigned = ({ signature, ...body }) => body;
const sign = async (body, key) => ({ ...body, signature: await signCanonical(body, key, { domain: body.schema }) });
const verify = async (message, key, schema) => {
  assert(message?.schema === schema, 'unexpected message schema');
  assert(await verifyCanonicalSignature(unsigned(message), key, message.signature, { domain: schema }), 'invalid signature');
};

async function context(authorization, index) {
  const grant = clone(authorization);
  const manifest = clone(index);
  assert(grant?.schema === `${PREFIX}-authorization/v1`, 'authorization is required');
  const validation = validateExecutablePack(grant.pack);
  assert(validation.ok, validation.reasons.join('; '));
  assert(await hashDopplerEvidence(grant.pack.artifacts) === grant.pack.artifactClosureDigest, 'closure mismatch');
  assert(positive(grant.attempt) && typeof grant.transferId === 'string' && grant.transferId, 'transfer identity required');
  assert(Number.isSafeInteger(grant.expiresAt), 'expiry required');
  assert(grant.requester?.peerId && grant.requester.publicKey, 'requester identity required');
  assert(Array.isArray(grant.suppliers) && grant.suppliers.length, 'authorized suppliers required');
  const peers = new Map();
  for (const peer of grant.suppliers) {
    assert(peer.peerId && peer.publicKey && !peers.has(peer.peerId), 'invalid or duplicate supplier');
    peers.set(peer.peerId, peer.publicKey);
  }
  for (const field of ['maxArtifactBytes', 'maxChunkBytes', 'maxTransferBytes', 'requestTimeoutMs']) {
    assert(positive(grant.limits?.[field]), `explicit ${field} required`);
  }
  assert(grant.limits.requestTimeoutMs <= 2147483647, 'request timeout out of range');
  assert(digest(grant.indexDigest) && await hashDopplerEvidence(manifest) === grant.indexDigest, 'unauthorized chunk index');
  assert(manifest.schema === `${PREFIX}-index/v1`
    && manifest.envelopeDigest === grant.pack.envelopeDigest
    && manifest.artifactClosureDigest === grant.pack.artifactClosureDigest, 'index Pack mismatch');
  const declaredArtifacts = [...grant.pack.artifacts];
  if (grant.envelopeArtifact !== undefined) {
    const envelope = grant.envelopeArtifact;
    assert(envelope?.role === 'pack-envelope' && typeof envelope.artifactId === 'string' && envelope.artifactId
      && typeof envelope.path === 'string' && envelope.path && digest(envelope.hash) && positive(envelope.sizeBytes)
      && !declaredArtifacts.some((artifact) => artifact.artifactId === envelope.artifactId), 'invalid authorized Pack envelope');
    declaredArtifacts.push(envelope);
  }
  assert(Array.isArray(manifest.artifacts) && manifest.artifacts.length === declaredArtifacts.length, 'index does not close Pack');
  const artifacts = new Map();
  for (const artifact of declaredArtifacts) {
    const entry = manifest.artifacts.find((item) => item.artifactId === artifact.artifactId);
    assert(entry && entry.hash === artifact.hash && entry.sizeBytes === artifact.sizeBytes, 'index artifact mismatch');
    assert(artifact.sizeBytes <= grant.limits.maxArtifactBytes && Array.isArray(entry.chunks), 'artifact limit or chunks invalid');
    let offset = 0;
    for (const [index, chunk] of entry.chunks.entries()) {
      assert(chunk.index === index && chunk.offset === offset && positive(chunk.sizeBytes)
        && chunk.sizeBytes <= grant.limits.maxChunkBytes && digest(chunk.hash), 'invalid chunk geometry or commitment');
      offset += chunk.sizeBytes;
      assert(Number.isSafeInteger(offset) && offset <= artifact.sizeBytes, 'chunk range outside artifact');
    }
    assert(offset === artifact.sizeBytes, 'incomplete chunk index');
    artifacts.set(artifact.artifactId, { artifact, chunks: entry.chunks });
  }
  return { grant, peers, artifacts, authorizationHash: await hashDopplerEvidence(grant) };
}

function checkInventory(inventory, ctx, now) {
  assert(inventory.authorizationHash === ctx.authorizationHash && ctx.peers.has(inventory.peerId), 'unauthorized inventory');
  assert(Number.isSafeInteger(inventory.expiresAt) && inventory.expiresAt > now
    && inventory.expiresAt <= ctx.grant.expiresAt, 'expired inventory');
  assert(positive(inventory.maxBytes) && inventory.maxBytes <= ctx.grant.limits.maxTransferBytes, 'inventory byte limit invalid');
  assert(Array.isArray(inventory.artifacts), 'inventory artifacts required');
  const ids = new Set();
  for (const entry of inventory.artifacts) {
    const declared = ctx.artifacts.get(entry.artifactId);
    assert(declared && !ids.has(entry.artifactId) && Array.isArray(entry.chunkIndexes), 'inventory artifact invalid');
    ids.add(entry.artifactId);
    assert(new Set(entry.chunkIndexes).size === entry.chunkIndexes.length
      && entry.chunkIndexes.every((index) => Number.isSafeInteger(index) && index >= 0 && declared.chunks[index]), 'inventory chunks invalid');
  }
}

function checkRequest(request, ctx, inventory, now) {
  checkInventory(inventory, ctx, now);
  const grant = ctx.grant;
  assert(request.authorizationHash === ctx.authorizationHash && request.transferId === grant.transferId
    && request.attempt === grant.attempt && request.requesterPeerId === grant.requester.peerId
    && request.supplierPeerId === inventory.peerId && typeof request.nonce === 'string' && request.nonce, 'request binding mismatch');
  const chunk = ctx.artifacts.get(request.artifactId)?.chunks[request.chunkIndex];
  assert(chunk && Number.isSafeInteger(request.chunkIndex) && chunk.offset === request.offset
    && chunk.sizeBytes === request.sizeBytes, 'request range mismatch');
  assert(inventory.artifacts.some((entry) => entry.artifactId === request.artifactId
    && entry.chunkIndexes.includes(request.chunkIndex)), 'chunk not advertised');
  return chunk;
}

export async function createPeerPackSupplier({ authorization, index, peerId, privateKey, inventory, readChunk, now = Date.now }) {
  const inventorySnapshot = clone(inventory);
  const ctx = await context(authorization, index);
  assert(typeof readChunk === 'function', 'readChunk port required');
  const advert = { ...inventorySnapshot, schema: `${PREFIX}-inventory/v1`, authorizationHash: ctx.authorizationHash, peerId };
  checkInventory(advert, ctx, now());
  const signedInventory = await sign(advert, privateKey);
  await verify(signedInventory, ctx.peers.get(peerId), advert.schema);
  let reservedBytes = 0;
  let closed = false;
  return {
    inventory: clone(signedInventory),
    close() { closed = true; },
    async serve(message) {
      const request = clone(message);
      assert(!closed, 'supplier closed');
      const chunk = checkRequest(request, ctx, advert, now());
      await verify(request, ctx.grant.requester.publicKey, `${PREFIX}-request/v1`);
      assert(!closed, 'supplier closed');
      checkRequest(request, ctx, advert, now());
      assert(reservedBytes + chunk.sizeBytes <= advert.maxBytes, 'supplier byte budget exhausted');
      reservedBytes += chunk.sizeBytes;
      const source = await readChunk(request.artifactId, clone(chunk));
      assert(source instanceof Uint8Array && source.byteLength === chunk.sizeBytes, 'supplier chunk size mismatch');
      const bytes = Uint8Array.from(source);
      const bytesHash = await sha256Hex(bytes);
      assert(bytesHash === chunk.hash, 'supplier chunk integrity mismatch');
      const body = await sign({ schema: `${PREFIX}-response/v1`, authorizationHash: ctx.authorizationHash,
        peerId, requestHash: await hashDopplerEvidence(unsigned(request)), bytesHash }, privateKey);
      assert(!closed, 'supplier closed');
      checkRequest(request, ctx, advert, now());
      return { message: body, bytes };
    }
  };
}

// A deadline is enforced here even when a transport ignores its AbortSignal.
async function boundedTransfer(requestChunk, peerId, request, signal, timeoutMs) {
  const controller = new AbortController();
  let timer;
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => { controller.abort(); reject(new Error('Pack custody: transfer cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      timer = setTimeout(() => { controller.abort(); reject(new Error('Pack custody: supplier timeout')); }, timeoutMs);
      Promise.resolve().then(() => {
        assert(!controller.signal.aborted, 'transfer cancelled');
        // The transport must enforce this bound while receiving/framing bytes.
        return requestChunk(peerId, request, { signal: controller.signal, maxBytes: request.sizeBytes });
      }).then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

export async function createPeerPackArtifactStore({ authorization, index, inventories, requesterPrivateKey, requestChunk, now = Date.now, signal, checkpoints = null, maxConcurrentChunks = 1 }) {
  const adverts = clone(inventories);
  const ctx = await context(authorization, index);
  assert(typeof requestChunk === 'function', 'peer transport required');
  assert(positive(maxConcurrentChunks) && maxConcurrentChunks <= (ctx.grant.limits.maxConcurrentChunks ?? 1), 'chunk concurrency exceeds authorization');
  if (checkpoints) assert(['getChunk', 'putChunk', 'deleteChunk'].every((name) => typeof checkpoints[name] === 'function'), 'checkpoint ports required');
  assert(Array.isArray(adverts), 'inventories required');
  const seen = new Set();
  for (const advert of adverts) {
    checkInventory(advert, ctx, now());
    assert(!seen.has(advert.peerId), 'duplicate supplier inventory');
    seen.add(advert.peerId);
    await verify(advert, ctx.peers.get(advert.peerId), `${PREFIX}-inventory/v1`);
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const active = () => {
    assert(!controller.signal.aborted, 'store closed or cancelled');
    assert(ctx.grant.expiresAt > now(), 'authorization expired');
    assert(receivedBytes <= ctx.grant.limits.maxTransferBytes, 'received byte budget exceeded');
  };
  const attempts = [];
  const completed = [];
  const peerBytes = new Map();
  let reservedBytes = 0;
  let receivedBytes = 0;
  let verificationBytes = 0;
  const startedAt = now();
  let cacheBytes = 0;
  let corruptCacheBytes = 0;
  let persistedBytes = 0;
  let evictedBytes = 0;
  let duplicateBytes = 0;
  let inFlightBytes = 0;
  let peakInFlightBytes = 0;
  let peakArtifactBytes = 0;
  let firstArtifactAt = null;
  const receivedHashes = new Set();
  const pending = new Map();
  // Only one artifact allocation at a time; its chunks use the authorized fanout.
  let tail = Promise.resolve();
  async function acquire(input) {
    active();
    const entry = ctx.artifacts.get(input?.artifactId);
    assert(entry && executablePacksMatch(entry.artifact, input), 'artifact outside authorized closure');
    const output = new Uint8Array(entry.artifact.sizeBytes);
    peakArtifactBytes = Math.max(peakArtifactBytes, output.length);
    const acquisition = new AbortController();
    const cancelAcquisition = () => acquisition.abort();
    controller.signal.addEventListener('abort', cancelAcquisition, { once: true });
    const current = () => { active(); assert(!acquisition.signal.aborted, 'artifact acquisition cancelled'); };
    async function acquireChunk(chunk) {
      current();
      if (checkpoints) {
        const cached = await checkpoints.getChunk(chunk, { signal: acquisition.signal });
        current();
        if (cached !== null) {
          verificationBytes += cached.byteLength;
          if (cached instanceof Uint8Array && cached.byteLength === chunk.sizeBytes && await sha256Hex(cached) === chunk.hash) {
            current();
            output.set(cached, chunk.offset);
            cacheBytes += cached.byteLength;
            return;
          }
          corruptCacheBytes += cached.byteLength;
          await checkpoints.deleteChunk(chunk, { signal: acquisition.signal });
          current();
        }
      }
      const suppliers = adverts.filter((advert) => advert.artifacts.some((item) => item.artifactId === input.artifactId
        && item.chunkIndexes.includes(chunk.index)));
      let received = false;
      for (const advert of suppliers) {
        current();
        if (advert.expiresAt <= now() || (peerBytes.get(advert.peerId) || 0) + chunk.sizeBytes > advert.maxBytes) continue;
        assert(reservedBytes + chunk.sizeBytes <= ctx.grant.limits.maxTransferBytes, 'transfer byte budget exhausted');
        reservedBytes += chunk.sizeBytes;
        peerBytes.set(advert.peerId, (peerBytes.get(advert.peerId) || 0) + chunk.sizeBytes);
        const observation = { peerId: advert.peerId, artifactId: input.artifactId, chunkIndex: chunk.index,
          reservedBytes: chunk.sizeBytes, receivedBytes: 0, status: 'pending', requestHash: null };
        attempts.push(observation);
        try {
          const request = await sign({ schema: `${PREFIX}-request/v1`, authorizationHash: ctx.authorizationHash,
            transferId: ctx.grant.transferId, attempt: ctx.grant.attempt, requesterPeerId: ctx.grant.requester.peerId,
            supplierPeerId: advert.peerId, artifactId: input.artifactId, chunkIndex: chunk.index,
            offset: chunk.offset, sizeBytes: chunk.sizeBytes, nonce: crypto.randomUUID() }, requesterPrivateKey);
          observation.requestHash = await hashDopplerEvidence(unsigned(request));
          observation.request = clone(request);
          active();
          checkInventory(advert, ctx, now());
          current();
          inFlightBytes += chunk.sizeBytes;
          peakInFlightBytes = Math.max(peakInFlightBytes, inFlightBytes);
          let response;
          try {
            response = await boundedTransfer(requestChunk, advert.peerId, request, acquisition.signal,
              Math.min(ctx.grant.limits.requestTimeoutMs, advert.expiresAt - now(), ctx.grant.expiresAt - now()));
          } finally { inFlightBytes -= chunk.sizeBytes; }
          observation.receivedBytes = response?.bytes instanceof Uint8Array ? response.bytes.byteLength : 0;
          receivedBytes += observation.receivedBytes;
          assert(response?.bytes instanceof Uint8Array && response.bytes.byteLength === chunk.sizeBytes, 'response size mismatch');
          const bytes = Uint8Array.from(response.bytes);
          const message = clone(response.message);
          observation.response = message;
          active();
          checkInventory(advert, ctx, now());
          await verify(message, ctx.peers.get(advert.peerId), `${PREFIX}-response/v1`);
          assert(message.authorizationHash === ctx.authorizationHash && message.peerId === advert.peerId
            && message.requestHash === observation.requestHash && message.bytesHash === chunk.hash, 'response binding mismatch');
          verificationBytes += bytes.byteLength;
          observation.observedBytesHash = await sha256Hex(bytes);
          assert(observation.observedBytesHash === chunk.hash, 'chunk integrity mismatch');
          active();
          checkInventory(advert, ctx, now());
          current();
          if (receivedHashes.has(chunk.hash)) duplicateBytes += bytes.length;
          receivedHashes.add(chunk.hash);
          if (checkpoints) {
            // Storage failures are visible; verified output remains usable and does
            // not trigger an unnecessary download from another supplier.
            try {
              const saved = await checkpoints.putChunk(chunk, bytes, { signal: acquisition.signal });
              persistedBytes += bytes.length;
              evictedBytes += saved?.evictedBytes || 0;
            } catch (error) { observation.checkpointError = String(error.message || error); }
            current();
          }
          output.set(bytes, chunk.offset);
          observation.status = 'accepted';
          received = true;
          break;
        } catch (error) {
          observation.status = 'rejected';
          observation.error = String(error.message || error);
          current();
        }
      }
      assert(received, `no authorized supplier completed ${input.artifactId} chunk ${chunk.index}`);
    }
    let nextChunk = 0;
    let failure = null;
    try {
      await Promise.all(Array.from({ length: Math.min(maxConcurrentChunks, entry.chunks.length) }, async () => {
        try {
          while (nextChunk < entry.chunks.length) {
            current();
            const chunk = entry.chunks[nextChunk++];
            await acquireChunk(chunk);
          }
        } catch (error) { failure ||= error; acquisition.abort(); }
      }));
      if (failure) throw failure;
      current();
    } finally {
      controller.signal.removeEventListener('abort', cancelAcquisition);
      acquisition.abort();
    }
    verificationBytes += output.byteLength;
    assert(await sha256Hex(output) === entry.artifact.hash, 'reconstructed artifact integrity mismatch');
    active();
    firstArtifactAt ??= now();
    if (!completed.some((item) => item.artifactId === input.artifactId)) {
      completed.push({ artifactId: input.artifactId, hash: entry.artifact.hash, sizeBytes: output.byteLength });
    }
    return output;
  }
  return {
    readEnvelope() {
      assert(ctx.grant.envelopeArtifact, 'no Pack envelope authorized');
      return this.readArtifact(ctx.grant.envelopeArtifact);
    },
    readArtifact(artifact) {
      const snapshot = clone(artifact);
      const key = JSON.stringify(snapshot);
      if (pending.has(key)) return pending.get(key).then((bytes) => bytes.slice());
      const task = tail.then(() => acquire(snapshot));
      pending.set(key, task);
      tail = task.catch(() => {}).finally(() => pending.delete(key));
      return task.then((bytes) => bytes.slice());
    },
    close() { cancel(); signal?.removeEventListener('abort', cancel); },
    getReceipt() {
      return clone({ schema: `${PREFIX}-receipt/v1`, authorizationHash: ctx.authorizationHash,
        transferId: ctx.grant.transferId, attempt: ctx.grant.attempt, envelopeDigest: ctx.grant.pack.envelopeDigest,
        artifactClosureDigest: ctx.grant.pack.artifactClosureDigest, indexDigest: ctx.grant.indexDigest,
        source: cacheBytes > 0 ? (receivedBytes > 0 ? 'cache-and-peer' : 'cache') : 'peer',
        reservedBytes, receivedBytes, verificationBytes, attempts, completed,
        inventories: adverts,
        cacheBytes, corruptCacheBytes, persistedBytes, evictedBytes, duplicateBytes,
        maxConcurrentChunks, peakInFlightBytes, peakArtifactBytes,
        firstArtifactMs: firstArtifactAt === null ? null : firstArtifactAt - startedAt,
        elapsedMs: now() - startedAt,
        // Retained payload accounting is not a measurement of the browser's heap.
        browserHeapBytes: null,
        // Transport framing, interrupted partial bytes, and relay traffic require
        // measurements from the transport owner. Never report unknown costs as zero.
        wireBytes: null, relayBytes: null, interruptedBytes: null });
    }
  };
}

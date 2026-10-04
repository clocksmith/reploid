/** Discovery composition for the existing signed custody store and bounded byte channel. */
export function createCustodyExchange({ transport, identity, policy, ports }) {
  policy = structuredClone(policy);
  for (const name of ['maxTransfers', 'maxPeers', 'maxAcquisitionAttempts', 'maxInventoryFiles', 'maxSupplyBytes', 'maxArtifactBytes', 'grantMs']) {
    if (!Number.isSafeInteger(policy[name]) || policy[name] <= 0) throw new Error('Invalid custody policy: ' + name);
  }
  const { createSupplier, createStore, createChannel, readArtifact, verifyArtifact, hash, hashBytes, checkpoints } = ports;
  const peers = new Map(), pending = new Map(), suppliers = new Map(), channels = new Map(), channelWaiters = new Map();
  const lifetime = new AbortController();
  const operations = new Set();
  let offered = [], supply = false, supplyEpoch = 0, reserved = 0, preparing = 0, acquiring = 0, closed = false;
  const key = artifact => JSON.stringify([artifact.path, artifact.hash, artifact.hashAlgorithm, artifact.sizeBytes]);
  const valid = artifact => artifact && typeof artifact === 'object'
    && typeof artifact.path === 'string' && /^[\w.-]+$/.test(artifact.path) && artifact.path.length <= 256
    && typeof artifact.role === 'string' && artifact.role.length <= 64
    && typeof artifact.hash === 'string' && /^[a-f0-9]{64}$/.test(artifact.hash)
    && ['sha256', 'blake3'].includes(artifact.hashAlgorithm)
    && Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes > 0 && artifact.sizeBytes <= policy.maxArtifactBytes;
  const live = () => { lifetime.signal.throwIfAborted(); };
  const connected = () => {
    const ids = new Set(transport.getConnectedPeers().map(peer => peer.id));
    for (const peer of peers.keys()) if (!ids.has(peer)) peers.delete(peer);
    return ids;
  };
  const notify = () => ports.onChange?.();
  const announce = peer => {
    const payload = { artifacts: supply ? offered : [] };
    if (peer) transport.sendToPeer(peer, 'reploid:custody-offer', payload);
    else transport.broadcast('reploid:custody-offer', payload);
  };
  const install = (peer, channel) => {
    if (closed || channels.has(peer) || channels.size >= policy.maxPeers || !connected().has(peer)) { channel.close(); return; }
    let bus;
    const ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { channel.close(); reject(new Error('Custody channel open timed out')); }, policy.channel.timeoutMs);
      const open = () => {
        clearTimeout(timeout);
        try {
          bus = createChannel({ channel, limits: policy.channel, serve: request => {
            const entry = suppliers.get(request.transferId);
            if (!supply || entry?.peer !== peer) throw new Error('File supply is not authorized');
            return entry.supplier.serve(request);
          } });
          resolve(bus);
        } catch (error) { channel.close(); reject(error); }
      };
      if (channel.readyState === 'open') open(); else channel.addEventListener('open', open, { once: true });
      channel.addEventListener('close', () => { clearTimeout(timeout); reject(new Error('Custody peer disconnected')); }, { once: true });
    });
    const entry = { ready, close: () => { bus?.close(); channel.close(); } };
    channels.set(peer, entry); ready.catch(() => {});
    channelWaiters.get(peer)?.finish(null, ready);
    channel.addEventListener('close', () => { if (channels.get(peer) === entry) channels.delete(peer); }, { once: true });
    return entry;
  };
  const channelFor = (peer, signal) => {
    signal.throwIfAborted();
    let ready = channels.get(peer)?.ready;
    // Exactly one endpoint opens the auxiliary channel, including simultaneous
    // acquisitions in opposite directions. No channel glare or replacement.
    if (!ready && identity.peerId < peer) ready = install(peer, transport.openDataChannel(peer, 'reploid-custody')).ready;
    if (!ready) {
      ready = channelWaiters.get(peer)?.ready;
      if (!ready) {
        ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('Custody channel open timed out')), policy.channel.timeoutMs);
          const finish = (error, result) => {
            clearTimeout(timer); channelWaiters.delete(peer);
            if (error) reject(error); else resolve(result);
          };
          channelWaiters.set(peer, { finish });
        });
        channelWaiters.get(peer).ready = ready;
        if (!transport.sendToPeer(peer, 'reploid:custody-request', { channel: true })) {
          channelWaiters.get(peer).finish(new Error('File peer disconnected'));
        }
      }
    }
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  const revokeSupply = () => {
    supply = false; supplyEpoch++;
    for (const entry of suppliers.values()) { clearTimeout(entry.timer); entry.supplier.close(); }
    suppliers.clear();
  };
  const stopSupply = () => { revokeSupply(); announce(); notify(); };
  const unsub = transport.onDataChannel('reploid-custody', install);
  transport.onMessage('reploid:custody-offer', (peer, message) => {
    if (closed || !Array.isArray(message?.artifacts) || message.artifacts.length > policy.maxInventoryFiles
      || !message.artifacts.every(valid)) return;
    if (!connected().has(peer) || !peers.has(peer) && peers.size >= policy.maxPeers) return;
    const first = !peers.has(peer);
    peers.set(peer, structuredClone(message.artifacts)); if (first) announce(peer); notify();
  });
  transport.onMessage('reploid:custody-response', (peer, message) => {
    const entry = pending.get(message?.id);
    if (!entry || entry.peer !== peer) return;
    entry.finish(message.error ? new Error(message.error) : null, message);
  });
  transport.onMessage('reploid:custody-request', (peer, message) => {
    if (closed) return;
    if (message?.channel === true) {
      if (identity.peerId < peer && !channels.has(peer)
        && transport.getConnectedPeers().some(item => item.id === peer)) {
        try { install(peer, transport.openDataChannel(peer, 'reploid-custody')); }
        catch (error) { ports.onError?.(error); }
      }
      return;
    }
    if (message?.release) {
      const entry = suppliers.get(message.release);
      if (entry?.peer === peer) { entry.supplier.close(); clearTimeout(entry.timer); suppliers.delete(message.release); }
      return;
    }
    const operation = (async () => {
      live();
      if (typeof message?.id !== 'string' || message.id.length > 128 || !valid(message.artifact)) throw new Error('Invalid file request');
      if (!supply || preparing + suppliers.size >= policy.maxTransfers) throw new Error('File contribution unavailable');
      const descriptor = offered.find(item => key(item) === key(message.artifact));
      if (!descriptor || message.requester?.peerId !== peer || !message.requester.publicKey) throw new Error('Unapproved artifact request');
      const selected = rangeDescriptor(descriptor, message.range);
      if (!Number.isSafeInteger(descriptor.sizeBytes) || descriptor.sizeBytes > policy.maxArtifactBytes
        || reserved + selected.sizeBytes > policy.maxSupplyBytes) throw new Error('File contribution limit reached');
      const epoch = supplyEpoch; preparing++; reserved += selected.sizeBytes;
      try {
        let bytes = await readArtifact(descriptor, { signal: lifetime.signal });
        await verifyArtifact(descriptor, bytes); live();
        if (message.range) {
          bytes = bytes.slice(message.range.offset, message.range.offset + message.range.size);
          await verifyArtifact(selected, bytes);
        }
        if (!supply || epoch !== supplyEpoch) throw new Error('File contribution stopped');
        const artifact = { artifactId: selected.path, path: selected.path, role: selected.role,
          sizeBytes: bytes.byteLength, hash: await hashBytes(bytes) };
        const artifacts = [artifact], chunks = [];
        for (let offset = 0; offset < bytes.byteLength; offset += policy.channel.maxChunkBytes) {
          const chunk = bytes.subarray(offset, offset + policy.channel.maxChunkBytes);
          chunks.push({ index: chunks.length, offset, sizeBytes: chunk.byteLength, hash: await hashBytes(chunk) });
        }
        const artifactSet = { schema: 'reploid.pool.artifact-set/v1', identity: await hash(artifacts), artifacts };
        const index = { schema: 'reploid.pool.pack-custody-index/v2', artifactSetIdentity: artifactSet.identity,
          artifacts: [{ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: artifact.sizeBytes, chunks }] };
        const authorization = { schema: 'reploid.pool.pack-custody-authorization/v2', artifactSet,
          transferId: crypto.randomUUID(), attempt: 1, expiresAt: Date.now() + policy.grantMs,
          requester: structuredClone(message.requester), suppliers: [{ peerId: identity.peerId, publicKey: identity.publicKey }],
          indexDigest: await hash(index), limits: { maxArtifactBytes: policy.maxArtifactBytes,
            maxChunkBytes: policy.channel.maxChunkBytes, maxTransferBytes: selected.sizeBytes,
            maxConcurrentChunks: policy.channel.maxPendingRequests,
            requestTimeoutMs: policy.channel.timeoutMs } };
        const supplier = await createSupplier({ authorization, index, peerId: identity.peerId, privateKey: identity.privateKey,
          inventory: { expiresAt: authorization.expiresAt, maxBytes: selected.sizeBytes,
            artifacts: [{ artifactId: artifact.artifactId, chunkIndexes: chunks.map(chunk => chunk.index) }] },
          readChunk: async (_, chunk) => bytes.slice(chunk.offset, chunk.offset + chunk.sizeBytes) });
        if (closed || !supply || epoch !== supplyEpoch) { supplier.close(); throw new Error('File contribution stopped'); }
        const timer = setTimeout(() => { supplier.close(); suppliers.delete(authorization.transferId); }, policy.grantMs);
        suppliers.set(authorization.transferId, { supplier, peer, timer });
        transport.sendToPeer(peer, 'reploid:custody-response', { id: message.id, authorization, index, inventory: supplier.inventory });
      } finally { preparing--; notify(); }
    })().catch(error => {
      if (!closed) transport.sendToPeer(peer, 'reploid:custody-response', { id: message?.id, error: error.message });
    });
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
  });
  const rangeDescriptor = (artifact, range) => {
    if (range == null) return artifact;
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.size)
      || range.size < 1 || range.offset + range.size > artifact.sizeBytes
      || !/^sha256:[a-f0-9]{64}$/.test(range.identity)) throw new Error('Invalid verified file range');
    return { path: `piece-${range.identity.slice(7)}.bin`, role: artifact.role,
      sizeBytes: range.size, hash: range.identity.slice(7), hashAlgorithm: 'sha256' };
  };
  const request = (peer, artifact, signal, range) => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    if (pending.size >= policy.maxTransfers) { reject(new Error('File acquisition limit reached')); return; }
    const id = crypto.randomUUID();
    const finish = (error, result) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('File offer timed out')), policy.channel.timeoutMs);
    pending.set(id, { peer, finish }); signal.addEventListener('abort', abort, { once: true });
    if (!transport.sendToPeer(peer, 'reploid:custody-request', { id, artifact, range,
      requester: { peerId: identity.peerId, publicKey: identity.publicKey } })) finish(new Error('File peer disconnected'));
  });
  const acquireFrom = async (peer, source, combined, range) => {
      const artifact = rangeDescriptor(source, range);
      const bus = await channelFor(peer, combined);
      const result = await request(peer, source, combined, range); combined.throwIfAborted();
      const grant = result.authorization, declared = grant?.artifactSet?.artifacts?.[0];
      if (grant?.artifactSet?.artifacts?.length !== 1 || declared?.path !== artifact.path || declared?.sizeBytes !== artifact.sizeBytes
        || grant.requester?.peerId !== identity.peerId || grant.requester?.publicKey !== identity.publicKey
        || grant.suppliers?.length !== 1 || grant.suppliers[0].peerId !== peer
        || grant.limits.maxArtifactBytes > policy.maxArtifactBytes || grant.limits.maxChunkBytes > policy.channel.maxChunkBytes
        || grant.limits.maxTransferBytes > artifact.sizeBytes || grant.limits.requestTimeoutMs > policy.channel.timeoutMs
        || grant.expiresAt > Date.now() + policy.grantMs) throw new Error('File grant exceeds requested acquisition');
      let store;
      try {
        store = await createStore({ authorization: grant, index: result.index, inventories: [result.inventory],
          requesterPrivateKey: identity.privateKey, requestChunk: (_, message, controls) => bus.requestChunk(message, controls),
          checkpoints, signal: combined,
          maxConcurrentChunks: Math.min(grant.limits.maxConcurrentChunks ?? 1, policy.channel.maxPendingRequests) });
        const bytes = await store.readArtifact(declared);
        await verifyArtifact(artifact, bytes); combined.throwIfAborted();
        if (ports.commitArtifact) {
          try { await ports.commitArtifact(artifact, bytes, { signal: combined }); }
          catch (cause) {
            const error = new Error('Verified file could not be retained: ' + cause.message, { cause });
            error.code = 'CUSTODY_LOCAL_COMMIT_FAILED'; throw error;
          }
          // Complete verified files now own durability. Keep checkpoints only
          // for interrupted transfers, not a second copy of every model file.
          for (const chunk of result.index.artifacts[0].chunks) {
            try { await checkpoints?.deleteChunk(chunk, { signal: combined }); }
            catch (error) { ports.onError?.(error); }
          }
          combined.throwIfAborted();
        }
        ports.observe?.(store.getReceipt()); return bytes;
      } catch (error) {
        if (store) ports.observe?.({ ...store.getReceipt(), failure: error.message }); throw error;
      } finally {
        store?.close(); transport.sendToPeer(peer, 'reploid:custody-request', { release: grant.transferId });
      }
  };
  const candidates = artifact => {
    const ids = connected();
    return [...peers.entries()].filter(([peer, files]) => ids.has(peer) && files.some(item => key(item) === key(artifact)))
      .map(([peer]) => peer).slice(0, policy.maxAcquisitionAttempts);
  };
  return Object.freeze({
    announce,
    getState: () => { connected(); return { sharing: supply, suppliedBytes: reserved, pending: acquiring, peers: [...peers.keys()] }; },
    has: artifact => candidates(artifact).length > 0,
    offer(artifacts) {
      if (!Array.isArray(artifacts) || artifacts.length > policy.maxInventoryFiles || !artifacts.every(valid)) throw new Error('Invalid file inventory');
      live();
      const replacement = structuredClone(artifacts);
      // Revoke old grants, but publish only the complete replacement. A transient
      // empty inventory can make peers reject acquisition of a still-offered file.
      revokeSupply(); offered = replacement; reserved = 0; supply = true; announce(); notify();
    },
    stopSupply,
    async acquire(artifact, { signal, range = null }) {
      live();
      if (!valid(artifact)) throw new Error('Invalid file acquisition');
      range = range == null ? null : structuredClone(range);
      rangeDescriptor(artifact, range);
      if (acquiring >= policy.maxTransfers) throw new Error('File acquisition limit reached');
      const combined = AbortSignal.any([lifetime.signal, signal]);
      combined.throwIfAborted();
      const descriptor = structuredClone(artifact), eligible = candidates(descriptor);
      if (!eligible.length) throw new Error('No authorized peer offers this file');
      acquiring++;
      const operation = (async () => {
        const failures = [];
        for (const peer of eligible) {
          combined.throwIfAborted();
          try { return await acquireFrom(peer, descriptor, combined, range); }
          catch (error) {
            combined.throwIfAborted();
            if (error.code === 'CUSTODY_LOCAL_COMMIT_FAILED') throw error;
            failures.push(error);
          }
        }
        if (failures.length === 1) throw failures[0];
        throw new AggregateError(failures, 'Available file suppliers failed: ' + failures.map(error => error.message).join('; '));
      })();
      operations.add(operation); notify();
      try { return await operation; }
      finally { acquiring--; operations.delete(operation); notify(); }
    },
    close() {
      if (closed) return Promise.allSettled([...operations]);
      closed = true; stopSupply(); lifetime.abort(new Error('File exchange closed')); unsub();
      for (const entry of pending.values()) entry.finish(lifetime.signal.reason);
      for (const entry of channelWaiters.values()) entry.finish(lifetime.signal.reason);
      for (const channel of channels.values()) channel.close();
      peers.clear(); channels.clear();
      return Promise.allSettled([...operations]);
    }
  });
}

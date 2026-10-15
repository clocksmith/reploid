import { resolvePartitionArtifactSource } from '../self/host/work-partition-artifact-source.js';
/** Filesystem host ports for the existing signed custody protocol. No origin downloads. */
import fs from 'node:fs/promises';
import { openNativeSupplyBudget } from './native-supply-budget.js';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCustodyExchange, createCustodyContracts, createPieceAcquisition } from '../packages/reploid/src/artifacts/custody/runtime.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex, signCanonical, verifyCanonicalSignature } from '../packages/reploid/src/artifacts/signatures.js';
import { createPeerPackDataChannel } from '../self/pool/peer-pack-data-channel.js';
import { hashDopplerEvidence, validateExecutablePack, executablePacksMatch } from '../self/pool/executable-pack.js';
import policy from '../self/config/chat-files.json' with { type: 'json' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const key = file => { assert(file.hashAlgorithm === 'sha256' && /^[a-f0-9]{64}$/.test(file.hash), 'Pinned SHA-256 file required'); return 'sha256-' + file.hash; };
const verify = async (file, bytes) => {
  assert(bytes instanceof Uint8Array && bytes.byteLength === file.sizeBytes && bytes.byteLength <= policy.maxArtifactBytes,
    'Native artifact size mismatch');
  assert(digest(bytes) === file.hash, 'Native artifact integrity mismatch');
};
const pieceFile = piece => ({ path: `piece-${piece.identity.slice(7)}.bin`, role: 'model-weights',
  hashAlgorithm: 'sha256', hash: piece.identity.slice(7), sizeBytes: piece.size });

/** Complete verified pieces survive interruption. Temporary replacements never advertise. */
export async function createNativeArtifactCache({ directory, maxBytes = policy.maxStoredBytes }) {
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, 'Explicit cache budget required');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await fs.realpath(directory); let writing = Promise.resolve(); const quarantined = [];
  const get = async file => {
    let handle;
    try {
      handle = await fs.open(path.join(root, key(file)), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat(); assert(stat.isFile(), 'Native cache entry must be a regular file');
      if (stat.size !== file.sizeBytes || stat.size > policy.maxArtifactBytes) throw Object.assign(new Error('Native cache size mismatch'), { code: 'NATIVE_CACHE_CORRUPT' });
      const bytes = new Uint8Array(await handle.readFile());
      if (digest(bytes) !== file.hash) throw Object.assign(new Error('Native cache integrity mismatch'), { code: 'NATIVE_CACHE_CORRUPT' });
      return bytes;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code !== 'NATIVE_CACHE_CORRUPT') throw error;
      await handle?.close(); handle = null;
      const name = key(file) + '.corrupt.' + crypto.randomUUID();
      await fs.rename(path.join(root, key(file)), path.join(root, name));
      quarantined.push({ name, expectedHash: file.hash, reason: error.message }); return null;
    } finally { await handle?.close(); }
  };
  const put = (file, bytes, { signal } = {}) => {
    const operation = writing.catch(() => {}).then(async () => {
      signal?.throwIfAborted(); await verify(file, bytes);
      if (await get(file)) return;
      let used = 0;
      for (const name of await fs.readdir(root)) {
        const info = await fs.lstat(path.join(root, name));
        assert(!info.isSymbolicLink(), 'Native cache cannot contain symbolic links'); used += info.size;
      }
      assert(used + bytes.byteLength <= maxBytes, 'Native artifact cache budget exhausted');
      const temporary = path.join(root, key(file) + '.' + crypto.randomUUID() + '.tmp');
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
        signal?.throwIfAborted(); await fs.rename(temporary, path.join(root, key(file)));
      } finally { await handle?.close(); await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    });
    writing = operation; return operation;
  };
  return Object.freeze({ get, put, getState: () => ({ quarantined: structuredClone(quarantined) }), close: () => writing });
}

/** `owner` is the optional native owner gate (server/native-owner/controls.js). Without
 * it, channels, supply admission and acquisition deadlines are exactly as before. */
export async function createNativeModelFiles({ transport, modelDirectory, cacheDirectory, onChange = () => {}, owner = null }) {
  const root = await fs.realpath(modelDirectory), cache = await createNativeArtifactCache({ directory: cacheDirectory });
  let budget = null, budgetError = null;
  try { budget = await openNativeSupplyBudget({ directory: cacheDirectory, maxBytes: policy.maxSupplyBytes }); }
  catch (error) { budgetError = error; }
  const supplyBudget = { getState: () => budget?.getState() || null,
    reserve: bytes => { if (!budget) throw budgetError; return budget.reserve(bytes); } };
  const pair = await createSigningKeyPair(), lifetime = new AbortController(), sources = new Set();
  const receipts = [], retained = new Map(), operations = new Set(), offeredFiles = new Map();
  let closed = false, shareController = null, closing = null, suppliedModel = null;
  const own = operation => { operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {}); return operation; };
  const readLocal = async (name, { offset, size, signal } = {}) => {
    signal?.throwIfAborted(); assert(/^[\w.-]+$/.test(name), 'Plain model filename required');
    let handle;
    try {
      const filename = await fs.realpath(path.join(root, name));
      assert(path.dirname(filename) === root, 'Model file escapes approved directory');
      handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat(); assert(stat.isFile(), 'Regular model file required');
      if (offset === undefined) { assert(stat.size <= policy.maxArtifactBytes, 'Native file exceeds artifact budget'); return new Uint8Array(await handle.readFile()); }
      assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(size) && size > 0
        && size <= policy.maxArtifactBytes && offset + size <= stat.size, 'Invalid assigned model piece');
      const bytes = new Uint8Array(size); let received = 0;
      while (received < size) { signal?.throwIfAborted(); const part = await handle.read(bytes, received, size - received, offset + received);
        assert(part.bytesRead > 0, 'Truncated model piece'); received += part.bytesRead; }
      return bytes;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { await handle?.close(); }
  };
  const observe = receipt => { receipts.push(receipt); if (receipts.length > policy.maxReceipts) receipts.shift(); onChange(); };
  const contracts = createCustodyContracts({ hashDopplerEvidence, validateExecutablePack, executablePacksMatch, sha256Hex, signCanonical, verifyCanonicalSignature });
  const exchange = createCustodyExchange({ transport, identity: { peerId: transport._getPeerId(),
    publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey }, policy, ports: { supplyBudget,
    createSupplier: contracts.createPeerPackSupplier, createStore: contracts.createPeerPackArtifactStore,
    createChannel: owner ? owner.paceChannel(createPeerPackDataChannel) : createPeerPackDataChannel,
    ...(owner ? { admitSupply: request => owner.admitSupply(request) } : {}), hash: hashDopplerEvidence, hashBytes: sha256Hex,
    readArtifact: async file => { const bytes = await cache.get(file); assert(bytes, 'Advertised native bytes are unavailable'); return bytes; },
    verifyArtifact: verify, commitArtifact: (file, bytes, controls) => cache.put(file, bytes, controls), observe, onChange
  } });
  const readAvailableMetadata = async (file, signal) => {
    signal.throwIfAborted(); let bytes = await cache.get(file);
    // Capsule metadata paths are logical names, not paths inside the weight directory.
    if (!bytes && /^[a-zA-Z0-9_.-]+$/.test(file.path)) bytes = await readLocal(file.path, { signal });
    if (!bytes && /^\/config\/model-(manifests|pieces|artifacts)\/[a-zA-Z0-9_.-]+$/.test(file.url || '')) {
      bytes = new Uint8Array(await fs.readFile(new URL('../self' + file.url, import.meta.url)));
    }
    return bytes;
  };
  const readMetadata = async (file, signal) => {
    let bytes = await readAvailableMetadata(file, signal);
    if (!bytes) {
      assert(exchange.has(file), 'No authorized peer offers required model metadata'); bytes = await exchange.acquire(file, { signal });
    }
    await verify(file, bytes); signal.throwIfAborted(); await cache.put(file, bytes, { signal }); retained.set(key(file), file); return bytes;
  };
  const metadata = async (model, signal) => {
    const manifestFile = model.source.files.find(file => file.path === 'manifest.json');
    const indexFile = model.source.files.find(file => file.role === 'model-piece-index');
    assert(manifestFile && 'sha256:' + manifestFile.hash === model.identity && indexFile, 'Pinned manifest and piece index required');
    const manifestBytes = await readMetadata(manifestFile, signal), indexBytes = await readMetadata(indexFile, signal);
    const runtime = await import('doppler-gpu/partitions');
    // Doppler validates the index closure before any piece is offered or read.
    const checked = await runtime.createVerifiedPieceStorage({ manifestBytes, indexBytes, indexIdentity: 'sha256:' + indexFile.hash,
      signal, acquire: () => { throw new Error('Metadata validation cannot acquire weights'); } });
    await checked.storage.close();
    return { runtime, manifestBytes, indexBytes, indexIdentity: 'sha256:' + indexFile.hash, manifest: checked.manifest,
      index: JSON.parse(new TextDecoder().decode(indexBytes)) };
  };
  const getState = ({ includeReceipts = true } = {}) => ({ ...exchange.getState(), cache: cache.getState(),
    supplyBudgetError: budgetError && { code: budgetError.code || 'CUSTODY_BUDGET_STORAGE', message: budgetError.message },
    retainedFiles: retained.size, receiptCount: receipts.length,
    ...(includeReceipts ? { receipts: structuredClone(receipts) } : {}) });
  exchange.announce();
  return Object.freeze({ getState, announce: () => exchange.announce(),
    preparePartitionSource(model, { signal } = {}) { return own((async () => {
      signal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
      const data = await metadata(model, signal), descriptors = new Map(); signal.throwIfAborted();
      for (const file of data.index.files) for (const piece of file.pieces) descriptors.set(piece.identity, { ...piece, path: file.path });
      const acquisition = createPieceAcquisition({
        limits: { maxConcurrent: policy.maxPieceAcquisitions, maxQueued: policy.maxQueuedPieceAcquisitions,
          maxPieceBytes: policy.maxArtifactBytes,
          timeoutMs: owner ? owner.pieceTimeoutMs(policy.channel.timeoutMs, policy.maxArtifactBytes) : policy.channel.timeoutMs },
        cache: { get: id => cache.get(pieceFile(descriptors.get(id))),
          put: async (id, bytes) => {
            const file = pieceFile(descriptors.get(id)); await cache.put(file, bytes, { signal }); retained.set(key(file), file);
            if (!closed && suppliedModel === model.identity) {
              assert(offeredFiles.has(key(file)) || offeredFiles.size < policy.maxInventoryFiles, 'Native inventory limit exceeded');
              offeredFiles.set(key(file), file); exchange.offer([...offeredFiles.values()]);
            }
          } },
        authorize: async () => !signal.aborted, foregroundIdle: async current => current.throwIfAborted(),
        verify: async (piece, bytes) => bytes.byteLength === piece.size && 'sha256:' + digest(bytes) === piece.identity,
        sources: piece => [
          { id: 'approved-local-directory', read: async (_, controls) => {
            const bytes = await readLocal(piece.path, { ...piece, signal: controls.signal }); assert(bytes, 'Assigned piece absent locally'); return bytes;
          } },
          { id: 'authorized-custody-peers', read: async (_, controls) => {
            const file = pieceFile(piece);
            if (exchange.has(file)) return exchange.acquire(file, controls);
            const shard = data.manifest.shards.find(row => row.filename === piece.path);
            const whole = shard ? { path: shard.filename, role: 'model-weights', sizeBytes: shard.size, hash: shard.hash, hashAlgorithm: data.manifest.hashAlgorithm }
              : model.source.files.find(file => file.path === piece.path);
            assert(whole, 'Piece is outside pinned model files');
            assert(exchange.has(whole), 'No peer offers the assigned verified piece');
            return exchange.acquire(whole, { ...controls, range: { offset: piece.offset, size: piece.size, identity: piece.identity } });
          } }
        ] });
      const abort = () => { acquisition.close().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      let opened;
      try {
        opened = await data.runtime.createVerifiedPieceStorage({ ...data, signal,
          acquire: (piece, controls) => acquisition.acquire(piece, controls) });
      } catch (error) {
        signal.removeEventListener('abort', abort);
        try { await acquisition.close(); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Native source opening and cleanup failed'); }
        throw error;
      }
      let sourceClosed = false;
      const admittedFile = artifact => {
        assert(!sourceClosed && !closed, 'Partition artifact source is closed');
        return resolvePartitionArtifactSource(model, data.manifest, model.source.files, artifact);
      };
      const artifactStore = Object.freeze({
        async readArtifact(artifact, controls = {}) {
          const file = admittedFile(artifact);
          assert(!data.manifest.shards.some(row => row.filename === file.path), 'Native weights require complete pinned piece ranges');
          return readMetadata(file, AbortSignal.any([signal, controls.signal].filter(Boolean)));
        },
        async readArtifactRange(artifact, offset, size, controls = {}) {
          const file = admittedFile(artifact);
          const piece = data.index.files.find(row => row.path === file.path)?.pieces
            .find(piece => piece.offset === offset && piece.size === size);
          assert(piece, 'Capsule range is not a complete pinned piece');
          return acquisition.acquire({ ...piece, path: file.path }, {
            ...controls, signal: AbortSignal.any([signal, controls.signal].filter(Boolean)) });
        }
      });
      const source = { manifest: opened.manifest, artifactStore,
        storage: { ...opened.storage, async close() {
          sourceClosed = true;
          signal.removeEventListener('abort', abort);
          try {
            const settled = await Promise.allSettled([Promise.resolve().then(() => acquisition.close()), Promise.resolve().then(() => opened.storage.close())]);
            const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason);
            if (failures.length) throw new AggregateError(failures, 'Native partition source cleanup failed');
          } finally { sources.delete(source); }
        } }, getReceipt: () => ({ ...opened.getReceipt(), custody: acquisition.getReceipt() }) };
      sources.add(source); return source;
    })()); },
    share(model, approved) { return own((async () => {
      assert(approved === true && !closed, 'Approve file contribution separately from compute');
      if (budgetError) throw budgetError;
      assert(!shareController, 'File inventory preparation already active');
      const controller = new AbortController(); shareController = controller;
      const signal = AbortSignal.any([lifetime.signal, controller.signal]);
      try {
        const data = await metadata(model, signal), offered = [];
        for (const file of model.source.files) {
          // Program/evidence metadata ships in the application. Custody offers
          // manifest-local model files and verified pieces, never nested program paths.
          if (!/^[a-zA-Z0-9_.-]+$/.test(file.path)) continue;
          const bytes = await readAvailableMetadata(file, signal);
          if (bytes) { await verify(file, bytes); await cache.put(file, bytes, { signal }); offered.push(file); }
        }
        for (const file of data.index.files) for (const piece of file.pieces) {
          signal.throwIfAborted(); const descriptor = pieceFile(piece);
          const bytes = await cache.get(descriptor) || await readLocal(file.path, { ...piece, signal });
          if (!bytes) continue;
          await verify(descriptor, bytes); await cache.put(descriptor, bytes, { signal });
          offered.push(descriptor); assert(offered.length <= policy.maxInventoryFiles, 'Native inventory limit exceeded');
        }
        signal.throwIfAborted(); offeredFiles.clear();
        for (const file of offered) offeredFiles.set(key(file), file);
        suppliedModel = model.identity; exchange.offer(offered); return getState();
      } finally { if (shareController === controller) shareController = null; }
    })()); },
    stopSupply() { suppliedModel = null; offeredFiles.clear(); shareController?.abort(new Error('Native file contribution stopped')); exchange.stopSupply(); },
    close() { return closing ||= (async () => {
      closed = true; suppliedModel = null; offeredFiles.clear(); lifetime.abort(new Error('Native file host closed')); exchange.stopSupply();
      await Promise.allSettled([...operations]);
      const settled = await Promise.allSettled([...sources].map(source => Promise.resolve().then(() => source.storage.close()))
        .concat([Promise.resolve().then(() => exchange.close()), Promise.resolve().then(() => cache.close()), Promise.resolve().then(() => budget?.close())]));
      const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Native artifact source cleanup failed');
    })(); }
  });
}

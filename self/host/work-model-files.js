/** Host grants and pinned catalog composition for the library's signed artifact custody. */
import { createCustodyExchange } from '../vendor/reploid/artifacts/custody/exchange.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../pool/peer-pack-data-channel.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../pool/inference-receipt.js';
import { hashDopplerEvidence } from '../pool/executable-pack.js';
import { openPeerPackFileCheckpoints } from '../infrastructure/pack-transfer-storage.js';
import { DOPPLER_MODULE_URL, DOPPLER_STORAGE_TOOLING_URL, LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import policy from '../config/chat-files.json' with { type: 'json' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createWorkModelFiles({ getTransport, onChange = () => {}, fetchImpl = globalThis.fetch }) {
  let exchange = null, checkpoints = null, attaching = null, closed = false, preparing = false;
  let directory = null, tooling = null, storageFactory = null, lastFile = null, error = '', progress = null;
  const pinned = new Set(), lastUsed = new Map();
  let supplyController = null;
  const lifetime = new AbortController(), operations = new Set(), receipts = [];
  const own = operation => {
    operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {}); return operation;
  };
  const getState = () => ({ ...(exchange?.getState() || { sharing: false, suppliedBytes: 0, pending: 0, peers: [] }),
    preparing, error, progress: structuredClone(progress), receivedBytes: receipts.reduce((sum, item) => sum + item.receivedBytes, 0),
    verifiedFiles: receipts.flatMap(item => item.completed || []).map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })),
    limits: { storedBytes: policy.maxStoredBytes, supplyBytes: policy.maxSupplyBytes } });
  const notify = () => onChange(getState());
  const tools = async () => {
    tooling ||= await import(globalThis.REPLOID_DOPPLER_STORAGE_MODULE_URL || DOPPLER_STORAGE_TOOLING_URL);
    return tooling;
  };
  const check = async (file, bytes) => {
    assert(['sha256', 'blake3'].includes(file.hashAlgorithm) && /^[a-f0-9]{64}$/.test(file.hash), 'Exact file identity required');
    assert(bytes instanceof Uint8Array && bytes.byteLength === file.sizeBytes && bytes.byteLength <= policy.maxArtifactBytes, 'Model file size mismatch');
    assert(await (await tools()).computeHash(bytes, file.hashAlgorithm) === file.hash, 'Model file integrity mismatch');
  };
  const root = async () => {
    directory ||= await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1', { create: true });
    return directory;
  };
  const fileKey = file => file.hashAlgorithm + '-' + file.hash;
  const cached = async file => {
    try {
      const handle = await (await root()).getFileHandle(fileKey(file));
      const blob = await handle.getFile();
      assert(blob.size === file.sizeBytes, 'Cached model file size mismatch');
      const bytes = new Uint8Array(await blob.arrayBuffer()); await check(file, bytes); return bytes;
    } catch (cause) { if (cause.name === 'NotFoundError') return null; throw cause; }
  };
  const persist = (file, bytes, signal) => navigator.locks.request('reploid-chat-artifacts-v1:write', { signal }, async () => {
    signal.throwIfAborted();
    const folder = await root(), key = fileKey(file), entries = []; let used = 0;
    for await (const [name, handle] of folder.entries()) if (handle.kind === 'file') {
      const stored = await handle.getFile(); used += stored.size;
      entries.push({ name, size: stored.size, touched: lastUsed.get(name) || stored.lastModified });
    }
    const estimate = await navigator.storage.estimate();
    // The estimate already includes current staging. Reserve its maximum once,
    // plus the temporary copy made by an atomic artifact replacement.
    const staged = checkpoints ? (await checkpoints.getStats()).storedBytes : 0;
    const remaining = estimate.quota - Math.max(0, estimate.usage - used - staged)
      - policy.maxCheckpointBytes - policy.maxArtifactBytes;
    const budget = Math.min(policy.maxStoredBytes, Number.isFinite(remaining) ? Math.max(0, remaining) : policy.maxStoredBytes);
    const previous = entries.find(entry => entry.name === key)?.size || 0;
    const evictable = entries.filter(entry => entry.name !== key && !pinned.has(entry.name))
      .sort((a, b) => a.touched - b.touched || a.name.localeCompare(b.name));
    const evict = async () => {
      const entry = evictable.shift();
      if (!entry) return false;
      signal.throwIfAborted(); await folder.removeEntry(entry.name);
      lastUsed.delete(entry.name); used -= entry.size;
      return true;
    };
    while (used - previous + bytes.byteLength > budget && await evict()) { /* Evict only reusable, unpromised cache files. */ }
    assert(used - previous + bytes.byteLength <= budget, 'Insufficient browser storage for this file and transfer staging. Stop file sharing or free storage.');
    for (let attempts = evictable.length + 1; attempts > 0; attempts--) {
      signal.throwIfAborted();
      const handle = await folder.getFileHandle(key, { create: true });
      let writer;
      try {
        writer = await handle.createWritable(); await writer.write(bytes); signal.throwIfAborted(); await writer.close();
        lastUsed.set(key, Date.now()); return;
      } catch (cause) {
        await writer?.abort().catch(() => {});
        // The quota is an estimate and can shrink after reservation.
        if (cause.name !== 'QuotaExceededError' || !await evict()) throw cause;
      }
    }
    throw new Error('Model file storage attempts exhausted');
  });
  const origin = async (file, signal, onProgress) => {
    const response = await fetchImpl(file.url, { signal });
    assert(response.ok, `Model file acquisition HTTP ${response.status}`);
    const reader = response.body.getReader(), bytes = new Uint8Array(file.sizeBytes); let offset = 0;
    try {
      while (offset <= bytes.byteLength) {
        const { done, value } = await reader.read(); if (done) break;
        assert(value?.byteLength > 0, 'Model file stream made no progress');
        signal.throwIfAborted(); assert(offset + value.byteLength <= bytes.byteLength, 'Model file exceeds declared size');
        bytes.set(value, offset); offset += value.byteLength;
        onProgress?.({ stage: 'acquiring', path: file.path, receivedBytes: offset, totalBytes: file.sizeBytes,
          message: `Downloading ${file.path}: ${Math.floor(offset / file.sizeBytes * 100)}%` });
      }
      assert(offset === bytes.byteLength, 'Model file is truncated');
    } finally { await reader.cancel(); reader.releaseLock(); }
    return bytes;
  };
  const read = (file, controls) => own(readOwned(file, controls));
  const readOwned = async (file, { signal, originOnly = false, onProgress } = {}) => {
    signal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]); signal.throwIfAborted();
    assert(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= policy.maxArtifactBytes, 'Invalid model file allowance');
    const key = fileKey(file);
    if (lastFile?.key === key) { lastUsed.set(key, Date.now()); return lastFile.bytes; }
    // Each loader owns its cancellation; it never borrows an unrelated transfer's signal.
    const existing = await cached(file);
    const peer = exchange?.has(file) && !originOnly;
    onProgress?.({ stage: 'acquiring', path: file.path, message: `${existing ? 'Reusing' : peer ? 'Receiving from peers:' : 'Downloading'} ${file.path}` });
    const bytes = existing || (peer ? await exchange.acquire(file, { signal }) : await origin(file, signal, onProgress));
    if (!existing && !peer) { await check(file, bytes); signal.throwIfAborted(); await persist(file, bytes, signal); }
    signal.throwIfAborted();
    lastUsed.set(key, Date.now()); lastFile = { key, bytes }; return bytes;
  };
  const adapterFile = adapter => ({ ...adapter.artifact, hash: adapter.artifact.hash.replace(/^sha256:/, ''), hashAlgorithm: 'sha256' });
  const modelFiles = async (model, signal, onProgress) => {
    const pinned = LOCAL_DOPPLER_MODELS.find(item => item.id === model.id && item.identity === model.identity);
    assert(pinned?.source, 'Verified model source is not in the catalog');
    const files = pinned.source.files.map(file => ({ ...file, url: new URL(file.path, pinned.source.baseUrl).href }));
    const manifestFile = files.find(file => file.path === 'manifest.json');
    assert('sha256:' + manifestFile.hash === model.identity, 'Catalog manifest identity mismatch');
    const manifestText = decoder.decode(await read(manifestFile, { signal, onProgress })), manifest = JSON.parse(manifestText);
    assert(manifest.modelId === model.id && !manifest.weightsRef, 'Model source requires an exact self-contained manifest');
    for (const shard of manifest.shards) {
      assert(/^[\w.-]+$/.test(shard.filename), 'Invalid model shard path');
      files.push({ path: shard.filename, role: 'model-weights', sizeBytes: shard.size,
        hash: shard.hash, hashAlgorithm: manifest.hashAlgorithm, url: new URL(shard.filename, pinned.source.baseUrl).href });
    }
    assert(files.some(file => file.path === manifest.tokenizer.file), 'Tokenizer is not pinned by the catalog');
    return { manifest, manifestText, files };
  };
  const attach = () => {
    if (exchange) return Promise.resolve();
    if (attaching) return attaching;
    assert(!closed, 'File exchange is closed');
    attaching = (async () => {
      const transport = getTransport(); assert(transport?.onDataChannel, 'WebRTC custody transport unavailable');
      const pair = await createSigningKeyPair();
      checkpoints = await openPeerPackFileCheckpoints({ maxBytes: policy.maxCheckpointBytes });
      const identity = { peerId: transport._getPeerId(), publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey };
      lifetime.signal.throwIfAborted();
      exchange = createCustodyExchange({ transport, identity, policy, ports: {
        createSupplier: createPeerPackSupplier, createStore: createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
        readArtifact: (file, controls) => read(file, { ...controls, originOnly: true }), verifyArtifact: check,
        commitArtifact: (file, bytes, { signal }) => persist(file, bytes, signal),
        hash: hashDopplerEvidence, hashBytes: sha256Hex, checkpoints, onChange: notify,
        observe: receipt => { receipts.push(receipt); if (receipts.length > policy.maxReceipts) receipts.shift(); }
      } });
      exchange.announce();
    })().finally(() => { attaching = null; });
    return attaching;
  };
  return Object.freeze({ getState, attach, announce: () => exchange?.announce(),
    async prepareSource(model, { signal, onProgress }) {
      const acquisition = new AbortController();
      signal = AbortSignal.any([signal, acquisition.signal]);
      const reads = new Map();
      const { manifest, manifestText, files } = await modelFiles(model, signal, onProgress);
      storageFactory ||= (await import(new URL('./storage/artifact-storage-context.js', new URL(globalThis.REPLOID_DOPPLER_MODULE_URL || DOPPLER_MODULE_URL, location.href)).href)).createArtifactStorageContext;
      const get = path => {
        const file = files.find(file => file.path === path); assert(file, 'Model requested an undeclared file'); return file;
      };
      const readFile = path => {
        const file = get(path), key = fileKey(file);
        if (!reads.has(key)) {
          const operation = read(file, { signal, onProgress }).catch(cause => { acquisition.abort(cause); throw cause; }); reads.set(key, operation);
          operation.finally(() => reads.delete(key)).catch(() => {});
        }
        return reads.get(key);
      };
      const storageContext = storageFactory({ manifest, expectedFormat: 'rdrr', verifyHashes: true,
        async readRange(path, offset, length) {
          const bytes = await readFile(path);
          assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= bytes.byteLength, 'Model range outside verified file');
          return bytes.slice(offset, offset + length).buffer;
        },
        async readText(path) { return decoder.decode(await readFile(path)); },
        async readBinary(path) { return (await readFile(path)).slice().buffer; }
      });
      return { manifest, manifestText, manifestHash: model.identity, storageContext };
    },
    acquireAdapter: (artifact, controls) => read({ ...artifact, hash: artifact.hash.replace(/^sha256:/, ''), hashAlgorithm: 'sha256' }, controls),
    async share(model, approved) {
      assert(approved === true, 'Approve distributing model files separately from compute');
      assert(!preparing, 'File contribution is already preparing');
      preparing = true; error = ''; supplyController = new AbortController();
      const signal = AbortSignal.any([lifetime.signal, supplyController.signal]); notify();
      const onProgress = value => { progress = value; notify(); };
      try {
        await attach(); signal.throwIfAborted();
        const { files } = await modelFiles(model, signal, onProgress);
        files.push(...(model.adapters || []).map(adapterFile));
        for (const file of files) pinned.add(fileKey(file));
        // The explicit file contribution prepares its bounded inventory, not strangers' prompts.
        for (const file of files) await read(file, { signal, originOnly: true, onProgress });
        signal.throwIfAborted(); exchange.offer(files);
      } catch (cause) { pinned.clear(); error = cause.message; throw cause; }
      finally { preparing = false; progress = null; notify(); }
    },
    stop() { supplyController?.abort(new Error('File contribution stopped')); exchange?.stopSupply(); pinned.clear(); notify(); },
    getReceipts: () => structuredClone(receipts),
    async close() {
      closed = true; lifetime.abort(new Error('File exchange closed')); const retiring = exchange?.close();
      await attaching?.catch(() => {}); await exchange?.close(); await retiring;
      await Promise.allSettled([...operations]);
      checkpoints?.close(); exchange = null; lastFile = null;
    }
  });
}

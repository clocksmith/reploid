import { resolvePartitionArtifactSource } from './work-partition-artifact-source.js';
/** Host grants and pinned catalog composition for the library's signed artifact custody. */
import { createCustodyExchange } from '../vendor/reploid/artifacts/custody/exchange.js';
import { createPeerPackSupplier, createPeerPackArtifactStore } from '../pool/peer-pack-custody.js';
import { createPeerPackDataChannel } from '../pool/peer-pack-data-channel.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex } from '../pool/inference-receipt.js';
import { hashDopplerEvidence } from '../pool/executable-pack.js';
import { openBrowserSupplyBudget, openBrowserAcquisitionBudget } from '../infrastructure/custody-supply-budget.js';
import { openPeerPackFileCheckpoints } from '../infrastructure/pack-transfer-storage.js';
import { DOPPLER_MODULE_URL, DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_STORAGE_TOOLING_URL, LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import policy from '../config/chat-files.json' with { type: 'json' };

export const getFileContributionLimits = () => ({ storedBytes: policy.maxStoredBytes, supplyBytes: policy.maxSupplyBytes, downloadBytes: policy.defaultAcquisitionBytes, maxDownloadBytes: policy.maxAcquisitionBytes, subsetBytes: policy.maxSubsetBytes });

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createWorkModelFiles({ getTransport, onChange = () => {}, fetchImpl = globalThis.fetch }) {
  let exchange = null, checkpoints = null, attaching = null, closed = false, preparing = false, stopping = false;
  let directory = null, tooling = null, storageFactory = null, lastFile = null, error = '', progress = null;
  const pieceWaiters = [];
  let activePieces = 0;
  const pinned = new Set(), lastUsed = new Map();
  const storageOperations = new Set();
  let acquisitionBudget = null, acquisitionOpening = null, acquisitionRead = null, acquisitionError = null, sharingMode = null;
  let supplyController = null, sharedModel = null, budget = null, budgetOpening = null, budgetError = null;
  const supplyBudget = { getState: () => budget?.getState() || null,
    reserve(bytes) { if (!budget) throw budgetError || new Error('Persistent file contribution budget unavailable'); return budget.reserve(bytes); } };
  const prepareBudget = folder => budgetOpening ||= (async () => {
    try {
      let empty = true;
      for await (const entry of folder.entries()) { empty = false; break; }
      budget = await openBrowserSupplyBudget({ maxBytes: policy.maxSupplyBytes, allowInitialize: empty });
      if (closed) budget.close();
    } catch (cause) { budgetError = cause; }
  })();
  const lifetime = new AbortController(), operations = new Set(), receipts = [];
  const own = operation => {
    operations.add(operation); operation.finally(() => operations.delete(operation)).catch(() => {}); return operation;
  };
  const ownStorage = operation => {
    storageOperations.add(operation);
    operation.finally(() => storageOperations.delete(operation)).catch(() => {});
    return own(operation);
  };
  const reserveDownload = async bytes => {
    assert(acquisitionBudget, 'Approved download allowance is unavailable');
    await acquisitionBudget.reserve(bytes); notify();
  };
  const acquirePieceSlot = signal => new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const release = () => {
      activePieces--;
      pieceWaiters.shift()?.start();
    };
    const waiter = {
      start() { signal.removeEventListener('abort', abort); activePieces++; resolve(release); }
    };
    const abort = () => {
      const index = pieceWaiters.indexOf(waiter);
      if (index >= 0) pieceWaiters.splice(index, 1);
      reject(signal.reason);
    };
    if (activePieces < policy.maxPieceAcquisitions) waiter.start();
    else {
      assert(pieceWaiters.length < policy.maxQueuedPieceAcquisitions, 'Assigned piece acquisition queue is full');
      pieceWaiters.push(waiter); signal.addEventListener('abort', abort, { once: true });
    }
  });
  const getState = () => ({ ...(exchange?.getState() || { sharing: false, suppliedBytes: 0, pending: 0, peers: [] }),
    model: sharedModel && { ...sharedModel }, mode: sharingMode, acquisitionBudget: acquisitionBudget?.getState() || null,
    acquisitionBudgetError: acquisitionError && { code: acquisitionError.code, message: acquisitionError.message },
    supplyBudgetError: budgetError && { code: budgetError.code || 'CUSTODY_BUDGET_STORAGE', message: budgetError.message },
    preparing, stopping, error, progress: structuredClone(progress), receivedBytes: receipts.reduce((sum, item) => sum + item.receivedBytes, 0),
    verifiedFiles: receipts.flatMap(item => item.completed || []).map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })),
    limits: getFileContributionLimits() });
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
    // A cache may disappear while its old handle remains alive. Resolve the
    // current namespace before each operation, including reacquisition writes.
    const namespace = await navigator.storage.getDirectory();
    lifetime.signal.throwIfAborted();
    directory = await namespace.getDirectoryHandle('reploid-chat-artifacts-v1', { create: true });
    await prepareBudget(directory);
    await (acquisitionRead ||= (async () => {
      try {
        acquisitionBudget = await openBrowserAcquisitionBudget({ existingOnly: true, allowInitialize: false });
        if (closed) acquisitionBudget.close();
        notify();
      } catch (cause) { if (cause.code !== 'CUSTODY_BUDGET_MISSING') acquisitionError = cause; }
    })());
    lifetime.signal.throwIfAborted();
    return directory;
  };
  const fileKey = file => file.hashAlgorithm + '-' + file.hash;
  const cached = async file => {
    assert(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= policy.maxArtifactBytes, 'Invalid cached file allowance');
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
  const origin = async (file, signal, onProgress, reserve, range) => {
    if (reserve) signal = AbortSignal.any([signal, AbortSignal.timeout(policy.channel.timeoutMs)]);
    signal.throwIfAborted();
    if (reserve) await reserve(file.sizeBytes);
    signal.throwIfAborted();
    const response = await fetchImpl(file.url, { signal,
      ...(range ? { headers: { Range: `bytes=${range.offset}-${range.offset + file.sizeBytes - 1}` } } : {}) });
    try {
      assert(response.ok, `Model file acquisition HTTP ${response.status}`);
      if (range) assert(response.status === 206 && response.headers.get('content-range') ===
        `bytes ${range.offset}-${range.offset + file.sizeBytes - 1}/${range.total}`, 'Origin did not honor the exact piece range');
    } catch (cause) { await response.body?.cancel(); throw cause; }
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
  const readOwned = async (file, { signal, originOnly = false, onProgress, cacheOnly = false, reserveDownload: reserve } = {}) => {
    signal = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]); signal.throwIfAborted();
    assert(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0 && file.sizeBytes <= policy.maxArtifactBytes, 'Invalid model file allowance');
    const key = fileKey(file);
    if (!cacheOnly && !reserve && lastFile?.key === key) { lastUsed.set(key, Date.now()); return lastFile.bytes; }
    // Each loader owns its cancellation; it never borrows an unrelated transfer's signal.
    const existing = await cached(file);
    assert(existing || !cacheOnly, 'Verified cached model file unavailable');
    const peer = exchange?.has(file) && !originOnly;
    onProgress?.({ stage: 'acquiring', path: file.path, message: `${existing ? 'Reusing' : peer ? 'Receiving from peers:' : 'Downloading'} ${file.path}` });
    const bytes = existing || (peer ? await exchange.acquire(file, { signal, reserveDownload: reserve }) : await origin(file, signal, onProgress, reserve));
    if (!existing && !peer) { await check(file, bytes); signal.throwIfAborted(); await persist(file, bytes, signal); }
    signal.throwIfAborted();
    lastUsed.set(key, Date.now()); lastFile = { key, bytes }; return bytes;
  };
  const adapterFile = adapter => ({ ...adapter.artifact, hash: adapter.artifact.hash.replace(/^sha256:/, ''), hashAlgorithm: 'sha256' });
  const modelFiles = async (model, signal, onProgress, controls = {}) => {
    const pinned = LOCAL_DOPPLER_MODELS.find(item => item.id === model.id && item.identity === model.identity);
    assert(pinned?.source, 'Verified model source is not in the catalog');
    const files = pinned.source.files.map(file => ({ ...file,
      url: file.url ? new URL(file.url, location.href).href : new URL(file.path, pinned.source.baseUrl).href }));
    const manifestFile = files.find(file => file.path === 'manifest.json');
    assert('sha256:' + manifestFile.hash === model.identity, 'Catalog manifest identity mismatch');
    const manifestText = decoder.decode(await read(manifestFile, { signal, onProgress, ...controls })), manifest = JSON.parse(manifestText);
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
      exchange = createCustodyExchange({ transport, identity, policy, ports: { supplyBudget,
        createSupplier: createPeerPackSupplier, createStore: createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
        readArtifact: (file, controls) => ownStorage((async () => {
          assert(supplyController && !supplyController.signal.aborted, 'File supply is stopped');
          try { return await read(file, { ...controls, cacheOnly: true,
            signal: AbortSignal.any([controls.signal, supplyController.signal].filter(Boolean)) }); }
          catch (cause) { exchange?.stopSupply(); error = cause.message; notify(); throw cause; }
        })()), verifyArtifact: check,
        commitArtifact: (file, bytes, { signal }) => persist(file, bytes, signal),
        hash: hashDopplerEvidence, hashBytes: sha256Hex, checkpoints, onChange: notify,
        observe: receipt => { receipts.push(receipt); if (receipts.length > policy.maxReceipts) receipts.shift(); }
      } });
      exchange.announce();
    })().finally(() => { attaching = null; });
    return attaching;
  };
  return Object.freeze({ getState, attach, announce: () => exchange?.announce(),
    async preparePartitionSource(model, { signal, onProgress }) {
      signal = AbortSignal.any([signal, lifetime.signal].filter(Boolean));
      const custody = { queueMs: 0, peerTransferMs: 0, cacheReadMs: 0, peerBytes: 0, cacheBytes: 0, transfers: 0, failures: 0 };
      const retained = async file => {
        const started = performance.now();
        try { const bytes = await cached(file); custody.cacheBytes += bytes?.byteLength || 0; return bytes; }
        finally { custody.cacheReadMs += performance.now() - started; }
      };
      const { manifest, manifestText, files } = await modelFiles(model, signal, onProgress);
      const descriptor = files.find(file => file.role === 'model-piece-index');
      assert(descriptor, 'Model requires a pinned piece index for selective partition acquisition');
      const indexBytes = await read(descriptor, { signal, onProgress });
      const { createVerifiedPieceStorage } = await import(DOPPLER_PARTITIONS_MODULE_URL);
      let opened, sourceClosed = false;
      const acquire = async (piece, controls) => {
        assert(!sourceClosed, 'Partition artifact source is closed');
        const combined = AbortSignal.any([signal, controls.signal].filter(Boolean));
        combined.throwIfAborted();
        const file = files.find(file => file.path === piece.path);
        assert(file, 'Piece source is not in the verified model');
        const saved = { path: `piece-${piece.identity.slice(7)}.bin`, role: file.role,
          sizeBytes: piece.size, hashAlgorithm: 'sha256', hash: piece.identity.slice(7) };
        const existing = await retained(saved);
        combined.throwIfAborted();
        if (existing) return existing;
        assert(exchange?.has(saved) || exchange?.has(file), 'No peer offers the required verified model piece');
        const queuedAt = performance.now();
        const release = await acquirePieceSlot(combined);
        custody.queueMs += performance.now() - queuedAt;
        try {
          const present = await retained(saved);
          combined.throwIfAborted();
          if (present) return present;
          onProgress?.({ stage: 'acquiring', path: piece.path,
            message: 'Receiving required model pieces' });
          const started = performance.now();
          try {
            const bytes = exchange.has(saved) ? await exchange.acquire(saved, { signal: combined })
              : await exchange.acquire(file, { signal: combined,
                range: { offset: piece.offset, size: piece.size, identity: piece.identity } });
            custody.transfers++; custody.peerBytes += bytes.byteLength; return bytes;
          } catch (cause) { custody.failures++; throw cause; }
          finally { custody.peerTransferMs += performance.now() - started; }
        } finally { release(); }
      };
      opened = await createVerifiedPieceStorage({ manifestBytes: new TextEncoder().encode(manifestText).buffer,
        indexBytes: indexBytes.slice().buffer, indexIdentity: 'sha256:' + descriptor.hash, signal, acquire });
      const pieceIndex = JSON.parse(decoder.decode(indexBytes));
      const admittedFile = artifact => {
        assert(!sourceClosed, 'Partition artifact source is closed');
        return resolvePartitionArtifactSource(model, manifest, files, artifact);
      };
      const artifactStore = Object.freeze({
        async readArtifact(artifact, controls = {}) {
          const file = admittedFile(artifact);
          assert(file.role !== 'model-weights', 'Resident weights require complete pinned piece ranges');
          return read(file, { signal: AbortSignal.any([signal, controls.signal].filter(Boolean)), onProgress });
        },
        async readArtifactRange(artifact, offset, size, controls = {}) {
          const file = admittedFile(artifact);
          const piece = pieceIndex.files.find(row => row.path === file.path)?.pieces
            .find(piece => piece.offset === offset && piece.size === size);
          assert(piece, 'Capsule range is not a complete pinned piece');
          return acquire({ ...piece, path: file.path }, controls);
        }
      });
      return { manifest, storage: { ...opened.storage, async close() { sourceClosed = true; await opened.storage.close(); } }, artifactStore, getReceipt: () => ({ ...opened.getReceipt(), custody: { ...custody } }) };
    },
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
    share(model, approved, { mode = 'cached-only', downloadBytes = policy.defaultAcquisitionBytes } = {}) {
      return ownStorage((async () => {
        assert(approved === true, 'Approve distributing model files separately from compute');
        assert(['cached-only', 'bounded-acquisition', 'full-model'].includes(mode), 'Unknown file contribution mode');
        assert(!preparing && !stopping && !exchange?.getState().sharing, 'Stop file contribution before changing its mode');
        assert(Number.isSafeInteger(downloadBytes) && downloadBytes > 0 && downloadBytes <= policy.maxAcquisitionBytes, 'Invalid approved download allowance');
        preparing = true; error = ''; sharingMode = mode;
        sharedModel = { id: model.id, name: model.name }; supplyController = new AbortController();
        const signal = AbortSignal.any([lifetime.signal, supplyController.signal]); notify();
        const onProgress = value => { progress = value; notify(); };
        const controls = mode === 'cached-only' ? { cacheOnly: true } : { reserveDownload };
        try {
          await attach(); await root(); signal.throwIfAborted();
          if (budgetError) throw budgetError;
          if (mode !== 'cached-only') {
            if (acquisitionError) throw acquisitionError;
            if (acquisitionBudget) assert(acquisitionBudget.getState().maxBytes === downloadBytes, 'Download allowance cannot be renewed by changing modes');
            else {
              acquisitionOpening = openBrowserAcquisitionBudget({ maxBytes: downloadBytes, allowInitialize: true });
              acquisitionBudget = await acquisitionOpening;
            }
          }
          signal.throwIfAborted();
          const { manifestText, files } = await modelFiles(model, signal, onProgress, controls);
          pinned.add(fileKey(files.find(file => file.path === 'manifest.json')));
          const inventory = [];
          let selectedBytes = 0;
          const add = file => {
            assert(inventory.length < policy.maxInventoryFiles, 'File contribution inventory limit exceeded');
            selectedBytes += file.sizeBytes;
            assert(selectedBytes <= policy.maxStoredBytes, 'File contribution exceeds retained storage allowance');
            inventory.push(file); pinned.add(fileKey(file));
          };
          if (mode === 'full-model') {
            files.push(...(model.adapters || []).map(adapterFile));
            assert(files.length <= policy.maxInventoryFiles && files.reduce((n, f) => n + f.sizeBytes, 0) <= policy.maxStoredBytes,
              'Full-model seeding exceeds storage allowance');
            let needed = 0;
            for (const file of files) { signal.throwIfAborted(); if (!await cached(file)) needed += file.sizeBytes; }
            const remaining = await acquisitionBudget.reserve(0);
            assert(needed <= remaining.maxBytes - remaining.reservedBytes, 'Full-model seeding requires a sufficient cumulative download allowance');
            for (const file of files) {
              signal.throwIfAborted();
              await read(file, { signal, onProgress, ...controls }); add(file);
            }
          } else {
            const descriptor = files.find(file => file.role === 'model-piece-index');
            assert(descriptor, 'File contribution requires an authenticated piece index');
            const indexBytes = await read(descriptor, { signal, onProgress, ...controls });
            const { createVerifiedPieceStorage } = await import(DOPPLER_PARTITIONS_MODULE_URL);
            const verified = await createVerifiedPieceStorage({ manifestBytes: new TextEncoder().encode(manifestText).buffer,
              indexBytes: indexBytes.slice().buffer, indexIdentity: 'sha256:' + descriptor.hash, signal,
              acquire: async () => { throw new Error('Index validation cannot acquire pieces'); } });
            await verified.storage.close();
            // Rebuild from authenticated metadata and verified OPFS bytes after every start/reload.
            for (const file of files.filter(file => file.role !== 'model-weights')) {
              signal.throwIfAborted();
              if (await cached(file)) add(file);
            }
            const index = JSON.parse(decoder.decode(indexBytes));
            for (const row of index.files) {
              const source = files.find(file => file.path === row.path);
              assert(source, 'Indexed file is absent from the pinned model');
              let whole, checkedWhole = false;
              for (const piece of row.pieces) {
                signal.throwIfAborted();
                if (inventory.length >= policy.maxInventoryFiles) break;
                if (selectedBytes + piece.size > policy.maxSubsetBytes) continue;
                const saved = { path: `piece-${piece.identity.slice(7)}.bin`, role: source.role,
                  sizeBytes: piece.size, hashAlgorithm: 'sha256', hash: piece.identity.slice(7) };
                if (inventory.some(file => fileKey(file) === fileKey(saved))) continue;
                let bytes = await cached(saved);
                // A deliberate full-model seed may have retained a whole shard.
                // Recover verified pieces locally without granting acquisition.
                if (!bytes) {
                  if (!checkedWhole) { whole = await cached(source); checkedWhole = true; }
                  if (whole) {
                    bytes = whole.slice(piece.offset, piece.offset + piece.size);
                    await check(saved, bytes); await persist(saved, bytes, signal);
                  }
                }
                if (!bytes && mode !== 'cached-only') {
                  const state = await acquisitionBudget.reserve(0);
                  if (piece.size > state.maxBytes - state.reservedBytes) continue;
                  pinned.add(fileKey(saved));
                  if (exchange.has(saved)) bytes = await exchange.acquire(saved, { signal, reserveDownload });
                  else if (exchange.has(source)) bytes = await exchange.acquire(source, { signal, reserveDownload,
                    range: { offset: piece.offset, size: piece.size, identity: piece.identity } });
                  else bytes = await origin({ ...saved, url: source.url }, signal, onProgress, reserveDownload,
                    { offset: piece.offset, total: source.sizeBytes });
                  await check(saved, bytes); signal.throwIfAborted(); await persist(saved, bytes, signal);
                }
                if (bytes) add(saved);
              }
            }
            assert(inventory.some(file => file.path.startsWith('piece-')), 'No verified model pieces are available within the approved allowance');
          }
          signal.throwIfAborted(); exchange.offer(inventory);
        } catch (cause) { pinned.clear(); exchange?.stopSupply(); error = cause.message; throw cause; }
        finally { preparing = false; progress = null; notify(); }
      })());
    },
    async stop() {
      stopping = true; sharedModel = null; supplyController?.abort(new Error('File contribution stopped'));
      const supplySettlement = exchange?.stopSupply(); notify();
      try { await Promise.allSettled([...storageOperations, supplySettlement]); pinned.clear(); }
      finally { stopping = false; notify(); }
    },
    getReceipts: () => structuredClone(receipts),
    async close() {
      closed = true; lifetime.abort(new Error('File exchange closed')); const retiring = exchange?.close();
      await attaching?.catch(() => {}); await exchange?.close(); await retiring;
      await Promise.allSettled([...operations]);
      await budgetOpening; await acquisitionOpening?.catch(() => {}); acquisitionBudget?.close(); budget?.close(); checkpoints?.close(); exchange = null; lastFile = null;
    }
  });
}

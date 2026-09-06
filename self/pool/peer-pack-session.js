/** Acquire authorized bytes and open a local runtime. Custody does not authorize delegation. */
import { openPeerPackCheckpoints } from '../infrastructure/pack-transfer-storage.js';
import { DopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createPeerPackArtifactStore } from './peer-pack-custody.js';
import { assertPackSession } from './executable-pack.js';
import { runPackOperation, snapshotPackOperationData } from './pack-operation.js';

export async function openPeerPack({ authorization, index, inventories, requesterPrivateKey, requestChunk,
  trustedSigners, runtimeVersion, maxCacheBytes, maxConcurrentChunks = 1, signal = null,
  scope = `reploid:peer-pack:${crypto.randomUUID()}`, checkpointName = 'reploid-pack-transfer-v1',
  service = DopplerRuntimeService, openCheckpoints = openPeerPackCheckpoints, now = Date.now }) {
  const grant = snapshotPackOperationData(authorization);
  if (!trustedSigners || !Object.keys(trustedSigners).length) throw new Error('Explicit Pack publisher trust required');
  const trust = snapshotPackOperationData(trustedSigners);
  if (typeof runtimeVersion !== 'string' || !runtimeVersion) throw new Error('Exact Doppler runtime version required');
  const startedAt = now();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let checkpoints;
  let store;
  let session;
  let closed = false;
  let closing = null;
  let runnableAt = null;
  const getAcquisitionReceipt = async () => ({ ...store.getReceipt(),
    timeToRunnableMs: runnableAt === null ? null : runnableAt - startedAt,
    storage: await checkpoints.getStats() });
  const current = () => {
    controller.signal.throwIfAborted();
    if (closed) throw new Error('Peer Pack session closed');
  };
  const close = () => {
    if (closing) return closing;
    closed = true;
    controller.abort(new Error('Peer Pack session closed'));
    store?.close();
    signal?.removeEventListener('abort', abort);
    closing = (async () => {
      try { await service.close(scope); }
      finally { checkpoints?.close(); }
    })();
    return closing;
  };
  try {
    current();
    checkpoints = await openCheckpoints({ name: checkpointName, maxBytes: maxCacheBytes });
    current();
    store = await createPeerPackArtifactStore({ authorization: grant, index, inventories,
      requesterPrivateKey, requestChunk, checkpoints, maxConcurrentChunks, signal: controller.signal, now });
    current();
    const envelope = await store.readEnvelope();
    current();
    const pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(envelope));
    const prepared = await service.prepare();
    current();
    if (prepared.version !== runtimeVersion) throw new Error('Peer Pack requires a different Doppler runtime release');
    // Reconstruct the declared closure, including distinct artifact IDs with
    // identical content. Runtime content deduplication may skip those IDs.
    for (const artifact of grant.pack.artifacts) {
      await store.readArtifact(artifact);
      current();
    }
    session = await service.openPack({ scope, source: pack, options: { artifactStore: store,
      trustedSigners: trust, acceptedTargetPlanDigests: grant.pack.acceptedTargetPlanDigests } });
    current();
    await assertPackSession(grant.pack, session);
    current();
    runnableAt = now();
    return Object.freeze({
      session,
      async run(request, { onPartial = null, signal = null, beforeExecute = null } = {}) {
        current();
        return runPackOperation({ binding: grant.pack, session, runtimeVersion, request,
          signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, onPartial, beforeExecute, assertCurrent: current });
      },
      getAcquisitionReceipt,
      close
    });
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error), { cause: error });
    let acquisitionReceipt = null;
    let receiptError = null;
    if (store) {
      try { acquisitionReceipt = await getAcquisitionReceipt(); }
      catch (observationError) { receiptError = observationError; }
    }
    const errors = [failure, ...(receiptError ? [receiptError] : [])];
    try { await close(); }
    catch (cleanup) { errors.push(cleanup); }
    const rejection = errors.length > 1 ? new AggregateError(errors, failure.message, { cause: failure }) : failure;
    if (acquisitionReceipt) rejection.acquisitionReceipt = snapshotPackOperationData(acquisitionReceipt);
    throw rejection;
  }
}

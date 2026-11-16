/** Exact signed-operation connection and reconnection lifecycle. */

import { snapshotPackOperationData } from './pack-operation.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from '../../../shared/pool/peer-pack-job-policy.js';
import { verifyPackPeerJob } from './peer-pack-job.js';

export async function runPeerOperationJob({ requesterClient, request, providerAdverts, connectTransport, signal = null,
  onPartial = null, onPrepared = null, onError = () => {}, registry, policy }) {
  if (typeof requesterClient?.createPeerOperationJob !== 'function') throw new Error('Operation job preparation required');
  const data = snapshotPackOperationData({ request, providerAdverts });
  const { reference, ...options } = data.request;
  return operatePeerJob({ requesterClient, model: data.request.model, reference, deadlineAt: data.request.limits?.deadlineAt,
    prepare: resolvedPolicy => requesterClient.createPeerOperationJob({ ...options, adverts: data.providerAdverts, registry, policy: resolvedPolicy }),
    connectTransport, signal, onPartial, onPrepared, onError, registry, policy });
}

export async function resumePeerOperationJob({ requesterClient, job, model, reference, connectTransport, signal = null,
  onPartial = null, onError = () => {}, registry, policy }) {
  const data = snapshotPackOperationData({ job, model, reference });
  return operatePeerJob({ requesterClient, model: data.model, reference: data.reference, deadlineAt: data.job.body?.intent?.limits?.deadlineAt,
    prepare: () => data.job, connectTransport, signal, onPartial, onError, registry, policy });
}

async function operatePeerJob({ requesterClient, model, reference, deadlineAt, prepare, connectTransport, signal,
  onPartial, onPrepared, onError, registry, policy }) {
  if (typeof requesterClient?.createPeerPackRequester !== 'function'
    || typeof connectTransport !== 'function') throw new Error('Operation requester and transport connector required');
  const resolvedPolicy = resolvePackJobPolicy(policy === undefined ? PACK_JOB_POLICY : policy);
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now() || deadlineAt - Date.now() > resolvedPolicy.limits.maxJobMs) throw new Error('Bounded future operation deadline required');
  const controller = new AbortController(), abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Operation connection or execution deadline exceeded')), deadlineAt - Date.now());
  let transport, requester, rejectStopped;
  const stopped = new Promise((_resolve, reject) => { rejectStopped = reject; });
  const onAbort = () => rejectStopped(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  if (controller.signal.aborted) onAbort();
  stopped.catch(() => {});
  const current = () => controller.signal.throwIfAborted();
  try {
    current();
    const job = await Promise.race([prepare(resolvedPolicy), stopped]);
    current();
    await Promise.race([verifyPackPeerJob(job, { providerId: job.toPeerId, models: [model], registry, policy: resolvedPolicy }), stopped]);
    current();
    // Persist the signed attempt before any connection or delivery. Hosts own storage.
    if (onPrepared) await Promise.race([onPrepared(snapshotPackOperationData(job)), stopped]);
    current();
    const opening = Promise.resolve().then(() => {
      current();
      return connectTransport({ providerId: job.toPeerId, advert: job.body.advert, assignment: job.body.assignment, signal: controller.signal });
    }).then(async value => {
      if (controller.signal.aborted) { await value?.close?.(); current(); }
      return value;
    });
    transport = await Promise.race([opening, stopped]);
    current();
    if (!transport?.bus || typeof transport.close !== 'function') throw new Error('Closable operation transport required');
    const creating = Promise.resolve(requesterClient.createPeerPackRequester({ bus: transport.bus, models: [model], registry, policy: resolvedPolicy, onError }))
      .then(value => { if (controller.signal.aborted) { value.close(); current(); } return value; });
    requester = await Promise.race([creating, stopped]);
    current();
    return await requester.runPrepared({ job, reference, signal: controller.signal, onPartial });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', onAbort);
    controller.abort(new Error('Operation room closed')); requester?.close();
    await transport?.close?.();
  }
}

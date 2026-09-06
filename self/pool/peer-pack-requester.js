import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, assessPackOperation } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, requirePackJob, packJobBytes,
  createPackPeerJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage } from './peer-pack-job.js';

/** Explicit public delegation. Local document search never calls this automatically. */
export function createPackPeerRequester({ identity, bus, models, registry = createPackOperationRegistry(),
  policy: policyInput = PACK_JOB_POLICY, maxDeliveries = policyInput.retry.maxDeliveries, retryMs = policyInput.retry.delayMs, onError = () => {} }) {
  const policy = resolvePackJobPolicy(policyInput);
  requirePackJob(Number.isSafeInteger(maxDeliveries) && maxDeliveries >= 1 && maxDeliveries <= policy.retry.maximumDeliveries
    && Number.isSafeInteger(retryMs) && retryMs >= policy.retry.minimumDelayMs && retryMs <= policy.retry.maximumDelayMs, 'bounded retry policy required');
  models = snapshot(models);
  let active = null, closed = false;
  function current(record) {
    record.controller.signal.throwIfAborted();
    requirePackJob(!closed && active === record && Date.now() < record.deadlineAt, 'attempt is no longer current');
  }
  function finish(record, error, result) {
    if (active !== record) return;
    active = null;
    clearTimeout(record.timer); clearTimeout(record.retryTimer);
    record.signal?.removeEventListener('abort', record.abort);
    error ? record.reject(error) : record.resolve(result);
  }
  async function sendCancellation(record) {
    if (!record.job || Date.now() >= record.deadlineAt) return;
    const cancellation = await signPackPeerMessage({ identity, policy, type: PEER_MESSAGE_TYPES.HEARTBEAT,
      recipient: record.job.toPeerId, expiresAt: record.deadlineAt,
      body: { schema: PACK_CANCEL_SCHEMA, jobHash: record.job.messageHash,
        jobId: record.job.body.intent.jobId, attemptId: record.job.body.intent.attemptId } });
    await bus.send(cancellation);
  }
  function cancel(record, error) {
    if (active !== record) return;
    record.controller.abort(error);
    finish(record, error);
    sendCancellation(record).catch(onError);
  }
  async function deliver(record) {
    current(record);
    record.deliveries++;
    record.sentBytes += packJobBytes(record.job);
    await bus.send(record.job);
    current(record);
    if (record.deliveries < maxDeliveries) record.retryTimer = setTimeout(() => {
      deliver(record).catch(error => { if (active === record) cancel(record, error); });
    }, retryMs);
  }
  async function receive(record, message) {
    current(record);
    const update = await verifyPackPeerMessage(message, { type: PEER_MESSAGE_TYPES.EXECUTION_RESULT,
      recipient: identity.keyId, sender: record.job.toPeerId, policy });
    current(record);
    const body = update.body;
    requirePackJob(body.schema === PACK_UPDATE_SCHEMA && body.jobHash === record.job.messageHash
      && body.requestHash === record.requestHash && update.expiresAt === record.job.expiresAt, 'response binding mismatch');
    const bytes = packJobBytes(update);
    record.receivedBytes += bytes;
    requirePackJob(record.receivedBytes <= record.job.body.intent.limits.maxStreamBytes, 'received stream budget exhausted');
    if (body.updateIndex < record.updates.length) {
      requirePackJob(record.updates[body.updateIndex]?.messageHash === update.messageHash, 'conflicting duplicate response');
      return;
    }
    requirePackJob(body.updateIndex === record.updates.length
      && body.previousUpdateHash === (record.updates.at(-1)?.messageHash ?? null), 'response stream gap or reordering');
    requirePackJob(record.updates.length < record.job.body.intent.limits.maxEvents, 'response event limit exceeded');
    record.updates.push(update);
    requirePackJob(['partial', 'completed'].includes(body.status), `provider ${body.status}`);
    requirePackJob(body.event?.status === body.status, 'event status mismatch');
    await assertPackOperationEvent({ binding: record.model.executablePack, request: record.job.body.request,
      runtimeVersion: record.model.runtimeVersion, event: body.event, eventIndex: record.eventIndex,
      previousEventDigest: record.previousEventDigest, registry });
    current(record);
    record.eventIndex++; record.previousEventDigest = body.event.eventDigest;
    if (body.status === 'partial') {
      await record.onPartial?.(body.event);
      current(record);
      return;
    }
    const execution = snapshot({ request: record.job.body.request, output: body.event.output, receipt: body.event.receipt,
      completion: body.event, eventCount: record.eventIndex, finalEventDigest: body.event.eventDigest });
    const assessment = await assessPackOperation({ execution, reference: record.reference,
      policy: record.job.body.intent.comparisonPolicy, registry });
    current(record);
    requirePackJob(assessment.accepted, 'output failed frozen comparison');
    const acceptance = await signPackPeerMessage({ identity, policy, type: PEER_MESSAGE_TYPES.ACCEPTANCE,
      recipient: record.job.toPeerId, expiresAt: record.deadlineAt,
      body: { schema: 'reploid.peer.pack_acceptance/v1', jobHash: record.job.messageHash,
        finalUpdateHash: update.messageHash, assessment } });
    current(record);
    finish(record, null, snapshot({ job: record.job, execution, assessment, acceptance, updates: record.updates,
      accounting: { deliveries: record.deliveries, sentBytes: record.sentBytes, receivedBytes: record.receivedBytes } }));
  }
  const unsubscribe = bus.subscribe(message => {
    const record = active;
    if (!record?.job || message?.toPeerId !== identity.keyId || message?.fromPeerId !== record.job.toPeerId
      || message?.body?.schema !== PACK_UPDATE_SCHEMA || message.body.jobHash !== record.job.messageHash) return;
    try {
      const bytes = packJobBytes(message);
      requirePackJob(record.queued < policy.limits.maxInboxMessages && record.queuedBytes + bytes <= policy.limits.maxWireBytes, 'requester inbox limit');
      const copy = snapshot(message);
      record.queued++; record.queuedBytes += bytes;
      record.incoming = record.incoming.then(() => receive(record, copy))
        .catch(error => { if (active === record) cancel(record, error); }).finally(() => { record.queued--; record.queuedBytes -= bytes; });
    } catch (error) { cancel(record, error); }
  });
  const disconnected = bus.onDisconnect?.(() => { if (active) cancel(active, new Error('requester transport disconnected')); });
  function start(input, prepared = false) {
      if (closed || active) return Promise.reject(new Error('Peer Pack requester is closed or busy'));
      const { signal = null, onPartial = null, reference, ...options } = input;
      let data;
      try {
        if (prepared) { options.model = options.job.body.intent.model; options.limits = options.job.body.intent.limits; }
        data = snapshot({ reference, options });
      } catch (error) { return Promise.reject(error); }
      const deadlineAt = data.options.limits?.deadlineAt;
      if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now() || deadlineAt - Date.now() > policy.limits.maxJobMs) return Promise.reject(new Error('Bounded future deadline required'));
      return new Promise((resolve, reject) => {
        const record = { resolve, reject, controller: new AbortController(), signal, onPartial, deadlineAt,
          reference: data.reference, model: data.options.model, job: null, deliveries: 0, sentBytes: 0, receivedBytes: 0,
          updates: [], eventIndex: 0, previousEventDigest: null, queued: 0, queuedBytes: 0, incoming: Promise.resolve() };
        active = record;
        record.abort = () => cancel(record, signal.reason || new Error('requester cancelled'));
        signal?.addEventListener('abort', record.abort, { once: true });
        record.timer = setTimeout(() => cancel(record, new Error('remote job deadline exceeded')), deadlineAt - Date.now());
        if (signal?.aborted) { record.abort(); return; }
        (async () => {
          const job = prepared ? data.options.job : await createPackPeerJob({ ...data.options, identity, registry, policy });
          requirePackJob(job.fromPeerId === identity.keyId, 'prepared job belongs to another requester');
          current(record);
          await verifyPackPeerJob(job, { providerId: job.toPeerId, models, registry, policy });
          current(record);
          const adapter = registry[job.body.request.operation.name];
          requirePackJob(await hashDopplerEvidence(data.reference) === job.body.intent.comparisonPolicy.referenceDigest, 'reference digest mismatch');
          adapter.validateOutput(data.reference, job.body.request, { completed: true });
          requirePackJob(adapter.compare(data.reference, data.reference, job.body.intent.comparisonPolicy) === true, 'invalid comparison policy');
          record.requestHash = await hashDopplerEvidence(job.body.request);
          current(record);
          record.job = job;
          await deliver(record);
        })().catch(error => { if (active === record) cancel(record, error); });
      });
  }
  return {
    run: input => start(input),
    runPrepared: input => start(input, true),
    cancel() { if (active) cancel(active, new Error('requester cancelled')); },
    getState() { return { closed, active: !!active, deliveries: active?.deliveries ?? 0 }; },
    close() { closed = true; if (active) cancel(active, new Error('requester closed')); unsubscribe(); disconnected?.(); }
  };
}

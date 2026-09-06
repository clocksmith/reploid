import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { createLocalPackExecutor } from './local-pack-executor.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { openPackJobJournal } from '../infrastructure/pack-job-storage.js';
import { PACK_JOB_SCHEMA, PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, PACK_JOB_MAX_WIRE_BYTES, packJobBytes,
  requirePackJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage, packPeerModel, createPackProviderAdvert } from './peer-pack-job.js';

/** One physical executor, bounded replay records, and cooperative cancellation. */
export function createPackPeerProvider({ identity, bus, models, authorize,
  registry = createPackOperationRegistry(), executor = createLocalPackExecutor({ registry }),
  journal: suppliedJournal = null, journalName = 'reploid-pack-jobs-v1',
  maxAttempts = 128, maxRetainedBytes = 64 * 1024 * 1024, onError = () => {} }) {
  requirePackJob(typeof authorize === 'function', 'provider admission callback required');
  requirePackJob(Number.isSafeInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 256
    && Number.isSafeInteger(maxRetainedBytes) && maxRetainedBytes > 0 && maxRetainedBytes <= 64 * 1024 * 1024, 'invalid provider retention limits');
  models = snapshot(models);
  const records = new Map();
  const writer = crypto.randomUUID();
  let journal = suppliedJournal, journalOpening = null;
  const storage = async () => {
    if (!journal) journal = await (journalOpening ??= openPackJobJournal({ providerId: identity.keyId,
      name: journalName, maxAttempts, maxBytes: maxRetainedBytes }));
    return journal;
  };
  const descriptor = record => ({ requesterId: record.requesterId, jobId: record.jobId,
    attemptId: record.attemptId, jobHash: record.job.messageHash, expiresAt: record.expiresAt });
  const lifecycle = new AbortController();
  let retainedBytes = 0, queued = 0, queuedBytes = 0, closed = false, active = null, incoming = Promise.resolve();
  const keyFor = (sender, hash) => `${sender}/${hash}`;
  const prune = () => {
    for (const [key, record] of records) if (record !== active && record.expiresAt <= Date.now()) {
      retainedBytes -= record.bytes; records.delete(key);
    }
  };
  const current = record => {
    record.controller.signal.throwIfAborted();
    requirePackJob(!closed && active === record && Date.now() < record.expiresAt, 'attempt is no longer current');
  };
  const admitted = async (job, signal = lifecycle.signal) => {
    signal.throwIfAborted();
    let timer, abort;
    const stopped = new Promise((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new Error('admission deadline exceeded')), Math.max(0, Date.parse(job.expiresAt) - Date.now()));
    });
    try { requirePackJob(await Promise.race([Promise.resolve().then(() => authorize(job)), stopped]) === true, 'application did not authorize public delegation'); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  };

  async function update(record, status, event = null) {
    if (status === 'partial' || status === 'completed') current(record);
    const message = await signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.EXECUTION_RESULT,
      recipient: record.job.fromPeerId, expiresAt: record.expiresAt,
      body: { schema: PACK_UPDATE_SCHEMA, jobHash: record.job.messageHash, requestHash: record.requestHash,
        updateIndex: record.updates.length, previousUpdateHash: record.updates.at(-1)?.messageHash ?? null, status, event } });
    if (status === 'partial' || status === 'completed') current(record);
    const bytes = packJobBytes(message);
    requirePackJob(record.updates.length < record.job.body.intent.limits.maxEvents
      && record.bytes + bytes <= record.job.body.intent.limits.maxStreamBytes
      && retainedBytes + bytes <= maxRetainedBytes, 'response stream budget exhausted');
    await (await storage()).append(descriptor(record), writer, message);
    record.updates.push(message); record.bytes += bytes; retainedBytes += bytes;
    // A transport failure cannot rewrite an already committed terminal result.
    if (status !== 'partial') record.status = status;
    if (status === 'partial' || status === 'completed') current(record);
    await bus.send(message);
  }

  async function restore(record, saved) {
    let terminal = null;
    for (const [index, response] of saved.updates.entries()) {
      requirePackJob(!terminal && Date.parse(response.createdAt) >= Date.parse(record.job.createdAt)
        && Date.parse(response.createdAt) <= Date.now(), 'invalid restored response chronology');
      const message = await verifyPackPeerMessage(response, { type: PEER_MESSAGE_TYPES.EXECUTION_RESULT,
        recipient: record.requesterId, sender: identity.keyId, now: Date.parse(response.createdAt) });
      const body = message.body;
      requirePackJob(body.schema === PACK_UPDATE_SCHEMA && body.jobHash === record.job.messageHash
        && body.requestHash === record.requestHash && message.expiresAt === record.job.expiresAt
        && body.updateIndex === index && body.previousUpdateHash === (record.updates.at(-1)?.messageHash ?? null), 'restored response binding mismatch');
      if (['partial', 'completed'].includes(body.status)) {
        requirePackJob(body.event?.status === body.status, 'restored event status mismatch');
        const model = record.job.body.intent.model;
        await assertPackOperationEvent({ binding: model.executablePack, request: record.job.body.request,
          runtimeVersion: model.runtimeVersion, event: body.event, eventIndex: record.eventIndex,
          previousEventDigest: record.previousEventDigest, registry });
        record.eventIndex++; record.previousEventDigest = body.event.eventDigest;
      } else requirePackJob(['failed', 'busy', 'cancelled'].includes(body.status) && body.event === null, 'invalid restored terminal response');
      if (body.status !== 'partial') terminal = body.status;
      record.updates.push(message); record.bytes += packJobBytes(message);
    }
    requirePackJob(record.updates.length <= record.job.body.intent.limits.maxEvents
      && record.bytes <= record.job.body.intent.limits.maxStreamBytes && retainedBytes + record.bytes <= maxRetainedBytes, 'restored stream exceeds limits');
    requirePackJob(terminal ? saved.status === terminal : ['running', 'interrupted', 'cancelled'].includes(saved.status), 'restored terminal state mismatch');
    retainedBytes += record.bytes;
    record.status = saved.status;
    // Restore the complete prefix before extending it with an interruption.
    for (const response of record.updates) await bus.send(response);
    if (!terminal && ['interrupted', 'cancelled'].includes(saved.status)) await update(record, saved.status === 'cancelled' ? 'cancelled' : 'failed');
  }

  async function execute(record) {
    active = record;
    const timer = setTimeout(() => record.controller.abort(new Error('deadline exceeded')), Math.max(0, record.expiresAt - Date.now()));
    try {
      current(record);
      const { request, intent } = record.job.body;
      const targetHash = await hashDopplerEvidence(intent.model);
      let model;
      for (const candidate of models) if (await hashDopplerEvidence(packPeerModel(candidate, registry)) === targetHash) model = candidate;
      current(record);
      const result = await executor.run({ model, input: request.input, options: request.options,
        assignment: request.assignment, limits: request.limits, signal: record.controller.signal,
        onPartial: async event => {
          current(record);
          await admitted(record.job, record.controller.signal);
          current(record);
          await assertPackOperationEvent({ binding: model.executablePack, request, runtimeVersion: model.runtimeVersion,
            event, eventIndex: record.eventIndex, previousEventDigest: record.previousEventDigest, registry });
          await update(record, 'partial', event);
          record.eventIndex++; record.previousEventDigest = event.eventDigest;
        } });
      current(record);
      await admitted(record.job, record.controller.signal);
      current(record);
      await assertPackOperationEvent({ binding: model.executablePack, request, runtimeVersion: model.runtimeVersion,
        event: result.completion, eventIndex: record.eventIndex, previousEventDigest: record.previousEventDigest, registry });
      current(record);
      await update(record, 'completed', result.completion);
      record.status = 'completed';
    } catch (error) {
      onError(error);
      if (record.status === 'completed') return;
      record.status = record.controller.signal.aborted ? 'cancelled' : 'failed';
      // An expired lease cannot authorize a new result message. Local timeout is final.
      if (!closed && Date.now() < record.expiresAt) await update(record, record.status).catch(onError);
    } finally {
      clearTimeout(timer);
      // Local executors can return cancellation before their GPU work settles.
      // The executor keeps its own busy/draining gate until that settlement.
      if (active === record) active = null;
    }
  }

  async function receive(message) {
    if (closed || message?.toPeerId !== identity.keyId) return;
    const schema = message.body?.schema;
    if (![PACK_JOB_SCHEMA, PACK_CANCEL_SCHEMA].includes(schema)) return;
    prune();
    if (schema === PACK_CANCEL_SCHEMA) {
      const cancel = await verifyPackPeerMessage(message, { type: PEER_MESSAGE_TYPES.HEARTBEAT, recipient: identity.keyId });
      requirePackJob(/^sha256:[0-9a-f]{64}$/.test(cancel.body.jobHash), 'invalid cancellation target');
      for (const field of ['jobId', 'attemptId']) requirePackJob(typeof cancel.body[field] === 'string'
        && cancel.body[field].length > 0 && cancel.body[field].length <= 128, 'cancellation attempt identity required');
      const key = keyFor(cancel.fromPeerId, cancel.body.jobHash);
      const record = records.get(key);
      if (record) {
        requirePackJob(record.jobId === cancel.body.jobId && record.attemptId === cancel.body.attemptId, 'cancellation attempt mismatch');
        if (record.status === 'running') { record.status = 'cancelled'; record.controller.abort(new Error('requester cancelled')); }
      } else {
        requirePackJob(records.size < maxAttempts, 'attempt retention exhausted');
        // A short cancellation lease cannot allow a still-live delayed job to restart.
        records.set(key, { requesterId: cancel.fromPeerId, jobId: cancel.body.jobId, attemptId: cancel.body.attemptId,
          status: 'cancelled', bytes: 0, updates: [], expiresAt: Date.now() + 300000 });
      }
      await (await storage()).cancel({ requesterId: cancel.fromPeerId, jobId: cancel.body.jobId,
        attemptId: cancel.body.attemptId, jobHash: cancel.body.jobHash, expiresAt: Date.now() + 300000 }, writer);
      return;
    }
    const job = await verifyPackPeerJob(message, { providerId: identity.keyId, models, registry });
    const key = keyFor(job.fromPeerId, job.messageHash);
    const prior = records.get(key);
    await admitted(job);
    if (prior?.job) {
      // Byte-identical delivery repeats evidence; it never starts execution again.
      for (const response of [...prior.updates]) await bus.send(response);
      return;
    }
    if (prior) records.delete(key); // The durable cancellation will restore a signed terminal response.
    requirePackJob(![...records.values()].some(record => record.requesterId === job.fromPeerId
      && record.jobId === job.body.intent.jobId && record.attemptId === job.body.intent.attemptId),
    'attempt was already observed with a different signed envelope');
    requirePackJob(records.size < maxAttempts, 'attempt retention exhausted');
    requirePackJob(!closed && Date.now() < Date.parse(job.expiresAt), 'attempt expired during admission');
    const record = { job, requesterId: job.fromPeerId, jobId: job.body.intent.jobId, attemptId: job.body.intent.attemptId,
      status: 'running', controller: new AbortController(), expiresAt: Date.parse(job.expiresAt),
      requestHash: await hashDopplerEvidence(job.body.request), bytes: 0, updates: [], eventIndex: 0, previousEventDigest: null };
    const claimed = await (await storage()).claim(descriptor(record), writer);
    requirePackJob(!closed && Date.now() < record.expiresAt, 'attempt expired during durable admission');
    if (!claimed.created) {
      try { await restore(record, claimed.record); }
      catch (error) {
        // A rejected or partially replayed persisted stream must never enter the memory replay path.
        retainedBytes = [...records.values()].reduce((sum, row) => sum + row.bytes, 0);
        throw error;
      }
      records.set(key, record);
      return;
    }
    records.set(key, record);
    if (active || executor.getState?.().active) {
      record.status = 'busy';
      await update(record, 'busy');
      return;
    }
    record.settlement = execute(record);
  }

  const unsubscribe = bus.subscribe(message => {
    if (closed || message?.toPeerId !== identity.keyId) return;
    const bytes = packJobBytes(message);
    if (queued >= 16 || queuedBytes + bytes > PACK_JOB_MAX_WIRE_BYTES) { onError(new Error('Peer Pack provider inbox limit')); return; }
    let copy;
    try { copy = snapshot(message); } catch (error) { onError(error); return; }
    queued++; queuedBytes += bytes;
    incoming = incoming.then(() => receive(copy)).catch(onError).finally(() => { queued--; queuedBytes -= bytes; });
  });
  const disconnected = bus.onDisconnect?.(() => {
    active?.controller.abort(new Error('provider transport disconnected'));
  });
  return {
    createAdvert({ limits, expiresAt }) {
      requirePackJob(!closed, 'provider is closed');
      return createPackProviderAdvert({ identity, models, limits, expiresAt, registry });
    },
    getState() { prune(); return { closed, active: !!active || executor.getState?.().active === true,
      draining: active?.controller.signal.aborted === true || executor.getState?.().draining === true,
      attempts: records.size, retainedBytes, queued, queuedBytes }; },
    async getJournalStats() { return (await storage()).getStats(); },
    async close() {
      closed = true; lifecycle.abort(new Error('provider closed')); unsubscribe(); disconnected?.(); active?.controller.abort(new Error('provider closed'));
      await incoming;
      await Promise.all([...records.values()].map(record => record.settlement));
      await executor.close();
      if (journalOpening) await journalOpening.catch(() => {});
      journal?.close();
      records.clear(); retainedBytes = 0;
    }
  };
}

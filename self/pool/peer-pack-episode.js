/** Offline verification at the original signed acceptance instant. */
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, assessPackOperation } from './pack-operation.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { PACK_UPDATE_SCHEMA, requirePackJob, verifyPackPeerMessage, verifyPackPeerJob, packJobBytes } from './peer-pack-job.js';

export async function verifyPackPeerEpisode({ job, updates, acceptance, reference, models, registry = createPackOperationRegistry() }) {
  ({ job, updates, acceptance, reference, models } = snapshot({ job, updates, acceptance, reference, models }));
  let policy = PACK_JOB_POLICY;
  if (job.body.schema === PACK_JOB_POLICY.schemas.job) {
    policy = resolvePackJobPolicy(job.body.intent.jobPolicy);
    const retained = job.body.intent.operationPolicy;
    const implementations = Object.fromEntries(Object.values(registry).map(adapter => [adapter.definition.adapterId, adapter.implementation]));
    const restored = createPackOperationRegistry({ definitions: { [job.body.request.operation.name]: retained.definition },
      comparisons: retained.comparisons, implementations });
    registry = Object.freeze({ ...registry, ...restored });
  }
  const acceptedAt = Date.parse(acceptance.createdAt);
  requirePackJob(Number.isFinite(acceptedAt) && acceptedAt <= Date.now(), 'invalid archived acceptance time');
  await verifyPackPeerMessage(acceptance, { type: PEER_MESSAGE_TYPES.ACCEPTANCE,
    recipient: job.toPeerId, sender: job.fromPeerId, now: acceptedAt, policy });
  job = await verifyPackPeerJob(job, { providerId: job.toPeerId, models, registry, now: acceptedAt, allowLegacy: true, policy });
  requirePackJob(acceptance.body.schema === 'reploid.peer.pack_acceptance/v1' && acceptance.body.jobHash === job.messageHash
    && acceptance.expiresAt === job.expiresAt, 'archived acceptance scope mismatch');
  requirePackJob(Array.isArray(updates) && updates.length > 0 && updates.length <= job.body.intent.limits.maxEvents,
    'archived stream length invalid');
  const request = job.body.request, model = job.body.intent.model;
  let previousUpdateHash = null, previousEventDigest = null, bytes = 0, completion = null;
  for (const [index, update] of updates.entries()) {
    requirePackJob(!completion, 'archived output after completion');
    const createdAt = Date.parse(update.createdAt);
    requirePackJob(createdAt >= Date.parse(job.createdAt) && createdAt <= acceptedAt, 'archived response time outside assignment');
    await verifyPackPeerMessage(update, { type: PEER_MESSAGE_TYPES.EXECUTION_RESULT,
      recipient: job.fromPeerId, sender: job.toPeerId, now: createdAt, policy });
    bytes += packJobBytes(update);
    requirePackJob(bytes <= job.body.intent.limits.maxStreamBytes, 'archived stream byte limit');
    const body = update.body;
    requirePackJob(body.schema === PACK_UPDATE_SCHEMA && body.jobHash === job.messageHash
      && body.requestHash === await hashDopplerEvidence(request) && update.expiresAt === job.expiresAt
      && body.updateIndex === index && body.previousUpdateHash === previousUpdateHash
      && body.status === body.event?.status, 'archived stream binding mismatch');
    await assertPackOperationEvent({ binding: model.executablePack, request, runtimeVersion: model.runtimeVersion,
      event: body.event, eventIndex: index, previousEventDigest, registry });
    if (body.status === 'completed') completion = body.event;
    previousEventDigest = body.event.eventDigest; previousUpdateHash = update.messageHash;
  }
  requirePackJob(completion, 'archived stream has no completion');
  const execution = { request, output: completion.output, receipt: completion.receipt };
  const assessment = await assessPackOperation({ execution, reference, policy: job.body.intent.comparisonPolicy, registry });
  requirePackJob(assessment.accepted && acceptance.body.finalUpdateHash === previousUpdateHash
    && await hashDopplerEvidence(acceptance.body.assessment) === await hashDopplerEvidence(assessment), 'archived acceptance does not match execution comparison');
  return snapshot({ accepted: true, acceptedAt: acceptance.createdAt, execution, assessment, acceptanceHash: acceptance.messageHash });
}

/** Application-pinned complete jobs. Public catalog admission remains separate. */
import { hashJson, sha256Hex } from './inference-receipt.js';
import { createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { validateOperationModel } from './operation-model.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { assertPackOperationRequest, snapshotPackOperationData as snapshot } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';

export const PACK_JOB_SCHEMA = 'reploid.peer.pack_job/v1';
export const PACK_UPDATE_SCHEMA = 'reploid.peer.pack_update/v1';
export const PACK_CANCEL_SCHEMA = 'reploid.peer.pack_cancel/v1';
export const PACK_JOB_MAX_WIRE_BYTES = 16 * 1024 * 1024;
export const requirePackJob = (ok, message) => { if (!ok) throw new Error(`Peer Pack job: ${message}`); };
export const packJobBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const equal = async (a, b) => await hashJson(a) === await hashJson(b);
const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

/** Never advertise source URLs, signer custody, or application-local open options. */
export function packPeerModel(model, registry = createPackOperationRegistry()) {
  const pin = snapshot(Object.fromEntries(['modelId', 'modelHash', 'manifestHash', 'runtime', 'backend',
    'executionMode', 'workload', 'runtimeVersion', 'executablePack'].map(key => [key, model[key]])));
  const checked = validateOperationModel(pin, registry);
  requirePackJob(checked.ok, checked.reasons.join('; '));
  requirePackJob(typeof pin.runtimeVersion === 'string' && pin.runtimeVersion.length > 0, 'exact runtime version required');
  return pin;
}

export function validatePackPeerLimits(limits) {
  for (const key of ['maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs']) {
    requirePackJob(Number.isSafeInteger(limits?.[key]) && limits[key] > 0, `${key} required`);
  }
  requirePackJob(limits.maxInputBytes <= PACK_JOB_MAX_WIRE_BYTES / 4
    && limits.maxOutputBytes <= PACK_JOB_MAX_WIRE_BYTES / 4 && limits.maxStreamBytes <= 64 * 1024 * 1024
    && limits.maxEvents <= 4096 && limits.maxJobMs <= 300000, 'protocol resource ceiling exceeded');
}

export async function signPackPeerMessage({ identity, type, recipient = null, body, expiresAt }) {
  const message = await createSignedPeerMessage({ type, fromPeerId: identity.keyId, toPeerId: recipient,
    publicKey: identity.publicKey, privateKey: identity.privateKey, body, expiresAt: new Date(expiresAt).toISOString() });
  requirePackJob(packJobBytes(message) <= PACK_JOB_MAX_WIRE_BYTES, 'wire byte limit exceeded');
  return snapshot(message);
}

export async function verifyPackPeerMessage(message, { type, recipient = null, sender = null, now = Date.now() }) {
  requirePackJob(packJobBytes(message) <= PACK_JOB_MAX_WIRE_BYTES, 'wire byte limit exceeded');
  message = snapshot(message);
  const created = Date.parse(message.createdAt), expires = Date.parse(message.expiresAt);
  requirePackJob(message.type === type && message.toPeerId === recipient && (!sender || message.fromPeerId === sender)
    && digest(message.fromPeerId) && typeof message.publicKey === 'string' && message.publicKey.length <= 1024
    && Number.isFinite(created) && created <= now + 5000 && Number.isFinite(expires)
    && expires > created && expires - created <= 300000, 'message scope or validity rejected');
  requirePackJob(await sha256Hex(Uint8Array.from(atob(message.publicKey), c => c.charCodeAt(0))) === message.fromPeerId,
    'identity does not bind signing key');
  const checked = await verifyPeerMessage(message, { now });
  requirePackJob(checked.ok, checked.reasons.join('; '));
  return message;
}

export async function createPackProviderAdvert({ identity, models, limits, expiresAt, registry = createPackOperationRegistry() }) {
  validatePackPeerLimits(limits);
  requirePackJob(Array.isArray(models) && models.length > 0 && models.length <= 16, 'bounded model pins required');
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, expiresAt,
    body: { schema: 'reploid.peer.pack_provider/v1', models: models.map(model => packPeerModel(model, registry)), limits } });
}

async function jobParts({ requesterId, advert, intent, input, options, registry }) {
  const model = packPeerModel(intent.model, registry);
  requirePackJob(await equal(model, intent.model) && advert.body.schema === 'reploid.peer.pack_provider/v1', 'invalid model pin or advert');
  validatePackPeerLimits(advert.body.limits);
  requirePackJob(Array.isArray(advert.body.models) && (await Promise.all(advert.body.models.map(pin => equal(pin, model)))).some(Boolean), 'provider does not advertise the exact model');
  requirePackJob(typeof intent.jobId === 'string' && intent.jobId.length > 0 && intent.jobId.length <= 128
    && typeof intent.attemptId === 'string' && intent.attemptId.length > 0 && intent.attemptId.length <= 128, 'job and attempt identities required');
  requirePackJob(intent.consent?.schema === 'reploid.peer.public_operation_consent/v1' && intent.consent.publicInput === true
    && Array.isArray(intent.consent.providerIds) && intent.consent.providerIds.length > 0 && intent.consent.providerIds.length <= 8
    && intent.consent.providerIds.every(digest) && intent.consent.providerIds.includes(advert.fromPeerId), 'explicit public input and selected-provider consent required');
  const { deadlineAt, ...limits } = intent.limits;
  validatePackPeerLimits(limits);
  for (const key of Object.keys(advert.body.limits)) requirePackJob(limits[key] <= advert.body.limits[key], 'assignment exceeds advertised limits');
  requirePackJob(Number.isSafeInteger(intent.selectedAt) && Number.isSafeInteger(deadlineAt)
    && deadlineAt > intent.selectedAt && deadlineAt - intent.selectedAt <= limits.maxJobMs, 'bounded assignment deadline required');
  const operation = { name: model.executablePack.requiredOperation, version: registry[model.executablePack.requiredOperation].version };
  requirePackJob(intent.inputHash === await hashDopplerEvidence({ input, options }), 'input differs from signed intent');
  requirePackJob(intent.comparisonPolicy?.schema === 'poolday.operation-comparison/v1'
    && await equal(intent.comparisonPolicy.operation, operation) && digest(intent.comparisonPolicy.referenceDigest), 'frozen comparison policy required');
  const intentHash = await hashJson(intent);
  const routeDecisionHash = await hashJson({ intentHash, providerAdvertHash: advert.messageHash, providerId: advert.fromPeerId });
  const identity = await sealPeerAssignmentIdentity({ intentHash, providerId: advert.fromPeerId, assignmentAttemptId: intent.attemptId,
    routeDecisionHash, providerAdvertHash: advert.messageHash, providerLimits: limits });
  const assignment = { schema: 'reploid.peer.assignment/v1', ...identity, jobId: intent.jobId, requesterId,
    providerId: advert.fromPeerId, providerPublicKey: advert.publicKey, intentHash, routeDecisionHash,
    providerAdvertHash: advert.messageHash, providerParticipationProfileHash: null, providerLimits: limits,
    assignmentAttemptId: intent.attemptId, comparisonPolicyDigest: await hashDopplerEvidence(intent.comparisonPolicy),
    inputHash: intent.inputHash, model, expiresAt: new Date(deadlineAt).toISOString() };
  const request = { schema: 'doppler.pack-operation-request/v1', operation, input, options, assignment,
    limits: { maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes, deadlineAt } };
  assertPackOperationRequest(model.executablePack, request, registry);
  return { assignment, request };
}

export async function createPackPeerJob({ identity, advert, model, input, options = {}, limits, consent, comparisonPolicy,
  jobId = crypto.randomUUID(), attemptId = crypto.randomUUID(), registry = createPackOperationRegistry() }) {
  // Snapshot before the first await, including nested policy and model objects.
  const data = snapshot({ advert, model: packPeerModel(model, registry), input, options, limits, consent, comparisonPolicy, jobId, attemptId });
  advert = await verifyPackPeerMessage(data.advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT });
  const intent = { model: data.model, limits: data.limits, consent: data.consent, comparisonPolicy: data.comparisonPolicy,
    jobId, attemptId, selectedAt: Date.now(), inputHash: await hashDopplerEvidence({ input: data.input, options: data.options }) };
  const parts = await jobParts({ requesterId: identity.keyId, advert, intent, input: data.input, options: data.options, registry });
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: advert.fromPeerId,
    expiresAt: data.limits.deadlineAt, body: { schema: PACK_JOB_SCHEMA, advert, intent, ...parts } });
}

export async function verifyPackPeerJob(message, { providerId, models, registry = createPackOperationRegistry(), now = Date.now() }) {
  const job = await verifyPackPeerMessage(message, { type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: providerId, now });
  requirePackJob(job.body.schema === PACK_JOB_SCHEMA, 'unknown job schema');
  const { advert, intent, assignment, request } = job.body;
  requirePackJob(intent.selectedAt <= now && intent.selectedAt >= Date.parse(job.createdAt) - 5000
    && job.expiresAt === new Date(intent.limits.deadlineAt).toISOString(), 'selection time or expiry mismatch');
  await verifyPackPeerMessage(advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, sender: providerId, now: intent.selectedAt });
  requirePackJob((await Promise.all(models.map(model => equal(packPeerModel(model, registry), intent.model)))).some(Boolean), 'model is outside application pins');
  const expected = await jobParts({ requesterId: job.fromPeerId, advert, intent, input: request.input, options: request.options, registry });
  requirePackJob(await equal(assignment, expected.assignment) && await equal(request, expected.request), 'assignment or request does not match signed authority');
  return job;
}

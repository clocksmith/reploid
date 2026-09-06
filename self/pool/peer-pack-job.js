/** Application-pinned complete jobs. Public catalog admission remains separate. */
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { assertOperationLimits } from './pack-operation-policy.js';
import { hashJson, sha256Hex } from './inference-receipt.js';
import { createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { validateOperationModel } from './operation-model.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { assertPackOperationRequest, snapshotPackOperationData as snapshot } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';

export const PACK_JOB_SCHEMA = PACK_JOB_POLICY.schemas.job;
export const PACK_UPDATE_SCHEMA = PACK_JOB_POLICY.schemas.update;
export const PACK_CANCEL_SCHEMA = PACK_JOB_POLICY.schemas.cancel;
export const PACK_JOB_MAX_WIRE_BYTES = PACK_JOB_POLICY.limits.maxWireBytes;
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

export function validatePackPeerLimits(limits, policy = PACK_JOB_POLICY) {
  for (const key of ['maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs']) {
    requirePackJob(Number.isSafeInteger(limits?.[key]) && limits[key] > 0, `${key} required`);
  }
  for (const key of ['maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs']) requirePackJob(limits[key] <= policy.limits[key], 'protocol resource ceiling exceeded');
}

export async function signPackPeerMessage({ identity, type, recipient = null, body, expiresAt, policy = PACK_JOB_POLICY }) {
  const message = await createSignedPeerMessage({ type, fromPeerId: identity.keyId, toPeerId: recipient,
    publicKey: identity.publicKey, privateKey: identity.privateKey, body, expiresAt: new Date(expiresAt).toISOString() });
  requirePackJob(packJobBytes(message) <= policy.limits.maxWireBytes, 'wire byte limit exceeded');
  return snapshot(message);
}

export async function verifyPackPeerMessage(message, { type, recipient = null, sender = null, now = Date.now(), policy = PACK_JOB_POLICY }) {
  requirePackJob(packJobBytes(message) <= policy.limits.maxWireBytes, 'wire byte limit exceeded');
  message = snapshot(message);
  const created = Date.parse(message.createdAt), expires = Date.parse(message.expiresAt);
  requirePackJob(message.type === type && message.toPeerId === recipient && (!sender || message.fromPeerId === sender)
    && digest(message.fromPeerId) && typeof message.publicKey === 'string' && message.publicKey.length <= policy.limits.maxPublicKeyCharacters
    && Number.isFinite(created) && created <= now + policy.limits.maxClockSkewMs && Number.isFinite(expires)
    && expires > created && expires - created <= policy.limits.maxJobMs, 'message scope or validity rejected');
  requirePackJob(await sha256Hex(Uint8Array.from(atob(message.publicKey), c => c.charCodeAt(0))) === message.fromPeerId,
    'identity does not bind signing key');
  const checked = await verifyPeerMessage(message, { now });
  requirePackJob(checked.ok, checked.reasons.join('; '));
  return message;
}

export async function createPackProviderAdvert({ identity, models, limits, expiresAt, registry = createPackOperationRegistry(), policy = PACK_JOB_POLICY }) {
  validatePackPeerLimits(limits, policy);
  requirePackJob(Array.isArray(models) && models.length > 0 && models.length <= policy.limits.maxModels, 'bounded model pins required');
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, expiresAt, policy,
    body: { schema: 'reploid.peer.pack_provider/v1', models: models.map(model => packPeerModel(model, registry)), limits } });
}

async function jobParts({ requesterId, advert, intent, input, options, registry, legacy = false, policy = PACK_JOB_POLICY }) {
  const model = packPeerModel(intent.model, registry);
  requirePackJob(await equal(model, intent.model) && advert.body.schema === 'reploid.peer.pack_provider/v1', 'invalid model pin or advert');
  validatePackPeerLimits(advert.body.limits, policy);
  requirePackJob(Array.isArray(advert.body.models) && (await Promise.all(advert.body.models.map(pin => equal(pin, model)))).some(Boolean), 'provider does not advertise the exact model');
  requirePackJob(typeof intent.jobId === 'string' && intent.jobId.length > 0 && intent.jobId.length <= policy.limits.maxIdentityCharacters
    && typeof intent.attemptId === 'string' && intent.attemptId.length > 0 && intent.attemptId.length <= policy.limits.maxIdentityCharacters, 'job and attempt identities required');
  requirePackJob(intent.consent?.schema === 'reploid.peer.public_operation_consent/v1' && intent.consent.publicInput === true
    && Array.isArray(intent.consent.providerIds) && intent.consent.providerIds.length > 0 && intent.consent.providerIds.length <= policy.limits.maxConsentProviders
    && intent.consent.providerIds.every(digest) && intent.consent.providerIds.includes(advert.fromPeerId), 'explicit public input and selected-provider consent required');
  const { deadlineAt, ...limits } = intent.limits;
  validatePackPeerLimits(limits, policy);
  assertOperationLimits(limits, registry[model.executablePack.requiredOperation].definition);
  for (const key of Object.keys(advert.body.limits)) requirePackJob(limits[key] <= advert.body.limits[key], 'assignment exceeds advertised limits');
  requirePackJob(Number.isSafeInteger(intent.selectedAt) && Number.isSafeInteger(deadlineAt)
    && deadlineAt > intent.selectedAt && deadlineAt - intent.selectedAt <= limits.maxJobMs, 'bounded assignment deadline required');
  const operation = { name: model.executablePack.requiredOperation, version: registry[model.executablePack.requiredOperation].version };
  if (!legacy) {
    const definition = registry[operation.name].definition;
    requirePackJob(Number.isSafeInteger(intent.attemptNumber) && intent.attemptNumber > 0
      && intent.attemptNumber <= policy.attempts.maximumNumber, 'explicit bounded attempt number required');
    requirePackJob(definition.inputClasses.remote.includes(intent.inputClass), 'operation does not permit this remote input class');
    requirePackJob(intent.operationPolicyDigest === await hashDopplerEvidence(registry[operation.name].policy)
      && intent.jobPolicyDigest === await hashDopplerEvidence(policy), 'assignment policy differs from resolved configuration');
    requirePackJob(intent.operationPolicyDigest === await hashDopplerEvidence(intent.operationPolicy)
      && intent.jobPolicyDigest === await hashDopplerEvidence(intent.jobPolicy), 'signed policy snapshot mismatch');
    requirePackJob(await equal(intent.adapterSet, policy.execution.adapterSet), 'adapter set is outside resolved execution policy');
  }
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
  if (!legacy) Object.assign(assignment, { attemptNumber: intent.attemptNumber, inputClass: intent.inputClass,
    operationPolicyDigest: intent.operationPolicyDigest, jobPolicyDigest: intent.jobPolicyDigest, adapterSet: intent.adapterSet });
  const request = { schema: 'doppler.pack-operation-request/v1', operation, input, options, assignment,
    limits: { maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes, deadlineAt } };
  assertPackOperationRequest(model.executablePack, request, registry);
  return { assignment, request };
}

export async function createPackPeerJob({ identity, advert, model, input, options = {}, limits, consent, comparisonPolicy,
  jobId = crypto.randomUUID(), attemptId = crypto.randomUUID(), attemptNumber, adapterSet,
  registry = createPackOperationRegistry(), policy: policyInput = PACK_JOB_POLICY }) {
  const policy = resolvePackJobPolicy(policyInput);
  if (attemptNumber === undefined) attemptNumber = policy.attempts.initialNumber;
  if (adapterSet === undefined) adapterSet = policy.execution.adapterSet;
  // Snapshot before the first await, including nested policy and model objects.
  const data = snapshot({ advert, model: packPeerModel(model, registry), input, options, limits, consent, comparisonPolicy, jobId, attemptId, attemptNumber, adapterSet });
  advert = await verifyPackPeerMessage(data.advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, policy });
  const intent = { model: data.model, limits: data.limits, consent: data.consent, comparisonPolicy: data.comparisonPolicy,
    jobId, attemptId, attemptNumber, adapterSet: data.adapterSet, inputClass: registry[data.model.executablePack.requiredOperation].definition.inputClasses.defaultRemote,
    operationPolicy: registry[data.model.executablePack.requiredOperation].policy, jobPolicy: policy,
    operationPolicyDigest: await hashDopplerEvidence(registry[data.model.executablePack.requiredOperation].policy),
    jobPolicyDigest: await hashDopplerEvidence(policy), selectedAt: Date.now(), inputHash: await hashDopplerEvidence({ input: data.input, options: data.options }) };
  const parts = await jobParts({ requesterId: identity.keyId, advert, intent, input: data.input, options: data.options, registry, policy });
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: advert.fromPeerId,
    expiresAt: data.limits.deadlineAt, policy, body: { schema: PACK_JOB_SCHEMA, advert, intent, ...parts } });
}

export async function verifyPackPeerJob(message, { providerId, models, registry = createPackOperationRegistry(), now = Date.now(), allowLegacy = false, policy = PACK_JOB_POLICY }) {
  const job = await verifyPackPeerMessage(message, { type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: providerId, now, policy });
  const legacy = job.body.schema === policy.schemas.legacyJob;
  requirePackJob(job.body.schema === PACK_JOB_SCHEMA || (allowLegacy && legacy), 'unknown job schema');
  const { advert, intent, assignment, request } = job.body;
  requirePackJob(intent.selectedAt <= now && intent.selectedAt >= Date.parse(job.createdAt) - policy.limits.maxClockSkewMs
    && job.expiresAt === new Date(intent.limits.deadlineAt).toISOString(), 'selection time or expiry mismatch');
  await verifyPackPeerMessage(advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, sender: providerId, now: intent.selectedAt, policy });
  requirePackJob((await Promise.all(models.map(model => equal(packPeerModel(model, registry), intent.model)))).some(Boolean), 'model is outside application pins');
  const expected = await jobParts({ requesterId: job.fromPeerId, advert, intent, input: request.input, options: request.options, registry, legacy, policy });
  requirePackJob(await equal(assignment, expected.assignment) && await equal(request, expected.request), 'assignment or request does not match signed authority');
  return job;
}

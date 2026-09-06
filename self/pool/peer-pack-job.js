import { resolveOperationAcceptance } from './operation-acceptance.js';
/** Application-pinned complete jobs. Public catalog admission remains separate. */
import { normalizeExecutionAdapterSet, dopplerExecutionAdapterSet } from './adapter-execution.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { assertOperationLimits } from './pack-operation-policy.js';
import { hashJson, sha256Hex } from './inference-receipt.js';
import { createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { validateOperationModel } from './operation-model.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { assertPackOperationRequest, snapshotPackOperationData as snapshot } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { validateProviderCapabilities, validateWorkRequirements } from './peer-capabilities.js';
import { planOperationProviders } from './peer-planning.js';

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
    'executionMode', 'workload', 'runtimeVersion', 'executablePack', 'artifactIdentity', 'tokenizerHash'].filter(key => model[key] !== undefined).map(key => [key, model[key]])));
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

async function checkAdvertCapabilities(advert, { registry, policy, now }) {
  requirePackJob(advert.body.schema === policy.schemas.providerAdvert, 'resource capability advertisement required');
  validatePackPeerLimits(advert.body.limits, policy);
  requirePackJob(Array.isArray(advert.body.models) && advert.body.models.length > 0
    && advert.body.models.length <= policy.limits.maxModels, 'bounded model pins required');
  const models = advert.body.models.map(model => packPeerModel(model, registry));
  const capabilities = validateProviderCapabilities(advert.body.capabilities, { schema: policy.providerCapabilitySchema, now });
  const identities = await Promise.all(models.map(hashDopplerEvidence));
  requirePackJob(identities.length === capabilities.models.length && capabilities.models.every(row => identities.includes(row.identity)), 'capability model identity mismatch');
  requirePackJob(capabilities.operations.every(operation => registry[operation.name]?.version === operation.version), 'unknown advertised operation');
  for (const model of models) requirePackJob(capabilities.operations.some(operation => operation.name === model.executablePack.requiredOperation
    && operation.version === registry[operation.name].version), 'advertised model operation missing');
  return { providerId: advert.fromPeerId, advertHash: advert.messageHash, capabilities, limits: advert.body.limits };
}

export async function createPackProviderAdvert({ identity, models, limits, capabilities, expiresAt, registry = createPackOperationRegistry(), policy = PACK_JOB_POLICY }) {
  validatePackPeerLimits(limits, policy);
  requirePackJob(Array.isArray(models) && models.length > 0 && models.length <= policy.limits.maxModels, 'bounded model pins required');
  const body = snapshot({ schema: policy.schemas.providerAdvert, models: models.map(model => packPeerModel(model, registry)), limits, capabilities });
  await checkAdvertCapabilities({ body, fromPeerId: identity.keyId, messageHash: null }, { registry, policy, now: Date.now() });
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, expiresAt, policy,
    body });
}

/** Verify signed observations before handing an immutable snapshot to the pure planner. */
export async function planPackPeerProviders({ adverts, requirements, now, registry = createPackOperationRegistry(), policy = PACK_JOB_POLICY }) {
  ({ adverts, requirements } = snapshot({ adverts, requirements }));
  requirePackJob(Array.isArray(adverts) && adverts.length > 0 && adverts.length <= policy.assignmentPolicy.maxCandidates, 'bounded provider advertisements required');
  const candidates = [];
  for (const advert of adverts) {
    await verifyPackPeerMessage(advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, now, policy });
    candidates.push(await checkAdvertCapabilities(advert, { registry, policy, now }));
  }
  return planOperationProviders({ requirements, candidates, now, observations: null,
    policy: policy.assignmentPolicy, capabilitySchema: policy.providerCapabilitySchema });
}

async function workRequirements(intent, operation) {
  requirePackJob(intent.consent?.schema === 'reploid.peer.public_operation_consent/v1' && intent.consent.publicInput === true
    && Array.isArray(intent.consent.providerIds) && intent.consent.providerIds.length > 0, 'explicit public input and provider consent required');
  const { deadlineAt: _deadline, ...limits } = intent.limits;
  return validateWorkRequirements({ schema: 'reploid.pool.work-requirements/v1', modelIdentity: await hashDopplerEvidence(intent.model),
    operation, inputClass: intent.inputClass, adapterIdentities: intent.adapterSet.map(entry => typeof entry === 'string' ? entry : entry.identity), expertIdentities: [],
    providerIds: intent.consent.providerIds, resources: intent.resources, limits });
}

async function jobParts({ requesterId, advert, intent, input, options, registry, legacy = false, policy = PACK_JOB_POLICY }) {
  const model = packPeerModel(intent.model, registry);
  const advertSchema = !legacy && policy.version >= 2 ? policy.schemas.providerAdvert : 'reploid.peer.pack_provider/v1';
  requirePackJob(await equal(model, intent.model) && advert.body.schema === advertSchema, 'invalid model pin or advert');
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
    if (policy.version < 3) requirePackJob(await equal(intent.adapterSet, policy.execution.adapterSet), 'adapter set is outside resolved execution policy');
    else await normalizeExecutionAdapterSet(intent.adapterSet, { model, policy: policy.execution.adapters });
    if (policy.version >= 2) {
      const requirements = await workRequirements(intent, operation);
      const plan = await planPackPeerProviders({ adverts: intent.planning.adverts, requirements, now: intent.selectedAt, registry, policy });
      requirePackJob(await equal(plan, intent.planning.plan) && plan.selectedProviderId === advert.fromPeerId
        && plan.candidates.some(row => row.providerId === advert.fromPeerId && row.advertHash === advert.messageHash), 'assignment differs from deterministic provider plan');
    }
  }
  requirePackJob(intent.inputHash === await hashDopplerEvidence({ input, options }), 'input differs from signed intent');
  if (!legacy && policy.version === 3) {
    const acceptance = await resolveOperationAcceptance({ mode: intent.acceptance?.mode, operation, comparisonPolicy: intent.comparisonPolicy, policy: policy.acceptance });
    requirePackJob(await equal(acceptance, intent.acceptance), 'acceptance policy mismatch');
  } else requirePackJob(intent.comparisonPolicy?.schema === 'poolday.operation-comparison/v1'
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
  if (!legacy && policy.version === 3) assignment.acceptancePolicyDigest = await hashDopplerEvidence(intent.acceptance);
  if (!legacy) Object.assign(assignment, { attemptNumber: intent.attemptNumber, inputClass: intent.inputClass,
    operationPolicyDigest: intent.operationPolicyDigest, jobPolicyDigest: intent.jobPolicyDigest, adapterSet: intent.adapterSet });
  const request = { schema: 'doppler.pack-operation-request/v1', operation, input, options, assignment,
    limits: { maxInputBytes: limits.maxInputBytes, maxOutputBytes: limits.maxOutputBytes, deadlineAt } };
  if (intent.adapterSet?.length) request.adapterSet = dopplerExecutionAdapterSet(intent.adapterSet, model);
  assertPackOperationRequest(model.executablePack, request, registry);
  return { assignment, request };
}

export async function createPackPeerJob({ identity, advert, adverts, model, input, options = {}, limits, consent, comparisonPolicy, resources,
  acceptanceMode, jobId = crypto.randomUUID(), attemptId = crypto.randomUUID(), attemptNumber, adapterSet,
  registry = createPackOperationRegistry(), policy: policyInput = PACK_JOB_POLICY }) {
  const policy = resolvePackJobPolicy(policyInput);
  if (acceptanceMode === undefined) acceptanceMode = policy.acceptance.defaultMode;
  if (attemptNumber === undefined) attemptNumber = policy.attempts.initialNumber;
  if (adapterSet === undefined) adapterSet = policy.execution.adapters.defaultAdapterSet;
  // Snapshot before the first await, including nested policy and model objects.
  requirePackJob(policy.version === 3, 'new work requires current adapter execution policy');
  const data = snapshot({ adverts: adverts === undefined ? [advert] : adverts, model: packPeerModel(model, registry), input, options, limits, consent,
    comparisonPolicy, acceptanceMode, resources, jobId, attemptId, attemptNumber, adapterSet });
  const intent = { model: data.model, limits: data.limits, consent: data.consent, comparisonPolicy: data.comparisonPolicy,
    jobId, attemptId, attemptNumber, adapterSet: data.adapterSet, inputClass: registry[data.model.executablePack.requiredOperation].definition.inputClasses.defaultRemote,
    operationPolicy: registry[data.model.executablePack.requiredOperation].policy, jobPolicy: policy,
    operationPolicyDigest: await hashDopplerEvidence(registry[data.model.executablePack.requiredOperation].policy),
    jobPolicyDigest: await hashDopplerEvidence(policy), resources: data.resources,
    selectedAt: Date.now(), inputHash: await hashDopplerEvidence({ input: data.input, options: data.options }) };
  await normalizeExecutionAdapterSet(data.adapterSet, { model: data.model, policy: policy.execution.adapters });
  const operation = { name: data.model.executablePack.requiredOperation, version: registry[data.model.executablePack.requiredOperation].version };
  intent.acceptance = await resolveOperationAcceptance({ mode: data.acceptanceMode, operation, comparisonPolicy: data.comparisonPolicy, policy: policy.acceptance });
  const requirements = await workRequirements(intent, operation);
  const plan = await planPackPeerProviders({ adverts: data.adverts, requirements, now: intent.selectedAt, registry, policy });
  requirePackJob(plan.selectedProviderId, `no eligible provider for declared work: ${[...new Set(plan.candidates.flatMap(row => row.reasons))].join(', ')}`);
  const selectedHash = plan.candidates.find(row => row.providerId === plan.selectedProviderId).advertHash;
  advert = data.adverts.find(row => row.messageHash === selectedHash);
  intent.planning = { adverts: data.adverts, plan };
  const parts = await jobParts({ requesterId: identity.keyId, advert, intent, input: data.input, options: data.options, registry, policy });
  return signPackPeerMessage({ identity, type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: advert.fromPeerId,
    expiresAt: data.limits.deadlineAt, policy, body: { schema: PACK_JOB_SCHEMA, advert, intent, ...parts } });
}

export async function verifyPackPeerJob(message, { providerId, models, registry = createPackOperationRegistry(), now = Date.now(), allowLegacy = false, policy = PACK_JOB_POLICY }) {
  const job = await verifyPackPeerMessage(message, { type: PEER_MESSAGE_TYPES.ASSIGNMENT_CLAIM, recipient: providerId, now, policy });
  const legacy = job.body.schema === policy.schemas.legacyJob;
  requirePackJob(job.body.schema === policy.schemas.job || (allowLegacy && legacy), 'unknown job schema');
  const { advert, intent, assignment, request } = job.body;
  requirePackJob(intent.selectedAt <= now && intent.selectedAt >= Date.parse(job.createdAt) - policy.limits.maxClockSkewMs
    && job.expiresAt === new Date(intent.limits.deadlineAt).toISOString(), 'selection time or expiry mismatch');
  await verifyPackPeerMessage(advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, sender: providerId, now: intent.selectedAt, policy });
  requirePackJob((await Promise.all(models.map(model => equal(packPeerModel(model, registry), intent.model)))).some(Boolean), 'model is outside application pins');
  const expected = await jobParts({ requesterId: job.fromPeerId, advert, intent, input: request.input, options: request.options, registry, legacy, policy });
  requirePackJob(await equal(assignment, expected.assignment) && await equal(request, expected.request), 'assignment or request does not match signed authority');
  return job;
}

/** A signed connection request carries no operation input or output. */
export async function createPackPeerConnection({ identity, assignment, policy = PACK_JOB_POLICY }) {
  requirePackJob(assignment.requesterId === identity.keyId, 'connection requester mismatch');
  return signPackPeerMessage({ identity, policy, type: PEER_MESSAGE_TYPES.HEARTBEAT, recipient: assignment.providerId,
    expiresAt: Date.parse(assignment.expiresAt), body: { schema: 'reploid.peer.operation-connect/v1',
      assignmentId: assignment.assignmentId, requesterId: identity.keyId, providerId: assignment.providerId,
      providerAdvertHash: assignment.providerAdvertHash, model: assignment.model } });
}

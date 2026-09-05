import { canonicalize, hashJson, sha256Hex, buildPoolReceipt, signProviderReceipt, countersignReceipt,
  receiptSigningPayload, acceptanceSigningPayload, verifyCanonicalSignature, SIGNATURE_DOMAINS } from './inference-receipt.js';
import { createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { exactModelContractKey } from './model-contract.js';
import { evaluateProviderRouteCandidate, compareProviderRouteCandidates, sealArtifactRouteDecision } from './artifact-router.js';
import { receiptMatchesAssignment } from './peer-agreement.js';
import { assertPackExecutionEvidence, hashDopplerEvidence } from './executable-pack.js';
import { FORECAST_WORKLOAD, validateForecastModelContract, validateForecastValues, validateForecastCosts } from './forecast-workload.js';

const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
const copy = value => JSON.parse(canonicalize(value));

function assertConfig(config, model) {
  if (!config || !Number.isInteger(config.horizon) || config.horizon < 1 || config.horizon > model.forecast.maxHorizon ||
      canonicalize(config.quantiles) !== canonicalize(model.forecast.quantiles) || !Number.isSafeInteger(config.stepMs) ||
      config.stepMs < 1 || typeof config.lastObservation !== 'string' || !Number.isFinite(Date.parse(config.lastObservation))) throw new Error('Invalid complete forecast configuration');
}

function assertModel(model, expected) {
  const checked = validateForecastModelContract(model);
  if (!checked.ok || !expected || canonicalize(model) !== canonicalize(expected)) throw new Error('Forecast model differs from the consuming application catalog pin');
}

export function validateForecastPolicy(policy) {
  if (!policy || policy.schema !== 'reploid.pool.forecast-policy/v1' || typeof policy.id !== 'string' || !policy.id ||
      policy.sensitivity !== 'public' || !Array.isArray(policy.providerIds) || !policy.providerIds.length || policy.providerIds.length > 8 ||
      policy.providerIds.some(id => !digest(id)) || new Set(policy.providerIds).size !== policy.providerIds.length ||
      !Number.isInteger(policy.replicas) || policy.replicas < 1 || policy.replicas > 3 || policy.replicas > policy.providerIds.length ||
      !Number.isSafeInteger(policy.maxJobMs) || policy.maxJobMs < 1 || policy.maxJobMs > 300000 ||
      !Number.isFinite(policy.absoluteTolerance) || policy.absoluteTolerance < 0 || policy.absoluteTolerance > 0.01 ||
      !Number.isFinite(policy.relativeTolerance) || policy.relativeTolerance < 0 || policy.relativeTolerance > 0.001) throw new Error('Invalid explicit public forecast execution policy');
}

export async function verifyForecastPeerMessage(message, { type, recipient = null, now = Date.now() } = {}) {
  const candidate = copy(message);
  if (canonicalize(candidate).length > 64 * 1024 || candidate.type !== type || candidate.toPeerId !== recipient ||
      typeof candidate.publicKey !== 'string' || candidate.publicKey.length > 1024 || !digest(candidate.fromPeerId) ||
      !Number.isFinite(now) || !Number.isFinite(Date.parse(candidate.createdAt)) || Date.parse(candidate.createdAt) > now + 5000 ||
      !Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) > now + 300000 ||
      Date.parse(candidate.expiresAt) - Date.parse(candidate.createdAt) > 300000) throw new Error('Forecast peer envelope scope, size or validity rejected');
  const key = Uint8Array.from(atob(candidate.publicKey), c => c.charCodeAt(0));
  if (await sha256Hex(key) !== candidate.fromPeerId) throw new Error('Provider identity does not bind its signing key');
  const checked = await verifyPeerMessage(candidate, { now });
  if (!checked.ok) throw new Error(checked.reasons.join('; '));
  return candidate;
}

export async function createForecastProviderAdvert({ identity, model, availability, expiresAt }) {
  assertModel(model, model);
  const body = copy({ schema: 'reploid.peer.provider_advert/v1', providerId: identity.keyId, models: [model],
    availability, reputationEvidence: {} });
  return createSignedPeerMessage({ type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, fromPeerId: identity.keyId,
    publicKey: identity.publicKey, privateKey: identity.privateKey, body, expiresAt });
}

export async function createForecastIntent({ identity, model, domain, config, policy, expiresAt }) {
  model = copy(model); domain = copy(domain); config = copy(config); policy = copy(policy);
  assertModel(model, model); validateForecastPolicy(policy);
  for (const field of ['roomRoot', 'policyHash', 'runHash', 'snapshotHash']) if (!digest(domain[field])) throw new Error('Forecast domain reference missing: ' + field);
  if (typeof domain.roomId !== 'string' || !domain.roomId || domain.roomId.length > 128) throw new Error('Invalid forecast room identity');
  assertConfig(config, model);
  const body = { schema: 'reploid.peer.job_intent/v1', requesterId: identity.keyId, policyId: policy.id,
    policyConfigVersion: policy.schema, policyConfigHash: await hashJson(policy), policy,
    inputHash: await hashJson({ runHash: domain.runHash, snapshotHash: domain.snapshotHash }), inputKind: 'timeseries',
    inputTransport: 'webrtc_datachannel', inputDisclosure: 'selected_providers_only', workload: FORECAST_WORKLOAD,
    domain, modelRequirements: model, generationConfig: config, generationConfigHash: await hashJson(config),
    policyClasses: ['explicitly_public_timeseries'], maxPointSpend: null };
  return createSignedPeerMessage({ type: PEER_MESSAGE_TYPES.JOB_INTENT, fromPeerId: identity.keyId,
    publicKey: identity.publicKey, privateKey: identity.privateKey, body, expiresAt });
}

async function validateIntent(intent, expectedModel, now = Date.now()) {
  intent = await verifyForecastPeerMessage(intent, { type: PEER_MESSAGE_TYPES.JOB_INTENT, now });
  assertModel(intent.body.modelRequirements, expectedModel); validateForecastPolicy(intent.body.policy);
  const body = intent.body;
  assertConfig(body.generationConfig, expectedModel);
  for (const field of ['roomRoot', 'policyHash', 'runHash', 'snapshotHash']) if (!digest(body.domain?.[field])) throw new Error('Missing forecast domain reference');
  if (body.requesterId !== intent.fromPeerId || body.workload !== FORECAST_WORKLOAD || body.policyId !== body.policy.id ||
      body.policyConfigHash !== await hashJson(body.policy) || body.generationConfigHash !== await hashJson(body.generationConfig) ||
      body.inputHash !== await hashJson({ runHash: body.domain.runHash, snapshotHash: body.domain.snapshotHash })) throw new Error('Forecast intent fields do not bind their signed configuration');
  return intent;
}

export async function assignForecastJob({ intent, adverts, expectedModel, assignmentAttemptId, history = null }) {
  adverts = copy(adverts); expectedModel = copy(expectedModel); history = history === null ? null : copy(history);
  if (typeof assignmentAttemptId !== 'string' || !assignmentAttemptId || assignmentAttemptId.length > 128 || !Array.isArray(adverts) || adverts.length > 8) throw new Error('Invalid assignment attempt or provider bound');
  intent = await validateIntent(intent, expectedModel);
  const candidates = [], accepted = [];
  for (const input of adverts.slice(0, 8)) {
    try {
      const advert = await verifyForecastPeerMessage(input, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT });
      if (!intent.body.policy.providerIds.includes(advert.fromPeerId)) throw new Error('Provider is outside explicit requester consent');
      if (advert.body.providerId !== advert.fromPeerId || advert.body.models.length !== 1) throw new Error('Provider advertisement identity rejected');
      assertModel(advert.body.models[0], expectedModel);
      if (accepted.some(entry => entry.advert.fromPeerId === advert.fromPeerId)) throw new Error('Duplicate provider key');
      // The portable forecasting path never scores self-advertised reputation.
      const candidate = evaluateProviderRouteCandidate({ advert, intent, ignoreAdvertisedEvidence: true,
        tieBreaker: await hashJson({ intentHash: intent.messageHash, providerId: advert.fromPeerId, assignmentAttemptId }) });
      candidates.push(candidate); if (candidate.eligible) accepted.push({ advert, candidate });
    } catch (error) {
      candidates.push({ providerId: input?.fromPeerId ?? null, eligible: false, rejectionReasons: [String(error)],
        adapterLifecycle: 'routable', artifactSourcePlan: 'unavailable', score: {} });
    }
  }
  accepted.sort((a, b) => compareProviderRouteCandidates(a.candidate, b.candidate));
  const selected = accepted.slice(0, intent.body.policy.replicas);
  const route = await sealArtifactRouteDecision({ intentHash: intent.messageHash, policyId: intent.body.policyId,
    modelRequirements: expectedModel, candidates, selectedProviderIds: selected.map(entry => entry.advert.fromPeerId), history });
  if (selected.length !== intent.body.policy.replicas) return { ok: false, reason: 'Insufficient authorized providers', route, assignments: [] };
  const assignments = [];
  for (const { advert } of selected) {
    const limits = { maxJobMs: Math.min(intent.body.policy.maxJobMs, advert.body.availability.maxJobMs),
      maxConcurrentJobs: advert.body.availability.maxConcurrentJobs };
    if (!Number.isSafeInteger(limits.maxJobMs) || limits.maxJobMs < 1 || !Number.isInteger(limits.maxConcurrentJobs) || limits.maxConcurrentJobs < 1) throw new Error('Provider execution limits missing');
    const identity = await sealPeerAssignmentIdentity({ intentHash: intent.messageHash, providerId: advert.fromPeerId,
      assignmentAttemptId, routeDecisionHash: route.decisionHash, providerAdvertHash: advert.messageHash,
      providerParticipationProfileHash: null, providerLimits: limits });
    assignments.push({ schema: 'reploid.peer.assignment/v1', ...identity, intentHash: intent.messageHash,
      routeDecisionHash: route.decisionHash, providerAdvertHash: advert.messageHash, providerParticipationProfileHash: null,
      providerLimits: limits, assignmentAttemptId, jobId: 'peer_job_' + intent.messageHash.slice(7, 23),
      requesterId: intent.fromPeerId, providerId: advert.fromPeerId, providerPublicKey: advert.publicKey,
      policyId: intent.body.policyId, policyConfigVersion: intent.body.policyConfigVersion, policyConfigHash: intent.body.policyConfigHash,
      workload: FORECAST_WORKLOAD, outputKind: FORECAST_WORKLOAD, inputKind: 'timeseries', inputTransport: 'webrtc_datachannel',
      inputHash: intent.body.inputHash, generationConfig: intent.body.generationConfig, generationConfigHash: intent.body.generationConfigHash,
      verificationLevel: 'signed_receipt', redundancyGroupSize: selected.length, requiredAgreement: selected.length,
      domain: intent.body.domain, model: { ...expectedModel, id: expectedModel.modelId, hash: expectedModel.modelHash,
        exactModelContractKey: exactModelContractKey(expectedModel), requirements: expectedModel }, adapter: null,
      expiresAt: intent.expiresAt });
  }
  return { ok: true, route, assignments };
}

export async function validateForecastAssignment({ assignment, intent, advert, expectedModel, route, now = Date.now() }) {
  assignment = copy(assignment); intent = copy(intent); advert = copy(advert); expectedModel = copy(expectedModel); route = copy(route);
  intent = await validateIntent(intent, expectedModel, now);
  advert = await verifyForecastPeerMessage(advert, { type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT, now });
  assertModel(advert.body.models[0], expectedModel);
  const { createdAt, decisionHash, ...routeIdentity } = route;
  if (advert.body.providerId !== advert.fromPeerId || advert.body.models.length !== 1 || advert.body.availability.acceptingJobs !== true ||
      new Set(route.selectedProviderIds).size !== route.selectedProviderIds.length ||
      !Number.isFinite(Date.parse(createdAt)) || Date.parse(createdAt) > now + 5000 ||
      decisionHash !== await hashJson(routeIdentity) || !route.selectedProviderIds.includes(advert.fromPeerId) ||
      route.intentHash !== intent.messageHash || route.policyId !== intent.body.policyId || route.selectedProviderIds.length !== intent.body.policy.replicas) throw new Error('Assignment routing decision mismatch');
  const identity = await sealPeerAssignmentIdentity({ intentHash: intent.messageHash, providerId: advert.fromPeerId,
    assignmentAttemptId: assignment.assignmentAttemptId, routeDecisionHash: route.decisionHash,
    providerAdvertHash: advert.messageHash, providerParticipationProfileHash: null, providerLimits: assignment.providerLimits });
  if (assignment.assignmentHash !== identity.assignmentHash || assignment.assignmentId !== identity.assignmentId ||
      assignment.requesterId !== intent.fromPeerId || assignment.providerId !== advert.fromPeerId || assignment.providerPublicKey !== advert.publicKey ||
      assignment.intentHash !== intent.messageHash || assignment.providerAdvertHash !== advert.messageHash || assignment.routeDecisionHash !== route.decisionHash ||
      assignment.inputHash !== intent.body.inputHash || assignment.generationConfigHash !== intent.body.generationConfigHash ||
      canonicalize(assignment.generationConfig) !== canonicalize(intent.body.generationConfig) || canonicalize(assignment.domain) !== canonicalize(intent.body.domain) ||
      !intent.body.policy.providerIds.includes(assignment.providerId) || assignment.expiresAt !== intent.expiresAt ||
      !Number.isSafeInteger(assignment.providerLimits.maxJobMs) || assignment.providerLimits.maxJobMs < 1 ||
      assignment.providerLimits.maxJobMs !== Math.min(intent.body.policy.maxJobMs, advert.body.availability.maxJobMs) ||
      assignment.providerLimits.maxConcurrentJobs !== advert.body.availability.maxConcurrentJobs ||
      assignment.schema !== 'reploid.peer.assignment/v1' || assignment.policyId !== intent.body.policyId || assignment.workload !== FORECAST_WORKLOAD ||
      assignment.outputKind !== FORECAST_WORKLOAD || assignment.inputKind !== 'timeseries' || assignment.inputTransport !== 'webrtc_datachannel' ||
      assignment.redundancyGroupSize !== intent.body.policy.replicas || assignment.requiredAgreement !== intent.body.policy.replicas ||
      assignment.policyConfigVersion !== intent.body.policyConfigVersion || assignment.providerParticipationProfileHash !== null ||
      assignment.verificationLevel !== 'signed_receipt' || assignment.adapter !== null ||
      assignment.policyConfigHash !== intent.body.policyConfigHash || exactModelContractKey(assignment.model) !== exactModelContractKey(expectedModel)) throw new Error('Complete forecast assignment differs from its signed intent and provider');
  return true;
}

async function assertExecution({ assignment, model, request, output, executionReceipt }) {
  if (exactModelContractKey(assignment.model) !== exactModelContractKey(model) || !Array.isArray(request.context) ||
      request.context.length < 8 || request.context.length > model.forecast.contextLength || request.context.some(value => !Number.isFinite(value))) throw new Error('Unqualified forecast model or context');
  validateForecastValues(output, assignment.generationConfig);
  for (let h = 0; h < output.timestamps.length; h++) if (Date.parse(output.timestamps[h]) !==
    Date.parse(assignment.generationConfig.lastObservation) + (h + 1) * assignment.generationConfig.stepMs) throw new Error('Forecast period differs from the assignment');
  await assertPackExecutionEvidence(model.executablePack, executionReceipt);
  const { receiptDigest, ...receiptPayload } = executionReceipt;
  if (executionReceipt.schema !== 'doppler.pack-execution-receipt/v1' || executionReceipt.operation !== 'forecast' ||
      receiptDigest !== await hashDopplerEvidence(receiptPayload) || executionReceipt.assignmentHash !== await hashDopplerEvidence(assignment) ||
      await hashJson(request.application) !== model.forecast.applicationDigest ||
      request.horizon !== assignment.generationConfig.horizon || request.assignmentHash !== executionReceipt.assignmentHash ||
      executionReceipt.inputHash !== await hashDopplerEvidence(request) ||
      executionReceipt.outputHash !== await hashDopplerEvidence({ horizon: output.point.length, quantileLevels: assignment.generationConfig.quantiles,
        layout: 'time-quantile', values: output.quantiles.flat() })) throw new Error('Doppler receipt does not bind the complete forecast assignment and output');
}

export async function createForecastReceipt({ identity, assignment, request, output, executionReceipt, costs }) {
  assignment = copy(assignment); request = copy(request); output = copy(output); executionReceipt = copy(executionReceipt); costs = copy(costs);
  if (identity.keyId !== assignment.providerId) throw new Error('Only the assigned provider can sign this execution');
  validateForecastCosts(costs);
  await assertExecution({ assignment, model: assignment.model, request, output, executionReceipt });
  const forecast = { domain: assignment.domain, output, executionReceipt, costs };
  const receipt = await buildPoolReceipt({ assignment, provider: { device: {} }, model: assignment.model,
    runtime: { backend: 'browser-webgpu', execution: 'doppler-pack', hardwareAttestation: null },
    execution: { outputKind: FORECAST_WORKLOAD, outputText: canonicalize(output), transcript: forecast,
      dopplerProviderReceipt: executionReceipt, timing: { totalMs: costs.durationMs } } });
  return signProviderReceipt({ ...receipt, forecast }, identity.privateKey);
}

export async function verifyForecastReceipt({ receipt, assignment, request, expectedModel }) {
  receipt = copy(receipt); assignment = copy(assignment); request = copy(request); expectedModel = copy(expectedModel);
  const reasons = receiptMatchesAssignment(receipt, assignment);
  if (reasons.length || receipt.outputKind !== FORECAST_WORKLOAD || receipt.status !== 'completed' ||
      !await verifyCanonicalSignature(receiptSigningPayload(receipt), assignment.providerPublicKey, receipt.providerSignature,
        { domain: SIGNATURE_DOMAINS.providerReceipt }) || canonicalize(receipt.forecast?.domain) !== canonicalize(assignment.domain) ||
      receipt.transcriptHash !== await hashJson(receipt.forecast) || receipt.outputHash !== await hashJson(receipt.forecast.output)) throw new Error('Forecast provider receipt rejected: ' + reasons.join('; '));
  await assertExecution({ assignment, model: expectedModel, request, output: receipt.forecast.output, executionReceipt: receipt.forecast.executionReceipt });
  validateForecastCosts(receipt.forecast.costs);
  return { receiptHash: await hashJson(receipt), output: copy(receipt.forecast.output), costs: copy(receipt.forecast.costs) };
}

async function compareForecastExecutions({ intent, executions, expectedModel, now = Date.now() }) {
  intent = await validateIntent(intent, expectedModel, now);
  const policy = intent.body.policy;
  if (executions.length !== policy.replicas ||
      new Set(executions.map(entry => entry.assignment.providerId)).size !== executions.length) throw new Error('Incomplete independent-key execution comparison');
  const verified = [];
  for (const entry of executions) {
    if (entry.assignment.intentHash !== intent.messageHash || !policy.providerIds.includes(entry.assignment.providerId)) throw new Error('Execution is outside requester consent');
    await validateForecastAssignment({ assignment: entry.assignment, intent, advert: entry.advert, route: entry.route, expectedModel, now });
    verified.push(await verifyForecastReceipt({ ...entry, expectedModel }));
  }
  const reference = verified[0].output; let maxAbsoluteError = 0;
  for (const actual of verified.slice(1).map(entry => entry.output)) {
    if (canonicalize(actual.timestamps) !== canonicalize(reference.timestamps)) throw new Error('Provider forecast calendars disagree');
    for (let h = 0; h < reference.point.length; h++) for (let q = 0; q < intent.body.generationConfig.quantiles.length; q++) {
      const error = Math.abs(actual.quantiles[h][q] - reference.quantiles[h][q]); maxAbsoluteError = Math.max(maxAbsoluteError, error);
      if (error > policy.absoluteTolerance + policy.relativeTolerance * Math.abs(reference.quantiles[h][q])) throw new Error('Provider forecast values disagree');
    }
  }
  const receiptHashes = verified.map(entry => entry.receiptHash);
  const agreement = { schema: 'reploid.pool.forecast-agreement/v1', intentHash: intent.messageHash,
    receiptHashes, maxAbsoluteError, absoluteTolerance: policy.absoluteTolerance, relativeTolerance: policy.relativeTolerance };
  return { agreement, output: reference, verified };
}

export async function acceptForecastAgreement({ identity, intent, executions, expectedModel }) {
  identity = { ...identity }; intent = copy(intent); executions = copy(executions); expectedModel = copy(expectedModel);
  if (identity.keyId !== intent.fromPeerId) throw new Error('Only the requester can accept this forecast');
  const compared = await compareForecastExecutions({ intent, executions, expectedModel });
  const { agreement } = compared, policy = intent.body.policy, receiptHashes = agreement.receiptHashes;
  const acceptance = await countersignReceipt({ requesterId: identity.keyId, receiptHash: receiptHashes[0], receiptHashes,
    accepted: true, jobId: executions[0].assignment.jobId, policyId: policy.id, policyConfigVersion: policy.schema,
    policyConfigHash: intent.body.policyConfigHash, agreementHash: await hashJson(agreement) }, identity.privateKey);
  return { ...compared, acceptance, acceptanceHash: await hashJson(acceptance) };
}

/** Archive verification uses the signed acceptance instant, never a renewed live execution lease. */
export async function verifyForecastEpisode({ intent, executions, agreement, acceptance, expectedModel }) {
  intent = copy(intent); executions = copy(executions); agreement = copy(agreement); acceptance = copy(acceptance); expectedModel = copy(expectedModel);
  const now = Date.parse(acceptance.acceptedAt);
  if (!Number.isFinite(now) || now > Date.now() + 5000 || now < Date.parse(intent.createdAt) ||
      acceptance.accepted !== true || acceptance.requesterId !== intent.fromPeerId ||
      !await verifyCanonicalSignature(acceptanceSigningPayload(acceptance), intent.publicKey, acceptance.requesterSignature,
        { domain: SIGNATURE_DOMAINS.requesterAcceptance })) throw new Error('Invalid archived requester acceptance');
  const compared = await compareForecastExecutions({ intent, executions, expectedModel, now });
  if (canonicalize(agreement) !== canonicalize(compared.agreement) || acceptance.agreementHash !== await hashJson(agreement) ||
      canonicalize(acceptance.receiptHashes) !== canonicalize(agreement.receiptHashes) || acceptance.receiptHash !== agreement.receiptHashes[0] ||
      acceptance.jobId !== executions[0].assignment.jobId || acceptance.policyId !== intent.body.policyId ||
      acceptance.policyConfigVersion !== intent.body.policyConfigVersion || acceptance.policyConfigHash !== intent.body.policyConfigHash) throw new Error('Archived acceptance differs from its original forecast comparison');
  return { ...compared, acceptanceHash: await hashJson(acceptance) };
}

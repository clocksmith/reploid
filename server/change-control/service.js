/**
 * @fileoverview Change Passport application service over append-only storage.
 */

import { ensureIdentityBundle } from '../../self/identity.js';
import {
  buildChangePassportExport,
  createSignedChangePassportEvent,
  hashChangePassportValue,
  normalizeChangePassportEventPayload,
  projectChangePassportEvents,
  verifyChangePassportEvents
} from '../../self/shared/change-passport/contract.js';
import {
  authorizeChangePassportEffect,
  evaluateChangePassportGate,
  matchChangePassportReopeningTrigger,
  validateChangePassportPolicy
} from '../../self/shared/change-passport/policy.js';
import { assertChangeControlStore } from './store-contract.js';
import { toGitHubCheckProjection } from './github.js';
import { buildStandardChangeTriggerObservation } from './triggers.js';

const EVENT_ROLES = Object.freeze({
  'passport.created': ['proposer'],
  'proposal.recorded': ['proposer'],
  'evidence.admitted': ['evidence_producer', 'evaluator'],
  'evidence.excluded': ['evidence_producer', 'evaluator', 'security_reviewer'],
  'evidence.frozen': ['change_authority'],
  'evidence.invalidated': ['evidence_producer', 'evaluator', 'observer', 'change_authority'],
  'objection.recorded': ['evaluator', 'security_reviewer', 'change_authority'],
  'evaluation.recorded': ['evaluator'],
  'review.recorded': ['security_reviewer', 'change_authority'],
  'decision.recorded': ['change_authority'],
  'effect.requested': ['activator'],
  'effect.recorded': ['activator'],
  'outcome.recorded': ['observer'],
  'trigger.declared': ['change_authority'],
  'trigger.observed': ['observer'],
  'decision.reopened': ['change_authority'],
  'decision.revoked': ['change_authority'],
  'rollback.requested': ['rollback_authority'],
  'rollback.recorded': ['rollback_authority', 'activator'],
  'passport.superseded': ['change_authority']
});

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const statusError = (message, statusCode = 400, code = 'INVALID_REQUEST') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const requireIdempotencyKey = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw statusError('Idempotency-Key is required', 400, 'IDEMPOTENCY_REQUIRED');
  if (!/^[a-zA-Z0-9._:@/+~-]{1,500}$/.test(normalized)) {
    throw statusError('Idempotency-Key contains unsupported characters');
  }
  return normalized;
};

const requireAuth = (auth) => {
  if (!auth?.authorityId || !auth?.organizationId || !Array.isArray(auth.roles)) {
    throw statusError('Authenticated Change Passport principal is required', 401, 'AUTH_REQUIRED');
  }
  return auth;
};

const roleForEvent = (auth, type, requestedRole, projection = null) => {
  const allowed = new Set(EVENT_ROLES[type] || []);
  if (type === 'review.recorded') {
    for (const role of projection?.policy?.requiredReviewerRoles || []) allowed.add(role);
  }
  const role = String(requestedRole || '').trim();
  if (!role || !allowed.has(role)) throw statusError(`Role ${role || '(missing)'} cannot record ${type}`, 403, 'ROLE_FORBIDDEN');
  if (!auth.roles.includes(role)) throw statusError(`Authenticated principal does not hold role ${role}`, 403, 'ROLE_FORBIDDEN');
  return role;
};

const projectionFromEvents = async (events) => {
  const integrity = await verifyChangePassportEvents(events);
  const projection = projectChangePassportEvents(events, integrity);
  if (!projection || !integrity.valid) {
    throw statusError(`Stored Change Passport integrity failed: ${integrity.reasons.join('; ')}`, 500, 'STORED_INTEGRITY_FAILED');
  }
  return projection;
};

export function createChangeControlService({
  store,
  recorderIdentity = null,
  githubClient = null,
  effectRegistry = null,
  detailsBaseUrl = null,
  now = () => new Date().toISOString()
} = {}) {
  const durableStore = assertChangeControlStore(store);
  const identityPromise = recorderIdentity
    ? Promise.resolve(recorderIdentity)
    : ensureIdentityBundle({ forceNew: true });

  const actorFor = async (auth, role) => {
    const contextHash = await hashChangePassportValue({
      subject: auth.subject,
      authorityId: auth.authorityId,
      organizationId: auth.organizationId,
      authenticationKind: auth.authenticationKind
    });
    return {
      authorityId: auth.authorityId,
      organizationId: auth.organizationId,
      role,
      authentication: {
        kind: auth.authenticationKind || 'authenticated_record',
        subject: auth.subject || auth.authorityId,
        contextHash
      }
    };
  };

  const resultForEvents = async (events, githubCheck = null) => {
    const projection = await projectionFromEvents(events);
    return {
      projection,
      gate: evaluateChangePassportGate(projection),
      ...(githubCheck ? { githubCheck } : {})
    };
  };

  const syncGitHubCheck = async (projection, gate) => {
    if (!githubClient?.upsertCheck) return { attempted: false, reason: 'github_not_configured' };
    const repository = projection.proposal?.repository || {};
    if (repository.provider !== 'github' || !repository.installationId) {
      return { attempted: false, reason: 'github_installation_not_bound' };
    }
    const check = toGitHubCheckProjection(projection, gate);
    const deliveryId = `${projection.passportId}-${projection.integrity.eventCount}`;
    const request = {
      installationId: repository.installationId,
      owner: repository.owner,
      repo: repository.name,
      headSha: projection.proposal.candidateRevision,
      passportId: projection.passportId,
      ...check,
      detailsUrl: detailsBaseUrl
        ? `${String(detailsBaseUrl).replace(/\/$/, '')}/passports?id=${encodeURIComponent(projection.passportId)}`
        : null
    };
    const requestHash = await hashChangePassportValue(request);
    const prior = await durableStore.getDelivery('github_check', deliveryId);
    if (prior) return prior;
    let result;
    try {
      const response = await githubClient.upsertCheck(request);
      result = { attempted: true, ok: true, request, response };
    } catch (error) {
      result = { attempted: true, ok: false, request, error: error.message };
    }
    return durableStore.saveDelivery({ source: 'github_check', deliveryId, requestHash, result });
  };

  const getOwnedEvents = async (passportId, auth) => {
    requireAuth(auth);
    const events = await durableStore.getEvents(passportId);
    if (!events) throw statusError('Change Passport not found', 404, 'NOT_FOUND');
    const projection = await projectionFromEvents(events);
    if (projection.organizationId !== auth.organizationId) {
      throw statusError('Change Passport belongs to another organization', 404, 'NOT_FOUND');
    }
    return { events, projection };
  };

  const createPassport = async ({ payload, role = 'proposer', idempotencyKey }, authInput) => {
    const auth = requireAuth(authInput);
    roleForEvent(auth, 'passport.created', role);
    if (payload.organizationId !== auth.organizationId) {
      throw statusError('Passport organization does not match authenticated organization', 403, 'ORGANIZATION_MISMATCH');
    }
    if (payload.proposal?.proposerAuthorityId !== auth.authorityId) {
      throw statusError('Proposal authority does not match authenticated principal', 403, 'AUTHORITY_MISMATCH');
    }
    const policyValidation = await validateChangePassportPolicy(payload.policy);
    if (!policyValidation.valid) {
      throw statusError(`Change Passport policy is invalid: ${policyValidation.reasons.join('; ')}`);
    }
    if (payload.rollback?.authorityId !== payload.policy.rollbackAuthorityId) {
      throw statusError('Rollback contract and policy authority mismatch');
    }
    const key = requireIdempotencyKey(idempotencyKey);
    const actor = await actorFor(auth, role);
    const event = await createSignedChangePassportEvent({
      passportId: payload.passportId,
      type: 'passport.created',
      payload,
      actor,
      identityBundle: await identityPromise,
      timestamp: now()
    });
    const requestHash = await hashChangePassportValue({ type: event.type, payload: event.payload, actor, key });
    await durableStore.createPassport({
      passportId: payload.passportId,
      event,
      idempotencyKey: key,
      requestHash
    });
    const events = await durableStore.getEvents(payload.passportId);
    const result = await resultForEvents(events);
    result.githubCheck = await syncGitHubCheck(result.projection, result.gate);
    return result;
  };

  const appendOne = async ({ passportId, type, payload, role, idempotencyKey }, authInput) => {
    const auth = requireAuth(authInput);
    const { events, projection } = await getOwnedEvents(passportId, auth);
    const selectedRole = roleForEvent(auth, type, role, projection);
    const actor = await actorFor(auth, selectedRole);
    const key = requireIdempotencyKey(idempotencyKey);
    const normalizedPayload = normalizeChangePassportEventPayload(type, payload);
    const requestHash = await hashChangePassportValue({ type, payload: normalizedPayload, actor, key });
    const prior = await durableStore.getIdempotency(passportId, `append:${key}`);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        throw statusError('Idempotency-Key reused with different input', 409, 'IDEMPOTENCY_CONFLICT');
      }
      const currentEvents = await durableStore.getEvents(passportId);
      const result = await resultForEvents(currentEvents);
      result.appendedEvents = [prior.result.event];
      result.githubCheck = await syncGitHubCheck(result.projection, result.gate);
      return result;
    }

    if (type === 'decision.recorded' && normalizedPayload.state === 'approved') {
      const gate = evaluateChangePassportGate(projection);
      if (!gate.eligible) throw statusError(`Approval gate is blocked: ${gate.reasons.join('; ')}`, 409, 'GATE_BLOCKED');
    }
    if (type === 'effect.requested') {
      const authorization = authorizeChangePassportEffect(projection, normalizedPayload, actor);
      if (!authorization.authorized) {
        throw statusError(`Effect is not authorized: ${authorization.reasons.join('; ')}`, 403, 'EFFECT_FORBIDDEN');
      }
    }
    if (type === 'rollback.requested' && auth.authorityId !== projection.rollback.authorityId) {
      throw statusError('Authenticated principal is not the frozen rollback authority', 403, 'ROLLBACK_FORBIDDEN');
    }
    const event = await createSignedChangePassportEvent({
      passportId,
      events,
      type,
      payload: normalizedPayload,
      actor,
      identityBundle: await identityPromise,
      timestamp: now()
    });
    await durableStore.appendEvent({
      passportId,
      event,
      expectedSequence: events.length,
      idempotencyKey: key,
      requestHash
    });
    const nextEvents = await durableStore.getEvents(passportId);
    const result = await resultForEvents(nextEvents);
    result.appendedEvents = [event];
    result.githubCheck = await syncGitHubCheck(result.projection, result.gate);
    return result;
  };

  const observeTrigger = async ({ passportId, payload, role = 'observer', idempotencyKey }, authInput) => {
    const auth = requireAuth(authInput);
    const { events, projection } = await getOwnedEvents(passportId, auth);
    roleForEvent(auth, 'trigger.observed', role, projection);
    const rule = (projection.policy.reopeningRules || []).find((entry) => entry.ruleId === payload.ruleId);
    if (!rule) throw statusError('Trigger rule is not declared', 400, 'TRIGGER_UNDECLARED');
    if (auth.authorityId !== rule.sensorAuthorityId) {
      throw statusError('Authenticated principal is not the declared trigger sensor', 403, 'TRIGGER_SENSOR_MISMATCH');
    }
    const observationPayload = {
      ...cloneJson(payload),
      sourceKind: rule.sourceKind,
      observationKind: rule.observationKind,
      targetId: rule.targetId,
      sensorAuthorityId: rule.sensorAuthorityId,
      action: rule.action,
      freshnessMilliseconds: rule.freshnessMilliseconds
    };
    const actor = await actorFor(auth, role);
    const key = requireIdempotencyKey(idempotencyKey);
    const normalizedPayload = normalizeChangePassportEventPayload('trigger.observed', observationPayload);
    const triggerRequestHash = await hashChangePassportValue({
      type: 'trigger.observed',
      payload: normalizedPayload,
      actor,
      key
    });
    const prior = await durableStore.getIdempotency(passportId, `append:${key}:observed`);
    if (prior) {
      if (prior.requestHash !== triggerRequestHash) {
        throw statusError('Idempotency-Key reused with different input', 409, 'IDEMPOTENCY_CONFLICT');
      }
      const currentEvents = await durableStore.getEvents(passportId);
      const triggerEvent = prior.result.event;
      const reopeningEvent = currentEvents.find((event) => (
        event.type === 'decision.reopened'
        && event.payload?.triggerEventHash === triggerEvent.eventHash
      ));
      const result = await resultForEvents(currentEvents);
      result.appendedEvents = [triggerEvent, ...(reopeningEvent ? [reopeningEvent] : [])];
      result.triggerMatch = matchChangePassportReopeningTrigger(
        projection,
        triggerEvent.payload,
        Date.parse(triggerEvent.timestamp)
      );
      result.githubCheck = await syncGitHubCheck(result.projection, result.gate);
      return result;
    }
    const triggerEvent = await createSignedChangePassportEvent({
      passportId,
      events,
      type: 'trigger.observed',
      payload: normalizedPayload,
      actor,
      identityBundle: await identityPromise,
      timestamp: now()
    });
    await durableStore.appendEvent({
      passportId,
      event: triggerEvent,
      expectedSequence: events.length,
      idempotencyKey: `${key}:observed`,
      requestHash: triggerRequestHash
    });
    const matched = matchChangePassportReopeningTrigger(
      projection,
      normalizedPayload,
      Date.parse(triggerEvent.timestamp)
    );
    const appendedEvents = [triggerEvent];
    if (matched.matched && ['approved', 'reopened'].includes(projection.decision.state)) {
      const withTrigger = [...events, triggerEvent];
      const automaticAuth = {
        subject: 'change-control-trigger-projector',
        authorityId: 'authority:change-control-service',
        organizationId: projection.organizationId,
        roles: ['change_authority'],
        authenticationKind: 'deterministic_projection'
      };
      const reopenActor = await actorFor(automaticAuth, 'change_authority');
      const reopenPayload = {
        reopeningId: `reopening:${triggerEvent.eventHash.slice(-24)}`,
        ruleId: rule.ruleId,
        triggerEventHash: triggerEvent.eventHash,
        requestedAction: rule.action,
        reason: `Declared trigger ${rule.ruleId} matched observation ${payload.observationHash}.`
      };
      const reopenEvent = await createSignedChangePassportEvent({
        passportId,
        events: withTrigger,
        type: 'decision.reopened',
        payload: reopenPayload,
        actor: reopenActor,
        identityBundle: await identityPromise,
        timestamp: now()
      });
      await durableStore.appendEvent({
        passportId,
        event: reopenEvent,
        expectedSequence: withTrigger.length,
        idempotencyKey: `${key}:reopened`,
        requestHash: await hashChangePassportValue({ type: reopenEvent.type, payload: reopenEvent.payload, key })
      });
      appendedEvents.push(reopenEvent);
    }
    const nextEvents = await durableStore.getEvents(passportId);
    const result = await resultForEvents(nextEvents);
    result.appendedEvents = appendedEvents;
    result.triggerMatch = matched;
    result.githubCheck = await syncGitHubCheck(result.projection, result.gate);
    return result;
  };

  const observeStandardTrigger = async ({
    passportId,
    kind,
    ruleId,
    data,
    observedAt,
    deduplicationKey,
    role = 'observer',
    idempotencyKey
  }, authInput) => {
    const auth = requireAuth(authInput);
    const { projection } = await getOwnedEvents(passportId, auth);
    const rule = (projection.policy.reopeningRules || []).find((entry) => entry.ruleId === ruleId);
    if (!rule) throw statusError('Trigger rule is not declared', 400, 'TRIGGER_UNDECLARED');
    const payload = await buildStandardChangeTriggerObservation({
      kind,
      rule,
      data,
      observedAt: observedAt || now(),
      deduplicationKey
    });
    return observeTrigger({ passportId, payload, role, idempotencyKey }, auth);
  };

  const executionDeliveryId = (source, passportId, requestId) => hashChangePassportValue({
    source,
    passportId,
    requestId
  });

  const requireMatchingExecutionRequest = async ({
    passportId,
    requestHash,
    existingEvent,
    label
  }) => {
    if (!existingEvent) return null;
    const existingHash = await hashChangePassportValue({ passportId, request: existingEvent.payload });
    if (existingHash !== requestHash) {
      throw statusError(`${label} identity is already bound to a different request`, 409, 'EXECUTION_ID_CONFLICT');
    }
    return existingEvent;
  };

  const requireMatchingDelivery = (record, requestHash, label) => {
    if (record && record.requestHash !== requestHash) {
      throw statusError(`${label} delivery identity is bound to a different request`, 409, 'EXECUTION_ID_CONFLICT');
    }
    return record?.result || null;
  };

  const effectResultPayload = (request, execution) => ({
    effectId: request.effectId,
    status: execution.ok ? 'applied' : 'failed',
    targetId: request.targetId,
    candidateHash: request.candidateHash,
    externalReference: execution.externalReference || `reploid:effect:${request.effectId}`,
    observedAt: now(),
    ...(execution.ok ? {} : { failureReason: execution.error })
  });

  const rollbackResultPayload = (request, execution) => ({
    rollbackId: request.rollbackId,
    status: execution.ok ? 'succeeded' : 'failed',
    externalReference: execution.externalReference || `reploid:rollback:${request.rollbackId}`,
    observedAt: now(),
    ...(execution.ok ? {} : { failureReason: execution.error })
  });

  const executeEffect = async ({ passportId, payload, role = 'activator', idempotencyKey }, authInput) => {
    const auth = requireAuth(authInput);
    const key = requireIdempotencyKey(idempotencyKey);
    const owned = await getOwnedEvents(passportId, auth);
    roleForEvent(auth, 'effect.requested', role, owned.projection);
    const request = normalizeChangePassportEventPayload('effect.requested', payload);
    const requestHash = await hashChangePassportValue({ passportId, request });
    const deliveryId = await executionDeliveryId('effect_execution', passportId, request.effectId);
    const existingRequest = owned.events.find((event) => (
      event.type === 'effect.requested' && event.payload?.effectId === request.effectId
    ));
    await requireMatchingExecutionRequest({
      passportId,
      requestHash,
      existingEvent: existingRequest,
      label: 'Effect'
    });
    const requestResult = existingRequest
      ? { ...(await resultForEvents(owned.events)), appendedEvents: [existingRequest] }
      : await appendOne({
          passportId,
          type: 'effect.requested',
          payload: request,
          role,
          idempotencyKey: `${key}:requested`
        }, auth);
    const projection = requestResult.projection;
    const deliveryRecord = await durableStore.getDeliveryRecord('effect_execution', deliveryId);
    let execution = requireMatchingDelivery(deliveryRecord, requestHash, 'Effect');
    if (!execution) {
      try {
        const result = await effectRegistry?.executeEffect(request.kind, { projection, request, auth });
        if (!result) throw new Error(`No external effect adapter is configured for ${request.kind}`);
        execution = { ok: true, ...result };
      } catch (error) {
        execution = { ok: false, error: error.message };
      }
      execution = await durableStore.saveDelivery({
        source: 'effect_execution',
        deliveryId,
        requestHash,
        result: execution
      });
    }
    const current = await getOwnedEvents(passportId, auth);
    const existingResult = current.events.find((event) => (
      event.type === 'effect.recorded' && event.payload?.effectId === request.effectId
    ));
    if (existingResult) {
      const settled = await resultForEvents(current.events);
      settled.execution = execution;
      settled.githubCheck = await syncGitHubCheck(settled.projection, settled.gate);
      return settled;
    }
    const recorded = await appendOne({
      passportId,
      type: 'effect.recorded',
      role,
      idempotencyKey: `effect-recorded:${deliveryId.slice(7)}`,
      payload: effectResultPayload(request, execution)
    }, auth);
    return { ...recorded, execution };
  };

  const executeRollback = async ({ passportId, payload, role = 'rollback_authority', idempotencyKey }, authInput) => {
    const auth = requireAuth(authInput);
    const key = requireIdempotencyKey(idempotencyKey);
    const owned = await getOwnedEvents(passportId, auth);
    roleForEvent(auth, 'rollback.requested', role, owned.projection);
    if (auth.authorityId !== owned.projection.rollback.authorityId) {
      throw statusError('Authenticated principal is not the frozen rollback authority', 403, 'ROLLBACK_FORBIDDEN');
    }
    const request = normalizeChangePassportEventPayload('rollback.requested', payload);
    const requestHash = await hashChangePassportValue({ passportId, request });
    const deliveryId = await executionDeliveryId('rollback_execution', passportId, request.rollbackId);
    const existingRequest = owned.events.find((event) => (
      event.type === 'rollback.requested' && event.payload?.rollbackId === request.rollbackId
    ));
    await requireMatchingExecutionRequest({
      passportId,
      requestHash,
      existingEvent: existingRequest,
      label: 'Rollback'
    });
    const requestResult = existingRequest
      ? { ...(await resultForEvents(owned.events)), appendedEvents: [existingRequest] }
      : await appendOne({
          passportId,
          type: 'rollback.requested',
          payload: request,
          role,
          idempotencyKey: `${key}:requested`
        }, auth);
    const projection = requestResult.projection;
    const afterRequest = await getOwnedEvents(passportId, auth);
    if (!afterRequest.events.some((event) => (
      event.type === 'rollback.recorded'
      && event.payload?.rollbackId === request.rollbackId
      && event.payload?.status === 'started'
    ))) {
      await appendOne({
        passportId,
        type: 'rollback.recorded',
        role,
        idempotencyKey: `rollback-started:${deliveryId.slice(7)}`,
        payload: {
          rollbackId: request.rollbackId,
          status: 'started',
          externalReference: `reploid:rollback:${request.rollbackId}`,
          observedAt: now()
        }
      }, auth);
    }
    const deliveryRecord = await durableStore.getDeliveryRecord('rollback_execution', deliveryId);
    let execution = requireMatchingDelivery(deliveryRecord, requestHash, 'Rollback');
    if (!execution) {
      try {
        const result = await effectRegistry?.executeRollback(projection.rollback.kind, { projection, request, auth });
        if (!result) throw new Error(`No rollback adapter is configured for ${projection.rollback.kind}`);
        execution = { ok: true, ...result };
      } catch (error) {
        execution = { ok: false, error: error.message };
      }
      execution = await durableStore.saveDelivery({
        source: 'rollback_execution',
        deliveryId,
        requestHash,
        result: execution
      });
    }
    const current = await getOwnedEvents(passportId, auth);
    const existingResult = current.events.find((event) => (
      event.type === 'rollback.recorded'
      && event.payload?.rollbackId === request.rollbackId
      && ['succeeded', 'failed'].includes(event.payload?.status)
    ));
    if (existingResult) {
      const settled = await resultForEvents(current.events);
      settled.execution = execution;
      settled.githubCheck = await syncGitHubCheck(settled.projection, settled.gate);
      return settled;
    }
    const recorded = await appendOne({
      passportId,
      type: 'rollback.recorded',
      role,
      idempotencyKey: `rollback-recorded:${deliveryId.slice(7)}`,
      payload: rollbackResultPayload(request, execution)
    }, auth);
    return { ...recorded, execution };
  };

  const findGitHubPassports = async ({ owner = null, repo = null, pullRequestNumber = null, installationId = null } = {}) => {
    const matches = [];
    for (const passportId of await durableStore.listPassportIds()) {
      const events = await durableStore.getEvents(passportId);
      if (!events) continue;
      const projection = await projectionFromEvents(events);
      const repository = projection.proposal.repository;
      if (repository.provider !== 'github') continue;
      if (owner && repository.owner !== owner) continue;
      if (repo && repository.name !== repo) continue;
      if (pullRequestNumber !== null && projection.proposal.pullRequestNumber !== pullRequestNumber) continue;
      if (installationId !== null && repository.installationId !== installationId) continue;
      matches.push(projection);
    }
    return matches;
  };

  const appendWebhookObjection = async ({ projection, deliveryId, kind, statement }) => {
    if (projection.supersededBy) return null;
    const systemAuth = {
      subject: 'github-webhook-reconciler',
      authorityId: 'authority:change-control-service',
      organizationId: projection.organizationId,
      roles: ['change_authority'],
      authenticationKind: 'verified_github_webhook'
    };
    return appendOne({
      passportId: projection.passportId,
      type: 'objection.recorded',
      role: 'change_authority',
      idempotencyKey: `github:${deliveryId}:${kind}:${projection.passportId}`,
      payload: {
        objectionId: `objection:github:${deliveryId}:${kind}`,
        statement,
        evidenceIds: [],
        severity: 'blocking'
      }
    }, systemAuth);
  };

  const blockGitHubHead = async (projection, headSha, title, summary) => {
    if (!githubClient?.upsertCheck || !projection.proposal.repository.installationId) return null;
    const repository = projection.proposal.repository;
    return githubClient.upsertCheck({
      installationId: repository.installationId,
      owner: repository.owner,
      repo: repository.name,
      headSha,
      passportId: projection.passportId,
      status: 'completed',
      conclusion: 'failure',
      title,
      summary,
      detailsUrl: detailsBaseUrl
        ? `${String(detailsBaseUrl).replace(/\/$/, '')}/passports?id=${encodeURIComponent(projection.passportId)}`
        : null
    });
  };

  const handleGitHubWebhook = async ({ eventName, deliveryId, payload }) => {
    const action = String(payload?.action || '').trim();
    if (eventName === 'pull_request' && ['synchronize', 'opened', 'reopened'].includes(action)) {
      const fullName = String(payload?.repository?.full_name || '');
      const [owner, repo] = fullName.split('/');
      const pullRequestNumber = Number(payload?.pull_request?.number);
      const projections = await findGitHubPassports({ owner, repo, pullRequestNumber });
      const headSha = String(payload?.pull_request?.head?.sha || '').trim();
      const headRepository = String(payload?.pull_request?.head?.repo?.full_name || '').trim();
      for (const projection of projections) {
        const baseRepository = `${projection.proposal.repository.owner}/${projection.proposal.repository.name}`;
        if (headRepository && headRepository !== baseRepository) {
          await appendWebhookObjection({
            projection,
            deliveryId,
            kind: 'forked-head',
            statement: `GitHub reports a forked pull-request head (${headRepository}); the frozen repository binding is ${baseRepository}.`
          });
          await blockGitHubHead(projection, headSha, 'Forked candidate blocked', 'Create a passport policy that explicitly permits and binds the forked source repository.');
        } else if (headSha && headSha !== projection.proposal.candidateRevision) {
          await appendWebhookObjection({
            projection,
            deliveryId,
            kind: 'candidate-changed',
            statement: `GitHub changed the pull-request head from ${projection.proposal.candidateRevision} to ${headSha}; the frozen candidate is stale.`
          });
          await blockGitHubHead(projection, headSha, 'New Change Passport required', 'The pull-request head changed after the candidate identity froze.');
        }
      }
      return {
        accepted: true,
        action: projections.length ? 'pull_request_reconciled' : 'no_bound_passport',
        passportIds: projections.map((entry) => entry.passportId)
      };
    }

    if (eventName === 'pull_request_review' && action === 'dismissed') {
      const fullName = String(payload?.repository?.full_name || '');
      const [owner, repo] = fullName.split('/');
      const pullRequestNumber = Number(payload?.pull_request?.number);
      const reviewer = String(payload?.review?.user?.login || '').trim();
      const projections = await findGitHubPassports({ owner, repo, pullRequestNumber });
      const affected = projections.filter((projection) => projection.reviews.some((review) => (
        review.actor?.authentication?.subject === reviewer
        || review.actor?.authorityId === reviewer
      )));
      for (const projection of affected) {
        await appendWebhookObjection({
          projection,
          deliveryId,
          kind: 'review-dismissed',
          statement: `GitHub reports that review authority ${reviewer} was dismissed after its Change Passport review was recorded.`
        });
      }
      return {
        accepted: true,
        action: affected.length ? 'dismissed_review_blocked' : 'dismissed_review_not_bound',
        passportIds: affected.map((entry) => entry.passportId)
      };
    }

    if (eventName === 'installation' && ['deleted', 'suspend'].includes(action)) {
      const installationId = Number(payload?.installation?.id);
      const projections = Number.isInteger(installationId)
        ? await findGitHubPassports({ installationId })
        : [];
      for (const projection of projections) {
        await appendWebhookObjection({
          projection,
          deliveryId,
          kind: 'installation-unavailable',
          statement: `GitHub App installation ${installationId} is ${action}; required checks and effects no longer have declared installation authority.`
        });
      }
      return {
        accepted: true,
        action: projections.length ? 'installation_authority_blocked' : 'installation_not_bound',
        passportIds: projections.map((entry) => entry.passportId)
      };
    }

    return { accepted: true, action: 'recorded_only', passportIds: [] };
  };

  return {
    async createPassport(input, auth) {
      return createPassport(input, auth);
    },

    async appendEvent(input, auth) {
      if (input.type === 'trigger.observed') return observeTrigger(input, auth);
      return appendOne(input, auth);
    },

    async observeTrigger(input, auth) {
      return observeTrigger(input, auth);
    },

    async observeStandardTrigger(input, auth) {
      return observeStandardTrigger(input, auth);
    },

    async executeEffect(input, auth) {
      return executeEffect(input, auth);
    },

    async executeRollback(input, auth) {
      return executeRollback(input, auth);
    },

    async handleGitHubWebhook(input) {
      return handleGitHubWebhook(input);
    },

    async getPassport(passportId, auth) {
      const { events, projection } = await getOwnedEvents(passportId, auth);
      return {
        projection,
        gate: evaluateChangePassportGate(projection),
        eventCount: events.length
      };
    },

    async getEvents(passportId, auth) {
      return (await getOwnedEvents(passportId, auth)).events;
    },

    async listPassports(authInput) {
      const auth = requireAuth(authInput);
      const projections = [];
      for (const passportId of await durableStore.listPassportIds()) {
        const events = await durableStore.getEvents(passportId);
        if (!events) continue;
        const projection = await projectionFromEvents(events);
        if (projection.organizationId !== auth.organizationId) continue;
        projections.push({
          passportId,
          changeClass: projection.changeClass,
          title: projection.proposal.title,
          candidateRevision: projection.proposal.candidateRevision,
          evidenceState: projection.evidence.state,
          decisionState: projection.decision.state,
          effectState: projection.effect.state,
          updatedAt: projection.updatedAt,
          integrityValid: projection.integrity.valid
        });
      }
      return projections.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async exportPassport(passportId, auth) {
      const { events } = await getOwnedEvents(passportId, auth);
      return buildChangePassportExport(events, { exportedAt: now() });
    }
  };
}

export default createChangeControlService;

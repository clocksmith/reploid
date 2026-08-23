import { describe, expect, it } from 'vitest';

import { ensureIdentityBundle } from '../../self/identity.js';
import {
  CHANGE_PASSPORT_EVENT_SCHEMA,
  CHANGE_PASSPORT_SCHEMA,
  adaptImprovementEpisodeToPassportSource,
  buildChangePassportExport,
  createSignedChangePassportEvent,
  hashChangePassportValue,
  projectChangePassportEvents,
  verifyChangePassportEvents,
  verifyChangePassportExport
} from '../../self/core/change-passport.js';
import {
  authorizeChangePassportEffect,
  buildChangePassportPolicy,
  evaluateChangePassportGate,
  matchChangePassportReopeningTrigger,
  validateChangePassportPolicy
} from '../../self/core/change-passport-policy.js';

const digest = (character) => `sha256:${character.repeat(64)}`;
const timestamp = (seconds) => `2026-08-22T20:00:${String(seconds).padStart(2, '0')}.000Z`;

const policyInput = () => ({
  policyId: 'policy:agent-change:1',
  version: '1.0.0',
  changeClasses: ['agent_configuration'],
  requiredEvidenceKinds: ['tests', 'evaluation'],
  requiredEvaluationConclusion: 'pass',
  requiredReviewerRoles: ['security_reviewer'],
  minimumApprovals: 1,
  independence: {
    proposerEvaluator: true,
    proposerReviewer: true,
    evaluatorReviewer: true
  },
  allowedEffects: ['github_merge_gate', 'deployment'],
  rollbackAuthorityId: 'authority:rollback',
  reopeningRules: [{
    ruleId: 'rule:dependency-version',
    sourceKind: 'dependency_monitor',
    observationKind: 'dependency_changed',
    targetId: 'service:agent-runtime',
    sensorAuthorityId: 'authority:dependency-monitor',
    freshnessMilliseconds: 60000,
    match: {
      field: 'changed',
      operator: 'equals',
      value: true
    },
    action: 'rollback_request'
  }],
  falseBlockTolerance: 0.05,
  unresolvedBlocksActivation: true
});

const startPayload = (policy) => ({
  passportId: 'passport:test:1',
  organizationId: 'org:test',
  changeClass: 'agent_configuration',
  proposal: {
    proposalId: 'proposal:test:1',
    title: 'Promote agent runtime configuration',
    summary: 'Increase the tool timeout under the frozen runtime contract.',
    repository: {
      provider: 'github',
      owner: 'clocksmith',
      name: 'example-agent',
      repositoryId: 'github:repo:123',
      visibility: 'private'
    },
    pullRequestNumber: 42,
    baseRevision: 'base-commit',
    candidateRevision: 'candidate-commit',
    baselineHash: digest('1'),
    candidateHash: digest('2'),
    manifestHash: digest('3'),
    target: {
      kind: 'agent_runtime',
      targetId: 'service:agent-runtime',
      environment: 'production'
    },
    proposerAuthorityId: 'authority:proposer'
  },
  policy,
  evaluator: {
    evaluatorId: 'evaluator:agent-config',
    authorityId: 'authority:evaluator',
    version: '1.0.0',
    evaluatorHash: digest('4'),
    suiteHash: digest('5'),
    contractHash: digest('6'),
    frozenBeforeCandidate: true
  },
  budget: {
    calls: 10,
    elapsedMilliseconds: 60000,
    costAmount: 2,
    costUnit: 'usd'
  },
  rollback: {
    kind: 'github_revert',
    targetId: 'service:agent-runtime',
    revision: 'base-commit',
    artifactHash: digest('7'),
    authorityId: 'authority:rollback'
  },
  evidenceCutoff: timestamp(0),
  createdAt: timestamp(1)
});

const actor = (authorityId, role) => ({
  authorityId,
  organizationId: 'org:test',
  role,
  authentication: {
    kind: 'authenticated_record',
    subject: authorityId,
    contextHash: digest('f')
  }
});

const append = async ({ events, identity, type, payload, eventActor, second }) => {
  const event = await createSignedChangePassportEvent({
    passportId: 'passport:test:1',
    events,
    identityBundle: identity,
    type,
    payload,
    actor: eventActor,
    timestamp: timestamp(second)
  });
  events.push(event);
  return event;
};

const buildApprovedPassport = async () => {
  const identity = await ensureIdentityBundle({ forceNew: true });
  const policy = await buildChangePassportPolicy(policyInput());
  const events = [];
  await append({
    events,
    identity,
    type: 'passport.created',
    payload: startPayload(policy),
    eventActor: actor('authority:proposer', 'proposer'),
    second: 1
  });
  await append({
    events,
    identity,
    type: 'trigger.declared',
    payload: policy.reopeningRules[0],
    eventActor: actor('authority:change-control', 'change_authority'),
    second: 2
  });
  await append({
    events,
    identity,
    type: 'evidence.admitted',
    payload: {
      evidenceId: 'evidence:tests',
      kind: 'tests',
      digest: digest('8'),
      source: 'GitHub Actions test run',
      uri: 'https://github.example/runs/1',
      summary: 'All frozen tests passed.',
      observedAt: timestamp(3),
      custody: { mode: 'reference_only', accessRequired: true, retention: 'github_owned' }
    },
    eventActor: actor('authority:ci', 'evidence_producer'),
    second: 3
  });
  await append({
    events,
    identity,
    type: 'evidence.admitted',
    payload: {
      evidenceId: 'evidence:evaluation',
      kind: 'evaluation',
      digest: digest('9'),
      source: 'Frozen agent evaluation suite',
      uri: 'https://artifacts.example/evaluation.json',
      summary: 'Candidate passed the paired evaluation.',
      observedAt: timestamp(4),
      custody: { mode: 'reference_only', accessRequired: true, retention: 'artifact_owned' }
    },
    eventActor: actor('authority:evaluator', 'evaluator'),
    second: 4
  });
  await append({
    events,
    identity,
    type: 'evidence.excluded',
    payload: {
      evidenceId: 'evidence:stale',
      kind: 'benchmark',
      digest: digest('a'),
      source: 'Previous benchmark',
      uri: null,
      summary: 'Benchmark used the previous model version.',
      observedAt: timestamp(0),
      custody: { mode: 'reference_only', accessRequired: false, retention: 'source_owned' },
      reason: 'The model identity does not match the frozen candidate.'
    },
    eventActor: actor('authority:evaluator', 'evaluator'),
    second: 5
  });
  const evidenceManifestHash = await hashChangePassportValue([
    ['evidence:evaluation', digest('9')],
    ['evidence:tests', digest('8')]
  ]);
  await append({
    events,
    identity,
    type: 'evidence.frozen',
    payload: {
      manifestHash: evidenceManifestHash,
      evidenceIds: ['evidence:evaluation', 'evidence:tests'],
      cutoff: timestamp(5)
    },
    eventActor: actor('authority:change-control', 'change_authority'),
    second: 6
  });
  await append({
    events,
    identity,
    type: 'evaluation.recorded',
    payload: {
      evaluationId: 'evaluation:1',
      evaluatorId: 'evaluator:agent-config',
      evaluatorAuthorityId: 'authority:evaluator',
      evaluatorHash: digest('4'),
      suiteHash: digest('5'),
      contractHash: digest('6'),
      baselineHash: digest('1'),
      candidateHash: digest('2'),
      evidenceManifestHash,
      conclusion: 'pass',
      metrics: [{ metricId: 'task-success', value: 0.95 }],
      limitations: ['Production latency remains an outcome observation.'],
      observedAt: timestamp(7)
    },
    eventActor: actor('authority:evaluator', 'evaluator'),
    second: 7
  });
  await append({
    events,
    identity,
    type: 'review.recorded',
    payload: {
      reviewId: 'review:security:1',
      verdict: 'approve',
      rationale: 'The permission surface is unchanged and rollback is frozen.',
      resolvesObjectionIds: [],
      evidenceIds: ['evidence:tests', 'evidence:evaluation']
    },
    eventActor: actor('authority:reviewer', 'security_reviewer'),
    second: 8
  });
  const verifiedBeforeDecision = await verifyChangePassportEvents(events);
  const projectedBeforeDecision = projectChangePassportEvents(events, verifiedBeforeDecision);
  const gate = evaluateChangePassportGate(projectedBeforeDecision);
  expect(gate.eligible).toBe(true);
  const decision = await append({
    events,
    identity,
    type: 'decision.recorded',
    payload: {
      decisionId: 'decision:1',
      state: 'approved',
      policyHash: policy.policyHash,
      evaluationIds: gate.acceptableEvaluationIds,
      reviewIds: gate.approvalReviewIds,
      rationale: 'Frozen evidence and independent approval satisfy policy.'
    },
    eventActor: actor('authority:change-control', 'change_authority'),
    second: 9
  });
  return { identity, policy, events, decision, evidenceManifestHash };
};

describe('Change Passport contract', () => {
  it('records, verifies, projects, exports, reopens, and rolls back one governed change', async () => {
    const { identity, events, decision } = await buildApprovedPassport();
    const initialIntegrity = await verifyChangePassportEvents(events);
    expect(initialIntegrity).toMatchObject({ valid: true, eventCount: 9, validSignatures: 9 });
    let projection = projectChangePassportEvents(events, initialIntegrity);
    expect(projection).toMatchObject({
      schema: CHANGE_PASSPORT_SCHEMA,
      decision: { state: 'approved' },
      evidence: { state: 'frozen' },
      effect: { state: 'not_applied' }
    });

    expect(authorizeChangePassportEffect(projection, {
      kind: 'deployment',
      candidateHash: digest('2')
    }, actor('authority:activator', 'activator'))).toMatchObject({ authorized: true });

    await append({
      events,
      identity,
      type: 'effect.requested',
      payload: {
        effectId: 'effect:deployment:1',
        kind: 'deployment',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        decisionEventHash: decision.eventHash,
        idempotencyKey: 'deployment:1'
      },
      eventActor: actor('authority:activator', 'activator'),
      second: 10
    });
    await append({
      events,
      identity,
      type: 'effect.recorded',
      payload: {
        effectId: 'effect:deployment:1',
        status: 'applied',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        externalReference: 'github:deployment:991',
        observedAt: timestamp(11)
      },
      eventActor: actor('authority:deployment', 'activator'),
      second: 11
    });
    const trigger = await append({
      events,
      identity,
      type: 'trigger.observed',
      payload: {
        ruleId: 'rule:dependency-version',
        sourceKind: 'dependency_monitor',
        observationKind: 'dependency_changed',
        targetId: 'service:agent-runtime',
        action: 'rollback_request',
        condition: { changed: true },
        sensorAuthorityId: 'authority:dependency-monitor',
        observationHash: digest('b'),
        observedAt: timestamp(12),
        freshnessMilliseconds: 60000,
        deduplicationKey: 'dependency:change:1'
      },
      eventActor: actor('authority:dependency-monitor', 'observer'),
      second: 12
    });
    await append({
      events,
      identity,
      type: 'decision.reopened',
      payload: {
        reopeningId: 'reopening:1',
        ruleId: 'rule:dependency-version',
        triggerEventHash: trigger.eventHash,
        requestedAction: 'rollback_request',
        reason: 'The dependency identity changed after approval.'
      },
      eventActor: actor('authority:change-control', 'change_authority'),
      second: 13
    });
    await append({
      events,
      identity,
      type: 'rollback.requested',
      payload: {
        rollbackId: 'rollback:1',
        effectId: 'effect:deployment:1',
        rollbackArtifactHash: digest('7'),
        targetId: 'service:agent-runtime',
        idempotencyKey: 'rollback:1',
        authorityId: 'authority:rollback',
        reason: 'The declared dependency trigger requested rollback.'
      },
      eventActor: actor('authority:rollback', 'rollback_authority'),
      second: 14
    });
    await append({
      events,
      identity,
      type: 'rollback.recorded',
      payload: {
        rollbackId: 'rollback:1',
        status: 'succeeded',
        externalReference: 'github:revert:992',
        observedAt: timestamp(15)
      },
      eventActor: actor('authority:deployment', 'activator'),
      second: 15
    });

    const integrity = await verifyChangePassportEvents(events);
    projection = projectChangePassportEvents(events, integrity);
    expect(integrity.valid).toBe(true);
    expect(projection.decision.state).toBe('reopened');
    expect(projection.effect.state).toBe('rolled_back');
    expect(projection.effect.history).toHaveLength(1);

    const exported = await buildChangePassportExport(events, { exportedAt: timestamp(16) });
    const verifiedExport = await verifyChangePassportExport(exported);
    expect(verifiedExport).toMatchObject({ valid: true, reasons: [] });
  });

  it('rejects tampering, omitted events, reordered chains, and forged signatures', async () => {
    const { events } = await buildApprovedPassport();

    const tampered = structuredClone(events);
    tampered[2].payload.summary = 'Changed after signing';
    expect((await verifyChangePassportEvents(tampered)).valid).toBe(false);

    const omitted = events.filter((_, index) => index !== 2);
    expect((await verifyChangePassportEvents(omitted)).valid).toBe(false);

    const reordered = structuredClone(events);
    [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
    expect((await verifyChangePassportEvents(reordered)).valid).toBe(false);

    const forged = structuredClone(events);
    const signature = forged[1].signature.value;
    forged[1].signature.value = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    expect((await verifyChangePassportEvents(forged)).valid).toBe(false);
  });

  it('keeps reopened decision state separate from an applied effect', async () => {
    const { identity, events, decision } = await buildApprovedPassport();
    await append({
      events,
      identity,
      type: 'effect.requested',
      payload: {
        effectId: 'effect:deployment:1',
        kind: 'deployment',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        decisionEventHash: decision.eventHash,
        idempotencyKey: 'deployment:1'
      },
      eventActor: actor('authority:activator', 'activator'),
      second: 10
    });
    await append({
      events,
      identity,
      type: 'effect.recorded',
      payload: {
        effectId: 'effect:deployment:1',
        status: 'applied',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        externalReference: 'deployment:1',
        observedAt: timestamp(11)
      },
      eventActor: actor('authority:deployment', 'activator'),
      second: 11
    });
    const trigger = await append({
      events,
      identity,
      type: 'trigger.observed',
      payload: {
        ruleId: 'rule:dependency-version',
        sourceKind: 'dependency_monitor',
        observationKind: 'dependency_changed',
        targetId: 'service:agent-runtime',
        action: 'rollback_request',
        condition: { changed: true },
        sensorAuthorityId: 'authority:dependency-monitor',
        observationHash: digest('b'),
        observedAt: timestamp(12),
        freshnessMilliseconds: 60000,
        deduplicationKey: 'dependency:change:2'
      },
      eventActor: actor('authority:dependency-monitor', 'observer'),
      second: 12
    });
    await append({
      events,
      identity,
      type: 'decision.reopened',
      payload: {
        reopeningId: 'reopening:2',
        ruleId: 'rule:dependency-version',
        triggerEventHash: trigger.eventHash,
        requestedAction: 'rollback_request',
        reason: 'Dependency changed.'
      },
      eventActor: actor('authority:change-control', 'change_authority'),
      second: 13
    });
    const integrity = await verifyChangePassportEvents(events);
    const projection = projectChangePassportEvents(events, integrity);
    expect(projection.decision.state).toBe('reopened');
    expect(projection.effect.state).toBe('applied');
  });

  it('keeps a frozen evidence manifest immutable so prior evaluations cannot become stale silently', async () => {
    const { identity, events } = await buildApprovedPassport();
    await expect(append({
      events,
      identity,
      type: 'evidence.admitted',
      payload: {
        evidenceId: 'evidence:late',
        kind: 'tests',
        digest: digest('c'),
        source: 'Late CI run',
        uri: null,
        summary: 'This evidence arrived after the manifest froze.',
        observedAt: timestamp(10),
        custody: { mode: 'reference_only', accessRequired: true, retention: 'source_owned' }
      },
      eventActor: actor('authority:ci', 'evidence_producer'),
      second: 10
    })).rejects.toThrow('evidence cannot change after the evidence manifest freezes');
  });

  it('matches only fresh declared reopening triggers', async () => {
    const { events } = await buildApprovedPassport();
    const integrity = await verifyChangePassportEvents(events);
    const projection = projectChangePassportEvents(events, integrity);
    const observedAt = '2026-08-22T20:00:10.000Z';
    const observation = {
      ruleId: 'rule:dependency-version',
      sourceKind: 'dependency_monitor',
      observationKind: 'dependency_changed',
      targetId: 'service:agent-runtime',
      sensorAuthorityId: 'authority:dependency-monitor',
      condition: { changed: true },
      observedAt
    };
    expect(matchChangePassportReopeningTrigger(
      projection,
      observation,
      Date.parse(observedAt) + 1000
    )).toMatchObject({ matched: true, requestedAction: 'rollback_request' });
    expect(matchChangePassportReopeningTrigger(
      projection,
      observation,
      Date.parse(observedAt) + 120000
    )).toMatchObject({ matched: false, reasons: ['trigger observation is stale'] });
  });

  it('validates policy hashes and imports an improvement episode only as source evidence', async () => {
    const policy = await buildChangePassportPolicy(policyInput());
    expect(await validateChangePassportPolicy(policy)).toEqual({ valid: true, reasons: [] });
    const tamperedPolicy = { ...policy, minimumApprovals: 2 };
    expect((await validateChangePassportPolicy(tamperedPolicy)).valid).toBe(false);

    const episode = {
      schema: 'rsi.improvement-episode/v1',
      episodeId: 'episode:source:1',
      status: 'promoted',
      integrity: { valid: true }
    };
    const source = await adaptImprovementEpisodeToPassportSource(episode);
    expect(source).toMatchObject({
      schema: 'rsi.improvement-episode/v1',
      episodeId: 'episode:source:1'
    });
    expect(source.projectionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('uses the canonical event schema for every event', async () => {
    const { events } = await buildApprovedPassport();
    expect(new Set(events.map((event) => event.schema))).toEqual(new Set([CHANGE_PASSPORT_EVENT_SCHEMA]));
  });
});

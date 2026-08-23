/**
 * @fileoverview Governed Visual Feedback Bridge to Change Passport workflow.
 *
 * This adapter deliberately consumes content-addressed Bridge receipts instead
 * of controlling the development bridge. Reploid remains the authority for
 * review, decision, CI activation, outcomes, and deterministic reopening.
 */

import {
  hashChangePassportValue,
  normalizeChangePassportStart
} from '../../self/shared/change-passport/contract.js';
import {
  buildChangePassportPolicy,
  validateChangePassportPolicy
} from '../../self/shared/change-passport/policy.js';
import {
  VISUAL_CHANGE_ACCEPTANCE_SCHEMA,
  VISUAL_CHANGE_EVALUATION_SCHEMA,
  VISUAL_CHANGE_RENDER_SCHEMA,
  VISUAL_CHANGE_REVERSE_SCHEMA,
  verifyVisualChangeCandidate
} from '../../self/shared/change-passport/visual-change.js';

export const VISUAL_CHANGE_EFFECT_KIND = 'ci_activation';
export const VISUAL_CHANGE_REOPENING_KIND = 'candidate_artifact_changed';
export const VISUAL_CHANGE_SOURCE_KIND = 'visual_feedback_bridge';

const requiredText = (value, label) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const requireService = (service) => {
  for (const method of [
    'createPassport',
    'appendEvent',
    'executeEffect',
    'observeStandardTrigger',
    'getPassport'
  ]) {
    if (typeof service?.[method] !== 'function') throw new Error(`Change Control service.${method} is required`);
  }
  return service;
};

const assertActor = (actor, role, label) => {
  if (!actor?.authorityId || !actor?.organizationId || !Array.isArray(actor?.roles)) {
    throw new Error(`${label} must be an authenticated Change Passport principal`);
  }
  if (!actor.roles.includes(role)) throw new Error(`${label} does not hold ${role}`);
  return actor;
};

const assertCandidate = async (candidate, projection = null) => {
  const verification = await verifyVisualChangeCandidate(candidate);
  if (!verification.valid) throw new Error(`Visual candidate is invalid: ${verification.reasons.join('; ')}`);
  if (projection) {
    for (const [field, expected] of [
      ['baselineHash', projection.proposal.baselineHash],
      ['candidateHash', projection.proposal.candidateHash],
      ['candidateRootHash', projection.proposal.manifestHash]
    ]) {
      if (candidate[field] !== expected) throw new Error(`Visual candidate ${field} does not match the passport`);
    }
  }
};

const requireVisualRule = (policy, targetId) => {
  const rules = (policy?.reopeningRules || []).filter((rule) => (
    rule.sourceKind === VISUAL_CHANGE_SOURCE_KIND
    && rule.observationKind === VISUAL_CHANGE_REOPENING_KIND
    && rule.targetId === targetId
    && rule.match?.field === 'changed'
    && rule.match?.operator === 'equals'
    && rule.match?.value === true
  ));
  if (rules.length !== 1) {
    throw new Error('Visual Change Passport policy requires exactly one candidate-artifact reopening rule');
  }
  return rules[0];
};

const receiptId = (prefix, hash) => `${prefix}:${requiredText(hash, `${prefix} hash`).slice(-24)}`;

const assertReceipt = (receipt, schema, candidate, label) => {
  if (receipt?.schema !== schema) throw new Error(`${label} schema mismatch`);
  if (receipt.candidateRootHash !== candidate.candidateRootHash) {
    throw new Error(`${label} does not bind the visual candidate`);
  }
  requiredText(receipt.receiptHash, `${label}.receiptHash`);
  return receipt;
};

export async function buildVisualChangePassportPolicy({
  policyId,
  version = '1.0.0',
  targetId,
  reviewerRole = 'visual_reviewer',
  requiredEvidenceKinds = ['visual_complaint', 'source_owned_patch'],
  rollbackAuthorityId,
  sourceSensorAuthorityId,
  freshnessMilliseconds = 300_000
} = {}) {
  const evidenceKinds = [...new Set([
    'visual_complaint',
    'source_owned_patch',
    ...requiredEvidenceKinds
  ])];
  return buildChangePassportPolicy({
    policyId: requiredText(policyId, 'policyId'),
    version: requiredText(version, 'policy version'),
    changeClasses: ['source_patch'],
    requiredEvidenceKinds: evidenceKinds,
    requiredEvaluationConclusion: 'pass',
    requiredReviewerRoles: [requiredText(reviewerRole, 'reviewerRole')],
    minimumApprovals: 1,
    independence: {
      proposerEvaluator: true,
      proposerReviewer: true,
      evaluatorReviewer: true
    },
    allowedEffects: [VISUAL_CHANGE_EFFECT_KIND],
    rollbackAuthorityId: requiredText(rollbackAuthorityId, 'rollbackAuthorityId'),
    reopeningRules: [{
      ruleId: `rule:visual-source:${requiredText(targetId, 'targetId')}`,
      sourceKind: VISUAL_CHANGE_SOURCE_KIND,
      observationKind: VISUAL_CHANGE_REOPENING_KIND,
      targetId,
      sensorAuthorityId: requiredText(sourceSensorAuthorityId, 'sourceSensorAuthorityId'),
      freshnessMilliseconds,
      match: { field: 'changed', operator: 'equals', value: true },
      action: 'review'
    }],
    falseBlockTolerance: 0,
    unresolvedBlocksActivation: true
  });
}

export function createVisualChangePassportWorkflow({
  service,
  now = () => new Date().toISOString()
} = {}) {
  const changeControl = requireService(service);

  const getBoundProjection = async (passportId, actor, candidate) => {
    const current = await changeControl.getPassport(passportId, actor);
    await assertCandidate(candidate, current.projection);
    if (current.projection.organizationId !== actor.organizationId) {
      throw new Error('Visual Change Passport belongs to another organization');
    }
    return current;
  };

  const open = async ({
    candidate,
    passportId,
    organizationId,
    proposalId,
    title,
    summary,
    repository,
    baseRevision,
    candidateRevision,
    target,
    policy,
    evaluator,
    budget = {
      calls: 1,
      elapsedMilliseconds: 0,
      costAmount: 0,
      costUnit: 'local_execution'
    },
    createdAt = now(),
    evidenceCutoff = createdAt
  } = {}, actors = {}) => {
    await assertCandidate(candidate);
    const proposer = assertActor(actors.proposer, 'proposer', 'visual proposer');
    const evidenceProducer = assertActor(actors.evidenceProducer, 'evidence_producer', 'Bridge evidence producer');
    const changeAuthority = assertActor(actors.changeAuthority, 'change_authority', 'change authority');
    if (organizationId !== proposer.organizationId
      || organizationId !== evidenceProducer.organizationId
      || organizationId !== changeAuthority.organizationId) {
      throw new Error('Visual workflow actors must belong to the passport organization');
    }
    if (proposer.authorityId === evaluator?.authorityId) {
      throw new Error('Visual patch proposer and frozen evaluator must be independent');
    }
    const policyValidation = await validateChangePassportPolicy(policy);
    if (!policyValidation.valid) throw new Error(`Visual Change Passport policy is invalid: ${policyValidation.reasons.join('; ')}`);
    if (!policy.changeClasses.includes('source_patch')) throw new Error('Visual policy must govern source_patch changes');
    for (const evidenceKind of ['visual_complaint', 'source_owned_patch']) {
      if (!policy.requiredEvidenceKinds.includes(evidenceKind)) {
        throw new Error(`Visual policy must require ${evidenceKind} evidence`);
      }
    }
    if (!policy.allowedEffects.includes(VISUAL_CHANGE_EFFECT_KIND)) {
      throw new Error(`Visual policy must allow ${VISUAL_CHANGE_EFFECT_KIND}`);
    }
    const rule = requireVisualRule(policy, target?.targetId);
    const rollback = {
      kind: 'visual_feedback_reverse_patch',
      targetId: target?.targetId,
      revision: baseRevision,
      artifactHash: candidate.patch.artifactHash,
      authorityId: policy.rollbackAuthorityId
    };
    const start = normalizeChangePassportStart({
      passportId,
      organizationId,
      changeClass: 'source_patch',
      proposal: {
        proposalId: proposalId || `proposal:${candidate.bridge.changeId}`,
        title,
        summary,
        repository,
        baseRevision,
        candidateRevision,
        baselineHash: candidate.baselineHash,
        candidateHash: candidate.candidateHash,
        manifestHash: candidate.candidateRootHash,
        target: {
          kind: target?.kind || 'source_patch',
          targetId: target?.targetId,
          environment: target?.environment || 'ci'
        },
        proposerAuthorityId: proposer.authorityId
      },
      policy,
      evaluator,
      budget,
      rollback,
      evidenceCutoff,
      createdAt
    });
    await changeControl.createPassport({
      payload: start,
      role: 'proposer',
      idempotencyKey: `visual:${candidate.bridge.changeId}:create`
    }, proposer);
    await changeControl.appendEvent({
      passportId,
      type: 'trigger.declared',
      role: 'change_authority',
      idempotencyKey: `visual:${candidate.bridge.changeId}:trigger`,
      payload: { ...rule, condition: rule.match }
    }, changeAuthority);
    const evidence = [
      {
        evidenceId: `evidence:${candidate.bridge.changeId}:complaint`,
        kind: 'visual_complaint',
        digest: candidate.request.digest,
        source: `Visual Feedback Bridge ${candidate.bridge.projectId}/${candidate.bridge.worktreeId}`,
        uri: `bridge://${candidate.bridge.projectId}/${candidate.bridge.worktreeId}/${candidate.bridge.changeId}#complaint`,
        summary: `${candidate.request.annotations.length} source-mapped annotation(s) submitted to paired session ${candidate.bridge.sessionId}.`,
        observedAt: candidate.request.emittedAt,
        custody: { mode: 'content_addressed_reference', accessRequired: true, retention: 'bridge_source_owned' }
      },
      {
        evidenceId: `evidence:${candidate.bridge.changeId}:patch`,
        kind: 'source_owned_patch',
        digest: candidate.patch.manifestHash,
        source: `Visual Feedback Bridge reversible patch ${candidate.patch.artifactHash}`,
        uri: `bridge://${candidate.bridge.projectId}/${candidate.bridge.worktreeId}/${candidate.bridge.changeId}#patch`,
        summary: `${candidate.patch.entries.length} file(s) are bound to before/after hashes and a conflict-safe reverse artifact.`,
        observedAt: candidate.completion.emittedAt,
        custody: { mode: 'content_addressed_reference', accessRequired: true, retention: 'bridge_source_owned' }
      }
    ];
    if (policy.requiredEvidenceKinds.includes('rollback_identity')) {
      evidence.push({
        evidenceId: `evidence:${candidate.bridge.changeId}:rollback-identity`,
        kind: 'rollback_identity',
        digest: await hashChangePassportValue(rollback),
        source: `Change Passport rollback contract ${rollback.kind}`,
        uri: `passport://${passportId}#rollback`,
        summary: 'The rollback kind, target, baseline revision, reverse artifact, and named authority are bound before eligibility.',
        observedAt: createdAt,
        custody: { mode: 'passport_embedded_contract', accessRequired: false, retention: 'passport_lifetime' }
      });
    }
    for (const item of evidence) {
      await changeControl.appendEvent({
        passportId,
        type: 'evidence.admitted',
        role: 'evidence_producer',
        idempotencyKey: `visual:${candidate.bridge.changeId}:${item.kind}`,
        payload: item
      }, evidenceProducer);
    }
    const evidenceManifestHash = await hashChangePassportValue(
      evidence.map((item) => [item.evidenceId, item.digest]).sort(([left], [right]) => left.localeCompare(right))
    );
    return changeControl.appendEvent({
      passportId,
      type: 'evidence.frozen',
      role: 'change_authority',
      idempotencyKey: `visual:${candidate.bridge.changeId}:freeze`,
      payload: {
        manifestHash: evidenceManifestHash,
        evidenceIds: evidence.map((item) => item.evidenceId).sort(),
        cutoff: evidenceCutoff
      }
    }, changeAuthority);
  };

  const recordIndependentEvaluation = async ({ passportId, candidate, receipt } = {}, evaluatorActor) => {
    assertReceipt(receipt, VISUAL_CHANGE_EVALUATION_SCHEMA, candidate, 'visual evaluation receipt');
    const evaluator = assertActor(evaluatorActor, 'evaluator', 'visual evaluator');
    const current = await getBoundProjection(passportId, evaluator, candidate);
    const projection = current.projection;
    if (projection.evidence.state !== 'frozen') throw new Error('visual evidence must be frozen before evaluation');
    if (projection.evaluations.length > 0) throw new Error('visual candidate already has an evaluation');
    if (evaluator.authorityId !== projection.evaluator.authorityId
      || receipt.evaluator.authorityId !== projection.evaluator.authorityId) {
      throw new Error('evaluation is not attributed to the frozen evaluator authority');
    }
    for (const field of ['evaluatorId', 'evaluatorHash', 'suiteHash', 'contractHash']) {
      if (receipt.evaluator[field] !== projection.evaluator[field]) {
        throw new Error(`visual evaluation ${field} does not match the frozen evaluator`);
      }
    }
    return changeControl.appendEvent({
      passportId,
      type: 'evaluation.recorded',
      role: 'evaluator',
      idempotencyKey: `visual:${candidate.bridge.changeId}:evaluation`,
      payload: {
        evaluationId: receiptId('evaluation', receipt.receiptHash),
        evaluatorId: projection.evaluator.evaluatorId,
        evaluatorAuthorityId: projection.evaluator.authorityId,
        evaluatorHash: projection.evaluator.evaluatorHash,
        suiteHash: projection.evaluator.suiteHash,
        contractHash: projection.evaluator.contractHash,
        baselineHash: projection.proposal.baselineHash,
        candidateHash: projection.proposal.candidateHash,
        evidenceManifestHash: projection.evidence.manifestHash,
        conclusion: receipt.conclusion,
        metrics: [
          { metricId: 'visual_evaluation_receipt', value: receipt.receiptHash },
          ...receipt.checks.map((check) => ({ metricId: check.name, value: check.status === 'passed' ? 1 : 0 })),
          ...receipt.renderOracle.assertions.map((check) => ({ metricId: `render:${check.name}`, value: check.status === 'passed' ? 1 : 0 }))
        ],
        limitations: [],
        observedAt: receipt.observedAt
      }
    }, evaluator);
  };

  const accept = async ({ passportId, candidate, receipt, rationale } = {}, actors = {}) => {
    assertReceipt(receipt, VISUAL_CHANGE_ACCEPTANCE_SCHEMA, candidate, 'visual acceptance receipt');
    const reviewerRole = requiredText(actors.reviewerRole, 'visual reviewer role');
    const reviewer = assertActor(actors.reviewer, reviewerRole, 'visual reviewer');
    const changeAuthority = assertActor(actors.changeAuthority, 'change_authority', 'change authority');
    const current = await getBoundProjection(passportId, reviewer, candidate);
    const projection = current.projection;
    if (projection.evaluations.length !== 1 || projection.evaluations[0].conclusion !== 'pass') {
      throw new Error('human acceptance requires one passing independent evaluation');
    }
    if (projection.effect.state !== 'not_applied') throw new Error('human acceptance must precede activation');
    const reviewId = receiptId('review', receipt.receiptHash);
    const reviewed = await changeControl.appendEvent({
      passportId,
      type: 'review.recorded',
      role: reviewerRole,
      idempotencyKey: `visual:${candidate.bridge.changeId}:acceptance`,
      payload: {
        reviewId,
        verdict: 'approve',
        rationale: requiredText(rationale, 'human acceptance rationale'),
        resolvesObjectionIds: [],
        evidenceIds: projection.evidence.admitted.map((item) => item.evidenceId)
      }
    }, reviewer);
    const reviewProjection = reviewed.projection;
    return changeControl.appendEvent({
      passportId,
      type: 'decision.recorded',
      role: 'change_authority',
      idempotencyKey: `visual:${candidate.bridge.changeId}:decision`,
      payload: {
        decisionId: receiptId('decision', receipt.receiptHash),
        state: 'approved',
        policyHash: reviewProjection.policy.policyHash,
        evaluationIds: reviewProjection.evaluations.map((item) => item.evaluationId),
        reviewIds: [reviewId],
        rationale: 'The exact source-owned patch passed frozen independent evaluation and received explicit human acceptance.'
      }
    }, changeAuthority);
  };

  const activate = async ({ passportId, candidate } = {}, activatorActor) => {
    const activator = assertActor(activatorActor, 'activator', 'CI activator');
    const current = await getBoundProjection(passportId, activator, candidate);
    const projection = current.projection;
    if (projection.decision.state !== 'approved' || !projection.decision.current?.eventHash) {
      throw new Error('CI activation requires the active approved decision');
    }
    if (projection.effect.state !== 'not_applied') throw new Error('visual candidate is already activated');
    const effectId = `effect:visual:${candidate.bridge.changeId}`;
    return changeControl.executeEffect({
      passportId,
      role: 'activator',
      idempotencyKey: `visual:${candidate.bridge.changeId}:activate`,
      payload: {
        effectId,
        kind: VISUAL_CHANGE_EFFECT_KIND,
        targetId: projection.proposal.target.targetId,
        candidateHash: candidate.candidateHash,
        decisionEventHash: projection.decision.current.eventHash,
        idempotencyKey: `visual-ci:${candidate.candidateRootHash.slice(-32)}`
      }
    }, activator);
  };

  const recordRenderedVerification = async ({ passportId, candidate, receipt } = {}, observerActor) => {
    assertReceipt(receipt, VISUAL_CHANGE_RENDER_SCHEMA, candidate, 'rendered verification receipt');
    const observer = assertActor(observerActor, 'observer', 'render observer');
    const current = await getBoundProjection(passportId, observer, candidate);
    const projection = current.projection;
    if (projection.effect.state !== 'applied' || projection.effect.current?.effectId !== receipt.effectId) {
      throw new Error('rendered verification requires the matching applied CI activation');
    }
    if (projection.effect.current.externalReference !== receipt.activationReference) {
      throw new Error('rendered verification does not bind the CI activation reference');
    }
    if (receipt.status !== 'verified') throw new Error('rendered verification oracle did not pass');
    return changeControl.appendEvent({
      passportId,
      type: 'outcome.recorded',
      role: 'observer',
      idempotencyKey: `visual:${candidate.bridge.changeId}:rendered`,
      payload: {
        outcomeId: receiptId('outcome:render', receipt.receiptHash),
        effectId: receipt.effectId,
        observationHash: receipt.receiptHash,
        source: `Independent ${receipt.oracle.engine} render oracle after CI activation`,
        status: 'verified',
        summary: `Activated candidate rendered at ${receipt.routeKey} and passed ${receipt.oracle.assertions.length} frozen assertion(s).`,
        observedAt: receipt.observedAt
      }
    }, observer);
  };

  const recordReverseAndReopen = async ({ passportId, candidate, receipt } = {}, observerActor) => {
    assertReceipt(receipt, VISUAL_CHANGE_REVERSE_SCHEMA, candidate, 'reverse patch receipt');
    const observer = assertActor(observerActor, 'observer', 'source observer');
    const current = await getBoundProjection(passportId, observer, candidate);
    const projection = current.projection;
    if (projection.decision.state !== 'approved' || projection.effect.state !== 'applied') {
      throw new Error('reverse-and-reopen requires an active approved visual change');
    }
    if (!projection.outcomes.some((outcome) => outcome.status === 'verified')) {
      throw new Error('reverse patch cannot close the workflow before rendered verification');
    }
    const effectId = projection.effect.current?.effectId;
    const reverseOutcome = await changeControl.appendEvent({
      passportId,
      type: 'outcome.recorded',
      role: 'observer',
      idempotencyKey: `visual:${candidate.bridge.changeId}:reverse-outcome`,
      payload: {
        outcomeId: receiptId('outcome:reverse', receipt.receiptHash),
        effectId,
        observationHash: receipt.receiptHash,
        source: `Visual Feedback Bridge conflict-safe reverse patch for ${candidate.bridge.changeId}`,
        status: 'source_reverted',
        summary: 'The source-owned patch restored its frozen baseline. This observation does not assert that any external activation rolled back.',
        observedAt: receipt.observedAt
      }
    }, observer);
    const rule = requireVisualRule(reverseOutcome.projection.policy, reverseOutcome.projection.proposal.target.targetId);
    const reopening = await changeControl.observeStandardTrigger({
      passportId,
      kind: VISUAL_CHANGE_REOPENING_KIND,
      ruleId: rule.ruleId,
      data: {
        previousHash: receipt.previousSourceHash,
        currentHash: receipt.currentSourceHash
      },
      observedAt: receipt.observedAt,
      deduplicationKey: `visual-reverse:${receipt.receiptHash.slice(-32)}`,
      role: 'observer',
      idempotencyKey: `visual:${candidate.bridge.changeId}:reopen`
    }, observer);
    return { reverseOutcome, reopening };
  };

  return Object.freeze({
    open,
    recordIndependentEvaluation,
    accept,
    activate,
    recordRenderedVerification,
    recordReverseAndReopen
  });
}

export default createVisualChangePassportWorkflow;

import { describe, expect, it, vi } from 'vitest';

import { createChangeControlEffectRegistry } from '../../server/change-control/effects.js';
import { createChangeControlService } from '../../server/change-control/service.js';
import { createMemoryChangeControlStore } from '../../server/change-control/store.js';
import {
  buildVisualChangePassportPolicy,
  createVisualChangePassportWorkflow
} from '../../server/change-control/visual-workflow.js';
import { verifyChangePassportExport } from '../../self/shared/change-passport/contract.js';
import {
  buildVisualChangeAcceptanceReceipt,
  buildVisualChangeCandidate,
  buildVisualChangeEvaluationReceipt,
  buildVisualChangeRenderReceipt,
  buildVisualChangeReverseReceipt
} from '../../self/shared/change-passport/visual-change.js';
import { auth } from '../fixtures/change-passport/service-fixture.js';

const digest = (character) => `sha256:${character.repeat(64)}`;
const timestamp = (second) => `2026-08-22T21:00:${String(second).padStart(2, '0')}.000Z`;

const bridgeEnvelope = (type, payload, sequence, options = {}) => ({
  protocolVersion: 1,
  eventId: options.eventId || `evt_${type.replaceAll('.', '_')}_${sequence}`,
  requestId: options.requestId || `req_${sequence}`,
  projectId: 'reploid',
  worktreeId: 'worktree_visual_passport',
  sessionId: 'session_codex',
  browserClientId: 'browser_operator',
  sequence,
  causationId: options.causationId || null,
  correlationId: 'correlation_visual_change',
  entityVersion: null,
  emittedAt: timestamp(sequence),
  type,
  payload
});

const buildCandidate = async () => {
  const requestEnvelope = bridgeEnvelope('change.requested', {
    changeId: 'change_visual_1',
    projectId: 'reploid',
    worktreeId: 'worktree_visual_passport',
    sessionId: 'session_codex',
    browserClientId: 'browser_operator',
    routeKey: '/passports',
    page: {
      url: 'http://127.0.0.1:4173/passports',
      viewport: { width: 1280, height: 800 },
      scroll: { x: 0, y: 0 },
      capturedAt: timestamp(1)
    },
    annotations: [{
      id: 'annotation_visual_1',
      browserClientId: 'browser_operator',
      routeKey: '/passports',
      selectionType: 'element',
      elementAnchors: [{
        routeKey: '/passports',
        component: {
          framework: 'vanilla',
          displayName: 'ChangePassportDetail',
          sourceFile: 'self/ui/change-passport/styles.css',
          sourceLine: 211
        },
        locators: { testId: 'passport-state-grid', ancestryFingerprint: ['main', 'section'] },
        geometry: {
          documentRect: { x: 20, y: 200, width: 900, height: 120 },
          viewportRect: { x: 20, y: 200, width: 900, height: 120 },
          normalizedCenter: { x: 0.36, y: 0.32 }
        }
      }],
      elementContext: [{
        tagName: 'section',
        text: 'Evidence Decision Effect',
        role: 'region',
        classes: ['passport-state-grid'],
        attributes: { 'data-passport-detail': 'passport:visual:1' },
        computedStyle: { display: 'grid', gap: '12px' }
      }],
      comment: 'Make the three lifecycle states readable at a narrow viewport.',
      priority: 'high',
      draftState: 'submitted',
      restorationState: 'restored_exact',
      version: 1,
      createdAt: timestamp(1),
      updatedAt: timestamp(1)
    }],
    comments: [{
      commentId: 'comment_visual_1',
      annotationId: 'annotation_visual_1',
      text: 'Make the three lifecycle states readable at a narrow viewport.',
      priority: 'high'
    }],
    threadId: 'thread_visual_1'
  }, 1, { eventId: 'evt_visual_request' });
  const completionEnvelope = bridgeEnvelope('agent.completed', {
    changeId: 'change_visual_1',
    summary: 'Kept the lifecycle cards readable without horizontal overflow.',
    changedFiles: ['self/ui/change-passport/styles.css'],
    commentResults: [{ commentId: 'comment_visual_1', disposition: 'addressed' }],
    validation: [{ name: 'change-passport browser check', status: 'passed' }],
    patchPath: '.deco/feedback/patches/change_visual_1.json.gz',
    patchHash: 'a'.repeat(64)
  }, 2, { causationId: requestEnvelope.eventId });
  const patchManifest = {
    schema: 'deco.visual-feedback.workspace-patch/v1',
    changeId: 'change_visual_1',
    projectRoot: '/source-owned/reploid',
    createdAt: timestamp(2),
    entries: [{
      path: 'self/ui/change-passport/styles.css',
      kind: 'modified',
      beforeHash: 'b'.repeat(64),
      afterHash: 'c'.repeat(64),
      beforeMode: 33188,
      afterMode: 33188,
      beforeBase64: 'YmVmb3Jl',
      afterBase64: 'YWZ0ZXI='
    }],
    skippedBefore: [],
    skippedAfter: [],
    unpatchableChanges: []
  };
  return buildVisualChangeCandidate({
    requestEnvelope,
    completionEnvelope,
    patchManifest,
    patchArtifactHash: 'a'.repeat(64)
  });
};

const evaluator = {
  evaluatorId: 'evaluator:visual-render-oracle',
  authorityId: 'authority:visual-evaluator',
  version: '1.0.0',
  evaluatorHash: digest('d'),
  suiteHash: digest('e'),
  contractHash: digest('f'),
  frozenBeforeCandidate: true
};

describe('Visual Change Passport workflow', () => {
  it('governs complaint, patch, independent evaluation, acceptance, CI activation, render, reverse, and reopening', async () => {
    const activation = vi.fn(async ({ projection, request }) => ({
      externalReference: `ci://local/${projection.proposal.candidateRevision}/${request.effectId}`
    }));
    const service = createChangeControlService({
      store: createMemoryChangeControlStore(),
      effectRegistry: createChangeControlEffectRegistry({ effects: { ci_activation: activation } }),
      now: (() => {
        let second = 20;
        return () => timestamp(second++);
      })()
    });
    const workflow = createVisualChangePassportWorkflow({ service });
    const candidate = await buildCandidate();
    const policy = await buildVisualChangePassportPolicy({
      policyId: 'policy:visual-change:1',
      targetId: 'reploid:passports-ui',
      reviewerRole: 'visual_reviewer',
      rollbackAuthorityId: 'authority:visual-rollback',
      sourceSensorAuthorityId: 'authority:bridge-observer'
    });
    const proposer = auth('authority:patch-agent', ['proposer', 'evidence_producer']);
    const changeAuthority = auth('authority:change-control', ['change_authority']);
    const evaluatorActor = auth('authority:visual-evaluator', ['evaluator']);
    const reviewer = auth('authority:human-reviewer', ['visual_reviewer']);
    const activator = auth('authority:ci', ['activator']);
    const observer = auth('authority:bridge-observer', ['observer']);

    const opened = await workflow.open({
      candidate,
      passportId: 'passport:visual:1',
      organizationId: 'org:test',
      title: 'Repair narrow Change Passport lifecycle cards',
      summary: 'Apply the exact source-owned visual patch and keep it reversible.',
      repository: {
        provider: 'github',
        owner: 'clocksmith',
        name: 'reploid',
        repositoryId: 'github:clocksmith/reploid',
        installationId: null,
        defaultBranch: 'main',
        visibility: 'private'
      },
      baseRevision: 'base-visual-sha',
      candidateRevision: 'candidate-visual-sha',
      target: { kind: 'source_patch', targetId: 'reploid:passports-ui', environment: 'ci' },
      policy,
      evaluator,
      createdAt: timestamp(10),
      evidenceCutoff: timestamp(9)
    }, {
      proposer,
      evidenceProducer: proposer,
      changeAuthority
    });
    expect(opened.projection).toMatchObject({
      changeClass: 'source_patch',
      evidence: { state: 'frozen' },
      decision: { state: 'proposed' },
      effect: { state: 'not_applied' }
    });

    const acceptanceReceipt = await buildVisualChangeAcceptanceReceipt({
      candidate,
      acceptedEnvelope: bridgeEnvelope('review.accepted', { changeId: 'change_visual_1' }, 5),
      observedAt: timestamp(12)
    });
    await expect(workflow.accept({
      passportId: 'passport:visual:1',
      candidate,
      receipt: acceptanceReceipt,
      rationale: 'The exact patch fixes the visible defect.'
    }, { reviewer, reviewerRole: 'visual_reviewer', changeAuthority })).rejects.toThrow(
      'requires one passing independent evaluation'
    );

    const evaluationReceipt = await buildVisualChangeEvaluationReceipt({
      candidate,
      evaluator,
      checks: [{ name: 'frozen browser checks', status: 'passed', artifactHash: digest('1'), runner: 'vitest@4.1.10' }],
      renderOracle: {
        engine: 'chromium-playwright',
        routeKey: '/passports',
        artifactHash: digest('2'),
        assertions: [{ name: 'no-horizontal-overflow', status: 'passed', artifactHash: digest('3'), runner: 'playwright@1.57.0' }]
      },
      observedAt: timestamp(11)
    });
    await workflow.recordIndependentEvaluation({
      passportId: 'passport:visual:1',
      candidate,
      receipt: evaluationReceipt
    }, evaluatorActor);

    const approved = await workflow.accept({
      passportId: 'passport:visual:1',
      candidate,
      receipt: acceptanceReceipt,
      rationale: 'The exact patch passed the independent narrow-viewport oracle.'
    }, { reviewer, reviewerRole: 'visual_reviewer', changeAuthority });
    expect(approved.projection.decision.state).toBe('approved');

    const applied = await workflow.activate({ passportId: 'passport:visual:1', candidate }, activator);
    expect(applied.projection.effect.state).toBe('applied');
    expect(activation).toHaveBeenCalledTimes(1);
    const effect = applied.projection.effect.current;

    const renderReceipt = await buildVisualChangeRenderReceipt({
      candidate,
      renderEnvelope: bridgeEnvelope('page.rendered', {
        changeId: 'change_visual_1',
        routeKey: '/passports',
        mode: 'reload'
      }, 6),
      effectId: effect.effectId,
      activationReference: effect.externalReference,
      oracle: {
        engine: 'chromium-playwright',
        artifactHash: digest('4'),
        assertions: [{ name: 'activated-render-matches', status: 'passed', artifactHash: digest('5'), runner: 'playwright@1.57.0' }]
      },
      observedAt: timestamp(13)
    });
    await workflow.recordRenderedVerification({
      passportId: 'passport:visual:1',
      candidate,
      receipt: renderReceipt
    }, observer);

    const reverseReceipt = await buildVisualChangeReverseReceipt({
      candidate,
      revertedEnvelope: bridgeEnvelope('change.reverted', {
        changeId: 'change_visual_1',
        revertedFiles: ['self/ui/change-passport/styles.css']
      }, 7),
      currentSourceHash: candidate.baselineHash,
      observedAt: timestamp(14)
    });
    const finished = await workflow.recordReverseAndReopen({
      passportId: 'passport:visual:1',
      candidate,
      receipt: reverseReceipt
    }, observer);
    expect(finished.reopening.triggerMatch).toMatchObject({ matched: true, requestedAction: 'review' });
    expect(finished.reopening.projection).toMatchObject({
      decision: { state: 'reopened' },
      effect: { state: 'applied' }
    });
    expect(finished.reopening.gate).toMatchObject({ eligible: false, status: 'blocked' });
    expect(finished.reopening.projection.outcomes.map((item) => item.status)).toEqual([
      'verified',
      'source_reverted'
    ]);

    const events = await service.getEvents('passport:visual:1', changeAuthority);
    expect(events.map((event) => event.type)).toEqual([
      'passport.created',
      'trigger.declared',
      'evidence.admitted',
      'evidence.admitted',
      'evidence.frozen',
      'evaluation.recorded',
      'review.recorded',
      'decision.recorded',
      'effect.requested',
      'effect.recorded',
      'outcome.recorded',
      'outcome.recorded',
      'trigger.observed',
      'decision.reopened'
    ]);
    const exported = await service.exportPassport('passport:visual:1', changeAuthority);
    await expect(verifyChangePassportExport(exported)).resolves.toMatchObject({ valid: true });
  });

  it('rejects a completion whose claimed files exceed the reversible Bridge patch', async () => {
    const candidatePromise = buildVisualChangeCandidate({
      requestEnvelope: bridgeEnvelope('change.requested', {
        changeId: 'change_bad',
        projectId: 'reploid',
        worktreeId: 'worktree_visual_passport',
        sessionId: 'session_codex',
        browserClientId: 'browser_operator',
        routeKey: '/passports',
        page: {
          url: 'http://localhost/passports',
          viewport: { width: 800, height: 600 },
          scroll: { x: 0, y: 0 },
          capturedAt: timestamp(1)
        },
        annotations: [{
          id: 'annotation_bad',
          routeKey: '/passports',
          elementAnchors: [{ component: { sourceFile: 'self/ui/change-passport/styles.css' } }],
          elementContext: [{ tagName: 'main' }],
          comment: 'Fix it.'
        }],
        comments: [{ commentId: 'comment_bad', annotationId: 'annotation_bad', text: 'Fix it.' }],
        threadId: 'thread_bad'
      }, 1, { eventId: 'evt_bad' }),
      completionEnvelope: bridgeEnvelope('agent.completed', {
        changeId: 'change_bad',
        summary: 'Changed two files.',
        changedFiles: ['self/ui/change-passport/styles.css', 'server/proxy.js'],
        commentResults: [{ commentId: 'comment_bad', disposition: 'addressed' }],
        validation: [],
        patchHash: 'a'.repeat(64)
      }, 2, { causationId: 'evt_bad' }),
      patchManifest: {
        schema: 'deco.visual-feedback.workspace-patch/v1',
        changeId: 'change_bad',
        createdAt: timestamp(2),
        entries: [{
          path: 'self/ui/change-passport/styles.css',
          kind: 'modified',
          beforeHash: 'b'.repeat(64),
          afterHash: 'c'.repeat(64)
        }],
        unpatchableChanges: []
      },
      patchArtifactHash: 'a'.repeat(64)
    });
    await expect(candidatePromise).rejects.toThrow('changedFiles do not match');
  });
});

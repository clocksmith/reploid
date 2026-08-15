import { describe, expect, it, vi } from 'vitest';

import {
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchResult,
  createSignedResearchSubmission,
  projectAcceptedResearchMemory,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';
import { hashSequenceFloat32Values } from '../../self/pool/sequence-result.js';
import {
  bindResearchWorkspace,
  createContextualReviewRecord,
  createCurrentRoomPriorEvidence,
  hydrateAndBindResearchWorkspace,
  renderResearchWorkspace
} from '../../self/ui/pool-home/research-view.js';
import {
  appendResearchRecord,
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord,
  resetResearchStore
} from '../../self/ui/pool-home/research-store.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const model = {
  id: 'esm2-record-view',
  hash: fakeHash('1'),
  manifestHash: fakeHash('2'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
};

const identity = async (kind = 'requester') => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_record_view`,
      userId: `user_${kind}_record_view`,
      deviceId: `device_${kind}_record_view`,
      identityRootId: `root_${kind}_record_view`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

describe('Poolday research Records model evidence view', () => {
  it('maps each contextual review action to a signed evidence record', async () => {
    const reviewer = await identity('reviewer');
    const targetHash = fakeHash('f');
    const cases = [
      ['accept', 'review_decision', 'reviews', 'accepted'],
      ['reject', 'review_decision', 'reviews', 'rejected'],
      ['correct', 'correction', 'corrects', null],
      ['replicate', 'review_decision', 'reviews', 'replication_requested']
    ];

    for (const [action, kind, relation, decision] of cases) {
      const record = await createContextualReviewRecord({
        action,
        identity: reviewer,
        roomId: 'contextual-review-room',
        targetHash,
        text: `${action} with attributable context.`,
        confidence: 0.8
      });
      expect(record).toMatchObject({
        kind: 'human_claim',
        roomId: 'contextual-review-room',
        targetHash,
        claim: { kind, relation, decision }
      });
      expect(record.recordHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(record.signature).toBeTruthy();
    }
  });

  it('executes a contextual acceptance and rehydrates its signed record after reload', async () => {
    localStorage.clear();
    resetResearchStore();
    const requester = await identity();
    const admittedModel = buildLaunchProviderModel();
    const embedding = Array.from({ length: admittedModel.embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
    const submission = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'contextual-execution-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Should this result enter room memory?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const result = await createSignedResearchResult({
      identity: requester,
      submission,
      receiptRecord: {
        receiptHash: fakeHash('d'),
        verifierDecision: { accepted: true },
        receipt: {
          model: admittedModel,
          providerId: 'provider_contextual_execution',
          assignmentId: 'assignment_contextual_execution',
          jobId: 'job_contextual_execution',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values(embedding)
        }
      },
      embedding
    });
    await appendResearchRecord(submission);
    await appendResearchRecord(result);
    document.body.innerHTML = `<div>${renderResearchWorkspace(submission.roomId, [submission, result], { reviewTarget: result.recordHash })}</div>`;
    const workspace = document.querySelector('[data-pool-research-workspace]');
    bindResearchWorkspace(workspace, {
      publishRecord: (record, options) => publishResearchRecord(record, {
        ...options,
        sdk: { publishResearchRecord: vi.fn().mockResolvedValue({ ok: true }) }
      })
    });
    const form = workspace.querySelector('[data-research-review-form]');
    form.elements.text.value = 'The receipt and declared limits support accepting this evidence.';
    form.dispatchEvent(new SubmitEvent('submit', {
      bubbles: true,
      cancelable: true,
      submitter: form.querySelector('[data-research-review-action="accept"]')
    }));

    await vi.waitFor(() => expect(loadResearchRecords(submission.roomId)).toHaveLength(3));
    const accepted = loadResearchRecords(submission.roomId).at(-1);
    expect(accepted).toMatchObject({
      kind: 'human_claim',
      targetHash: result.recordHash,
      claim: { kind: 'review_decision', relation: 'reviews', decision: 'accepted' }
    });
    expect(accepted.signature).toBeTruthy();

    resetResearchStore();
    const hydrated = await hydrateResearchRecords(submission.roomId, {
      sdk: { listResearchRecords: vi.fn().mockRejectedValue(new Error('offline')) }
    });
    expect(hydrated.remote).toBe(false);
    expect(loadResearchRecords(submission.roomId).map((record) => record.recordHash)).toContain(accepted.recordHash);
    resetResearchStore();
    localStorage.clear();
  });

  it('hydrates the active room even when the technical workspace is not mounted', async () => {
    const hydrate = vi.fn(async (roomId) => ({
      roomId,
      remote: true,
      records: [],
      rejectedRecords: []
    }));

    const result = await hydrateAndBindResearchWorkspace(null, 'home-room', { hydrate });

    expect(hydrate).toHaveBeenCalledWith('home-room');
    expect(result).toMatchObject({ roomId: 'home-room', remote: true });
  });

  it('reprojects remotely hydrated evidence into a cold review workspace', async () => {
    localStorage.clear();
    resetResearchStore();
    const roomId = 'cold-review-room';
    const submission = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId,
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Can a second curator review synchronized evidence?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: buildLaunchProviderModel(),
      policyId: 'redundant_agreement'
    });
    document.body.innerHTML = `<div>${renderResearchWorkspace(roomId, [])}</div>`;
    const workspace = document.querySelector('[data-pool-research-workspace]');
    const hydrate = vi.fn(async () => {
      await appendResearchRecord(submission);
      return { roomId, remote: true, records: [submission], rejectedRecords: [] };
    });

    await hydrateAndBindResearchWorkspace(workspace, roomId, {
      hydrate,
      hydrateCrossRoom: vi.fn().mockResolvedValue(null)
    });

    expect(document.querySelector('[data-research-review-form] select[name="targetHash"]')?.value)
      .toBe(submission.recordHash);
    expect(document.querySelector('[data-pool-research-sync]')?.textContent)
      .toBe('Coordinator evidence synchronized');
    resetResearchStore();
    localStorage.clear();
  });

  it('attaches qualified origin evidence as a new provisional current-room record', async () => {
    const admittedModel = buildLaunchProviderModel();
    const question = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'current-reuse-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'Can this prior annotation evidence be reused here?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const priorQuestion = await createSignedResearchSubmission({
      identity: await identity('requester'),
      roomId: 'origin-reuse-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'What does the versioned catalog say?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: admittedModel,
      policyId: 'redundant_agreement'
    });
    const source = await createSignedPriorEvidence({
      identity: await identity('researcher'),
      roomId: priorQuestion.roomId,
      questionHash: priorQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'The versioned public catalog assigns a bounded domain.',
      reference: { accession: 'PUBLIC:123', version: '7' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:123', version: '7', label: 'Bounded domain' },
        sequence: { hash: priorQuestion.sequence.hash, length: priorQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      },
      provenance: { retrievalMethod: 'catalog API', license: 'CC BY 4.0' }
    });
    const candidate = {
      recordHash: source.recordHash,
      originRoomId: priorQuestion.roomId,
      qualification: { status: 'source_metadata_complete', reasons: [] }
    };

    const attached = await createCurrentRoomPriorEvidence({
      identity: await identity('researcher'),
      roomId: question.roomId,
      question,
      originQuestion: priorQuestion,
      candidate,
      sourceRecord: source,
      createdAt: '2026-08-15T12:00:00.000Z'
    });

    expect(attached).toMatchObject({
      kind: 'research_prior_evidence',
      roomId: question.roomId,
      questionHash: question.recordHash,
      evidence: {
        kind: 'annotation',
        reuseContext: {
          schema: 'poolday.cross_room_reuse_context/v1',
          originRecordHash: source.recordHash,
          originSource: {
            schema: 'poolday.cross_room_source_identity/v1',
            evidenceKind: 'annotation',
            reference: { accession: 'PUBLIC:123', version: '7' },
            identityHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
          },
          origin: { questionHash: priorQuestion.recordHash, roomId: priorQuestion.roomId },
          current: { questionHash: question.recordHash, roomId: question.roomId },
          comparison: { status: 'declared_context_differences' },
          admission: 'requires_explicit_current_room_context_review'
        },
        annotation: {
          schema: 'poolday.protein_annotation_identity/v1',
          scope: 'domain',
          ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:123', version: '7', label: 'Bounded domain' },
          coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start: 2, end: 12 }
        },
        reference: {
          accession: 'reploid:origin-reuse-room:PUBLIC:123',
          contentHash: source.recordHash
        },
        provenance: {
          retrievalMethod: 'Reploid exact-sequence prior-room lookup',
          sourceIdentity: `origin-reuse-room:${source.recordHash}`,
          license: 'CC BY 4.0'
        }
      }
    });
    expect(await verifyResearchRecord(attached)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(attached, [question])).toMatchObject({ ok: true });
    const unsafeAcceptance = await createSignedHumanClaim({
      identity: await identity('reviewer'),
      roomId: question.roomId,
      targetHash: attached.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Generic acceptance must not silently establish contextual relevance.',
      confidence: 0.8,
      decision: 'accepted'
    });
    expect(validateResearchRecordLinks(unsafeAcceptance, [question, attached])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['accepted cross-room evidence requires an explicit relevant context determination'])
    });
    expect(projectAcceptedResearchMemory([question, attached, unsafeAcceptance]).excluded).toContainEqual({
      recordHash: attached.recordHash,
      reason: 'contextual_relevance_review_missing',
      supersededByHash: null
    });
    const missingContextReviewer = await identity('reviewer');
    expect(() => createContextualReviewRecord({
      action: 'accept',
      identity: missingContextReviewer,
      roomId: question.roomId,
      targetHash: attached.recordHash,
      targetRecord: attached,
      text: 'The source may inform this different current decision context.',
      confidence: 0.8
    })).toThrow('explicit relevant context determination');
    const contextualAcceptance = await createContextualReviewRecord({
      action: 'accept',
      identity: await identity('reviewer'),
      roomId: question.roomId,
      targetHash: attached.recordHash,
      targetRecord: attached,
      contextDetermination: 'relevant',
      text: 'The bounded domain evidence remains relevant despite the declared question difference.',
      confidence: 0.8
    });
    expect(contextualAcceptance.claim.contextAssessment).toMatchObject({
      schema: 'poolday.contextual_reuse_review/v1',
      determination: 'relevant',
      originRecordHash: source.recordHash,
      originQuestionHash: priorQuestion.recordHash,
      currentQuestionHash: question.recordHash,
      comparisonHash: attached.evidence.reuseContext.comparisonHash
    });
    expect(validateResearchRecordLinks(contextualAcceptance, [question, attached])).toMatchObject({ ok: true });
    expect(projectAcceptedResearchMemory([question, attached, contextualAcceptance]).acceptedHashes)
      .toContain(attached.recordHash);
    expect(renderResearchWorkspace(question.roomId, [question, attached]))
      .toContain('Declared source identity');
  });

  it('renders exact-model evidence and explicit non-comparison boundaries', async () => {
    const requester = await identity();
    const submission = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'record-view-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question', text: 'What is the next justified protein evidence action?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const result = await createSignedResearchResult({
      identity: requester,
      submission,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: 'provider_record_view',
          assignmentId: 'assignment_record_view',
          jobId: 'job_record_view',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values([1, 0, 0])
        }
      },
      embedding: [1, 0, 0]
    });

    const html = renderResearchWorkspace(submission.roomId, [submission, result], { reviewTarget: result.recordHash });
    expect(html).toContain('Exact-model evidence, not vector averaging');
    expect(html).toContain('esm2-record-view');
    expect(html).toContain('No cross-model agreement is asserted because only one or no exact model contract has published evidence.');
    expect(html).toContain('Embedding vectors and tokenizer-local masked-token IDs remain in separate exact-model coordinate systems.');
    expect(html).toContain('non-calibrated heuristic');
    expect(html).toContain('does not estimate biological truth, mutation fitness, or a decision-change probability');
    expect(html).toContain(`<option value="${result.recordHash}" selected>`);
    expect(html).not.toContain('[1,0,0]');
  });
});

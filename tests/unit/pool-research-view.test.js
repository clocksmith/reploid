import { describe, expect, it, vi } from 'vitest';

import {
  createSignedResearchResult,
  createSignedResearchSubmission
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';
import { hashSequenceFloat32Values } from '../../self/pool/sequence-result.js';
import {
  bindResearchWorkspace,
  createContextualReviewRecord,
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

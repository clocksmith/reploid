import { describe, expect, it, vi } from 'vitest';

import {
  createSignedResearchResult,
  createSignedResearchSubmission
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { hashSequenceFloat32Values } from '../../self/pool/sequence-result.js';
import {
  createContextualReviewRecord,
  hydrateAndBindResearchWorkspace,
  renderResearchWorkspace
} from '../../self/ui/pool-home/research-view.js';

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
      ['replicate', 'follow_up', 'proposes', null]
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

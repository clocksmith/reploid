import { describe, expect, it } from 'vitest';

import {
  buildEvidenceGraph,
  clusterCompatibleResults,
  createSignedHumanClaim,
  createSignedResearchResult,
  createSignedResearchSubmission,
  findSimilarSequences,
  projectResearchRewards,
  proposeDiscoveryTasks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const model = Object.freeze({
  id: 'esm2-small',
  hash: fakeHash('1'),
  manifestHash: fakeHash('2'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
});

const identity = async (kind, id, root = `${id}-root`) => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: root
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const submission = async (author, sequence = 'MAPLALLLLGLVAGA', label = 'secretory candidate', modelOverride = model) => createSignedResearchSubmission({
  identity: author,
  roomId: 'protein-room',
  sequence,
  intent: { kind: 'hypothesis', text: 'May contain a signal peptide', label },
  consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
  modelContract: modelOverride,
  policyId: 'redundant_agreement'
});

const result = async (author, source, vector, providerId = 'provider_one', modelOverride = model) => createSignedResearchResult({
  identity: author,
  submission: source,
  receiptRecord: {
    receiptHash: fakeHash(vector[0] > 0.5 ? 'a' : 'b'),
    verifierDecision: { accepted: true },
    receipt: {
      model: modelOverride,
      providerId,
      assignmentId: 'assignment-1',
      jobId: 'job-1',
      outputKind: 'sequence.embedding.v1',
      vectorHash: fakeHash('c')
    }
  },
  agreement: { receiptHashes: [fakeHash('a'), fakeHash('d')], status: 'accepted' },
  embedding: vector
});

describe('Poolday evidence network', () => {
  it('signs immutable submissions and detects tampering', async () => {
    const record = await submission(await identity('requester', 'one'));
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true, recordHash: record.recordHash });

    const tampered = { ...record, requesterIntent: { ...record.requesterIntent, text: 'Changed later' } };
    const verification = await verifyResearchRecord(tampered);
    expect(verification.ok).toBe(false);
    expect(verification.reasons).toContain('record hash mismatch');
  });

  it('keeps human claims separate, attributable, and linked in the evidence graph', async () => {
    const requester = await identity('requester', 'one');
    const reviewer = await identity('reviewer', 'two');
    const source = await submission(requester);
    const annotation = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: source.recordHash,
      claimKind: 'annotation',
      relation: 'supports',
      text: 'The N-terminus is hydrophobic.',
      confidence: 0.8,
      evidenceLinks: [{ url: 'https://example.org/evidence', label: 'Public assay' }]
    });
    expect(await verifyResearchRecord(annotation)).toMatchObject({ ok: true });
    expect(annotation.kind).toBe('human_claim');
    expect(annotation.signatureDomain).toBe('poolday.human_claim.v1');

    const graph = buildEvidenceGraph([source, annotation]);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
    expect(graph.edges).toContainEqual({ from: annotation.recordHash, to: source.recordHash, relation: 'supports' });
    expect(graph.nodes).toContainEqual(expect.objectContaining({ kind: 'protein_sequence', sequenceHash: source.sequence.hash }));
    expect(graph.nodes).toContainEqual(expect.objectContaining({ kind: 'evidence_source', url: 'https://example.org/evidence' }));
    expect(graph.edges).toContainEqual({ from: annotation.recordHash, to: 'source:https://example.org/evidence', relation: 'cites' });
  });

  it('retrieves and clusters only exact-contract compatible embeddings', async () => {
    const requester = await identity('requester', 'one');
    const firstSubmission = await submission(requester, 'MAPLALLLLGLVAGA', 'first');
    const secondSubmission = await submission(requester, 'MKVLVVLLCLVPAYG', 'second');
    const otherModel = { ...model, runtime: 'other-runtime' };
    const thirdSubmission = await submission(requester, 'MSSGSSAVAAALPVAAAP', 'third', otherModel);
    const first = await result(requester, firstSubmission, [1, 0, 0]);
    const second = await result(requester, secondSubmission, [0.99, 0.01, 0]);
    const incompatible = await result(requester, thirdSubmission, [1, 0, 0], 'provider_one', otherModel);

    const records = [firstSubmission, secondSubmission, thirdSubmission, first, second, incompatible];
    expect(findSimilarSequences(records, first.recordHash).map((entry) => entry.record.recordHash)).toEqual([second.recordHash]);
    expect(clusterCompatibleResults(records, { threshold: 0.9 }).map((cluster) => cluster.members.length)).toEqual([2, 1]);
  });

  it('gates proposed work and rewards independently accepted durable evidence', async () => {
    const requester = await identity('requester', 'one', 'root-one');
    const curator = await identity('reviewer', 'two', 'root-two');
    const independent = await identity('reviewer', 'three', 'root-three');
    const source = await submission(requester);
    const computed = await result(requester, source, [1, 0, 0]);
    const annotation = await createSignedHumanClaim({
      identity: curator,
      roomId: source.roomId,
      targetHash: computed.recordHash,
      claimKind: 'annotation',
      relation: 'supports',
      text: 'Reviewed model representation in experimental context.',
      confidence: 0.9
    });
    const review = await createSignedHumanClaim({
      identity: independent,
      roomId: source.roomId,
      targetHash: annotation.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Evidence and attribution are sufficient.',
      confidence: 0.95,
      decision: 'accepted'
    });
    const records = [source, computed, annotation, review];

    expect(proposeDiscoveryTasks(records).some((task) => task.kind === 'independent_review')).toBe(true);
    expect(projectResearchRewards(records)).toContainEqual(expect.objectContaining({
      authorId: 'reviewer_two',
      acceptedEvidence: 1,
      durableEvidence: 1,
      points: 8
    }));
    expect(projectResearchRewards(records)).toContainEqual(expect.objectContaining({
      authorId: 'reviewer_three',
      acceptedReviews: 1,
      durableReviews: 1,
      points: 3
    }));
  });
});

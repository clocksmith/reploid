import { describe, expect, it } from 'vitest';

import {
  buildEvidenceGraph,
  buildModelEvidenceView,
  clusterCompatibleResults,
  createSignedHumanClaim,
  createSignedResearchResult,
  createSignedResearchSubmission,
  createSignedSequenceEvidenceLink,
  findSimilarSequences,
  projectResearchRewards,
  proposeDiscoveryTasks,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { reduceDopplerSequenceResult } from '../../self/pool/sequence-result.js';

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

const residueEvidenceModel = Object.freeze({
  ...model,
  id: 'amplify-120m-evidence-test',
  tokenizerHash: fakeHash('3'),
  workload: 'sequence.masked_logits.v1',
  sequence: {
    alphabet: 'amino_acid',
    maxSequenceLength: 1024,
    pooledEmbedding: true,
    tokenEmbeddings: true,
    logits: true,
    coordinates: {
      mapping: 'one_token_per_sequence_symbol',
      prefixTokens: 0
    }
  }
});

const nucleotideModel = Object.freeze({
  ...model,
  id: 'nucleotide-transformer-evidence-test',
  hash: fakeHash('4'),
  manifestHash: fakeHash('5'),
  tokenizerHash: fakeHash('6'),
  sequence: {
    alphabet: 'nucleotide',
    maxSequenceLength: 2048,
    pooledEmbedding: true,
    tokenEmbeddings: true,
    logits: false,
    coordinates: {
      mapping: 'one_token_per_sequence_symbol',
      prefixTokens: 0
    }
  }
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

  it('accepts a public protein proposal without optional reviewer intent', async () => {
    const record = await createSignedResearchSubmission({
      identity: await identity('requester', 'intent-optional'),
      roomId: 'protein-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: { kind: 'question' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    expect(record.requesterIntent).toEqual({ kind: 'question', text: '', label: '', context: '' });
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
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

  it('projects model evidence through durable identities without comparing vector spaces', async () => {
    const requester = await identity('requester', 'model-evidence');
    const source = await submission(requester, 'MAPLALLLLGLVAGA', 'bounded question');
    const independentModel = {
      ...model,
      id: 'esmc-model-evidence-test',
      hash: fakeHash('e'),
      manifestHash: fakeHash('f'),
      tokenizerHash: fakeHash('9'),
      dimensions: 4
    };
    const baseline = await result(requester, source, [1, 0, 0]);
    const independent = await createSignedResearchResult({
      identity: requester,
      submission: source,
      modelContract: independentModel,
      receiptRecord: {
        receiptHash: fakeHash('e'),
        verifierDecision: { accepted: true },
        receipt: {
          model: independentModel,
          providerId: 'provider_two',
          assignmentId: 'assignment-independent',
          jobId: 'job-independent',
          outputKind: 'sequence.embedding.v1',
          vectorHash: fakeHash('c')
        }
      },
      agreement: { receiptHashes: [fakeHash('e')], status: 'accepted' },
      embedding: [0.1, 0.2, 0.3, 0.4]
    });

    const view = buildModelEvidenceView([source, baseline, independent], source.recordHash);
    expect(view).toMatchObject({
      schema: 'poolday.model_evidence_view/v1',
      submissionHash: source.recordHash,
      sequenceHash: source.sequence.hash,
      agreement: { status: 'not_assessed_without_shared_semantic_observation' },
      disagreement: { status: 'not_assessed_without_shared_semantic_observation' },
      nextAction: { kind: 'independent_model_evidence_review', status: 'proposed' }
    });
    expect(view.modelSources).toHaveLength(2);
    expect(view.modelSources.map((entry) => entry.model.id)).toEqual([
      'esm2-small',
      'esmc-model-evidence-test'
    ]);
    expect(JSON.stringify(view)).not.toContain('[1,0,0]');
    expect(view.uncertainty).toContainEqual(expect.objectContaining({
      kind: 'cross_model_vector_comparison_not_permitted'
    }));
    expect(await verifyResearchRecord(independent)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(independent, [source, baseline, independent])).toMatchObject({ ok: true });
  });

  it('rejects published evidence when its receipt-model identity is detached from its exact model contract', async () => {
    const requester = await identity('requester', 'receipt-model-identity');
    const source = await submission(requester);
    const computed = await result(requester, source, [1, 0, 0]);
    const tampered = {
      ...computed,
      compute: { ...computed.compute, receiptModelContractKey: 'wrong-contract' }
    };
    expect(await verifyResearchRecord(tampered)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'record hash mismatch',
        'result receipt model contract identity does not match the published exact model contract'
      ])
    });
    expect(validateResearchRecordLinks(tampered, [source, tampered])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'research result receipt model contract identity does not match its published exact model contract'
      ])
    });
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

  it('publishes bounded, signed residue evidence only when the exact result commitments verify', async () => {
    const author = await identity('researcher', 'residue-evidence');
    const source = await createSignedResearchSubmission({
      identity: author,
      roomId: 'protein-room',
      sequence: 'MKTA',
      intent: { kind: 'question', text: 'Which residues merit an independent review?' },
      consent: {
        publicSequence: true,
        publicEvidenceNetwork: true,
        publishEmbedding: true,
        publishResidueEvidence: true
      },
      modelContract: residueEvidenceModel,
      policyId: 'redundant_agreement'
    });
    const request = {
      workload: 'sequence.masked_logits.v1',
      alphabet: 'amino_acid',
      sequenceHash: source.sequence.hash,
      sequenceLength: source.sequence.length,
      includeTokenEmbeddings: true,
      coordinateSystem: 'zero_based_sequence_index',
      sequenceIndices: [1],
      tokenIndices: [1],
      topK: 2
    };
    const reduced = await reduceDopplerSequenceResult({
      alphabet: 'amino_acid',
      tokens: [0, 1, 2, 3],
      includedTokenCount: 4,
      pooledEmbedding: [0.25, -0.5, 0.75],
      tokenEmbeddings: Array(12).fill(0.125),
      logits: [0, 0.1, 0.2, 0.3, 1, 1.1, 1.2, 1.3, 2, 2.1, 2.2, 2.3, 3, 3.1, 3.2, 3.3],
      embeddingDim: 3,
      vocabSize: 4
    }, request);
    const record = await createSignedResearchResult({
      identity: author,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('7'),
        verifierDecision: { accepted: true },
        receipt: {
          model: residueEvidenceModel,
          providerId: 'provider_one',
          assignmentId: 'assignment-residue-evidence',
          jobId: 'job-residue-evidence',
          outputKind: 'sequence.masked_logits.v1',
          sequenceResultHash: reduced.sequenceResultHash
        }
      },
      sequenceResult: reduced.sequenceResult,
      sequenceOutput: {
        pooledEmbedding: reduced.pooledEmbedding,
        tokenEmbeddings: reduced.tokenEmbeddings,
        residueEmbeddings: reduced.residueEmbeddings,
        maskedLogits: reduced.maskedLogits
      }
    });

    expect(record.sequenceEvidence).toMatchObject({
      coordinateSystem: 'zero_based_sequence_index',
      sequenceIndices: [1],
      tokenIndices: [1],
      claimBoundary: 'Masked-token logits are model-specific residue plausibility evidence, not mutation fitness.'
    });
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
    const view = buildModelEvidenceView([source, record], source.recordHash);
    expect(view.modelSources[0]).toMatchObject({
      maskedResidueProposalCount: 1,
      residuePositions: [1]
    });
    expect(view.agreement.status).toBe('insufficient_independent_model_sources');
    expect(view.nextAction.kind).toBe('independent_residue_review');
  });

  it('links separately governed DNA and protein submissions without treating the translation artifact hash as a protein hash', async () => {
    const author = await identity('researcher', 'sequence-link');
    const nucleotide = await createSignedResearchSubmission({
      identity: author,
      roomId: 'protein-room',
      sequence: 'ATGAAAACC',
      alphabet: 'nucleotide',
      intent: { kind: 'task_context', text: 'Public DNA source for a protein evidence link.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true },
      modelContract: nucleotideModel,
      policyId: 'redundant_agreement'
    });
    const protein = await createSignedResearchSubmission({
      identity: author,
      roomId: 'protein-room',
      sequence: 'MKT',
      intent: { kind: 'task_context', text: 'Public translated protein evidence target.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const link = await createSignedSequenceEvidenceLink({
      identity: author,
      roomId: 'protein-room',
      nucleotideSubmissionHash: nucleotide.recordHash,
      proteinSubmissionHash: protein.recordHash,
      reference: {
        assemblyAccession: 'GCF_000001405',
        assemblyVersion: '40',
        assemblyHash: fakeHash('8'),
        sequenceAccession: 'NC_000001',
        sequenceVersion: '11',
        referenceHash: fakeHash('9')
      },
      coordinates: { coordinateSystem: 'zero_based_half_open', start: 100, end: 109, strand: 'forward' },
      transcript: { accession: 'NM_000001', version: '1', transcriptHash: fakeHash('a') },
      translation: {
        readingFrame: 0,
        geneticCode: 'standard',
        methodId: 'translation-test',
        methodVersion: '1',
        nucleotideSequenceHash: nucleotide.sequence.hash,
        proteinSequenceHash: protein.sequence.hash,
        translationHash: fakeHash('b')
      }
    });

    expect(await verifyResearchRecord(link)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(link, [nucleotide, protein, link])).toMatchObject({ ok: true, reasons: [] });
    const graph = buildEvidenceGraph([nucleotide, protein, link]);
    expect(graph.nodes).toContainEqual(expect.objectContaining({ kind: 'dna_sequence', sequenceHash: nucleotide.sequence.hash }));
    expect(graph.edges).toContainEqual({ from: link.recordHash, to: nucleotide.recordHash, relation: 'links_translation' });
    expect(graph.edges).toContainEqual({ from: link.recordHash, to: protein.recordHash, relation: 'links_translation' });
  });
});

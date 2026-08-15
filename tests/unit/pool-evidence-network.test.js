import { describe, expect, it } from 'vitest';

import {
  LEGACY_RESEARCH_RECORD_VERSION,
  buildEvidenceGraph,
  buildModelEvidenceView,
  clusterCompatibleResults,
  compareResearchDecisionContexts,
  createCrossRoomReuseContext,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchHypothesis,
  createSignedResearchRevocation,
  createSignedResearchResult,
  createSignedResearchSubmission,
  createSignedSequenceEvidenceLink,
  findSimilarSequences,
  projectAcceptedResearchMemory,
  projectCrossRoomSequenceEvidence,
  projectResearchExecutionIndependence,
  projectResearchQuestionClarity,
  projectResearchReviewStates,
  projectResearchRewards,
  proposeDiscoveryTasks,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import {
  SIGNATURE_DOMAINS,
  createSigningKeyPair,
  hashJson,
  signCanonical
} from '../../self/pool/inference-receipt.js';
import { hashSequenceFloat32Values, reduceDopplerSequenceResult } from '../../self/pool/sequence-result.js';
import { createVerifiedResearchAgreement } from '../helpers/pool-research-receipt.js';

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

const result = async (author, source, vector, providerId = 'provider_one', modelOverride = model) => {
  const vectorHash = await hashSequenceFloat32Values(vector);
  const verifiedAgreement = await createVerifiedResearchAgreement({
    model: modelOverride,
    sequenceHash: source.sequence.hash,
    agreementValue: vectorHash,
    providerIds: [providerId, `${providerId}_independent`],
    jobId: `job-${providerId}`
  });
  return createSignedResearchResult({
    identity: author,
    submission: source,
    ...verifiedAgreement,
    embedding: vector
  });
};

describe('Poolday evidence network', () => {
  it('compares declared decision context without equating textual matches with relevance', () => {
    const origin = {
      kind: 'research_submission',
      recordHash: fakeHash('1'),
      roomId: 'origin-context-room',
      sequence: { hash: fakeHash('2') },
      requesterIntent: {
        text: 'Retain this family annotation?',
        decisionContext: 'Catalog release review',
        conditions: 'Public sequence evidence',
        scope: 'Family assignment',
        exclusions: 'No function claim',
        desiredObservation: 'Independent curator agreement'
      }
    };
    const matching = {
      ...origin,
      recordHash: fakeHash('3'),
      roomId: 'current-context-room',
      requesterIntent: {
        ...origin.requesterIntent,
        text: '  retain THIS family annotation?  '
      }
    };
    expect(compareResearchDecisionContexts(origin, matching)).toMatchObject({
      status: 'exact_declared_context_match',
      differences: [],
      missing: []
    });

    const different = {
      ...matching,
      requesterIntent: { ...matching.requesterIntent, decisionContext: 'Experimental assay planning', scope: '' }
    };
    expect(compareResearchDecisionContexts(origin, different)).toMatchObject({
      status: 'declared_context_differences',
      differences: ['decisionContext'],
      missing: ['scope']
    });
  });

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
    expect(record.requesterIntent).toEqual({
      kind: 'question',
      text: '',
      label: '',
      context: '',
      decisionContext: '',
      conditions: '',
      scope: '',
      exclusions: '',
      desiredObservation: '',
      knownUnknowns: ''
    });
    expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
    expect(projectResearchQuestionClarity(record)).toMatchObject({
      status: 'incomplete',
      minimumReady: false,
      score: 0.125
    });
  });

  it('signs a bounded question contract while preserving explicit unknowns', async () => {
    const record = await createSignedResearchSubmission({
      identity: await identity('requester', 'bounded-question'),
      roomId: 'protein-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: {
        kind: 'question',
        text: 'Does this sequence encode a cleavable signal peptide under the declared assay?',
        conditions: 'Cell-free reporter at 30 C.',
        desiredObservation: 'A blinded extracellular reporter ratio.',
        decisionContext: 'Choose a discriminating follow-up assay.',
        scope: 'Signal peptide cleavage under the declared assay.',
        exclusions: 'Does not establish native trafficking.',
        knownUnknowns: 'The model has no cellular context.'
      },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });

    expect(projectResearchQuestionClarity(record)).toMatchObject({
      status: 'bounded',
      minimumReady: true,
      score: 1,
      gaps: []
    });
    expect(record.requesterIntent.knownUnknowns).toBe('The model has no cellular context.');
  });

  it('rejects an accepted agreement backed by only one distinct receipt', async () => {
    const requester = await identity('requester', 'false-agreement');
    const source = await submission(requester);
    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: { model, providerId: 'provider-one', assignmentId: 'one', jobId: 'one' }
      },
      agreement: { status: 'accepted', receiptHashes: [fakeHash('a')] }
    })).rejects.toThrow('accepted compute agreement requires at least two distinct receipt identities');
  });

  it('rejects an accepted agreement without two distinct provider identities', async () => {
    const requester = await identity('requester', 'false-provider-agreement');
    const source = await submission(requester);
    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: { model, providerId: 'provider-one', assignmentId: 'one', jobId: 'one' }
      },
      agreement: { status: 'accepted', receiptHashes: [fakeHash('a'), fakeHash('b')] }
    })).rejects.toThrow('accepted compute agreement requires at least two distinct provider identities');

    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: { model, providerId: 'provider-one', assignmentId: 'one', jobId: 'one' }
      },
      agreement: {
        status: 'accepted',
        receiptHashes: [fakeHash('a'), fakeHash('b')],
        providerIds: ['provider-one', ' ']
      }
    })).rejects.toThrow('compute agreement provider identities must be non-empty strings');
  });

  it('does not treat unbound receipt hashes and provider labels as independent execution', () => {
    const forged = {
      kind: 'research_result',
      compute: {
        receiptHash: fakeHash('a'),
        receiptHashes: [fakeHash('a'), fakeHash('b')],
        providerId: 'provider-one',
        agreement: {
          status: 'accepted',
          receiptHashes: [fakeHash('a'), fakeHash('b')],
          providerIds: ['provider-one', 'provider-two']
        }
      }
    };

    expect(projectResearchExecutionIndependence(forged)).toMatchObject({
      independentlyExecuted: false,
      independentReceiptCount: 0,
      independentProviderCount: 0,
      agreementEvidenceBound: false,
      status: 'single_verified_receipt'
    });
  });

  it('allows agent proposals but reserves review decisions for human roles', async () => {
    const requester = await identity('requester', 'agent-question');
    const agent = await identity('agent', 'proposal-agent');
    const source = await submission(requester);
    const hypothesis = await createSignedResearchHypothesis({
      identity: agent,
      roomId: source.roomId,
      questionHash: source.recordHash,
      statement: 'The N-terminus may be a cleavable signal peptide.',
      conditions: { biologicalSystem: 'declared public cell-free reporter' },
      discriminatingObservations: ['A cleavage-specific reporter signal']
    });

    expect(hypothesis.author.role).toBe('agent');
    expect(await verifyResearchRecord(hypothesis)).toMatchObject({ ok: true });
    await expect(createSignedHumanClaim({
      identity: agent,
      roomId: source.roomId,
      targetHash: hypothesis.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Agent accepts its own proposal.',
      confidence: 1,
      decision: 'accepted'
    })).rejects.toThrow('identity role must be one of');
  });

  it('keeps a replication-requested result outside accepted memory', async () => {
    const requester = await identity('requester', 'replication-question', 'replication-requester');
    const reviewer = await identity('reviewer', 'replication-reviewer', 'replication-reviewer');
    const source = await submission(requester);
    const computed = await result(requester, source, [1, 0, 0]);
    const request = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: computed.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Run the exact model on another independent provider before reuse.',
      confidence: 0.9,
      decision: 'replication_requested'
    });
    const records = [source, computed, request];

    expect(projectResearchReviewStates(records)).toContainEqual(expect.objectContaining({
      recordHash: computed.recordHash,
      state: 'replication_requested',
      replicationRequested: true
    }));
    expect(projectAcceptedResearchMemory(records).acceptedHashes).toEqual([]);
  });

  it('keeps human-accepted single-provider compute outside reusable memory', async () => {
    const requester = await identity('requester', 'single-provider-question', 'single-provider-requester');
    const reviewer = await identity('reviewer', 'single-provider-reviewer', 'single-provider-reviewer');
    const source = await submission(requester);
    const computed = await createSignedResearchResult({
      identity: requester,
      roomId: source.roomId,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: 'provider-one',
          assignmentId: 'single-assignment',
          jobId: 'single-job'
        }
      }
    });
    const acceptance = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: computed.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The visible result is acceptable, subject to independent reproduction.',
      confidence: 0.8,
      decision: 'accepted'
    });
    const records = [source, computed, acceptance];
    const memory = projectAcceptedResearchMemory(records);

    expect(memory.acceptedHashes).toEqual([]);
    expect(memory.excluded).toContainEqual(expect.objectContaining({
      recordHash: computed.recordHash,
      reason: 'independent_execution_missing'
    }));
    expect(proposeDiscoveryTasks(records)).toContainEqual(expect.objectContaining({
      kind: 'reproduce',
      targetHash: computed.recordHash
    }));
  });

  it('projects qualified prior-room evidence without importing it into the current room', async () => {
    const sharedSequence = 'MAPLALLLLGLVAGA';
    const currentQuestion = await createSignedResearchSubmission({
      identity: await identity('requester', 'cross-room-current'),
      roomId: 'current-room',
      sequence: sharedSequence,
      intent: { kind: 'question', text: 'Should this disputed annotation be retained?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt: '2026-08-15T00:00:00.000Z'
    });
    const priorAuthor = await identity('researcher', 'cross-room-prior-author');
    const priorQuestion = await createSignedResearchSubmission({
      identity: await identity('requester', 'cross-room-prior-requester'),
      roomId: 'prior-room',
      sequence: sharedSequence,
      intent: { kind: 'question', text: 'Which versioned annotation evidence supports this family?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt: '2026-08-15T00:01:00.000Z'
    });
    const versioned = await createSignedPriorEvidence({
      identity: priorAuthor,
      roomId: priorQuestion.roomId,
      questionHash: priorQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'Versioned catalog evidence for the disputed family.',
      reference: { accession: 'PUBLIC:123', version: '7' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:123', version: '7', label: 'Bounded domain' },
        sequence: { hash: priorQuestion.sequence.hash, length: priorQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      },
      provenance: {
        retrievalMethod: 'catalog API export',
        retrievedAt: '2026-08-15T00:02:00.000Z',
        license: 'CC BY 4.0'
      },
      createdAt: '2026-08-15T00:02:00.000Z'
    });
    const versionedAcceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'cross-room-versioned-reviewer'),
      roomId: priorQuestion.roomId,
      targetHash: versioned.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept this source identity for the prior room only.',
      confidence: 0.9,
      decision: 'accepted',
      createdAt: '2026-08-15T00:03:00.000Z'
    });
    const correction = await createSignedHumanClaim({
      identity: priorAuthor,
      roomId: priorQuestion.roomId,
      targetHash: versioned.recordHash,
      claimKind: 'correction',
      relation: 'corrects',
      text: 'The catalog entry supports the domain boundary, not the complete family assignment.',
      confidence: 0.95,
      createdAt: '2026-08-15T00:04:00.000Z'
    });
    const correctionAcceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'cross-room-correction-reviewer'),
      roomId: priorQuestion.roomId,
      targetHash: correction.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept the bounded correction in the prior room.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: '2026-08-15T00:05:00.000Z'
    });
    const revokedSource = await createSignedPriorEvidence({
      identity: priorAuthor,
      roomId: priorQuestion.roomId,
      questionHash: priorQuestion.recordHash,
      evidenceKind: 'publication',
      summary: 'A source later withdrawn from future reuse.',
      reference: { uri: 'https://example.test/withdrawn', contentHash: fakeHash('a') },
      provenance: { retrievalMethod: 'manual import', license: 'CC0' },
      createdAt: '2026-08-15T00:06:00.000Z'
    });
    const revocation = await createSignedResearchRevocation({
      identity: priorAuthor,
      roomId: priorQuestion.roomId,
      targetHash: revokedSource.recordHash,
      reason: 'The external source was withdrawn.',
      createdAt: '2026-08-15T00:07:00.000Z'
    });
    const unlicensedQuestion = await createSignedResearchSubmission({
      identity: await identity('requester', 'cross-room-unlicensed-requester'),
      roomId: 'unlicensed-room',
      sequence: sharedSequence,
      intent: { kind: 'question', text: 'Does a second catalog agree?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt: '2026-08-15T00:08:00.000Z'
    });
    const unlicensed = await createSignedPriorEvidence({
      identity: await identity('researcher', 'cross-room-unlicensed-author'),
      roomId: unlicensedQuestion.roomId,
      questionHash: unlicensedQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'A versioned source with no declared reuse license.',
      reference: { accession: 'PUBLIC:456', version: '3' },
      annotation: {
        scope: 'family',
        ontology: { namespace: 'PUBLIC', termId: 'FAMILY:456', version: '3' },
        sequence: { hash: unlicensedQuestion.sequence.hash, length: unlicensedQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_zero_based_half_open', sourceStart: 0, sourceEnd: 15 }
      },
      provenance: { retrievalMethod: 'catalog API export' },
      createdAt: '2026-08-15T00:09:00.000Z'
    });
    const unlicensedAcceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'cross-room-unlicensed-reviewer'),
      roomId: unlicensedQuestion.roomId,
      targetHash: unlicensed.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accepted in the origin room; license remains undeclared.',
      confidence: 0.7,
      decision: 'accepted',
      createdAt: '2026-08-15T00:10:00.000Z'
    });
    const unrelated = await createSignedResearchSubmission({
      identity: await identity('requester', 'cross-room-unrelated'),
      roomId: 'unrelated-room',
      sequence: 'MKTIIALSYIFCLVFA',
      intent: { kind: 'question', text: 'Unrelated sequence.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt: '2026-08-15T00:11:00.000Z'
    });
    const records = [
      currentQuestion,
      priorQuestion,
      versioned,
      versionedAcceptance,
      correction,
      correctionAcceptance,
      revokedSource,
      revocation,
      unlicensedQuestion,
      unlicensed,
      unlicensedAcceptance,
      unrelated,
      unlicensed
    ];

    const projection = projectCrossRoomSequenceEvidence(records, currentQuestion.sequence.hash, {
      currentRoomId: currentQuestion.roomId
    });

    expect(projection).toMatchObject({
      schema: 'poolday.cross_room_sequence_evidence/v1',
      complete: true,
      inputRecordCount: 13,
      uniqueRecordCount: 12
    });
    expect(projection.rooms.map((room) => room.roomId)).toEqual(['current-room', 'prior-room', 'unlicensed-room']);
    expect(projection.rooms.find((room) => room.roomId === 'prior-room')).toMatchObject({
      acceptedMemoryHashes: [correction.recordHash],
      invalidatedRecordHashes: expect.arrayContaining([revokedSource.recordHash])
    });
    expect(projection.rooms.find((room) => room.roomId === 'prior-room').memoryExclusions).toContainEqual({
      recordHash: versioned.recordHash,
      reason: 'superseded_by_accepted_correction',
      supersededByHash: correction.recordHash
    });
    expect(projection.rooms.find((room) => room.roomId === 'prior-room').sourceVersions).toContainEqual(expect.objectContaining({
      recordHash: versioned.recordHash,
      accession: 'PUBLIC:123',
      version: '7',
      license: 'CC BY 4.0'
    }));
    expect(projection.candidates).toContainEqual(expect.objectContaining({
      recordHash: correction.recordHash,
      originRoomId: 'prior-room',
      originalRoomAccepted: true,
      admission: 'requires_current_room_review',
      qualification: {
        status: 'needs_source_qualification',
        reasons: ['contextual_source_qualification_required']
      }
    }));
    expect(projection.candidates).toContainEqual(expect.objectContaining({
      recordHash: unlicensed.recordHash,
      qualification: {
        status: 'needs_source_qualification',
        reasons: ['source_license_missing']
      }
    }));
    expect(projection.candidates.every((candidate) => candidate.originRoomId !== 'current-room')).toBe(true);
    expect(projection.records.some((record) => record.recordHash === unrelated.recordHash)).toBe(false);
    expect(projectAcceptedResearchMemory([currentQuestion]).acceptedHashes).toEqual([]);
  });

  it('keeps accepted free-text annotations visible but blocks automatic cross-room reuse', async () => {
    const sequence = 'MAPLALLLLGLVAGA';
    const currentQuestion = await createSignedResearchSubmission({
      identity: await identity('requester', 'normalization-current'),
      roomId: 'normalization-current-room',
      sequence,
      intent: { kind: 'question', text: 'Should this family annotation be retained?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const originQuestion = await createSignedResearchSubmission({
      identity: await identity('requester', 'normalization-origin'),
      roomId: 'normalization-origin-room',
      sequence,
      intent: { kind: 'question', text: 'What did the public catalog report?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const unnormalized = await createSignedPriorEvidence({
      identity: await identity('researcher', 'normalization-author'),
      roomId: originQuestion.roomId,
      questionHash: originQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'A historical annotation without a normalized term or residue interval.',
      reference: { accession: 'LEGACY:123', version: '1' },
      provenance: { retrievalMethod: 'legacy catalog export', license: 'CC0' }
    });
    const acceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'normalization-reviewer'),
      roomId: originQuestion.roomId,
      targetHash: unnormalized.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accepted in its historical room context.',
      confidence: 0.8,
      decision: 'accepted'
    });

    const projection = projectCrossRoomSequenceEvidence([
      currentQuestion,
      originQuestion,
      unnormalized,
      acceptance
    ], currentQuestion.sequence.hash, { currentRoomId: currentQuestion.roomId });

    expect(projection.rooms.find((room) => room.roomId === originQuestion.roomId)?.archiveRecordHashes)
      .toContain(unnormalized.recordHash);
    expect(projection.candidates).toContainEqual(expect.objectContaining({
      recordHash: unnormalized.recordHash,
      originalRoomAccepted: true,
      qualification: {
        status: 'needs_source_qualification',
        reasons: ['annotation_identity_missing']
      }
    }));
  });

  it('deduplicates one declared source across origin rooms and decision memory', async () => {
    const sequence = 'MAPLALLLLGLVAGA';
    const question = async (roomId, id, text) => createSignedResearchSubmission({
      identity: await identity('requester', id),
      roomId,
      sequence,
      intent: { kind: 'question', text },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const current = await question('dedupe-current-room', 'dedupe-current', 'Should this domain annotation be retained?');
    const originOne = await question('dedupe-origin-one', 'dedupe-origin-one', 'What does catalog release seven report?');
    const originTwo = await question('dedupe-origin-two', 'dedupe-origin-two', 'Does release seven support this domain boundary?');
    const createOriginSource = async (origin, id) => createSignedPriorEvidence({
      identity: await identity('researcher', id),
      roomId: origin.roomId,
      questionHash: origin.recordHash,
      evidenceKind: 'annotation',
      summary: 'The same versioned catalog record was independently imported.',
      reference: { accession: 'PUBLIC:DEDUPE', version: '7', contentHash: fakeHash('d') },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'PUBLIC', termId: 'DOMAIN:DEDUPE', version: '7' },
        sequence: { hash: origin.sequence.hash, length: origin.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      },
      provenance: { retrievalMethod: 'version-pinned catalog API', license: 'CC BY 4.0' }
    });
    const sourceOne = await createOriginSource(originOne, 'dedupe-source-one');
    const sourceTwo = await createOriginSource(originTwo, 'dedupe-source-two');
    const acceptOrigin = async (source, id) => createSignedHumanClaim({
      identity: await identity('reviewer', id),
      roomId: source.roomId,
      targetHash: source.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept this source only in its origin decision context.',
      confidence: 0.9,
      decision: 'accepted'
    });
    const originAcceptanceOne = await acceptOrigin(sourceOne, 'dedupe-origin-review-one');
    const originAcceptanceTwo = await acceptOrigin(sourceTwo, 'dedupe-origin-review-two');
    const projection = projectCrossRoomSequenceEvidence([
      current,
      originOne,
      sourceOne,
      originAcceptanceOne,
      originTwo,
      sourceTwo,
      originAcceptanceTwo
    ], current.sequence.hash, { currentRoomId: current.roomId });

    expect(projection.candidateRecordCount).toBe(2);
    expect(projection.candidateSourceCount).toBe(1);
    expect(projection.candidates).toHaveLength(1);
    expect(projection.candidates[0]).toMatchObject({
      deduplication: 'same_declared_versioned_source',
      duplicateRecordHashes: expect.arrayContaining([sourceOne.recordHash, sourceTwo.recordHash]),
      duplicateOriginRoomIds: ['dedupe-origin-one', 'dedupe-origin-two']
    });

    const attach = async (source, origin, id, createdAt) => {
      const reuseContext = await createCrossRoomReuseContext({
        originRecord: source,
        originQuestion: origin,
        currentQuestion: current
      });
      return createSignedPriorEvidence({
        identity: await identity('researcher', id),
        roomId: current.roomId,
        questionHash: current.recordHash,
        evidenceKind: source.evidence.kind,
        summary: `Current-room reference to ${source.recordHash}.`,
        reference: { accession: `reploid:${source.roomId}:PUBLIC:DEDUPE`, contentHash: source.recordHash },
        annotation: source.evidence.annotation,
        reuseContext,
        provenance: { retrievalMethod: 'Reploid exact-sequence prior-room lookup', license: 'CC BY 4.0' },
        createdAt
      });
    };
    const attachedOne = await attach(sourceOne, originOne, 'dedupe-attach-one', '2026-08-15T10:00:00.000Z');
    const attachedTwo = await attach(sourceTwo, originTwo, 'dedupe-attach-two', '2026-08-15T10:01:00.000Z');
    expect(attachedOne.evidence.reuseContext.originSource.identityHash)
      .toBe(attachedTwo.evidence.reuseContext.originSource.identityHash);
    const acceptAttached = async (attached, id) => createSignedHumanClaim({
      identity: await identity('reviewer', id),
      roomId: current.roomId,
      targetHash: attached.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'This declared source remains relevant to the current decision.',
      confidence: 0.9,
      decision: 'accepted',
      contextAssessment: {
        determination: 'relevant',
        originRecordHash: attached.evidence.reuseContext.originRecordHash,
        originQuestionHash: attached.evidence.reuseContext.origin.questionHash,
        currentQuestionHash: attached.evidence.reuseContext.current.questionHash,
        comparisonHash: attached.evidence.reuseContext.comparisonHash,
        rationale: 'This declared source remains relevant to the current decision.'
      }
    });
    const currentAcceptanceOne = await acceptAttached(attachedOne, 'dedupe-current-review-one');
    const currentAcceptanceTwo = await acceptAttached(attachedTwo, 'dedupe-current-review-two');
    const memory = projectAcceptedResearchMemory([
      current,
      attachedOne,
      currentAcceptanceOne,
      attachedTwo,
      currentAcceptanceTwo
    ]);

    expect(memory.acceptedHashes).toContain(attachedOne.recordHash);
    expect(memory.acceptedHashes).not.toContain(attachedTwo.recordHash);
    expect(memory.excluded).toContainEqual(expect.objectContaining({
      recordHash: attachedTwo.recordHash,
      reason: 'duplicate_cross_room_source',
      duplicateOfHash: attachedOne.recordHash
    }));
  });

  it('preserves signed v1 results for inspection without admitting legacy independence claims', async () => {
    const keyPair = await createSigningKeyPair();
    const requester = {
      resolve: async () => ({
        kind: 'requester',
        roleId: 'requester_legacy_result',
        userId: 'user_legacy_result',
        deviceId: 'device_legacy_result',
        identityRootId: 'root_legacy_result'
      }),
      getSigningKeyPair: async () => keyPair
    };
    const source = await submission(requester);
    const modern = await createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('a'),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: 'provider-legacy',
          assignmentId: 'legacy-assignment',
          jobId: 'legacy-job'
        }
      }
    });
    const { recordHash: _modernHash, signature: _modernSignature, ...modernPayload } = modern;
    const { receiptAdmission: _admission, receiptEvidence: _evidence, ...legacyCompute } = modernPayload.compute;
    const legacyPayload = {
      ...modernPayload,
      version: LEGACY_RESEARCH_RECORD_VERSION,
      compute: legacyCompute
    };
    const legacyHash = await hashJson(legacyPayload);
    const unsignedLegacy = { ...legacyPayload, recordHash: legacyHash };
    const legacy = {
      ...unsignedLegacy,
      signature: await signCanonical(unsignedLegacy, keyPair.privateKey, {
        domain: SIGNATURE_DOMAINS.researchResult
      })
    };

    expect(await verifyResearchRecord(legacy)).toMatchObject({ ok: true });
    expect(projectResearchExecutionIndependence(legacy)).toMatchObject({ independentlyExecuted: false });
  });

  it('preserves signed v1 task approvals without replaying them as exact v2 approvals', async () => {
    const requester = await identity('requester', 'legacy-approval-requester');
    const reviewerKeys = await createSigningKeyPair();
    const reviewer = {
      resolve: async () => ({
        kind: 'reviewer',
        roleId: 'reviewer_legacy_approval',
        userId: 'user_legacy_approval',
        deviceId: 'device_legacy_approval',
        identityRootId: 'root_legacy_approval'
      }),
      getSigningKeyPair: async () => reviewerKeys
    };
    const source = await submission(requester);
    const task = proposeDiscoveryTasks([source]).find((candidate) => candidate.kind === 'compute');
    const modern = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: source.recordHash,
      claimKind: 'task_approval',
      relation: 'approves',
      text: 'Legacy approval remains attributable history.',
      confidence: 1,
      decision: 'approved',
      taskId: task.taskId,
      taskContract: task.taskContract
    });
    const { recordHash: _modernHash, signature: _modernSignature, ...modernPayload } = modern;
    const legacyPayload = {
      ...modernPayload,
      version: LEGACY_RESEARCH_RECORD_VERSION,
      claim: { ...modernPayload.claim, taskContract: null }
    };
    const legacyHash = await hashJson(legacyPayload);
    const unsignedLegacy = { ...legacyPayload, recordHash: legacyHash };
    const legacy = {
      ...unsignedLegacy,
      signature: await signCanonical(unsignedLegacy, reviewerKeys.privateKey, {
        domain: SIGNATURE_DOMAINS.humanClaim
      })
    };

    expect(await verifyResearchRecord(legacy)).toMatchObject({ ok: true });
    expect(proposeDiscoveryTasks([source, legacy]).find((candidate) => candidate.kind === 'compute'))
      .toMatchObject({ status: 'proposed', approvalRecordHashes: [] });
  });

  it('requires task approval to replay the exact projected task contract', async () => {
    const requester = await identity('requester', 'task-contract-requester', 'task-contract-requester');
    const reviewer = await identity('reviewer', 'task-contract-reviewer', 'task-contract-reviewer');
    const source = await createSignedResearchSubmission({
      identity: requester,
      roomId: 'task-contract-room',
      sequence: 'MAPLALLLLGLVAGA',
      intent: {
        kind: 'question',
        text: 'What exact model evidence is available?',
        conditions: 'Public sequence under the exact model contract.',
        desiredObservation: 'A receipt-backed exact model output.'
      },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const computeTask = proposeDiscoveryTasks([source]).find((task) => task.kind === 'compute');
    const staleApproval = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: source.recordHash,
      claimKind: 'task_approval',
      relation: 'approves',
      text: 'Approve a stale task description.',
      confidence: 1,
      decision: 'approved',
      taskId: computeTask.taskId,
      taskContract: { ...computeTask.taskContract, reason: 'A different task rationale.' }
    });

    expect(await verifyResearchRecord(staleApproval)).toMatchObject({ ok: true });
    expect(proposeDiscoveryTasks([source, staleApproval]).find((task) => task.kind === 'compute').status)
      .toBe('proposed');

    const exactApproval = await createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: source.recordHash,
      claimKind: 'task_approval',
      relation: 'approves',
      text: 'Approve the exact current task contract.',
      confidence: 1,
      decision: 'approved',
      taskId: computeTask.taskId,
      taskContract: computeTask.taskContract
    });
    expect(proposeDiscoveryTasks([source, staleApproval, exactApproval]).find((task) => task.kind === 'compute'))
      .toMatchObject({
        status: 'approved',
        approvalRecordHashes: [exactApproval.recordHash]
      });

    const unrelated = await createSignedResearchSubmission({
      identity: requester,
      roomId: source.roomId,
      sequence: 'MKVLVVLLCLVPAYG',
      intent: {
        kind: 'question',
        text: 'What evidence exists for the unrelated sequence?',
        conditions: 'Public sequence under the exact model contract.',
        desiredObservation: 'A receipt-backed exact model output.'
      },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    await expect(createSignedHumanClaim({
      identity: reviewer,
      roomId: source.roomId,
      targetHash: unrelated.recordHash,
      claimKind: 'task_approval',
      relation: 'approves',
      text: 'Attempt to reuse approval identity against another target.',
      confidence: 1,
      decision: 'approved',
      taskId: computeTask.taskId,
      taskContract: computeTask.taskContract
    })).rejects.toThrow('task approval contract does not match its task or target identity');
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
    const tokenizerVariant = { ...model, tokenizerHash: fakeHash('c') };
    const fourthSubmission = await submission(requester, 'MALWMRLLPLLALLALWGPDPAAA', 'fourth', tokenizerVariant);
    const first = await result(requester, firstSubmission, [1, 0, 0]);
    const second = await result(requester, secondSubmission, [0.99, 0.01, 0]);
    const incompatible = await result(requester, thirdSubmission, [1, 0, 0], 'provider_one', otherModel);
    const tokenizerIncompatible = await result(requester, fourthSubmission, [1, 0, 0], 'provider_one', tokenizerVariant);

    const records = [
      firstSubmission, secondSubmission, thirdSubmission, fourthSubmission,
      first, second, incompatible, tokenizerIncompatible
    ];
    expect(findSimilarSequences(records, first.recordHash).map((entry) => entry.record.recordHash)).toEqual([second.recordHash]);
    expect(clusterCompatibleResults(records, { threshold: 0.9 }).map((cluster) => cluster.members.length)).toEqual([2, 1, 1]);
    expect(buildEvidenceGraph(records).nodes.filter((node) => node.kind === 'model_artifact')).toHaveLength(3);
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
    const independentVector = [0.1, 0.2, 0.3, 0.4];
    const independentAgreement = await createVerifiedResearchAgreement({
      model: independentModel,
      sequenceHash: source.sequence.hash,
      agreementValue: await hashSequenceFloat32Values(independentVector),
      providerIds: ['provider_two', 'provider_three'],
      jobId: 'job-independent'
    });
    const independent = await createSignedResearchResult({
      identity: requester,
      submission: source,
      modelContract: independentModel,
      ...independentAgreement,
      embedding: independentVector
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

  it('rejects an embedding whose float32 bytes do not match the receipt commitment', async () => {
    const requester = await identity('requester', 'vector-commitment');
    const source = await submission(requester);
    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('e'),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: 'provider-vector-commitment',
          assignmentId: 'assignment-vector-commitment',
          jobId: 'job-vector-commitment',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values([1, 0, 0])
        }
      },
      embedding: [0, 1, 0]
    })).rejects.toThrow('published embedding does not match the receipt vector commitment');
  });

  it('rejects a result when no verifier explicitly accepted the receipt', async () => {
    const requester = await identity('requester', 'missing-verifier-decision');
    const source = await submission(requester);
    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('e'),
        receipt: {
          model,
          providerId: 'provider-unverified',
          assignmentId: 'assignment-unverified',
          jobId: 'job-unverified',
          outputKind: 'sequence.embedding.v1'
        }
      }
    })).rejects.toThrow('an accepted verifier decision or verified peer agreement is required for a research result');
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

  it('rejects a record whose receipt set omits its primary receipt', async () => {
    const requester = await identity('requester', 'receipt-set-binding');
    const source = await submission(requester);
    const computed = await result(requester, source, [1, 0, 0]);
    const tampered = {
      ...computed,
      compute: { ...computed.compute, receiptHashes: [fakeHash('f')] }
    };
    expect(await verifyResearchRecord(tampered)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['result receiptHashes must include the primary receiptHash'])
    });
  });

  it('rejects a receipt that changes an exact-contract field not covered by legacy identity fields', async () => {
    const requester = await identity('requester', 'receipt-artifact-identity');
    const source = await submission(requester);
    const declaredModel = {
      ...model,
      artifactIdentity: { sourceRevision: 'revision-one', conversionDigest: fakeHash('c') }
    };
    const receiptModel = {
      ...declaredModel,
      artifactIdentity: { sourceRevision: 'revision-two', conversionDigest: fakeHash('c') }
    };
    await expect(createSignedResearchResult({
      identity: requester,
      submission: source,
      modelContract: declaredModel,
      receiptRecord: {
        receiptHash: fakeHash('d'),
        verifierDecision: { accepted: true },
        receipt: {
          model: receiptModel,
          providerId: 'provider-artifact-identity',
          assignmentId: 'assignment-artifact-identity',
          jobId: 'job-artifact-identity',
          outputKind: 'sequence.embedding.v1'
        }
      }
    })).rejects.toThrow('compute receipt model contract does not exactly match the result exact model contract');
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

  it('rejects residue evidence that drifts from its submitted length or exact token coordinates', async () => {
    const author = await identity('researcher', 'residue-coordinate-binding');
    const source = await createSignedResearchSubmission({
      identity: author,
      roomId: 'protein-room',
      sequence: 'MKTA',
      intent: { kind: 'question', text: 'Which residue coordinate is reviewable?' },
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
      workload: 'sequence.masked_logits.v1', alphabet: 'amino_acid',
      sequenceHash: source.sequence.hash, sequenceLength: source.sequence.length,
      coordinateSystem: 'zero_based_sequence_index', sequenceIndices: [1], tokenIndices: [1],
      includeTokenEmbeddings: true, topK: 1
    };
    const reduced = await reduceDopplerSequenceResult({
      alphabet: 'amino_acid', tokens: [0, 1, 2, 3], includedTokenCount: 4,
      pooledEmbedding: [0.25, -0.5, 0.75], tokenEmbeddings: Array(12).fill(0.125),
      logits: [0, 0.1, 0.2, 0.3, 1, 1.1, 1.2, 1.3, 2, 2.1, 2.2, 2.3, 3, 3.1, 3.2, 3.3],
      embeddingDim: 3, vocabSize: 4
    }, request);
    const record = await createSignedResearchResult({
      identity: author,
      submission: source,
      receiptRecord: {
        receiptHash: fakeHash('8'), verifierDecision: { accepted: true },
        receipt: {
          model: residueEvidenceModel, providerId: 'provider-coordinate-binding',
          assignmentId: 'assignment-coordinate-binding', jobId: 'job-coordinate-binding',
          outputKind: 'sequence.masked_logits.v1', sequenceResultHash: reduced.sequenceResultHash
        }
      },
      sequenceResult: reduced.sequenceResult,
      sequenceOutput: {
        pooledEmbedding: reduced.pooledEmbedding, tokenEmbeddings: reduced.tokenEmbeddings,
        residueEmbeddings: reduced.residueEmbeddings, maskedLogits: reduced.maskedLogits
      }
    });

    const wrongLength = structuredClone(record);
    wrongLength.sequenceLength = 3;
    expect(await verifyResearchRecord(wrongLength)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['sequence evidence length does not match the result sequence'])
    });
    expect(validateResearchRecordLinks(wrongLength, [source, wrongLength])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['research result sequence length does not match its submission'])
    });

    const wrongCoordinates = structuredClone(record);
    wrongCoordinates.sequenceEvidence.tokenIndices = [2];
    expect(await verifyResearchRecord(wrongCoordinates)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['sequence evidence token coordinates do not match the exact model contract'])
    });

    const tokenizerLocal = structuredClone(record);
    tokenizerLocal.sequenceEvidence.coordinateSystem = 'model_token_index';
    expect(await verifyResearchRecord(tokenizerLocal)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'model-token sequence evidence must not claim residue indices',
        'model-token sequence evidence must not publish residue embeddings'
      ])
    });
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

import { describe, expect, it } from 'vitest';

import {
  PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION,
  projectProteinUncertaintyCampaignQueue
} from '../../self/pool/protein-uncertainty-campaign.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const at = (minute) => `2026-08-15T12:${String(minute).padStart(2, '0')}:00.000Z`;
const author = (role, id) => ({ role, roleId: `${role}_${id}`, identityRootId: `root_${id}` });
const model = (id = 'esm2-campaign') => ({
  id,
  hash: fakeHash(id === 'esm2-campaign' ? '1' : '2'),
  manifestHash: fakeHash(id === 'esm2-campaign' ? '3' : '4'),
  tokenizerHash: fakeHash('5'),
  runtime: 'doppler',
  backend: 'browser-webgpu',
  workload: 'sequence.embedding.v1',
  executionMode: 'full_model_browser_sequence',
  dimensions: 3
});

const question = ({ hash, roomId, sequenceHash, label, minute = 0 }) => ({
  kind: 'research_submission',
  recordHash: hash,
  roomId,
  createdAt: at(minute),
  author: author('requester', `${roomId}-requester`),
  sequence: { hash: sequenceHash, alphabet: 'amino_acid', length: 15, value: 'MAPLALLLLGLVAGA' },
  consent: { publicSequence: true, publicEvidenceNetwork: true },
  requesterIntent: { label, text: label }
});

const review = ({ hash, roomId, targetHash, decision, reviewer, minute }) => ({
  kind: 'human_claim',
  recordHash: hash,
  roomId,
  createdAt: at(minute),
  author: author('reviewer', reviewer),
  targetHash,
  claim: { kind: 'review_decision', relation: 'reviews', decision }
});

const independentResult = ({ hash, questionRecord, vectorHash, modelContract = model(), minute }) => {
  const receiptOne = fakeHash('0');
  const receiptTwo = fakeHash('1');
  const evidence = (receiptHash, providerId, key) => ({
    receiptHash,
    providerId,
    providerPublicKey: key,
    receipt: { providerId, providerSignature: `signature-${providerId}` }
  });
  return {
    kind: 'research_result',
    recordHash: hash,
    roomId: questionRecord.roomId,
    createdAt: at(minute),
    author: author('requester', `${hash}-author`),
    submissionHash: questionRecord.recordHash,
    sequenceHash: questionRecord.sequence.hash,
    modelContract,
    embedding: { vectorHash, values: [1, 0, 0], dimensions: 3 },
    compute: {
      receiptHash: receiptOne,
      agreement: {
        status: 'accepted',
        receiptHashes: [receiptOne, receiptTwo],
        providerIds: [`provider-${hash}-one`, `provider-${hash}-two`]
      },
      receiptEvidence: [
        evidence(receiptOne, `provider-${hash}-one`, `key-${hash}-one`),
        evidence(receiptTwo, `provider-${hash}-two`, `key-${hash}-two`)
      ]
    }
  };
};

describe('public protein uncertainty campaign queue', () => {
  it('ranks declared disagreement dimensions without using evidence volume as the score', () => {
    const roomId = 'campaign-priority-room';
    const primaryQuestion = question({
      hash: fakeHash('a'),
      roomId,
      sequenceHash: fakeHash('b'),
      label: 'Disputed public domain annotation',
      minute: 0
    });
    const quietQuestion = question({
      hash: fakeHash('c'),
      roomId: 'campaign-quiet-room',
      sequenceHash: fakeHash('d'),
      label: 'No observed disagreement',
      minute: 1
    });
    const resultOne = independentResult({
      hash: fakeHash('e'),
      questionRecord: primaryQuestion,
      vectorHash: fakeHash('f'),
      minute: 2
    });
    const resultTwo = independentResult({
      hash: fakeHash('g'),
      questionRecord: primaryQuestion,
      vectorHash: fakeHash('h'),
      minute: 3
    });
    const annotationOne = {
      kind: 'research_prior_evidence',
      recordHash: fakeHash('i'),
      roomId,
      createdAt: at(4),
      author: author('researcher', 'annotation-one'),
      questionHash: primaryQuestion.recordHash,
      evidence: {
        schema: 'poolday.public_protein_evidence/v1',
        access: 'public',
        kind: 'annotation',
        annotation: {
          identityHash: fakeHash('j'),
          scope: 'domain',
          sequence: { hash: primaryQuestion.sequence.hash },
          coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start: 2, end: 12 }
        },
        conditions: { biologicalSystem: 'public catalog' },
        transformations: [{ id: 'normalize-annotation', version: '1.0.0' }],
        provenance: { sourceIdentity: 'catalog-one', license: 'CC BY 4.0', retrievalMethod: 'pinned API', retrievedAt: at(4) },
        finding: { classification: 'not_applicable', attempt: { status: 'not_applicable', failureCategory: 'none' } }
      }
    };
    const annotationTwo = {
      kind: 'research_prior_evidence',
      recordHash: fakeHash('k'),
      roomId,
      createdAt: at(5),
      author: author('researcher', 'annotation-two'),
      questionHash: primaryQuestion.recordHash,
      evidence: {
        schema: 'poolday.public_protein_evidence/v1',
        access: 'public',
        kind: 'domain',
        annotation: {
          identityHash: fakeHash('l'),
          scope: 'domain',
          sequence: { hash: primaryQuestion.sequence.hash },
          coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start: 2, end: 12 }
        },
        conditions: { biologicalSystem: 'public catalog' },
        transformations: [{ id: 'normalize-domain', version: '1.0.0' }],
        provenance: { sourceIdentity: 'catalog-two', license: 'CC BY 4.0', retrievalMethod: 'pinned API', retrievedAt: at(5) },
        finding: { classification: 'not_applicable', attempt: { status: 'not_applicable', failureCategory: 'none' } }
      }
    };
    const disputedHypothesis = {
      kind: 'research_hypothesis',
      recordHash: fakeHash('m'),
      roomId,
      createdAt: at(6),
      author: author('researcher', 'hypothesis'),
      questionHash: primaryQuestion.recordHash
    };
    const positive = {
      kind: 'research_outcome',
      recordHash: fakeHash('n'),
      roomId,
      createdAt: at(7),
      author: author('researcher', 'lab-one'),
      questionHash: primaryQuestion.recordHash,
      outcome: {
        classification: 'positive',
        attempt: { status: 'completed' },
        protocol: { conditions: { temperature: '30 C', biologicalSystem: 'public reporter' } }
      }
    };
    const negative = {
      kind: 'research_outcome',
      recordHash: fakeHash('o'),
      roomId,
      createdAt: at(8),
      author: author('researcher', 'lab-two'),
      questionHash: primaryQuestion.recordHash,
      outcome: {
        classification: 'negative',
        attempt: { status: 'completed' },
        protocol: { conditions: { biologicalSystem: 'public reporter', temperature: '30 C' } }
      }
    };
    const acceptedTargets = [resultOne, resultTwo, annotationOne, annotationTwo, positive, negative];
    const acceptances = acceptedTargets.map((target, index) => review({
      hash: fakeHash(String.fromCharCode('p'.charCodeAt(0) + index)),
      roomId,
      targetHash: target.recordHash,
      decision: 'accepted',
      reviewer: `accept-${index}`,
      minute: 10 + index
    }));
    const reviewerConflict = [
      review({ hash: fakeHash('v'), roomId, targetHash: disputedHypothesis.recordHash, decision: 'accepted', reviewer: 'conflict-one', minute: 20 }),
      review({ hash: fakeHash('w'), roomId, targetHash: disputedHypothesis.recordHash, decision: 'rejected', reviewer: 'conflict-two', minute: 21 })
    ];
    const quietEvidence = Array.from({ length: 6 }, (_, index) => ({
      kind: 'research_hypothesis',
      recordHash: fakeHash(String(index + 1)),
      roomId: quietQuestion.roomId,
      createdAt: at(22 + index),
      author: author('researcher', `quiet-${index}`),
      questionHash: quietQuestion.recordHash
    }));
    const records = [
      primaryQuestion,
      quietQuestion,
      resultOne,
      resultTwo,
      annotationOne,
      annotationTwo,
      disputedHypothesis,
      positive,
      negative,
      ...acceptances,
      ...reviewerConflict,
      ...quietEvidence
    ];

    const projection = projectProteinUncertaintyCampaignQueue(records);

    expect(projection).toMatchObject({
      schema: PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION,
      policy: {
        method: 'count_declared_disagreement_dimensions',
        status: 'heuristic_not_calibrated'
      },
      complete: true
    });
    expect(projection.entries).toHaveLength(2);
    expect(projection.entries[0]).toMatchObject({
      rank: 1,
      sequence: { hash: primaryQuestion.sequence.hash },
      priority: { disagreementCount: 4, eligible: true },
      dimensions: {
        exactContractEmbedding: { status: 'disagreement' },
        publicAnnotation: { status: 'disagreement' },
        independentReviewer: { status: 'disagreement' },
        experimentalEvidence: { status: 'disagreement' }
      }
    });
    expect(projection.entries[1]).toMatchObject({
      sequence: { hash: quietQuestion.sequence.hash },
      priority: { disagreementCount: 0, eligible: false }
    });
    expect(projectProteinUncertaintyCampaignQueue(records.slice().reverse()).entries)
      .toEqual(projection.entries);
  });

  it('never compares embeddings across contracts or annotations across different loci', () => {
    const source = question({
      hash: fakeHash('a'),
      roomId: 'campaign-model-boundary-room',
      sequenceHash: fakeHash('b'),
      label: 'Exact model boundary',
      minute: 0
    });
    const first = independentResult({
      hash: fakeHash('c'),
      questionRecord: source,
      vectorHash: fakeHash('d'),
      modelContract: model('esm2-campaign'),
      minute: 1
    });
    const second = independentResult({
      hash: fakeHash('e'),
      questionRecord: source,
      vectorHash: fakeHash('f'),
      modelContract: model('another-contract'),
      minute: 2
    });
    const annotation = (hash, identityHash, start, end, minute) => ({
      kind: 'research_prior_evidence',
      recordHash: hash,
      roomId: source.roomId,
      createdAt: at(minute),
      author: author('researcher', `locus-${start}`),
      questionHash: source.recordHash,
      evidence: {
        schema: 'poolday.public_protein_evidence/v1',
        access: 'public',
        kind: 'domain',
        annotation: {
          identityHash,
          scope: 'domain',
          sequence: { hash: source.sequence.hash },
          coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start, end }
        },
        conditions: { biologicalSystem: 'public catalog' },
        transformations: [{ id: 'normalize-domain', version: '1.0.0' }],
        provenance: { sourceIdentity: `catalog-${start}`, license: 'CC BY 4.0', retrievalMethod: 'pinned API', retrievedAt: at(minute) },
        finding: { classification: 'not_applicable', attempt: { status: 'not_applicable', failureCategory: 'none' } }
      }
    });
    const firstLocus = annotation(fakeHash('i'), fakeHash('1'), 1, 5, 5);
    const secondLocus = annotation(fakeHash('j'), fakeHash('2'), 9, 14, 6);
    const records = [
      source,
      first,
      second,
      review({ hash: fakeHash('g'), roomId: source.roomId, targetHash: first.recordHash, decision: 'accepted', reviewer: 'one', minute: 3 }),
      review({ hash: fakeHash('h'), roomId: source.roomId, targetHash: second.recordHash, decision: 'accepted', reviewer: 'two', minute: 4 }),
      firstLocus,
      secondLocus,
      review({ hash: fakeHash('k'), roomId: source.roomId, targetHash: firstLocus.recordHash, decision: 'accepted', reviewer: 'three', minute: 7 }),
      review({ hash: fakeHash('l'), roomId: source.roomId, targetHash: secondLocus.recordHash, decision: 'accepted', reviewer: 'four', minute: 8 })
    ];

    const dimensions = projectProteinUncertaintyCampaignQueue(records).entries[0].dimensions;
    expect(dimensions.exactContractEmbedding)
      .toMatchObject({ status: 'insufficient_evidence', disagreeingContractCount: 0 });
    expect(dimensions.publicAnnotation)
      .toMatchObject({ status: 'insufficient_evidence', disagreeingLocusCount: 0 });
  });
});

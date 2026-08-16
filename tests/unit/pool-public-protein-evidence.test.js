import { describe, expect, it } from 'vitest';

import {
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedPublicProteinEvidence,
  createSignedResearchSubmission,
  projectCrossRoomSequenceEvidence,
  proposeDiscoveryTasks,
  searchEvidence,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';

const identity = async (kind, id) => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: `root_${id}`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const question = async (roomId, id) => createSignedResearchSubmission({
  identity: await identity('requester', id),
  roomId,
  sequence: 'MAPLALLLLGLVAGA',
  intent: { kind: 'question', text: 'Should this disputed public domain annotation be retained?' },
  consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
  modelContract: buildLaunchProviderModel(),
  policyId: 'redundant_agreement'
});

const publicEvidenceArgs = (submission, kind, overrides = {}) => ({
  identity: overrides.identity,
  roomId: submission.roomId,
  questionHash: submission.recordHash,
  evidenceKind: kind,
  summary: overrides.summary || `A version-pinned public ${kind.replace(/_/g, ' ')} record.`,
  reference: overrides.reference || { accession: `PUBLIC:${kind.toUpperCase()}`, version: '7' },
  annotation: overrides.annotation,
  conditions: overrides.conditions || { biologicalSystem: 'public catalog adjudication' },
  transformations: overrides.transformations || [{
    id: 'public-record-normalization',
    version: '1.0.0',
    description: 'Normalize the version-pinned public record into the Reploid evidence contract.'
  }],
  uncertainty: { method: 'source-reported', description: 'No stronger uncertainty claim is made.' },
  finding: overrides.finding,
  provenance: overrides.provenance || {
    retrievalMethod: 'version-pinned public API',
    retrievedAt: '2026-08-15T00:00:00.000Z',
    sourceIdentity: `public-source:${kind}`,
    license: 'CC BY 4.0'
  },
  createdAt: overrides.createdAt || '2026-08-15T00:00:00.000Z'
});

const findingFor = (kind) => ({
  assay: { classification: 'ambiguous', attempt: { status: 'completed', failureCategory: 'none' } },
  negative_result: { classification: 'negative', attempt: { status: 'completed', failureCategory: 'none' } },
  failed_attempt: { classification: 'not_observed', attempt: { status: 'failed', failureCategory: 'protocol_failure' } }
}[kind] || {});

describe('qualified public protein evidence', () => {
  it('admits every campaign evidence kind with pinned source, conditions, transformation, license, and retrieval provenance', async () => {
    const submission = await question('public-evidence-contract-room', 'public-evidence-contract');
    const researcher = await identity('researcher', 'public-evidence-author');
    const kinds = [
      'sequence',
      'structure',
      'domain',
      'annotation',
      'publication',
      'assay',
      'negative_result',
      'failed_attempt'
    ];

    for (const kind of kinds) {
      const annotation = ['domain', 'annotation'].includes(kind) ? {
        scope: kind === 'domain' ? 'domain' : 'family',
        ontology: { namespace: 'PUBLIC', termId: `TERM:${kind}`, version: '7' },
        sequence: { hash: submission.sequence.hash, length: submission.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_one_based_closed', sourceStart: 2, sourceEnd: 12 }
      } : null;
      const record = await createSignedPublicProteinEvidence(publicEvidenceArgs(submission, kind, {
        identity: researcher,
        annotation,
        finding: findingFor(kind),
        createdAt: `2026-08-15T00:00:${String(kinds.indexOf(kind)).padStart(2, '0')}.000Z`
      }));

      expect(record).toMatchObject({
        kind: 'research_prior_evidence',
        evidence: {
          schema: PUBLIC_PROTEIN_EVIDENCE_VERSION,
          access: 'public',
          kind,
          reference: { version: '7' },
          conditions: { biologicalSystem: 'public catalog adjudication' },
          transformations: [{ id: 'public-record-normalization', version: '1.0.0' }],
          provenance: {
            retrievalMethod: 'version-pinned public API',
            sourceIdentity: `public-source:${kind}`,
            license: 'CC BY 4.0'
          }
        }
      });
      expect(await verifyResearchRecord(record)).toMatchObject({ ok: true });
      expect(validateResearchRecordLinks(record, [submission])).toMatchObject({ ok: true });
    }
  });

  it('fails closed when the public evidence contract omits required scientific provenance or misstates a finding', async () => {
    const submission = await question('public-evidence-invalid-room', 'public-evidence-invalid');
    const researcher = await identity('researcher', 'public-evidence-invalid-author');
    const valid = publicEvidenceArgs(submission, 'assay', {
      identity: researcher,
      finding: findingFor('assay')
    });

    await expect(createSignedPublicProteinEvidence({ ...valid, conditions: {} }))
      .rejects.toThrow('explicit condition declaration');
    await expect(createSignedPublicProteinEvidence({ ...valid, transformations: [] }))
      .rejects.toThrow('at least one versioned transformation');
    await expect(createSignedPublicProteinEvidence({
      ...valid,
      provenance: { ...valid.provenance, license: '' }
    })).rejects.toThrow('license is required');
    await expect(createSignedPublicProteinEvidence({
      ...valid,
      provenance: { ...valid.provenance, sourceIdentity: '' }
    })).rejects.toThrow('source identity is required');
    await expect(createSignedPublicProteinEvidence({
      ...valid,
      evidenceKind: 'negative_result',
      finding: findingFor('assay')
    })).rejects.toThrow('completed negative finding');
    await expect(createSignedPublicProteinEvidence({
      ...valid,
      evidenceKind: 'failed_attempt',
      finding: { classification: 'not_observed', attempt: { status: 'failed', failureCategory: 'none' } }
    })).rejects.toThrow('named failure category');
    await expect(createSignedPriorEvidence({ ...valid, evidenceKind: 'failed_attempt' }))
      .rejects.toThrow('public protein evidence contract');
  });

  it('retrieves accepted negative, ambiguous, and failed evidence and keeps each record in action basis', async () => {
    const current = await question('public-evidence-current-room', 'public-evidence-current');
    const origin = await question('public-evidence-origin-room', 'public-evidence-origin');
    const researcher = await identity('researcher', 'public-evidence-origin-author');
    const reviewer = await identity('reviewer', 'public-evidence-origin-reviewer');
    const definitions = [
      ['negative_result', findingFor('negative_result')],
      ['assay', findingFor('assay')],
      ['failed_attempt', findingFor('failed_attempt')]
    ];
    const records = [current, origin];
    const evidenceRecords = [];
    for (const [kind, finding] of definitions) {
      const evidence = await createSignedPublicProteinEvidence(publicEvidenceArgs(origin, kind, {
        identity: researcher,
        finding,
        reference: { accession: `PUBLIC:NON-SUPPORTING:${kind}`, version: '2' },
        createdAt: `2026-08-15T00:01:0${definitions.findIndex(([entry]) => entry === kind)}.000Z`
      }));
      const acceptance = await createSignedHumanClaim({
        identity: reviewer,
        roomId: origin.roomId,
        targetHash: evidence.recordHash,
        claimKind: 'review_decision',
        relation: 'reviews',
        text: 'Accept this non-supporting public evidence without turning it into a positive conclusion.',
        confidence: 0.9,
        decision: 'accepted'
      });
      evidenceRecords.push(evidence);
      records.push(evidence, acceptance);
    }

    const projection = projectCrossRoomSequenceEvidence(records, current.sequence.hash, {
      currentRoomId: current.roomId
    });
    expect(projection.candidates).toEqual(expect.arrayContaining(evidenceRecords.map((record) => expect.objectContaining({
      recordHash: record.recordHash,
      qualification: { status: 'source_metadata_complete', reasons: [] }
    }))));
    expect(searchEvidence(records, 'failed attempt')).toContain(evidenceRecords[2]);

    const task = proposeDiscoveryTasks(records)
      .find((candidate) => candidate.kind === 'add_competing_hypothesis' && candidate.targetHash === origin.recordHash);
    expect(task).toMatchObject({ basis: 'accepted_memory' });
    expect(task.basisHashes).toEqual(expect.arrayContaining(evidenceRecords.map((record) => record.recordHash)));
  });
});

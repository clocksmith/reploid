
import { PUBLIC_PROTEIN_EVIDENCE_VERSION, createCrossRoomReuseContext, createSignedPriorEvidence, createSignedPublicProteinEvidence } from '../../pool/evidence-network.js';

export async function createCurrentRoomPriorEvidence({
  identity,
  roomId,
  question,
  originQuestion,
  candidate,
  sourceRecord,
  createdAt = new Date().toISOString()
} = {}) {
  if (question?.kind !== 'research_submission' || question.roomId !== roomId) {
    throw new Error('The active current-room question is unavailable');
  }
  if (candidate?.originRoomId === roomId || candidate?.recordHash !== sourceRecord?.recordHash) {
    throw new Error('The prior-room candidate identity is inconsistent');
  }
  if (originQuestion?.kind !== 'research_submission'
    || originQuestion.recordHash !== sourceRecord?.questionHash
    || originQuestion.roomId !== candidate.originRoomId) {
    throw new Error('The signed origin-room question is unavailable or inconsistent');
  }
  if (candidate?.qualification?.status !== 'source_metadata_complete') {
    throw new Error('The prior-room source requires qualification before attachment');
  }
  if (sourceRecord?.kind !== 'research_prior_evidence') {
    throw new Error('Only a versioned prior-evidence record can be attached automatically');
  }
  const license = String(sourceRecord.evidence?.provenance?.license || '').trim();
  if (!license) throw new Error('The prior-room source has no declared reuse license');
  const annotation = sourceRecord.evidence?.annotation || null;
  if (['annotation', 'domain'].includes(sourceRecord.evidence?.kind)) {
    if (!annotation) throw new Error('The prior-room annotation has no normalized identity');
    if (annotation.sequence?.hash !== question.sequence?.hash
      || annotation.sequence?.length !== question.sequence?.length) {
      throw new Error('The prior-room annotation is not bound to the active exact sequence');
    }
  }
  const reuseContext = await createCrossRoomReuseContext({
    originRecord: sourceRecord,
    originQuestion,
    currentQuestion: question
  });
  const createAttachedEvidence = sourceRecord.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    ? createSignedPublicProteinEvidence
    : createSignedPriorEvidence;
  return createAttachedEvidence({
    identity,
    roomId,
    questionHash: question.recordHash,
    evidenceKind: sourceRecord.evidence?.kind,
    summary: `Prior-room evidence from ${candidate.originRoomId}: ${sourceRecord.evidence?.summary || candidate.recordHash}`,
    reference: {
      accession: `reploid:${candidate.originRoomId}:${sourceRecord.evidence?.reference?.accession || 'evidence'}`,
      contentHash: candidate.recordHash
    },
    annotation,
    reuseContext,
    conditions: sourceRecord.evidence?.conditions || {},
    transformations: [
      ...(sourceRecord.evidence?.transformations || []),
      {
        id: 'reploid.cross-room-evidence-reference',
        version: '1',
        description: 'References the exact signed origin-room record without inheriting its decision status.'
      }
    ],
    uncertainty: sourceRecord.evidence?.uncertainty || {},
    finding: sourceRecord.evidence?.finding || {},
    provenance: {
      retrievalMethod: 'Reploid exact-sequence prior-room lookup',
      retrievedAt: createdAt,
      sourceIdentity: `${candidate.originRoomId}:${candidate.recordHash}`,
      license
    },
    createdAt
  });
}

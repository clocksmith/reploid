/** Exact signed resident admission; complete-job receipt rules remain unchanged. */
import { hashDopplerEvidence, validateExecutablePack } from '../pool/executable-pack.js';
import { resolveDopplerExecutionContract } from '../config/doppler-execution-contracts.js';

export async function assertWorkResidentCapsule(model, session) {
  const binding = model.executablePack, validation = validateExecutablePack(binding);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  const contract = resolveDopplerExecutionContract(binding.schema);
  if (contract.openMethod !== 'openCapsule' || binding.requiredOperation !== 'residentPartition'
    || session?.schema !== contract.sessionSchema || !session.loaded || !session.residentPartition) {
    throw new Error('Exact public Capsule resident session required');
  }
  if (await hashDopplerEvidence(binding.artifacts) !== binding.artifactClosureDigest
    || contract.identityFields.some(field => binding[field] !== session[contract.sessionIdentity]?.[field])) {
    throw new Error('Resident Capsule identity differs from the approved binding');
  }
  if (!binding.acceptedTargetPlanDigests.includes(session.selectedTargetPlanDigest)) {
    throw new Error('Resident Capsule selected an unaccepted TargetPlan');
  }
  const verification = session.verification, capsule = verification?.capsule;
  if (capsule?.schema !== binding.schema || capsule.modelId !== model.id
    || session.manifestHash !== model.identity || verification.lifecycle?.authorization?.mode === 'retained-local') {
    throw new Error('Resident Capsule model or delegation authorization differs');
  }
  const pieces = verification.pieceVerification;
  const index = binding.artifacts.find(row => row.artifactId === capsule.program.pieceIndexArtifactId);
  if (verification.artifactVerificationScope !== 'resident-pieces' || pieces?.mode !== 'signed-piece-index'
    || index?.role !== 'piece-index' || pieces.indexArtifactId !== index.artifactId
    || pieces.indexIdentity !== index.hash || pieces.manifestIdentity !== model.identity) {
    throw new Error('Resident Capsule requires exact signed piece verification');
  }
  const full = binding.artifacts.filter(row => row.role !== 'weight-shard')
    .map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes }));
  if (await hashDopplerEvidence(full) !== await hashDopplerEvidence(verification.artifactReceipts)
    || await hashDopplerEvidence(pieces.declaredWeightArtifactIds)
      !== await hashDopplerEvidence(capsule.program.weightArtifactIds)) {
    throw new Error('Resident Capsule verification does not cover its declared closure');
  }
}

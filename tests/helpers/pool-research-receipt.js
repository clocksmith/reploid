import {
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  signProviderReceipt
} from '../../self/pool/inference-receipt.js';

export async function createVerifiedResearchAgreement({
  model,
  sequenceHash,
  agreementValue,
  agreementField = 'vectorHash',
  providerIds = ['provider-one', 'provider-two'],
  jobId = 'research-evidence-job'
} = {}) {
  const receiptEvidence = [];
  for (const [index, providerId] of providerIds.entries()) {
    const keyPair = await createSigningKeyPair();
    const receipt = await signProviderReceipt({
      model,
      providerId,
      assignmentId: `${jobId}-assignment-${index + 1}`,
      jobId,
      inputHash: sequenceHash,
      outputKind: model.workload,
      [agreementField]: agreementValue
    }, keyPair.privateKey);
    receiptEvidence.push({
      receiptHash: await hashJson(receipt),
      providerId,
      providerPublicKey: await exportPublicKey(keyPair.publicKey),
      receipt
    });
  }
  return {
    receiptRecord: {
      ...receiptEvidence[0],
      verifierDecision: { accepted: true }
    },
    receiptEvidence,
    agreement: {
      status: 'accepted',
      jobId,
      agreementField,
      agreementValue,
      receiptHashes: receiptEvidence.map((entry) => entry.receiptHash),
      providerIds: receiptEvidence.map((entry) => entry.providerId)
    }
  };
}

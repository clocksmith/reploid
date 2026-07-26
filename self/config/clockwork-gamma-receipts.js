/**
 * Trusted Gamma promotion receipts.
 *
 * Updating this registry changes the promotion authority boundary. The file is
 * therefore a validator-quarantine target and cannot be self-promoted by Zero.
 */

export const CLOCKWORK_CONTRACT_SET_DIGEST =
  'sha256:d97c9fc90434bfddb1168d1013ae071af1b995abbdcefa3b4113af811b152384';

export const TRUSTED_GAMMA_RECEIPTS = Object.freeze([
  Object.freeze({
    receiptDigest: 'sha256:f4b080e007981199d5eade503ef60b07a17b340d7898a27a50841008ed41ebe3',
    challengeDigest: 'sha256:6b0f29571d204710d97f18a9cfaee2f79e66e419632fd37c15ca39e9307ad4a2',
    candidateDigest: 'sha256:7714969866c6e97c8570412f03d9e727f1f2e39ce64b0f426b95f9b56c48a7c9',
    sourceRevision: 'sha256:3bd747afeab2183f18ab2765e155196dc194f70392bd6e401903168beb20129a',
    gammaRepository: 'clocksmith/gamma',
    gammaCommit: '365a9150794f554fa27da989d361332c8e215d4f'
  })
]);

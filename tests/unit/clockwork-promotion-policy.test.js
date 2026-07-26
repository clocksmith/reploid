import { describe, expect, it } from 'vitest';

import {
  CLOCKWORK_CONTRACT_SET_DIGEST,
  TRUSTED_GAMMA_RECEIPTS
} from '../../self/config/clockwork-gamma-receipts.js';
import {
  sha256,
  validateClockworkPromotionEvidence
} from '../../self/core/promotion-policy.js';

const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
};

const makeGammaReceipt = async () => {
  const trusted = TRUSTED_GAMMA_RECEIPTS[0];
  const base = {
    schema: 'gamma.candidate_receipt.v1',
    authority: 'gamma',
    contractSetDigest: CLOCKWORK_CONTRACT_SET_DIGEST,
    challengeDigest: trusted.challengeDigest,
    candidateDigest: trusted.candidateDigest,
    proofReceiptDigest: null,
    searchReceiptDigest: `sha256:${'a'.repeat(64)}`,
    gammaMaterialization: {
      id: 'clockwork-test',
      digest: `sha256:${'b'.repeat(64)}`
    },
    gates: Object.fromEntries([
      'roundtrip',
      'chronologicalReplay',
      'sourceAccounting',
      'transfer',
      'runtime',
      'memory'
    ].map((name) => [name, {
      status: 'passed',
      evidenceDigest: `sha256:${'c'.repeat(64)}`
    }])),
    ledgers: { bytes: {}, package: {}, runtime: {}, memory: {} },
    result: 'accepted',
    firstFailedGate: null,
    sourceRevision: trusted.sourceRevision,
    environment: { implementation: 'test' },
    createdAt: '2026-07-26T00:00:00Z'
  };
  return {
    ...base,
    receiptDigest: `sha256:${await sha256(canonicalJson(base))}`
  };
};

describe('Clockwork promotion authority', () => {
  it('does not change ordinary Zero promotion evidence', async () => {
    await expect(validateClockworkPromotionEvidence({
      replayPassed: true
    })).resolves.toEqual({
      required: false,
      ok: true,
      reasons: []
    });
  });

  it('rejects Doppler or advisory M3T4 evidence without Gamma authority', async () => {
    const result = await validateClockworkPromotionEvidence({
      authorityClaim: 'clockwork',
      clockwork: {
        challengeDigest: TRUSTED_GAMMA_RECEIPTS[0].challengeDigest,
        candidateDigest: TRUSTED_GAMMA_RECEIPTS[0].candidateDigest,
        dopplerReceipt: { schema: 'doppler.generation-result/v1' },
        searchReceipt: {
          schema: 'clockwork.search_receipt.v1',
          authority: 'advisory'
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('Clockwork promotion requires a full Gamma candidate receipt');
  });

  it('accepts a canonical Gamma receipt only when the trusted registry matches', async () => {
    const gammaReceipt = await makeGammaReceipt();
    const trustedReceipts = [{
      ...TRUSTED_GAMMA_RECEIPTS[0],
      receiptDigest: gammaReceipt.receiptDigest
    }];
    const result = await validateClockworkPromotionEvidence({
      authorityClaim: 'clockwork',
      clockwork: {
        challengeDigest: gammaReceipt.challengeDigest,
        candidateDigest: gammaReceipt.candidateDigest,
        gammaReceipt
      }
    }, { trustedReceipts });
    expect(result).toMatchObject({
      required: true,
      ok: true,
      receiptDigest: gammaReceipt.receiptDigest,
      reasons: []
    });
  });

  it('fails closed when a passed Gamma receipt is altered after hashing', async () => {
    const gammaReceipt = await makeGammaReceipt();
    const trustedReceipts = [{
      ...TRUSTED_GAMMA_RECEIPTS[0],
      receiptDigest: gammaReceipt.receiptDigest
    }];
    gammaReceipt.gates.transfer.status = 'failed';
    const result = await validateClockworkPromotionEvidence({
      authorityClaim: 'clockwork',
      clockwork: {
        challengeDigest: gammaReceipt.challengeDigest,
        candidateDigest: gammaReceipt.candidateDigest,
        gammaReceipt
      }
    }, { trustedReceipts });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('Clockwork Gamma receipt gate transfer did not pass');
    expect(result.reasons).toContain('Clockwork Gamma receipt self-digest mismatch');
  });
});

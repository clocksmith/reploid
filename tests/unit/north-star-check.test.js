/** The north-star receipt checker on a synthetic receipt: it passes the shape a real run produces and fails real mismatches. */
import { describe, it, expect } from 'vitest';
import { checkNorthStar, summarizeVisibility } from '../../scripts/stage1/north-star-check.js';
import { createHash } from 'node:crypto';
import { canonicalPartitionJson } from '../../packages/reploid/src/contracts/partition.js';

const witnessDigest = value => createHash('sha256').update(canonicalPartitionJson(value)).digest('hex');

const ids = ['peer:000000000000000000000000', 'peer:111111111111111111111111', 'peer:222222222222222222222222', 'peer:333333333333333333333333'];
const weights = [1, 31, 31, 1];
const reference = { outputIds: [5, 6, 7], outputText: 'abc' };
reference.sampleDigest = witnessDigest(reference.outputIds);
const settledTrace = (charge, outputTokens, journal) => ({ reservationId: 'r', state: 'settled', charge, outputTokens, heldAfter: 0,
  credits: journal.filter(row => row.delta > 0).map(row => ({ computerId: row.accountId, amount: row.delta })), journal,
  replay: { attempted: true, balancesUnchanged: true, outcomeUnchanged: true } });
const operatorRows = { tokenizeCalls: 0, steps: 3, tokenContext: ['withheld'], tokenIdsReceived: 5, nonzeroTokenIdsReceived: 0,
  activationBytesIn: 10, activationBytesOut: 10, tokensOut: 0, deltaCharactersOut: 0 };

function passing() {
  // 88 output tokens at weights 1/31/31/1: shares 1, 42, 42 and the remainder 3; the requester's own stages are unbilled.
  const stages = ids.map((participantId, index) => ({ label: ['edge-in', 'host-b', 'host-c', 'edge-out'][index], participantId,
    role: index === 0 || index === 3 ? 'requester' : 'operator' }));
  return {
    participants: { stages },
    earn: { accountId: 'computer-requester', buyerAccountId: 'computer-buyer', accountBefore: 0,
      settlements: [settledTrace(99, 99, [{ accountId: 'computer-buyer', delta: -99 }, { accountId: 'computer-requester', delta: 99 }])] },
    split: { cap: 128, text: 'abc', parityExact: true, tokens: { outputIds: [5, 6, 7] }, account: { accountId: 'computer-requester', before: 99, after: 15 },
      settlement: settledTrace(84, 88, [{ accountId: 'computer-requester', delta: -84 }, { accountId: 'computer-host-b', delta: 42 }, { accountId: 'computer-host-c', delta: 42 }]),
      settlementReplay: { problems: [], ledgerPolicyDigest: 'p', termsPolicyDigest: 'p', result: { reservations: [{ reservationId: 'r', status: 'settled', debit: 84,
        credits: [{ participantId: ids[0], amount: 0 }, { participantId: ids[1], amount: 42 }, { participantId: ids[2], amount: 42 }, { participantId: ids[3], amount: 0 }] }] } },
      inference: { result: { executionReceipt: { evidence: { confidentiality: { mode: 'requester-edges' } } } } } },
    privacy: { contentRecipients: [ids[0], ids[3]], bindingHops: ids.map((recipient, index) => ({ recipient, disclosure: index === 0 || index === 3 ? 'plaintext' : 'activations' })),
      stages: stages.map(stage => ({ ...stage, visibility: stage.role === 'operator' ? { ...operatorRows } : { ...operatorRows, tokenContext: ['sent'], nonzeroTokenIdsReceived: 5 } })) },
    cleanup: { processesExited: true, heldCredits: 0, openReservations: 0 }
  };
}
const codes = receipt => checkNorthStar(receipt, { reference, weights }).problems.map(row => row.code);

describe('north-star receipt check', () => {
  it('passes a run whose ledger omits own-account stages and whose replay lists them at zero', () => {
    expect(codes(passing())).toEqual([]);
  });
  it('fails a wrong payout amount, on the ledger or in the replay', () => {
    const ledger = passing();
    ledger.split.settlement.credits[0].amount = 43;
    expect(codes(ledger)).toContain('settlement-shares');
    const replay = passing();
    replay.split.settlementReplay.result.reservations[0].credits[2].amount = 41;
    expect(codes(replay)).toContain('replay-differs-from-ledger');
  });
  it('fails a paid stage that is missing from the ledger, and a replay that pays an own-account stage', () => {
    const missing = passing();
    missing.split.settlement.credits = missing.split.settlement.credits.filter(row => row.computerId !== 'computer-host-c');
    expect(codes(missing)).toEqual(expect.arrayContaining(['settlement-shares', 'replay-differs-from-ledger']));
    const ownPaid = passing();
    ownPaid.split.settlementReplay.result.reservations[0].credits[0].amount = 1;
    expect(codes(ownPaid)).toContain('replay-differs-from-ledger');
  });
  it('fails a charge that is not the ledger rule, a different answer token, and an operator that saw token IDs', () => {
    const charge = passing();
    charge.split.settlement.charge = 88;
    expect(codes(charge)).toContain('settlement-charge');
    const token = passing();
    token.split.tokens.outputIds = [5, 6, 8];
    expect(codes(token)).toContain('answer-tokens-differ');
    const seen = passing();
    seen.privacy.stages[1].visibility.nonzeroTokenIdsReceived = 2;
    expect(codes(seen)).toContain('operator-saw-content');
  });
  it('summarizes a stage that only ever received withheld token context', () => {
    expect(summarizeVisibility([{ op: 'step', tokenContext: 'withheld', tokenIds: { count: 2, nonzero: 0 }, activationInBytes: 8, activationOutBytes: 8, output: 'activation', deltaCharacters: 0 }]))
      .toMatchObject({ steps: 1, tokenContext: ['withheld'], nonzeroTokenIdsReceived: 0, tokensOut: 0 });
  });
});

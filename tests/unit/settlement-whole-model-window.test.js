// @vitest-environment node
// Whole-model terms (`mode: "whole-model"`) and the instant their hold is released (docs/settlement-replay.md,
// "Release window"). The ledger releases a silent whole-model hold at deadline + releaseWindowMs, with no clock
// allowance after it (server/fleet/credit-recovery.js). A close or a fault on such terms therefore counts only when it
// is signed before that instant: one signed in the clock allowance after it could reach a ledger that had already
// released the hold, and would turn the replay's `expired` (what the ledger posted) into `settled`, or charge what the
// ledger never charged. Both verifiers are run over the same records. Test keys and simulated parties: no physical trade.
import { describe, expect, it } from 'vitest';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { replaySettlement as secondReplay } from '../../scripts/settlement/independent/replay.js';
import { SETTLEMENT_TERMS_SCHEMA, WHOLE_MODEL_TERMS_MODE, acceptSettlementTerms, signSettlementTermsFor, signStageFault } from '../../server/fleet/settlement-terms.js';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner, extendOutputChain, outputChainGenesis } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { POLICY, T0, createParties } from '../../scripts/settlement/scenario.js';

const WINDOW = 20000, SKEW = POLICY.maxClockSkewMs;
const WHOLE = Object.freeze({ ...POLICY, version: 'settlement-whole-model-window', wholeModelUnclaimedReleaseMs: WINDOW });
const iso = ms => new Date(ms).toISOString();
const sign = (identity, body) => createAttemptEvidenceSigner({ identity, now: () => Date.parse(body.signedAt) }).sign(body.schema, body);

/**
 * One whole-model attempt as the route signs it (docs/settlement-replay.md, "Whole-model operations"): whole-model
 * terms, the provider's acceptance, the charge binding, one closing receipt with `done` signed `closeAt` ms after the
 * release instant (deadline + window) and, when `acknowledged`, the requester's acknowledgment of the whole output,
 * signed at the deadline. `faultAt` likewise signs the provider's fault. No step receipts: a whole-model provider
 * signs only its close.
 */
async function wholeModel({ closeAt = null, faultAt = null, acknowledged = false }) {
  const { requester, stages: [provider] } = await createParties(1);
  const notBefore = T0, deadline = T0 + 30000, releasedAt = deadline + WINDOW, outputs = 3;
  const reservationId = `reservation-${provider.peerId}`, attemptId = `request-${provider.peerId}`, routeHash = `sha256:${'c'.repeat(64)}`;
  const at = ms => createAttemptEvidenceSigner({ identity: requester, now: () => ms });
  const terms = await signSettlementTermsFor({ signer: at(notBefore), reservationId, attemptId, routeHash, requesterId: requester.peerId,
    participants: [provider.peerId], weights: [1], policy: WHOLE, maxOutputTokens: 16, notBefore, deadline, mode: WHOLE_MODEL_TERMS_MODE });
  const acceptance = await acceptSettlementTerms({ signer: createAttemptEvidenceSigner({ identity: provider, now: () => notBefore }), terms, partitionIndex: 0 });
  const genesis = await outputChainGenesis({ reservationId, routeHash });
  let chain = genesis;
  for (let step = 0; step < outputs; step++) chain = await extendOutputChain(chain, { step, delta: step === outputs - 1 ? 'digest' : '' });
  const ack = (count, value, ms) => at(ms).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId, attemptId, routeHash,
    requesterId: requester.peerId, count, chain: value, signedAt: iso(ms) });
  const out = [terms, acceptance, await ack(0, genesis, notBefore)];
  if (acknowledged) out.push(await ack(outputs, chain, deadline));
  if (closeAt !== null) {
    const ms = releasedAt + closeAt;
    out.push(await sign(provider, { schema: STAGE_RECEIPT_SCHEMA, reservationId, attemptId, routeHash, partitionIndex: 0, participantId: provider.peerId,
      sequence: 1, status: 'settled', steps: outputs, tokens: { prompt: 5, processed: 5 + outputs },
      timing: { reservedAt: iso(notBefore), firstStepAt: iso(notBefore + 1), lastStepAt: iso(notBefore + 2), closedAt: iso(ms) },
      output: { count: outputs, chain, done: true, stopReason: 'eos' }, signedAt: iso(ms) }));
  }
  if (faultAt !== null) out.push(await signStageFault({ signer: createAttemptEvidenceSigner({ identity: provider, now: () => releasedAt + faultAt }), terms, partitionIndex: 0 }));
  return { records: out, deadline, releasedAt, outputs };
}

/** The row both verifiers give, which must agree on outcome and amounts. */
async function both(records, at) {
  const [service, second] = await Promise.all([replaySettlement({ records, policies: [WHOLE], at }), secondReplay({ records, policies: [WHOLE], at })]);
  const rows = [service.reservations[0], second.reservations[0]];
  const read = row => ({ status: row.status, debit: row.debit, late: row.late.map(item => item.kind) });
  expect(read(rows[1])).toEqual(read(rows[0]));
  expect(records.filter(row => row.schema === SETTLEMENT_TERMS_SCHEMA)[0].mode).toBe('whole-model');
  return { ...rows[0], late: rows[0].late.map(item => item.kind) };
}

describe('whole-model terms: a close or a fault counts only when signed before the ledger releases the hold', () => {
  it('a close signed one millisecond before the release still counts: settled at zero, as the ledger may have been handed it in time', async () => {
    const t = await wholeModel({ closeAt: -1 });
    expect(await both(t.records, t.releasedAt)).toMatchObject({ status: 'settled', debit: 0, late: [] });
  });

  it('a close signed at the release instant, or inside the clock allowance after it, is late: the replay expires the hold as the ledger did', async () => {
    for (const offset of [0, 1, SKEW / 2, SKEW]) {
      const t = await wholeModel({ closeAt: offset });
      for (const after of [0, SKEW, SKEW + 1]) {
        expect(await both(t.records, t.releasedAt + after), `close at release + ${offset}, read at release + ${after}`)
          .toMatchObject({ status: 'expired', debit: 0, late: ['stage-receipt'] });
      }
    }
  });

  it('an acknowledged answer whose close is signed inside the allowance after the release charges nothing: the ledger released the hold uncharged', async () => {
    const t = await wholeModel({ closeAt: SKEW / 2, acknowledged: true });
    const row = await both(t.records, t.releasedAt + SKEW);
    expect(row).toMatchObject({ debit: 0, late: ['stage-receipt'] });
    expect(row.credits.map(credit => credit.amount)).toEqual([0]);
    // The same answer closed in time is charged its acknowledged output.
    const inTime = await wholeModel({ closeAt: -1, acknowledged: true });
    expect(await both(inTime.records, inTime.releasedAt)).toMatchObject({ status: 'settled', debit: inTime.outputs * POLICY.creditsPerOutputToken });
  });

  it('a fault follows the same bound', async () => {
    const inTime = await wholeModel({ faultAt: -1 }), late = await wholeModel({ faultAt: SKEW / 2 });
    expect(await both(inTime.records, inTime.releasedAt)).toMatchObject({ status: 'expired', debit: 0, late: [] });
    expect(await both(late.records, late.releasedAt)).toMatchObject({ status: 'expired', debit: 0, late: ['fault'] });
  });

  it('before the release instant the attempt is open in both', async () => {
    const t = await wholeModel({});
    expect(await both(t.records, t.releasedAt - 1)).toMatchObject({ status: 'open' });
  });
});

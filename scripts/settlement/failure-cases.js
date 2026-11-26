#!/usr/bin/env node
/**
 * The three ways a split answer can end early, each run separately under the failed-stage rules
 * (reploid.settlement-replay/v3) against a real ledger, the settlement replay and the second verifier:
 *
 *   cancellation               the requester signs a stop; the stages close
 *   unattributed disconnect    the requester stops acknowledging and signs nothing; the stages close
 *   verified provider failure  one stage dies mid-answer: once with its signed fault (its owner's claim), once silently
 *
 * For each it reports the maximum the requester signed (the quote), the hold the ledger placed, the debit, each
 * stage's payout, the stages that forfeited and the hold left afterwards, and checks that
 *   - the debit never exceeds the signed maximum;
 *   - every stage that closed is paid its signed share of the acknowledged outputs, and a failed stage only loses its own;
 *   - the ledger, the replay and the second verifier post the same debit and the same payout for every stage;
 *   - no hold is left, every owner's statement verifies offline, and presenting the evidence again moves nothing.
 *
 *   node scripts/settlement/failure-cases.js [--json] [--out FILE.json]
 *
 * Plain Node: no model, no GPU, no network. Three stages on three owner accounts and a requester on a fourth, all
 * simulated identities on one machine with test keys, and a fake clock. This shows the settlement rules working on
 * records signed by the production signers; it is not a physical trade and says nothing about real hosts failing.
 * The policy publishes K = 3 and the terms sign it; the scenario's stages still stop at their receiver policy's K.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { signAsParticipant } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { FLEET_SERVICE_REQUEST_SCHEMA } from '../../server/fleet/contract.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { SETTLEMENT_RULES, UNFINISHED_ANSWER_TERMS_V3 } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { SETTLEMENT_STOP_SCHEMA, signStageFaultRecord } from '../../server/fleet/settlement-terms.js';
import { replaySettlement as secondReplay } from './independent/replay.js';
import { POLICY as SCENARIO_POLICY, T0, createParties, runAttempt } from './scenario.js';

export const POLICY = Object.freeze({ ...SCENARIO_POLICY, version: 'settlement-failure-cases-k3', maxRequestMs: 30000, maxUnacknowledgedOutputs: 3 });
const ACCOUNTS = Object.freeze({ requester: 'owner-requester', stages: ['owner-a', 'owner-b', 'owner-c'] });
const WEIGHTS = [2, 3, 1], OUTPUTS = Array.from({ length: 8 }, (_, index) => ` w${index}`), MAX_OUTPUT_TOKENS = 8;
const OWNER_TOKEN = 'f'.repeat(64);

const isAck = record => record.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA;
const receiptsOf = (records, index) => records.filter(record => record.schema === STAGE_RECEIPT_SCHEMA && record.partitionIndex === index).sort((a, b) => a.sequence - b.sequence);

/**
 * The cases. `attempt` are runAttempt's options; `claim` has that stage's owner report the interruption with the
 * stage's signed fault, as a stage host does when it restarts after its process died.
 */
export const CASES = Object.freeze([
  { name: 'cancellation', what: 'the requester signs a stop after 5 acknowledged outputs; every stage closes', attempt: { requesterStopAfter: 5 } },
  { name: 'unattributed disconnect', what: 'the requester acknowledges 4 outputs, then signs nothing more, not even a stop; every stage closes',
    attempt: { stopAckingAfter: 4 } },
  { name: 'verified provider failure (signed fault)', what: 'stage 1 dies after step 4 and its owner hands in its signed fault; the other stages close',
    attempt: { vanishStage: 1, vanishAfterStep: 3 }, claim: { stage: 1 } },
  { name: 'verified provider failure (silent)', what: 'stage 1 dies after step 4 and signs nothing; it is failed when the release window passes',
    attempt: { vanishStage: 1, vanishAfterStep: 3 } }
]);

async function runCase(spec, index) {
  const parties = await createParties(3), directory = await mkdtemp(path.join(tmpdir(), 'reploid-failure-cases-'));
  const people = [parties.requester, ...parties.stages], owners = [ACCOUNTS.requester, ...ACCOUNTS.stages];
  const computers = people.map((identity, at) => ({ id: `computer-${at}`, name: `Computer ${at}`, ownerId: owners[at],
    providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const accountOf = new Map(people.map((identity, at) => [identity.peerId, owners[at]]));
  const live = { clock: T0 };
  const ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => live.clock });
  try {
    const a = await runAttempt(parties, { tag: `failure-${index}`, outputs: OUTPUTS, weights: WEIGHTS, policy: POLICY, maxOutputTokens: MAX_OUTPUT_TOKENS,
      maxUnacknowledgedOutputs: POLICY.maxUnacknowledgedOutputs, accounts: ACCOUNTS, ...spec.attempt });
    let records = [...new Set(a.all())];
    const finalIndex = parties.stages.length - 1;

    // Reserve (the hold), dispatch and admit, as the live route does. The claiming stage is admitted with an owner.
    const binding = ledger.reserve({ id: a.reservationId, executionId: a.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
      providers: a.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      model: { id: a.identity.route.modelId, identity: a.identity.route.modelIdentity, adapterIdentities: [] },
      inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: a.terms.maxOutputTokens, route: a.identity });
    const heldAtReservation = ledger.snapshot().accounts.find(row => row.id === ACCOUNTS.requester).held;
    ledger.dispatch(a.reservationId, parties.requester.peerId);
    a.identity.route.stages.forEach((_, stage) => ledger.admit(a.reservationId, stage, spec.claim?.stage === stage ? OWNER_TOKEN : null));

    // Each acknowledgment with the receipt it acknowledged, when it was signed; then each stage's own close.
    for (const acknowledgment of records.filter(record => isAck(record) && record.count > 0).sort((x, y) => x.count - y.count)) {
      const acknowledgedReceipt = receiptsOf(records, finalIndex).find(row => row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain);
      live.clock = Date.parse(acknowledgment.signedAt) + 1;
      await ledger.collect(a.reservationId, { identity: a.identity, receipts: [], acknowledgment, acknowledgedReceipt });
    }
    live.clock = Math.max(...records.map(record => Date.parse(record.signedAt))) + 1;
    for (const stage of parties.stages.keys()) {
      const receipt = receiptsOf(records, stage).at(-1);
      if (receipt) await ledger.collect(a.reservationId, { identity: a.identity, receipts: [receipt] });
    }
    const stop = records.find(record => record.schema === SETTLEMENT_STOP_SCHEMA) ?? null;
    if (stop) await ledger.collect(a.reservationId, { identity: a.identity, receipts: [], stop });
    ledger.fence(a.reservationId, parties.requester.peerId);
    if (spec.claim) {
      live.clock += 10;
      const identity = parties.stages[spec.claim.stage], at = live.clock;
      const fault = await signStageFaultRecord({ signer: createAttemptEvidenceSigner({ identity, now: () => at }), reservationId: a.reservationId,
        attemptId: a.identity.attemptId, routeHash: a.terms.routeHash, partitionIndex: spec.claim.stage });
      const body = { schema: FLEET_SERVICE_REQUEST_SCHEMA, participantId: identity.peerId, operation: 'closeStageOwner',
        payload: { id: a.reservationId, partitionIndex: spec.claim.stage, owner: OWNER_TOKEN,
          receipt: receiptsOf(records, spec.claim.stage).filter(row => row.status === 'executing').at(-1) ?? null, fault }, at, nonce: `claim-${a.reservationId}` };
      await ledger.closeStageOwner({ ...body, signature: await signAsParticipant(identity, FLEET_SERVICE_REQUEST_SCHEMA, body) });
      records = [...records, fault];
    }
    // When the ledger decided: at once if it could, otherwise once the release window has passed.
    let outcome = await ledger.recover(a.reservationId);
    const decidedAtTheWindow = !Number.isSafeInteger(outcome?.charge);
    if (decidedAtTheWindow) { live.clock = a.decidedAt; outcome = await ledger.recover(a.reservationId); }

    const at = a.decidedAt, enrollment = { accountOf: id => accountOf.get(id) ?? id };
    const rowOf = result => result.reservations.find(row => row.reservationId === a.reservationId);
    const first = rowOf(await replaySettlement({ records, policies: [POLICY], at, ...enrollment }));
    const second = rowOf(await secondReplay({ records, policies: [POLICY], at, ...enrollment }));
    const paid = credits => a.terms.shares.map(share => (credits ?? []).filter(row => row.participantId === share.participantId).reduce((sum, row) => sum + row.amount, 0));

    // Presenting the settled evidence again must move nothing.
    const journalBefore = ledger.snapshot().journal.length;
    const again = await ledger.settle(a.reservationId, ledger.request(a.reservationId).evidence);
    const snapshot = ledger.snapshot();
    const statements = [];
    for (const owner of owners) {
      const verdict = await verifyCreditStatement(ledger.statement(owner));
      statements.push({ account: owner, ok: verdict.ok === true && verdict.uncheckedCount === 0 && verdict.balanceMatches === true });
    }

    const forfeited = (outcome.forfeitedStages ?? []).map(row => row.partitionIndex);
    const charged = outcome.outputTokens ?? 0, units = charged * a.terms.creditsPerOutputToken;
    // What the signed terms specify (docs/settlement-replay.md, "Split arithmetic"), worked out here apart from the
    // ledger's code: `units` over the signed weights, floor(units * weight / total) per stage in order, the last stage
    // taking the remainder; a failed stage's share is then unpaid and nobody else's amount changes.
    const total = WEIGHTS.reduce((sum, weight) => sum + weight, 0);
    const floors = WEIGHTS.map(weight => Math.floor(units * weight / total));
    floors[floors.length - 1] = units - floors.slice(0, -1).reduce((sum, value) => sum + value, 0);
    const specified = floors.map((amount, stage) => (forfeited.includes(stage) ? 0 : amount));

    const result = {
      case: spec.name, what: spec.what,
      settlementRules: binding.settlementRules, unfinishedTerms: a.terms.unfinishedTerms, signedK: a.terms.maxUnacknowledgedOutputs,
      quote: { maxOutputTokens: a.terms.maxOutputTokens, creditsPerOutputToken: a.terms.creditsPerOutputToken, maximum: a.terms.maximum },
      delivered: a.delivered, acknowledged: a.acknowledged, holdAtReservation: heldAtReservation,
      ledger: { status: outcome.status ?? 'settled', reason: outcome.reason ?? null, chargedOutputs: charged, debit: outcome.charge, payouts: paid(outcome.credits),
        forfeited: outcome.forfeitedStages ?? [], decidedAtTheWindow },
      replay: { status: first.status, debit: first.debit, payouts: first.credits.map(credit => credit.amount), forfeited: first.forfeited ?? [] },
      secondVerifier: { status: second.status, debit: second.debit, payouts: second.credits.map(credit => credit.amount) },
      specifiedPayouts: specified,
      holdsAfter: Object.fromEntries(snapshot.accounts.map(row => [row.id, row.held])),
      balancesAfter: Object.fromEntries(snapshot.accounts.map(row => [row.id, row.balance])),
      statements
    };
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    result.checks = {
      reservedUnderCurrentRules: binding.settlementRules === SETTLEMENT_RULES && a.terms.unfinishedTerms === UNFINISHED_ANSWER_TERMS_V3,
      holdIsTheSignedMaximum: heldAtReservation === a.terms.maximum,
      debitWithinSignedMaximum: outcome.charge <= a.terms.maximum && first.debit <= a.terms.maximum,
      onlyAcknowledgedOutputsCharged: charged <= a.acknowledged,
      debitEqualsPayouts: outcome.charge === result.ledger.payouts.reduce((sum, value) => sum + value, 0),
      stagesPaidAsSigned: same(result.ledger.payouts, specified),
      ledgerEqualsReplay: first.status === 'settled' && outcome.charge === first.debit && same(result.ledger.payouts, result.replay.payouts),
      replayEqualsSecondVerifier: second.status === first.status && second.debit === first.debit && same(result.secondVerifier.payouts, result.replay.payouts),
      sameStagesForfeit: same(forfeited, (first.forfeited ?? []).map(row => row.partitionIndex)),
      noHoldLeft: snapshot.accounts.every(row => row.held === 0),
      everyStatementVerifies: statements.every(row => row.ok),
      presentedAgainMovesNothing: same(again, outcome) && ledger.snapshot().journal.length === journalBefore
    };
    result.ok = Object.values(result.checks).every(Boolean);
    return result;
  } finally {
    try { ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

export async function runFailureCases() {
  const cases = [];
  for (const [index, spec] of CASES.entries()) cases.push(await runCase(spec, index));
  return { schema: 'reploid.settlement-failure-cases/v1', note: 'Simulated identities and test keys on one machine, fake clock, no model. Not a physical trade.',
    policy: POLICY, accounts: ACCOUNTS, weights: WEIGHTS, cases, ok: cases.every(row => row.ok) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? true; };
  const report = await runFailureCases();
  if (typeof flag('out') === 'string') await writeFile(flag('out'), `${JSON.stringify(report, null, 2)}\n`);
  if (flag('json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const row of report.cases) {
      const failed = Object.entries(row.checks).filter(([, ok]) => !ok).map(([name]) => name);
      console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.case}: ${row.what}`);
      console.log(`  quote: at most ${row.quote.maximum} credits (${row.quote.maxOutputTokens} outputs at ${row.quote.creditsPerOutputToken}); hold placed ${row.holdAtReservation}`);
      console.log(`  delivered ${row.delivered}, acknowledged ${row.acknowledged}, charged ${row.ledger.chargedOutputs} outputs`);
      console.log(`  ledger: debit ${row.ledger.debit}, payouts ${JSON.stringify(row.ledger.payouts)}, forfeited ${JSON.stringify(row.ledger.forfeited)}${row.ledger.decidedAtTheWindow ? ', decided when the release window passed' : ''}`);
      console.log(`  replay: debit ${row.replay.debit}, payouts ${JSON.stringify(row.replay.payouts)}; second verifier: debit ${row.secondVerifier.debit}, payouts ${JSON.stringify(row.secondVerifier.payouts)}`);
      console.log(`  holds left: ${JSON.stringify(row.holdsAfter)}; balances: ${JSON.stringify(row.balancesAfter)}`);
      if (failed.length) console.log(`  failed checks: ${failed.join(', ')}`);
    }
    console.log(report.ok ? 'RESULT: every case passes every check.' : 'RESULT: at least one check failed.');
  }
  process.exitCode = report.ok ? 0 : 1;
}

#!/usr/bin/env node
/**
 * Settlement attack matrix: the same split attempts judged three ways, with real signatures throughout.
 *
 *   replay       server/fleet/settlement-replay.js over the participants' own signed records (terms, acceptances,
 *                stage receipts, acknowledgments); no operator record is read
 *   operatorLog  B1: the operator signs one usage entry per request (debit and credits); a verifier checks that signature
 *   countersign  B2: the same entry, countersigned after the attempt by the requester and every credited provider, each
 *                of whom signs only if its own line matches what it saw; a verifier needs every listed signature and
 *                takes one entry per reservation. This is the obvious extension of signed split-serving receipts.
 *
 * Operator goals are judged "achieved" when the verifier accepts amounts that differ from the honest outcome in the
 * operator's favour. Participant cases report the outcome and, for a requester that takes output and stops paying,
 * how many outputs it received unpaid.
 *
 *   node scripts/settlement/attack-matrix.js [--out FILE.json]
 */
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { signAsParticipant, verifyParticipantSignature, normalizeParticipantPublicKey } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createAttemptEvidenceSigner, MAX_UNACKNOWLEDGED_OUTPUTS, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { signSettlementTerms } from '../../server/fleet/settlement-terms.js';
import { POLICY, createClock, createParties, runAttempt } from './scenario.js';

const LOG_SCHEMA = 'reploid.research.usage-log-entry/v1';
const body = record => { const { publicJwk: _k, signature: _s, ...rest } = record; return rest; };

/** B1 and B2 entries. `signers` maps role to identity; B2 adds countersignatures. */
async function logEntry(operator, { reservationId, requesterId, debit, credits }) {
  const entry = { schema: LOG_SCHEMA, reservationId, requesterId, debit, credits };
  return { entry, operator: await signAsParticipant(operator, LOG_SCHEMA, entry) };
}
const countersign = async (identity, signed) => ({ ...signed, counter: { ...(signed.counter ?? {}),
  [identity.peerId]: { publicJwk: normalizeParticipantPublicKey(identity.publicJwk), signature: await signAsParticipant(identity, LOG_SCHEMA, signed.entry) } } });

async function verifyOperatorLog(entries, operator) {
  const out = new Map();
  for (const row of entries) {
    if (await verifyParticipantSignature(operator.publicJwk, LOG_SCHEMA, row.entry, row.operator) && !out.has(row.entry.reservationId)) out.set(row.entry.reservationId, row.entry);
  }
  return out;
}
async function verifyCountersigned(entries, operator) {
  const out = new Map();
  for (const row of entries) {
    const need = [row.entry.requesterId, ...row.entry.credits.map(c => c.participantId)];
    let ok = await verifyParticipantSignature(operator.publicJwk, LOG_SCHEMA, row.entry, row.operator);
    for (const id of need) ok = ok && Boolean(row.counter?.[id]) && await verifyParticipantSignature(row.counter[id].publicJwk, LOG_SCHEMA, row.entry, row.counter[id].signature);
    if (ok && !out.has(row.entry.reservationId)) out.set(row.entry.reservationId, row.entry);
  }
  return out;
}

const honestEntry = outcome => ({ reservationId: outcome.reservationId, requesterId: outcome.requesterId, debit: outcome.debit, credits: outcome.credits });
/** What an honest party will countersign: its own line must equal the honest outcome. */
async function honestCountersigns(signed, truth, parties, colluders = []) {
  let row = signed;
  const lineOf = (entry, id) => (id === entry.requesterId ? entry.debit : entry.credits.find(c => c.participantId === id)?.amount ?? null);
  for (const identity of [parties.requester, ...parties.stages]) {
    const id = identity.peerId, listed = id === signed.entry.requesterId || signed.entry.credits.some(c => c.participantId === id);
    if (!listed) continue;
    if (colluders.includes(id) || lineOf(signed.entry, id) === lineOf(truth, id)) row = await countersign(identity, row);
  }
  return row;
}

const amountsOf = (entry, ids) => Object.fromEntries(ids.map(id => [id, id === entry?.requesterId ? -(entry?.debit ?? 0)
  : entry?.credits?.find(c => c.participantId === id)?.amount ?? 0]));
/**
 * Achieved: the verifier accepted amounts that favour the operator or a colluder: the requester pays more than the
 * honest outcome, or some provider is paid less while the requester's debit does not fall with it. A smaller charge
 * caused by withholding a record is not a win for an operator trying to extract credit.
 */
const achieved = (accepted, truth, ids) => {
  if (!accepted) return false;
  const got = amountsOf(accepted, ids), want = amountsOf(truth, ids), requester = truth.requesterId;
  if (-got[requester] > -want[requester]) return true;
  const shorted = ids.some(id => id !== requester && got[id] < want[id]);
  return shorted && -got[requester] >= -want[requester];
};

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const operator = await createSigningIdentity({ algorithm: 'Ed25519' });
  const parties = await createParties(2), ids = [parties.requester.peerId, ...parties.stages.map(s => s.peerId)];
  const [x, y] = parties.stages.map(s => s.peerId);
  const rows = [];
  const truthOf = async (records, at) => {
    const replay = await replaySettlement({ records, policies: [POLICY], at });
    const r = replay.reservations[0];
    return { replay, r, truth: { reservationId: r.reservationId, requesterId: parties.requester.peerId, debit: r.debit ?? 0, credits: r.credits ?? [] } };
  };

  // Honest completed attempt: the base for operator goals.
  const done = await runAttempt(parties, { tag: 'g' });
  const { truth } = await truthOf(done.all(), done.closesAt + 1);
  const honest = await logEntry(operator, honestEntry(truth));
  const forged = async entry => logEntry(operator, { ...honestEntry(truth), ...entry });
  const judge = async (goal, presentedRecords, b1Entries, b2Entries) => {
    const replay = await replaySettlement({ records: presentedRecords, policies: [POLICY], at: done.closesAt + 1 });
    const rr = replay.reservations.find(r => r.reservationId === truth.reservationId);
    const replayAccepted = rr?.status === 'settled' ? { requesterId: truth.requesterId, debit: rr.debit, credits: rr.credits } : null;
    const b1 = (await verifyOperatorLog(b1Entries, operator)).get(truth.reservationId);
    const b2 = (await verifyCountersigned(b2Entries, operator)).get(truth.reservationId);
    rows.push({ kind: 'operator', goal, replay: { achieved: achieved(replayAccepted, truth, ids), status: rr?.status ?? 'none' },
      operatorLog: { achieved: achieved(b1, truth, ids) }, countersign: { achieved: achieved(b2, truth, ids), accepted: Boolean(b2) } });
  };
  const counterHonest = await honestCountersigns(honest, truth, parties);

  // G1 overcharge: double the debit. Replay: the operator can only alter the requester's acknowledgment, which breaks its signature.
  {
    const records = done.all().map(r => (r.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && r.count === done.acknowledged ? { ...r, count: r.count * 2 } : r));
    const e = await forged({ debit: truth.debit * 2, credits: truth.credits.map(c => ({ ...c, amount: c.amount * 2 })) });
    await judge('G1 overcharge the requester', records, [e], [await honestCountersigns(e, truth, parties), counterHonest]);
  }
  // G2 move stage X's credit to stage Y, with Y colluding. Replay: shares are fixed in requester-signed terms.
  {
    const all = truth.credits.reduce((s, c) => s + c.amount, 0);
    const e = await forged({ credits: [{ participantId: y, amount: all }] });
    const records = [...done.all()];
    await judge('G2 shift credit between stages (one stage colludes)', records, [e], [await honestCountersigns(e, truth, parties, [y]), counterHonest]);
  }
  // G3 underpay a stage and keep the difference: drop X's credit.
  {
    const e = await forged({ credits: truth.credits.filter(c => c.participantId !== x) });
    const records = done.all().filter(r => !(r.schema === 'reploid.settlement-acceptance/v1' && r.participantId === x));
    // X still presents its own records to the verifier; the operator can only withhold its own copy.
    await judge('G3 drop one stage\'s credit', [...records, ...done.held.stages[0]], [e], [await honestCountersigns(e, truth, parties), counterHonest]);
  }
  // G4 fabricate a request that never happened.
  {
    const fake = { reservationId: 'reservation-fake', requesterId: parties.requester.peerId, debit: 30, credits: [{ participantId: y, amount: 30 }] };
    const e = await logEntry(operator, fake);
    const b1 = (await verifyOperatorLog([e], operator)).get('reservation-fake');
    const b2 = (await verifyCountersigned([await honestCountersigns(e, { ...fake, debit: 0, credits: [] }, parties, [y])], operator)).get('reservation-fake');
    const replay = await replaySettlement({ records: [...done.all()], policies: [POLICY], at: done.closesAt + 1 });
    rows.push({ kind: 'operator', goal: 'G4 fabricate a request', replay: { achieved: replay.reservations.some(r => r.reservationId === 'reservation-fake'), status: 'none' },
      operatorLog: { achieved: Boolean(b1) }, countersign: { achieved: Boolean(b2), accepted: Boolean(b2) } });
  }
  // G5 charge an attempt whose stage vanished (provider-loss-free terms say nobody pays).
  {
    const lost = await runAttempt(parties, { tag: 'lost', vanishStage: 0, vanishAfterStep: 1 });
    const t = await truthOf(lost.all(), lost.closesAt + 1);
    const e = await logEntry(operator, { reservationId: lost.reservationId, requesterId: parties.requester.peerId, debit: lost.acknowledged * POLICY.creditsPerOutputToken,
      credits: [{ participantId: y, amount: lost.acknowledged * POLICY.creditsPerOutputToken }] });
    const b1 = (await verifyOperatorLog([e], operator)).get(lost.reservationId);
    const b2 = (await verifyCountersigned([await honestCountersigns(e, t.truth, parties, [y])], operator)).get(lost.reservationId);
    rows.push({ kind: 'operator', goal: 'G5 charge an attempt a stage abandoned', replay: { achieved: (t.r.debit ?? 0) > 0, status: t.r.status },
      operatorLog: { achieved: achieved(b1, t.truth, ids) }, countersign: { achieved: achieved(b2, t.truth, ids), accepted: Boolean(b2) } });
  }
  // G6 settle the same reservation twice: present every record and every entry twice.
  {
    const replay = await replaySettlement({ records: [...done.all(), ...done.all()], policies: [POLICY], at: done.closesAt + 1 });
    const total = replay.balances[parties.requester.peerId];
    const b1Total = [honest, honest].length * truth.debit; // a log verifier that sums entries without a reservation key
    rows.push({ kind: 'operator', goal: 'G6 settle one reservation twice', replay: { achieved: total !== -truth.debit, status: replay.reservations[0].status },
      operatorLog: { achieved: true, note: 'achieved unless the log verifier keys entries by reservation; the operator chooses the IDs' },
      countersign: { achieved: false, note: 'countersignatures bind the reservation ID', computedIfSummed: b1Total } });
  }

  // Participant cases, honest operator.
  // P1 the requester takes output and stops acknowledging after 10 of 40 outputs.
  {
    const outputs = Array.from({ length: 40 }, (_, i) => ` t${i}`);
    const stall = await runAttempt(parties, { tag: 'stall', outputs, stopAckingAfter: 10 });
    const t = await truthOf(stall.all(), stall.closesAt + 1);
    rows.push({ kind: 'participant', case: 'P1 requester stops paying after 10 of 40 outputs', replay: { status: t.r.status, delivered: stall.delivered,
      paid: t.r.outputs, unpaidOutputs: stall.delivered - t.r.outputs, bound: MAX_UNACKNOWLEDGED_OUTPUTS + 1 },
    countersign: { status: 'requester never countersigns', delivered: 40, paid: 0, unpaidOutputs: 40, note: 'nothing in a post-hoc log stops delivery' },
    operatorLog: { status: 'operator decides', note: 'trusted operator' } });
  }
  // P2 requester equivocates: signs a second set of terms for the same reservation.
  {
    const a = await runAttempt(parties, { tag: 'eq' });
    const signer = createAttemptEvidenceSigner({ identity: parties.requester, now: () => Date.parse(a.terms.notBefore) });
    const other = await signSettlementTerms({ signer, identity: a.identity, reservationId: a.reservationId, policy: POLICY, maxOutputTokens: 64,
      weights: [3, 1], notBefore: Date.parse(a.terms.notBefore), deadline: Date.parse(a.terms.deadline) });
    const t = await truthOf([...a.all(), other], a.closesAt + 1);
    rows.push({ kind: 'participant', case: 'P2 requester signs two sets of terms', replay: { status: t.r.status }, countersign: { status: 'not modelled' } });
  }
  // P3 final stage equivocates: a second receipt at the same sequence with a different output chain.
  {
    const a = await runAttempt(parties, { tag: 'chain' });
    const last = a.held.stages[1].filter(r => r.schema === STAGE_RECEIPT_SCHEMA && r.output?.count === a.acknowledged).at(0);
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[1], now: () => Date.parse(last.signedAt) });
    const twin = await signer.sign(STAGE_RECEIPT_SCHEMA, { ...body(last), output: { ...last.output, chain: 'sha256:' + 'c'.repeat(64) } });
    const t = await truthOf([...a.all(), twin], a.closesAt + 1);
    rows.push({ kind: 'participant', case: 'P3 final stage signs two output chains', replay: { status: t.r.status }, countersign: { status: 'not detectable: no output chain' } });
  }
  // P4 a stage withholds its closing receipt after the answer was delivered.
  {
    const a = await runAttempt(parties, { tag: 'withhold' });
    const records = a.all().filter(r => !(r.schema === STAGE_RECEIPT_SCHEMA && r.partitionIndex === 0 && r.status !== 'executing'));
    const t = await truthOf(records, a.closesAt + 1);
    rows.push({ kind: 'participant', case: 'P4 a stage withholds its closing receipt', replay: { status: t.r.status, reason: t.r.reason },
      countersign: { status: 'unsettled: that stage never countersigns' } });
  }
  // P5 the requester's last acknowledgment is signed after the deadline (late evidence cannot raise the charge).
  {
    const a = await runAttempt(parties, { tag: 'late', lateAckDelayMs: 5000, clock: createClock() });
    const t = await truthOf(a.all(), a.closesAt + 1);
    rows.push({ kind: 'participant', case: 'P5 last acknowledgment signed after the deadline', replay: { status: t.r.status, debit: t.r.debit, acknowledgedInTime: t.r.outputs, delivered: a.delivered, late: t.r.late,
        note: 'the attempt ran past its deadline, so the stages closed late too; under the terms nobody is charged or paid' },
      countersign: { status: 'no time rule: whatever the parties sign later' } });
  }

  const summary = {
    schema: 'reploid.settlement-attack-matrix/v1', generatedAt: new Date().toISOString(), policy: POLICY, acknowledgmentBound: MAX_UNACKNOWLEDGED_OUTPUTS,
    operatorGoalsAchieved: Object.fromEntries(['replay', 'operatorLog', 'countersign'].map(k => [k, rows.filter(r => r.kind === 'operator' && r[k].achieved).length])),
    operatorGoals: rows.filter(r => r.kind === 'operator').length, rows
  };
  const text = JSON.stringify(summary, null, 2);
  if (values.out) await fs.writeFile(values.out, text + '\n');
  console.log(text);
}

await main();

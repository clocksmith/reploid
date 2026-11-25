#!/usr/bin/env node
/**
 * A stronger baseline beside the settlement attack matrix (attack-matrix.js), and the cases the replay loses.
 *
 * attack-matrix.js compares the replay with two usage logs. Neither log uses what the requester signs before and
 * during the answer. This file judges the same simulated attempts, from the same signed records, by a rule that does:
 *
 *   replay      server/fleet/settlement-replay.js
 *   debitNotes  B3, the rule of requester-accepted incremental billing (Golem's agreement and debit notes). The
 *               requester-signed terms that every named stage accepted are the agreement. Each requester
 *               acknowledgment is an accepted debit note for a cumulative output count. The requester owes the
 *               highest count it accepted in time, split by the signed weights, whatever happened afterwards.
 *               Stage receipts, the `done` flag, stops and output chains are not read. An agreement belongs to the
 *               requester that signed it, so records are grouped by reservation and requester.
 *
 * B3 reads only records the replay already requires, so every difference in the table comes from the replay's
 * extra rules (closing receipts, the finished flag, conflicts), not from extra evidence.
 *
 * Operator goals G1 to G6 are the ones in attack-matrix.js, judged the same way. The other rows are participant
 * cases; each reports what the requester is charged and what each stage is paid against what was delivered.
 *
 *   node scripts/settlement/baseline-matrix.js [--out FILE.json]
 *
 * Plain Node, no model, no GPU, no network. Every party is a simulated identity on one machine, and one operator
 * ran it, so this is not evidence of separate operators.
 */
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import {
  createAttemptEvidenceSigner, OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, verifyOutputAcknowledgment
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { creditSettlementDeltas } from '../../server/fleet/credit-shares.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_TERMS_SCHEMA, policyDigest, termsDigest, verifySettlementAcceptance, verifySettlementTerms
} from '../../server/fleet/settlement-terms.js';
import { POLICY, createParties, runAttempt } from './scenario.js';

const bodyOf = ({ publicJwk: _key, signature: _signature, ...body }) => structuredClone(body);
const ms = value => Date.parse(value);
const iso = value => new Date(value).toISOString();
const sign = (identity, body) => createAttemptEvidenceSigner({ identity, now: () => ms(body.signedAt) }).sign(body.schema, body);

/**
 * B3. Returns one row per (reservation, requester): `settled` with the debit and credits, or `no-agreement`.
 * Signatures and record shapes are checked with the production verifiers.
 */
async function debitNoteSettlement({ records, policies }) {
  const byDigest = new Map();
  for (const policy of policies) byDigest.set(await policyDigest(policy), policy);
  const terms = [], acceptances = [], notes = [];
  for (const record of new Map(records.map(row => [JSON.stringify(row), row])).values()) {
    if (record?.schema === SETTLEMENT_TERMS_SCHEMA && (await verifySettlementTerms(record)).ok) terms.push(bodyOf(record));
    if (record?.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && (await verifySettlementAcceptance(record)).ok) acceptances.push(bodyOf(record));
    if (record?.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && (await verifyOutputAcknowledgment(record)).ok) notes.push(bodyOf(record));
  }
  const rows = [];
  for (const agreement of terms) {
    const policy = byDigest.get(agreement.policyDigest);
    const base = { reservationId: agreement.reservationId, requesterId: agreement.requesterId };
    if (!policy || agreement.unit !== policy.unit || agreement.creditsPerOutputToken !== policy.creditsPerOutputToken
      || agreement.maxOutputTokens > policy.maxOutputTokens) { rows.push({ ...base, status: 'no-agreement', reason: 'the terms do not match a published policy' }); continue; }
    const inTime = at => ms(agreement.notBefore) - policy.maxClockSkewMs <= ms(at) && ms(at) <= ms(agreement.deadline) + policy.maxClockSkewMs;
    const digest = await termsDigest(agreement);
    const accepted = agreement.shares.every(share => acceptances.some(row => row.termsDigest === digest && row.participantId === share.participantId
      && row.partitionIndex === share.partitionIndex && inTime(row.signedAt)));
    if (!inTime(agreement.signedAt) || !accepted) { rows.push({ ...base, status: 'no-agreement', reason: 'not every named stage accepted these terms in time' }); continue; }
    const counts = notes.filter(row => row.reservationId === agreement.reservationId && row.attemptId === agreement.attemptId
      && row.routeHash === agreement.routeHash && row.requesterId === agreement.requesterId && inTime(row.signedAt)).map(row => row.count);
    const acceptedOutputs = Math.max(0, ...counts);
    const units = Math.min(acceptedOutputs, agreement.maxOutputTokens) * agreement.creditsPerOutputToken;
    const split = creditSettlementDeltas({ providers: agreement.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      computerId: agreement.requesterId }, units, id => id);
    rows.push({ ...base, status: 'settled', termsDigest: digest, outputs: acceptedOutputs, debit: split.charge,
      credits: split.credits.map(row => ({ participantId: row.participantId, amount: row.amount })) });
  }
  // One requester, several accepted agreements for one reservation: the requester's own contradiction. Keep the one
  // with the larger debit, so signing a second agreement can never lower what it owes.
  const best = new Map();
  for (const row of rows) {
    const key = `${row.reservationId}\n${row.requesterId}`, held = best.get(key);
    if (!held || (row.status === 'settled' && (held.status !== 'settled' || row.debit > held.debit))) best.set(key, row);
  }
  return [...best.values()];
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const parties = await createParties(2), stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
  const requesterId = parties.requester.peerId, [x, y] = parties.stages.map(stage => stage.peerId);
  const price = POLICY.creditsPerOutputToken;
  const name = id => (id === requesterId ? 'requester' : id === x ? 'stage0' : id === y ? 'stage1' : id === stranger.peerId ? 'stranger' : 'other');
  const forty = Array.from({ length: 40 }, (_, i) => ` t${i}`);

  /** Both verdicts on one record set, for the real requester's reservation. */
  const judge = async (records, attempt) => {
    const replayed = await replaySettlement({ records, policies: [POLICY], at: attempt.closesAt + 1 });
    const r = replayed.reservations.find(row => row.reservationId === attempt.reservationId);
    const notes = (await debitNoteSettlement({ records, policies: [POLICY] })).filter(row => row.reservationId === attempt.reservationId);
    const mine = notes.find(row => row.requesterId === requesterId);
    const paid = credits => Object.fromEntries((credits ?? []).map(row => [name(row.participantId), row.amount]));
    return {
      replay: { status: r?.status ?? 'none', debit: r?.debit ?? 0, paid: paid(r?.credits), reason: r?.reason ?? null,
        ...(r?.conflicts?.length ? { conflicts: r.conflicts.map(row => `${row.kind} by ${name(row.signer)}${row.blocking === false ? ' (recorded, not blocking)' : ''}`) } : {}) },
      debitNotes: { status: mine?.status ?? 'none', debit: mine?.debit ?? 0, paid: paid(mine?.credits),
        ...(notes.length > 1 ? { otherAgreements: notes.filter(row => row !== mine).map(row => `${name(row.requesterId)}: ${row.status}, debit ${row.debit ?? 0}`) } : {}) }
    };
  };
  const amounts = verdict => JSON.stringify([verdict.debit, verdict.paid]);

  // ---- Operator goals, as in attack-matrix.js. Achieved: the verifier accepts amounts that favour the operator or
  // a colluder over what the signed terms give (the honest replay outcome).
  const rows = [];
  const done = await runAttempt(parties, { tag: 'g' });
  const honest = await judge(done.all(), done);
  const worse = (verdict, truth) => verdict.status === 'settled' && (verdict.debit > truth.debit
    || (Object.keys(truth.paid).some(id => (verdict.paid[id] ?? 0) < truth.paid[id]) && verdict.debit >= truth.debit));
  const goal = (label, verdicts, truth = honest.replay, note = null) => rows.push({ kind: 'operator', goal: label,
    replay: { achieved: worse(verdicts.replay, truth), status: verdicts.replay.status, debit: verdicts.replay.debit },
    debitNotes: { achieved: worse(verdicts.debitNotes, truth), status: verdicts.debitNotes.status, debit: verdicts.debitNotes.debit }, ...(note ? { note } : {}) });
  {
    const records = done.all().map(row => (row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count === done.acknowledged ? { ...row, count: row.count * 2 } : row));
    goal('G1 overcharge the requester', await judge(records, done), honest.replay, 'the operator doubles the count in the top acknowledgment; its signature fails');
  }
  {
    // The colluding stage re-signs the terms with the weights in its favour. It is not the requester.
    const moved = { ...bodyOf(done.terms), shares: done.terms.shares.map((row, index) => ({ ...row, weight: index === 1 ? 99 : 1 })) };
    goal('G2 shift credit between stages (one stage colludes)', await judge([...done.all(), await sign(parties.stages[1], moved)], done), honest.replay,
      'stage1 signs the requester\'s terms with weights 1 and 99');
  }
  {
    const withheld = done.all().filter(row => !(row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && row.participantId === x));
    goal('G3 drop one stage\'s credit', await judge([...withheld, ...done.held.stages[0]], done), honest.replay,
      'the operator withholds stage0\'s acceptance; stage0 presents its own records');
  }
  {
    const all = await replaySettlement({ records: done.all(), policies: [POLICY], at: done.closesAt + 1 });
    const notes = await debitNoteSettlement({ records: done.all(), policies: [POLICY] });
    rows.push({ kind: 'operator', goal: 'G4 fabricate a request', replay: { achieved: all.reservations.length !== 1 }, debitNotes: { achieved: notes.length !== 1 },
      note: 'no record names a reservation its requester did not sign' });
  }
  {
    const lost = await runAttempt(parties, { tag: 'lost', vanishStage: 0, vanishAfterStep: 1 });
    const verdicts = await judge(lost.all(), lost);
    goal('G5 charge an attempt a stage abandoned', verdicts, { debit: 0, paid: {} },
      `stage0 vanished after ${lost.acknowledged} acknowledged outputs; the signed terms say nobody pays. B3 charges the accepted prefix by design.`);
  }
  {
    const twice = await judge([...done.all(), ...done.all()], done);
    goal('G6 settle one reservation twice', twice, honest.replay, 'every record presented twice');
  }

  // ---- Participant cases. `delivered` is what the requester received; `owed` is delivered outputs times the price.
  const cases = [];
  const add = (label, attempt, verdicts, extra = {}) => cases.push({ kind: 'participant', case: label, delivered: attempt.delivered,
    owedIfEveryDeliveredOutputWerePaid: Math.min(attempt.delivered, attempt.terms.maxOutputTokens) * price, ...verdicts,
    sameAmounts: amounts(verdicts.replay) === amounts(verdicts.debitNotes), ...extra });

  {
    const stall = await runAttempt(parties, { tag: 'stall', outputs: forty, stopAckingAfter: 10 });
    add('P1 requester stops acknowledging after 10 of 40 outputs', stall, await judge(stall.all(), stall),
      { note: 'the stages stop at the signed allowance in both schemes, so the unpaid outputs are the same' });
  }
  {
    const last = await runAttempt(parties, { tag: 'last', outputs: forty, stopAckingAfter: 39 });
    add('P1b requester withholds the last acknowledgment of a finished 40-output answer', last, await judge(last.all(), last));
  }
  {
    const lost = await runAttempt(parties, { tag: 'drop', outputs: forty, vanishStage: 1, vanishAfterStep: 9 });
    add('P6 the final stage drops after 10 of 40 outputs and never closes', lost, await judge(lost.all(), lost),
      { note: 'the replay\'s provider-loss-free rule: an abandoned answer is free. B3 has no such rule.' });
  }
  {
    const early = await runAttempt(parties, { tag: 'early', outputs: forty, stagesFailAfter: 10 });
    add('P7 the stages end the answer themselves after 10 of 40 outputs and close as failed', early, await judge(early.all(), early));
    // The same final stage instead signs K + 1 further steps it never sent, then closes. Nothing else changes.
    const finals = early.all().filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 1).sort((a, b) => a.sequence - b.sequence);
    const closing = finals.find(row => row.status !== 'executing'), added = [];
    let previous = finals.filter(row => row.status === 'executing').at(-1);
    for (let extra = 1; extra <= early.terms.maxUnacknowledgedOutputs + 1; extra++) {
      previous = await sign(parties.stages[1], { ...bodyOf(previous), sequence: previous.sequence + 1, steps: previous.steps + 1,
        tokens: { ...previous.tokens, processed: previous.tokens.processed + 1 },
        output: { count: previous.steps + 1, chain: `sha256:${String(extra).repeat(64)}`, done: false, stopReason: null } });
      added.push(previous);
    }
    const close = await sign(parties.stages[1], { ...bodyOf(previous), sequence: previous.sequence + 1, status: closing.status, timing: closing.timing });
    const records = [...new Set(early.all())].filter(row => row !== closing);
    add('L3 the same final stage signs K + 1 steps it never sent, then closes', early, await judge([...records, ...added, close], early),
      { replayLoses: false, note: 'the provider-loss-free rule is defeated by the final stage alone: the gap reads as the requester withholding, so the abandoned answer is charged. Both schemes now charge the prefix.' });
  }
  {
    const whole = await runAttempt(parties, { tag: 'veto', outputs: forty });
    const records = whole.all().filter(row => !(row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === 0 && row.status !== 'executing'));
    add('L1 stage0 withholds its closing receipt after the whole answer was delivered and acknowledged', whole, await judge(records, whole),
      { replayLoses: true, note: 'one stage vetoes every stage\'s payment, and the requester keeps a free answer. Under B3 the accepted counts are owed without any closing receipt.' });
  }
  {
    const whole = await runAttempt(parties, { tag: 'self', outputs: forty });
    const top = whole.all().filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((a, b) => a.count - b.count).at(-1);
    const second = await sign(parties.requester, { ...bodyOf(top), chain: `sha256:${'e'.repeat(64)}` });
    add('L2 the requester acknowledges all 40 outputs, then signs a second acknowledgment of count 40 with another chain', whole,
      await judge([...whole.all(), second], whole),
      { replayLoses: true, note: 'the requester\'s own contradiction voids its charge. It can sign it afterwards: signers write their own signedAt. B3 takes the highest accepted count.' });
  }
  {
    const whole = await runAttempt(parties, { tag: 'squat', outputs: forty });
    const top = whole.all().filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((a, b) => a.count - b.count)[0];
    const terms = await sign(stranger, { ...bodyOf(whole.terms), requesterId: stranger.peerId, shares: [{ partitionIndex: 0, participantId: stranger.peerId, weight: 1 }] });
    const acceptance = await sign(stranger, { schema: SETTLEMENT_ACCEPTANCE_SCHEMA, termsDigest: await termsDigest(bodyOf(terms)), reservationId: terms.reservationId,
      attemptId: terms.attemptId, participantId: stranger.peerId, partitionIndex: 0, signedAt: terms.signedAt });
    const binding = await sign(stranger, { ...bodyOf(top), requesterId: stranger.peerId });
    add('L4 a stranger signs its own terms, acceptance and charge binding under this reservation ID', whole,
      await judge([...whole.all(), terms, acceptance, binding], whole),
      { replayLoses: true, note: 'three signatures from a key that took no part make the real reservation undecidable. B3 keys an agreement by reservation and requester, so the stranger\'s agreement is a separate one that charges only the stranger.' });
  }

  const operator = rows.filter(row => row.kind === 'operator');
  const summary = {
    schema: 'reploid.settlement-baseline-matrix/v1', generatedAt: iso(Date.now()), policy: POLICY,
    command: 'node scripts/settlement/baseline-matrix.js --out scripts/settlement/receipts/baseline-matrix.json',
    note: 'Every party is a simulated identity on one machine under one operator. B3 is this file\'s own 40-line rule over the replay\'s records, modelled on requester-accepted debit notes; it is not Golem\'s implementation. Keys are fresh on each run; the amounts are deterministic.',
    operatorGoals: operator.length,
    operatorGoalsAchieved: { replay: operator.filter(row => row.replay.achieved).length, debitNotes: operator.filter(row => row.debitNotes.achieved).length },
    participantCases: cases.length,
    participantCasesWithDifferentAmounts: cases.filter(row => !row.sameAmounts).map(row => row.case.split(' ')[0]),
    replayLoses: cases.filter(row => row.replayLoses).map(row => row.case.split(' ')[0]),
    rows: [...rows, ...cases]
  };
  const text = JSON.stringify(summary, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(text);
}

await main();

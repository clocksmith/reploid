// @vitest-environment node
// Settlement replay: one encoding per signed fact, one verdict per record set wherever it is checked, and the
// release-window rule that makes an honest late close worth exactly what a backdated one is. Real signatures from the
// production signers; every party is a simulated identity on one machine.
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { fromBase64Url, toBase64Url } from '../../packages/reploid/src/artifacts/binary.js';
import { isLowSP256Signature, participantIdFor, verifyParticipantSignature } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { creditPolicy } from '../../server/fleet/contract.js';
import {
  OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner, isSignedTime, verifyOutputAcknowledgment, verifyStageReceipt
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA, signSettlementStop, verifySettlementAcceptance,
  verifySettlementStop, verifySettlementTerms
} from '../../server/fleet/settlement-terms.js';
import { POLICY, T0, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const replay = (records, at, options = {}) => replaySettlement({ records, policies: [POLICY], at, ...options });
const bodyOf = ({ publicJwk: _k, signature: _s, ...rest }) => structuredClone(rest);
const resign = (identity, record, body) => createAttemptEvidenceSigner({ identity, now: () => 0 }).sign(record.schema, body);
const ofSchema = (records, schema) => [...new Set(records)].filter(row => row.schema === schema);
const VERIFY = {
  [SETTLEMENT_TERMS_SCHEMA]: verifySettlementTerms, [SETTLEMENT_ACCEPTANCE_SCHEMA]: verifySettlementAcceptance,
  [STAGE_RECEIPT_SCHEMA]: record => verifyStageReceipt(record), [OUTPUT_ACKNOWLEDGMENT_SCHEMA]: record => verifyOutputAcknowledgment(record),
  [SETTLEMENT_STOP_SCHEMA]: verifySettlementStop
};
const SIGNER_FIELD = { [SETTLEMENT_TERMS_SCHEMA]: 'requesterId', [SETTLEMENT_ACCEPTANCE_SCHEMA]: 'participantId',
  [STAGE_RECEIPT_SCHEMA]: 'participantId', [OUTPUT_ACKNOWLEDGMENT_SCHEMA]: 'requesterId', [SETTLEMENT_STOP_SCHEMA]: 'requesterId' };

/** One record of every kind, each with the identity that signed it. */
async function everyKind() {
  const parties = await createParties(2);
  const a = await runAttempt(parties, { tag: 'kinds', outputs: Array.from({ length: 8 }, (_, i) => `t${i}`), requesterStopAfter: 4 });
  const all = [...new Set(a.all())];
  const signerOf = record => (record[SIGNER_FIELD[record.schema]] === parties.requester.peerId ? parties.requester
    : parties.stages.find(stage => stage.peerId === record[SIGNER_FIELD[record.schema]]));
  const pick = schema => all.find(row => row.schema === schema && (schema !== STAGE_RECEIPT_SCHEMA || row.timing.lastStepAt));
  return { parties, a, all, records: Object.keys(VERIFY).map(schema => ({ record: pick(schema), identity: signerOf(pick(schema)) })) };
}

/** The same base64url text with its unused trailing bits changed: it decodes to the same bytes. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const alias = text => text.slice(0, -1) + ALPHABET[ALPHABET.indexOf(text.at(-1)) ^ 1];

describe('settlement replay encodings', () => {
  it('reads signed times only in their UTC toISOString form, so the verdict does not depend on the verifier\'s time zone', async () => {
    const { a, all, records, parties } = await everyKind();
    // Every signer already writes that form.
    const times = all.flatMap(row => [row.signedAt, ...(row.schema === SETTLEMENT_TERMS_SCHEMA ? [row.notBefore, row.deadline] : []),
      ...(row.schema === STAGE_RECEIPT_SCHEMA ? Object.values(row.timing).filter(Boolean) : [])]);
    expect(times.length).toBeGreaterThan(all.length);
    expect(times.every(isSignedTime)).toBe(true);
    // Any other form of the same instant is malformed, in every field of every record kind.
    const fields = { [SETTLEMENT_TERMS_SCHEMA]: ['notBefore', 'deadline', 'signedAt'], [STAGE_RECEIPT_SCHEMA]: ['signedAt', 'timing.lastStepAt'] };
    for (const { record, identity } of records) {
      for (const field of fields[record.schema] ?? ['signedAt']) {
        for (const form of [value => value.replace('Z', ''), value => value.replace('Z', '+00:00'), value => value.replace('.', ',').replace(/,\d+/, '')]) {
          const body = bodyOf(record), [head, tail] = field.split('.');
          if (tail) body[head][tail] = form(body[head][tail]); else body[head] = form(body[head]);
          expect(await VERIFY[record.schema](await resign(identity, record, body)), `${record.schema} ${field}`).toMatchObject({ ok: false });
        }
      }
      expect(await VERIFY[record.schema](record)).toMatchObject({ ok: true });
    }
    // The same record set, with the top acknowledgment's time written without a zone, under several zones.
    const complete = await runAttempt(parties, { tag: 'tz' });
    const set = [...new Set(complete.all())];
    const top = ofSchema(set, OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((x, y) => x.count - y.count).at(-1);
    const zoneless = await resign(parties.requester, top, { ...bodyOf(top), signedAt: top.signedAt.replace('Z', '') });
    const presented = [...set.filter(row => row !== top), zoneless];
    const zone = process.env.TZ, verdicts = [], parsed = [];
    try {
      for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        parsed.push(Date.parse(zoneless.signedAt));
        const { reservations, rejected } = await replay(presented, complete.closesAt + 1);
        verdicts.push({ status: reservations[0].status, debit: reservations[0].debit, rejected: rejected.length });
      }
    } finally {
      if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
    }
    // The zones really differ for a zone-less time; the replay does not.
    expect(new Set(parsed).size).toBe(4);
    expect(verdicts).toEqual(Array(4).fill({ status: 'settled', debit: 12, rejected: 1 }));
    expect(a.terms.notBefore.endsWith('Z')).toBe(true);
  });

  it('rejects a padded signature and a non-canonical key coordinate on every record kind', async () => {
    const { records } = await everyKind();
    for (const { record, identity } of records) {
      for (const padding of ['=', '==']) {
        expect(await VERIFY[record.schema]({ ...record, signature: record.signature + padding }), record.schema).toMatchObject({ ok: false });
      }
      // The same key with other unused trailing bits decodes to the same point, and would give another participant ID.
      const aliasKey = { ...record.publicJwk, x: alias(record.publicJwk.x) };
      const aliasId = await participantIdFor(aliasKey);
      expect(aliasId).not.toBe(identity.peerId);
      const aliasIdentity = { ...identity, publicJwk: aliasKey, peerId: aliasId };
      const body = { ...bodyOf(record), [SIGNER_FIELD[record.schema]]: aliasId };
      expect(await VERIFY[record.schema](await resign(aliasIdentity, record, body)), record.schema).toMatchObject({ ok: false });
      // The signature with its own unused bits changed decodes to the same bytes too.
      expect(await VERIFY[record.schema]({ ...record, signature: alias(record.signature) }), record.schema).toMatchObject({ ok: false });
    }
  });

  it('answers invalid, not an error, when no policy is supplied', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties);
    for (const policies of [[], undefined]) {
      const out = await replaySettlement({ records: a.all(), policies, at: a.closesAt + 1 });
      expect(out.reservations[0]).toMatchObject({ status: 'invalid', debit: null });
    }
  });

  it('lists a late stop as late whatever the outcome', async () => {
    const parties = await createParties(2);
    const lost = await runAttempt(parties, { tag: 'late-stop', vanishStage: 0, vanishAfterStep: 1 });
    const late = Date.parse(lost.terms.deadline) + POLICY.maxClockSkewMs + 5000;
    const stop = await signSettlementStop({ signer: createAttemptEvidenceSigner({ identity: parties.requester, now: () => late }),
      terms: lost.terms, acknowledged: lost.acknowledged });
    for (const [at, status] of [[lost.closesAt - 1, 'open'], [lost.closesAt + 1, 'expired']]) {
      const r = (await replay([...lost.all(), stop], at)).reservations[0];
      expect(r.status).toBe(status);
      expect(r.late).toEqual([{ kind: 'stop', acknowledged: lost.acknowledged }]);
    }
  });

  it('opens and then expires a reservation that never started, instead of leaving it undecidable', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { tag: 'never' });
    const termsOnly = [a.terms, ...ofSchema(a.all(), SETTLEMENT_ACCEPTANCE_SCHEMA)];
    for (const records of [[a.terms], termsOnly]) {
      expect((await replay(records, a.closesAt - 1)).reservations[0]).toMatchObject({ status: 'open', debit: null, foreign: [] });
      const r = (await replay(records, a.closesAt + 1)).reservations[0];
      expect(r).toMatchObject({ status: 'expired', debit: 0, foreign: [] });
      expect(r.credits.every(c => c.amount === 0)).toBe(true);
    }
  });

  it('reports two final-stage chains for one count even when no acknowledgment names that count', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { tag: 'unacked-twin', outputs: Array.from({ length: 20 }, (_, i) => `t${i}`), stopAckingAfter: 6 });
    const beyond = ofSchema(a.held.stages[1], STAGE_RECEIPT_SCHEMA).find(row => row.output?.count === 7);
    expect(ofSchema(a.all(), OUTPUT_ACKNOWLEDGMENT_SCHEMA).some(row => row.count === 7)).toBe(false);
    const twin = await resign(parties.stages[1], beyond, { ...bodyOf(beyond), output: { ...beyond.output, chain: 'sha256:' + 'c'.repeat(64) } });
    const r = (await replay([...a.all(), twin], a.closesAt + 1)).reservations[0];
    expect(r.status).toBe('conflict');
    expect(r.conflicts).toContainEqual(expect.objectContaining({ signer: parties.stages[1].peerId, kind: 'output-chain', blocking: true, count: 7 }));
    expect(r.conflicts.every(row => typeof row.kind === 'string' && typeof row.blocking === 'boolean'
      && (typeof row.signer === 'string' || row.signer === null && row.signers.length === 2))).toBe(true);
  });
});

describe('closing after the deadline (L5)', () => {
  /** 40 outputs; the requester's last acknowledgment and every stage's close are signed 5 s after the deadline. */
  const lateRun = async (parties, extra = {}) => runAttempt(parties, { tag: 'late-close', outputs: Array.from({ length: 40 }, (_, i) => ` w${i}`),
    lateAckDelayMs: 5000, ...extra });
  /** Each stage re-signs every receipt it signed after the deadline with the given time. */
  const redate = async (parties, run, at) => {
    const deadline = Date.parse(run.terms.deadline), out = [];
    for (const record of [...new Set(run.all())]) {
      if (record.schema !== STAGE_RECEIPT_SCHEMA || Date.parse(record.signedAt) <= deadline) { out.push(record); continue; }
      const next = bodyOf(record);
      next.signedAt = at;
      for (const key of Object.keys(next.timing)) if (next.timing[key] && Date.parse(next.timing[key]) > deadline) next.timing[key] = at;
      out.push(await resign(parties.stages[record.partitionIndex], record, next));
    }
    return out;
  };

  it('charges an honestly late close what a backdated one gets, and counts nothing signed after the release window', async () => {
    const parties = await createParties(2);
    const run = await lateRun(parties);
    const honest = (await replay(run.all(), run.closesAt + 1)).reservations[0];
    const backdated = (await replay(await redate(parties, run, new Date(Date.parse(run.terms.deadline) - 1000).toISOString()), run.closesAt + 1)).reservations[0];
    expect(honest).toMatchObject({ status: 'settled', debit: 117, outputs: 39 });
    expect(honest.credits.map(c => c.amount)).toEqual([29, 88]);
    expect(backdated).toMatchObject({ status: honest.status, debit: honest.debit, credits: honest.credits });
    // Only the requester's late acknowledgment is listed; the closes inside the window are not late.
    expect(honest.late).toEqual([{ kind: 'acknowledgment', count: 40 }]);
    // The closing window carries the clock allowance at both ends, as the ordinary one does: a close dated up to the
    // window's end plus the allowance counts, and one dated later does not, so the stages never closed and the attempt
    // expires.
    const skewed = (await replay(await redate(parties, run, new Date(run.closesAt + POLICY.maxClockSkewMs).toISOString()), run.closesAt + 2000)).reservations[0];
    expect(skewed).toMatchObject({ status: 'settled', debit: honest.debit });
    const afterWindow = (await replay(await redate(parties, run, new Date(run.closesAt + POLICY.maxClockSkewMs + 1).toISOString()), run.closesAt + 2000)).reservations[0];
    expect(afterWindow).toMatchObject({ status: 'expired', debit: 0 });
    expect(afterWindow.late.filter(row => row.kind === 'stage-receipt')).toHaveLength(2);
  });

  it('settles the same late closes in the live ledger as the replay does, charging only the in-time acknowledgments', async () => {
    // A policy whose request deadline equals the terms' 30 s deadline, so the ledger and the terms agree on it.
    const policy = { ...POLICY, maxRequestMs: 30000 };
    const parties = await createParties(2);
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-settlement-late-close-'));
    const people = [parties.requester, ...parties.stages];
    const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
    const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
    let clock = T0;
    const ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy, now: () => clock });
    try {
      const run = await lateRun(parties, { policy });
      ledger.reserve({ id: run.reservationId, executionId: run.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
        providers: run.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
        model: { id: run.identity.route.modelId, identity: run.identity.route.modelIdentity, adapterIdentities: [] },
        inputDigest: 'sha256:' + 'd'.repeat(64), maxOutputTokens: run.terms.maxOutputTokens, route: run.identity });
      ledger.dispatch(run.reservationId, parties.requester.peerId);
      run.identity.route.stages.forEach((_, index) => ledger.admit(run.reservationId, index));
      const acknowledged = ofSchema(run.held.requester, OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((x, y) => x.count - y.count);
      const pairFor = ack => ({ acknowledgment: ack, acknowledgedReceipt: ofSchema(run.held.requester, STAGE_RECEIPT_SCHEMA)
        .find(row => row.output?.count === ack.count && row.output.chain === ack.chain) });
      // The requester hands over each acknowledgment as it signs it; the 39th is the last one in time.
      clock = Date.parse(run.terms.deadline) - 2000;
      await ledger.collect(run.reservationId, { identity: run.identity, receipts: [], ...pairFor(acknowledged.at(-2)) });
      // After the deadline the stages' late closes arrive with the requester's late 40th acknowledgment.
      clock = Date.parse(run.terms.deadline) + 6000;
      const closing = run.held.stages.map(rows => ofSchema(rows, STAGE_RECEIPT_SCHEMA).sort((x, y) => x.sequence - y.sequence).at(-1));
      const full = { identity: run.identity, receipts: closing, ...pairFor(acknowledged.at(-1)) };
      await expect(ledger.settle(run.reservationId, full)).rejects.toThrow('after the deadline');
      const outcome = await ledger.collect(run.reservationId, full);
      const r = (await replaySettlement({ records: run.all(), policies: [policy], at: run.closesAt + 1, accountOf: id => accountOf.get(id) })).reservations[0];
      expect(r).toMatchObject({ status: 'settled', debit: 117 });
      expect(outcome).toMatchObject({ charge: r.debit, outputTokens: 39 });
      expect(outcome.credits.map(row => [row.participantId, row.amount])).toEqual(r.credits.map(row => [row.participantId, row.amount]));
    } finally {
      ledger.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** `(r, n - s)` for a raw P-256 signature: the second form that verifies over the same bytes. */
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const otherS = signature => {
  const bytes = fromBase64Url(signature), s = bytes.subarray(32).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  let flipped = P256_ORDER - s;
  const out = new Uint8Array(bytes);
  for (let index = 63; index >= 32; index--) { out[index] = Number(flipped & 0xffn); flipped >>= 8n; }
  return toBase64Url(out);
};

describe('settlement replay, round 4', () => {
  it('signs P-256 records in low-S form and rejects the high-S form of every record kind', async () => {
    const [requester, ...stages] = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
    const a = await runAttempt({ requester, stages }, { tag: 'low-s', outputs: Array.from({ length: 8 }, (_, i) => `t${i}`), requesterStopAfter: 4 });
    const all = [...new Set(a.all())];
    // Every signature the signers produced is low-S: WebCrypto alone picks high S about half the time.
    expect(all.length).toBeGreaterThan(20);
    expect(all.every(row => isLowSP256Signature(row.signature))).toBe(true);
    for (const schema of Object.keys(VERIFY)) {
      const record = all.find(row => row.schema === schema);
      const high = { ...record, signature: otherS(record.signature) };
      // The high-S form is a valid ECDSA signature over the same bytes, so only the low-S rule refuses it.
      expect(await verifyParticipantSignature(record.publicJwk, schema, bodyOf(record), high.signature)).toBe(true);
      expect(await VERIFY[schema](high), schema).toMatchObject({ ok: false, problem: 'encoding_not_canonical' });
      expect(await VERIFY[schema](record), schema).toMatchObject({ ok: true });
    }
    const r = (await replay(all.map(row => (row.schema === STAGE_RECEIPT_SCHEMA ? { ...row, signature: otherS(row.signature) } : row)), a.closesAt + 1));
    expect(r.rejected.length).toBe(all.filter(row => row.schema === STAGE_RECEIPT_SCHEMA).length);
  });

  it('requires the split release window to be longer than the clock allowance, in the ledger policy and the replay', async () => {
    const parties = await createParties(2);
    const tight = { ...POLICY, version: 'tight', partitionUnclaimedReleaseMs: POLICY.maxClockSkewMs };
    expect(() => creditPolicy(tight)).toThrow('longer than the clock skew allowance');
    expect(() => creditPolicy({ ...tight, partitionUnclaimedReleaseMs: POLICY.maxClockSkewMs + 1 })).not.toThrow();
    const a = await runAttempt(parties, { tag: 'tight', policy: tight });
    expect((await replaySettlement({ records: a.all(), policies: [tight], at: a.closesAt + 1 })).reservations[0])
      .toMatchObject({ status: 'invalid', debit: null });
  });

  it('never charges a late acknowledgment but still uses it as evidence of a contradiction', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { tag: 'late-evidence' });
    const acks = ofSchema(a.all(), OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((x, y) => x.count - y.count), top = acks.at(-1);
    const late = new Date(Date.parse(a.terms.deadline) + POLICY.maxClockSkewMs + 5000).toISOString(), fake = 'sha256:' + 'e'.repeat(64);
    // A late acknowledgment of the final count with another chain than the final stage's: the requester and the stage
    // signed incompatible statements, so the attempt is a conflict, as an in-time one would make it.
    const lateFake = await resign(parties.requester, top, { ...bodyOf(top), chain: fake, signedAt: late });
    const disputed = (await replay([...a.all().filter(row => row !== top), lateFake], a.closesAt + 1)).reservations[0];
    expect(disputed.status).toBe('conflict');
    expect(disputed.late).toContainEqual({ kind: 'acknowledgment', count: top.count });
    expect(disputed.conflicts).toContainEqual(expect.objectContaining({ kind: 'output-chain', signer: null, count: top.count, blocking: true }));
    // The requester's in-time wrong chain, then its late right one: the right one shows the requester contradicted
    // itself, which does not block, and the late count is still not charged.
    const timelyFake = await resign(parties.requester, top, { ...bodyOf(top), chain: fake });
    const lateRight = await resign(parties.requester, top, { ...bodyOf(top), signedAt: late });
    const resolved = (await replay([...a.all().filter(row => row !== top), timelyFake, lateRight], a.closesAt + 1)).reservations[0];
    expect(resolved).toMatchObject({ status: 'settled', outputs: top.count - 1, debit: (top.count - 1) * POLICY.creditsPerOutputToken });
    expect(resolved.conflicts).toContainEqual({ signer: parties.requester.peerId, kind: 'acknowledgment-equivocation', count: top.count,
      blocking: false, chains: [fake] });
  });

  it('gives every row the same members, whatever its outcome', async () => {
    const parties = await createParties(2);
    const members = ['reservationId', 'attemptId', 'requesterId', 'status', 'reason', 'debit', 'credits', 'outputs', 'chargedOutputs',
      'unacknowledgedOutputs', 'beyondCeiling', 'closedAtLastStep', 'conflicts', 'late', 'foreign', 'unmatched'].sort();
    const settled = await runAttempt(parties, { tag: 'shape-settled' });
    const lost = await runAttempt(parties, { tag: 'shape-lost', vanishStage: 0, vanishAfterStep: 1 });
    const rows = [...(await replay([...settled.all(), ...lost.all()], settled.closesAt + 1)).reservations,
      ...(await replay([settled.terms], settled.closesAt - 1)).reservations, ...(await replaySettlement({ records: settled.all(), at: 0 })).reservations];
    expect(rows.map(row => row.status).sort()).toEqual(['expired', 'invalid', 'open', 'settled']);
    for (const row of rows) expect(Object.keys(row).sort(), row.status).toEqual(members);
  });
});

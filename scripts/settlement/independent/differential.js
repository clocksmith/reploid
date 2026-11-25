/**
 * Differential run of two settlement verifiers over the same record sets: the service's
 * (server/fleet/settlement-replay.js) and the independent one beside this file (replay.js).
 *
 * Base attempts are built with the production signing code through scripts/settlement/scenario.js. Each mutation
 * removes, repeats, reorders, edits or adds records, re-signing with real keys where the mutation needs a valid
 * signature. Both verifiers judge every set at one or more clock values; the outcome, the requester's debit and each
 * stage's credit are compared, and the late and rejected lists are compared by size.
 *
 *   node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json
 *
 * Plain Node, no model, no GPU, no network. All parties are simulated identities on one machine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaySettlement as independentReplay, SCHEMAS, DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS } from './replay.js';
import { replaySettlement as serviceReplay } from '../../../server/fleet/settlement-replay.js';
import { termsDigest } from '../../../server/fleet/settlement-terms.js';
import { createAttemptEvidenceSigner } from '../../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createSigningIdentity } from '../../../packages/reploid/src/artifacts/identity.js';
import { POLICY, createParties, runAttempt } from '../scenario.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? true; };

// ---------------------------------------------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------------------------------------------

const unique = records => [...new Map(records.map(record => [JSON.stringify(record), record])).values()];
const bodyOf = ({ publicJwk: _key, signature: _signature, ...body }) => structuredClone(body);
const iso = ms => new Date(ms).toISOString();
const sign = (identity, body, at = Date.parse(body.signedAt)) => createAttemptEvidenceSigner({ identity, now: () => at }).sign(body.schema, body);
const FAKE_CHAIN = `sha256:${'e'.repeat(64)}`, OTHER_DIGEST = `sha256:${'d'.repeat(64)}`;
const short = schema => schema.replace('reploid.', '').replace('/v1', '');
const describe = record => {
  const label = short(record.schema);
  if (record.schema === SCHEMAS.receipt) return `${label}[stage${record.partitionIndex} #${record.sequence} ${record.status}]`;
  if (record.schema === SCHEMAS.acknowledgment) return `${label}[count ${record.count}]`;
  if (record.schema === SCHEMAS.acceptance) return `${label}[stage${record.partitionIndex}]`;
  return label;
};
const without = (records, ...removed) => records.filter(record => !removed.includes(record));
function shuffled(records, seed) {
  const out = [...records];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What one base attempt offers a mutation: its records by kind and the keys that can sign new ones. */
function contextOf(attempt, parties, stranger) {
  const records = unique(attempt.all());
  const of = schema => records.filter(record => record.schema === schema);
  const terms = of(SCHEMAS.terms)[0];
  const stageCount = terms.shares.length;
  const receipts = index => of(SCHEMAS.receipt).filter(record => record.partitionIndex === index).sort((a, b) => a.sequence - b.sequence);
  const acks = of(SCHEMAS.acknowledgment).sort((a, b) => a.count - b.count);
  const lastSignedAt = Math.max(...records.map(record => Date.parse(record.signedAt)));
  return { attempt, parties, stranger, records, terms, stageCount, finalIndex: stageCount - 1, receipts, acks, of,
    acceptances: of(SCHEMAS.acceptance), stops: of(SCHEMAS.stop), topAck: acks.at(-1), deadline: attempt.deadline,
    closesAt: attempt.closesAt, lastSignedAt, stageIdentity: index => parties.stages[index], requester: parties.requester };
}

/** New terms from the requester, with the stages' acceptances of exactly those terms. */
async function reterm(ctx, changes, { signedAt = null, acceptedAt = null } = {}) {
  const body = { ...bodyOf(ctx.terms), ...changes };
  if (signedAt !== null) body.signedAt = iso(signedAt);
  const terms = await sign(ctx.requester, body);
  const digest = await termsDigest(bodyOf(terms));
  const acceptances = await Promise.all(ctx.acceptances.map(acceptance => {
    const next = { ...bodyOf(acceptance), termsDigest: digest };
    if (acceptedAt !== null) next.signedAt = iso(acceptedAt);
    return sign(ctx.stageIdentity(acceptance.partitionIndex), next);
  }));
  return { terms, acceptances };
}
const withTerms = async (ctx, changes, options) => {
  const { terms, acceptances } = await reterm(ctx, changes, options);
  return [...without(ctx.records, ctx.terms, ...ctx.acceptances), terms, ...acceptances];
};

// ---------------------------------------------------------------------------------------------------------------
// Mutations. Each returns [{ name, records, policies?, clocks? }].
// ---------------------------------------------------------------------------------------------------------------

const MUTATIONS = {
  async 'remove each record'(ctx) {
    return ctx.records.map(record => ({ name: `remove ${describe(record)}`, records: without(ctx.records, record) }));
  },
  async duplicate(ctx) {
    return [
      { name: 'every record twice', records: [...ctx.records, ...ctx.records] },
      { name: 'records as each party holds them (natural duplicates)', records: ctx.attempt.all() },
      { name: 'closing receipts three times', records: [...ctx.records, ...ctx.records.filter(r => r.schema === SCHEMAS.receipt && r.status !== 'executing'),
        ...ctx.records.filter(r => r.schema === SCHEMAS.receipt && r.status !== 'executing')] }
    ];
  },
  async reorder(ctx) {
    return [{ name: 'reversed', records: [...ctx.records].reverse() }, { name: 'shuffled (seed 7)', records: shuffled(ctx.records, 7) },
      { name: 'shuffled (seed 26)', records: shuffled(ctx.records, 26) }];
  },
  async 'edit a signed field'(ctx) {
    const edits = [
      [ctx.terms, record => { record.shares[0].weight += 1; }, 'terms weight'],
      [ctx.terms, record => { record.deadline = iso(Date.parse(record.deadline) + 60000); }, 'terms deadline'],
      [ctx.acceptances[0], record => { record.signedAt = iso(Date.parse(record.signedAt) + 1); }, 'acceptance time'],
      [ctx.receipts(ctx.finalIndex).at(-1), record => { record.tokens.processed += 1; }, 'final receipt tokens'],
      [ctx.receipts(0).at(-1), record => { record.status = record.status === 'failed' ? 'settled' : 'failed'; }, 'stage0 receipt status'],
      [ctx.topAck, record => { record.signedAt = iso(Date.parse(record.signedAt) - 1); }, 'top acknowledgment time'],
      [ctx.stops[0], record => { record.acknowledged += 1; }, 'stop count']
    ];
    return edits.filter(([record]) => record).map(([record, edit, label]) => {
      const edited = structuredClone(record);
      edit(edited);
      return { name: `edit ${label} without re-signing`, records: [...without(ctx.records, record), edited] };
    });
  },
  async 're-sign with the wrong key'(ctx) {
    const targets = [[ctx.terms, 'terms'], [ctx.acceptances[0], 'acceptance'], [ctx.receipts(ctx.finalIndex).at(-1), 'final receipt'],
      [ctx.topAck, 'top acknowledgment'], [ctx.stops[0], 'stop']].filter(([record]) => record);
    const out = [];
    for (const [record, label] of targets) {
      out.push({ name: `${label} re-signed by a stranger, signer field unchanged`, records: [...without(ctx.records, record), await sign(ctx.stranger, bodyOf(record))] });
    }
    return out;
  },
  async 'valid records from a non-party'(ctx) {
    const id = ctx.stranger.peerId, out = [];
    const foreignTerms = await sign(ctx.stranger, { ...bodyOf(ctx.terms), requesterId: id });
    out.push({ name: 'a stranger signs terms for the same reservation', records: [...ctx.records, foreignTerms] });
    const receipt = ctx.receipts(0).at(-1);
    if (receipt) out.push({ name: 'a stranger signs a stage0 receipt', records: [...ctx.records, await sign(ctx.stranger, { ...bodyOf(receipt), participantId: id })] });
    out.push({ name: 'a stranger signs a higher acknowledgment', records: [...ctx.records,
      await sign(ctx.stranger, { ...bodyOf(ctx.topAck), requesterId: id, count: ctx.topAck.count + 2, chain: FAKE_CHAIN })] });
    out.push({ name: 'a stranger signs a stop', records: [...ctx.records, await sign(ctx.stranger, { schema: SCHEMAS.stop, reservationId: ctx.terms.reservationId,
      attemptId: ctx.terms.attemptId, requesterId: id, acknowledged: 0, signedAt: iso(ctx.lastSignedAt) })] });
    out.push({ name: 'a stranger signs an acceptance for stage0', records: [...ctx.records,
      await sign(ctx.stranger, { ...bodyOf(ctx.acceptances[0]), participantId: id })] });
    return out;
  },
  async 'two sets of terms'(ctx) {
    const weights = ctx.terms.shares.map((row, index) => ({ ...row, weight: row.weight + (index === 0 ? 5 : 0) }));
    const second = await reterm(ctx, { shares: weights });
    const otherAttempt = await reterm(ctx, { attemptId: `${ctx.terms.attemptId}-again` });
    return [
      { name: 'requester signs second terms with other weights (no acceptances)', records: [...ctx.records, second.terms] },
      { name: 'requester signs second terms with other weights, stages accept both', records: [...ctx.records, second.terms, ...second.acceptances] },
      { name: 'requester signs second terms for another attempt of the reservation', records: [...ctx.records, otherAttempt.terms] },
      { name: 'same terms body signed again one millisecond later', records: [...ctx.records,
        await sign(ctx.requester, { ...bodyOf(ctx.terms), signedAt: iso(Date.parse(ctx.terms.signedAt) + 1) })] }
    ];
  },
  async 'acceptance problems'(ctx) {
    const first = ctx.acceptances[0], out = [];
    out.push({ name: 'stage0 also accepts other terms', records: [...ctx.records, await sign(ctx.stageIdentity(0), { ...bodyOf(first), termsDigest: OTHER_DIGEST })] });
    out.push({ name: 'stage0 accepts only other terms', records: [...without(ctx.records, first), await sign(ctx.stageIdentity(0), { ...bodyOf(first), termsDigest: OTHER_DIGEST })] });
    if (ctx.stageCount > 1) out.push({ name: 'stage0 accepts at stage1 index instead of its own', records: [...without(ctx.records, first),
      await sign(ctx.stageIdentity(0), { ...bodyOf(first), partitionIndex: 1 })] });
    return out;
  },
  async 'two output chains for one count'(ctx) {
    const finals = ctx.receipts(ctx.finalIndex).filter(record => record.output && record.output.count > 0), out = [];
    const last = finals.at(-1), identity = ctx.stageIdentity(ctx.finalIndex);
    if (last) {
      out.push({ name: 'final stage signs a second chain at the same sequence', records: [...ctx.records,
        await sign(identity, { ...bodyOf(last), output: { ...last.output, chain: FAKE_CHAIN } })] });
      out.push({ name: 'final stage signs a second chain at a new sequence', records: [...ctx.records,
        await sign(identity, { ...bodyOf(last), sequence: last.sequence + 1, status: 'executing', output: { ...last.output, chain: FAKE_CHAIN } })] });
    }
    if (ctx.topAck.count > 0) out.push({ name: 'requester acknowledges a second chain for its top count', records: [...ctx.records,
      await sign(ctx.requester, { ...bodyOf(ctx.topAck), chain: FAKE_CHAIN })] });
    out.push({ name: 'requester signs a second charge binding with another chain', records: [...ctx.records,
      await sign(ctx.requester, { ...bodyOf(ctx.acks[0]), chain: FAKE_CHAIN })] });
    if (ctx.topAck.count > 0) out.push({ name: 'top acknowledgment replaced by one whose chain is not the stage chain',
      records: [...without(ctx.records, ctx.topAck), await sign(ctx.requester, { ...bodyOf(ctx.topAck), chain: FAKE_CHAIN })] });
    return out;
  },
  async 'receipt sequence goes backwards'(ctx) {
    const out = [];
    for (const index of [0, ctx.finalIndex]) {
      const last = ctx.receipts(index).at(-1);
      if (!last || last.steps < 1) continue;
      const body = bodyOf(last);
      Object.assign(body, { sequence: last.sequence + 1, status: 'executing', steps: last.steps - 1, tokens: { ...last.tokens, processed: last.tokens.processed - 1 },
        timing: { ...last.timing, closedAt: null } });
      if (body.output) body.output = { ...body.output, count: body.steps, done: false, stopReason: null, chain: FAKE_CHAIN };
      out.push({ name: `stage${index} signs a later receipt with fewer steps`, records: [...ctx.records, await sign(ctx.stageIdentity(index), body)] });
    }
    const closing = ctx.receipts(0).find(record => record.status !== 'executing');
    if (closing) out.push({ name: 'stage0 signs a second, different closing receipt', records: [...ctx.records,
      await sign(ctx.stageIdentity(0), { ...bodyOf(closing), sequence: closing.sequence + 1, status: closing.status === 'failed' ? 'settled' : 'failed' })] });
    return out;
  },
  async 'records signed after the deadline'(ctx) {
    const out = [], clocks = ['in-window', 'after'];
    for (const [label, delay] of [['5 s late', 5000], ['0.5 s late', 500], ['exactly at the deadline', 0]]) {
      const at = ctx.deadline + delay;
      const closings = ctx.of(SCHEMAS.receipt).filter(record => record.status !== 'executing');
      if (closings.length) {
        const late = await Promise.all(closings.map(record => sign(ctx.stageIdentity(record.partitionIndex),
          { ...bodyOf(record), timing: { ...record.timing, closedAt: iso(at) }, signedAt: iso(at) })));
        out.push({ name: `every closing receipt signed ${label}`, records: [...without(ctx.records, ...closings), ...late], clocks });
      }
      if (ctx.topAck.count > 0) out.push({ name: `top acknowledgment signed ${label}`, clocks,
        records: [...without(ctx.records, ctx.topAck), await sign(ctx.requester, { ...bodyOf(ctx.topAck), signedAt: iso(at) })] });
    }
    if (ctx.topAck.count > 0) out.push({ name: 'top acknowledgment signed 5 s before the terms start', clocks,
      records: [...without(ctx.records, ctx.topAck), await sign(ctx.requester, { ...bodyOf(ctx.topAck), signedAt: iso(Date.parse(ctx.terms.notBefore) - 5000) })] });
    const late = ctx.deadline + 5000;
    out.push({ name: 'extra acknowledgment of one more output, signed 5 s late', clocks, records: [...ctx.records,
      await sign(ctx.requester, { ...bodyOf(ctx.topAck), count: ctx.topAck.count + 1, chain: FAKE_CHAIN, signedAt: iso(late) })] });
    const stop = { schema: SCHEMAS.stop, reservationId: ctx.terms.reservationId, attemptId: ctx.terms.attemptId, requesterId: ctx.terms.requesterId,
      acknowledged: ctx.topAck.count, signedAt: iso(late) };
    out.push({ name: 'stop signed 5 s late (replacing any stop)', clocks, records: [...without(ctx.records, ...ctx.stops), await sign(ctx.requester, stop)] });
    out.push({ name: 'stage0 acceptance signed 5 s late', clocks, records: [...without(ctx.records, ctx.acceptances[0]),
      await sign(ctx.stageIdentity(0), { ...bodyOf(ctx.acceptances[0]), signedAt: iso(late) })] });
    out.push({ name: 'terms and acceptances signed 5 s late', clocks, records: await withTerms(ctx, {}, { signedAt: late, acceptedAt: late }) });
    return out;
  },
  async 'acknowledgments beyond what was agreed or delivered'(ctx) {
    const ack = (count, chain = FAKE_CHAIN) => sign(ctx.requester, { ...bodyOf(ctx.topAck), count, chain, signedAt: iso(ctx.lastSignedAt) });
    const delivered = Math.max(0, ...ctx.receipts(ctx.finalIndex).map(record => record.output?.count ?? 0));
    return [
      { name: 'acknowledgment above the signed output ceiling', records: [...ctx.records, await ack(ctx.terms.maxOutputTokens + 1)] },
      { name: 'acknowledgment one above what the final stage delivered', records: [...ctx.records, await ack(delivered + 1)] },
      { name: 'acknowledgment for another attempt of the reservation', records: [...ctx.records,
        await sign(ctx.requester, { ...bodyOf(ctx.topAck), attemptId: `${ctx.terms.attemptId}-again`, count: ctx.topAck.count + 3, chain: FAKE_CHAIN })] }
    ];
  },
  async 'terms that do not match the policy'(ctx) {
    const price = ctx.terms.creditsPerOutputToken + 1;
    const otherPolicy = { ...POLICY, version: 'not-published' };
    const { policyDigest } = await import('../../../server/fleet/settlement-terms.js');
    return [
      { name: 'unit differs from the policy', records: await withTerms(ctx, { unit: 'another-unit' }) },
      { name: 'price differs from the policy', records: await withTerms(ctx, { creditsPerOutputToken: price, maximum: ctx.terms.maxOutputTokens * price }) },
      { name: 'release window differs from the policy', records: await withTerms(ctx, { releaseWindowMs: ctx.terms.releaseWindowMs * 2 }), clocks: ['in-window', 'after', 'long-after'] },
      { name: 'output ceiling above the policy ceiling', records: await withTerms(ctx, { maxOutputTokens: POLICY.maxOutputTokens + 1,
        maximum: (POLICY.maxOutputTokens + 1) * ctx.terms.creditsPerOutputToken }) },
      { name: 'deadline further out than the policy request limit', records: await withTerms(ctx, { deadline: iso(Date.parse(ctx.terms.notBefore) + POLICY.maxRequestMs + 1000) }),
        clocks: ['after', 'long-after'] },
      { name: 'terms name a policy that was not published', records: await withTerms(ctx, { policyDigest: await policyDigest(otherPolicy) }) },
      { name: 'no policy supplied to the verifier', records: ctx.records, policies: [] },
      { name: 'only another policy supplied to the verifier', records: ctx.records, policies: [otherPolicy] },
      { name: 'unrecognized unfinished-answer terms', records: await withTerms(ctx, { unfinishedTerms: 'reploid.unfinished-answer/something-else/v1' }) },
      { name: 'legacy terms without unfinished-answer terms', records: await withTerms(ctx, { unfinishedTerms: null }) }
    ];
  },
  async 'withheld records'(ctx) {
    const out = [], clocks = ['in-window', 'after'];
    for (let index = 0; index < ctx.stageCount; index++) {
      const all = ctx.receipts(index), closing = all.filter(record => record.status !== 'executing');
      if (closing.length) out.push({ name: `stage${index} withholds its closing receipt`, records: without(ctx.records, ...closing), clocks });
      if (all.length) out.push({ name: `stage${index} withholds every receipt`, records: without(ctx.records, ...all), clocks });
      if (all.length > 1) out.push({ name: `stage${index} shows only its latest receipt`, records: without(ctx.records, ...all.slice(0, -1)), clocks });
    }
    const paid = ctx.acks.filter(record => record.count > 0);
    if (paid.length) out.push({ name: 'requester withholds every acknowledgment but the charge binding', records: without(ctx.records, ...paid), clocks });
    out.push({ name: 'requester withholds every acknowledgment', records: without(ctx.records, ...ctx.acks), clocks });
    if (paid.length > 1) out.push({ name: 'requester shows only its top acknowledgment', records: without(ctx.records, ...ctx.acks.slice(0, -1)), clocks });
    out.push({ name: 'only the terms', records: [ctx.terms], clocks });
    out.push({ name: 'everything but the terms and acceptances', records: without(ctx.records, ctx.terms, ...ctx.acceptances), clocks });
    return out;
  },
  async 'stop statements'(ctx) {
    const stop = (acknowledged, at = ctx.lastSignedAt) => sign(ctx.requester, { schema: SCHEMAS.stop, reservationId: ctx.terms.reservationId,
      attemptId: ctx.terms.attemptId, requesterId: ctx.terms.requesterId, acknowledged, signedAt: iso(at) });
    const top = ctx.topAck.count, base = without(ctx.records, ...ctx.stops), out = [];
    out.push({ name: 'stop naming the top acknowledged count', records: [...base, await stop(top)] });
    out.push({ name: 'two stops naming different counts', records: [...base, await stop(top), await stop(top + 1)] });
    out.push({ name: 'stop naming two more than was acknowledged', records: [...base, await stop(top + 2)] });
    if (top > 0) out.push({ name: 'stop naming one fewer than was acknowledged', records: [...base, await stop(top - 1)] });
    return out;
  },
  async 'final stage invents outputs nobody received'(ctx) {
    const all = ctx.receipts(ctx.finalIndex), closing = all.find(record => record.status !== 'executing');
    const last = all.filter(record => record.status === 'executing').at(-1);
    if (!closing || !last || last.output?.done) return [];
    const identity = ctx.stageIdentity(ctx.finalIndex), added = [];
    let previous = last;
    for (let extra = 1; extra <= DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS + 1; extra++) {
      const body = bodyOf(previous);
      Object.assign(body, { sequence: previous.sequence + 1, steps: previous.steps + 1, tokens: { ...previous.tokens, processed: previous.tokens.processed + 1 },
        output: { count: previous.steps + 1, chain: `sha256:${String(extra).repeat(64)}`, done: false, stopReason: null } });
      previous = await sign(identity, body);
      added.push(previous);
    }
    const close = await sign(identity, { ...bodyOf(previous), sequence: previous.sequence + 1, status: closing.status, timing: closing.timing });
    return [{ name: 'final stage signs three more steps after the last acknowledged output, then closes', records: [...without(ctx.records, closing), ...added, close] }];
  },
  async 'unsigned additions'(ctx) {
    const targets = [[ctx.terms, 'terms'], [ctx.acceptances[0], 'acceptance'], [ctx.receipts(ctx.finalIndex).at(-1), 'final receipt'],
      [ctx.topAck, 'top acknowledgment'], [ctx.stops[0], 'stop']].filter(([record]) => record);
    const out = targets.map(([record, label]) => ({ name: `${label} key carries an extra member`,
      records: [...without(ctx.records, record), { ...record, publicJwk: { ...record.publicJwk, alg: 'EdDSA' } }] }));
    out.push({ name: 'terms record carries an extra unsigned field', records: [...without(ctx.records, ctx.terms), { ...ctx.terms, note: 'unsigned' }] });
    out.push({ name: 'a record of an unknown schema is present', records: [...ctx.records, { schema: 'reploid.something-else/v1', reservationId: ctx.terms.reservationId }] });
    out.push({ name: 'non-record values are present', records: [...ctx.records, null, 'text', 7, []] });
    return out;
  }
};

// ---------------------------------------------------------------------------------------------------------------
// Base attempts
// ---------------------------------------------------------------------------------------------------------------

const FORTY = Array.from({ length: 40 }, (_, i) => ` w${i}`);
const BASES = [
  { name: 'complete answer', options: {}, full: true },
  { name: 'requester stops after 3 outputs', options: { requesterStopAfter: 3 }, full: true },
  { name: 'stage0 drops after 3 steps', options: { vanishStage: 0, vanishAfterStep: 2 }, full: true },
  { name: 'stages close early on their own', options: { stagesFailAfter: 3 }, full: true },
  { name: 'requester stops acknowledging', options: { outputs: Array.from({ length: 8 }, (_, i) => ` w${i}`), stopAckingAfter: 2 }, full: true },
  { name: 'final stage drops after 3 steps', options: { vanishStage: 1, vanishAfterStep: 2 } },
  { name: 'answer delivered but stage0 never closes', options: { vanishStage: 0, vanishAfterStep: 4 } },
  { name: 'final acknowledgment and closes 1 s after the deadline', options: { lateAckDelayMs: 1000 } },
  { name: 'final acknowledgment and closes 5 s after the deadline', options: { lateAckDelayMs: 5000 } },
  { name: 'legacy terms, stages close early', options: { stagesFailAfter: 3, unfinishedTerms: null } },
  { name: 'output ceiling 3 with 5 outputs', options: { maxOutputTokens: 3 } },
  { name: 'three stages with equal weights', options: { weights: [1, 1, 1] }, stages: 3 },
  { name: 'requester computes stage0 itself', options: {}, own: true },
  { name: 'requester stops before any output', options: { requesterStopAfter: 0 } },
  // A finished answer whose last acknowledgments never arrive. No mutation: scenario.js produces these directly.
  { name: 'finished 40-output answer, last acknowledgment withheld', options: { outputs: FORTY, stopAckingAfter: 39 }, sweepOnly: true },
  { name: 'finished 40-output answer, last two acknowledgments withheld', options: { outputs: FORTY, stopAckingAfter: 38 }, sweepOnly: true },
  { name: 'finished 40-output answer, last three acknowledgments withheld', options: { outputs: FORTY, stopAckingAfter: 37 }, sweepOnly: true }
];
const REDUCED = ['withheld records', 'records signed after the deadline', 'stop statements'];

const CLOCKS = {
  'before-deadline': ctx => ctx.deadline - 1,
  'at-deadline': ctx => ctx.deadline,
  'in-window': ctx => ctx.deadline + 1,
  'window-end': ctx => ctx.closesAt,
  after: ctx => ctx.closesAt + 1,
  'long-after': ctx => ctx.closesAt + 10 * 60 * 1000
};

// ---------------------------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------------------------

const byStage = (shares, credits) => shares.map(row => credits.filter(credit => credit.participantId === row.participantId).reduce((sum, credit) => sum + credit.amount, 0));
function independentView(result, shares) {
  return new Map(result.reservations.map(row => [row.reservationId, { outcome: row.outcome, reason: row.reason, debit: row.requesterDebit,
    credits: shares.map((share, index) => row.credits.filter(credit => credit.partitionIndex === index).reduce((sum, credit) => sum + credit.amount, 0)),
    late: row.late.length }]));
}
function serviceView(result, shares) {
  return new Map(result.reservations.map(row => [row.reservationId, { outcome: row.status, reason: row.reason, debit: row.debit ?? 0,
    credits: byStage(shares, row.credits ?? []), late: (row.late ?? []).length, conflictKinds: [...new Set((row.conflicts ?? []).map(item => item.kind))] }]));
}

async function judge({ records, policies, at, shares }) {
  const independent = independentReplay({ policies, records, now: at, maxUnacknowledgedOutputs: DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS });
  // Second pass with the one unstated number supplied, used only to attribute disagreements to it.
  const skewed = independentView(independentReplay({ policies, records, now: at, clockSkewMs: POLICY.maxClockSkewMs }), shares);
  let service, serviceError = null;
  try { service = await serviceReplay({ records, policies, at }); } catch (error) { serviceError = String(error?.message ?? error); }
  const mine = independentView(independent, shares);
  const theirs = serviceError ? new Map() : serviceView(service, shares);
  const rows = [];
  for (const reservationId of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(reservationId) ?? { outcome: 'none', reason: null, debit: 0, credits: shares.map(() => 0), late: 0 };
    const b = theirs.get(reservationId) ?? { outcome: serviceError ? 'threw' : 'none', reason: serviceError, debit: 0, credits: shares.map(() => 0), late: 0 };
    const k = skewed.get(reservationId) ?? { outcome: 'none', reason: null, debit: 0, credits: shares.map(() => 0), late: 0 };
    const same = (x, y) => x.outcome === y.outcome && x.debit === y.debit && JSON.stringify(x.credits) === JSON.stringify(y.credits);
    rows.push({ reservationId, independent: a, withSkew: k, service: b, outcomeAgrees: a.outcome === b.outcome,
      amountsAgree: a.debit === b.debit && JSON.stringify(a.credits) === JSON.stringify(b.credits), lateAgrees: a.late === b.late,
      agreesWithSkew: same(k, b) });
  }
  if (rows.length === 0) rows.push({ reservationId: null, independent: { outcome: 'none', debit: 0, credits: [], late: 0 },
    service: { outcome: serviceError ? 'threw' : 'none', reason: serviceError, debit: 0, credits: [], late: 0 }, outcomeAgrees: !serviceError, amountsAgree: true, lateAgrees: true });
  const independentRejected = independent.rejected.length + independent.reservations.reduce((sum, row) => sum + row.rejected.filter(entry => entry.signer !== null).length, 0);
  const serviceRejected = serviceError ? null : (service.rejected ?? []).length;
  return { rows, rejected: { independent: independentRejected, service: serviceRejected, agrees: independentRejected === serviceRejected } };
}

// ---------------------------------------------------------------------------------------------------------------
// Why two judgments differ. Each disagreement gets one named cause; README.md explains and classifies each cause as
// (a) a reading of a sentence the document leaves open, (b) a defect in the service's verifier, or (c) a defect in
// the independent one.
// ---------------------------------------------------------------------------------------------------------------

export const CAUSES = Object.freeze({
  'finished answer, last acknowledgments withheld or late': 'b',
  'terms from a second requester reported as the requester\'s conflict': 'b',
  'terms or acceptance signed after the deadline still settle': 'b',
  'extra member in a carried key': 'b',
  'clock skew allowance': 'a',
  'what a stop\'s count means': 'a',
  'stage accepted two sets of terms': 'a',
  'acknowledged chain differs from the stage chain': 'a',
  'unrecognized unfinished-answer terms': 'a',
  'precedence: missing acceptance against open or expired': 'a',
  'precedence: delivered answer without a closing receipt, before the window ends': 'a',
  'what counts as a delivered answer': 'a',
  'the instant the release window ends': 'a',
  'service refuses to run without a policy': 'a',
  'acknowledgment beyond what a stage computed': 'c'
});

function causeOf(line) {
  const s = line.service, name = line.mutation;
  if (s.outcome === 'threw') return 'service refuses to run without a policy';
  if (line.agreesWithSkew) return 'clock skew allowance';
  const i = line.withSkew, reason = i.reason ?? '';
  if (reason === 'terms_from_several_requesters') return 'terms from a second requester reported as the requester\'s conflict';
  if (reason === 'terms_signed_after_deadline' || (reason === 'acceptance_missing' && name.includes('acceptance signed 5 s late'))) {
    return 'terms or acceptance signed after the deadline still settle';
  }
  if (name.includes('key carries an extra member')) return 'extra member in a carried key';
  if (reason.includes('stage_accepted_two_sets_of_terms')) return 'stage accepted two sets of terms';
  if (reason.includes('two_stops') || reason.includes('stop_understates')) return 'what a stop\'s count means';
  if (i.outcome === 'settled' && s.outcome === 'settled' && name.startsWith('stop naming')) return 'what a stop\'s count means';
  if (reason === 'acknowledged_chain_is_not_the_stage_chain' || (s.conflictKinds ?? []).includes('output-chain')) return 'acknowledged chain differs from the stage chain';
  if (reason === 'unfinished_terms_not_recognized') return 'unrecognized unfinished-answer terms';
  if ((s.reason ?? '').includes('never computed')) return 'acknowledgment beyond what a stage computed';
  if (reason === 'acceptance_missing') return 'precedence: missing acceptance against open or expired';
  if (i.outcome === 'settled' && s.outcome === 'settled' && reason === 'answer_finished') return 'finished answer, last acknowledgments withheld or late';
  if (i.outcome === 'settled' && s.outcome === 'settled' && reason === 'requester_stopped') return 'what a stop\'s count means';
  if (i.outcome === 'open' && s.outcome === 'unknown') return 'precedence: delivered answer without a closing receipt, before the window ends';
  if (i.outcome === 'open' && s.outcome === 'expired' && line.clock === 'window-end') return 'the instant the release window ends';
  if (i.outcome === 'unknown' && reason.startsWith('delivered_answer')) return 'what counts as a delivered answer';
  return 'unclassified';
}

// ---------------------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  const stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
  const two = await createParties(2), three = await createParties(3);
  const cases = [];
  const add = (base, family, entry, ctx) => cases.push({ base: base.name, family, name: entry.name, records: entry.records,
    policies: entry.policies ?? [POLICY], clocks: entry.clocks ?? ['after'], ctx });

  const contexts = [];
  for (const [index, base] of BASES.entries()) {
    const parties = base.stages === 3 ? three : base.own ? { requester: two.requester, stages: [two.requester, two.stages[1]] } : two;
    const attempt = await runAttempt(parties, { tag: `b${index}`, ...base.options });
    const ctx = contextOf(attempt, parties, stranger);
    contexts.push(ctx);
    add(base, 'unmutated, clock sweep', { name: 'all records', records: ctx.records, clocks: Object.keys(CLOCKS) }, ctx);
    for (const [family, build] of Object.entries(MUTATIONS)) {
      if (base.sweepOnly || (!base.full && !REDUCED.includes(family))) continue;
      for (const entry of await build(ctx)) add(base, family, entry, ctx);
    }
  }
  // Two reservations in one set, and sets with no valid record at all.
  const mixed = { name: 'two reservations in one set' };
  add(mixed, 'several reservations', { name: 'complete answer with a dropped attempt', records: shuffled([...contexts[0].records, ...contexts[2].records], 3) }, contexts[0]);
  add(mixed, 'several reservations', { name: 'no records', records: [] }, contexts[0]);
  add(mixed, 'several reservations', { name: 'only records with broken signatures',
    records: contexts[0].records.map(record => ({ ...record, signature: record.signature.split('').reverse().join('') })) }, contexts[0]);

  const families = new Map(), disagreements = [], all = [];
  const totals = { recordSets: cases.length, judgments: 0, outcomeAgreed: 0, amountsAgreed: 0, outcomeAndAmountsAgreed: 0, agreedOnceSkewSupplied: 0,
    lateListSizeAgreed: 0, rejectedListSizeAgreed: 0, rejectedListsCompared: 0 };
  const outcomePairs = {};
  for (const item of cases) {
    for (const clock of item.clocks) {
      const at = CLOCKS[clock](item.ctx);
      const shares = item.ctx.terms.shares;
      const { rows, rejected } = await judge({ records: item.records, policies: item.policies, at, shares });
      totals.rejectedListsCompared += 1;
      if (rejected.agrees) totals.rejectedListSizeAgreed += 1;
      for (const row of rows) {
        totals.judgments += 1;
        const family = families.get(item.family) ?? { judgments: 0, outcomeAgreed: 0, amountsAgreed: 0 };
        family.judgments += 1;
        if (row.outcomeAgrees) { totals.outcomeAgreed += 1; family.outcomeAgreed += 1; }
        if (row.amountsAgree) { totals.amountsAgreed += 1; family.amountsAgreed += 1; }
        if (row.outcomeAgrees && row.amountsAgree) totals.outcomeAndAmountsAgreed += 1;
        if (row.lateAgrees) totals.lateListSizeAgreed += 1;
        families.set(item.family, family);
        const pair = `${row.independent.outcome} / ${row.service.outcome}`;
        outcomePairs[pair] = (outcomePairs[pair] ?? 0) + 1;
        const line = { base: item.base, family: item.family, mutation: item.name, clock, independent: row.independent, service: row.service,
          withSkew: row.withSkew, agreesWithSkew: row.agreesWithSkew, rejected: { independent: rejected.independent, service: rejected.service } };
        all.push(line);
        if (row.agreesWithSkew) totals.agreedOnceSkewSupplied += 1;
        if (!row.outcomeAgrees || !row.amountsAgree) disagreements.push({ ...line, cause: causeOf(line) });
      }
    }
  }

  const compact = line => ({ base: line.base, mutation: line.mutation, clock: line.clock,
    independent: `${line.independent.outcome} (${line.independent.reason}) debit ${line.independent.debit} credits ${JSON.stringify(line.independent.credits)}`,
    service: `${line.service.outcome} (${line.service.reason}) debit ${line.service.debit} credits ${JSON.stringify(line.service.credits)}` });
  const byCause = {};
  for (const line of disagreements) {
    const entry = byCause[line.cause] ??= { classification: CAUSES[line.cause] ?? null, count: 0, amountsDiffer: 0, examples: [] };
    entry.count += 1;
    if (line.independent.debit !== line.service.debit || JSON.stringify(line.independent.credits) !== JSON.stringify(line.service.credits)) entry.amountsDiffer += 1;
    if (entry.examples.length < 3) entry.examples.push(compact(line));
  }
  // Judgments worth reading whether or not the verifiers agree: the receipt carries them in full.
  const NOTED = [
    line => line.base.startsWith('finished 40-output answer') && line.clock === 'after',
    line => line.mutation.startsWith('final stage signs three more steps'),
    line => line.base === 'stages close early on their own' && line.mutation === 'all records' && line.clock === 'after',
    line => line.base === 'complete answer' && line.clock === 'after' && ['all records', 'a stranger signs terms for the same reservation',
      'requester signs second terms with other weights (no acceptances)', 'terms and acceptances signed 5 s late',
      'top acknowledgment key carries an extra member', 'terms key carries an extra member'].includes(line.mutation),
    line => line.base === 'requester stops acknowledging' && line.clock === 'after' && ['all records', 'extra acknowledgment of one more output, signed 5 s late'].includes(line.mutation)
  ];
  const noted = all.filter(line => NOTED.some(test => test(line))).map(compact);
  let commit = 'unknown', dirty = null;
  try {
    commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'server/fleet', 'scripts/settlement', 'packages/reploid/src',
      ':(exclude)scripts/settlement/independent/receipts'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* the receipt says unknown */ }
  const receipt = {
    schema: 'reploid.settlement-replay-differential/v1',
    generatedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    command: 'node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json',
    commit, uncommittedChangesInComparedCode: dirty, node: process.version,
    note: 'All parties are simulated identities on one machine, and one author wrote the independent verifier, so this is not a third-party replay. Both verifiers ran in one process on the same record sets. Keys are fresh on each run; counts are deterministic. Classifications: a = a reading of a sentence the document leaves open, b = a defect in the service verifier, c = a defect in the independent verifier.',
    policy: POLICY, maxUnacknowledgedOutputs: DEFAULT_MAX_UNACKNOWLEDGED_OUTPUTS,
    baseAttempts: BASES.map(base => base.name),
    totals,
    outcomePairs: Object.fromEntries(Object.entries(outcomePairs).sort()),
    families: Object.fromEntries(families),
    disagreements: { total: disagreements.length, byCause },
    noted
  };
  const out = flag('out');
  if (out && out !== true) {
    const path = resolve(process.cwd(), out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  if (flag('all')) for (const line of all) console.log(JSON.stringify(line));
  console.log(JSON.stringify({ totals, outcomePairs: receipt.outcomePairs }, null, 2));
  console.log('\nDisagreements by cause (classification, count, of which amounts differ):');
  for (const [cause, entry] of Object.entries(byCause).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  (${entry.classification ?? '?'}) ${String(entry.count).padStart(4)} ${String(entry.amountsDiffer).padStart(4)}  ${cause}`);
    if (!flag('verbose')) continue;
    for (const line of disagreements.filter(item => item.cause === cause)) {
      console.log(`        ${line.base} | ${line.mutation} | ${line.clock} | ${line.independent.outcome} (${line.independent.reason}) ${line.independent.debit} ${JSON.stringify(line.independent.credits)} vs ${line.service.outcome} (${line.service.reason}) ${line.service.debit} ${JSON.stringify(line.service.credits)}`);
    }
  }
}

await main();

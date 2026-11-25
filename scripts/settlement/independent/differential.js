/**
 * Differential run of two settlement verifiers over the same record sets: the service's
 * (server/fleet/settlement-replay.js) and the second one beside this file (replay.js), which was written from
 * docs/settlement-replay.md alone.
 *
 * Base attempts are built with the production signing code through scripts/settlement/scenario.js. Each mutation
 * removes, repeats, reorders, edits or adds records, re-signing with real keys where the mutation needs a valid
 * signature. Both verifiers judge every set at one or more clock values; the outcome, the requester's debit and each
 * stage's credit are compared. The late, foreign and rejected lists are compared by size, and the conflict lists
 * by whether each has an entry (the document does not name the conflict kinds).
 *
 *   node scripts/settlement/independent/differential.js --out scripts/settlement/independent/receipts/differential.json
 *
 * Plain Node, no model, no GPU, no network. All parties are simulated identities on one machine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaySettlement as independentReplay } from './replay.js';
import { replaySettlement as serviceReplay } from '../../../server/fleet/settlement-replay.js';
import { policyDigest, termsDigest } from '../../../server/fleet/settlement-terms.js';
import { createAttemptEvidenceSigner } from '../../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createSigningIdentity } from '../../../packages/reploid/src/artifacts/identity.js';
import { POLICY, createParties, runAttempt } from '../scenario.js';
import { UNFINISHED_ANSWER_TERMS } from '../../../server/fleet/credit-shares.js';

const SCHEMAS = Object.freeze({
  terms: 'reploid.settlement-terms/v1', acceptance: 'reploid.settlement-acceptance/v1', receipt: 'reploid.stage-receipt/v1',
  acknowledgment: 'reploid.output-acknowledgment/v1', stop: 'reploid.settlement-stop/v1'
});
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
// A policy of the time before policies published K: K is then the stages' receiver policy's value.
const { maxUnacknowledgedOutputs: _publishedK, ...POLICY_BEFORE_K } = POLICY;
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
  const body = bodyOf(ctx.terms);
  if (typeof changes === 'function') changes(body); else Object.assign(body, changes);
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
      { name: 'legacy terms without unfinished-answer terms', records: await withTerms(ctx, { unfinishedTerms: null }) },
      { name: 'older provider-loss-free unfinished-answer terms', records: await withTerms(ctx, { unfinishedTerms: UNFINISHED_ANSWER_TERMS }) }
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
    for (let extra = 1; extra <= ctx.terms.maxUnacknowledgedOutputs + 1; extra++) {
      const body = bodyOf(previous);
      Object.assign(body, { sequence: previous.sequence + 1, steps: previous.steps + 1, tokens: { ...previous.tokens, processed: previous.tokens.processed + 1 },
        output: { count: previous.steps + 1, chain: `sha256:${String(extra).repeat(64)}`, done: false, stopReason: null } });
      previous = await sign(identity, body);
      added.push(previous);
    }
    const close = await sign(identity, { ...bodyOf(previous), sequence: previous.sequence + 1, status: closing.status, timing: closing.timing });
    return [{ name: 'final stage signs three more steps after the last acknowledged output, then closes', records: [...without(ctx.records, closing), ...added, close] }];
  },
  async 'the signed acknowledgment allowance K'(ctx) {
    const out = [];
    for (const k of [0, 1, 5, 64]) {
      if (k !== ctx.terms.maxUnacknowledgedOutputs) out.push({ name: `terms name K = ${k}`, records: await withTerms(ctx, { maxUnacknowledgedOutputs: k }) });
    }
    out.push({ name: 'terms without K', records: await withTerms(ctx, body => { delete body.maxUnacknowledgedOutputs; }) });
    out.push({ name: 'terms with K = -1', records: await withTerms(ctx, { maxUnacknowledgedOutputs: -1 }) });
    out.push({ name: 'terms with K = 1.5', records: await withTerms(ctx, { maxUnacknowledgedOutputs: 1.5 }) });
    out.push({ name: 'terms with K as text', records: await withTerms(ctx, { maxUnacknowledgedOutputs: '2' }) });
    return out;
  },
  // Every record here carries a valid signature from the right key, so only a field rule can reject it.
  async 'field rules, validly signed'(ctx) {
    const out = [], long = n => 'x'.repeat(n);
    const terms = (name, changes) => withTerms(ctx, changes).then(records => out.push({ name, records }));
    await terms('terms maximum is not the ceiling times the price', { maximum: ctx.terms.maximum + 1 });
    await terms('terms carry an extra signed member', { note: 'signed' });
    await terms('terms share indexes do not match their positions', body => { body.shares = body.shares.map((row, index, all) => ({ ...row, partitionIndex: all.length - 1 - index })); });
    await terms('terms share with weight 0', body => { body.shares[0] = { ...body.shares[0], weight: 0 }; });
    await terms('terms share with an extra member', body => { body.shares[0] = { ...body.shares[0], note: 'x' }; });
    await terms('terms with no shares', { shares: [] });
    await terms('terms deadline equal to notBefore', body => { body.deadline = body.notBefore; });
    await terms('terms unfinishedTerms is empty text', { unfinishedTerms: '' });
    await terms('terms unit of 65 characters', { unit: long(65) });
    await terms('terms attemptId of 257 characters', { attemptId: long(257) });
    await terms('terms signedAt in another form Date.parse accepts', body => { body.signedAt = new Date(Date.parse(body.signedAt)).toUTCString(); });
    await terms('terms signedAt is not a time', { signedAt: 'yesterday' });
    await terms('terms signedAt of 49 characters that Date.parse accepts', body => { body.signedAt = new Date(Date.parse(body.signedAt)).toUTCString() + ' '.repeat(20); });
    await terms('terms creditsPerOutputToken as text', { creditsPerOutputToken: String(ctx.terms.creditsPerOutputToken) });
    await terms('terms members signed in another order', body => { const copy = Object.fromEntries(Object.entries(body).reverse()); for (const key of Object.keys(body)) delete body[key]; Object.assign(body, copy); });

    const swap = async (record, identity, edit, name) => {
      if (!record) return;
      const body = bodyOf(record);
      edit(body);
      out.push({ name, records: [...without(ctx.records, record), await sign(identity, body)] });
    };
    const final = ctx.receipts(ctx.finalIndex).at(-1), finalId = ctx.stageIdentity(ctx.finalIndex);
    const first = ctx.receipts(0).at(-1), firstId = ctx.stageIdentity(0);
    await swap(ctx.acceptances[0], firstId, body => { body.note = 'signed'; }, 'acceptance carries an extra signed member');
    await swap(ctx.acceptances[0], firstId, body => { body.termsDigest = body.termsDigest.toUpperCase().replace('SHA256', 'sha256'); }, 'acceptance names the terms digest in upper-case hex');
    if (final?.output) {
      await swap(final, finalId, body => { body.output = { ...body.output, count: body.output.count + 1 }; }, 'final receipt output count differs from its steps');
      await swap(final, finalId, body => { body.output = { ...body.output, stopReason: long(65) }; }, 'final receipt stopReason of 65 characters');
      await swap(final, finalId, body => { body.output = { ...body.output, done: 1 }; }, 'final receipt done is 1, not true');
      await swap(final, finalId, body => { body.output = null; }, 'final stage closes with a null output');
    }
    await swap(final, finalId, body => { body.sequence = 0; }, 'final receipt with sequence 0');
    await swap(final, finalId, body => { body.status = 'closed'; }, 'final receipt with a status outside the three');
    await swap(final, finalId, body => { body.tokens = { ...body.tokens, cached: 0 }; }, 'final receipt tokens with an extra member');
    await swap(final, finalId, body => { const { closedAt: _closedAt, ...timing } = body.timing; body.timing = timing; }, 'final receipt timing without a closedAt member');
    await swap(final, finalId, body => { body.timing = { ...body.timing, closedAt: null }; }, 'final stage closes with closedAt null');
    if (first && final?.output && ctx.finalIndex !== 0) {
      await swap(first, firstId, body => { body.output = { ...final.output, count: body.steps }; }, 'stage0, not the final stage, carries an output');
    }
    if (ctx.topAck.count > 0) {
      await swap(ctx.topAck, ctx.requester, body => { body.note = 'signed'; }, 'top acknowledgment carries an extra signed member');
      await swap(ctx.topAck, ctx.requester, body => { body.chain = body.chain.toUpperCase().replace('SHA256', 'sha256'); }, 'top acknowledgment chain in upper-case hex');
      await swap(ctx.topAck, ctx.requester, body => { body.count = String(body.count); }, 'top acknowledgment count as text');
    }
    await swap(ctx.stops[0], ctx.requester, body => { body.note = 'signed'; }, 'stop carries an extra signed member');
    for (const [record, label] of [[ctx.terms, 'terms'], [ctx.acceptances[0], 'acceptance'], [final, 'final receipt'], [ctx.topAck, 'top acknowledgment'], [ctx.stops[0], 'stop']]) {
      if (record) out.push({ name: `${label} signature with base64 padding appended`, records: [...without(ctx.records, record), { ...record, signature: `${record.signature}=` }] });
    }
    out.push({ name: 'terms record without its key', records: [...without(ctx.records, ctx.terms), (({ publicJwk: _key, ...rest }) => rest)(ctx.terms)] });
    return out;
  },
  async 'terms from another requester'(ctx) {
    const id = ctx.stranger.peerId, out = [];
    const theirs = await sign(ctx.stranger, { ...bodyOf(ctx.terms), requesterId: id });
    const binding = await sign(ctx.stranger, { ...bodyOf(ctx.acks[0]), requesterId: id });
    const elsewhere = await sign(ctx.stranger, { ...bodyOf(ctx.terms), requesterId: id, routeHash: OTHER_DIGEST });
    const theirDigest = await termsDigest(bodyOf(theirs));
    out.push({ name: 'a stranger signs terms on the same route and its own charge binding', records: [...ctx.records, theirs, binding] });
    out.push({ name: 'a stranger signs terms naming another route', records: [...ctx.records, elsewhere] });
    out.push({ name: 'a stranger signs terms and a binding, and stage0 accepts the stranger\'s terms too', records: [...ctx.records, theirs, binding,
      await sign(ctx.stageIdentity(0), { ...bodyOf(ctx.acceptances[0]), termsDigest: theirDigest })] });
    out.push({ name: 'only a stranger\'s terms and binding, with the stages\' real receipts', records: [...without(ctx.records, ctx.terms, ...ctx.acceptances, ...ctx.acks), theirs, binding] });
    // A complete attempt of the stranger's own under this reservation ID: it is requester and only stage.
    const own = await sign(ctx.stranger, { ...bodyOf(ctx.terms), requesterId: id, shares: [{ partitionIndex: 0, participantId: id, weight: 1 }] });
    const ownAcceptance = await sign(ctx.stranger, { schema: SCHEMAS.acceptance, termsDigest: await termsDigest(bodyOf(own)), reservationId: own.reservationId,
      attemptId: own.attemptId, participantId: id, partitionIndex: 0, signedAt: own.signedAt });
    out.push({ name: 'a stranger signs its own terms, acceptance and charge binding under this reservation ID', records: [...ctx.records, own, ownAcceptance, binding] });
    return out;
  },
  async 'requester equivocates on terms'(ctx) {
    if (ctx.stageCount < 2) return [];
    const weights = ctx.terms.shares.map((row, index) => ({ ...row, weight: row.weight + (index === 0 ? 5 : 0) }));
    const second = await reterm(ctx, { shares: weights });
    const split = [...without(ctx.records, ctx.acceptances.find(row => row.partitionIndex === 0)), second.terms, second.acceptances.find(row => row.partitionIndex === 0)];
    const late = await reterm(ctx, { shares: weights }, { acceptedAt: ctx.deadline + 5000 });
    return [
      { name: 'stage0 accepts the second terms, the other stages the first', records: split },
      { name: 'stages accept the second terms only after the deadline', records: [...ctx.records, late.terms, ...late.acceptances] },
      { name: 'second terms signed after the deadline, accepted by no stage', records: [...ctx.records, (await reterm(ctx, { shares: weights }, { signedAt: ctx.deadline + 5000 })).terms] }
    ];
  },
  async 'the edges of the time window'(ctx) {
    if (ctx.topAck.count === 0) return [];
    const skew = POLICY.maxClockSkewMs, out = [], clocks = ['after'];
    const top = at => sign(ctx.requester, { ...bodyOf(ctx.topAck), signedAt: iso(at) });
    for (const [label, at] of [['exactly the deadline plus the skew allowance', ctx.deadline + skew], ['one millisecond past the deadline plus the skew allowance', ctx.deadline + skew + 1],
      ['exactly the start minus the skew allowance', Date.parse(ctx.terms.notBefore) - skew], ['one millisecond before the start minus the skew allowance', Date.parse(ctx.terms.notBefore) - skew - 1]]) {
      out.push({ name: `top acknowledgment signed at ${label}`, clocks, records: [...without(ctx.records, ctx.topAck), await top(at)] });
    }
    const closing = ctx.receipts(0).find(record => record.status !== 'executing');
    if (closing) {
      const after = ctx.deadline + skew + 5000;
      out.push({ name: 'stage0 signs an executing receipt after its closing one, outside the window', clocks, records: [...ctx.records,
        await sign(ctx.stageIdentity(0), { ...bodyOf(closing), sequence: closing.sequence + 1, status: 'executing', timing: { ...closing.timing, closedAt: null }, signedAt: iso(after) })] });
    }
    out.push({ name: 'charge binding replaced by one with another chain', clocks, records: [...without(ctx.records, ctx.acks[0]),
      await sign(ctx.requester, { ...bodyOf(ctx.acks[0]), chain: FAKE_CHAIN })] });
    return out;
  },
  // Rules the document gained at c29bc5d44: one time form, canonical base64url, and a closing receipt's own window.
  async 'canonical encodings, time forms and the closing window'(ctx) {
    const out = [];
    const resign = async (record, identity, edit, name) => {
      if (!record) return;
      const body = bodyOf(record);
      edit(body);
      out.push({ name, records: [...without(ctx.records, record), await sign(identity, body)] });
    };
    if (ctx.topAck.count > 0) {
      const text = ctx.topAck.signedAt;
      const forms = [['without milliseconds', text.replace(/\.\d{3}Z$/, 'Z')], ['with a +00:00 offset', text.replace(/Z$/, '+00:00')],
        ['with a lower-case z', text.replace(/Z$/, 'z')], ['with a lower-case t', text.replace('T', 't')], ['with a space for the T', text.replace('T', ' ')],
        ['without a zone', text.replace(/Z$/, '')], ['with six fraction digits', text.replace(/Z$/, '000Z')], ['naming 30 February', '2026-02-30T12:00:00.000Z'],
        ['with hour 24', text.replace(/T\d\d/, 'T24')], ['with an expanded year', `+00${text}`]];
      for (const [label, value] of forms) await resign(ctx.topAck, ctx.requester, body => { body.signedAt = value; }, `top acknowledgment signedAt ${label}`);
    }
    const final = ctx.receipts(ctx.finalIndex).at(-1);
    if (final?.timing?.closedAt) {
      await resign(final, ctx.stageIdentity(ctx.finalIndex), body => { body.timing = { ...body.timing, closedAt: body.timing.closedAt.replace(/\.\d{3}Z$/, 'Z') }; },
        'final receipt closedAt without milliseconds');
    }
    out.push({ name: 'terms notBefore with a +00:00 offset', records: await withTerms(ctx, body => { body.notBefore = body.notBefore.replace(/Z$/, '+00:00'); }) });

    // Another last character with the same decoded bytes: the low bit of the final base64url character is unused
    // for a 32-byte coordinate and for a 64-byte signature.
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alias = text => text.slice(0, -1) + ALPHABET[ALPHABET.indexOf(text.at(-1)) ^ 1];
    const targets = [[ctx.terms, 'terms'], [ctx.acceptances[0], 'acceptance'], [final, 'final receipt'], [ctx.topAck, 'top acknowledgment'], [ctx.stops[0], 'stop']]
      .filter(([record]) => record);
    for (const [record, label] of targets) {
      out.push({ name: `${label} signature with another final character for the same bytes`, records: [...without(ctx.records, record), { ...record, signature: alias(record.signature) }] });
    }
    out.push({ name: 'terms key coordinate with another final character for the same bytes',
      records: [...without(ctx.records, ctx.terms), { ...ctx.terms, publicJwk: { ...ctx.terms.publicJwk, x: alias(ctx.terms.publicJwk.x) } }] });

    // A P-256 signature (r, s) has a second valid form (r, n - s) over the same body.
    if (ctx.terms.publicJwk.kty === 'EC') {
      const ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
      const twin = signature => {
        const raw = Buffer.from(signature, 'base64url');
        const s = BigInt(`0x${raw.subarray(32).toString('hex')}`);
        return Buffer.concat([raw.subarray(0, 32), Buffer.from((ORDER - s).toString(16).padStart(64, '0'), 'hex')]).toString('base64url');
      };
      out.push({ name: 'terms carry the second valid P-256 signature', records: [...without(ctx.records, ctx.terms), { ...ctx.terms, signature: twin(ctx.terms.signature) }] });
      out.push({ name: 'top acknowledgment presented under both valid P-256 signatures', records: [...ctx.records, { ...ctx.topAck, signature: twin(ctx.topAck.signature) }] });
      out.push({ name: 'every record carries the second valid P-256 signature', records: ctx.records.map(record => ({ ...record, signature: twin(record.signature) })) });
    }

    // A closing receipt counts when signed before the deadline plus the release window; other records, within the clock allowance.
    const closings = ctx.of(SCHEMAS.receipt).filter(record => record.status !== 'executing');
    if (closings.length) {
      const closeAt = async (at, name) => out.push({ name, records: [...without(ctx.records, ...closings), ...await Promise.all(closings.map(record =>
        sign(ctx.stageIdentity(record.partitionIndex), { ...bodyOf(record), timing: { ...record.timing, closedAt: iso(at) }, signedAt: iso(at) })))] });
      await closeAt(ctx.deadline + POLICY.maxClockSkewMs + 1, 'every closing receipt signed one millisecond past the clock allowance');
      await closeAt(ctx.closesAt - 1, 'every closing receipt signed one millisecond before the release window ends');
      await closeAt(ctx.closesAt, 'every closing receipt signed exactly when the release window ends');
      await closeAt(ctx.closesAt + POLICY.maxClockSkewMs, 'every closing receipt signed exactly at the end of the closing window');
      await closeAt(ctx.closesAt + POLICY.maxClockSkewMs + 1, 'every closing receipt signed one millisecond past the closing window');
      const executing = ctx.receipts(0).filter(record => record.status === 'executing').at(-1);
      if (executing) await resign(executing, ctx.stageIdentity(0), body => { body.signedAt = iso(ctx.deadline + POLICY.maxClockSkewMs + 1); },
        'stage0 last step receipt signed one millisecond past the clock allowance');
    }
    return out;
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
  },
  /** Terms as the first split trades signed them, with no K member (docs/settlement-replay.md, record shapes and step 3). */
  async 'terms signed before K'(ctx) {
    const olderDigest = await policyDigest(POLICY_BEFORE_K);
    const older = (change = () => {}) => body => { delete body.maxUnacknowledgedOutputs; change(body); };
    const underOlderPolicy = unfinishedTerms => older(body => { body.policyDigest = olderDigest; body.unfinishedTerms = unfinishedTerms; });
    return [
      { name: 'no K, provider-loss-free terms, policy that publishes no K', records: await withTerms(ctx, underOlderPolicy(UNFINISHED_ANSWER_TERMS)),
        policies: [POLICY_BEFORE_K] },
      { name: 'no K, null unfinished-answer terms, policy that publishes no K', records: await withTerms(ctx, underOlderPolicy(null)),
        policies: [POLICY_BEFORE_K] },
      { name: 'no K, provider-loss-free terms, policy that publishes K',
        records: await withTerms(ctx, older(body => { body.unfinishedTerms = UNFINISHED_ANSWER_TERMS; })) },
      { name: 'no K, the base attempt\'s own unfinished-answer terms, policy that publishes no K',
        records: await withTerms(ctx, older(body => { body.policyDigest = olderDigest; })), policies: [POLICY_BEFORE_K] }
    ];
  },
  /** Signed accounts (docs/settlement-replay.md, step 8): terms name the requester's account, each acceptance its stage's. */
  async 'signed accounts'(ctx) {
    const REQUESTER = 'account-requester', stageAccount = index => `account-stage-${index}`;
    // The requester's terms with `debitAccount`, and every acceptance of them signed again with `payoutOf(index)`
    // (`undefined` leaves the member out).
    const accounted = async (payoutOf, debitAccount = REQUESTER) => {
      const terms = await sign(ctx.requester, { ...bodyOf(ctx.terms), debitAccount });
      const digest = await termsDigest(bodyOf(terms));
      const accept = (acceptance, account) => sign(ctx.stageIdentity(acceptance.partitionIndex),
        { ...bodyOf(acceptance), termsDigest: digest, ...(account === undefined ? {} : { payoutAccount: account }) });
      const acceptances = await Promise.all(ctx.acceptances.map(acceptance => accept(acceptance, payoutOf(acceptance.partitionIndex))));
      return { accept, acceptances, records: [...without(ctx.records, ctx.terms, ...ctx.acceptances), terms, ...acceptances] };
    };
    const own = await accounted(stageAccount), first = ctx.acceptances.find(row => row.partitionIndex === 0);
    const out = [
      { name: 'every party signs its own account', records: own.records, clocks: Object.keys(CLOCKS) },
      { name: 'stage 0 signs the requester\'s account as its own', records: (await accounted(index => (index === 0 ? REQUESTER : stageAccount(index)))).records },
      { name: 'the final stage signs the requester\'s account as its own',
        records: (await accounted(index => (index === ctx.finalIndex ? REQUESTER : stageAccount(index)))).records },
      { name: 'every stage signs one shared account', records: (await accounted(() => 'account-shared')).records },
      { name: 'stage 0 accepts without naming an account', records: (await accounted(index => (index === 0 ? undefined : stageAccount(index)))).records },
      { name: 'no stage names an account', records: (await accounted(() => undefined)).records },
      { name: 'the requester\'s account is empty text', records: (await accounted(stageAccount, '')).records },
      { name: 'terms name no account, acceptances do',
        records: [...without(ctx.records, ...ctx.acceptances), ...await Promise.all(ctx.acceptances.map(acceptance =>
          sign(ctx.stageIdentity(acceptance.partitionIndex), { ...bodyOf(acceptance), payoutAccount: stageAccount(acceptance.partitionIndex) })))] }
    ];
    // The caller's enrollment (step 8): each key under the account it signed, one key under another, and nobody placed.
    const signedBy = new Map([[ctx.requester.peerId, REQUESTER], ...ctx.terms.shares.map(share => [share.participantId, stageAccount(share.partitionIndex)])]);
    out.push({ name: 'enrollment places every party under the account it signed', records: own.records, accountOf: id => signedBy.get(id) ?? id });
    out.push({ name: 'enrollment places stage 0 under the requester\'s account', records: own.records,
      accountOf: id => (id === ctx.terms.shares[0].participantId ? REQUESTER : signedBy.get(id) ?? id) });
    out.push({ name: 'enrollment places the requester under another account', records: own.records,
      accountOf: id => (id === ctx.requester.peerId ? 'account-other' : signedBy.get(id) ?? id) });
    out.push({ name: 'enrollment places nobody', records: own.records, accountOf: id => id });
    out.push({ name: 'enrollment supplied for an attempt without signed accounts', records: ctx.records, accountOf: id => signedBy.get(id) ?? id });
    if (first) {
      out.push({ name: 'stage 0 names two accounts', records: [...own.records, await own.accept(first, 'account-elsewhere')] });
      out.push({ name: 'stage 0 names its account and also accepts without one', records: [...own.records, await own.accept(first, undefined)] });
    }
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
  // Reservations made under the older rules keep them: the same early close under provider-loss-free terms.
  { name: 'provider-loss-free terms, stages close early', options: { stagesFailAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS } },
  { name: 'provider-loss-free terms, requester stops after 3 outputs', options: { requesterStopAfter: 3, unfinishedTerms: UNFINISHED_ANSWER_TERMS } },
  { name: 'output ceiling 3 with 5 outputs', options: { maxOutputTokens: 3 } },
  { name: 'three stages with equal weights', options: { weights: [1, 1, 1] }, stages: 3 },
  { name: 'requester computes stage0 itself', options: {}, own: true },
  { name: 'requester stops before any output', options: { requesterStopAfter: 0 } },
  { name: 'every party signs with P-256', options: {}, full: true, curve: 'ECDSA' },
  { name: 'requester stops acknowledging, P-256 keys', options: { outputs: Array.from({ length: 8 }, (_, i) => ` w${i}`), stopAckingAfter: 2 }, curve: 'ECDSA' },
  { name: 'identifiers with characters JSON escapes', options: {}, tag: 'q"\\\u00e9\u2028\u{10348}\u0007 z' },
  // A finished answer whose last acknowledgments never arrive. No mutation: scenario.js produces these directly.
  { name: 'finished 40-output answer, last acknowledgment withheld', options: { outputs: FORTY, stopAckingAfter: 39 }, sweepOnly: true },
  { name: 'finished 40-output answer, last two acknowledgments withheld', options: { outputs: FORTY, stopAckingAfter: 38 }, sweepOnly: true },
  { name: 'finished 40-output answer, last three acknowledgments withheld', options: { outputs: FORTY, stopAckingAfter: 37 }, sweepOnly: true }
];
const REDUCED = ['withheld records', 'records signed after the deadline', 'stop statements', 'terms signed before K', 'signed accounts'];

// An attempt is decided once the deadline, the release window and the clock allowance have all passed.
const decidedAt = ctx => ctx.closesAt + POLICY.maxClockSkewMs;
const CLOCKS = {
  'before-deadline': ctx => ctx.deadline - 1,
  'at-deadline': ctx => ctx.deadline,
  'in-window': ctx => ctx.deadline + 1,
  'window-end': ctx => ctx.closesAt,
  'decision-instant': ctx => decidedAt(ctx),
  after: ctx => decidedAt(ctx) + 1,
  'long-after': ctx => decidedAt(ctx) + 10 * 60 * 1000
};

// ---------------------------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------------------------

const byStage = (shares, credits) => shares.map(row => credits.filter(credit => credit.participantId === row.participantId).reduce((sum, credit) => sum + credit.amount, 0));
const EMPTY = shares => ({ reason: null, debit: 0, credits: shares.map(() => 0), late: 0, foreign: 0, conflicts: 0, conflictKinds: [] });
// The document reports one row per reservation and requester, and names every member of a row.
const rowKey = row => `${row.reservationId} / ${row.requesterId ?? 'no requester'}`;
const MEMBERS = Object.freeze(['attemptId', 'status', 'debit', 'credits', 'outputs', 'chargedOutputs', 'unacknowledgedOutputs', 'beyondCeiling',
  'closedAtLastStep', 'conflicts', 'late', 'foreign', 'unmatched', 'accounts']);
const sortKeys = value => (Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value);
const exact = value => JSON.stringify(sortKeys(value) ?? null);
// The same entries in another order: the document does not fix the order within a list.
const unordered = value => (Array.isArray(value) ? JSON.stringify(value.map(item => exact(item)).sort()) : exact(value));
/** Both verifiers return the documented shape, so one reading serves both. `reason` is a sentence for people and is not compared. */
function view(result, shares) {
  return new Map(result.reservations.map(row => [rowKey(row), { outcome: row.status, reason: row.reason, debit: row.debit ?? 0,
    credits: byStage(shares, row.credits ?? []), late: (row.late ?? []).length, foreign: (row.foreign ?? []).length, conflicts: (row.conflicts ?? []).length,
    conflictKinds: [...new Set((row.conflicts ?? []).map(item => item.kind))].sort(), members: Object.fromEntries(MEMBERS.map(name => [name, row[name]])) }]));
}
const independentView = view, serviceView = view;
const nonZero = counts => Object.fromEntries(Object.entries(counts ?? {}).filter(([, value]) => value !== 0));
/** Why a row member differs. Each is a place where the document and the service's verifier differ (d) or the document leaves a choice (a). */
export const MEMBER_CAUSES = Object.freeze({
  credits: ['d', 'an own-account stage: the document lists it in `credits` with amount 0, the service\'s verifier leaves it out'],
  conflicts: ['a', 'a `stage-receipt` conflict entry: which sequences it carries and how many entries one stage gets are not fixed by the document'],
  closedAtLastStep: ['a', 'a row that ends `unknown` for a missing acceptance: whether a stage already treated as closed at its last step is still listed']
});
const membersDiffering = (a, b, same) => MEMBERS.filter(name => same(a.members?.[name]) !== same(b.members?.[name]));

async function judge({ records, policies, at, shares, accountOf = null }) {
  let independent, independentError = null, service, serviceError = null;
  // `accountOf`, when a case supplies one, is the caller's enrollment (step 8); both verifiers get the same function.
  const enrollment = accountOf ? { accountOf } : {};
  try { independent = await independentReplay({ policies, records, at, ...enrollment }); } catch (error) { independentError = String(error?.message ?? error); }
  try { service = await serviceReplay({ records, policies, at, ...enrollment }); } catch (error) { serviceError = String(error?.message ?? error); }
  const mine = independentError ? new Map() : independentView(independent, shares);
  const theirs = serviceError ? new Map() : serviceView(service, shares);
  const rows = [];
  for (const reservationId of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(reservationId) ?? { outcome: independentError ? 'threw' : 'none', ...EMPTY(shares), reason: independentError };
    const b = theirs.get(reservationId) ?? { outcome: serviceError ? 'threw' : 'none', ...EMPTY(shares), reason: serviceError };
    rows.push({ reservationId, independent: a, service: b, outcomeAgrees: a.outcome === b.outcome,
      amountsAgree: a.debit === b.debit && JSON.stringify(a.credits) === JSON.stringify(b.credits), lateAgrees: a.late === b.late, foreignAgrees: a.foreign === b.foreign,
      membersDiffer: a.members && b.members ? membersDiffering(a, b, unordered) : ['row'], orderDiffers: a.members && b.members ? membersDiffering(a, b, exact) : [] });
  }
  if (rows.length === 0) rows.push({ reservationId: null, independent: { outcome: independentError ? 'threw' : 'none', ...EMPTY([]), reason: independentError },
    service: { outcome: serviceError ? 'threw' : 'none', ...EMPTY([]), reason: serviceError }, outcomeAgrees: !serviceError && !independentError,
    amountsAgree: true, lateAgrees: true, foreignAgrees: true, membersDiffer: independentError || serviceError ? ['row'] : [], orderDiffers: [] });
  const independentRejected = independentError ? null : independent.rejected.length;
  const serviceRejected = serviceError ? null : (service.rejected ?? []).length;
  // Which records were rejected (position and schema; the problem text is not specified), and the totals over all rows.
  const which = result => JSON.stringify((result.rejected ?? []).map(row => `${row.index}:${row.schema}`).sort());
  const both = !independentError && !serviceError;
  return { rows, rejected: { independent: independentRejected, service: serviceRejected, agrees: independentRejected === serviceRejected,
    sameRecords: both ? which(independent) === which(service) : independentError === null && serviceError === null },
  // `counts` is compared without its zero entries: the document does not say whether an outcome with no row is listed.
  totalsAgree: both ? { counts: exact(nonZero(independent.counts)) === exact(nonZero(service.counts)), balances: exact(independent.balances) === exact(service.balances) }
    : { counts: false, balances: false } };
}

// ---------------------------------------------------------------------------------------------------------------
// Why two judgments differ. Each disagreement gets one named cause; README.md explains and classifies each cause as
// (a) a reading of a sentence the document leaves open, (b) a defect in the service's verifier, (c) a defect in
// the independent one, or (d) the document and the service's verifier saying different things.
// ---------------------------------------------------------------------------------------------------------------

export const CAUSES = Object.freeze({
  'no policy supplied: the document says invalid, the service refuses to run': 'd',
  'signature with base64 padding: the document rejects it, the service accepts it': 'd'
});

function causeOf(line) {
  if (line.service.outcome === 'threw') return 'no policy supplied: the document says invalid, the service refuses to run';
  if (line.mutation.includes('signature with base64 padding appended')) return 'signature with base64 padding: the document rejects it, the service accepts it';
  return 'unclassified';
}

/** Same outcome and amounts, but a list differs. */
function listCauseOf(line) {
  const i = line.independent, s = line.service;
  if (line.mutation.includes('signature with base64 padding appended')) return 'signature with base64 padding: the document rejects the record, the service accepts it';
  if (i.late !== s.late && (line.mutation.startsWith('stop ') || line.mutation.includes('stops naming') || line.base.includes('requester stops'))) return 'a late stop: the document lists it as late, the service does not list it';
  if (i.foreign !== s.foreign) return 'terms of a second requester with its own charge binding: the service lists them as foreign, the document only drops them';
  if ((i.conflicts > 0) !== (s.conflicts > 0)) return 'one verifier lists a conflict entry where the other lists none';
  return 'unclassified';
}

// ---------------------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  const stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
  const two = await createParties(2), three = await createParties(3);
  const p256 = async () => createSigningIdentity({ algorithm: 'ECDSA' });
  const curved = { requester: await p256(), stages: [await p256(), await p256()] };
  const cases = [];
  const add = (base, family, entry, ctx) => cases.push({ base: base.name, family, name: entry.name, records: entry.records,
    policies: entry.policies ?? [POLICY], clocks: entry.clocks ?? ['after'], accountOf: entry.accountOf ?? null, ctx });

  const contexts = [];
  for (const [index, base] of BASES.entries()) {
    const parties = base.curve ? curved : base.stages === 3 ? three : base.own ? { requester: two.requester, stages: [two.requester, two.stages[1]] } : two;
    const attempt = await runAttempt(parties, { tag: base.tag ?? `b${index}`, ...base.options });
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
  const totals = { recordSets: cases.length, judgments: 0, outcomeAgreed: 0, amountsAgreed: 0, outcomeAndAmountsAgreed: 0,
    lateListSizeAgreed: 0, foreignListSizeAgreed: 0, conflictListedAgreed: 0, everyRowMemberAgreed: 0, everyRowMemberAgreedInOrder: 0,
    rejectedListSizeAgreed: 0, sameRecordsRejected: 0, countsAgreed: 0, balancesAgreed: 0, rejectedListsCompared: 0 };
  const memberDifferences = {};
  const listDifferences = [];
  const outcomePairs = {};
  for (const item of cases) {
    for (const clock of item.clocks) {
      const at = CLOCKS[clock](item.ctx);
      const shares = item.ctx.terms.shares;
      const { rows, rejected, totalsAgree } = await judge({ records: item.records, policies: item.policies, at, shares, accountOf: item.accountOf });
      totals.rejectedListsCompared += 1;
      if (rejected.agrees) totals.rejectedListSizeAgreed += 1;
      if (rejected.sameRecords) totals.sameRecordsRejected += 1;
      if (totalsAgree.counts) totals.countsAgreed += 1;
      if (totalsAgree.balances) totals.balancesAgreed += 1;
      for (const row of rows) {
        totals.judgments += 1;
        const family = families.get(item.family) ?? { judgments: 0, outcomeAgreed: 0, amountsAgreed: 0 };
        family.judgments += 1;
        if (row.outcomeAgrees) { totals.outcomeAgreed += 1; family.outcomeAgreed += 1; }
        if (row.amountsAgree) { totals.amountsAgreed += 1; family.amountsAgreed += 1; }
        if (row.outcomeAgrees && row.amountsAgree) totals.outcomeAndAmountsAgreed += 1;
        if (row.lateAgrees) totals.lateListSizeAgreed += 1;
        if (row.foreignAgrees) totals.foreignListSizeAgreed += 1;
        const conflictListed = (row.independent.conflicts > 0) === (row.service.conflicts > 0);
        if (conflictListed) totals.conflictListedAgreed += 1;
        if (row.membersDiffer.length === 0) totals.everyRowMemberAgreed += 1;
        if (row.orderDiffers.length === 0) totals.everyRowMemberAgreedInOrder += 1;
        for (const name of row.membersDiffer) {
          const entry = memberDifferences[name] ??= { count: 0, classification: MEMBER_CAUSES[name]?.[0] ?? null, cause: MEMBER_CAUSES[name]?.[1] ?? 'unclassified', examples: [] };
          entry.count += 1;
          if (entry.examples.length < 3) entry.examples.push({ base: item.base, mutation: item.name, clock, independent: row.independent.members?.[name] ?? null, service: row.service.members?.[name] ?? null });
        }
        families.set(item.family, family);
        const pair = `${row.independent.outcome} / ${row.service.outcome}`;
        outcomePairs[pair] = (outcomePairs[pair] ?? 0) + 1;
        const line = { base: item.base, family: item.family, mutation: item.name, clock, independent: row.independent, service: row.service,
          rejected: { independent: rejected.independent, service: rejected.service } };
        all.push(line);
        if (!row.outcomeAgrees || !row.amountsAgree) disagreements.push({ ...line, cause: causeOf(line) });
        else if (!row.lateAgrees || !row.foreignAgrees || !rejected.agrees || !conflictListed) listDifferences.push({ ...line, listCause: listCauseOf(line) });
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
  const listCauses = {};
  for (const line of listDifferences) {
    const entry = listCauses[line.listCause] ??= { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 2) entry.examples.push({ base: line.base, mutation: line.mutation, clock: line.clock, outcome: line.independent.outcome,
      lists: `independent/service: late ${line.independent.late}/${line.service.late}, foreign ${line.independent.foreign}/${line.service.foreign}, rejected ${line.rejected.independent}/${line.rejected.service}, conflict entries ${line.independent.conflicts}/${line.service.conflicts}` });
  }
  // Judgments worth reading whether or not the verifiers agree: the receipt carries them in full.
  const NOTED = [
    line => line.base.startsWith('finished 40-output answer') && line.clock === 'after',
    line => line.mutation.startsWith('final stage signs three more steps'),
    line => line.base === 'stages close early on their own' && line.mutation === 'all records' && line.clock === 'after',
    line => line.base === 'complete answer' && line.clock === 'after' && ['all records', 'a stranger signs terms for the same reservation',
      'a stranger signs its own terms, acceptance and charge binding under this reservation ID', 'requester acknowledges a second chain for its top count',
      'requester signs second terms with other weights (no acceptances)', 'stage0 accepts the second terms, the other stages the first',
      'terms and acceptances signed 5 s late', 'terms key carries an extra member', 'terms without K', 'final stage closes with a null output',
      'stage0 withholds its closing receipt', 'terms signature with base64 padding appended'].includes(line.mutation),
    line => line.base === 'requester stops acknowledging' && line.clock === 'after' && ['all records', 'terms name K = 5', 'terms name K = 0',
      'extra acknowledgment of one more output, signed 5 s late'].includes(line.mutation),
    line => line.base === 'every party signs with P-256' && ['all records', 'terms carry the second valid P-256 signature',
      'every record carries the second valid P-256 signature'].includes(line.mutation) && line.clock === 'after',
    line => line.base === 'complete answer' && ['top acknowledgment signedAt without a zone', 'top acknowledgment signedAt with a +00:00 offset',
      'terms signature with another final character for the same bytes', 'every closing receipt signed exactly when the release window ends',
      'every closing receipt signed one millisecond past the clock allowance'].includes(line.mutation)
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
    note: 'All parties are simulated identities on one machine. The second verifier was written from docs/settlement-replay.md alone by a second session under the same operator, so this is not a third-party replay. Both verifiers ran in one process on the same record sets. Keys are fresh on each run; counts are deterministic. Every documented row member except the sentence in `reason` is compared; list entries are compared without regard to order, and `counts` without its zero entries. Classifications: a = a reading of a sentence the document leaves open, b = a defect in the service verifier, c = a defect in the second verifier, d = the document and the service verifier say different things.',
    policy: POLICY,
    baseAttempts: BASES.map(base => base.name),
    totals,
    outcomePairs: Object.fromEntries(Object.entries(outcomePairs).sort()),
    families: Object.fromEntries(families),
    disagreements: { total: disagreements.length, byCause },
    sameOutcomeAndAmountsButListsDiffer: { total: listDifferences.length, byCause: listCauses },
    rowMembersCompared: MEMBERS, rowMemberDifferences: memberDifferences,
    noted
  };
  const out = flag('out');
  if (out && out !== true) {
    const path = resolve(process.cwd(), out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  if (flag('all')) for (const line of all) console.log(JSON.stringify(line));
  if (flag('lists')) for (const line of listDifferences) console.log(`${line.listCause} | ${line.base} | ${line.mutation} | ${line.clock} | ${line.independent.outcome} | late ${line.independent.late}/${line.service.late} foreign ${line.independent.foreign}/${line.service.foreign} rejected ${line.rejected.independent}/${line.rejected.service} conflicts ${line.independent.conflicts}/${line.service.conflicts}`);
  console.log(JSON.stringify({ totals, outcomePairs: receipt.outcomePairs }, null, 2));
  console.log(`\nRow members that differ (entries compared without regard to order): ${Object.keys(memberDifferences).length ? '' : 'none'}`);
  for (const [name, entry] of Object.entries(memberDifferences)) {
    console.log(`  (${entry.classification ?? '?'}) ${String(entry.count).padStart(4)}  ${name}: ${entry.cause}`);
    if (flag('verbose')) for (const example of entry.examples) console.log(`        ${example.base} | ${example.mutation} | ${example.clock} | ${JSON.stringify(example.independent)?.slice(0, 200)} vs ${JSON.stringify(example.service)?.slice(0, 200)}`);
  }
  console.log(`\nSame outcome and amounts, a list differs: ${listDifferences.length}`);
  for (const [cause, entry] of Object.entries(listCauses)) console.log(`  ${String(entry.count).padStart(4)}  ${cause}`);
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

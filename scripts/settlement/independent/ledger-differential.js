#!/usr/bin/env node
/**
 * Does the live ledger post what the settlement replay computes? differential.js compares two replays; this compares
 * the service's replay (server/fleet/settlement-replay.js) with the ledger that actually moves credits
 * (server/fleet/credits.js) on the same attempts.
 *
 * Each case is one attempt built with the production signers (scripts/settlement/scenario.js) and one choice of
 * which records the parties present. The ledger is driven through its public interface the way the live route
 * drives it: reserve, dispatch and admit at the start; `collect` with each acknowledgment and the receipt it
 * acknowledged at the moment that acknowledgment was signed; `collect` again, at the moment the last record was
 * signed, with what a live route retains (each stage's latest receipt, the latest acknowledgment and its receipt, and
 * the requester's signed stop when there is one); then `recover` once the attempt is decided, which is after the
 * deadline, the release window and the clock allowance. The replay judges the same records
 * after the window. A fresh ledger is opened for every case.
 *
 * The terms' deadline in scenario.js is 30 s after the start, so the policy used here sets `maxRequestMs` to 30 s:
 * the ledger's own deadline for the reservation is then the same instant as the signed one, as in the live requester,
 * which signs `deadline = notBefore + maxRequestMs`.
 *
 *   node scripts/settlement/independent/ledger-differential.js [--verbose] [--latest-only] [--out FILE.json]
 *
 * `--latest-only` hands the ledger only the final collect, without the acknowledgments as they were signed and
 * without the stop: what a route that kept less would give it. It is a second question, not the default.
 *
 * Plain Node, no model, no GPU, no network. All parties are simulated identities on one machine. The ledger sees
 * less than the replay by design (latest records only, no stop on a split route), so a difference here is a question
 * to answer, not automatically a defect in either.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../../packages/reploid/src/artifacts/identity.js';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA } from '../../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { openFleetCredits } from '../../../server/fleet/credits.js';
import { SETTLEMENT_STOP_SCHEMA } from '../../../server/fleet/settlement-terms.js';
import { replaySettlement } from '../../../server/fleet/settlement-replay.js';
import { POLICY as SCENARIO_POLICY, T0, createParties, runAttempt } from '../scenario.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? true; };
const POLICY = Object.freeze({ ...SCENARIO_POLICY, maxRequestMs: 30000 });
const LATEST_ONLY = Boolean(flag('latest-only'));
const words = count => Array.from({ length: count }, (_, index) => ` w${index}`);

const BASES = [
  { name: 'complete answer', options: {} },
  { name: 'finished 40-output answer', options: { outputs: words(40) } },
  { name: 'finished 40-output answer, last acknowledgment withheld', options: { outputs: words(40), stopAckingAfter: 39 } },
  { name: 'finished 40-output answer, last three acknowledgments withheld', options: { outputs: words(40), stopAckingAfter: 37 } },
  { name: 'requester stops acknowledging after 2 of 8', options: { outputs: words(8), stopAckingAfter: 2 } },
  { name: 'requester signs a stop after 3 outputs', options: { requesterStopAfter: 3 } },
  { name: 'requester signs a stop before any output', options: { requesterStopAfter: 0 } },
  { name: 'stages close early on their own after 3 outputs', options: { stagesFailAfter: 3 } },
  { name: 'stage0 drops after 3 steps and never closes', options: { vanishStage: 0, vanishAfterStep: 2 } },
  { name: 'final stage drops after 3 steps and never closes', options: { vanishStage: 1, vanishAfterStep: 2 } },
  { name: 'answer delivered but stage0 never closes', options: { vanishStage: 0, vanishAfterStep: 4 } },
  { name: 'last acknowledgment and closes 1 s after the deadline', options: { lateAckDelayMs: 1000 } },
  { name: 'last acknowledgment and closes 5 s after the deadline', options: { lateAckDelayMs: 5000 } },
  { name: 'output ceiling 3 with 5 outputs', options: { maxOutputTokens: 3 } },
  { name: 'three stages with equal weights', options: { weights: [1, 1, 1] }, stages: 3 },
  { name: 'every party signs with P-256', options: {}, curve: 'ECDSA' }
];

const receiptsOf = (records, index) => records.filter(row => row.schema === STAGE_RECEIPT_SCHEMA && row.partitionIndex === index).sort((a, b) => a.sequence - b.sequence);
const acksOf = records => records.filter(row => row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA).sort((a, b) => a.count - b.count);
const without = (records, removed) => records.filter(row => !removed.includes(row));

/** Which records the parties present. Each returns null when the attempt has nothing of that kind to withhold. */
function variants(attempt, stageCount) {
  const records = [...new Set(attempt.all())], out = [{ name: 'all records', records }];
  for (let index = 0; index < stageCount; index++) {
    const all = receiptsOf(records, index), closing = all.filter(row => row.status !== 'executing');
    if (closing.length) out.push({ name: `stage${index} withholds its closing receipt`, records: without(records, closing) });
    if (all.length) out.push({ name: `stage${index} presents no receipt`, records: without(records, all) });
  }
  const acks = acksOf(records);
  if (acks.length > 1) {
    out.push({ name: 'requester withholds its top acknowledgment', records: without(records, [acks.at(-1)]) });
    out.push({ name: 'requester presents only its charge binding', records: without(records, acks.slice(1)) });
  }
  return out;
}

/** A live ledger with one owner account per party, unless `ownStage` puts that stage's computer in the requester's account. */
async function openLive(parties, ownStage = null) {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-ledger-differential-'));
  const people = [parties.requester, ...parties.stages];
  const computers = people.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`,
    ownerId: ownStage !== null && index === ownStage + 1 ? 'owner-0' : `owner-${index}`, providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
  const accountOf = new Map(computers.map(row => [row.providers[0].participantId, row.ownerId]));
  const live = { clock: T0, accountOf };
  live.ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy: POLICY, now: () => live.clock });
  live.closesAt = T0 + POLICY.maxRequestMs + POLICY.partitionUnclaimedReleaseMs;
  live.admit = attempt => {
    live.clock = T0;
    live.ledger.reserve({ id: attempt.reservationId, executionId: attempt.identity.attemptId, mode: 'partition', consumer: parties.requester.peerId,
      providers: attempt.terms.shares.map(row => ({ participantId: row.participantId, weight: row.weight })),
      model: { id: attempt.identity.route.modelId, identity: attempt.identity.route.modelIdentity, adapterIdentities: [] },
      inputDigest: `sha256:${'d'.repeat(64)}`, maxOutputTokens: attempt.terms.maxOutputTokens, route: attempt.identity });
    live.ledger.dispatch(attempt.reservationId, parties.requester.peerId);
    attempt.identity.route.stages.forEach((_, index) => live.ledger.admit(attempt.reservationId, index));
  };
  /** What a live route retains: each stage's latest receipt, the latest acknowledgment and the receipt it acknowledged. */
  live.evidence = (attempt, records) => {
    const receipts = parties.stages.map((_, index) => receiptsOf(records, index).at(-1)).filter(Boolean);
    const acknowledgment = acksOf(records).at(-1) ?? null;
    const acknowledgedReceipt = acknowledgment && acknowledgment.count > 0 ? receiptsOf(records, parties.stages.length - 1)
      .find(row => row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain) ?? null : null;
    const stop = records.find(row => row.schema === SETTLEMENT_STOP_SCHEMA) ?? null;
    return { identity: attempt.identity, receipts, ...(acknowledgment ? { acknowledgment } : {}), ...(acknowledgedReceipt ? { acknowledgedReceipt } : {}),
      ...(stop && !LATEST_ONLY ? { stop } : {}) };
  };
  /** As the live route does: each acknowledgment is handed over when it is signed. One the ledger refuses is not retried. */
  live.collectAcknowledgments = async (attempt, records) => {
    let refused = 0;
    for (const acknowledgment of acksOf(records).filter(row => row.count > 0)) {
      const acknowledgedReceipt = receiptsOf(records, parties.stages.length - 1)
        .find(row => row.output?.count === acknowledgment.count && row.output.chain === acknowledgment.chain);
      live.clock = Date.parse(acknowledgment.signedAt) + 1;
      try { await live.ledger.collect(attempt.reservationId, { identity: attempt.identity, receipts: [], acknowledgment, ...(acknowledgedReceipt ? { acknowledgedReceipt } : {}) }); }
      catch { refused += 1; }
    }
    return refused;
  };
  live.close = async () => { try { live.ledger.close(); } finally { await rm(directory, { recursive: true, force: true }); } };
  return live;
}

const attempted = async work => { try { return { value: await work() }; } catch (error) { return { threw: String(error?.message ?? error).split('\n')[0].slice(0, 200) }; } };
const amountsOf = (credits, shares) => shares.map(share => (credits ?? []).filter(row => row.participantId === share.participantId).reduce((sum, row) => sum + row.amount, 0));

async function judge({ parties, base, variant, attempt }) {
  const shares = attempt.terms.shares, requesterId = parties.requester.peerId;
  const live = await openLive(parties, base.ownStage ?? null);
  let collected, final;
  try {
    const admitted = await attempted(async () => live.admit(attempt));
    if (admitted.threw) {
      return { base: base.name, variant: variant.name, ledger: { status: 'refused the reservation', charge: 0, credits: shares.map(() => 0), reason: admitted.threw, atCollect: null },
        replay: { status: 'not asked', charge: 0, credits: shares.map(() => 0), reason: null }, amountsAgree: true };
    }
    const refusedAcknowledgments = LATEST_ONLY ? 0 : await live.collectAcknowledgments(attempt, variant.records);
    // The ledger cannot hold a record before it was signed.
    live.clock = Math.max(T0 + 1, ...variant.records.map(row => Date.parse(row.signedAt))) + 1;
    const collectedAt = live.clock - T0;
    collected = await attempted(async () => { await live.ledger.fence(attempt.reservationId, requesterId); return live.ledger.collect(attempt.reservationId, live.evidence(attempt, variant.records)); });
    // Both are asked once the attempt is decided: after the deadline, the release window and the clock allowance.
    live.clock = live.closesAt + POLICY.maxClockSkewMs + 1;
    final = await attempted(() => live.ledger.recover(attempt.reservationId));
    const replayed = await replaySettlement({ records: variant.records, policies: [POLICY], at: attempt.closesAt + POLICY.maxClockSkewMs + 1, accountOf: id => live.accountOf.get(id) });
    const row = replayed.reservations.find(item => item.reservationId === attempt.reservationId && item.requesterId === requesterId) ?? null;
    const outcome = final.value ?? {};
    // A settled outcome carries its charge and credits and no status word.
    const ledger = { status: final.threw ? 'threw' : outcome.status ?? (Number.isSafeInteger(outcome.charge) ? 'settled' : 'none'), charge: outcome.charge ?? 0, credits: amountsOf(outcome.credits, shares),
      reason: final.threw ?? outcome.reason ?? null, atCollect: collected.threw ? `threw: ${collected.threw}` : collected.value?.status ?? null, collectedAtMs: collectedAt,
      refusedAcknowledgments };
    const replay = { status: row?.status ?? 'none', charge: row?.debit ?? 0, credits: amountsOf(row?.credits, shares), reason: row?.reason ?? null };
    return { base: base.name, variant: variant.name, ledger, replay,
      amountsAgree: ledger.charge === replay.charge && JSON.stringify(ledger.credits) === JSON.stringify(replay.credits) };
  } finally {
    await live.close();
  }
}

/**
 * One named cause per difference in amounts; the README explains each. Every case runs under the decided rules
 * (reploid.settlement-replay/v2, signed as the terms' unfinished-answer terms), where the ledger and the replay must
 * agree; the old known difference of the provider-loss-free terms cannot arise here.
 */
export const CAUSES = Object.freeze({
  failedClose: 'the stages closed as failed on their own: the ledger charges the acknowledged outputs, the replay charges nothing',
  lateInsideWindow: 'the last acknowledgment and the closes fall after the deadline, inside the release window: the ledger expires the hold, the replay charges the outputs acknowledged in time',
  pastCeiling: 'the answer ran past the signed output ceiling: the ledger refuses the receipts and expires the hold, the replay charges the ceiling'
});
function causeOf(line) {
  if (line.amountsAgree) return null;
  if (LATEST_ONLY && line.base.startsWith('requester signs a stop')) return 'the ledger was not handed the requester\'s stop';
  if (line.base.startsWith('stages close early on their own')) return CAUSES.failedClose;
  if (line.base.startsWith('last acknowledgment and closes')) return CAUSES.lateInsideWindow;
  if (line.base.startsWith('output ceiling')) return CAUSES.pastCeiling;
  return 'unclassified';
}

async function main() {
  const startedAt = new Date();
  const make = (algorithm, count) => Promise.all(Array.from({ length: count + 1 }, () => createSigningIdentity({ algorithm })))
    .then(([requester, ...stages]) => ({ requester, stages }));
  const two = await createParties(2), three = await createParties(3), curved = await make('ECDSA', 2);
  const lines = [];
  for (const [index, base] of BASES.entries()) {
    const parties = base.curve ? curved : base.stages === 3 ? three : two;
    // Every case gets its own attempt: a ledger takes a reservation ID once.
    const probe = await runAttempt(parties, { tag: `p${index}`, policy: POLICY, ...base.options });
    for (const [at, chosen] of variants(probe, parties.stages.length).entries()) {
      const attempt = await runAttempt(parties, { tag: `l${index}-${at}`, policy: POLICY, ...base.options });
      const variant = variants(attempt, parties.stages.length).find(item => item.name === chosen.name);
      const line = await judge({ parties, base, variant, attempt });
      lines.push({ ...line, cause: causeOf(line) });
    }
  }
  const differing = lines.filter(line => !line.amountsAgree), byCause = {};
  for (const line of differing) (byCause[line.cause] ??= []).push(`${line.base} | ${line.variant}`);
  const statusPairs = {};
  for (const line of lines) { const pair = `${line.ledger.status} / ${line.replay.status}`; statusPairs[pair] = (statusPairs[pair] ?? 0) + 1; }
  let commit = 'unknown', dirty = null;
  try {
    commit = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // The code this comparison runs: the ledger, the replay, the signers, the scenario builder and this file.
    dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'server/fleet', 'scripts/settlement/scenario.js',
      'scripts/settlement/independent/ledger-differential.js', 'packages/reploid/src'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* the receipt says unknown */ }
  const receipt = { schema: 'reploid.settlement-ledger-differential/v1', generatedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    command: 'node scripts/settlement/independent/ledger-differential.js --out scripts/settlement/independent/receipts/ledger-differential.json',
    commit, uncommittedChangesInComparedCode: dirty, node: process.version,
    note: 'All parties are simulated identities on one machine under one operator. The ledger is given each acknowledgment when it was signed, then what a live route retains (latest records and the signed stop) at the moment the last of them was signed, and asked again after the release window; the replay judges the same records after the window. Status pairs are ledger / replay.',
    policy: POLICY, handedToTheLedger: LATEST_ONLY ? 'the final collect only, no stop' : 'each acknowledgment as signed, then the final collect with the stop', cases: lines.length, amountsAgreed: lines.length - differing.length, statusPairs: Object.fromEntries(Object.entries(statusPairs).sort()),
    differences: { total: differing.length, byCause: Object.fromEntries(Object.entries(byCause).map(([cause, rows]) => [cause, { count: rows.length, cases: rows }])) },
    lines };
  const out = flag('out');
  if (out && out !== true) { const file = path.resolve(process.cwd(), out); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`); }
  console.log(JSON.stringify({ cases: receipt.cases, amountsAgreed: receipt.amountsAgreed, statusPairs: receipt.statusPairs }, null, 2));
  console.log(`\nDifferent amounts: ${differing.length}`);
  for (const [cause, rows] of Object.entries(byCause)) console.log(`  ${String(rows.length).padStart(3)}  ${cause}`);
  for (const line of lines) {
    if (line.amountsAgree && !flag('verbose')) continue;
    console.log(`${line.amountsAgree ? '  same' : 'DIFFER'} | ${line.base} | ${line.variant} | ledger ${line.ledger.status} ${line.ledger.charge} ${JSON.stringify(line.ledger.credits)} (${line.ledger.reason}; at collect: ${line.ledger.atCollect}) | replay ${line.replay.status} ${line.replay.charge} ${JSON.stringify(line.replay.credits)} (${line.replay.reason})`);
  }
}

await main();

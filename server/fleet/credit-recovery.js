import { createHash } from 'node:crypto';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { assert, same, FLEET_SERVICE_REQUEST_SCHEMA } from './contract.js';
import { verifyParticipantSignature } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import {
  decideFailedStages, deliveredWithoutCoveringReceipt, forfeitRules, observeFailedStageRules, ownStageOf, releaseWindowPassed, replayRules, stagesClosedAtLastStep,
  verifyClaimedFault, verifyCreditEvidence, verifyPartitionComponents, verifySplitStop
} from './credit-evidence.js';

/** Durable admission fences and independently verified proof components. No timeout asserts
 * remote cleanup. Deadline expiry only closes admission; an admitted owner must still sign. */
export function createCreditRecovery({ db, transaction, read, settle, post, enrollment, policy, now, holdAccount, maxUnacknowledgedOutputs }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fleet_admissions (request_id TEXT NOT NULL, stage INTEGER NOT NULL, PRIMARY KEY(request_id,stage));
    CREATE TABLE IF NOT EXISTS fleet_stage_owners (request_id TEXT NOT NULL, stage INTEGER NOT NULL, owner TEXT NOT NULL, closure TEXT, PRIMARY KEY(request_id,stage));
    CREATE TABLE IF NOT EXISTS fleet_components (request_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(request_id,kind));`);
  const admitted = id => db.prepare('SELECT stage FROM fleet_admissions WHERE request_id=?').all(id).map(row => row.stage);
  const pieces = id => Object.fromEntries(db.prepare('SELECT kind,payload FROM fleet_components WHERE request_id=?').all(id)
    .map(row => [row.kind, JSON.parse(row.payload)]));
  /** The receipts kept as the contradiction of a requester's own final stage: at most two, at one sequence. */
  const twinsOf = data => (data.twin === undefined ? [] : [data.twin].flat());
  const store = (id, key, value) => db.prepare('INSERT OR REPLACE INTO fleet_components VALUES (?,?,?)').run(id, key, JSON.stringify(value));
  /**
   * A stage contradicting itself (docs/settlement-replay.md, step 5): two different signed receipts of one stage that
   * repeat a sequence, have steps that go backwards, continue after a closing receipt, or give two chains for one count.
   * The replay calls the attempt a conflict and moves no credit, whatever order the receipts arrive in.
   */
  const contradicts = (held, receipt) => {
    const body = ({ publicJwk: _key, signature: _signature, ...rest }) => rest;
    if (!held || !receipt || held.partitionIndex !== receipt.partitionIndex || same(body(held), body(receipt))) return false;
    if (held.sequence === receipt.sequence) return true;
    const [earlier, later] = held.sequence < receipt.sequence ? [held, receipt] : [receipt, held];
    return later.steps < earlier.steps || (earlier.status !== 'executing' && earlier.timing.closedAt !== null)
      || Boolean(earlier.output && later.output && earlier.output.count === later.output.count && earlier.output.chain !== later.output.chain);
  };
  /** The contradictions the ledger kept for a request, one per stage: `{ partitionIndex, participantId, receipts: [held, other] }`. */
  const contradictionsOf = id => Object.entries(pieces(id)).filter(([key]) => key.startsWith('contradiction:')).map(([, value]) => value)
    .sort((a, b) => a.partitionIndex - b.partitionIndex);
  /**
   * Keeps the first contradiction of each stage among `receipts` and the receipts the ledger holds, as evidence. Under
   * the failed-stage rules the requester's own stage is left out: its contradiction blocks nobody, and its final stage's
   * is kept as `twin` instead. Runs inside the caller's transaction.
   */
  const keepContradictions = (id, binding, retained, receipts) => {
    const finalIndex = binding.providers.length - 1, own = ownStageOf(binding, enrollment);
    const seen = new Map();
    for (const receipt of receipts.filter(Boolean)) {
      const index = receipt.partitionIndex, key = `contradiction:${index}`;
      if (forfeitRules(binding) && own(index)) continue;
      const heldOf = seen.get(index) ?? [retained[`stage:${index}`], index === finalIndex ? retained.ack?.acknowledgedReceipt : null].filter(Boolean);
      seen.set(index, [...heldOf, receipt]);
      if (retained[key]) continue;
      const against = heldOf.find(held => contradicts(held, receipt));
      if (!against) continue;
      retained[key] = { partitionIndex: index, participantId: binding.providers[index].participantId, receipts: [against, receipt] };
      store(id, key, retained[key]);
    }
  };
  const unadmittedOf = id => {
    const row = read(id);
    // Old requests have no complete admission journal. Never infer zero work for those.
    return ['closing', 'settled'].includes(row?.state) && row.binding.admissionVersion === 1
      ? row.binding.providers.map((_, index) => index).filter(index => !admitted(id).includes(index)) : [];
  };
  const interruptedOf = id => db.prepare('SELECT stage,closure FROM fleet_stage_owners WHERE request_id=? AND closure IS NOT NULL').all(id)
    .map(row => ({ stage: row.stage, closure: JSON.parse(row.closure) }));
  /** Split request: the retained proof components and the stages that still owe signed completion. */
  const splitProgress = (id, request) => {
    const data = pieces(id), missing = unadmittedOf(id), interrupted = interruptedOf(id);
    const acknowledgedOutputTokens = data.ack?.acknowledgment.count ?? null;
    const stages = request.providers.map((_, index) => data[`stage:${index}`]);
    const awaitingStages = [];
    if (forfeitRules(request)) {
      // Failed-stage rules: a stage whose owner claimed an interruption has decided itself (it forfeits), so nobody
      // waits for it. Every other stage still owes a closing receipt that covers the acknowledged output.
      const decided = decideFailedStages(request, { receipts: stages.filter(Boolean), ...data.ack, twins: twinsOf(data) }, { claims: interrupted, unadmitted: missing, skew: policy.maxClockSkewMs,
        own: ownStageOf(request, enrollment) });
      awaitingStages.push(...[...decided.silent, ...decided.short].sort((a, b) => a - b));
      return { data, missing, interrupted, acknowledgedOutputTokens, stages, awaitingStages };
    }
    for (const [index, receipt] of stages.entries()) {
      if (!receipt && missing.includes(index) && (acknowledgedOutputTokens ?? 0) === 0) continue;
      const exited = interrupted.find(row => row.stage === index);
      if (exited && (exited.closure.payload.receipt?.steps ?? 0) >= (acknowledgedOutputTokens ?? 0)
        && (receipt?.steps ?? 0) >= (acknowledgedOutputTokens ?? 0)) continue;
      if (!receipt || receipt.status === 'executing' || receipt.timing.closedAt === null
        || receipt.steps < (acknowledgedOutputTokens ?? 0)) awaitingStages.push(index);
    }
    return { data, missing, interrupted, acknowledgedOutputTokens, stages, awaitingStages };
  };
  /** The observation and evidence for settling a delivered answer whose unclosed stages covered it; otherwise null.
   * The retained components were verified when they were collected. */
  const closedAtLastStepSettlement = (request, { data, stages, interrupted, awaitingStages }) => {
    if (!data.ack || interrupted.length) return null;
    const receipts = stages.filter(Boolean);
    const closedAtLastStep = stagesClosedAtLastStep(request, { receipts, ...data.ack }, policy.maxClockSkewMs);
    if (!closedAtLastStep || !same(closedAtLastStep, awaitingStages)) return null;
    const { acknowledgment } = data.ack;
    // The same ceiling as verifyCreditEvidence: outputs past the signed `maxOutputTokens` are recorded, never charged.
    const ceiling = replayRules(request) ? request.maxOutputTokens : Infinity, beyondCeiling = Math.max(0, acknowledgment.count - ceiling);
    return { evidence: { identity: request.route, receipts, ...data.ack, ...(data.stop ? { stop: data.stop } : {}), closedAtLastStep },
      observed: { outputTokens: Math.min(acknowledgment.count, ceiling), outputIdentity: acknowledgment.chain, closedAtLastStep,
        ...(beyondCeiling ? { beyondCeiling } : {}),
        workIds: request.providers.map((provider, index) => `stage:${provider.participantId}:${request.id}:${request.executionId}:${index}`) } };
  };
  /**
   * Failed-stage rules: the evidence and observation a split request settles on from its retained components, or null
   * when it cannot settle. `windowPassed` decides the stages that have neither closed nor been claimed: each is treated
   * as closed at its last signed step (a delivered answer its receipts cover) or forfeits with cause `no-close`. A
   * stage whose owner claimed an interruption forfeits at any time. Null when nothing was acknowledged and a stage has
   * not closed (the request expires, nobody is charged or paid), and when a stage that would be paid closed behind the
   * acknowledged output (the replay's conflict, which moves nothing). The retained components were verified when
   * they were collected.
   */
  const failedStageSettlement = (request, { data, stages, interrupted, missing }, windowPassed) => {
    if (!data.ack) return null;
    try {
      const receipts = stages.filter(Boolean), proof = { receipts, ...data.ack, twins: twinsOf(data) }, claims = interrupted, own = ownStageOf(request, enrollment);
      const decided = decideFailedStages(request, proof, { claims, unadmitted: missing, skew: policy.maxClockSkewMs, own });
      if (decided.short.length || decided.silent.length && !(windowPassed && data.ack.acknowledgment.count > 0)) return null;
      const stated = { ...(decided.closedAtLastStep.length ? { closedAtLastStep: decided.closedAtLastStep } : {}),
        ...(decided.forfeitedStages.length ? { forfeitedStages: decided.forfeitedStages } : {}) };
      const observed = observeFailedStageRules(request, proof, { claims, unadmitted: missing, stated, windowPassed, stop: data.stop ?? null,
        maxUnacknowledgedOutputs, skew: policy.maxClockSkewMs, own });
      return { observed, evidence: { identity: request.route, receipts, ...(claims.length ? { interruptedOwners: claims.map(row => row.closure) } : {}),
        ...data.ack, ...(data.stop ? { stop: data.stop } : {}), ...(twinsOf(data).length ? { finalStageTwin: twinsOf(data).length === 1 ? twinsOf(data)[0] : twinsOf(data) } : {}), ...stated } };
    } catch { return null; }
  };
  const expiry = () => transaction(() => {
    for (const row of db.prepare("SELECT id FROM fleet_requests WHERE state IN ('reserved','dispatched')").all()) {
      const request = read(row.id);
      if (now() < request.binding.deadline) continue;
      if (request.state === 'reserved') {
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.binding.maximum, holdAccount(request.binding));
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(row.id);
      } else db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=?").run(row.id);
    }
    // Bound on a whole-model hold whose provider never returned. The provider has the request deadline plus this
    // window to sign completion or cleanup evidence; after it the unused hold is released with no charge and no
    // credit, and a later claim for this request is refused. A ledger always runs with this window
    // (withCreditPolicyDefaults); a historical statement whose policy lacks it leaves such holds open.
    //
    // `partitionUnclaimedReleaseMs` is the same bound for a split request. A stage host that disappears
    // for good would otherwise strand the hold forever, because settlement needs every stage's signed closure.
    // After the window the request reaches one final outcome: expired, no charge, no credit to any stage. The
    // outcome names the stages that never signed and reports their cleanup as unverified: nothing here asserts
    // what a silent host did. A request whose proof is already complete is left for recover() to settle.
    //
    // One exception, the settlement replay's closing rule: when the final stage signed `done` at N, the requester
    // acknowledged N in time, and each stage that never closed signed in-time step receipts covering all N steps,
    // those stages are treated as closed at their last signed step and every stage is paid its share
    // (stagesClosedAtLastStep). One stage withholding its closing receipt cannot veto the others' payment. An answer
    // that did not finish never qualifies and still expires with no charge.
    //
    // Under the failed-stage rules (SETTLEMENT_RULES) a stage that never closed no longer makes the answer free. When
    // output was acknowledged, the request settles at the window: each stage with no closing receipt is treated as
    // closed at its last signed step as above, or forfeits its own share, and every other stage is paid
    // (failedStageSettlement). With nothing acknowledged it expires with no charge, as before.
    for (const row of db.prepare("SELECT id FROM fleet_requests WHERE state='closing'").all()) {
      const request = read(row.id), split = request.binding.mode !== 'whole-model';
      const window = split ? policy.partitionUnclaimedReleaseMs : policy.wholeModelUnclaimedReleaseMs;
      // Under the interim split rules the window passes only after the clock allowance too: a closing receipt signed
      // up to deadline + window + allowance still counts (releaseWindowPassed).
      if (!Number.isSafeInteger(window) || !(split ? releaseWindowPassed(request.binding, now(), window, policy.maxClockSkewMs)
        : now() >= request.binding.deadline + window)) continue;
      let outcome = { id: row.id, unit: policy.unit, charge: 0, ownComputeUnits: 0, outputTokens: 0, status: 'expired', usage: null,
        reason: 'provider-unclaimed-after-window', credits: [], evidenceHash: null, economicHash: null, settledAt: now() };
      const contradictions = split ? contradictionsOf(row.id) : [];
      if (contradictions.length) {
        // The replay's conflict: a stage signed incompatible receipts, so nobody is charged or paid, and the receipts are
        // kept in the outcome as the evidence that names it (docs/settlement-replay.md, "Who bears a conflict").
        outcome = { ...outcome, reason: 'stage-contradicted-itself', contradictions };
      } else if (split) {
        const progress = splitProgress(row.id, request.binding);
        if (progress.acknowledgedOutputTokens !== null && progress.awaitingStages.length === 0) continue;
        const failedStages = forfeitRules(request.binding);
        const delivered = failedStages ? failedStageSettlement(request.binding, progress, true) : closedAtLastStepSettlement(request.binding, progress);
        if (delivered) { post(row.id, delivered.observed, delivered.evidence); continue; }
        const unsigned = progress.stages.map((receipt, index) => (!receipt || receipt.status === 'executing' || receipt.timing.closedAt === null
          || progress.awaitingStages.includes(index)) ? index : null).filter(index => index !== null);
        // A delivered answer that some stage has no receipt covering is the replay's `unknown`: nothing moves either way,
        // and the outcome names it rather than calling it an unclaimed stage.
        // (Under the failed-stage rules such a stage forfeits and the answer settled above.)
        const undecided = !failedStages && Boolean(progress.data.ack) && deliveredWithoutCoveringReceipt(request.binding,
          { receipts: progress.stages.filter(Boolean), ...progress.data.ack }, policy.maxClockSkewMs);
        outcome = { ...outcome, reason: undecided ? 'unknown-delivered-answer-without-covering-receipt' : 'stage-unclaimed-after-window',
          acknowledgedOutputTokens: progress.acknowledgedOutputTokens,
          unclaimedStages: unsigned.map(stage => ({ stage, participantId: request.binding.providers[stage].participantId,
            cleanup: progress.missing.includes(stage) ? 'never-admitted' : 'unverified' })) };
      }
      db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.binding.maximum, holdAccount(request.binding));
      db.prepare("UPDATE fleet_requests SET state='settled',outcome=? WHERE id=?").run(JSON.stringify(outcome), row.id);
    }
  });
  return {
    expire: expiry,
    unadmitted: unadmittedOf,
    interrupted: interruptedOf,
    contradictions: contradictionsOf,
    async closeStageOwner(envelope) {
      expiry();
      const { signature, ...signed } = envelope;
      const { id, partitionIndex: stage, owner, receipt } = signed.payload;
      const enrolled = enrollment.byPeer.get(signed.participantId);
      assert(signed.schema === FLEET_SERVICE_REQUEST_SCHEMA && signed.operation === 'closeStageOwner'
        && Number.isSafeInteger(signed.at) && Math.abs(now() - signed.at) <= policy.maxClockSkewMs
        && enrolled && await verifyParticipantSignature(enrolled.publicJwk, FLEET_SERVICE_REQUEST_SCHEMA, signed, signature),
      'Enrolled stage owner signature required');
      // The claim may carry one more member, `fault`: the stage's signed fault record (settlement-terms.js), kept with
      // the claim so that the settlement replay can reach the ledger's result from records alone.
      const { fault } = signed.payload, withFault = Object.hasOwn(signed.payload, 'fault');
      assert(Object.keys(signed.payload).length === (withFault ? 5 : 4) && typeof id === 'string' && id.length <= 160
        && typeof owner === 'string' && /^[a-f0-9]{64}$/.test(owner) && Number.isSafeInteger(stage) && stage >= 0,
      'Malformed stage owner closure');
      const row = read(id);
      assert(row?.binding.mode === 'partition' && row.binding.providers[stage]?.participantId === envelope.participantId,
        'Unmatched partition stage owner');
      assert(row.state !== 'settled' || row.outcome?.status !== 'expired', 'Claim window closed; this hold was released unclaimed');
      assert(receipt === null || receipt?.partitionIndex === stage && receipt.status === 'executing', 'Invalid recovered step checkpoint');
      if (receipt) await verifyPartitionComponents(row.binding, { identity: row.binding.route, receipts: [receipt] }, enrollment, now(), policy.maxClockSkewMs);
      // Under the failed-stage rules, while the request is undecided, a fault the replay would call late is refused:
      // the stage is then decided at the window like any stage that did not close, in the ledger as in the replay.
      if (withFault) {
        await verifyClaimedFault(row.binding, stage, fault, enrollment, now(), policy.maxClockSkewMs, forfeitRules(row.binding) && row.state !== 'settled'
          ? { closesBy: row.binding.deadline + policy.partitionUnclaimedReleaseMs + policy.maxClockSkewMs } : {});
      }
      const result = transaction(() => {
        const owned = db.prepare('SELECT owner,closure FROM fleet_stage_owners WHERE request_id=? AND stage=?').get(id, stage);
        if (owned) assert(owned.owner === owner, 'Another process owns the stage admission');
        else assert(!admitted(id).includes(stage), 'Historical admission has no matching exclusive owner');
        if (owned?.closure) {
          // The same claim again. It may be repeated with or without its fault record (a host that restarted on
          // other software); the claim first recorded stands.
          const claimed = ({ fault: _fault, ...payload }) => payload;
          assert(same(claimed(JSON.parse(owned.closure).payload), claimed(signed.payload)), 'Conflicting interrupted stage checkpoint');
          return 'closed';
        }
        // Fence even if the earlier HTTP admission is still in flight. A late packet cannot reopen this stage.
        db.prepare('INSERT INTO fleet_stage_owners VALUES (?,?,?,?) ON CONFLICT(request_id,stage) DO UPDATE SET closure=excluded.closure')
          .run(id, stage, owner, JSON.stringify(envelope));
        const retained = pieces(id), prior = retained[`stage:${stage}`];
        keepContradictions(id, row.binding, retained, [receipt]);
        if (receipt && !retained[`contradiction:${stage}`] && (!prior || prior.status === 'executing' && receipt.sequence > prior.sequence)) store(id, `stage:${stage}`, receipt);
        return 'closed';
      });
      const outcome = await this.recover(id);
      return { stageOwner: result, outcome };
    },
    admit(id, stage, owner = null) {
      return transaction(() => {
        const row = read(id);
        assert(row?.state === 'dispatched' && now() <= row.binding.deadline, 'Credit admission is closed');
        const prior = db.prepare('SELECT owner,closure FROM fleet_stage_owners WHERE request_id=? AND stage=?').get(id, stage);
        if (prior) assert(!prior.closure && prior.owner === owner, 'Different or closed stage process owner');
        else if (owner !== null) {
          assert(!admitted(id).includes(stage), 'Historical stage admission cannot be adopted');
          db.prepare('INSERT INTO fleet_stage_owners VALUES (?,?,?,NULL)').run(id, stage, owner);
        }
        db.prepare('INSERT OR IGNORE INTO fleet_admissions VALUES (?,?)').run(id, stage);
      });
    },
    async collect(id, evidence) {
      expiry();
      const row = read(id); assert(row, 'Unknown credit reservation');
      assert(row.state !== 'settled' || row.outcome?.status !== 'expired', 'Claim window closed; this hold was released unclaimed');
      if (row.binding.mode === 'whole-model') {
        assert(evidence?.terminal, 'Whole-model terminal cleanup required');
        await verifyCreditEvidence(row.binding, evidence.terminal, enrollment, now(), policy.maxClockSkewMs);
        if (row.state === 'settled') return settle(id, evidence.terminal);
        transaction(() => {
          const prior = pieces(id).terminal;
          assert(!prior || prior.status === evidence.terminal.status, 'Conflicting terminal cleanup');
          if (!prior) store(id, 'terminal', evidence.terminal);
          db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=? AND state='dispatched'").run(id);
        });
        return this.recover(id);
      }
      const proof = await verifyPartitionComponents(row.binding, evidence, enrollment, now(), policy.maxClockSkewMs);
      // The requester's own signed stop (settlement-terms.js), retained so the ledger can tell a requester that ended
      // the answer (it owes the acknowledged prefix) from a stage that ended it (nobody is charged). A late stop is ignored.
      const stop = replayRules(row.binding) && evidence.stop != null
        ? await verifySplitStop(row.binding, evidence.stop, enrollment, now(), policy.maxClockSkewMs) : null;
      if (proof.acknowledgment?.count > 0 && !proof.acknowledgedReceipt) {
        proof.acknowledgedReceipt = proof.receipts.find(receipt => receipt.partitionIndex === row.binding.providers.length - 1
          && receipt.output?.count === proof.acknowledgment.count && receipt.output.chain === proof.acknowledgment.chain);
        // Failed-stage rules, final stage on the requester's own account: the requester signed both sides, so its own
        // signed acknowledgment counts by itself and any participant of the request may hand it in. It was verified
        // above against the requester's enrolled key and this reservation, attempt and route. Keeping back the final
        // stage's receipts then no longer leaves nothing acknowledged (docs/settlement-replay.md, step 5).
        const ownFinal = forfeitRules(row.binding) && ownStageOf(row.binding, enrollment)(row.binding.providers.length - 1);
        assert(proof.acknowledgedReceipt || ownFinal, 'Acknowledgment needs its signed output prefix');
      }
      if (row.state === 'settled') {
        assert(row.outcome.status !== 'expired', 'Claim window closed; this hold was released unclaimed');
        const ack = proof.acknowledgment;
        assert(!ack || ack.count <= row.outcome.outputTokens, 'Conflicting completed evidence');
        if (ack?.count === row.outcome.outputTokens && row.evidence?.acknowledgment) {
          assert(ack.chain === row.evidence.acknowledgment.chain, 'Conflicting completed evidence');
        }
        return row.outcome;
      }
      transaction(() => {
        const retained = pieces(id), finalIndex = row.binding.providers.length - 1;
        // Failed-stage rules, final stage on the requester's own account: a different signed receipt at the sequence of
        // one the ledger holds, or one that contradicts its close, is that stage contradicting itself. The ledger keeps
        // one stage receipt, so it keeps the other as `twin` (the receipts at the highest such sequence, at most two):
        // how the answer ended is then read as the replay reads it (decideFailedStages).
        const keepsTwin = forfeitRules(row.binding) && ownStageOf(row.binding, enrollment)(finalIndex);
        const keepTwin = receipt => {
          const twins = twinsOf(retained), top = Math.max(-1, ...twins.map(item => item.sequence));
          if (receipt.sequence < top || twins.some(item => same(item, receipt)) || receipt.sequence === top && twins.length >= 2) return;
          retained.twin = receipt.sequence > top ? receipt : [...twins, receipt];
          store(id, 'twin', retained.twin);
        };
        const noteTwin = (held, receipt) => {
          if (keepsTwin && held && receipt && held.partitionIndex === finalIndex && held.sequence === receipt.sequence && !same(held, receipt)) keepTwin(held);
        };
        // A stage's receipts that contradict each other, late ones included, are kept whatever order they arrive in; the
        // contradicted stage's receipt is then left as it is.
        keepContradictions(id, row.binding, retained, [...proof.receipts, ...proof.late, proof.acknowledgedReceipt]);
        for (const receipt of proof.receipts) {
          const key = `stage:${receipt.partitionIndex}`, prior = retained[key];
          if (retained[`contradiction:${receipt.partitionIndex}`]) continue;
          if (prior && prior.sequence > receipt.sequence) continue;
          if (prior && prior.status !== 'executing') {
            const semantic = ({ signature: _signature, publicJwk: _key, signedAt: _at, ...body }) => body;
            if (!same(semantic(prior), semantic(receipt))) {
              // Its own final stage's close stands; a receipt that says something else is kept as its contradiction.
              assert(keepsTwin && receipt.partitionIndex === finalIndex, 'Conflicting stage closure');
              keepTwin(receipt);
              continue;
            }
          }
          noteTwin(prior, receipt);
          store(id, key, receipt);
        }
        noteTwin(retained.ack?.acknowledgedReceipt, proof.acknowledgedReceipt);
        // A late step receipt is not kept as the stage's receipt. One that differs from a receipt the ledger holds of
        // its own final stage at that sequence is still that stage's contradiction, as in the replay.
        for (const receipt of keepsTwin ? proof.late.filter(item => item.partitionIndex === finalIndex) : []) {
          const kept = pieces(id), differs = held => held && held.sequence === receipt.sequence && !same(held, receipt);
          if ([kept[`stage:${finalIndex}`], kept.ack?.acknowledgedReceipt, proof.acknowledgedReceipt].some(differs)) keepTwin(receipt);
        }
        if (stop && !retained.stop) store(id, 'stop', stop);
        const ack = proof.acknowledgment, prior = retained.ack?.acknowledgment;
        if (ack && (!prior || ack.count >= prior.count)) {
          assert(!prior || ack.count !== prior.count || ack.chain === prior.chain, 'Conflicting acknowledged output');
          // Failed-stage rules: an acknowledgment handed in again without its receipt never replaces the pair already
          // kept. Earlier rules keep the last one handed in, as they did when their reservations were made.
          if (!forfeitRules(row.binding) || !prior || ack.count > prior.count || proof.acknowledgedReceipt) store(id, 'ack', { acknowledgment: ack,
            acknowledgedReceipt: forfeitRules(row.binding) ? proof.acknowledgedReceipt ?? undefined : proof.acknowledgedReceipt });
        }
      });
      return this.recover(id);
    },
    fence(id, consumer) {
      transaction(() => {
        const row = read(id); assert(row?.binding.consumer === consumer, 'Reservation consumer differs');
        if (row.state === 'dispatched') db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=?").run(id);
      });
      return this.recover(id);
    },
    async recoverFor(participant) {
      const ids = db.prepare("SELECT id FROM fleet_requests WHERE state IN ('reserved','dispatched','closing')").all()
        .filter(row => { const request = read(row.id).binding; return request.consumer === participant
          || request.providers.some(provider => provider.participantId === participant); });
      const results = [];
      for (const { id } of ids) { const result = await this.recover(id); if (result.status !== 'pending') results.push(result); }
      return results;
    },
    providerOpenRequests(participant) {
      expiry();
      return db.prepare("SELECT id FROM fleet_requests WHERE state IN ('dispatched','closing')").all()
        .map(row => read(row.id))
        .filter(row => row?.binding.mode === 'whole-model'
          && row.binding.providers[0]?.participantId === participant
          && !pieces(row.id).terminal)
        .map(row => ({ id: row.id, binding: row.binding }));
    },
    async reconcileConsumer(consumer, activeIds = []) {
      assert(Array.isArray(activeIds) && activeIds.length <= 1024 && activeIds.every(id => typeof id === 'string' && id.length <= 512),
        'Active reservation list must be bounded text IDs');
      expiry();
      const activeSet = new Set(activeIds);
      const abandonedResults = [];
      const toRecover = transaction(() => {
        const rows = db.prepare("SELECT id FROM fleet_requests WHERE state IN ('reserved','dispatched','closing')").all();
        const pendingIds = [];
        for (const { id } of rows) {
          if (activeSet.has(id)) continue;
          const current = read(id);
          if (!current || current.binding.consumer !== consumer) continue;
          if (current.state === 'reserved') {
            db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(current.binding.maximum, holdAccount(current.binding));
            db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(id);
            abandonedResults.push({ id, status: 'abandoned', charge: 0, outputTokens: 0, settledAt: now() });
            continue;
          }
          if (current.state === 'dispatched') {
            db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=?").run(id);
          }
          pendingIds.push(id);
        }
        return pendingIds;
      });
      const results = [...abandonedResults];
      for (const id of toRecover) {
        const result = await this.recover(id);
        if (result.status !== 'pending') results.push(result);
      }
      return results;
    },
    async recover(id) {
      expiry();
      const row = read(id); assert(row, 'Unknown credit reservation');
      if (row.state === 'settled') return row.outcome;
      if (row.state === 'abandoned') return { id, status: 'abandoned' };
      // A stage that contradicted itself: nothing settles on it (the replay's conflict). The hold is released, uncharged,
      // once the release window has passed (expiry).
      const contradicted = row.binding.mode === 'partition' ? contradictionsOf(id).map(item => item.partitionIndex) : [];
      const named = contradicted.length ? { contradictedStages: contradicted } : {};
      if (row.state !== 'closing') return { id, status: 'pending', ...named };
      const data = pieces(id), missing = this.unadmitted(id), request = row.binding;
      if (request.mode === 'whole-model') {
        if (data.terminal && request.terminalCharge != null) return settle(id, data.terminal);
        if (missing.length !== request.providers.length) return { id, status: 'pending' };
        // No provider could have started: admission was fenced in the same SQLite journal.
        return transaction(() => {
          const current = read(id); if (current.state === 'settled') return current.outcome;
          const outcome = { id, unit: policy.unit, charge: 0, ownComputeUnits: 0, outputTokens: 0, credits: [],
            evidenceHash: createHash('sha256').update(canonicalize({ id, unadmitted: missing })).digest('hex'), settledAt: now() };
          db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.maximum, holdAccount(request));
          db.prepare("UPDATE fleet_requests SET state='settled',outcome=? WHERE id=?").run(JSON.stringify(outcome), id);
          return outcome;
        });
      }
      const progress = splitProgress(id, request), { acknowledgedOutputTokens, stages, interrupted, awaitingStages } = progress;
      if (contradicted.length) return { id, status: 'pending', heldCredits: request.maximum, acknowledgedOutputTokens, awaitingStages, ...named };
      if (acknowledgedOutputTokens === null || awaitingStages.length) {
        return { id, status: 'pending', heldCredits: request.maximum, acknowledgedOutputTokens, awaitingStages };
      }
      // Failed-stage rules: every stage has closed or been claimed by its owner, so the claimed stages forfeit and the
      // rest are paid; the evidence names the forfeiting stages.
      const decided = forfeitRules(request) ? failedStageSettlement(request, progress, false) : null;
      return settle(id, decided?.evidence ?? { identity: request.route, receipts: stages.filter(Boolean),
        ...(interrupted.length ? { interruptedOwners: interrupted.map(row => row.closure) } : {}), ...data.ack, ...(data.stop ? { stop: data.stop } : {}) });
    }
  };
}

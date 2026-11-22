import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { assert, same, FLEET_SERVICE_REQUEST_SCHEMA } from './contract.js';
import { verifyParticipantSignature } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { verifyCreditEvidence, verifyPartitionComponents } from './credit-evidence.js';

/** Durable admission fences and independently verified proof components. No timeout asserts
 * remote cleanup. Deadline expiry only closes admission; an admitted owner must still sign. */
export function createCreditRecovery({ db, transaction, read, settle, enrollment, policy, now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fleet_admissions (request_id TEXT NOT NULL, stage INTEGER NOT NULL, PRIMARY KEY(request_id,stage));
    CREATE TABLE IF NOT EXISTS fleet_stage_owners (request_id TEXT NOT NULL, stage INTEGER NOT NULL, owner TEXT NOT NULL, closure TEXT, PRIMARY KEY(request_id,stage));
    CREATE TABLE IF NOT EXISTS fleet_components (request_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(request_id,kind));`);
  const admitted = id => db.prepare('SELECT stage FROM fleet_admissions WHERE request_id=?').all(id).map(row => row.stage);
  const pieces = id => Object.fromEntries(db.prepare('SELECT kind,payload FROM fleet_components WHERE request_id=?').all(id)
    .map(row => [row.kind, JSON.parse(row.payload)]));
  const store = (id, key, value) => db.prepare('INSERT OR REPLACE INTO fleet_components VALUES (?,?,?)').run(id, key, JSON.stringify(value));
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
  const expiry = () => transaction(() => {
    for (const row of db.prepare("SELECT id FROM fleet_requests WHERE state IN ('reserved','dispatched')").all()) {
      const request = read(row.id);
      if (now() < request.binding.deadline) continue;
      if (request.state === 'reserved') {
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.binding.maximum, request.binding.computerId);
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(row.id);
      } else db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=?").run(row.id);
    }
    // Opt-in bound on a whole-model hold whose provider never returned. The provider has the request deadline
    // plus this window to sign completion or cleanup evidence; after it the unused hold is released with no
    // charge and no credit, and a later claim for this request is refused. Absent, such a hold stays open.
    //
    // `partitionUnclaimedReleaseMs` is the same opt-in bound for a split request. A stage host that disappears
    // for good would otherwise strand the hold forever, because settlement needs every stage's signed closure.
    // After the window the request reaches one final outcome: expired, no charge, no credit to any stage. The
    // outcome names the stages that never signed and reports their cleanup as unverified: nothing here asserts
    // what a silent host did. A request whose proof is already complete is left for recover() to settle.
    for (const row of db.prepare("SELECT id FROM fleet_requests WHERE state='closing'").all()) {
      const request = read(row.id), split = request.binding.mode !== 'whole-model';
      const window = split ? policy.partitionUnclaimedReleaseMs : policy.wholeModelUnclaimedReleaseMs;
      if (!Number.isSafeInteger(window) || now() < request.binding.deadline + window) continue;
      let outcome = { id: row.id, unit: policy.unit, charge: 0, ownComputeUnits: 0, outputTokens: 0, status: 'expired', usage: null,
        reason: 'provider-unclaimed-after-window', credits: [], evidenceHash: null, economicHash: null, settledAt: now() };
      if (split) {
        const progress = splitProgress(row.id, request.binding);
        if (progress.acknowledgedOutputTokens !== null && progress.awaitingStages.length === 0) continue;
        const unsigned = progress.stages.map((receipt, index) => (!receipt || receipt.status === 'executing' || receipt.timing.closedAt === null
          || progress.awaitingStages.includes(index)) ? index : null).filter(index => index !== null);
        outcome = { ...outcome, reason: 'stage-unclaimed-after-window', acknowledgedOutputTokens: progress.acknowledgedOutputTokens,
          unclaimedStages: unsigned.map(stage => ({ stage, participantId: request.binding.providers[stage].participantId,
            cleanup: progress.missing.includes(stage) ? 'never-admitted' : 'unverified' })) };
      }
      db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.binding.maximum, request.binding.computerId);
      db.prepare("UPDATE fleet_requests SET state='settled',outcome=? WHERE id=?").run(JSON.stringify(outcome), row.id);
    }
  });
  return {
    expire: expiry,
    unadmitted: unadmittedOf,
    interrupted: interruptedOf,
    async closeStageOwner(envelope) {
      const { signature, ...signed } = envelope;
      const { id, partitionIndex: stage, owner, receipt } = signed.payload;
      const enrolled = enrollment.byPeer.get(signed.participantId);
      assert(signed.schema === FLEET_SERVICE_REQUEST_SCHEMA && signed.operation === 'closeStageOwner'
        && Number.isSafeInteger(signed.at) && Math.abs(now() - signed.at) <= policy.maxClockSkewMs
        && enrolled && await verifyParticipantSignature(enrolled.publicJwk, FLEET_SERVICE_REQUEST_SCHEMA, signed, signature),
      'Enrolled stage owner signature required');
      assert(Object.keys(signed.payload).length === 4 && typeof id === 'string' && id.length <= 160
        && typeof owner === 'string' && /^[a-f0-9]{64}$/.test(owner) && Number.isSafeInteger(stage) && stage >= 0,
      'Malformed stage owner closure');
      const row = read(id);
      assert(row?.binding.mode === 'partition' && row.binding.providers[stage]?.participantId === envelope.participantId,
        'Unmatched partition stage owner');
      assert(receipt === null || receipt?.partitionIndex === stage && receipt.status === 'executing', 'Invalid recovered step checkpoint');
      if (receipt) await verifyPartitionComponents(row.binding, { identity: row.binding.route, receipts: [receipt] }, enrollment, now(), policy.maxClockSkewMs);
      const result = transaction(() => {
        const owned = db.prepare('SELECT owner,closure FROM fleet_stage_owners WHERE request_id=? AND stage=?').get(id, stage);
        if (owned) assert(owned.owner === owner, 'Another process owns the stage admission');
        else assert(!admitted(id).includes(stage), 'Historical admission has no matching exclusive owner');
        if (owned?.closure) {
          assert(same(JSON.parse(owned.closure).payload, signed.payload), 'Conflicting interrupted stage checkpoint');
          return 'closed';
        }
        // Fence even if the earlier HTTP admission is still in flight. A late packet cannot reopen this stage.
        db.prepare('INSERT INTO fleet_stage_owners VALUES (?,?,?,?) ON CONFLICT(request_id,stage) DO UPDATE SET closure=excluded.closure')
          .run(id, stage, owner, JSON.stringify(envelope));
        const prior = pieces(id)[`stage:${stage}`];
        if (receipt && (!prior || prior.status === 'executing' && receipt.sequence > prior.sequence)) store(id, `stage:${stage}`, receipt);
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
      const row = read(id); assert(row, 'Unknown credit reservation');
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
      if (proof.acknowledgment?.count > 0 && !proof.acknowledgedReceipt) {
        proof.acknowledgedReceipt = proof.receipts.find(receipt => receipt.partitionIndex === row.binding.providers.length - 1
          && receipt.output?.count === proof.acknowledgment.count && receipt.output.chain === proof.acknowledgment.chain);
        assert(proof.acknowledgedReceipt, 'Acknowledgment needs its signed output prefix');
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
        const retained = pieces(id);
        for (const receipt of proof.receipts) {
          const key = `stage:${receipt.partitionIndex}`, prior = retained[key];
          if (prior && prior.sequence > receipt.sequence) continue;
          if (prior && prior.status !== 'executing') {
            const semantic = ({ signature: _signature, publicJwk: _key, signedAt: _at, ...body }) => body;
            assert(same(semantic(prior), semantic(receipt)), 'Conflicting stage closure');
          }
          store(id, key, receipt);
        }
        const ack = proof.acknowledgment, prior = retained.ack?.acknowledgment;
        if (ack && (!prior || ack.count >= prior.count)) {
          assert(!prior || ack.count !== prior.count || ack.chain === prior.chain, 'Conflicting acknowledged output');
          store(id, 'ack', { acknowledgment: ack, acknowledgedReceipt: proof.acknowledgedReceipt });
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
            db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(current.binding.maximum, current.binding.computerId);
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
      if (row.state !== 'closing') return { id, status: 'pending' };
      const data = pieces(id), missing = this.unadmitted(id), request = row.binding;
      if (request.mode === 'whole-model') {
        if (data.terminal && request.terminalCharge != null) return settle(id, data.terminal);
        if (missing.length !== request.providers.length) return { id, status: 'pending' };
        // No provider could have started: admission was fenced in the same SQLite journal.
        return transaction(() => {
          const current = read(id); if (current.state === 'settled') return current.outcome;
          const outcome = { id, unit: policy.unit, charge: 0, ownComputeUnits: 0, outputTokens: 0, credits: [],
            evidenceHash: createHash('sha256').update(canonicalize({ id, unadmitted: missing })).digest('hex'), settledAt: now() };
          db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.maximum, request.computerId);
          db.prepare("UPDATE fleet_requests SET state='settled',outcome=? WHERE id=?").run(JSON.stringify(outcome), id);
          return outcome;
        });
      }
      const { acknowledgedOutputTokens, stages, interrupted, awaitingStages } = splitProgress(id, request);
      if (acknowledgedOutputTokens === null || awaitingStages.length) {
        return { id, status: 'pending', heldCredits: request.maximum, acknowledgedOutputTokens, awaitingStages };
      }
      return settle(id, { identity: request.route, receipts: stages.filter(Boolean), ...(interrupted.length ? { interruptedOwners: interrupted.map(row => row.closure) } : {}), ...data.ack });
    }
  };
}

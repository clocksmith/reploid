import { createHash } from 'node:crypto';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { assert, same } from './contract.js';
import { verifyCreditEvidence, verifyPartitionComponents } from './credit-evidence.js';

/** Durable admission fences and independently verified proof components. No timeout asserts
 * remote cleanup. Deadline expiry only closes admission; an admitted owner must still sign. */
export function createCreditRecovery({ db, transaction, read, settle, enrollment, policy, now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS fleet_admissions (request_id TEXT NOT NULL, stage INTEGER NOT NULL, PRIMARY KEY(request_id,stage));
    CREATE TABLE IF NOT EXISTS fleet_components (request_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(request_id,kind));`);
  const admitted = id => db.prepare('SELECT stage FROM fleet_admissions WHERE request_id=?').all(id).map(row => row.stage);
  const pieces = id => Object.fromEntries(db.prepare('SELECT kind,payload FROM fleet_components WHERE request_id=?').all(id)
    .map(row => [row.kind, JSON.parse(row.payload)]));
  const store = (id, key, value) => db.prepare('INSERT OR REPLACE INTO fleet_components VALUES (?,?,?)').run(id, key, JSON.stringify(value));
  const expiry = () => transaction(() => {
    for (const row of db.prepare("SELECT id FROM fleet_requests WHERE state IN ('reserved','dispatched')").all()) {
      const request = read(row.id);
      if (now() < request.binding.deadline) continue;
      if (request.state === 'reserved') {
        db.prepare('UPDATE fleet_accounts SET held=held-? WHERE id=?').run(request.binding.maximum, request.binding.computerId);
        db.prepare("UPDATE fleet_requests SET state='abandoned' WHERE id=?").run(row.id);
      } else db.prepare("UPDATE fleet_requests SET state='closing' WHERE id=?").run(row.id);
    }
  });
  return {
    expire: expiry,
    unadmitted(id) {
      const row = read(id);
      // Old requests have no complete admission journal. Never infer zero work for those.
      return ['closing', 'settled'].includes(row?.state) && row.binding.admissionVersion === 1
        ? row.binding.providers.map((_, index) => index).filter(index => !admitted(id).includes(index)) : [];
    },
    admit(id, stage) {
      return transaction(() => {
        const row = read(id);
        assert(row?.state === 'dispatched' && now() <= row.binding.deadline, 'Credit admission is closed');
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
      if (!data.ack) return { id, status: 'pending' };
      const receipts = request.providers.map((_, index) => data[`stage:${index}`]).filter(Boolean);
      for (let index = 0; index < request.providers.length; index++) {
        const receipt = receipts.find(value => value.partitionIndex === index);
        if (!receipt && missing.includes(index) && data.ack.acknowledgment.count === 0) continue;
        if (!receipt || receipt.status === 'executing' || receipt.timing.closedAt === null
          || receipt.steps < data.ack.acknowledgment.count) return { id, status: 'pending' };
      }
      return settle(id, { identity: request.route, receipts, ...data.ack });
    }
  };
}

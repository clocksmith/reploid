// Durable ownership of this host's admitted stages. SQLite holds an OS-backed exclusive lock
// across commits. Never infer ownership or output counts by enumerating an enrollment key's jobs.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { assert, same } from './contract.js';

async function processLocation() {
  if (process.platform !== 'linux') return { pid: process.pid };
  try {
    const stat = await fs.readFile('/proc/self/stat', 'utf8');
    return { pid: process.pid, birth: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
      boot: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      namespace: await fs.readlink('/proc/self/ns/pid') };
  } catch {
    // A restricted procfs can still serve and cleanly settle. Preserve uncertainty after a crash.
    return { pid: process.pid, unknownLinuxNamespace: true };
  }
}

async function predecessorExited(prior, current) {
  if (prior.unknownLinuxNamespace || current.unknownLinuxNamespace) return false;
  if (prior.boot && current.boot) {
    if (prior.boot !== current.boot) return true;
    if (prior.namespace !== current.namespace) return false;
    try {
      const stat = await fs.readFile('/proc/' + prior.pid + '/stat', 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== prior.birth;
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
  }
  try { process.kill(prior.pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

export async function openStageOwner({ file, participantId, roomId, serviceUrl }) {
  assert(path.isAbsolute(file), 'Absolute stage-owner journal required');
  const handle = await fs.open(file, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  let stat;
  try {
    stat = await handle.stat({ bigint: true });
    assert(stat.isFile() && (!process.getuid || stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n),
      'Stage-owner journal must be a private regular file');
  } finally { await handle.close(); }
  const processOwner = await processLocation();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  const epoch = randomUUID();
  // A copied journal is evidence for inspection. It cannot fence the original filesystem owner.
  const scope = { participantId, roomId, serviceUrl, host: os.hostname(), device: String(stat.dev), inode: String(stat.ino) };
  try {
    db.exec(`PRAGMA busy_timeout=0; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE;
      CREATE TABLE IF NOT EXISTS owner_scope (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work (id TEXT NOT NULL, stage INTEGER NOT NULL, epoch TEXT NOT NULL, owner TEXT NOT NULL, process_owner TEXT NOT NULL,
        checkpoint TEXT, terminal TEXT, PRIMARY KEY(id,stage)); COMMIT;`);
    const prior = db.prepare('SELECT value FROM owner_scope WHERE id=1').get();
    if (prior) assert(same(JSON.parse(prior.value), scope), 'Stage-owner journal was moved or belongs to another scope');
    else db.prepare('INSERT INTO owner_scope VALUES(1,?)').run(JSON.stringify(scope));
  } catch (error) { db.close(); throw error; }
  const row = (id, stage) => db.prepare('SELECT * FROM work WHERE id=? AND stage=?').get(id, stage);
  const remove = (id, stage, owner) => db.prepare('DELETE FROM work WHERE id=? AND stage=? AND owner=?').run(id, stage, owner);
  let recovering = null, closed = false;
  const admissions = new Map();
  const journal = {
    async admit(credits, payload) {
      const { id, partitionIndex: stage } = payload;
      assert(typeof id === 'string' && id.length <= 160 && Number.isSafeInteger(stage) && stage >= 0 && stage < 128,
        'Invalid owned stage admission');
      let record = row(id, stage);
      const fresh = !record;
      if (!record) {
        assert(db.prepare('SELECT count(*) AS n FROM work').get().n < 1024, 'Stage ownership journal full; reconcile pending work');
        const owner = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO work (id,stage,epoch,owner,process_owner) VALUES(?,?,?,?,?)').run(id, stage, epoch, owner, JSON.stringify(processOwner));
        record = { epoch, owner };
      }
      assert(record.epoch === epoch && !record.terminal, 'Prior stage execution cannot restart');
      // Journal first. A crash or lost HTTP reply on either side of admission stays recoverable.
      const current = admissions.get(record.owner);
      if (current) {
        assert(same(current.payload, payload), 'Concurrent admission changed its binding');
        return current.promise;
      }
      const pending = credits.call('admitOwnedStage', { ...payload, owner: record.owner }).catch(error => {
        if (fresh && error.code === 'FLEET_REJECTED') remove(id, stage, record.owner);
        throw error;
      }).finally(() => admissions.delete(record.owner));
      admissions.set(record.owner, { payload, promise: pending });
      return pending;
    },
    checkpoint(request, stage, receipt) {
      const id = `service:${request.identity.requesterId}:${request.identity.attemptId}`;
      const record = row(id, stage);
      if (!record) throw Error('Stage step has no durable owner');
      assert(record.epoch === epoch && !record.terminal && receipt?.reservationId === id &&
        receipt.attemptId === request.identity.attemptId && receipt.partitionIndex === stage &&
        receipt.participantId === participantId && receipt.status === 'executing' && receipt.steps === request.step + 1,
      'Stage step lacks this owner’s signed checkpoint');
      if (record.checkpoint) {
        const previous = JSON.parse(record.checkpoint);
        if (previous.steps === receipt.steps) { assert(same(previous, receipt), 'Conflicting stage checkpoint'); return; }
        assert(receipt.steps === previous.steps + 1, 'Noncontiguous stage checkpoint');
      } else assert(receipt.steps === 1, 'Missing prior stage checkpoint');
      // The caller cannot receive this result, or acknowledge it, before its receipt commits.
      db.prepare('UPDATE work SET checkpoint=? WHERE id=? AND stage=?').run(JSON.stringify(receipt), id, stage);
    },
    async finish(credits, bundle) {
      const receipt = bundle.receipts[0], record = row(bundle.reservationId, receipt.partitionIndex);
      // The coordinator may have accepted this exact signed terminal and lost the reply.
      if (!record) return credits.collect(bundle.reservationId, bundle);
      assert(record.epoch === epoch && receipt.participantId === participantId && receipt.status !== 'executing',
        'Terminal differs from local stage ownership');
      db.prepare('UPDATE work SET terminal=? WHERE id=? AND stage=?').run(JSON.stringify(bundle), record.id, record.stage);
      const result = await credits.collect(record.id, bundle);
      remove(record.id, record.stage, record.owner);
      return result;
    },
    recover(credits) {
      if (recovering) return recovering;
      recovering = (async () => {
        const results = [];
        for (const record of db.prepare('SELECT * FROM work WHERE epoch<>? OR terminal IS NOT NULL ORDER BY rowid').all(epoch)) {
          try {
            let result;
            if (record.terminal) result = await credits.collect(record.id, JSON.parse(record.terminal));
            else {
              assert(await predecessorExited(JSON.parse(record.process_owner), processOwner),
                'Prior stage process death is unconfirmed; keeping its credit evidence open');
              const reply = await credits.call('closeStageOwner', { id: record.id, partitionIndex: record.stage, owner: record.owner,
                receipt: record.checkpoint ? JSON.parse(record.checkpoint) : null });
              assert(reply.stageOwner === 'closed', 'Coordinator did not fence the interrupted stage');
              result = reply.outcome;
            }
            remove(record.id, record.stage, record.owner);
            results.push(result);
          } catch (error) { results.push({ id: record.id, status: 'pending', error: error.message }); }
        }
        return results;
      })().finally(() => { recovering = null; });
      return recovering;
    },
    async close() { await recovering; if (!closed) { db.close(); closed = true; } }
  };
  return journal;
}

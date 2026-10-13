/** Durable native process epochs and the existing resident owner's unsettled marker. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const assert = (ok, message) => { if (!ok) throw Error('Native canonical epochs: ' + message); };
const epoch = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const fresh = () => randomBytes(16).toString('hex');

export async function openNativeCanonicalEpochs({ directory, participantId, meshId }) {
  assert(text(directory) && text(participantId) && text(meshId), 'explicit directory and authenticated scope required');
  const { DatabaseSync } = await import('node:sqlite');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(await fs.realpath(directory), 'canonical-epochs.sqlite');
  const file = await fs.open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  let existed;
  try { const stat = await file.stat(); assert(stat.isFile(), 'store must be a regular file'); existed = stat.size > 0; }
  finally { await file.close(); }
  const db = new DatabaseSync(filename);
  let closed = false, claimed;
  const validate = value => {
    assert(value?.schema === 'reploid.native-canonical-epochs/v1' && value.participantId === participantId && value.meshId === meshId
      && Number.isSafeInteger(value.revision) && value.revision > 0 && epoch(value.participantEpoch) && epoch(value.coordinatorEpoch)
      && (value.pendingOwner === null || epoch(value.pendingOwner))
      && (value.settledOwner === null || epoch(value.settledOwner)), 'stored epoch record is corrupt or belongs to another scope');
    return value;
  };
  const read = () => {
    const row = db.prepare('SELECT record FROM epochs WHERE id = 1').get();
    assert(row, 'epoch record missing'); return validate(JSON.parse(row.record));
  };
  const current = () => {
    assert(!closed, 'owner closed'); const value = read();
    assert(value.revision === claimed.revision && value.participantEpoch === claimed.participantEpoch
      && value.coordinatorEpoch === claimed.coordinatorEpoch, 'process epoch replaced'); return value;
  };
  const transact = update => {
    assert(!closed, 'owner closed'); db.prepare('BEGIN IMMEDIATE').run();
    try {
      const result = update(); db.prepare('COMMIT').run(); return result;
    } catch (error) {
      try { db.prepare('ROLLBACK').run(); }
      catch (rollback) { throw new AggregateError([error, rollback], 'Native epoch transaction outcome unknown'); }
      throw error;
    }
  };
  const save = value => db.prepare('INSERT INTO epochs VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(JSON.stringify(validate(value)));
  try {
    db.prepare('PRAGMA busy_timeout=1000').run(); db.prepare('PRAGMA synchronous=FULL').run();
    claimed = transact(() => {
      db.prepare('CREATE TABLE IF NOT EXISTS epochs (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL)').run();
      const row = db.prepare('SELECT record FROM epochs WHERE id = 1').get();
      assert(row || !existed, 'existing store has no epoch record');
      const prior = row ? validate(JSON.parse(row.record)) : null;
      assert(!prior?.pendingOwner, 'prior resident ownership is unsettled; new admission refused');
      const value = { schema: 'reploid.native-canonical-epochs/v1', participantId, meshId,
        revision: (prior?.revision || 0) + 1, participantEpoch: fresh(), coordinatorEpoch: fresh(), pendingOwner: null, settledOwner: null };
      save(value); return value;
    });
    current();
    return Object.freeze({ participantEpoch: claimed.participantEpoch, coordinatorEpoch: claimed.coordinatorEpoch,
      assertCurrent() { current(); },
      begin(owner) {
        assert(epoch(owner), 'invalid resident owner');
        transact(() => { const value = current(); assert(value.pendingOwner === null, 'resident ownership already outstanding'); save({ ...value, pendingOwner: owner, settledOwner: null }); });
      },
      settle(owner) {
        assert(epoch(owner), 'invalid resident owner');
        const value = current();
        if (value.pendingOwner === null && value.settledOwner === owner) {
          // A failed COMMIT acknowledgement may have left the exact settlement
          // durable. Confirm through a separate reader, never an open transaction.
          const reader = new DatabaseSync(filename, { readOnly: true });
          try {
            const committed = validate(JSON.parse(reader.prepare('SELECT record FROM epochs WHERE id = 1').get()?.record));
            assert(JSON.stringify(committed) === JSON.stringify(value), 'settlement outcome remains unknown');
          } finally { reader.close(); }
          return;
        }
        transact(() => { const latest = current(); assert(latest.pendingOwner === owner, 'resident settlement owner differs');
          save({ ...latest, pendingOwner: null, settledOwner: owner }); });
      },
      close() { if (!closed) { db.close(); closed = true; } }
    });
  } catch (error) {
    try { db.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native epoch opening and cleanup failed'); }
    throw error;
  }
}

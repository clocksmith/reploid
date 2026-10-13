// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openNativeCanonicalEpochs } from '../../server/native-canonical-epochs.js';
const owners = [], directories = [];
afterEach(async () => { for (const owner of owners.splice(0)) owner.close(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-canonical-')); directories.push(directory); return { directory, participantId: 'participant', meshId: 'mesh' }; }
async function open(options) { const owner = await openNativeCanonicalEpochs(options); owners.push(owner); return owner; }
it('persists new epochs on restart and fences an earlier idle process', async () => {
  const options = await fixture(), first = await open(options), second = await open(options);
  expect(second.participantEpoch).not.toBe(first.participantEpoch); expect(second.coordinatorEpoch).not.toBe(first.coordinatorEpoch);
  expect(() => first.assertCurrent()).toThrow('replaced'); second.assertCurrent(); first.close(); second.close();
  const third = await open(options); expect(third.participantEpoch).not.toBe(second.participantEpoch);
});
it('refuses restart while resident ownership is pending and preserves cleanup authority', async () => {
  const options = await fixture(), first = await open(options), owner = 'a'.repeat(32);
  first.begin(owner); await expect(open(options)).rejects.toThrow('prior resident ownership is unsettled');
  first.assertCurrent(); expect(() => first.settle('b'.repeat(32))).toThrow('settlement owner differs');
  first.settle(owner); const second = await open(options); second.assertCurrent();
});
it('does not clear pending ownership when the process store closes', async () => {
  const options = await fixture(), first = await open(options); first.begin('a'.repeat(32)); first.close();
  await expect(open(options)).rejects.toThrow('prior resident ownership is unsettled');
});
it('serializes concurrent idle claims with only the last claimant remaining current', async () => {
  const options = await fixture(); const results = await Promise.allSettled([open(options), open(options)]);
  const successful = results.filter(row => row.status === 'fulfilled').map(row => row.value);
  expect(successful.length).toBeGreaterThan(0);
  expect(successful.filter(owner => { try { owner.assertCurrent(); return true; } catch { return false; } })).toHaveLength(1);
});
it.each(['corrupt', 'missing', 'scope'])('rejects %s persisted state without renewing epochs', async kind => {
  const options = await fixture(), first = await open(options); first.close();
  const db = new DatabaseSync(path.join(options.directory, 'canonical-epochs.sqlite'));
  try {
    if (kind === 'corrupt') db.prepare('UPDATE epochs SET record = ?').run('{');
    if (kind === 'missing') db.prepare('DELETE FROM epochs').run();
  } finally { db.close(); }
  await expect(open(kind === 'scope' ? { ...options, participantId: 'different' } : options)).rejects.toThrow();
});
it('retains pending ownership after another writer locks persistence', async () => {
  const options = await fixture(), first = await open(options); first.begin('a'.repeat(32));
  const db = new DatabaseSync(path.join(options.directory, 'canonical-epochs.sqlite'));
  try { db.prepare('BEGIN IMMEDIATE').run(); expect(() => first.settle('a'.repeat(32))).toThrow(); }
  finally { db.prepare('ROLLBACK').run(); db.close(); }
  await expect(open(options)).rejects.toThrow('prior resident ownership is unsettled');
  first.settle('a'.repeat(32));
});

it('requires exact committed owner evidence to reconcile a lost COMMIT acknowledgement', async () => {
  const options = await fixture(), first = await open(options), owner = 'a'.repeat(32);
  first.begin(owner);
  const prepare = DatabaseSync.prototype.prepare;
  let fail = true;
  const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (sql) {
    const statement = prepare.call(this, sql);
    if (sql !== 'COMMIT' || !fail) return statement;
    return { run(...args) { statement.run(...args); fail = false; throw Error('commit acknowledgement lost'); } };
  });
  try { expect(() => first.settle(owner)).toThrow('outcome unknown'); }
  finally { spy.mockRestore(); }
  expect(() => first.settle('b'.repeat(32))).toThrow('owner differs');
  first.settle(owner); // Explicit retry confirms this exact committed settlement.
  const replacement = await open(options); replacement.assertCurrent();
  expect(() => first.settle(owner)).toThrow('process epoch replaced');
});

// @vitest-environment node
// A host's durable copy of signed settlement records: what survives a restart, what is refused, and what an incomplete
// set exports as. The records here are signed by the production signers with test keys; no ledger and no mesh.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { acceptMeshOperationCharge, openMeshOperationCharge } from '../../packages/reploid/src/mesh/operation-envelope.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { TRADE_RECORD_FILE_SCHEMA, assertSignedRecordShape, openTradeRecordStore, summarizeTradeRecords } from '../../server/fleet/trade-record-store.js';
import { INCOMPLETE_EXPORT_SCHEMA, buildTradeExport } from '../../server/fleet/trade-records.js';
import { verifyRecords } from '../../scripts/settlement/verify-records.js';

const policy = { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit', creditsPerOutputToken: 2, maxDebt: 100,
  maxOutputTokens: 16, maxPendingPerComputer: 2, maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0,
  wholeModelUnclaimedReleaseMs: 120000, partitionUnclaimedReleaseMs: 120000, maxUnacknowledgedOutputs: 4 };
let root, store;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'trade-records-')); store = await openTradeRecordStore({ directory: path.join(root, 'records') }); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

/** One whole-model attempt between two test keys, signed as the mesh signs it, up to and including the acknowledgment. */
async function attempt(requestId = 'request-1') {
  const [requester, provider] = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  const planDigest = `sha256:${'c'.repeat(64)}`, reservationId = `service:${requester.peerId}:${requestId}`;
  const charge = await openMeshOperationCharge({ signer: createAttemptEvidenceSigner({ identity: requester }), requestId, planDigest, recipient: provider.peerId,
    reservationId, policy, maxCostUnits: 16, debitAccount: 'account-requester' });
  const accepted = await acceptMeshOperationCharge({ signer: createAttemptEvidenceSigner({ identity: provider }), settlement: { terms: charge.terms, charge: charge.charge },
    consumer: requester.peerId, requestId, planDigest, payoutAccount: 'account-provider' });
  await charge.accept(accepted.acceptance);
  const early = charge.records();
  const outputDigest = await hashJson('1 2 3');
  const receipt = await accepted.close({ units: 3, outputDigest, stopReason: 'eos-token', promptUnits: 11 });
  await charge.acknowledge({ receipt, units: 3, outputDigest });
  return { reservationId, requester, provider, early, records: charge.records(), close: receipt };
}

it('keeps records across a reopened store, only ever adds to a reservation, and writes owner-only files with no partial state', async () => {
  const a = await attempt();
  await store.save({ reservationId: a.reservationId, role: 'requester', records: a.early, policy });
  expect(summarizeTradeRecords((await store.read(a.reservationId)).records, a.reservationId)).toMatchObject({ complete: false, missing: ['close'] });
  await store.save({ reservationId: a.reservationId, role: 'requester', records: a.records, policy });
  // A later save with fewer records removes nothing, and neither does one that names another role.
  const after = await store.save({ reservationId: a.reservationId, role: 'provider', records: a.early });
  expect(after.records.map(row => row.signature)).toEqual(a.records.map(row => row.signature));
  expect(after.role).toBe('requester');

  // A new process: the same directory, nothing in memory.
  const reopened = await openTradeRecordStore({ directory: store.directory });
  const file = await reopened.read(a.reservationId);
  expect(file).toMatchObject({ schema: TRADE_RECORD_FILE_SCHEMA, reservationId: a.reservationId, role: 'requester', policy, statement: null, reason: null });
  expect(summarizeTradeRecords(file.records, a.reservationId)).toMatchObject({ complete: true, missing: [], acknowledged: 3, requesterId: a.requester.peerId, providerId: a.provider.peerId });
  expect(await reopened.list()).toEqual([expect.objectContaining({ reservationId: a.reservationId, records: 5, statement: false })]);

  const names = await readdir(store.directory);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  if (process.platform !== 'win32') {
    expect((await stat(path.join(store.directory, names[0]))).mode & 0o077).toBe(0);
    expect((await stat(store.directory)).mode & 0o077).toBe(0);
  }
});

it('refuses anything that is not a signed record: prompt or answer text, unknown members, token lists, long texts', async () => {
  const a = await attempt();
  const save = records => store.save({ reservationId: a.reservationId, role: 'requester', records });
  await expect(save([{ ...a.close, content: 'the answer' }])).rejects.toThrow(/not a member of a signed settlement record/);
  await expect(save([{ ...a.close, messages: [{ role: 'user', content: 'the prompt' }] }])).rejects.toThrow(/not a member/);
  await expect(save([{ ...a.close, stopReason: 'x'.repeat(300) }])).rejects.toThrow(/not a signed-record field/);
  await expect(save([{ ...a.close, tokens: [1, 2, 3] }])).rejects.toThrow(/two token counts/);
  await expect(save([{ schema: 'reploid.work-receipt/v2', signature: 'x' }])).rejects.toThrow(/Not a signed settlement record/);
  expect(() => assertSignedRecordShape({ ...a.close, signature: undefined })).toThrow(/carries its signature/);
  expect(await store.read(a.reservationId)).toBeNull();
  expect((await readdir(store.directory)).filter(name => !name.startsWith('.'))).toEqual([]);
  // A record of another reservation is not kept under this one.
  const other = await attempt('request-2');
  const mixed = await store.save({ reservationId: a.reservationId, role: 'requester', records: [...a.records, ...other.records] });
  expect(mixed.records).toHaveLength(a.records.length);
});

it('is bounded: per reservation, and by removing the reservations saved longest ago', async () => {
  const small = await openTradeRecordStore({ directory: path.join(root, 'small'), maxReservations: 2, maxRecords: 3 });
  const [a, b, c] = [await attempt('one'), await attempt('two'), await attempt('three')];
  await expect(small.save({ reservationId: a.reservationId, role: 'requester', records: a.records })).rejects.toThrow(/More than 3 records/);
  for (const row of [a, b, c]) { await small.save({ reservationId: row.reservationId, role: 'provider', records: row.early }); await new Promise(resolve => setTimeout(resolve, 15)); }
  expect((await small.list()).map(row => row.reservationId).sort()).toEqual([b.reservationId, c.reservationId].sort());
  expect(await small.read(a.reservationId)).toBeNull();
});

it('a damaged file reads as unreadable, never as records', async () => {
  const a = await attempt();
  await store.save({ reservationId: a.reservationId, role: 'requester', records: a.records, policy });
  const [name] = await readdir(store.directory);
  await writeFile(path.join(store.directory, name), (await readFile(path.join(store.directory, name), 'utf8')).slice(0, 200));
  expect(await store.read(a.reservationId)).toMatchObject({ unreadable: true, records: [] });
});

it('an incomplete or absent record set exports as incomplete with the reason, and no verifier accepts it', async () => {
  const a = await attempt();
  const nothing = buildTradeExport({ id: a.reservationId, records: { reservationId: a.reservationId, reason: 'records-not-held', missing: ['terms', 'acceptance', 'close', 'acknowledgment'], records: [] },
    trace: { reservationId: a.reservationId } });
  expect(nothing).toMatchObject({ schema: INCOMPLETE_EXPORT_SCHEMA, complete: false, reason: 'records-not-held' });
  expect(await verifyRecords({ trade: nothing })).toMatchObject({ ok: false, attempts: [] });
  // Records but no ledger record to state amounts from.
  expect(buildTradeExport({ id: a.reservationId, records: { reservationId: a.reservationId, missing: [], policy, records: a.records }, trace: null }))
    .toMatchObject({ schema: INCOMPLETE_EXPORT_SCHEMA, reason: 'ledger-record-not-available' });

  // Terms and acceptance only (the provider's close never arrived): the file says INCOMPLETE and why, and the
  // verifier reads the attempt as still open, so it does not pass.
  const summary = summarizeTradeRecords(a.early, a.reservationId);
  const trace = { reservationId: a.reservationId, charge: 0, held: 0, journalByAccount: [],
    participants: [{ participantId: a.requester.peerId, accountId: 'account-requester' }, { participantId: a.provider.peerId, accountId: 'account-provider' }] };
  const partial = buildTradeExport({ id: a.reservationId, records: { reservationId: a.reservationId, requesterId: a.requester.peerId, missing: summary.missing,
    reason: 'provider-records-missing', policy, records: a.early }, trace, statementProblem: 'records-not-final' });
  expect(partial.label).toBe('INCOMPLETE, missing close (provider-records-missing); no coordinator statement (records-not-final): the hold\'s release is not proven');
  const verdict = await verifyRecords({ trade: partial, at: Date.now() });
  expect(verdict).toMatchObject({ ok: false, attempts: [{ facts: { status: 'open' } }] });
});

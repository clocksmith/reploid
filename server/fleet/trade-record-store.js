/**
 * A host's own durable copy of the signed settlement records of the whole-model requests it took part in, as their
 * requester or as their provider (docs/verify-a-trade.md, "Where the records are kept").
 *
 * One owner-only file per reservation in one directory. A file holds signed records, the public credit policy and,
 * once the ledger has signed it, the coordinator's settlement statement: counts, times, keys, digests and signatures.
 * It never holds a prompt, an answer or token IDs: a record with any member a signed record does not define, or a text
 * longer than a record field, is refused before anything is written.
 *
 * - Append-only per reservation: a save adds the records it has not seen (by signature) and never removes or replaces
 *   one. A statement, once kept, is not replaced.
 * - Atomic: each save writes a temporary file, syncs it, renames it over the old one and syncs the directory, so a
 *   crash leaves the earlier file or the new one, never part of either.
 * - Bounded: at most `maxRecords` records and `maxBytes` per reservation, and at most `maxReservations` files. When
 *   a new reservation would exceed that, the files saved longest ago are removed first. Copy a trade's file elsewhere
 *   to keep it past that bound.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const TRADE_RECORD_FILE_SCHEMA = 'reploid.trade-record-file/v1';
const TERMS = 'reploid.settlement-terms/v1', ACCEPTANCE = 'reploid.settlement-acceptance/v1', RECEIPT = 'reploid.stage-receipt/v1',
  ACKNOWLEDGMENT = 'reploid.output-acknowledgment/v1', STOP = 'reploid.settlement-stop/v1', FAULT = 'reploid.settlement-stage-fault/v1';
/** The signed settlement records a trade is made of (docs/settlement-replay.md, "Records"). */
export const SIGNED_RECORD_SCHEMAS = Object.freeze([TERMS, ACCEPTANCE, RECEIPT, ACKNOWLEDGMENT, STOP, FAULT]);
export const SETTLEMENT_STATEMENT_RECORD_SCHEMA = 'reploid.settlement-statement/v1';
/** Every member name a signed record or the coordinator's statement defines, at any depth (docs/settlement-replay.md, "Record fields"). */
export const SIGNED_RECORD_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'policyDigest', 'unit', 'creditsPerOutputToken',
  'maxOutputTokens', 'maximum', 'shares', 'partitionIndex', 'participantId', 'weight', 'unfinishedTerms', 'maxUnacknowledgedOutputs', 'notBefore', 'deadline',
  'releaseWindowMs', 'signedAt', 'debitAccount', 'mode', 'termsDigest', 'payoutAccount', 'acknowledged', 'sequence', 'status', 'steps', 'tokens', 'prompt', 'processed',
  'timing', 'reservedAt', 'firstStepAt', 'lastStepAt', 'closedAt', 'output', 'count', 'chain', 'done', 'stopReason', 'publicJwk', 'kty', 'crv', 'x', 'y', 'signature',
  // the coordinator's statement
  'coordinatorId', 'settlementRules', 'debit', 'payouts', 'account', 'amount', 'forfeited', 'hold', 'placed', 'released', 'remaining']);
const KEYS = new Set(SIGNED_RECORD_KEYS);
const MAX_TEXT = 256;

const assert = (ok, message) => { if (!ok) throw Error(message); };

/**
 * Throws unless `record` is made only of members a signed record defines: no other member name at any depth, no text
 * over 256 characters, no list of numbers but `forfeited`, and `tokens` only as a stage receipt's two counts. This is
 * what keeps prompt and answer text out of the store whatever a caller hands it; it does not check the signature.
 */
export function assertSignedRecordShape(record, schemas = SIGNED_RECORD_SCHEMAS) {
  assert(record && typeof record === 'object' && !Array.isArray(record) && schemas.includes(record.schema), 'Not a signed settlement record');
  assert(typeof record.signature === 'string' && record.signature.length > 0, 'A signed settlement record carries its signature');
  const walk = (value, where) => {
    if (typeof value === 'string') { assert(value.length <= MAX_TEXT, `${where}: a text of ${value.length} characters is not a signed-record field`); return; }
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      assert(!value.some(item => typeof item === 'number') || where.endsWith('.forfeited'), `${where}: a list of numbers is not a signed-record field`);
      value.forEach((item, index) => walk(item, `${where}[${index}]`));
      return;
    }
    assert(typeof value === 'object', `${where}: not a JSON value`);
    for (const [key, item] of Object.entries(value)) {
      assert(KEYS.has(key), `${where}.${key}: not a member of a signed settlement record`);
      if (key === 'tokens') assert(item && typeof item === 'object' && Object.keys(item).sort().join() === 'processed,prompt', `${where}.tokens: only a stage receipt's two token counts may appear`);
      if (key === 'prompt' || key === 'processed') assert(item === null || Number.isSafeInteger(item), `${where}.${key}: only a count may appear`);
      walk(item, `${where}.${key}`);
    }
  };
  walk(record, 'record');
  return record;
}

/**
 * What a set of one whole-model reservation's records holds, and what an outsider would still miss, read from the
 * records alone (the same reading as the live charge's summary, mesh/operation-envelope.js). `complete` means the
 * records decide the outcome now: the terms, the provider's acceptance, and either its close (with the requester's
 * acknowledgment when the close claims output) or its fault. Signatures are the verifier's to check, not this.
 */
export function summarizeTradeRecords(records, reservationId = null) {
  const own = (Array.isArray(records) ? records : []).filter(row => row && (reservationId === null || row.reservationId === reservationId));
  const terms = own.find(row => row.schema === TERMS) ?? null;
  const acceptance = own.find(row => row.schema === ACCEPTANCE) ?? null;
  const receipt = own.find(row => row.schema === RECEIPT && row.timing?.closedAt != null && row.status !== 'executing') ?? null;
  const fault = own.find(row => row.schema === FAULT) ?? null, stop = own.find(row => row.schema === STOP) ?? null;
  const delivered = Boolean(receipt) && receipt.status === 'settled' && receipt.output?.done === true;
  const acknowledged = delivered ? own.find(row => row.schema === ACKNOWLEDGMENT && row.count === receipt.output.count && row.chain === receipt.output.chain) ?? null : null;
  const missing = [...(terms ? [] : ['terms']), ...(acceptance ? [] : ['acceptance']), ...(receipt || fault ? [] : ['close']), ...(delivered && !acknowledged ? ['acknowledgment'] : [])];
  return { reservationId: terms?.reservationId ?? reservationId, attemptId: terms?.attemptId ?? null, requesterId: terms?.requesterId ?? null,
    providerId: terms?.shares?.[0]?.participantId ?? acceptance?.participantId ?? null, accepted: Boolean(acceptance), closed: Boolean(receipt), faulted: Boolean(fault),
    acknowledged: acknowledged?.count ?? null, stopped: Boolean(stop), complete: missing.length === 0, missing };
}

const fileNameOf = reservationId => `${createHash('sha256').update(reservationId).digest('hex')}.json`;

/** Opens (and creates, owner-only) the directory. Returns `{ directory, save, read, list }`. */
export async function openTradeRecordStore({ directory, maxReservations = 2048, maxRecords = 64, maxBytes = 262144, now = Date.now }) {
  assert(typeof directory === 'string' && path.isAbsolute(directory), 'Absolute trade-records directory required');
  assert([maxReservations, maxRecords, maxBytes].every(value => Number.isSafeInteger(value) && value > 0), 'Positive trade-record bounds required');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const syncDirectory = async () => {
    // Makes the rename durable where the platform lets a directory be synced; elsewhere the rename alone is atomic.
    let handle = null;
    try { handle = await fs.open(directory, 'r'); await handle.sync(); } catch { /* not supported here */ } finally { await handle?.close(); }
  };
  const readFile = async name => {
    let text;
    try { text = await fs.readFile(path.join(directory, name), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const value = JSON.parse(text);
      assert(value?.schema === TRADE_RECORD_FILE_SCHEMA && typeof value.reservationId === 'string' && Array.isArray(value.records), 'Not a trade-record file');
      return value;
    } catch { return { schema: TRADE_RECORD_FILE_SCHEMA, unreadable: true, records: [] }; }
  };
  const names = async () => (await fs.readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  const prune = async keep => {
    const all = await names();
    if (all.length <= maxReservations) return;
    const aged = await Promise.all(all.filter(name => name !== keep).map(async name => ({ name, at: (await fs.stat(path.join(directory, name)).catch(() => null))?.mtimeMs ?? 0 })));
    aged.sort((a, b) => a.at - b.at);
    for (const { name } of aged.slice(0, all.length - maxReservations)) await fs.rm(path.join(directory, name), { force: true });
  };
  let writes = Promise.resolve();
  const serial = work => { const run = writes.then(work); writes = run.catch(() => {}); return run; };

  /**
   * Adds what is new to the reservation's file. `role` is `requester` or `provider`; `records` the signed records held
   * now; `policy` the public credit policy the hold was quoted under, when known; `statement` the coordinator's signed
   * statement, when the ledger has issued it; `reason` a short code for why records are missing, when they are.
   * Returns the file's content after the save.
   */
  const save = ({ reservationId, role, records = [], policy = null, statement = null, reason = null }) => serial(async () => {
    assert(typeof reservationId === 'string' && reservationId.length > 0 && reservationId.length <= 512, 'Reservation identity required');
    assert(['requester', 'provider'].includes(role), 'Trade-record role must be requester or provider');
    assert(reason === null || typeof reason === 'string' && /^[a-z0-9-]{1,64}$/.test(reason), 'A missing-records reason is a short code');
    for (const record of records) assertSignedRecordShape(record);
    if (statement) assertSignedRecordShape(statement, [SETTLEMENT_STATEMENT_RECORD_SCHEMA]);
    assert(policy === null || policy && typeof policy === 'object' && !Array.isArray(policy), 'The credit policy is an object');
    const name = fileNameOf(reservationId), prior = await readFile(name);
    const kept = prior && !prior.unreadable && prior.reservationId === reservationId ? prior : null;
    const held = kept ? [...kept.records] : [], seen = new Set(held.map(record => record.signature));
    let added = 0;
    for (const record of records) {
      if (record.reservationId !== reservationId || seen.has(record.signature)) continue;
      seen.add(record.signature); held.push(structuredClone(record)); added += 1;
    }
    const next = { schema: TRADE_RECORD_FILE_SCHEMA, reservationId, role: kept?.role ?? role, policy: kept?.policy ?? (policy ? structuredClone(policy) : null),
      reason: reason ?? (held.length ? null : kept?.reason ?? 'records-not-held'), records: held,
      statement: kept?.statement ?? (statement && statement.reservationId === reservationId ? structuredClone(statement) : null),
      firstSavedAt: kept?.firstSavedAt ?? new Date(now()).toISOString(), savedAt: new Date(now()).toISOString() };
    if (kept && added === 0 && Boolean(kept.statement) === Boolean(next.statement) && Boolean(kept.policy) === Boolean(next.policy) && kept.reason === next.reason) return kept;
    assert(held.length <= maxRecords, `More than ${maxRecords} records for one reservation`);
    const text = JSON.stringify(next, null, 2) + '\n';
    assert(Buffer.byteLength(text) <= maxBytes, `The records of one reservation exceed ${maxBytes} bytes`);
    const temporary = path.join(directory, `.${name}.${process.pid}.${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
    try { await fs.rename(temporary, path.join(directory, name)); }
    catch (error) { await fs.rm(temporary, { force: true }); throw error; }
    await syncDirectory();
    if (!kept) await prune(name);
    return next;
  });

  return Object.freeze({
    directory, save,
    /** The reservation's file content, `null` when there is none, or `{ unreadable: true }` for a damaged file. */
    read: async reservationId => { await writes; return readFile(fileNameOf(reservationId)); },
    /** `[{ reservationId, role, savedAt, records, statement }]` (counts), most recently saved first. */
    async list() {
      await writes;
      const rows = [];
      for (const name of await names()) {
        const value = await readFile(name);
        if (value && !value.unreadable) rows.push({ reservationId: value.reservationId, role: value.role, savedAt: value.savedAt, records: value.records.length, statement: Boolean(value.statement) });
      }
      return rows.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    }
  });
}

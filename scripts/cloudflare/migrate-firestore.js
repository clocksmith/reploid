#!/usr/bin/env node
/**
 * Copy Firestore (project reploid) into the reploid-api coordinator's SQLite store, then check parity.
 * Firestore stays the source of truth: this only reads it. Writes upsert, so a rerun is the final sync.
 *
 *   node scripts/cloudflare/migrate-firestore.js --dry-run
 *   MIGRATION_TOKEN=... node scripts/cloudflare/migrate-firestore.js --apply [--api https://reploid-api.reploid.workers.dev]
 *
 * Not copied: rate_limits (fixed windows of seconds; the coordinator starts its own) and relay messages
 * already past expiresAt (every read filters them out). Parity: per-collection counts, every copied
 * document compared byte for byte after canonical JSON, and invariants (relay sequences cover their
 * messages; each Change Passport's eventCount equals its stored events).
 */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' },
  api: { type: 'string', default: 'https://reploid-api.reploid.workers.dev' }, project: { type: 'string', default: 'reploid' } } });
if (Boolean(values['dry-run']) === Boolean(values.apply)) throw new Error('Pass exactly one of --dry-run or --apply');
const SKIP_COLLECTIONS = new Set(['rate_limits']);
const BATCH = 500;

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

/** Firestore value → the JSON the coordinator stores. Timestamps become ISO text; other types stop the copy. */
function toJson(value, at) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof GeoPoint || value instanceof DocumentReference || Buffer.isBuffer(value) || value instanceof Uint8Array) throw new Error(`Unsupported Firestore type at ${at}`);
  if (Array.isArray(value)) return value.map((entry, index) => toJson(entry, `${at}[${index}]`));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJson(entry, `${at}.${key}`)]));
  return value;
}

const expired = (data) => {
  const at = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : Number(data.expiresAt ?? NaN);
  return Number.isFinite(at) && at < Date.now();
};

async function readCollection(collection, out, counts) {
  const parent = collection.path;
  const entry = counts[parent] ||= { source: 0, copied: 0, skipped: 0 };
  // listDocuments also returns documents that exist only as parents of subcollections.
  for (const ref of await collection.listDocuments()) {
    const snapshot = await ref.get();
    if (snapshot.exists) {
      entry.source += 1;
      const data = toJson(snapshot.data(), ref.path);
      if (parent === 'peer_room_messages' && expired(data)) entry.skipped += 1;
      else { entry.copied += 1; out.push({ path: ref.path, data }); }
    }
    for (const sub of await ref.listCollections()) await readCollection(sub, out, counts);
  }
}

async function call(path, init = {}) {
  const token = process.env.MIGRATION_TOKEN;
  if (!token) throw new Error('MIGRATION_TOKEN is required for --apply');
  const response = await fetch(`${values.api}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error || ''}`);
  return body;
}

async function exportAll(parent) {
  const documents = [];
  for (let after = ''; ;) {
    const page = (await call(`/admin/export?parent=${encodeURIComponent(parent)}&limit=1000&after=${encodeURIComponent(after)}`)).documents;
    documents.push(...page);
    if (page.length < 1000) return documents;
    after = page.at(-1).path;
  }
}

function invariants(documents) {
  const failures = [];
  const byParent = (parent) => documents.filter((entry) => entry.path.startsWith(`${parent}/`) && entry.path.split('/').length === parent.split('/').length + 1);
  const sequences = new Map(byParent('peer_room_relay_sequences').map((entry) => [entry.data.roomId, Number(entry.data.nextSequence || 0)]));
  for (const { path, data } of byParent('peer_room_messages')) {
    if (Number.isFinite(data.relaySequence) && data.relaySequence > (sequences.get(data.roomId) ?? -1)) failures.push(`${path}: relaySequence ${data.relaySequence} above its room's nextSequence`);
  }
  for (const { path, data } of byParent('reploid_change_passports')) {
    const events = byParent(`${path}/events`).length;
    if (Number(data.eventCount || 0) !== events) failures.push(`${path}: eventCount ${data.eventCount} but ${events} events`);
  }
  return failures;
}

initializeApp({ projectId: values.project });
const firestore = getFirestore();
const documents = [];
const counts = {};
const skippedCollections = {};
for (const collection of await firestore.listCollections()) {
  if (SKIP_COLLECTIONS.has(collection.id)) { skippedCollections[collection.id] = (await collection.count().get()).data().count; continue; }
  await readCollection(collection, documents, counts);
}
documents.sort((a, b) => (a.path < b.path ? -1 : 1));
const sourceFailures = invariants(documents);
const report = { mode: values.apply ? 'apply' : 'dry-run', readAt: new Date().toISOString(), counts, skippedCollections,
  documents: documents.length, sourceDigest: digest(documents.map((entry) => [entry.path, entry.data])), sourceInvariantFailures: sourceFailures };

if (values.apply) {
  for (let index = 0; index < documents.length; index += BATCH) {
    await call('/admin/import', { method: 'POST', body: JSON.stringify({ documents: documents.slice(index, index + BATCH) }) });
  }
  const inventory = new Map((await call('/admin/inventory')).collections.map((entry) => [entry.parent, entry.count]));
  const copied = [];
  for (const parent of Object.keys(counts)) copied.push(...await exportAll(parent));
  const target = new Map(copied.map((entry) => [entry.path, digest(entry.data)]));
  const mismatched = documents.filter((entry) => target.get(entry.path) !== digest(entry.data)).map((entry) => entry.path);
  const countMismatches = Object.entries(counts).filter(([parent, entry]) => (inventory.get(parent) || 0) < entry.copied)
    .map(([parent, entry]) => `${parent}: ${inventory.get(parent) || 0} stored, ${entry.copied} copied`);
  report.parity = { ok: mismatched.length === 0 && countMismatches.length === 0 && invariants(copied).length === 0,
    stored: Object.fromEntries(inventory), countMismatches, mismatched: mismatched.slice(0, 20), mismatchedCount: mismatched.length,
    targetInvariantFailures: invariants(copied) };
  const sourcePaths = new Set(documents.map((entry) => entry.path));
  report.parity.targetDigest = digest(copied.filter((entry) => sourcePaths.has(entry.path)).sort((a, b) => (a.path < b.path ? -1 : 1)).map((entry) => [entry.path, entry.data]));
  report.parity.digestsMatch = report.parity.targetDigest === report.sourceDigest;
  report.parity.ok &&= report.parity.digestsMatch;
}
console.log(JSON.stringify(report, null, 2));
if (report.parity && !report.parity.ok) process.exitCode = 1;

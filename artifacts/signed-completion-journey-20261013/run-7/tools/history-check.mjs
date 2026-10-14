// Run-7 transactional-history check on the installed application. One fresh requester profile asks one
// short question on the ordered route (granting the one-time permission), then the harness reads the
// requester's IndexedDB `reploid-requester-history` directly and summarizes the committed records:
// stores, record schemas, the ordered publication chain for the attempt, and its terminal record.
// It then reloads and confirms the answer is restored from that history. The room token is redacted.
// Usage: node history-check.mjs <journey config> <output json>
import fs from 'node:fs/promises';
import { loadConfig, orderedSelectionId } from '../../config.mjs';
import { openRequesterProfile, appUrl, openApp, chooseOrderedModel, send, followAttempt, attemptIds, waitFor, now } from '../../harness.mjs';
import { observeChat } from '../../observe.mjs';
const [configPath, outputPath] = process.argv.slice(2);
const { config } = await loadConfig(configPath);
const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
const out = { schema: 'reploid.run-7-history-check/v1', startedAt: now() };
const profile = await openRequesterProfile(config.browsers.requester, 'history');
try {
  const page = await profile.context.newPage();
  const url = appUrl(config.browsers.requester.origin, room, config.application.signalingUrl);
  await openApp(page, url, config.timeouts.readyMs);
  await chooseOrderedModel(page, orderedSelectionId(config.freeze), config.timeouts.readyMs);
  const oldIds = attemptIds(await observeChat(page));
  out.send = await send(page, 'Reply with only the word OK.', config.timeouts.readyMs);
  const { thread, attempt } = await followAttempt(page, { oldIds, timeout: config.timeouts.answerMs, poll: 250, samples: [], modelIdentity: config.freeze.modelIdentity });
  out.attempt = { id: attempt.id, status: attempt.status, publicationMode: attempt.publicationMode ?? null,
    authorization: attempt.authorization ? { kind: attempt.authorization.kind, source: attempt.authorization.source,
      permissionId: attempt.authorization.permissionId ?? null, recipients: attempt.authorization.recipients ?? null } : null,
    answer: thread.messages.find(message => message.id === attempt.responseId)?.content ?? null,
    generatedTokens: attempt.execution?.stepSummary?.count ?? null };
  out.indexedDB = await page.evaluate(async attemptId => {
    const databases = (await indexedDB.databases()).map(row => row.name);
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('reploid-requester-history'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = [...db.objectStoreNames];
    const all = await Promise.all(stores.map(store => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly'), q = tx.objectStore(store).getAll(); q.onsuccess = () => resolve([store, q.result]); q.onerror = () => reject(q.error); })));
    db.close();
    // Walk every stored value for ordered publication records of this attempt.
    const records = [], schemas = new Map();
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 12) return;
      if (typeof value.schema === 'string') schemas.set(value.schema, (schemas.get(value.schema) || 0) + 1);
      if (value.schema === 'reploid.ordered-publication/v1' && value.attemptId === attemptId) records.push(value);
      for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, depth + 1);
    };
    for (const [, rows] of all) visit(rows);
    records.sort((a, b) => a.sequence - b.sequence);
    const chained = records.every((record, index) => index === 0 ? record.previousPublicationDigest === null || typeof record.previousPublicationDigest === 'string'
      : record.previousPublicationDigest === records[index - 1].publicationDigest);
    return { databases, stores: all.map(([store, rows]) => ({ store, rows: rows.length })), schemas: Object.fromEntries(schemas),
      orderedRecords: records.length, sequences: records.map(record => record.sequence), chained,
      terminal: records.at(-1)?.successor ? { terminal: records.at(-1).successor.terminal, stopReason: records.at(-1).successor.stopReason } : null,
      text: records.map(record => record.delta.text).join(''), acknowledgments: [...new Set(records.map(record => record.acknowledgments.length))] };
  }, attempt.id);
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for the host session to be observable again after the reload.
  const state = await waitFor(() => observeChat(page).catch(() => null), { timeout: config.timeouts.readyMs, poll: 250, label: 'Restored host session' });
  const restored = state.threads.find(item => item.id === thread.id);
  out.afterReload = { restoredAnswer: restored?.messages.find(message => message.id === attempt.responseId)?.content ?? null,
    storageMode: state.storageMode ?? null };
  out.ok = out.attempt.status === 'completed' && out.indexedDB.orderedRecords === out.attempt.generatedTokens
    && out.indexedDB.chained && out.indexedDB.terminal?.terminal === true && out.indexedDB.text === out.attempt.answer
    && out.afterReload.restoredAnswer === out.attempt.answer;
} catch (error) { out.failure = String(error.stack || error); }
finally {
  out.finishedAt = now();
  await fs.writeFile(outputPath, JSON.stringify(out, null, 2).replaceAll(room.token, '[REDACTED]') + '\n', { flag: 'wx' });
  await profile.close();
  console.log(JSON.stringify({ ok: out.ok ?? false, failure: out.failure?.split('\n')[0] }));
}

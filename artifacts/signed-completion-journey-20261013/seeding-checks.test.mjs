import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './seeding.json' with { type: 'json' };
import { assessSeeding, displayedSizes, catalogBytes } from './seeding-checks.mjs';
import { conversation, attempt } from './test-fixtures.mjs';

const MiB = 1048576, h = n => String(n).repeat(64).slice(0, 64);
const catalog = [
  { path: 'manifest.json', role: 'model-manifest', sizeBytes: 222286, hash: h(1) },
  { path: 'tokenizer.json', role: 'tokenizer', sizeBytes: 9088480, hash: h(2) },
  { path: 'shard_00000.bin', role: 'model-weights', sizeBytes: 67108864, hash: h(3) },
  { path: 'shard_00001.bin', role: 'model-weights', sizeBytes: 50000000, hash: h(4) }
];
const total = catalogBytes(catalog), weights = catalog.filter(file => file.role === 'model-weights');
const offer = files => files.map(file => ({ path: file.path, hash: 'sha256:' + file.hash, sizeBytes: file.sizeBytes }));
const done = id => conversation('t-' + id, [{ attempt: attempt({ id, threadId: 't-' + id }), question: 'q', answer: '1\n2' }]);
const freeze = (await import('./test-fixtures.mjs')).freeze;
const httpRows = files => files.map(file => ({ weight: file.role === 'model-weights', declaredBytes: null, responseBytes: file.sizeBytes }));
const settled = { sharing: false, preparing: false, stopping: false, pending: 0 };

function passing() {
  return {
    catalog,
    refusal: { allowanceBytes: 64 * MiB, files: { sharing: false, error: fixture.refusalText + '.' }, offered: [],
      ledger: { maxBytes: 64 * MiB, reservedBytes: 9310766 }, requests: httpRows(catalog.slice(0, 2)) },
    scopeBeforeApproval: { mode: 'full-model', limits: `Full-model seeding stores and downloads ${(total / 1073741824).toFixed(2)} GiB`, policy: null, progress: null },
    seed: { allowanceBytes: 1200 * MiB, files: { sharing: true, mode: 'full-model', error: '' }, offered: offer(catalog),
      ledger: { maxBytes: 1200 * MiB, reservedBytes: total }, requests: httpRows(catalog), receipts: [],
      samples: [{ attemptStatus: 'executing', preparing: true, sharing: false }], chat: { attemptId: 'seed', final: done('seed') } },
    peer: { seeder: { machine: 'mac-host', suppliedBefore: 0, suppliedAfter: total },
      acquirer: { machine: 'intel-host', files: { sharing: true, error: '' }, offered: offer(catalog), requests: httpRows(catalog.slice(0, 2)),
        receipts: [{ finished: true, bytes: total, hashes: weights.map(file => file.hash) }] } },
    reload: { before: { ledger: { maxBytes: 1200 * MiB, reservedBytes: total } },
      after: { files: { sharing: true, mode: 'cached-only' }, offered: offer(catalog), requests: [], ledger: { maxBytes: 1200 * MiB, reservedBytes: total } } },
    bounded: { allowanceBytes: 5 * MiB, bounded: { sharing: true }, boundedOffer: [{ path: `piece-${h(9)}.bin`, hash: h(9), sizeBytes: 4 * MiB }],
      seeding: { sharing: false, error: fixture.refusalText }, seedingOffer: [], requests: [], ledger: { maxBytes: 5 * MiB, reservedBytes: 5000000 } },
    stop: { inFlight: { pendingWeightRequests: 1 }, filesAfter: settled, requestsAfterSettled: 0,
      ledgerBefore: { maxBytes: 1200 * MiB, reservedBytes: 80 * MiB }, ledgerAfter: { maxBytes: 1200 * MiB, reservedBytes: 80 * MiB },
      chat: { attemptId: 'stop', samples: [{ attemptStatus: 'executing' }], final: done('stop') } }
  };
}
const failing = (mutate, check, pattern) => {
  const report = passing(); mutate(report);
  const result = assessSeeding(report, freeze, fixture).checks[check];
  assert.equal(result.pass, false, check);
  assert.ok(result.failures.some(failure => pattern.test(failure)), `${check}: ${result.failures.join('; ')}`);
};

test('a complete seeding report passes every check', () => {
  const result = assessSeeding(passing(), freeze, fixture);
  for (const [name, check] of Object.entries(result.checks)) assert.deepEqual(check.failures, [], name);
  assert.equal(result.automatedPass, true);
});
test('displayed sizes are read in binary and decimal units', () => {
  assert.deepEqual(displayedSizes('Store up to 3 GiB, Download 1,200 MiB, 1.5 GB'), [3 * 1073741824, 1200 * MiB, 1.5e9]);
});
test('a refusal that still downloaded weights fails', () =>
  failing(report => { report.refusal.requests.push({ weight: true, responseBytes: 1 }); }, 'refusedWithoutAllowance', /downloaded model weights/));
test('seeding that never states the model size before approval fails', () =>
  failing(report => { report.scopeBeforeApproval.limits = 'Store up to 3 GiB, Send up to 1 GiB'; }, 'scopeVisibleBeforeApproval', /size is not shown/));
test('a seed missing one catalog file fails', () =>
  failing(report => { report.seed.offered.pop(); }, 'seededWhole', /every catalog file/));
test('a seed charged more than it transferred fails', () =>
  failing(report => { report.seed.ledger.reservedBytes += 1; }, 'seededWhole', /differs from the observed transfers/));
test('an acquirer that pulled weights from the origin fails', () =>
  failing(report => { report.peer.acquirer.requests.push({ weight: true, responseBytes: 67108864 }); }, 'peerAcquiresWholeModel', /from the origin/));
test('an acquirer on the seeder machine fails', () =>
  failing(report => { report.peer.acquirer.machine = 'mac-host'; }, 'peerAcquiresWholeModel', /another computer/));
test('a reload that requested files or changed the ledger fails', () => {
  failing(report => { report.reload.after.requests.push({ weight: false }); }, 'reloadRebuildsWhole', /requested model files/);
  failing(report => { report.reload.after.ledger.reservedBytes += 1; }, 'reloadRebuildsWhole', /changed the seeding ledger/);
});
test('a bounded grant that turned into seeding fails', () => {
  failing(report => { report.bounded.seeding = { sharing: true, error: '' }; }, 'boundedDoesNotImplySeeding', /was not refused/);
  failing(report => { report.bounded.boundedOffer.push(offer(weights)[0]); }, 'boundedDoesNotImplySeeding', /whole weight files/);
});
test('a stop that refunded charges or cancelled the conversation fails', () => {
  failing(report => { report.stop.ledgerAfter.reservedBytes = 0; }, 'stopSettlesSeeding', /refunded/);
  failing(report => { report.stop.chat.samples.push({ attemptStatus: 'cancelled' }); }, 'stopSettlesSeeding', /cancelled the conversation/);
});
test('missing observations fail closed', () => {
  const result = assessSeeding({}, freeze, fixture);
  assert.equal(result.automatedPass, false);
  assert.ok(Object.values(result.checks).every(check => !check.pass));
});

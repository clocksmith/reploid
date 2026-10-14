import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessContribution } from './contribution-checks.mjs';
import { contributionReport, freeze } from './test-fixtures.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./contribution.json', import.meta.url)));
const assess = report => assessContribution(report, freeze, fixture);
function rejects(name, check, mutate, pattern = null) {
  test(`rejects ${name}`, () => {
    const report = contributionReport(); mutate(report);
    const result = assess(report);
    assert.equal(result.automatedPass, false);
    assert.equal(result.checks[check].pass, false, `${check} should reject ${name}`);
    if (pattern) assert.match(result.checks[check].failures.join('\n'), pattern);
    const others = Object.entries(result.checks).filter(([name, value]) => name !== check && !value.pass).map(([name]) => name);
    assert.deepEqual(others, [], 'each Launch 2 result is independent');
  });
}

test('coherent storage contribution evidence passes each separate check', () => {
  const result = assess(contributionReport());
  assert.deepEqual(result.failures, []);
  assert.deepEqual(Object.keys(result.checks), ['sharedWhileChatting', 'peerAcquisition', 'reloadPreserved', 'competingTabs',
    'interruptedResume', 'cachedOnly', 'stopSettles']);
});

// Required: an overspent allowance and a cached-only acquisition request.
// Competing tabs are two tabs of one profile; the second must be refused (README, "Contract decision").
rejects('an overspent allowance across competing tabs', 'competingTabs', report => {
  report.contention.second.transfers.push({ key: 'piece-1', bytes: 4194304, finished: true });
  report.contention.ledgerAfter.reservedBytes = report.contention.allowanceBytes;
}, /overspent the allowance/);
rejects('a ledger reserved beyond its cap', 'competingTabs', report => { report.contention.ledgerAfter.reservedBytes = report.contention.allowanceBytes + 1; });
rejects('an uncharged transfer', 'competingTabs', report => { report.contention.ledgerAfter.reservedBytes -= 1; }, /not charged/);
// Was: the second tab's own file budget had another cap. A refused tab has no file budget, so the
// same property is asserted on the ledger each tab reads.
rejects('tabs with different caps', 'competingTabs', report => { report.contention.second.ledgerAfter.maxBytes = 1048576; }, /one profile ledger/);
rejects('a second tab of the profile that connects', 'competingTabs', report => {
  Object.assign(report.contention.second.samples[3], { consumerPeerId: 'peer:' + '7'.repeat(24), custodyOwner: true, error: null });
}, /single-owner lock was not enforced/);
rejects('a second tab that silently connects without any refusal', 'competingTabs', report => {
  for (const sample of report.contention.second.samples) Object.assign(sample, { consumerPeerId: 'peer:' + '7'.repeat(24), custodyOwner: true, error: null });
}, /explicitly refused/);
rejects('a second tab stopped by another error than the single-owner lock', 'competingTabs', report => {
  for (const sample of report.contention.second.samples) sample.error = 'Network unavailable';
}, /explicitly refused by the single-owner lock \("Another tab owns this peer connection"\)/);
rejects('a refused tab that still transferred model files', 'competingTabs', report => {
  report.contention.second.transfers.push({ key: 'index', bytes: 34258, finished: true });
  for (const ledger of [report.contention.ledgerAfter, report.contention.second.ledgerAfter]) ledger.reservedBytes += 34258;
}, /Refused tab transferred/);
rejects('a charge without a transfer (charged twice)', 'competingTabs', report => {
  for (const ledger of [report.contention.ledgerAfter, report.contention.second.ledgerAfter]) ledger.reservedBytes += 34258;
}, /charged more than the observed transfers/);
rejects('a piece transferred to completion twice', 'competingTabs', report => {
  report.contention.owner.transfers.push({ key: 'index', bytes: 34258, finished: true });
  for (const ledger of [report.contention.ledgerAfter, report.contention.second.ledgerAfter]) ledger.reservedBytes += 34258;
}, /transferred to completion twice/);
rejects('a ledger sample above the allowance', 'competingTabs', report => {
  report.contention.ledgerSamples.push({ maxBytes: report.contention.allowanceBytes, reservedBytes: report.contention.allowanceBytes + 1 });
}, /exceed the allowance/);
rejects('two tabs in different profiles', 'competingTabs', report => { report.contention.second.profile = 'other-profile'; }, /one browser profile/);
rejects('a cached-only acquisition request', 'cachedOnly', report => {
  report.cachedOnly.requests.push({ url: 'http://127.0.0.1:8000/config/model-pieces/qwen-0-8b-pieces.json', weight: false });
}, /issued model-file acquisition requests/);
rejects('a cached-only custody acquisition', 'cachedOnly', report => { report.cachedOnly.receiptsAfter = 1; });
rejects('a cached-only ledger charge', 'cachedOnly', report => { report.cachedOnly.budgetAfter.reservedBytes += 4194304; });
// Every model-file request of the cached-only tab's lifetime counts, not only those after the click.
rejects('a cached-only tab request before cached-only mode started', 'cachedOnly', report => {
  report.cachedOnly.requests.push({ page: 'supplier-cached', at: '2026-10-13T12:01:01.500Z', url: 'http://127.0.0.1:8000/config/model-manifests/' + 'a'.repeat(64) + '.json', weight: false });
}, /issued model-file acquisition requests/);
rejects('a cached-only tab weight request during the quiet window', 'cachedOnly', report => {
  report.cachedOnly.requests.push({ page: 'supplier-cached', at: '2026-10-13T12:01:06.000Z', url: 'http://127.0.0.1:8000/m/shard_00000.bin', range: 'bytes=0-63', weight: true });
}, /issued model-file acquisition requests/);
// Contract: one connected tab per profile. A second concurrent tab of the sharer profile is refused.
rejects('a step that opened a second concurrent tab of the sharer profile', 'cachedOnly', report => {
  const { sharer, tab } = report.cachedOnly;
  sharer.closedAt = '2026-10-13T12:01:09.000Z'; tab.profilePages = 2;
  tab.lockSamples = tab.lockSamples.map(sample => ({ ...sample, consumerPeerId: null, custodyOwner: false, error: 'Another tab owns this peer connection' }));
}, /opened while another tab of the sharer profile was open[\s\S]*single-owner lock was not released/);
rejects('a second tab counted while the sharer tab was already closed', 'cachedOnly', report => { report.cachedOnly.tab.profilePages = 2; },
  /opened while another tab of the sharer profile was open/);
rejects('a next tab of the profile refused by the lock', 'cachedOnly', report => {
  report.cachedOnly.tab.lockSamples.push({ at: '2026-10-13T12:01:02.500Z', consumerPeerId: null, custodyOwner: false, error: 'Another tab owns this peer connection' });
}, /did not connect normally/);
rejects('a next tab of the profile that never connected', 'cachedOnly', report => {
  report.cachedOnly.tab.lockSamples = report.cachedOnly.tab.lockSamples.slice(0, 1);
}, /did not connect normally/);
rejects('a cached-only piece absent from the verified cache', 'cachedOnly', report => {
  report.cachedOnly.offered.push({ path: `piece-${'9'.repeat(64)}.bin`, role: 'model-weights', sizeBytes: 4194304, hashAlgorithm: 'sha256', hash: '9'.repeat(64) });
}, /restored only from the verified local cache/);
rejects('a cached-only inventory that lost a verified piece', 'cachedOnly', report => {
  report.cachedOnly.offered = report.cachedOnly.offered.filter(item => !item.path.startsWith('piece-'));
}, /restored only from the verified local cache/);
rejects('a cached-only observation shorter than the frozen window', 'cachedOnly', report => { report.cachedOnly.observationMs = 100; }, /window incomplete/);
rejects('a cached-only window that does not start when the tab opened', 'cachedOnly', report => {
  report.cachedOnly.window.openedAt = report.cachedOnly.window.startedAt;
}, /window incomplete/);
rejects('a pending transfer during the quiet window', 'cachedOnly', report => { report.cachedOnly.samples[1].pending = 1; }, /left a transfer pending/);
rejects('a reload observed while another tab of the sharer profile was open', 'reloadPreserved', report => { report.reload.profilePages = 2; },
  /another tab of the sharer profile/);
test('cached-only fails closed without the frozen observation window', () => {
  const result = assessContribution(contributionReport(), freeze);
  assert.match(result.checks.cachedOnly.failures.join('\n'), /window incomplete/);
  assert.equal(result.checks.cachedOnly.pass, false);
});

rejects('sharing that never overlapped the conversation', 'sharedWhileChatting', report => {
  report.share.samples = [{ attemptStatus: 'completed', filesPreparing: true, filesSharing: false }];
});
rejects('a conversation cancelled by sharing', 'sharedWhileChatting', report => { report.share.samples.push({ attemptStatus: 'cancelled' }); });
rejects('a subset larger than the allowance', 'sharedWhileChatting', report => { report.share.offered.push({ ...report.share.offered[1], path: `piece-${'1'.repeat(64)}.bin`, hash: '1'.repeat(64) }); });
rejects('a cache-only share counted as bounded sharing', 'sharedWhileChatting', report => { report.share.files.mode = 'cached-only'; });
rejects('pieces acquired from another peer', 'peerAcquisition', report => { report.peer.acquirer.receipts[0].attempts[0].peerId = 'transport-other'; });
rejects('pieces fetched over HTTP by the acquirer', 'peerAcquisition', report => { report.peer.acquirer.weightRequests.push({ url: 'http://127.0.0.1:8000/m/shard_00000.bin' }); });
rejects('an acquirer on the same computer', 'peerAcquisition', report => { report.peer.acquirer.machine = 'mac-host'; });
rejects('supply accounting below the transfer', 'peerAcquisition', report => { report.peer.supplier.suppliedBytesAfter = 0; });
rejects('a reload that reset consumed allowance', 'reloadPreserved', report => { report.reload.after.budget.reservedBytes = 0; });
rejects('a reload that lost verified inventory', 'reloadPreserved', report => { report.reload.after.offered = []; });
rejects('a reload that downloaded again', 'reloadPreserved', report => { report.reload.after.requests.push({ url: 'http://127.0.0.1:8000/m/shard_00000.bin' }); });
rejects('a resume that downloaded a verified piece again', 'interruptedResume', report => {
  report.interruption.resumed.push({ key: 'piece-0', bytes: 4194304, finished: true });
  report.interruption.ledgerFinal = { maxBytes: 20 * 1048576, reservedBytes: 12831373 + 4194304 };
}, /downloaded again/);
rejects('an interruption not resumed although the allowance covered it', 'interruptedResume', report => {
  report.interruption.resumed = []; report.interruption.ledgerFinal.reservedBytes = 8637069;
}, /neither resumed/);
rejects('a refunded interrupted transfer', 'interruptedResume', report => { report.interruption.ledgerFinal.reservedBytes -= 4194304; });
rejects('no interrupted transfer', 'interruptedResume', report => { report.interruption.interrupted = []; });
// Run 2: the reload came after the 64- and 512-byte pieces had finished; nothing was caught in flight.
rejects('an interruption that never caught an in-flight piece', 'interruptedResume', report => {
  const i = report.interruption;
  Object.assign(i.inFlightAtReload, { outcome: 'completed', failure: null });
  i.completedDuringInterruption = [{ key: 'piece-1', bytes: 4194304 }]; i.interrupted = [];
  i.resumed = []; i.ledgerFinal.reservedBytes = 8637069;
}, /never caught an in-flight piece of at least 1 MiB/);
rejects('an in-flight piece smaller than 1 MiB', 'interruptedResume', report => {
  const i = report.interruption;
  Object.assign(i.inFlightAtReload, { key: 'small', bytes: 512 });
  i.interrupted = [{ key: 'small', bytes: 512 }]; i.resumed = [{ key: 'small', bytes: 512, finished: true }];
  i.ledgerFinal.reservedBytes = 4442765 + 1024;
}, /never caught an in-flight piece of at least 1 MiB/);
rejects('a reload issued before the piece started', 'interruptedResume', report => {
  report.interruption.reloadAt = '2026-10-13T12:00:02.000Z';
}, /never caught/);
rejects('an in-flight piece missing from the interrupted transfers', 'interruptedResume', report => {
  report.interruption.inFlightAtReload.key = 'piece-other';
}, /not among the interrupted transfers/);
rejects('a double charge after the resume', 'interruptedResume', report => {
  report.interruption.ledgerFinal.reservedBytes = 12831373 + 34258; // still within the 13 MiB cap
}, /double charge/);
rejects('a transfer that completed during the interruption but was not charged', 'interruptedResume', report => {
  report.interruption.completedDuringInterruption = [{ key: 'other', bytes: 512 }];
}, /not charged/);
// Run 3 (H4): the competing-tabs owner still offered its subset. The interrupt tab acquired the metadata and
// small pieces from it before the reload; those receipts ended with the page, so the ledger exceeded the
// observed transfers. Origin is the step's only intended supplier; every such case fails closed.
const unintended = { peer: 'transport-contention-0', files: 24, bytes: 5242877 };
rejects('an unintended supplier that served pieces before the reload (run 3)', 'interruptedResume', report => {
  const i = report.interruption;
  i.isolation.closed = i.isolation.closed.filter(row => row.name !== 'contention-0'); i.isolation.remainingOpen = ['contention-0'];
  i.suppliers.before[2].offering = [unintended]; i.suppliers.after[0].offering = [unintended];
  i.completedBefore = []; // served by the peer, never seen over HTTP; the ledger still charged them
}, /not closed before the interruption[\s\S]*Another supplier was offering[\s\S]*No transfer had completed[\s\S]*double charge/);
rejects('an unintended supplier whose transfer was observed and charged exactly', 'interruptedResume', report => {
  const i = report.interruption, receipt = { key: 'peer:t1', bytes: 32768, finished: true, hashes: ['sha256:' + 'c'.repeat(64)] };
  i.peerTransfers = [receipt]; i.resumed.push(receipt); i.ledgerFinal.reservedBytes += receipt.bytes;
}, /An unintended supplier served pieces/);
rejects('an unintended supplier that evaded every offer sample and served a piece unobserved', 'interruptedResume', report => {
  const i = report.interruption; i.completedBefore = i.completedBefore.filter(item => item.key !== 'index');
}, /double charge/);
rejects('a supplier tab kept open as intended', 'interruptedResume', report => { report.interruption.isolation.keep = ['contention-0']; }, /not closed/);
rejects('a missing tab isolation record', 'interruptedResume', report => { delete report.interruption.isolation; }, /not closed/);
rejects('supplier offers never observed', 'interruptedResume', report => { delete report.interruption.suppliers; }, /Supplier offers unobserved/);
rejects('a supplier observation shorter than the frozen window', 'interruptedResume', report => { report.interruption.suppliers.observationMs = 100; },
  /Supplier offers unobserved/);
rejects('no supplier observation after the resume', 'interruptedResume', report => { report.interruption.suppliers.after = []; }, /Supplier offers unobserved/);
rejects('unobserved custody receipts', 'interruptedResume', report => { delete report.interruption.peerTransfers; }, /unintended supplier served/);
test('interrupted resume fails closed without the frozen supplier observation window', () => {
  const result = assessContribution(contributionReport(), freeze);
  assert.match(result.checks.interruptedResume.failures.join('\n'), /Supplier offers unobserved/);
  assert.equal(result.checks.interruptedResume.pass, false);
});
rejects('a stop with nothing in flight', 'stopSettles', report => { report.stop.inFlightAtStop = { filesPreparing: false, pendingRequests: 0 }; });
rejects('a stop that left a transfer pending', 'stopSettles', report => { report.stop.filesAfter.pending = 1; });
rejects('a stop that refunded charges', 'stopSettles', report => { report.stop.budgetAfter.reservedBytes = 0; });
rejects('acquisition after the stop settled', 'stopSettles', report => { report.stop.requestsAfterSettled = 1; });
rejects('a stop that cancelled the conversation', 'stopSettles', report => {
  report.stop.chat.samples.push({ at: '2026-10-13T12:00:06.000Z', attemptStatus: 'cancelling' });
}, /cancelled the conversation/);

test('interrupted transfer excluded by the remaining allowance is a correct resume', () => {
  const report = contributionReport();
  report.interruption.resumed = [];
  report.interruption.ledgerFinal = { maxBytes: 9 * 1048576, reservedBytes: 8637069 };
  assert.equal(assess(report).checks.interruptedResume.pass, true);
});

test('missing observations fail closed rather than throwing', () => {
  const result = assess({});
  assert.equal(result.automatedPass, false);
  assert.ok(Object.values(result.checks).every(check => check.pass === false));
});

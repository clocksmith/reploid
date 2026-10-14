import test from 'node:test';
import assert from 'node:assert/strict';
import { assessContribution } from './contribution-checks.mjs';
import { contributionReport, freeze } from './test-fixtures.mjs';

function rejects(name, check, mutate, pattern = null) {
  test(`rejects ${name}`, () => {
    const report = contributionReport(); mutate(report);
    const result = assessContribution(report, freeze);
    assert.equal(result.automatedPass, false);
    assert.equal(result.checks[check].pass, false, `${check} should reject ${name}`);
    if (pattern) assert.match(result.checks[check].failures.join('\n'), pattern);
    const others = Object.entries(result.checks).filter(([name, value]) => name !== check && !value.pass).map(([name]) => name);
    assert.deepEqual(others, [], 'each Launch 2 result is independent');
  });
}

test('coherent storage contribution evidence passes each separate check', () => {
  const result = assessContribution(contributionReport(), freeze);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(Object.keys(result.checks), ['sharedWhileChatting', 'peerAcquisition', 'reloadPreserved', 'competingTabs',
    'interruptedResume', 'cachedOnly', 'stopSettles']);
});

// Required: an overspent allowance and a cached-only acquisition request.
rejects('an overspent allowance across competing tabs', 'competingTabs', report => {
  report.contention.tabs[1].transfers.push({ key: 'piece-1', bytes: 4194304 });
  report.contention.ledgerAfter.reservedBytes = report.contention.allowanceBytes;
}, /overspent the allowance/);
rejects('a ledger reserved beyond its cap', 'competingTabs', report => { report.contention.ledgerAfter.reservedBytes = report.contention.allowanceBytes + 1; });
rejects('an uncharged transfer', 'competingTabs', report => { report.contention.ledgerAfter.reservedBytes -= 1; }, /not charged/);
rejects('tabs with different caps', 'competingTabs', report => { report.contention.tabs[1].budget.maxBytes = 1048576; });
rejects('a cached-only acquisition request', 'cachedOnly', report => {
  report.cachedOnly.requests.push({ url: 'http://127.0.0.1:8000/config/model-pieces/qwen-0-8b-pieces.json', weight: false });
}, /issued model-file acquisition requests/);
rejects('a cached-only custody acquisition', 'cachedOnly', report => { report.cachedOnly.receiptsAfter = 1; });
rejects('a cached-only ledger charge', 'cachedOnly', report => { report.cachedOnly.budgetAfter.reservedBytes += 4194304; });

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
  assert.equal(assessContribution(report, freeze).checks.interruptedResume.pass, true);
});

test('missing observations fail closed rather than throwing', () => {
  const result = assessContribution({}, freeze);
  assert.equal(result.automatedPass, false);
  assert.ok(Object.values(result.checks).every(check => check.pass === false));
});

// Runner-side helpers without a browser: model choice through a fake page, the request watcher
// through a fake context, and the interruption classifier feeding the interruptedResume check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SELECTORS, chooseOrderedModel, send, trackRequests, classifyInterruption, closeOtherTabs, transferBytes, withDeadline } from './harness.mjs';
import { interruptedResumeFailures, MIN_INTERRUPTED_PIECE_BYTES } from './contribution-checks.mjs';
import { selectionId } from './test-fixtures.mjs';

/** The rail starts closed (conversation-workspace.js:105); only the Choose model control opens it (:106). */
function fakePage({ controls = 1, opensRail = true } = {}) {
  const calls = []; let railOpen = false, value = '';
  const locator = selector => ({
    count: async () => selector === SELECTORS.openModel ? controls : 1,
    click: async () => { calls.push(['click', selector]); if (selector === SELECTORS.openModel && opensRail) railOpen = true; },
    waitFor: async ({ state }) => {
      calls.push(['waitFor', selector, state]);
      if (selector === SELECTORS.modelSelect && state === 'visible' && !railOpen) throw Error('Timeout 300000ms exceeded');
    },
    selectOption: async next => {
      calls.push(['selectOption', selector, next]);
      if (!railOpen) throw Error('locator.selectOption: element is not visible'); // run 2, harness.mjs:130
      value = next;
    },
    inputValue: async () => value
  });
  return { page: { locator }, calls };
}

test('model choice opens the thread rail through the Choose model control before selecting', async () => {
  const { page, calls } = fakePage();
  assert.equal(await chooseOrderedModel(page, selectionId, 1000), selectionId);
  const click = calls.findIndex(([kind, selector]) => kind === 'click' && selector === SELECTORS.openModel);
  const select = calls.findIndex(([kind]) => kind === 'selectOption');
  assert.ok(click >= 0 && select > click, 'Choose model is clicked before the select is used');
  assert.equal(SELECTORS.openModel, '[data-open-model]');
});
test('model choice fails clearly when the Choose model control is absent', async () => {
  const { page, calls } = fakePage({ controls: 0 });
  await assert.rejects(chooseOrderedModel(page, selectionId, 1000), /Choose model control \[data-open-model\] is absent; the model select in the closed thread rail cannot be reached/);
  assert.deepEqual(calls, [], 'nothing is clicked or selected');
});
test('model choice fails clearly when the control is ambiguous or the select stays hidden', async () => {
  await assert.rejects(chooseOrderedModel(fakePage({ controls: 2 }).page, selectionId, 1000), /is ambiguous \(2 found\)/);
  const { page, calls } = fakePage({ opensRail: false });
  await assert.rejects(chooseOrderedModel(page, selectionId, 1000), /stayed hidden after Choose model opened the thread rail/);
  assert.ok(!calls.some(([kind]) => kind === 'selectOption'));
});

/** Send creates the attempt; the review (request-approval.js) must be read before Approve is clicked. */
function fakeReviewPage({ reviewShown = true } = {}) {
  const calls = [], shown = { threadId: 't1', attemptId: 'a1', previewId: 'p1', recipientIds: ['peer:a', 'peer:b', 'peer:c'],
    recipientsText: 'Recipients: Computer 1 (stage 1 of 3), Computer 2 (stage 2 of 3), Computer 3 (stage 3 of 3)',
    scopeText: 'Sends this message. Computer 1 receives the text; Computer 2 and Computer 3 receive it as model tokens and intermediate results.',
    contentLabel: 'Review 1 message', contentText: 'user:\nquestion' };
  const locator = selector => ({
    fill: async text => calls.push(['fill', selector, text]),
    click: async () => calls.push(['click', selector]),
    waitFor: async ({ state } = {}) => {
      calls.push(['waitFor', selector, state ?? 'visible']);
      if (selector === SELECTORS.review && !reviewShown) throw Error('Timeout 1000ms exceeded');
    },
    evaluate: async (fn, selectors) => { calls.push(['read', selector]); assert.equal(selectors, SELECTORS); return structuredClone(shown); }
  });
  return { page: { locator }, calls, shown };
}
test('send records the displayed review, then clicks Approve; it never approves an unseen review', async () => {
  const { page, calls, shown } = fakeReviewPage();
  const record = await send(page, 'question', 1000);
  assert.deepEqual(Object.fromEntries(Object.keys(shown).map(key => [key, record[key]])), shown);
  assert.ok(record.shownAt <= record.approvedAt);
  const read = calls.findIndex(([kind]) => kind === 'read'), approve = calls.findIndex(([kind, selector]) => kind === 'click' && selector === SELECTORS.approve);
  const sent = calls.findIndex(([kind, selector]) => kind === 'click' && selector === SELECTORS.send);
  assert.ok(sent >= 0 && read > sent && approve > read, 'Send, then read the review, then Approve');
  assert.equal(SELECTORS.approve, '[data-chat-approval] [data-approval-approve]');
  const hidden = fakeReviewPage({ reviewShown: false });
  await assert.rejects(send(hidden.page, 'question', 1000), /Timeout/);
  assert.ok(!hidden.calls.some(([kind, selector]) => kind === 'click' && selector === SELECTORS.approve));
});

const MiB = 1048576, ORIGIN = 'http://127.0.0.1:29670';
function fakeRequest(page, range, url = `${ORIGIN}/qualification/capsule/artifacts/model/shard_00000.bin`) {
  return { url: () => url, headers: () => range ? { range } : {}, frame: () => ({ page: () => page }),
    sizes: async () => ({ responseBodySize: 0 }), failure: () => ({ errorText: 'net::ERR_ABORTED' }) };
}
test('request watcher resolves on the request event of the first matching large piece', async () => {
  const context = new EventEmitter(), page = {}, rows = [];
  const tracker = trackRequests(context, [], rows, 'interrupt'); tracker.name(page, 'interrupt-main');
  const large = tracker.next(row => row.page === 'interrupt-main' && row.weight && row.declaredBytes >= MIN_INTERRUPTED_PIECE_BYTES);
  let resolved = null; large.then(row => { resolved = row; });
  context.emit('request', fakeRequest(page, 'bytes=0-63'));
  context.emit('request', fakeRequest(page, 'bytes=64-575'));
  await Promise.resolve();
  assert.equal(resolved, null, 'small pieces do not trigger the reload');
  const big = fakeRequest(page, `bytes=576-${576 + 5 * MiB - 1}`);
  context.emit('request', big);
  const row = await withDeadline(large, 1000, 'watcher');
  assert.equal(row.declaredBytes, 5 * MiB); assert.equal(row.finished, false); assert.equal(row.failed, false);
  context.emit('requestfailed', big);
  assert.equal(row.failed, true); assert.equal(row.failure, 'net::ERR_ABORTED');
  await assert.rejects(withDeadline(new Promise(() => {}), 5, 'Piece of at least 1 MiB in flight'), /Piece of at least 1 MiB in flight deadline/);
});

// Rows in the tracker's shape; times are ISO strings like now().
const at = ms => new Date(Date.UTC(2026, 9, 14, 3, 52, 56) + ms).toISOString();
const row = (start, end, range, { failed = false, url, declared } = {}) => {
  const bytes = /^bytes=(\d+)-(\d+)$/.exec(range || '');
  return { label: 'interrupt', page: 'interrupt-main', at: at(start), url: url ?? `${ORIGIN}/qualification/capsule/artifacts/model/shard_00000.bin`,
    weight: !url, range, declaredBytes: declared ?? (bytes ? Number(bytes[2]) - Number(bytes[1]) + 1 : null), responseBytes: url ? 222286 : null,
    finished: end !== null && !failed, failed, finishedAt: end === null ? null : at(end), failure: failed ? 'net::ERR_ABORTED' : null };
};
const LARGE = 'bytes=1152-5254399'; // 5,253,248 bytes, the first piece of at least 1 MiB in run 2
function scenario({ reloadMs, largeEndMs, largeFailed }) {
  const rows = [row(0, 10, null, { url: `${ORIGIN}/config/model-manifests/${'a'.repeat(64)}.json` }),
    row(20, 27, 'bytes=0-63'), row(30, 37, 'bytes=64-575'), row(40, 47, 'bytes=576-639'), row(50, 57, 'bytes=640-1151'),
    row(60, largeEndMs, LARGE, { failed: largeFailed })];
  const resumedSince = at(2000);
  rows.push(row(2100, 2200, LARGE), row(2210, 2220, 'bytes=5254400-5254463'));
  return { rows, target: rows[5], reloadAt: at(reloadMs), resumedSince };
}
const charge = shape => [...shape.completedBefore, ...shape.completedDuringInterruption, ...shape.interrupted, ...shape.unattributed, ...shape.resumed]
  .reduce((total, item) => total + item.bytes, 0);
const offered = [{ path: `piece-${'8'.repeat(64)}.bin`, hash: '8'.repeat(64), sizeBytes: 64, hashAlgorithm: 'sha256' }];
// Origin as the only supplier (run-contribution.mjs): earlier tabs closed, no offering peer, no custody receipt.
const originOnly = { isolation: { keep: [], closed: [], remainingOpen: [] }, peerTransfers: [],
  suppliers: { observationMs: 3000, before: [{ connected: [], offering: [] }], after: [{ connected: [], offering: [] }] } };
const assessShape = (shape, extraCharge = 0) => interruptedResumeFailures({ minimumInFlightBytes: MIN_INTERRUPTED_PIECE_BYTES, ledgerBefore: null, ...originOnly, ...shape,
  ledgerFinal: { maxBytes: 13 * MiB, reservedBytes: charge(shape) + extraCharge }, final: { sharing: true, error: '', offered } }, { supplierObservationMs: 3000 });

test('a reload issued while the large piece transfers is caught, resumed and charged exactly once per transfer', () => {
  const { rows, ...options } = scenario({ reloadMs: 63, largeEndMs: 70, largeFailed: true });
  const shape = classifyInterruption(rows, options);
  assert.equal(shape.inFlightAtReload.outcome, 'aborted');
  assert.equal(shape.inFlightAtReload.bytes, 5253248);
  assert.deepEqual(shape.interrupted.map(item => item.key), [`${options.target.url}#${LARGE}`]);
  assert.equal(shape.completedBefore.length, 5); assert.deepEqual(shape.completedDuringInterruption, []);
  const listed = shape.completedBefore.length + shape.completedDuringInterruption.length + shape.interrupted.length + shape.unattributed.length + shape.resumed.length;
  assert.equal(listed, rows.length, 'every row lands in exactly one list');
  assert.deepEqual(assessShape(shape), []);
  assert.match(assessShape(shape, 64).join('\n'), /double charge/);
  assert.match(assessShape(shape, -64).join('\n'), /not charged/);
});
test('an unsettled large piece at the reload also counts as caught in flight', () => {
  const { rows, ...options } = scenario({ reloadMs: 63, largeEndMs: null, largeFailed: false });
  const shape = classifyInterruption(rows, options);
  assert.equal(shape.inFlightAtReload.outcome, 'unsettled');
  assert.deepEqual(assessShape(shape), []);
});
test('an interruption whose reload lost the race fails instead of passing on small pieces', () => {
  // The large piece finished before the reload took effect, as every piece did in run 2.
  const { rows, ...options } = scenario({ reloadMs: 63, largeEndMs: 62, largeFailed: false });
  rows.splice(6, 1); // a completed piece is not acquired again
  const shape = classifyInterruption(rows, options);
  assert.equal(shape.inFlightAtReload.outcome, 'completed');
  assert.deepEqual(shape.interrupted, []);
  assert.equal(shape.completedDuringInterruption.length, 1);
  const failures = assessShape(shape).join('\n');
  assert.match(failures, /never caught an in-flight piece of at least 1 MiB/);
  assert.match(failures, /No in-flight transfer was interrupted/);
});
test('every earlier tab except a kept supplier is closed before the interruption, even if unreadable', async () => {
  const tab = (name, files, { closed = false, refuses = false } = {}) => ({ name, page: { files,
    isClosed: () => closed, close: async () => { if (refuses) throw Error('Target page, context or browser has been closed'); closed = true; } } });
  const observe = async page => { if (!page.files) throw Error('Host session listener unavailable'); return page.files; };
  const tabs = [tab('supplier-main', { sharing: true }, { closed: true }), tab('contention-0', { sharing: true }),
    tab('contention-1', null), tab('stop-main', { sharing: false }), tab('kept', { sharing: true })];
  const isolated = await closeOtherTabs(tabs, { keep: ['kept'], observe });
  assert.deepEqual(isolated.closed.map(row => [row.name, row.sharing]), [['contention-0', true], ['contention-1', null], ['stop-main', false]]);
  assert.deepEqual(isolated.remainingOpen, []); assert.deepEqual(isolated.keep, ['kept']);
  assert.equal(tabs[4].page.isClosed(), false);
  const stuck = await closeOtherTabs([tab('contention-0', { sharing: true }, { refuses: true })], { observe });
  assert.deepEqual(stuck.remainingOpen, ['contention-0']);
});
test('transfer size of an aborted range uses its declared bytes', () => {
  assert.equal(transferBytes({ declaredBytes: 5253248, responseBytes: null }), 5253248);
});

// Launch 2 storage contribution checks. Each result is separate. Observations come
// from the application's own owners: self/host/work-model-files.js getState()
// (lines 70-76), getReceipts() (line 447), the custody exchange offer list
// (packages/reploid/src/artifacts/custody/exchange.js:282-291) and the shared
// acquisition ledger state {maxBytes,reservedBytes}.
import { completedAttemptFailures } from './checks.mjs';

const PIECE = /^piece-([a-f0-9]{64})\.bin$/;
const ACTIVE = new Set(['queued', 'loading', 'executing', 'approval']);
const hex = value => String(value || '').replace(/^sha256:/, '');
function checker() { const failures = []; return { failures, require(ok, reason) { if (!ok) failures.push(reason); } }; }
const run = fn => { try { return fn(); } catch (error) { return [`observation missing or malformed: ${error.message}`]; } };
const sum = values => values.reduce((total, value) => total + value, 0);

export function offeredPieces(offered) {
  return (Array.isArray(offered) ? offered : []).filter(item => PIECE.test(item?.path || ''));
}
const pieceHashes = offered => new Set(offeredPieces(offered).map(item => hex(item.hash)));
const validBudget = budget => Number.isSafeInteger(budget?.maxBytes) && budget.maxBytes > 0
  && Number.isSafeInteger(budget.reservedBytes) && budget.reservedBytes >= 0;
const settledFiles = files => files && files.sharing === false && files.preparing === false && files.stopping === false && files.pending === 0;
const allowanceError = text => /allowance|exhausted|No verified model pieces/i.test(String(text || ''));

export const CONTRIBUTION_REQUIREMENTS = Object.freeze({
  sharedWhileChatting: ['REP-5 docs/roadmap/requirements.md:304,321', 'ROADMAP.md:29,88'],
  peerAcquisition: ['REP-5 docs/roadmap/requirements.md:302,312'],
  reloadPreserved: ['REP-5 docs/roadmap/requirements.md:321,323', 'ROADMAP.md:29,92'],
  competingTabs: ['REP-5 docs/roadmap/requirements.md:321', 'ROADMAP.md:29,92'],
  interruptedResume: ['REP-5 docs/roadmap/requirements.md:321,323', 'REP-4 docs/roadmap/requirements.md:272'],
  cachedOnly: ['REP-5 docs/roadmap/requirements.md:320', 'ROADMAP.md:92'],
  stopSettles: ['ROADMAP.md:29,93', 'REP-4 docs/roadmap/requirements.md:272', 'REP-1 docs/roadmap/requirements.md:393']
});

/** (a) A participant shares a small verified subset while its own conversation runs. */
export function sharedWhileChattingFailures(share, freeze) {
  const { failures, require } = checker(), pieces = offeredPieces(share?.offered);
  require(share?.mode === 'bounded-acquisition' && share.files?.mode === 'bounded-acquisition', 'Subset was not acquired in bounded-acquisition mode');
  require(share?.files?.sharing === true && !share.files.error, 'File contribution is not sharing');
  require(pieces.length > 0 && pieces.every(item => item.path === `piece-${hex(item.hash)}.bin` && item.hashAlgorithm === 'sha256'
    && Number.isSafeInteger(item.sizeBytes) && item.sizeBytes > 0), 'No verified piece is offered');
  const bytes = sum(pieces.map(item => item.sizeBytes));
  require(bytes <= share?.allowanceBytes && bytes <= share?.files?.limits?.subsetBytes, 'Offered subset exceeds the approved allowance or subset limit');
  require(validBudget(share?.files?.acquisitionBudget) && share.files.acquisitionBudget.maxBytes === share.allowanceBytes
    && share.files.acquisitionBudget.reservedBytes <= share.allowanceBytes, 'Acquisition allowance missing, renewed or overspent');
  require((share?.samples || []).some(sample => ACTIVE.has(sample.attemptStatus) && (sample.filesPreparing || sample.filesSharing)),
    'File contribution did not overlap an active conversation');
  require(!(share?.samples || []).some(sample => ['cancelling', 'cancelled'].includes(sample.attemptStatus)), 'Conversation was cancelled during file contribution');
  const final = share?.chat?.final, attempt = final?.attempts?.find(item => item.id === share?.chat?.attemptId);
  require(final?.attempts?.at(-1)?.id === share?.chat?.attemptId, 'Conversation attempt was replaced');
  failures.push(...completedAttemptFailures(final, attempt, freeze, 'Sharer conversation'));
  return failures;
}

/** (b) Another computer acquires those exact pieces from the sharer, not from origin. */
export function peerAcquisitionFailures(peer, shared) {
  const { failures, require } = checker(), offered = pieceHashes(shared?.offered);
  require(peer?.supplier?.machine && peer.acquirer?.machine && peer.supplier.machine !== peer.acquirer.machine, 'Acquirer is not another computer');
  require(typeof peer?.supplier?.transportId === 'string' && peer.supplier.transportId.length > 0, 'Sharer transport identity unobserved');
  const fromSharer = (peer?.acquirer?.receipts || []).filter(receipt => (receipt.completed || []).some(item => offered.has(hex(item.hash))));
  require(fromSharer.length > 0, 'Acquirer completed none of the shared pieces');
  for (const receipt of fromSharer) {
    const accepted = (receipt.attempts || []).filter(item => item.status === 'accepted');
    require(!receipt.failure && ['peer', 'cache-and-peer'].includes(receipt.source) && receipt.receivedBytes > 0, 'Shared piece was not received from a peer');
    require(accepted.length > 0 && accepted.every(item => item.peerId === peer.supplier.transportId), 'Shared piece was supplied by another peer');
  }
  require(Array.isArray(peer?.acquirer?.weightRequests) && peer.acquirer.weightRequests.length === 0, 'Acquirer fetched weights over HTTP during peer acquisition');
  const bytes = sum(fromSharer.flatMap(receipt => receipt.completed.filter(item => offered.has(hex(item.hash))).map(item => item.sizeBytes)));
  require(peer?.supplier?.suppliedBytesAfter - peer?.supplier?.suppliedBytesBefore >= bytes && bytes > 0, 'Sharer supply accounting does not cover the transferred pieces');
  return failures;
}

/** (c) Reload rebuilds the verified inventory and keeps consumed allowance. */
export function reloadPreservedFailures(reload) {
  const { failures, require } = checker(), before = pieceHashes(reload?.before?.offered), after = pieceHashes(reload?.after?.offered);
  require(before.size > 0, 'No verified inventory before reload');
  require([...before].every(hash => after.has(hash)), 'Reload lost verified inventory');
  require(validBudget(reload?.before?.budget) && validBudget(reload?.after?.budget), 'Consumed allowance unobserved before or after reload');
  require(reload?.after?.budget?.maxBytes === reload?.before?.budget?.maxBytes, 'Reload renewed or changed the allowance cap');
  require(reload?.after?.budget?.reservedBytes >= reload?.before?.budget?.reservedBytes, 'Reload reset consumed allowance');
  require(reload?.after?.mode === 'cached-only' && Array.isArray(reload.after.requests) && reload.after.requests.length === 0,
    'Inventory was not rebuilt from the cache alone');
  return failures;
}

/** (d) Two tabs sharing one origin ledger cannot spend beyond it; every transfer is charged. */
export function competingTabsFailures(contention) {
  const { failures, require } = checker(), tabs = contention?.tabs || [];
  const before = contention?.ledgerBefore?.reservedBytes ?? 0, after = contention?.ledgerAfter;
  const transferred = sum(tabs.flatMap(tab => (tab.transfers || []).map(item => item.bytes)));
  require(tabs.length === 2 && tabs.every(tab => tab.instanceId) && new Set(tabs.map(tab => tab.instanceId)).size === 2, 'Two independent tabs required');
  require(validBudget(after) && after.maxBytes === contention.allowanceBytes, 'Shared ledger missing or its cap changed');
  require(tabs.every(tab => tab.budget?.maxBytes === contention.allowanceBytes), 'Tabs did not share one allowance cap');
  require(after?.reservedBytes <= after?.maxBytes, 'Ledger reservations exceed the allowance');
  require(before + transferred <= contention?.allowanceBytes, 'Observed transfers overspent the allowance');
  require(transferred <= after?.reservedBytes - before, 'A transfer was not charged to the shared ledger');
  require(tabs.every(tab => (tab.transfers || []).length > 0 || allowanceError(tab.outcome?.error)), 'A tab neither acquired nor reported the allowance limit');
  require(tabs.every(tab => (tab.transfers || []).every(item => Number.isSafeInteger(item.bytes) && item.bytes > 0)), 'Transfer sizes unobserved');
  return failures;
}

/** (d) An interrupted acquisition resumes without re-downloading verified pieces and keeps its charge. */
export function interruptedResumeFailures(interruption) {
  const { failures, require } = checker(), i = interruption;
  const completed = new Set((i?.completedBefore || []).map(item => item.key));
  const resumed = i?.resumed || [];
  require((i?.interrupted || []).length > 0, 'No in-flight transfer was interrupted');
  require(completed.size > 0, 'No transfer had completed before the interruption');
  require(!resumed.some(item => completed.has(item.key)), 'A piece verified before the interruption was downloaded again');
  // work-model-files.js:420-422 skips a piece the remaining allowance cannot cover; that is a correct resume.
  const remaining = validBudget(i?.ledgerFinal) ? i.ledgerFinal.maxBytes - i.ledgerFinal.reservedBytes : -1;
  require((i?.interrupted || []).every(item => resumed.some(next => next.key === item.key && next.finished) || item.bytes > remaining),
    'Interrupted transfer was neither resumed to completion nor excluded by the remaining allowance');
  const all = [...(i?.completedBefore || []), ...(i?.interrupted || []), ...resumed];
  require(all.every(item => Number.isSafeInteger(item.bytes) && item.bytes > 0), 'Transfer sizes unobserved');
  require(validBudget(i?.ledgerFinal) && i.ledgerFinal.reservedBytes <= i.ledgerFinal.maxBytes, 'Ledger overspent after resume');
  require(i?.ledgerFinal?.reservedBytes - (i?.ledgerBefore?.reservedBytes ?? 0) >= sum(all.map(item => item.bytes)), 'Interrupted or retried transfer was not charged');
  require(i?.final?.sharing === true && offeredPieces(i.final.offered).length > 0, 'Resumed contribution does not share its verified pieces');
  return failures;
}

/** (e) Cached-only mode never acquires metadata or pieces. */
export function cachedOnlyFailures(cached) {
  const { failures, require } = checker();
  require(cached?.mode === 'cached-only' && cached.files?.mode === 'cached-only', 'Cached-only mode was not selected');
  require(Array.isArray(cached?.requests) && cached.requests.length === 0, 'Cached-only mode issued model-file acquisition requests');
  require(Number.isSafeInteger(cached?.receiptsBefore) && cached.receiptsAfter === cached.receiptsBefore, 'Cached-only mode created a custody acquisition');
  require(JSON.stringify(cached?.budgetAfter ?? null) === JSON.stringify(cached?.budgetBefore ?? null), 'Cached-only mode changed the acquisition ledger');
  require(cached?.files?.pending === 0, 'Cached-only mode left a transfer pending');
  return failures;
}

/** (f) Stopping file contribution settles its transfers and leaves the conversation running. */
export function stopSettlesFailures(stop, freeze) {
  const { failures, require } = checker();
  require(stop?.inFlightAtStop?.filesPreparing === true && stop.inFlightAtStop.pendingRequests > 0, 'No acquisition was in flight when contribution stopped');
  require(settledFiles(stop?.filesAfter), 'Stopped contribution did not settle its transfers');
  require(validBudget(stop?.budgetBefore) && validBudget(stop?.budgetAfter) && stop.budgetAfter.maxBytes === stop.budgetBefore.maxBytes
    && stop.budgetAfter.reservedBytes >= stop.budgetBefore.reservedBytes, 'Stopping refunded, renewed or lost incurred charges');
  require(stop?.requestsAfterSettled === 0, 'Acquisition continued after contribution settled');
  const samples = stop?.chat?.samples || [], at = Date.parse(stop?.stopClickedAt);
  require(samples.some(sample => Date.parse(sample.at) <= at && ACTIVE.has(sample.attemptStatus)), 'Conversation was not active when contribution stopped');
  require(!samples.some(sample => ['cancelling', 'cancelled'].includes(sample.attemptStatus)), 'Stopping contribution cancelled the conversation');
  const final = stop?.chat?.final, attempt = final?.attempts?.find(item => item.id === stop?.chat?.attemptId);
  require(final?.attempts?.at(-1)?.id === stop?.chat?.attemptId, 'Conversation attempt was replaced');
  failures.push(...completedAttemptFailures(final, attempt, freeze, 'Conversation after stop'));
  return failures;
}

export function assessContribution(report, freeze) {
  const results = {
    sharedWhileChatting: run(() => sharedWhileChattingFailures(report.share, freeze)),
    peerAcquisition: run(() => peerAcquisitionFailures(report.peer, report.share)),
    reloadPreserved: run(() => reloadPreservedFailures(report.reload)),
    competingTabs: run(() => competingTabsFailures(report.contention)),
    interruptedResume: run(() => interruptedResumeFailures(report.interruption)),
    cachedOnly: run(() => cachedOnlyFailures(report.cachedOnly)),
    stopSettles: run(() => stopSettlesFailures(report.stop, freeze))
  };
  const checks = Object.fromEntries(Object.entries(results).map(([name, failures]) => [name,
    { pass: failures.length === 0, failures, requirements: CONTRIBUTION_REQUIREMENTS[name] }]));
  const failures = Object.entries(checks).flatMap(([name, check]) => check.failures.map(reason => `${name}: ${reason}`));
  return { automatedPass: failures.length === 0, failures, checks };
}

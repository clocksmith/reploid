// Launch 2 storage contribution checks. Each result is separate. Observations come
// from the application's own owners: self/host/work-model-files.js getState()
// (lines 70-76), getReceipts() (line 447), the custody exchange offer list
// (packages/reploid/src/artifacts/custody/exchange.js:282-291) and the shared
// acquisition ledger state {maxBytes,reservedBytes}.
import { completedAttemptFailures } from './checks.mjs';

// The single-owner lock's exact refusal (self/host/work-peer-offers.js:20-21). Contract decision: one
// connected tab per browser profile (README, "Contract decision").
export const SINGLE_OWNER_REFUSAL = 'Another tab owns this peer connection';
// The interruption must catch a piece at least this large in flight; the first indexed pieces
// (64 and 512 bytes) finish over loopback before any reload.
export const MIN_INTERRUPTED_PIECE_BYTES = 1048576;
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

/** (c) Reload rebuilds the verified inventory and keeps consumed allowance, with the sharer profile's
 * only tab (one connected tab per profile). */
export function reloadPreservedFailures(reload) {
  const { failures, require } = checker(), before = pieceHashes(reload?.before?.offered), after = pieceHashes(reload?.after?.offered);
  require(reload?.profilePages === 1, 'Reload was observed while another tab of the sharer profile was open');
  require(before.size > 0, 'No verified inventory before reload');
  require([...before].every(hash => after.has(hash)), 'Reload lost verified inventory');
  require(validBudget(reload?.before?.budget) && validBudget(reload?.after?.budget), 'Consumed allowance unobserved before or after reload');
  require(reload?.after?.budget?.maxBytes === reload?.before?.budget?.maxBytes, 'Reload renewed or changed the allowance cap');
  require(reload?.after?.budget?.reservedBytes >= reload?.before?.budget?.reservedBytes, 'Reload reset consumed allowance');
  require(reload?.after?.mode === 'cached-only' && Array.isArray(reload.after.requests) && reload.after.requests.length === 0,
    'Inventory was not rebuilt from the cache alone');
  return failures;
}

/** (d) Two tabs of one browser profile compete for one ledger. The second tab must be refused by the
 * single-owner lock; the profile ledger stays within its allowance and charges exactly the observed
 * transfers, none twice. A second tab that connects, or any overspend, fails. */
export function competingTabsFailures(contention) {
  const { failures, require } = checker(), owner = contention?.owner, second = contention?.second;
  const allowance = contention?.allowanceBytes, samples = second?.samples || [];
  const transfers = [...(owner?.transfers || []), ...(second?.transfers || [])];
  const before = contention?.ledgerBefore?.reservedBytes ?? 0, after = contention?.ledgerAfter;
  const transferred = sum(transfers.map(item => item.bytes)), charged = after?.reservedBytes - before;
  require(!!owner && !!second && typeof owner.profile === 'string' && owner.profile.length > 0 && owner.profile === second.profile
    && owner.name !== second.name, 'Two tabs of one browser profile required');
  require(typeof owner?.consumerPeerId === 'string' && owner.consumerPeerId.length > 0, 'First tab did not connect as the profile owner');
  require(samples.length > 0 && samples.every(sample => sample.consumerPeerId === null && sample.custodyOwner === false),
    'Second tab of the profile connected; the single-owner lock was not enforced');
  // A retry clears the error before it is refused again (work-swarm.js:162,210), so a sample may show none.
  require(samples.some(sample => sample.error === SINGLE_OWNER_REFUSAL) && samples.every(sample => sample.error === null || sample.error === SINGLE_OWNER_REFUSAL),
    `Second tab was not explicitly refused by the single-owner lock ("${SINGLE_OWNER_REFUSAL}")`);
  require(Array.isArray(second?.transfers) && second.transfers.length === 0, 'Refused tab transferred model files');
  require(validBudget(after) && after.maxBytes === allowance, 'Profile ledger missing or its cap changed');
  require(owner?.budget?.maxBytes === allowance && validBudget(second?.ledgerAfter) && second.ledgerAfter.maxBytes === after?.maxBytes
    && second.ledgerAfter.reservedBytes === after?.reservedBytes, 'Tabs did not read one profile ledger and allowance cap');
  const ledgers = [contention?.ledgerBefore, ...(contention?.ledgerSamples || []), after].filter(value => value !== null && value !== undefined);
  require(ledgers.every(validBudget) && ledgers.every((value, index) => index === 0 || value.reservedBytes >= ledgers[index - 1].reservedBytes),
    'Profile ledger samples unobserved or decreasing');
  require(ledgers.every(value => value.reservedBytes <= allowance) && after?.reservedBytes <= after?.maxBytes, 'Ledger reservations exceed the allowance');
  require(before + transferred <= allowance, 'Observed transfers overspent the allowance');
  require(transferred <= charged, 'A transfer was not charged to the profile ledger');
  require(charged <= transferred, 'Ledger charged more than the observed transfers (a charge was made twice or without a transfer)');
  const finished = transfers.filter(item => item.finished).map(item => item.key);
  require(new Set(finished).size === finished.length, 'A model file was transferred to completion twice');
  require((owner?.transfers || []).length > 0 || allowanceError(owner?.outcome?.error), 'Owner tab neither acquired nor reported the allowance limit');
  require(transfers.every(item => Number.isSafeInteger(item.bytes) && item.bytes > 0), 'Transfer sizes unobserved');
  return failures;
}

/** (d) A reload that catches a piece of at least 1 MiB in flight; the acquisition resumes without
 * re-downloading verified pieces, keeps every charge and charges nothing twice. Origin is the only
 * intended supplier: every other harness tab is closed, no connected peer offers files for the frozen
 * window before the acquisition or after the resume, and no custody receipt (peer transfer) appears.
 * A peer transfer before the reload ends with the page, so it could only show as a ledger excess. */
export function interruptedResumeFailures(interruption, fixture) {
  const { failures, require } = checker(), i = interruption;
  const isolation = i?.isolation, suppliers = i?.suppliers, minimum = fixture?.supplierObservationMs;
  require(Array.isArray(isolation?.closed) && Array.isArray(isolation.remainingOpen) && isolation.remainingOpen.length === 0
    && Array.isArray(isolation.keep) && isolation.keep.length === 0, 'A tab that could supply pieces was not closed before the interruption');
  const samples = [...(suppliers?.before || []), ...(suppliers?.after || [])];
  require(Number.isSafeInteger(minimum) && minimum > 0 && suppliers?.observationMs >= minimum
    && suppliers.before?.length > 0 && suppliers.after?.length > 0, 'Supplier offers unobserved for the frozen window before the acquisition or after the resume');
  require(samples.every(sample => Array.isArray(sample?.offering) && sample.offering.length === 0),
    'Another supplier was offering model files to the interrupted acquisition');
  require(Array.isArray(i?.peerTransfers) && i.peerTransfers.length === 0, 'An unintended supplier served pieces to the interrupted acquisition');
  const completed = new Set((i?.completedBefore || []).map(item => item.key));
  const resumed = i?.resumed || [], target = i?.inFlightAtReload;
  require(target?.weight === true && Number.isSafeInteger(target.bytes) && target.bytes >= MIN_INTERRUPTED_PIECE_BYTES
    && typeof target.startedAt === 'string' && typeof i?.reloadAt === 'string' && target.startedAt <= i.reloadAt
    && ['aborted', 'unsettled'].includes(target.outcome), 'Interruption never caught an in-flight piece of at least 1 MiB');
  require((i?.interrupted || []).some(item => item.key === target?.key), 'The piece in flight at the reload is not among the interrupted transfers');
  require((i?.interrupted || []).length > 0, 'No in-flight transfer was interrupted');
  require(completed.size > 0, 'No transfer had completed before the interruption');
  require(!resumed.some(item => completed.has(item.key)), 'A piece verified before the interruption was downloaded again');
  // work-model-files.js:420-422 skips a piece the remaining allowance cannot cover; that is a correct resume.
  const remaining = validBudget(i?.ledgerFinal) ? i.ledgerFinal.maxBytes - i.ledgerFinal.reservedBytes : -1;
  require((i?.interrupted || []).every(item => resumed.some(next => next.key === item.key && next.finished) || item.bytes > remaining),
    'Interrupted transfer was neither resumed to completion nor excluded by the remaining allowance');
  const all = [...(i?.completedBefore || []), ...(i?.completedDuringInterruption || []), ...(i?.interrupted || []),
    ...(i?.unattributed || []), ...resumed];
  require(all.every(item => Number.isSafeInteger(item.bytes) && item.bytes > 0), 'Transfer sizes unobserved');
  require(validBudget(i?.ledgerFinal) && i.ledgerFinal.reservedBytes <= i.ledgerFinal.maxBytes, 'Ledger overspent after resume');
  const charged = i?.ledgerFinal?.reservedBytes - (i?.ledgerBefore?.reservedBytes ?? 0), observed = sum(all.map(item => item.bytes));
  require(charged >= observed, 'Interrupted or retried transfer was not charged');
  // Each piece is reserved immediately before its own request (work-model-files.js:155-158).
  require(charged <= observed, 'Ledger charged more than the observed transfers (double charge)');
  require(i?.final?.sharing === true && offeredPieces(i.final.offered).length > 0, 'Resumed contribution does not share its verified pieces');
  return failures;
}

/** (e) Cached-only mode in the sharer's own profile never acquires metadata or pieces. One tab at a
 * time: the sharer tab closed first, the next tab of the profile connected normally (lock released),
 * and every model-file request of that tab's lifetime counts. Its inventory comes only from the
 * profile's verified cache. */
export function cachedOnlyFailures(cached, fixture) {
  const { failures, require } = checker(), sharer = cached?.sharer, tab = cached?.tab, lock = tab?.lockSamples || [];
  const at = value => typeof value === 'string' ? Date.parse(value) : NaN, window = cached?.window || {};
  require(Number.isFinite(at(sharer?.closedAt)) && at(sharer.closedAt) <= at(tab?.openedAt) && tab?.profilePages === 1,
    'Cached-only tab was opened while another tab of the sharer profile was open');
  require(lock.length > 0 && !lock.some(sample => sample.error === SINGLE_OWNER_REFUSAL)
    && lock.some(sample => typeof sample.consumerPeerId === 'string' && sample.consumerPeerId.length > 0 && sample.custodyOwner === true),
  'Next tab of the sharer profile did not connect normally; the single-owner lock was not released');
  require(cached?.mode === 'cached-only' && cached.files?.mode === 'cached-only', 'Cached-only mode was not selected');
  require(Array.isArray(cached?.requests) && cached.requests.length === 0, 'Cached-only mode issued model-file acquisition requests');
  const minimum = fixture?.cachedOnlyObservationMs;
  require(Number.isSafeInteger(minimum) && minimum > 0 && cached?.observationMs >= minimum
    && [window.openedAt, window.startedAt, window.outcomeAt, window.endedAt].map(at).every((value, index, all) => Number.isFinite(value) && (index === 0 || value >= all[index - 1]))
    && window.openedAt === tab?.openedAt, 'Cached-only observation window incomplete');
  require(Number.isSafeInteger(cached?.receiptsBefore) && cached.receiptsAfter === cached.receiptsBefore, 'Cached-only mode created a custody acquisition');
  require(validBudget(cached?.budgetBefore) && JSON.stringify(cached?.budgetAfter ?? null) === JSON.stringify(cached.budgetBefore),
    'Cached-only mode changed the acquisition ledger');
  require(cached?.files?.pending === 0 && Array.isArray(cached?.samples) && cached.samples.length > 0
    && cached.samples.every(sample => sample.pending === 0 && !sample.preparing), 'Cached-only mode left a transfer pending');
  const verified = pieceHashes(sharer?.offered), restored = offeredPieces(cached?.offered);
  require(verified.size > 0, 'No verified sharer inventory was observed before the sharer tab closed');
  require(restored.length > 0 && restored.every(item => item.path === `piece-${hex(item.hash)}.bin` && item.hashAlgorithm === 'sha256' && verified.has(hex(item.hash)))
    && [...verified].every(hash => restored.some(item => hex(item.hash) === hash)),
  'Cached-only inventory was not restored only from the verified local cache');
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

export function assessContribution(report, freeze, fixture) {
  const results = {
    sharedWhileChatting: run(() => sharedWhileChattingFailures(report.share, freeze)),
    peerAcquisition: run(() => peerAcquisitionFailures(report.peer, report.share)),
    reloadPreserved: run(() => reloadPreservedFailures(report.reload)),
    competingTabs: run(() => competingTabsFailures(report.contention)),
    interruptedResume: run(() => interruptedResumeFailures(report.interruption, fixture)),
    cachedOnly: run(() => cachedOnlyFailures(report.cachedOnly, fixture)),
    stopSettles: run(() => stopSettlesFailures(report.stop, freeze))
  };
  const checks = Object.fromEntries(Object.entries(results).map(([name, failures]) => [name,
    { pass: failures.length === 0, failures, requirements: CONTRIBUTION_REQUIREMENTS[name] }]));
  const failures = Object.entries(checks).flatMap(([name, check]) => check.failures.map(reason => `${name}: ${reason}`));
  return { automatedPass: failures.length === 0, failures, checks };
}

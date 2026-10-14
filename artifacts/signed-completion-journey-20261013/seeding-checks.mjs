// Launch 2 explicit full-model seeding checks (REP-5 "Explicit full-model seeding",
// docs/roadmap/requirements.md:322). Each result is separate. Observations come from the
// application's own owners: self/host/work-model-files.js getState(), the custody exchange
// offer list and receipts, and the shared acquisition ledger state {maxBytes,reservedBytes}.
// Bounded sharing keeps its own checks in contribution-checks.mjs.
import { completedAttemptFailures } from './checks.mjs';

const PIECE = /^piece-[a-f0-9]{64}\.bin$/;
const ACTIVE = new Set(['queued', 'loading', 'executing']);
const hex = value => String(value || '').replace(/^sha256:/, '');
function checker() { const failures = []; return { failures, require(ok, reason) { if (!ok) failures.push(reason); } }; }
const run = fn => { try { return fn(); } catch (error) { return [`observation missing or malformed: ${error.message}`]; } };
const sum = values => values.reduce((total, value) => total + value, 0);
const rowBytes = row => Math.max(row.declaredBytes ?? 0, row.responseBytes ?? 0);
const validBudget = budget => Number.isSafeInteger(budget?.maxBytes) && budget.maxBytes > 0
  && Number.isSafeInteger(budget.reservedBytes) && budget.reservedBytes >= 0;
const settled = files => files && files.sharing === false && files.preparing === false && files.stopping === false && files.pending === 0;
const hashesOf = offered => new Set((Array.isArray(offered) ? offered : []).map(item => hex(item?.hash)));
const wholeWeights = (offered, catalog) => {
  const weights = new Set(catalog.filter(file => file.role === 'model-weights').map(file => hex(file.hash)));
  return (Array.isArray(offered) ? offered : []).filter(item => !PIECE.test(item?.path || '') && weights.has(hex(item?.hash)));
};

export const SEEDING_REQUIREMENTS = Object.freeze({
  refusedWithoutAllowance: ['REP-5 docs/roadmap/requirements.md:322'],
  scopeVisibleBeforeApproval: ['REP-5 docs/roadmap/requirements.md:322'],
  seededWhole: ['REP-5 docs/roadmap/requirements.md:316,322,323', 'ROADMAP.md:29'],
  peerAcquiresWholeModel: ['REP-5 docs/roadmap/requirements.md:316,322'],
  reloadRebuildsWhole: ['REP-5 docs/roadmap/requirements.md:320,323'],
  boundedDoesNotImplySeeding: ['REP-5 docs/roadmap/requirements.md:321,322'],
  stopSettlesSeeding: ['ROADMAP.md:29', 'REP-4 docs/roadmap/requirements.md:272']
});

/** Sizes the person can read, in bytes: every "<number> GiB|MiB|GB|MB" in the text. */
export function displayedSizes(text) {
  const units = { gib: 1073741824, mib: 1048576, gb: 1e9, mb: 1e6 };
  return [...String(text || '').matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(GiB|MiB|GB|MB)\b/gi)]
    .map(match => Number(match[1].replaceAll(',', '')) * units[match[2].toLowerCase()]);
}
/** Bytes the seed stores and may download: every catalog file of the model. */
export const catalogBytes = catalog => sum((catalog || []).map(file => file.sizeBytes));

/** (r) Without a sufficient separate allowance the full-model start is refused and nothing heavy moves. */
export function refusalFailures(refusal, fixture) {
  const { failures, require } = checker();
  require(String(refusal?.files?.error || '').includes(fixture.refusalText), 'Full-model start was not refused for its allowance');
  require(refusal?.files?.sharing !== true, 'Refused seeding is sharing');
  require(!(refusal?.offered || []).length, 'Refused seeding offers files');
  require((refusal?.requests || []).every(row => !row.weight), 'Refused seeding downloaded model weights');
  require(validBudget(refusal?.ledger) && refusal.ledger.maxBytes === refusal.allowanceBytes
    && refusal.ledger.reservedBytes <= refusal.allowanceBytes, 'Refusal ledger missing, renewed or overspent');
  return failures;
}

/** (v) Before switching seeding on, the controls state how much the full model stores and downloads. */
export function scopeFailures(report) {
  const { failures, require } = checker(), scope = report?.scopeBeforeApproval, total = catalogBytes(report?.catalog);
  require(scope?.mode === 'full-model', 'Full-model mode was not selected when the scope was read');
  require(total > 0, 'Catalog file sizes unobserved');
  const text = [scope?.limits, scope?.policy, scope?.progress].filter(Boolean).join(' ');
  // Rounded display: within 1 % or 0.01 GiB of the catalog total, whichever is larger.
  const tolerance = Math.max(total * 0.01, 0.01 * 1073741824);
  require(displayedSizes(text).some(bytes => Math.abs(bytes - total) <= tolerance),
    'The full-model download and storage size is not shown before seeding is switched on');
  return failures;
}

/** (s) The whole model is acquired, verified and offered while a conversation runs; the ledger charges exactly what moved. */
export function seededFailures(report, freeze) {
  const { failures, require } = checker(), seed = report?.seed, catalog = report?.catalog || [];
  require(seed?.files?.sharing === true && !seed.files.error && seed.files.mode === 'full-model', 'Full-model seeding is not sharing');
  const offered = hashesOf(seed?.offered);
  require(catalog.length > 0 && catalog.every(file => offered.has(hex(file.hash))), 'Seed does not offer every catalog file');
  require(wholeWeights(seed?.offered, catalog).length === catalog.filter(file => file.role === 'model-weights').length,
    'Weights are not retained as whole verified files');
  require(validBudget(seed?.ledger) && seed.ledger.maxBytes === seed.allowanceBytes && seed.ledger.reservedBytes <= seed.allowanceBytes,
    'Seeding allowance missing, renewed or overspent');
  const observed = sum((seed?.requests || []).map(rowBytes)) + sum((seed?.receipts || []).map(item => item.bytes ?? 0));
  require(validBudget(seed?.ledger) && seed.ledger.reservedBytes === observed, 'Seeding ledger differs from the observed transfers');
  require((seed?.samples || []).some(sample => ACTIVE.has(sample.attemptStatus) && (sample.preparing || sample.sharing)),
    'Seeding did not overlap an active conversation');
  require(!(seed?.samples || []).some(sample => ['cancelling', 'cancelled'].includes(sample.attemptStatus)), 'Conversation was cancelled during seeding');
  const final = seed?.chat?.final, attempt = final?.attempts?.find(item => item.id === seed?.chat?.attemptId);
  failures.push(...completedAttemptFailures(final, attempt, freeze, 'Seeder conversation'));
  return failures;
}

/** (b) Another computer acquires every model file from the seeder; the origin serves it no weights. */
export function peerWholeFailures(report) {
  const { failures, require } = checker(), peer = report?.peer, catalog = report?.catalog || [];
  require(peer?.acquirer?.machine && peer.acquirer.machine !== peer?.seeder?.machine, 'Acquirer is not another computer');
  require(peer?.acquirer?.files?.sharing === true && !peer.acquirer.files.error, 'Acquirer did not complete the full model');
  const offered = hashesOf(peer?.acquirer?.offered);
  require(catalog.length > 0 && catalog.every(file => offered.has(hex(file.hash))), 'Acquirer does not hold every catalog file');
  require((peer?.acquirer?.requests || []).every(row => !row.weight), 'Acquirer downloaded weights from the origin');
  // Receipts carry SHA-256 of the bytes moved; weights are named by the manifest's algorithm (BLAKE3),
  // so each weight must match a finished receipt's completed artifact by path and size. Its identity
  // under the catalog hash is the acquirer's own verified offer, checked above.
  const received = new Set((peer?.acquirer?.receipts || []).filter(item => item.finished)
    .flatMap(item => (item.artifacts || []).map(artifact => `${artifact.artifactId}#${artifact.sizeBytes}`)));
  const weights = catalog.filter(file => file.role === 'model-weights');
  require(weights.length > 0 && weights.every(file => received.has(`${file.path}#${file.sizeBytes}`)), 'Some weights did not arrive through peer custody');
  require(peer?.seeder?.suppliedAfter - peer?.seeder?.suppliedBefore >= sum(weights.map(file => file.sizeBytes)),
    'Seeder did not supply the weight bytes');
  return failures;
}

/** (c) After reload, the same full-model grant rebuilds the whole inventory from verified cached bytes with no request and no new charge. */
export function reloadFailures(report) {
  const { failures, require } = checker(), reload = report?.reload, catalog = report?.catalog || [];
  require(reload?.after?.files?.sharing === true && !reload.after.files.error && reload.after.files.mode === 'full-model',
    'Full-model seeding did not resume after reload');
  const offered = hashesOf(reload?.after?.offered);
  require(catalog.length > 0 && catalog.every(file => offered.has(hex(file.hash))), 'Reload did not rebuild the whole inventory');
  require(wholeWeights(reload?.after?.offered, catalog).length === catalog.filter(file => file.role === 'model-weights').length,
    'Reload did not rebuild whole weight files');
  require((reload?.after?.requests || []).length === 0, 'Resumed seeding requested model files after reload');
  require(validBudget(reload?.before?.ledger) && JSON.stringify(reload.before.ledger) === JSON.stringify(reload?.after?.ledger),
    'Reload changed the seeding ledger');
  return failures;
}

/** (n) A bounded grant offers pieces only and cannot become seeding by changing modes. */
export function boundedFailures(report, fixture) {
  const { failures, require } = checker(), bounded = report?.bounded, catalog = report?.catalog || [];
  require(bounded?.bounded?.sharing === true, 'Bounded acquisition did not share');
  require((bounded?.boundedOffer || []).length > 0 && wholeWeights(bounded.boundedOffer, catalog).length === 0,
    'Bounded acquisition retained whole weight files');
  const error = String(bounded?.seeding?.error || '');
  require(error.includes(fixture.refusalText) || error.includes(fixture.renewalRefusalText), 'Full-model start under a bounded grant was not refused');
  require(wholeWeights(bounded?.seedingOffer, catalog).length === 0, 'A bounded grant offered whole weights after the mode change');
  require((bounded?.requests || []).every(row => !row.weight), 'A bounded grant downloaded weights after the mode change');
  require(validBudget(bounded?.ledger) && bounded.ledger.maxBytes === bounded.allowanceBytes, 'Changing modes renewed the allowance');
  return failures;
}

/** (f) Stopping a seed in flight settles its transfers, keeps its charges and leaves the conversation running. */
export function stopFailures(report, freeze) {
  const { failures, require } = checker(), stop = report?.stop;
  require(stop?.inFlight?.pendingWeightRequests > 0, 'No whole-file transfer was in flight at the stop');
  require(settled(stop?.filesAfter), 'Seeding did not settle after Stop');
  require(stop?.requestsAfterSettled === 0, 'Model-file requests continued after the stop settled');
  require(validBudget(stop?.ledgerBefore) && validBudget(stop?.ledgerAfter) && stop.ledgerAfter.maxBytes === stop.ledgerBefore.maxBytes
    && stop.ledgerAfter.reservedBytes >= stop.ledgerBefore.reservedBytes, 'Stopping renewed or refunded the seeding allowance');
  require(!(stop?.chat?.samples || []).some(sample => ['cancelling', 'cancelled'].includes(sample.attemptStatus)), 'Stopping seeding cancelled the conversation');
  const final = stop?.chat?.final, attempt = final?.attempts?.find(item => item.id === stop?.chat?.attemptId);
  failures.push(...completedAttemptFailures(final, attempt, freeze, 'Conversation during seeding stop'));
  return failures;
}

export function assessSeeding(report, freeze, fixture) {
  const results = {
    refusedWithoutAllowance: run(() => refusalFailures(report?.refusal, fixture)),
    scopeVisibleBeforeApproval: run(() => scopeFailures(report)),
    seededWhole: run(() => seededFailures(report, freeze)),
    peerAcquiresWholeModel: run(() => peerWholeFailures(report)),
    reloadRebuildsWhole: run(() => reloadFailures(report)),
    boundedDoesNotImplySeeding: run(() => boundedFailures(report, fixture)),
    stopSettlesSeeding: run(() => stopFailures(report, freeze))
  };
  const checks = Object.fromEntries(Object.entries(results).map(([name, failures]) =>
    [name, { pass: failures.length === 0, failures, requirements: SEEDING_REQUIREMENTS[name] }]));
  return { checks, automatedPass: Object.values(checks).every(check => check.pass) };
}

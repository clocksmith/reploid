/**
 * Judges one retained Stage 1 split receipt against frozen expectations. Pure: no clock, file, network or
 * crypto. Every digest was computed by whoever produced the receipt, so this answers "does the record meet
 * the bar", never "is the record honest". Hosts are trusted to report what they measured.
 */
import { creditSettlementDeltas } from '../../server/fleet/credit-shares.js';
import { WEIGHT_ROLES } from './stage-metadata.js';

export const STAGE1_RECEIPT_SCHEMA = 'reploid.stage1-split-receipt/v1';
export const STAGE1_PHASES = Object.freeze(['preflight', 'solo-a', 'solo-b', 'earn', 'split', 'cancel', 'drop', 'cleanup']);
/** The harness, not live code, collected the signed settlement records each replay ran on. */
export const TERMS_COLLECTED_BY = 'stage1-harness';
/** What a fitting solo control asks of the owner: the claim is unearned until a harder pinned workload refuses both. */
export const SOLO_FITS_DETAIL = 'choose a harder workload';
export const LABEL_POOLED = 'pooled capacity';
export const LABEL_SPLIT = 'split correctness';
const HOST_LABELS = Object.freeze(['host-a', 'host-b']);
// Only the device refusing the allocation shows a physical limit. An operator budget or a fake does not.
const DEVICE_MEMORY_EVIDENCE = 'device-out-of-memory';
/**
 * A device can refuse partway through the upload, so `requiredBytes` is the whole model the load asked for and these
 * record how far it got. A refusal before this much was placed says the device was already occupied, not that the
 * model does not fit.
 */
export const MINIMUM_LOAD_PROGRESS_BYTES = 1073741824;

const same = (a, b) => canonical(a) === canonical(b);
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
const count = value => Number.isSafeInteger(value) && value >= 0;

/** The settings a solo control must share with the split for its failure to say anything about the split. */
const soloSettings = workload => ({ modelId: workload?.modelId, modelIdentity: workload?.modelIdentity,
  quantization: workload?.quantization, messagesDigest: workload?.messagesDigest,
  maxOutputTokens: workload?.maxOutputTokens, decoding: workload?.decoding });

/**
 * `completed`, `memory`, or `inconclusive`. A guard, a timeout, a missing file, an operator budget or changed
 * settings all say nothing about whether the model fits, so none of them counts as a memory failure.
 */
export function classifySoloControl(control, expectations) {
  if (!control || typeof control !== 'object') return { outcome: 'inconclusive', why: 'missing' };
  if (!same(soloSettings(control.settings), soloSettings(expectations.workload))) {
    return { outcome: 'inconclusive', why: 'settings-differ' };
  }
  if (control.outcome === 'completed') return { outcome: 'completed', why: 'completed' };
  if (control.outcome !== 'failed') return { outcome: 'inconclusive', why: String(control.reason ?? control.outcome ?? 'unknown') };
  const failure = control.failure;
  if (failure?.guardTripped === true) return { outcome: 'inconclusive', why: 'guard' };
  if (failure?.timedOut === true) return { outcome: 'inconclusive', why: 'timeout' };
  if (failure?.kind !== 'out-of-memory') return { outcome: 'inconclusive', why: String(failure?.kind ?? 'unclassified') };
  if (failure.evidence !== DEVICE_MEMORY_EVIDENCE) return { outcome: 'inconclusive', why: 'no-device-memory-evidence' };
  if (failure.operatorCapped !== false) return { outcome: 'inconclusive', why: 'operator-budget' };
  if (!count(failure.requiredBytes) || failure.requiredBytes < expectations.minimumSoloLoadBytes) {
    return { outcome: 'inconclusive', why: 'required-bytes-below-model' };
  }
  if (failure.during !== 'whole-model-load') return { outcome: 'inconclusive', why: 'outside-model-load' };
  const failed = failure.failedBufferBytes ?? 0;
  if (!count(failure.allocatedBeforeFailureBytes) || !count(failed)) return { outcome: 'inconclusive', why: 'load-progress-unknown' };
  if (failure.allocatedBeforeFailureBytes + failed < MINIMUM_LOAD_PROGRESS_BYTES) return { outcome: 'inconclusive', why: 'small-allocation' };
  return { outcome: 'memory', why: 'device-out-of-memory' };
}

function checkPhases(receipt, fail) {
  if (receipt.hardStop) fail('hard-stop', String(receipt.hardStop.reason ?? 'unspecified'));
  for (const name of STAGE1_PHASES) {
    const status = receipt.phases?.[name]?.status;
    if (status !== 'completed') fail(`phase-not-completed:${name}`, String(status ?? 'missing'));
  }
}

function checkWorkload(receipt, expectations, fail) {
  const observed = receipt.workload ?? {}, expected = expectations.workload;
  for (const key of ['modelId', 'modelIdentity', 'quantization', 'planIdentity', 'messagesDigest', 'promptDigest',
    'promptCount', 'maxOutputTokens']) {
    if (observed[key] !== expected[key]) fail(`workload-${key}`, `${observed[key]} != ${expected[key]}`);
  }
  if (!same(observed.decoding, expected.decoding)) fail('workload-decoding', canonical(observed.decoding));
}

function checkTokens(receipt, expectations, fail) {
  const tokens = receipt.split?.tokens, reference = expectations.reference;
  if (!same(tokens?.outputIds, reference.outputIds)) {
    fail('tokens-differ', `${canonical(tokens?.outputIds)} != ${canonical(reference.outputIds)}`);
  }
  if (tokens?.sampleDigest !== reference.sampleDigest) fail('tokens-sample-digest', String(tokens?.sampleDigest));
  if (tokens?.sampleCount !== reference.outputIds.length) fail('tokens-sample-count', String(tokens?.sampleCount));
  if (tokens?.promptDigest !== expectations.workload.promptDigest) fail('tokens-prompt-digest', String(tokens?.promptDigest));
  if (tokens?.tokenizerDigest !== expectations.workload.promptDigest) fail('tokens-tokenizer-digest', String(tokens?.tokenizerDigest));
  if (!reference.stopReasons.includes(tokens?.stopReason)) fail('tokens-stop-reason', String(tokens?.stopReason));
  if (receipt.split?.text !== reference.outputText) fail('text-differs', String(receipt.split?.text));
  if (receipt.split?.parityExact !== true) fail('tokens-parity-unverified', 'the stage token witnesses were not verified');
}

/** The stage directory a stage process opens from holds exactly its stage, searched for every range of the model. */
function checkInventory(host, when, stage, expectations, fail) {
  const observed = host.inventory?.[when], name = `${host.label}:${when}`;
  if (!observed) { fail('inventory-missing', name); return; }
  if (observed.source !== expectations.inventorySource) fail('inventory-source', `${name} ${observed.source}`);
  if (expectations.runtimeClass === 'physical' && observed.scope !== 'stage-directory') fail('inventory-scope', `${name} ${observed.scope}`);
  if (expectations.runtimeClass === 'physical' && observed.scannedRanges !== expectations.totalWeight.rangeCount) {
    fail('inventory-not-exhaustive', `${name} scanned ${observed.scannedRanges} of ${expectations.totalWeight.rangeCount} ranges`);
  }
  if (observed.outsideStageRanges !== 0 || observed.outsideStageBytes !== 0) {
    fail('inventory-outside-stage', `${name} ${observed.outsideStageRanges} ranges, ${observed.outsideStageBytes} bytes`);
  }
  if (observed.rangeCount !== stage.rangeCount || observed.bytes !== stage.bytes || observed.rangesDigest !== stage.rangesDigest) {
    fail('inventory-mismatch', `${name} ${observed.rangeCount}/${observed.bytes}/${observed.rangesDigest}`);
  }
}

/**
 * Around the split a real host is searched everywhere it keeps weights. A full copy at the declared directory is
 * allowed and recorded (the solo controls need it); a range of another stage anywhere else is not.
 */
function checkHostWeights(host, expectations, fail) {
  for (const when of ['beforeSplit', 'afterSplit']) {
    const observed = host.hostWeights?.[when], name = `${host.label}:${when}`;
    if (!observed) { fail('host-weights-unmeasured', name); continue; }
    if (observed.scope !== 'host-weight-directories') fail('inventory-scope', `${name} ${observed.scope}`);
    if (observed.scannedRanges !== expectations.totalWeight.rangeCount) {
      fail('inventory-not-exhaustive', `${name} scanned ${observed.scannedRanges} of ${expectations.totalWeight.rangeCount} ranges`);
    }
    if (observed.outsideElsewhere !== 0) fail('host-weights-outside-full-copy', `${name} ${observed.outsideElsewhere} other-stage ranges`);
  }
}

/** The stage process loaded only its assigned ranges, and all of them, by its own loader's record. */
function checkLoaded(host, stage, expectations, fail) {
  const loaded = host.loaded, total = expectations.totalWeight;
  if (!loaded) { fail('loaded-unrecorded', host.label); return; }
  if (loaded.source !== 'stage-loader') fail('loaded-source', `${host.label} ${loaded.source}`);
  if (loaded.bytes >= total.bytes || loaded.rangeCount >= total.rangeCount) {
    fail('executor-holds-complete-weights', `${host.label} loaded ${loaded.rangeCount} ranges, ${loaded.bytes} bytes`);
  }
  if (loaded.outsideStageRanges !== 0) fail('loaded-outside-stage', `${host.label} asked for ${loaded.outsideStageRanges} ranges outside its stage`);
  // Non-weight files (the tokenizer) are recorded apart and never count as ranges; a weight role there is refused.
  if (loaded.metadata !== undefined && (!Array.isArray(loaded.metadata?.roles) || loaded.metadata.roles.some(role => WEIGHT_ROLES.includes(role)))) {
    fail('loaded-metadata-invalid', `${host.label} ${canonical(loaded.metadata?.roles)}`);
  }
  if (loaded.rangeCount !== stage.rangeCount || loaded.bytes !== stage.bytes || loaded.rangesDigest !== stage.rangesDigest) {
    fail('loaded-not-assigned', `${host.label} ${loaded.rangeCount}/${loaded.bytes}/${loaded.rangesDigest}`);
  }
}

function checkHosts(receipt, expectations, fail) {
  const hosts = receipt.hosts;
  if (!Array.isArray(hosts) || hosts.length !== expectations.stages.length) { fail('hosts-count', String(hosts?.length)); return; }
  hosts.forEach((host, index) => {
    const stage = expectations.stages[index];
    if (host.label !== HOST_LABELS[index] || host.stageIndex !== stage.stageIndex) fail('host-stage', `${host.label} ${host.stageIndex}`);
    if (!same(host.assignedLayers, stage.layerRange)) fail('host-layers', `${host.label} ${canonical(host.assignedLayers)}`);
    // Solo controls run between preflight and the split, so the holding is measured again right before it.
    for (const when of ['preflight', 'beforeSplit', 'afterSplit']) checkInventory(host, when, stage, expectations, fail);
    if (expectations.runtimeClass === 'physical') checkHostWeights(host, expectations, fail);
    checkLoaded(host, stage, expectations, fail);
  });
  if (new Set(hosts.map(host => host.participantId)).size !== hosts.length) fail('hosts-not-distinct', 'participant');
  if (hosts.some(host => host.participantId === receipt.requester?.participantId)) fail('requester-is-executor', 'participant');
  if (expectations.runtimeClass === 'physical') {
    const machines = hosts.map(host => host.machine);
    if (machines.some(machine => typeof machine !== 'string' || !machine) || new Set(machines).size !== machines.length) {
      fail('hosts-not-physically-distinct', canonical(machines));
    }
  }
}

function checkRequester(receipt, expectations, fail) {
  // An empty directory on an executing machine is not a zero-weight requester.
  if (expectations.runtimeClass === 'physical') {
    const machine = receipt.requester?.machine;
    if (typeof machine !== 'string' || !machine || (receipt.hosts ?? []).some(host => host.machine === machine)) {
      fail('requester-not-separate-machine', String(machine));
    }
  }
  for (const when of ['preflight', 'afterSplit']) {
    const observed = receipt.requester?.[when];
    if (expectations.runtimeClass === 'physical') {
      // The claim is zero pieces of the requested model, identified by hash under every weight root. Other files there,
      // such as another model's weights, are recorded as otherModelBytes and do not count against it.
      const held = observed?.heldRanges;
      if (!observed || !count(observed.weightBytes) || !count(observed.otherModelBytes) || !count(held?.rangeCount) || !count(held?.bytes)
        || !(held.scannedRanges > 0)) fail('requester-weights-unmeasured', when);
      else if (observed.weightBytes !== 0 || held.rangeCount !== 0 || held.bytes !== 0) {
        fail('requester-holds-weights', `${when} ${held.rangeCount} pieces, ${held.bytes} bytes of the requested model`);
      }
    } else if (!observed || !count(observed.weightBytes) || !count(observed.fileCount)) fail('requester-weights-unmeasured', when);
    else if (observed.weightBytes !== 0 || observed.fileCount !== 0) {
      fail('requester-holds-weights', `${when} ${observed.fileCount} files, ${observed.weightBytes} bytes`);
    }
  }
}

/**
 * Each stage's share, from the ledger's own rounding at the operator's weights. A small charge can legitimately pay a
 * stage nothing (weights 1:5 on 3 credits pay 0 and 3), so "every stage was paid" would be the wrong test.
 */
function checkShares(trace, name, hosts, expectations, fail) {
  const weights = expectations.creditWeights;
  if (!Array.isArray(weights) || weights.length !== expectations.stages.length) { fail('credit-weights-missing', name); return; }
  if (!Array.isArray(hosts) || hosts.length !== weights.length || !Number.isSafeInteger(trace.charge)) return;
  const request = { computerId: '\0requester', providers: hosts.map((host, index) => ({ participantId: host.computerId, weight: weights[index] })) };
  const expected = creditSettlementDeltas(request, trace.charge, id => id).credits.map(row => ({ computerId: row.computerId, amount: row.amount }));
  if (!same(trace.credits, expected)) fail('settlement-shares', `${name} paid ${canonical(trace.credits)}, expected ${canonical(expected)}`);
  for (const row of expected) {
    const entry = (trace.journal ?? []).find(item => item.accountId === row.computerId);
    if ((entry?.delta ?? 0) !== row.amount) fail('settlement-shares', `${name} journal for ${row.computerId} differs from its share`);
  }
}

function checkSettlement(trace, name, expectations, fail, hosts) {
  if (!trace) { fail(`${name}-settlement-missing`, 'no ledger trace'); return; }
  if (trace.state !== 'settled') fail('stranded-hold', `${name} reservation is ${trace.state}`);
  if (trace.heldAfter !== 0) fail('stranded-hold', `${name} left ${trace.heldAfter} credits held`);
  const journal = Array.isArray(trace.journal) ? trace.journal : [];
  const accounts = journal.map(row => row.accountId);
  if (new Set(accounts).size !== accounts.length) fail('double-settlement', `${name} journal repeats an account`);
  const debits = journal.filter(row => row.delta < 0);
  if (debits.length > 1) fail('double-settlement', `${name} debited ${debits.length} times`);
  if (journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', name);
  const debited = debits.reduce((sum, row) => sum - row.delta, 0);
  if (debited !== trace.charge) fail('double-settlement', `${name} debited ${debited}, charge ${trace.charge}`);
  if (trace.charge !== trace.outputTokens * expectations.creditsPerOutputToken) {
    fail('settlement-charge', `${name} charge ${trace.charge} for ${trace.outputTokens} tokens`);
  }
  checkShares(trace, name, hosts, expectations, fail);
  const replay = trace.replay;
  if (replay?.attempted !== true) fail('settlement-replay-missing', name);
  else if (replay.journalAfter !== replay.journalBefore || replay.balancesUnchanged !== true || replay.outcomeUnchanged !== true) {
    fail('double-settlement', `${name} replay changed the ledger`);
  }
}

/**
 * The account earns before it spends: a separate device of the requester's account served whole-model answers, each
 * settled once on the ledger to that account, and the split and the stopped answer were then paid from those earnings
 * without the account going below zero.
 */
function checkEarn(receipt, expectations, fail) {
  const earn = receipt.earn, account = receipt.requester?.computerId;
  if (!earn) { fail('earn-missing', 'no whole-model earning before the split'); return; }
  // Nothing seeded: the account starts at zero, so everything it spends was earned in this run.
  if (earn.accountBefore !== 0) fail('earn-seeded-balance', `the account held ${earn.accountBefore} before earning`);
  if (!account || earn.earner?.computerId !== account) fail('earn-other-account', `${earn.earner?.computerId} earned for ${account}`);
  if (earn.earner?.participantId === receipt.requester?.participantId) fail('earn-by-requester-device', 'the zero-weight requester served the control');
  // The earner may share the requester's machine under its own key; it never runs on, or as, a stage host.
  if ((receipt.hosts ?? []).some(host => host.participantId === earn.earner?.participantId
    || (expectations.runtimeClass === 'physical' && host.machine === earn.earner?.machine))) fail('earn-on-executor', 'the earner is a stage host');
  if ((receipt.hosts ?? []).some(host => host.computerId === account)) fail('earn-account-is-executor', String(account));
  let earned = 0;
  for (const [index, trace] of (earn.settlements ?? []).entries()) {
    const name = `earn-${index}`;
    if (trace?.state !== 'settled' || trace.heldAfter !== 0) fail('earn-not-settled', `${name} ${trace?.state}`);
    const journal = Array.isArray(trace?.journal) ? trace.journal : [];
    if (journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', name);
    if (journal.filter(row => row.delta < 0).length !== 1) fail('double-settlement', `${name} debits`);
    if (trace?.charge !== trace?.outputTokens * expectations.creditsPerOutputToken) fail('settlement-charge', name);
    const credited = journal.filter(row => row.accountId === account).reduce((sum, row) => sum + row.delta, 0);
    if (credited !== trace?.charge) fail('earn-not-credited', `${name} credited ${credited} of ${trace?.charge}`);
    const replay = trace?.replay;
    if (replay?.attempted !== true || replay.journalAfter !== replay.journalBefore || replay.balancesUnchanged !== true) fail('double-settlement', `${name} replay`);
    earned += credited;
  }
  if (earned <= 0) fail('earn-nothing', 'no credits earned');
  const split = receipt.split?.account, charge = receipt.split?.settlement?.charge;
  if (split?.computerId !== account) fail('spend-other-account', String(split?.computerId));
  if (!Number.isSafeInteger(split?.before) || split.before < earned) fail('spend-before-earning', `balance ${split?.before} after earning ${earned}`);
  if (!Number.isSafeInteger(charge) || split?.before < charge) fail('spend-in-debt', `balance ${split?.before} for a charge of ${charge}`);
  if (split?.after !== split?.before - charge) fail('spend-mismatch', `${split?.before} - ${charge} != ${split?.after}`);
  if (!(receipt.cancel?.accountAfter >= 0)) fail('spend-in-debt', `after the stopped answer ${receipt.cancel?.accountAfter}`);
}

function checkCancel(receipt, expectations, fail) {
  const cancel = receipt.cancel, answer = expectations.reference.outputIds.length;
  checkSettlement(cancel?.settlement, 'cancel', expectations, fail, receipt.hosts);
  if (cancel?.stoppedBeforeCompletion !== true) fail('cancel-not-mid-answer', 'the answer completed before the stop');
  const tokens = cancel?.settlement?.outputTokens;
  if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens >= answer) fail('cancel-not-mid-answer', `${tokens} settled tokens of ${answer}`);
  if (!Array.isArray(cancel?.residentsActive) || cancel.residentsActive.length !== expectations.stages.length
    || cancel.residentsActive.some(active => active !== 0)) {
    fail('cancel-resident-still-active', canonical(cancel?.residentsActive));
  }
}

/**
 * The forced provider drop: a stage process killed mid-answer. The requester keeps its partial text, nothing is resent,
 * and under the provider-loss-free terms nobody is charged or paid: the hold is released (expired, or settled at zero).
 */
function checkDrop(receipt, expectations, fail) {
  const drop = receipt.drop, answer = expectations.reference.outputIds.length;
  if (!drop) { fail('drop-missing', 'no forced provider drop'); return; }
  if (drop.completed !== false) fail('drop-no-partial-output', 'the answer completed despite the drop');
  if (!Number.isSafeInteger(drop.outputsReceived) || drop.outputsReceived < 1 || drop.outputsReceived >= answer
    || typeof drop.partialText !== 'string' || !drop.partialText) {
    fail('drop-no-partial-output', `${drop.outputsReceived} outputs of ${answer}, ${JSON.stringify(drop.partialText ?? null)}`);
  }
  const resend = drop.resend;
  if (resend?.requesterApprovals !== 1 || resend.requesterAttemptsOnThread !== 1 || resend.ledgerReservations !== 1) {
    fail('drop-resent', canonical(resend));
  }
  const trace = drop.settlement;
  if (!trace) { fail('drop-stranded-hold', 'no ledger trace'); return; }
  if (trace.state !== 'settled' || trace.heldAfter !== 0) fail('drop-stranded-hold', `${trace.state}, ${trace.heldAfter} held`);
  const journal = Array.isArray(trace.journal) ? trace.journal : [];
  if (trace.charge !== 0 || journal.some(row => row.delta !== 0) || (trace.credits ?? []).some(row => row.amount !== 0)) {
    fail('drop-charged', `charge ${trace.charge}, journal ${canonical(journal)}`);
  }
  const accounts = journal.map(row => row.accountId);
  if (new Set(accounts).size !== accounts.length) fail('double-settlement', 'drop journal repeats an account');
  if (!Number.isSafeInteger(drop.accountBefore) || drop.accountAfter !== drop.accountBefore) {
    fail('drop-charged', `the requester balance moved from ${drop.accountBefore} to ${drop.accountAfter}`);
  }
}

/**
 * The replay over the participants' own signed records must agree with the ledger: the split settled at the ledger's
 * debit and credits, the stopped answer charged its acknowledged prefix, the dropped one charged nothing, and no
 * reservation came out in conflict, unknown or invalid. The terms must name the ledger's exact policy.
 */
function checkReplay(receipt, name, fail) {
  const attempt = receipt[name], trace = attempt?.settlement, replay = attempt?.settlementReplay;
  if (!replay) { fail('replay-missing', name); return; }
  if (replay.termsCollectedBy !== TERMS_COLLECTED_BY) fail('replay-label', `${name} ${replay.termsCollectedBy}`);
  if (!replay.ledgerPolicyDigest || replay.termsPolicyDigest !== replay.ledgerPolicyDigest) {
    fail('replay-policy-mismatch', `${name} terms name ${replay.termsPolicyDigest}, the ledger runs ${replay.ledgerPolicyDigest}`);
  }
  const rows = Array.isArray(replay.result?.reservations) ? replay.result.reservations : [];
  for (const row of rows) {
    if (['conflict', 'unknown', 'invalid'].includes(row.status)) fail(`replay-${row.status}`, `${name}: ${row.reason}`);
  }
  const row = rows.find(item => item.reservationId === trace?.reservationId);
  if (!row) { fail('replay-reservation-missing', name); return; }
  if (name === 'drop') {
    if (!(row.status === 'expired' || row.status === 'settled' && row.debit === 0)) fail('replay-drop-charged', `${row.status} debit ${row.debit}`);
    return;
  }
  if (row.status !== 'settled') {
    if (!['conflict', 'unknown', 'invalid'].includes(row.status)) fail('replay-not-settled', `${name} ${row.status}`);
    return;
  }
  const amounts = (row.credits ?? []).map(credit => credit.amount), ledger = (trace.credits ?? []).map(credit => credit.amount);
  if (row.debit !== trace.charge || !same(amounts, ledger)) {
    fail('replay-differs-from-ledger', `${name} replay ${row.debit} ${canonical(amounts)}, ledger ${trace.charge} ${canonical(ledger)}`);
  }
  if (name === 'cancel' && (replay.stopSigned !== true || row.chargedOutputs !== trace.outputTokens)) {
    fail('replay-differs-from-ledger', `cancel replay charged ${row.chargedOutputs} outputs, ledger ${trace.outputTokens}, stop signed ${replay.stopSigned}`);
  }
}

function checkCleanup(receipt, fail) {
  const cleanup = receipt.cleanup;
  if (cleanup?.processesExited !== true) fail('cleanup-processes', 'a started process did not exit');
  if (cleanup?.heldCredits !== 0) fail('stranded-hold', `cleanup found ${cleanup?.heldCredits} credits held`);
  if (cleanup?.openReservations !== 0) fail('stranded-hold', `cleanup found ${cleanup?.openReservations} open reservations`);
  for (const row of cleanup?.fullCopyLocks ?? []) if (row.locked && row.restored !== true) fail('full-copy-lock-not-restored', String(row.host));
}

/** A standing service stopped for a solo control must be back and verified active. */
function checkServices(receipt, expectations, fail) {
  const rows = receipt.serviceRestores;
  if (expectations.runtimeClass === 'physical' && !Array.isArray(rows)) { fail('service-restore-unrecorded', 'no service record'); return; }
  for (const row of rows ?? []) {
    if (row.stopped && (row.restored !== true || row.verifiedActive !== true || row.failedAttempts)) fail('service-restore-failed', String(row.host));
  }
}

/**
 * `pooled capacity` only when both solo controls ran out of device memory at the split's exact settings. A control
 * that fits the whole model fails the receipt: the owner's rule is a harder pinned workload and both controls again.
 */
function decideLabel(receipt, expectations, fail) {
  const solo = Object.fromEntries(HOST_LABELS.map(label => [label, classifySoloControl(receipt.soloControls?.[label], expectations)]));
  if (HOST_LABELS.some(label => solo[label].outcome === 'completed')) fail('solo-fits', SOLO_FITS_DETAIL);
  for (const label of HOST_LABELS) {
    const control = receipt.soloControls?.[label];
    if (control?.claimedFailure === 'memory' && solo[label].outcome !== 'memory') {
      fail('solo-failure-claim-unsupported', `${label}: ${solo[label].why}`);
    }
  }
  const pooled = HOST_LABELS.every(label => solo[label].outcome === 'memory');
  const label = pooled ? LABEL_POOLED : LABEL_SPLIT;
  if (receipt.claim !== undefined && receipt.claim !== null && ![LABEL_POOLED, LABEL_SPLIT].includes(receipt.claim)) {
    fail('claim-unknown', String(receipt.claim));
  }
  if (receipt.claim === LABEL_POOLED && !pooled) {
    const held = HOST_LABELS.filter(name => solo[name].outcome !== 'memory').map(name => `${name}: ${solo[name].why}`);
    fail('pooled-capacity-unsupported', held.join('; '));
  }
  return { label, solo };
}

/** Score the observed answer independently of token parity and settlement. No completed split means no score. */
function scoreTaskAnswer(receipt, expectations) {
  const expectedText = expectations.task?.expectedText;
  if (typeof expectedText !== 'string') return { status: 'not-configured' };
  const actualText = receipt.split?.text;
  if (receipt.phases?.split?.status !== 'completed' || typeof actualText !== 'string') {
    return { status: 'not-observed', expectedText };
  }
  return { status: actualText === expectedText ? 'match' : 'mismatch', expectedText, actualText };
}

/** Returns `{ ok, label, solo, reasons, taskCorrectness }`. The task score never affects the receipt verdict. */
export function checkStage1Receipt(receipt, expectations) {
  const reasons = [];
  const fail = (code, detail) => { reasons.push({ code, detail }); };
  if (receipt?.schema !== STAGE1_RECEIPT_SCHEMA) fail('receipt-schema', String(receipt?.schema));
  if (receipt?.runtimeClass !== expectations.runtimeClass) fail('runtime-class', `${receipt?.runtimeClass} != ${expectations.runtimeClass}`);
  const record = receipt ?? {};
  checkPhases(record, fail);
  checkWorkload(record, expectations, fail);
  checkTokens(record, expectations, fail);
  checkHosts(record, expectations, fail);
  checkRequester(record, expectations, fail);
  checkSettlement(record.split?.settlement, 'split', expectations, fail, record.hosts);
  if (record.split?.settlement?.outputTokens !== expectations.reference.outputIds.length) {
    fail('split-settled-tokens', String(record.split?.settlement?.outputTokens));
  }
  checkEarn(record, expectations, fail);
  checkCancel(record, expectations, fail);
  checkDrop(record, expectations, fail);
  for (const name of ['split', 'cancel', 'drop']) checkReplay(record, name, fail);
  checkCleanup(record, fail);
  checkServices(record, expectations, fail);
  const { label, solo } = decideLabel(record, expectations, fail);
  const ok = reasons.length === 0;
  return { ok, label: ok ? label : null, solo, reasons, taskCorrectness: scoreTaskAnswer(record, expectations) };
}

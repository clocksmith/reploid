/**
 * Judges one retained Stage 1 split receipt against frozen expectations. Pure: no clock, file, network or
 * crypto. Every digest was computed by whoever produced the receipt, so this answers "does the record meet
 * the bar", never "is the record honest". Hosts are trusted to report what they measured.
 */
export const STAGE1_RECEIPT_SCHEMA = 'reploid.stage1-split-receipt/v1';
export const STAGE1_PHASES = Object.freeze(['preflight', 'solo-a', 'solo-b', 'split', 'cancel', 'cleanup']);
export const LABEL_POOLED = 'pooled capacity';
export const LABEL_SPLIT = 'split correctness';
const HOST_LABELS = Object.freeze(['host-a', 'host-b']);
// Only the device refusing the allocation shows a physical limit. An operator budget or a fake does not.
const DEVICE_MEMORY_EVIDENCE = 'device-out-of-memory';

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

function checkInventory(host, when, stage, expectations, fail) {
  const observed = host.inventory?.[when], name = `${host.label}:${when}`;
  if (!observed) { fail('inventory-missing', name); return; }
  if (observed.source !== expectations.inventorySource) fail('inventory-source', `${name} ${observed.source}`);
  const total = expectations.totalWeight;
  if (observed.bytes >= total.bytes || observed.rangeCount >= total.rangeCount) {
    fail('executor-holds-complete-weights', `${name} ${observed.rangeCount} ranges, ${observed.bytes} bytes`);
  }
  if (observed.outsideStageRanges !== 0 || observed.outsideStageBytes !== 0) {
    fail('inventory-outside-stage', `${name} ${observed.outsideStageRanges} ranges, ${observed.outsideStageBytes} bytes`);
  }
  if (observed.rangeCount !== stage.rangeCount || observed.bytes !== stage.bytes || observed.rangesDigest !== stage.rangesDigest) {
    fail('inventory-mismatch', `${name} ${observed.rangeCount}/${observed.bytes}/${observed.rangesDigest}`);
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

function checkRequester(receipt, fail) {
  for (const when of ['preflight', 'afterSplit']) {
    const observed = receipt.requester?.[when];
    if (!observed || !count(observed.weightBytes) || !count(observed.fileCount)) fail('requester-weights-unmeasured', when);
    else if (observed.weightBytes !== 0 || observed.fileCount !== 0) {
      fail('requester-holds-weights', `${when} ${observed.fileCount} files, ${observed.weightBytes} bytes`);
    }
  }
}

function checkSettlement(trace, name, expectations, fail) {
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
  const replay = trace.replay;
  if (replay?.attempted !== true) fail('settlement-replay-missing', name);
  else if (replay.journalAfter !== replay.journalBefore || replay.balancesUnchanged !== true || replay.outcomeUnchanged !== true) {
    fail('double-settlement', `${name} replay changed the ledger`);
  }
}

function checkCancel(receipt, expectations, fail) {
  const cancel = receipt.cancel, answer = expectations.reference.outputIds.length;
  checkSettlement(cancel?.settlement, 'cancel', expectations, fail);
  if (cancel?.stoppedBeforeCompletion !== true) fail('cancel-not-mid-answer', 'the answer completed before the stop');
  const tokens = cancel?.settlement?.outputTokens;
  if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens >= answer) fail('cancel-not-mid-answer', `${tokens} settled tokens of ${answer}`);
  if (!Array.isArray(cancel?.residentsActive) || cancel.residentsActive.length !== expectations.stages.length
    || cancel.residentsActive.some(active => active !== 0)) {
    fail('cancel-resident-still-active', canonical(cancel?.residentsActive));
  }
}

function checkCleanup(receipt, fail) {
  const cleanup = receipt.cleanup;
  if (cleanup?.processesExited !== true) fail('cleanup-processes', 'a started process did not exit');
  if (cleanup?.heldCredits !== 0) fail('stranded-hold', `cleanup found ${cleanup?.heldCredits} credits held`);
  if (cleanup?.openReservations !== 0) fail('stranded-hold', `cleanup found ${cleanup?.openReservations} open reservations`);
}

/** `pooled capacity` only when both solo controls ran out of device memory at the split's exact settings. */
function decideLabel(receipt, expectations, fail) {
  const solo = Object.fromEntries(HOST_LABELS.map(label => [label, classifySoloControl(receipt.soloControls?.[label], expectations)]));
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

/** Returns `{ ok, label, solo, reasons }`. `label` is meaningful only when `ok`; a failed receipt claims nothing. */
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
  checkRequester(record, fail);
  checkSettlement(record.split?.settlement, 'split', expectations, fail);
  if (record.split?.settlement?.outputTokens !== expectations.reference.outputIds.length) {
    fail('split-settled-tokens', String(record.split?.settlement?.outputTokens));
  }
  checkCancel(record, expectations, fail);
  checkCleanup(record, fail);
  const { label, solo } = decideLabel(record, expectations, fail);
  const ok = reasons.length === 0;
  return { ok, label: ok ? label : null, solo, reasons };
}

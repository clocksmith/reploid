// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkStage1Receipt, classifySoloControl, LABEL_POOLED, LABEL_SPLIT, SOLO_FITS_DETAIL, STAGE1_PHASES, STAGE1_RECEIPT_SCHEMA } from '../../scripts/stage1/receipt-check.js';

const digest = letter => 'sha256:' + letter.repeat(64);
const decoding = { temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1 };
const workload = { modelId: 'model', modelIdentity: digest('a'), quantization: 'q4k', planIdentity: digest('b'),
  messagesDigest: digest('c'), promptDigest: 'd'.repeat(64), promptCount: 85, maxOutputTokens: 4, decoding };
const expectations = { schema: 'reploid.stage1-expectations/v1', runtimeClass: 'physical', inventorySource: 'hashed-on-host',
  inventorySha256: 'e'.repeat(64), creditsPerOutputToken: 1, creditWeights: [1, 1], workload,
  reference: { outputIds: [17, 17, 248046], sampleDigest: 'f'.repeat(64), outputText: '22', stopReasons: ['eos-token', 'stop-token'] },
  stages: [{ stageIndex: 0, layerRange: [0, 0], rangeCount: 1051, bytes: 2759168448, rangesDigest: digest('1') },
    { stageIndex: 1, layerRange: [1, 63], rangeCount: 4461, bytes: 14235183680, rangesDigest: digest('2') }],
  totalWeight: { rangeCount: 5512, bytes: 16994352128 }, minimumSoloLoadBytes: 16941875200 };

const inventory = stage => ({ source: 'hashed-on-host', scope: 'stage-directory', scannedRanges: 5512, rangeCount: stage.rangeCount, bytes: stage.bytes,
  rangesDigest: stage.rangesDigest, outsideStageRanges: 0, outsideStageBytes: 0 });
const hostWeights = stage => ({ scope: 'host-weight-directories', scannedRanges: 5512, heldRanges: 5512, outsideStageRanges: 5512 - stage.rangeCount,
  outsideInFullCopy: 5512 - stage.rangeCount, outsideElsewhere: 0, fullCopy: 'searched' });
const loaded = stage => ({ source: 'stage-loader', rangeCount: stage.rangeCount, bytes: stage.bytes, rangesDigest: stage.rangesDigest, outsideStageRanges: 0, outsideStageBytes: 0 });
const POLICY = 'sha256:' + '7'.repeat(64);
const replayOf = (trace, status = 'settled', extra = {}) => ({ termsCollectedBy: 'stage1-harness', termsSigned: 'in-approval-before-dispatch',
  acceptancesSigned: 'after-attempt', ledgerPolicyDigest: POLICY, termsPolicyDigest: POLICY, stopSigned: false, problems: [], records: [],
  result: { reservations: [{ reservationId: trace.reservationId, status, debit: status === 'expired' ? 0 : trace.charge,
    credits: trace.credits.map((row, index) => ({ participantId: `peer:${index}`, amount: row.amount })), chargedOutputs: trace.outputTokens }] }, ...extra });
const dropSettlement = () => ({ reservationId: 'drop', state: 'settled', status: 'expired', charge: 0, outputTokens: 0, credits: [], journal: [], heldAfter: 0,
  replay: { attempted: false } });
const settlement = (tokens, id) => ({ reservationId: id, state: 'settled', charge: tokens, outputTokens: tokens,
  credits: [{ computerId: 'computer-a', amount: Math.floor(tokens / 2) }, { computerId: 'computer-b', amount: Math.ceil(tokens / 2) }],
  journal: [{ accountId: 'computer-requester', delta: -tokens }, { accountId: 'computer-a', delta: Math.floor(tokens / 2) }, { accountId: 'computer-b', delta: Math.ceil(tokens / 2) }],
  heldAfter: 0, replay: { attempted: true, journalBefore: 3, journalAfter: 3, balancesUnchanged: true, outcomeUnchanged: true } });
const soloSettings = { modelId: 'model', modelIdentity: digest('a'), quantization: 'q4k', messagesDigest: digest('c'), maxOutputTokens: 4, decoding };
const outOfMemory = (extra = {}) => ({ outcome: 'failed', settings: soloSettings, claimedFailure: 'memory',
  failure: { kind: 'out-of-memory', evidence: 'device-out-of-memory', operatorCapped: false, requiredBytes: 16994352128,
    during: 'whole-model-load', allocatedBeforeFailureBytes: 12884901888, failedBufferBytes: 268435456, ...extra } });

/** A physical requester's measurement: no pinned piece of the requested model, other files recorded apart. */
const requesterHolds = (pieces = 0, extra = {}) => ({ weightBytes: pieces * 16, otherModelBytes: 0, fileCount: 0, scope: 'requester-weight-directories', scannedRoots: 4,
  heldRanges: { rangeCount: pieces, bytes: pieces * 16, scannedRanges: 5512 }, ...extra });

function goodReceipt() {
  const receipt = { schema: STAGE1_RECEIPT_SCHEMA, runtimeClass: 'physical', hardStop: null, claim: null,
    phases: Object.fromEntries(STAGE1_PHASES.map(name => [name, { status: 'completed' }])), workload: structuredClone(workload),
    serviceRestores: [], requester: { participantId: 'peer:r', computerId: 'computer-requester', machine: 'machine-r', preflight: requesterHolds(), afterSplit: requesterHolds() },
    hosts: expectations.stages.map((stage, index) => ({ label: ['host-a', 'host-b'][index], stageIndex: index, participantId: `peer:${index}`,
      machine: `machine-${index}`, computerId: ['computer-a', 'computer-b'][index], assignedLayers: [...stage.layerRange],
      inventory: { preflight: inventory(stage), beforeSplit: inventory(stage), afterSplit: inventory(stage) },
      hostWeights: { beforeSplit: hostWeights(stage), afterSplit: { ...hostWeights(stage), outsideInFullCopy: 0, fullCopy: 'locked-not-entered' } },
      loaded: loaded(stage) })),
    soloControls: { 'host-a': outOfMemory(), 'host-b': outOfMemory() },
    earn: { earner: { participantId: 'peer:earner', computerId: 'computer-requester', machine: 'machine-r' }, accountBefore: 0,
      settlements: [{ reservationId: 'earn', state: 'settled', charge: 4, outputTokens: 4, heldAfter: 0,
        journal: [{ accountId: 'computer-buyer', delta: -4 }, { accountId: 'computer-requester', delta: 4 }],
        replay: { attempted: true, journalBefore: 2, journalAfter: 2, balancesUnchanged: true, outcomeUnchanged: true } }] },
    split: { text: '22', parityExact: true, settlement: settlement(3, 'split'), account: { computerId: 'computer-requester', before: 4, after: 1 },
      tokens: { outputIds: [17, 17, 248046], promptDigest: workload.promptDigest, tokenizerDigest: workload.promptDigest,
        sampleCount: 3, sampleDigest: 'f'.repeat(64), stopReason: 'eos-token' } },
    cancel: { stoppedBeforeCompletion: true, residentsActive: [0, 0], settlement: settlement(1, 'cancel'), accountAfter: 0 },
    drop: { completed: false, outputsReceived: 1, partialText: '2', resend: { requesterApprovals: 1, requesterAttemptsOnThread: 1, ledgerReservations: 1 },
      settlement: dropSettlement(), accountBefore: 0, accountAfter: 0 },
    cleanup: { processesExited: true, heldCredits: 0, openReservations: 0, fullCopyLocks: [{ host: 'host-a', locked: true, restored: true }] } };
  receipt.split.settlementReplay = replayOf(receipt.split.settlement);
  receipt.cancel.settlementReplay = replayOf(receipt.cancel.settlement, 'settled', { stopSigned: true });
  receipt.drop.settlementReplay = replayOf(receipt.drop.settlement, 'expired', { acceptancesSigned: 'during-attempt' });
  return receipt;
}
const judged = change => { const receipt = goodReceipt(); change(receipt); return checkStage1Receipt(receipt, expectations); };
const codes = verdict => verdict.reasons.map(reason => reason.code);

describe('earning before spending', () => {
  it('refuses a receipt whose account spent before earning, went into debt, or earned on its requester device', () => {
    expect(codes(judged(r => { r.earn = null; }))).toEqual(['earn-missing']);
    expect(codes(judged(r => { r.split.account = { computerId: 'computer-requester', before: 2, after: -1 }; })))
      .toEqual(expect.arrayContaining(['spend-before-earning', 'spend-in-debt']));
    expect(codes(judged(r => { r.earn.earner.participantId = 'peer:r'; }))).toEqual(['earn-by-requester-device']);
    expect(codes(judged(r => { r.earn.earner.computerId = 'computer-a'; }))).toContain('earn-other-account');
    expect(codes(judged(r => { r.earn.settlements[0].journal[1].delta = 3; }))).toEqual(expect.arrayContaining(['earn-not-credited']));
  });

  it('accepts an earner on the requester\'s machine under its own key, never on a stage host or as one', () => {
    expect(codes(judged(() => {}))).toEqual([]);
    expect(codes(judged(r => { r.earn.earner.machine = 'machine-e'; }))).toEqual([]);
    expect(codes(judged(r => { r.earn.earner.machine = 'machine-1'; }))).toEqual(['earn-on-executor']);
    expect(codes(judged(r => { r.earn.earner.participantId = 'peer:0'; }))).toEqual(['earn-on-executor']);
  });

  it('refuses a seeded balance: the account must start at zero before it earns', () => {
    expect(codes(judged(r => { r.earn.accountBefore = 50; }))).toEqual(['earn-seeded-balance']);
    expect(codes(judged(r => { delete r.earn.accountBefore; }))).toEqual(['earn-seeded-balance']);
  });
});

describe('the forced provider drop', () => {
  it.each([
    ['no drop', r => { r.drop = null; }, ['drop-missing', 'replay-missing']],
    ['a charge after the drop', r => { r.drop.settlement = { ...settlement(1, 'drop'), status: null }; }, ['drop-charged']],
    ['a requester balance moved by the drop', r => { r.drop.accountAfter = -1; }, ['drop-charged']],
    ['a stranded hold', r => { r.drop.settlement.state = 'closing'; }, ['drop-stranded-hold']],
    ['credits still held', r => { r.drop.settlement.heldAfter = 4; }, ['drop-stranded-hold']],
    ['no partial output', r => { r.drop.outputsReceived = 0; r.drop.partialText = ''; }, ['drop-no-partial-output']],
    ['every output delivered', r => { r.drop.outputsReceived = 3; }, ['drop-no-partial-output']],
    ['an automatic resend', r => { r.drop.resend.requesterAttemptsOnThread = 2; }, ['drop-resent']],
    ['a second reservation on the thread', r => { r.drop.resend.ledgerReservations = 2; }, ['drop-resent']]
  ])('refuses %s', (_name, change, expected) => {
    expect(codes(judged(change))).toEqual(expected);
  });
});

describe('the settlement replay', () => {
  it.each([
    ['a missing replay', r => { r.split.settlementReplay = null; }, ['replay-missing']],
    ['live-collected terms', r => { r.cancel.settlementReplay.termsCollectedBy = 'live'; }, ['replay-label']],
    ['terms naming another policy', r => { r.split.settlementReplay.termsPolicyDigest = 'sha256:' + '8'.repeat(64); }, ['replay-policy-mismatch']],
    ['a split replay debit other than the ledger\'s', r => { r.split.settlementReplay.result.reservations[0].debit = 2; }, ['replay-differs-from-ledger']],
    ['split credits other than the ledger\'s', r => { r.split.settlementReplay.result.reservations[0].credits[0].amount = 0; }, ['replay-differs-from-ledger']],
    ['a cancel without the signed stop', r => { r.cancel.settlementReplay.stopSigned = false; }, ['replay-differs-from-ledger']],
    ['a split that is still open', r => { r.split.settlementReplay.result.reservations[0].status = 'open'; }, ['replay-not-settled']],
    ['a conflict', r => { r.split.settlementReplay.result.reservations[0].status = 'conflict'; }, ['replay-conflict']],
    ['an invalid policy match', r => { r.cancel.settlementReplay.result.reservations[0].status = 'invalid'; }, ['replay-invalid']],
    ['an unknown drop', r => { r.drop.settlementReplay.result.reservations[0].status = 'unknown'; }, ['replay-unknown', 'replay-drop-charged']],
    ['a charged drop', r => { Object.assign(r.drop.settlementReplay.result.reservations[0], { status: 'settled', debit: 1 }); }, ['replay-drop-charged']],
    ['another reservation', r => { r.split.settlementReplay.result.reservations[0].reservationId = 'other'; }, ['replay-reservation-missing']]
  ])('refuses %s', (_name, change, expected) => {
    expect(codes(judged(change))).toEqual(expected);
  });

  it('accepts a dropped answer the replay settled at zero', () => {
    expect(checkStage1Receipt(goodReceipt(), expectations).ok).toBe(true);
    expect(codes(judged(r => { Object.assign(r.drop.settlementReplay.result.reservations[0], { status: 'settled', debit: 0 }); }))).toEqual([]);
  });
});

describe('what a stage process loaded', () => {
  it.each([
    ['nothing recorded', r => { delete r.hosts[0].loaded; }, ['loaded-unrecorded']],
    ['a range outside its stage', r => { r.hosts[1].loaded.outsideStageRanges = 1; }, ['loaded-outside-stage']],
    ['fewer ranges than assigned', r => { Object.assign(r.hosts[0].loaded, { rangeCount: 1050 }); }, ['loaded-not-assigned']],
    ['the complete weights', r => { Object.assign(r.hosts[1].loaded, { rangeCount: 5512, bytes: 16994352128, rangesDigest: digest('9') }); },
      ['executor-holds-complete-weights', 'loaded-not-assigned']],
    ['a directory listing instead of the loader', r => { r.hosts[0].loaded.source = 'directory-listing'; }, ['loaded-source']]
  ])('refuses %s', (_name, change, expected) => {
    expect(codes(judged(change))).toEqual(expected);
  });

  it('allows and records a full copy elsewhere on the host, but not another stage\'s ranges outside it', () => {
    expect(checkStage1Receipt(goodReceipt(), expectations).ok).toBe(true);
    expect(codes(judged(r => { r.hosts[0].hostWeights.afterSplit.outsideElsewhere = 4461; }))).toEqual(['host-weights-outside-full-copy']);
    expect(codes(judged(r => { delete r.hosts[1].hostWeights; }))).toEqual(['host-weights-unmeasured', 'host-weights-unmeasured']);
    expect(codes(judged(r => { r.cleanup.fullCopyLocks[0].restored = false; }))).toEqual(['full-copy-lock-not-restored']);
  });
});

describe('a good receipt', () => {
  it('passes as pooled capacity when both solo controls ran out of device memory at identical settings', () => {
    expect(checkStage1Receipt(goodReceipt(), expectations)).toMatchObject({ ok: true, label: LABEL_POOLED, reasons: [] });
  });

  it('keeps the known-wrong reference answer: parity is with 22, not with the correct 26', () => {
    const verdict = judged(receipt => { receipt.split.text = '26'; });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(['text-differs']);
  });
});

describe('the label', () => {
  it('counts a device refusal at the packed GPU weight size, below the file bytes', () => {
    expect(classifySoloControl(outOfMemory({ requiredBytes: 16941875200 }), expectations).outcome).toBe('memory');
  });

  it.each([
    ['a guard stopped it', { guardTripped: true }, 'guard'],
    ['it timed out', { timedOut: true }, 'timeout'],
    ['an operator budget refused it', { operatorCapped: true }, 'operator-budget'],
    ['nothing shows the device refused it', { evidence: 'fake-runtime' }, 'no-device-memory-evidence'],
    ['the weights were missing', { kind: 'missing-weights' }, 'missing-weights'],
    ['it asked for less than the model', { requiredBytes: 16941875199 }, 'required-bytes-below-model']
  ])('does not count a solo failure as memory when %s', (_name, failure, why) => {
    const control = outOfMemory(failure);
    expect(classifySoloControl(control, expectations)).toEqual({ outcome: 'inconclusive', why });
    const unclaimed = judged(receipt => { receipt.soloControls['host-b'] = { ...control, claimedFailure: null }; });
    expect(unclaimed).toMatchObject({ ok: true, label: LABEL_SPLIT });
  });

  it('does not count a failure at other settings', () => {
    const control = { ...outOfMemory(), settings: { ...soloSettings, maxOutputTokens: 8 } };
    expect(classifySoloControl(control, expectations)).toEqual({ outcome: 'inconclusive', why: 'settings-differ' });
  });

  it('fails with solo-fits when a control fits the model: the claim is unearned until a harder workload refuses both', () => {
    const verdict = judged(receipt => { receipt.soloControls['host-a'] = { outcome: 'completed', settings: soloSettings }; });
    expect(verdict).toMatchObject({ ok: false, label: null });
    expect(verdict.reasons).toEqual([{ code: 'solo-fits', detail: SOLO_FITS_DETAIL }]);
    expect(`${verdict.reasons[0].code}: ${verdict.reasons[0].detail}`).toBe('solo-fits: choose a harder workload');
  });
});

describe('a device that refuses partway through the upload', () => {
  it('counts when the record names the whole model it asked for and how far it got', () => {
    const control = outOfMemory({ requiredBytes: 16941875200, allocatedBeforeFailureBytes: 11811160064, failedBufferBytes: 536870912 });
    expect(classifySoloControl(control, { ...expectations, minimumSoloLoadBytes: 16941875200 })).toEqual({ outcome: 'memory', why: 'device-out-of-memory' });
  });

  it.each([
    ['only the failing buffer as required', { requiredBytes: 536870912 }, 'required-bytes-below-model'],
    ['a small refusal with nothing loaded', { allocatedBeforeFailureBytes: 0, failedBufferBytes: 4096 }, 'small-allocation'],
    ['an allocation outside the load', { during: 'generation' }, 'outside-model-load'],
    ['no record of how far it got', { allocatedBeforeFailureBytes: null }, 'load-progress-unknown']
  ])('stays inconclusive with %s', (_name, change, why) => {
    expect(classifySoloControl(outOfMemory(change), { ...expectations, minimumSoloLoadBytes: 16941875200 })).toEqual({ outcome: 'inconclusive', why });
  });
});

describe('rejects', () => {
  it('a requester without a machine of its own', () => {
    expect(codes(judged(receipt => { receipt.requester.machine = receipt.hosts[1].machine; }))).toEqual(['requester-not-separate-machine']);
    expect(codes(judged(receipt => { delete receipt.requester.machine; }))).toEqual(['requester-not-separate-machine']);
  });

  it('shares that differ from the operator weights', () => {
    const verdict = judged(receipt => {
      receipt.split.settlement.credits = [{ computerId: 'computer-a', amount: 2 }, { computerId: 'computer-b', amount: 1 }];
      receipt.split.settlement.journal = [{ accountId: 'computer-requester', delta: -3 }, { accountId: 'computer-a', delta: 2 }, { accountId: 'computer-b', delta: 1 }];
    });
    expect(codes(verdict)).toContain('settlement-shares');
  });

  it('accepts a stage legitimately paid nothing by rounding at its weight', () => {
    const weighted = { ...expectations, creditWeights: [1, 5] };
    const receipt = goodReceipt();
    for (const [trace, tokens] of [[receipt.split.settlement, 3], [receipt.cancel.settlement, 1]]) {
      trace.credits = [{ computerId: 'computer-a', amount: 0 }, { computerId: 'computer-b', amount: tokens }];
      trace.journal = [{ accountId: 'computer-requester', delta: -tokens }, { accountId: 'computer-a', delta: 0 }, { accountId: 'computer-b', delta: tokens }];
    }
    receipt.split.settlementReplay = replayOf(receipt.split.settlement);
    receipt.cancel.settlementReplay = replayOf(receipt.cancel.settlement, 'settled', { stopSigned: true });
    expect(checkStage1Receipt(receipt, weighted).ok).toBe(true);
    expect(codes(checkStage1Receipt(goodReceipt(), weighted))).toContain('settlement-shares');
  });

  it('a failed service restore', () => {
    const verdict = judged(receipt => { receipt.serviceRestores = [{ host: 'host-a', stopped: true, restored: false, verifiedActive: false }]; });
    expect(codes(verdict)).toEqual(['service-restore-failed']);
    expect(codes(judged(receipt => { receipt.serviceRestores = [{ host: 'host-a', stopped: true, restored: true, verifiedActive: true, failedAttempts: 1 }]; })))
      .toEqual(['service-restore-failed']);
    expect(codes(judged(receipt => { delete receipt.serviceRestores; }))).toEqual(['service-restore-unrecorded']);
  });

  it('an inventory that searched less than the whole model or not the stage directory', () => {
    expect(codes(judged(receipt => { receipt.hosts[0].inventory.beforeSplit.scannedRanges = 1051; }))).toEqual(['inventory-not-exhaustive']);
    expect(codes(judged(receipt => { receipt.hosts[1].inventory.afterSplit.scope = 'host-weight-directories'; }))).toEqual(['inventory-scope']);
    expect(codes(judged(receipt => { receipt.hosts[1].hostWeights.afterSplit.scannedRanges = 4461; }))).toEqual(['inventory-not-exhaustive']);
  });

  it.each([[0, 18], [1, 18], [2, 248047]])('one changed token at position %i', (position, token) => {
    const verdict = judged(receipt => { receipt.split.tokens.outputIds[position] = token; });
    expect(verdict.ok).toBe(false);
    expect(verdict.label).toBeNull();
    expect(codes(verdict)).toContain('tokens-differ');
  });

  it('an extra token and a missing stop token', () => {
    expect(codes(judged(receipt => { receipt.split.tokens.outputIds.push(1); }))).toContain('tokens-differ');
    expect(codes(judged(receipt => { receipt.split.tokens.outputIds.pop(); }))).toContain('tokens-differ');
  });

  it('a witness digest that disagrees with the reference', () => {
    expect(codes(judged(receipt => { receipt.split.tokens.sampleDigest = '0'.repeat(64); }))).toEqual(['tokens-sample-digest']);
  });

  it.each(['preflight', 'beforeSplit', 'afterSplit'])('a stage directory with the full weights at %s', when => {
    const verdict = judged(receipt => {
      Object.assign(receipt.hosts[1].inventory[when], { rangeCount: 5512, bytes: 16994352128, rangesDigest: digest('9'),
        outsideStageRanges: 1051, outsideStageBytes: 2759168448 });
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(['inventory-outside-stage', 'inventory-mismatch']);
  });

  it('a host holding one range outside its stage', () => {
    const verdict = judged(receipt => { Object.assign(receipt.hosts[0].inventory.afterSplit, { outsideStageRanges: 1, outsideStageBytes: 10240 }); });
    expect(codes(verdict)).toEqual(['inventory-outside-stage']);
  });

  it('a host assigned other layers', () => {
    expect(codes(judged(receipt => { receipt.hosts[1].assignedLayers = [2, 63]; }))).toEqual(['host-layers']);
  });

  it('an inventory that was declared rather than measured', () => {
    const verdict = judged(receipt => { receipt.hosts[0].inventory.preflight.source = 'fake-runtime-declared'; });
    expect(codes(verdict)).toEqual(['inventory-source']);
  });

  it.each(['preflight', 'afterSplit'])('requester pieces of the requested model at %s', when => {
    const verdict = judged(receipt => { receipt.requester[when] = requesterHolds(1); });
    expect(codes(verdict)).toEqual(['requester-holds-weights']);
  });

  it('records other files under the requester roots without counting them as the requested model', () => {
    expect(codes(judged(receipt => { receipt.requester.preflight = requesterHolds(0, { otherModelBytes: 1100000000, fileCount: 3 }); }))).toEqual([]);
  });

  it('a requester measured by bytes, not by hash-identified pieces', () => {
    expect(codes(judged(receipt => { receipt.requester.preflight = { weightBytes: 0, fileCount: 0 }; }))).toEqual(['requester-weights-unmeasured']);
  });

  it('loaded metadata that names a weight role', () => {
    expect(codes(judged(receipt => { receipt.hosts[0].loaded.metadata = { roles: ['tokenizer'], pieceCount: 3, bytes: 9089356 }; }))).toEqual([]);
    expect(codes(judged(receipt => { receipt.hosts[0].loaded.metadata = { roles: ['model-weights'], pieceCount: 1, bytes: 16 }; }))).toEqual(['loaded-metadata-invalid']);
  });

  it('a requester whose weights were never measured', () => {
    expect(codes(judged(receipt => { delete receipt.requester.afterSplit; }))).toEqual(['requester-weights-unmeasured']);
  });

  it('a requester that is also an executor', () => {
    expect(codes(judged(receipt => { receipt.requester.participantId = receipt.hosts[0].participantId; }))).toEqual(['requester-is-executor']);
  });

  it.each([
    ['an unsettled reservation', receipt => { receipt.cancel.settlement.state = 'closing'; }],
    ['credits left held', receipt => { receipt.cancel.settlement.heldAfter = 4; }],
    ['credits held at cleanup', receipt => { receipt.cleanup.heldCredits = 4; }],
    ['a reservation open at cleanup', receipt => { receipt.cleanup.openReservations = 1; }]
  ])('a stranded hold: %s', (_name, change) => {
    expect(codes(judged(change))).toEqual(['stranded-hold']);
  });

  it.each([
    ['a second debit', receipt => { receipt.cancel.settlement.journal.push({ accountId: 'computer-requester', delta: -1 }, { accountId: 'computer-b', delta: 1 }); }],
    ['a replay that moved the journal', receipt => { receipt.cancel.settlement.replay.journalAfter = 6; }],
    ['a replay that moved balances', receipt => { receipt.split.settlement.replay.balancesUnchanged = false; }],
    ['a replay that changed the outcome', receipt => { receipt.split.settlement.replay.outcomeUnchanged = false; }]
  ])('a double settlement: %s', (_name, change) => {
    expect(codes(judged(change))).toContain('double-settlement');
  });

  it('a settlement whose replay was never attempted', () => {
    expect(codes(judged(receipt => { receipt.cancel.settlement.replay = { attempted: false }; }))).toEqual(['settlement-replay-missing']);
  });

  it('a pooled capacity claim when a solo control succeeded', () => {
    const verdict = judged(receipt => {
      receipt.claim = LABEL_POOLED;
      receipt.soloControls['host-b'] = { outcome: 'completed', settings: soloSettings };
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(['solo-fits', 'pooled-capacity-unsupported']);
    expect(verdict.reasons[1].detail).toContain('host-b: completed');
  });

  it.each([
    ['guard', { guardTripped: true }],
    ['timeout', { timedOut: true }]
  ])('an inconclusive solo control (%s) claimed as a failure', (why, failure) => {
    const verdict = judged(receipt => { receipt.claim = LABEL_POOLED; receipt.soloControls['host-a'] = outOfMemory(failure); });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(['solo-failure-claim-unsupported', 'pooled-capacity-unsupported']);
    expect(verdict.reasons[0].detail).toBe(`host-a: ${why}`);
  });

  it('a runner-recorded inconclusive control claimed as a failure', () => {
    const verdict = judged(receipt => { receipt.soloControls['host-a'] = { outcome: 'inconclusive', reason: 'timeout', settings: soloSettings, claimedFailure: 'memory' }; });
    expect(codes(verdict)).toEqual(['solo-failure-claim-unsupported']);
  });

  it.each(STAGE1_PHASES)('a skipped %s phase', name => {
    const verdict = judged(receipt => { receipt.phases[name] = { status: 'skipped', reason: 'not reached' }; });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual([`phase-not-completed:${name}`]);
  });

  it('a run that hit its hard stop', () => {
    expect(codes(judged(receipt => { receipt.hardStop = { reason: 'limit' }; }))).toEqual(['hard-stop']);
  });

  it.each([['modelId', 'other'], ['modelIdentity', digest('0')], ['quantization', 'f16'], ['planIdentity', digest('0')],
    ['messagesDigest', digest('0')], ['promptDigest', '0'.repeat(64)], ['promptCount', 84], ['maxOutputTokens', 5]])('a changed workload %s', (key, value) => {
    expect(codes(judged(receipt => { receipt.workload[key] = value; }))).toContain(`workload-${key}`);
  });

  it.each(Object.keys(decoding))('changed decoding: %s', key => {
    expect(codes(judged(receipt => { receipt.workload.decoding[key] += 1; }))).toEqual(['workload-decoding']);
  });

  it('a cancel that landed after the answer finished', () => {
    expect(codes(judged(receipt => { receipt.cancel.stoppedBeforeCompletion = false; }))).toEqual(['cancel-not-mid-answer']);
    const late = settlement(3, 'cancel');
    expect(codes(judged(receipt => { receipt.cancel.settlement = late; receipt.cancel.settlementReplay = replayOf(late, 'settled', { stopSigned: true }); })))
      .toEqual(['cancel-not-mid-answer']);
  });

  it('a resident still active after the cancel', () => {
    expect(codes(judged(receipt => { receipt.cancel.residentsActive = [0, 1]; }))).toEqual(['cancel-resident-still-active']);
  });

  it('two stages on one physical machine', () => {
    expect(codes(judged(receipt => { receipt.hosts[1].machine = receipt.hosts[0].machine; }))).toEqual(['hosts-not-physically-distinct']);
  });

  it('a fake-runtime receipt against physical expectations', () => {
    expect(codes(judged(receipt => { receipt.runtimeClass = 'fake-runtime'; }))).toEqual(['runtime-class']);
  });

  it('an empty record, naming what is missing rather than throwing', () => {
    const verdict = checkStage1Receipt({}, expectations);
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(expect.arrayContaining(['receipt-schema', 'phase-not-completed:split', 'tokens-differ', 'hosts-count', 'split-settlement-missing']));
    expect(checkStage1Receipt(null, expectations).ok).toBe(false);
  });
});

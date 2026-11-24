// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkStage1Receipt, classifySoloControl, LABEL_POOLED, LABEL_SPLIT, STAGE1_PHASES, STAGE1_RECEIPT_SCHEMA } from '../../scripts/stage1/receipt-check.js';

const digest = letter => 'sha256:' + letter.repeat(64);
const decoding = { temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1 };
const workload = { modelId: 'model', modelIdentity: digest('a'), quantization: 'q4k', planIdentity: digest('b'),
  messagesDigest: digest('c'), promptDigest: 'd'.repeat(64), promptCount: 85, maxOutputTokens: 4, decoding };
const expectations = { schema: 'reploid.stage1-expectations/v1', runtimeClass: 'physical', inventorySource: 'hashed-on-host',
  inventorySha256: 'e'.repeat(64), creditsPerOutputToken: 1, workload,
  reference: { outputIds: [17, 17, 248046], sampleDigest: 'f'.repeat(64), outputText: '22', stopReasons: ['eos-token', 'stop-token'] },
  stages: [{ stageIndex: 0, layerRange: [0, 0], rangeCount: 1051, bytes: 2759168448, rangesDigest: digest('1') },
    { stageIndex: 1, layerRange: [1, 63], rangeCount: 4461, bytes: 14235183680, rangesDigest: digest('2') }],
  totalWeight: { rangeCount: 5512, bytes: 16994352128 } };

const inventory = stage => ({ source: 'hashed-on-host', rangeCount: stage.rangeCount, bytes: stage.bytes,
  rangesDigest: stage.rangesDigest, outsideStageRanges: 0, outsideStageBytes: 0 });
const settlement = (tokens, id) => ({ reservationId: id, state: 'settled', charge: tokens, outputTokens: tokens,
  credits: [{ computerId: 'computer-a', amount: tokens - 1 }, { computerId: 'computer-b', amount: 1 }],
  journal: [{ accountId: 'computer-requester', delta: -tokens }, { accountId: 'computer-a', delta: tokens - 1 }, { accountId: 'computer-b', delta: 1 }],
  heldAfter: 0, replay: { attempted: true, journalBefore: 3, journalAfter: 3, balancesUnchanged: true, outcomeUnchanged: true } });
const soloSettings = { modelId: 'model', modelIdentity: digest('a'), quantization: 'q4k', messagesDigest: digest('c'), maxOutputTokens: 4, decoding };
const outOfMemory = (extra = {}) => ({ outcome: 'failed', settings: soloSettings, claimedFailure: 'memory',
  failure: { kind: 'out-of-memory', evidence: 'device-out-of-memory', operatorCapped: false, requiredBytes: 16994352128, ...extra } });

function goodReceipt() {
  return { schema: STAGE1_RECEIPT_SCHEMA, runtimeClass: 'physical', hardStop: null, claim: null,
    phases: Object.fromEntries(STAGE1_PHASES.map(name => [name, { status: 'completed' }])), workload: structuredClone(workload),
    requester: { participantId: 'peer:r', preflight: { weightBytes: 0, fileCount: 0 }, afterSplit: { weightBytes: 0, fileCount: 0 } },
    hosts: expectations.stages.map((stage, index) => ({ label: ['host-a', 'host-b'][index], stageIndex: index, participantId: `peer:${index}`,
      machine: `machine-${index}`, assignedLayers: [...stage.layerRange], inventory: { preflight: inventory(stage), beforeSplit: inventory(stage), afterSplit: inventory(stage) } })),
    soloControls: { 'host-a': outOfMemory(), 'host-b': outOfMemory() },
    split: { text: '22', parityExact: true, settlement: settlement(3, 'split'),
      tokens: { outputIds: [17, 17, 248046], promptDigest: workload.promptDigest, tokenizerDigest: workload.promptDigest,
        sampleCount: 3, sampleDigest: 'f'.repeat(64), stopReason: 'eos-token' } },
    cancel: { stoppedBeforeCompletion: true, residentsActive: [0, 0], settlement: settlement(1, 'cancel') },
    cleanup: { processesExited: true, heldCredits: 0, openReservations: 0 } };
}
const judged = change => { const receipt = goodReceipt(); change(receipt); return checkStage1Receipt(receipt, expectations); };
const codes = verdict => verdict.reasons.map(reason => reason.code);

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
  it.each([
    ['a guard stopped it', { guardTripped: true }, 'guard'],
    ['it timed out', { timedOut: true }, 'timeout'],
    ['an operator budget refused it', { operatorCapped: true }, 'operator-budget'],
    ['nothing shows the device refused it', { evidence: 'fake-runtime' }, 'no-device-memory-evidence'],
    ['the weights were missing', { kind: 'missing-weights' }, 'missing-weights'],
    ['it asked for less than the model', { requiredBytes: 1024 }, 'required-bytes-below-model']
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

  it('is split correctness when one control fits the model and nothing claims more', () => {
    expect(judged(receipt => { receipt.soloControls['host-a'] = { outcome: 'completed', settings: soloSettings }; }))
      .toMatchObject({ ok: true, label: LABEL_SPLIT });
  });
});

describe('rejects', () => {
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

  it.each(['preflight', 'beforeSplit', 'afterSplit'])('a host with the full weights at %s', when => {
    const verdict = judged(receipt => {
      Object.assign(receipt.hosts[1].inventory[when], { rangeCount: 5512, bytes: 16994352128, rangesDigest: digest('9'),
        outsideStageRanges: 1051, outsideStageBytes: 2759168448 });
    });
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(expect.arrayContaining(['executor-holds-complete-weights', 'inventory-outside-stage', 'inventory-mismatch']));
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

  it.each(['preflight', 'afterSplit'])('requester weight bytes at %s', when => {
    const verdict = judged(receipt => { receipt.requester[when] = { weightBytes: 4096, fileCount: 1 }; });
    expect(codes(verdict)).toEqual(['requester-holds-weights']);
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
    expect(codes(verdict)).toEqual(['pooled-capacity-unsupported']);
    expect(verdict.reasons[0].detail).toContain('host-b: completed');
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
    expect(codes(judged(receipt => { receipt.cancel.settlement = late; }))).toEqual(['cancel-not-mid-answer']);
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

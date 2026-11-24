// @vitest-environment node
// Three real OS processes, real WebRTC, signaling and the fleet credit ledger, with a fake model runtime. This proves
// the harness and its judgment. It is not inference, physical memory, or a two-machine network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runLocalStage1 } from '../../scripts/stage1/run.js';
import { checkStage1Receipt, LABEL_POOLED, LABEL_SPLIT } from '../../scripts/stage1/receipt-check.js';
import { loadStage1Expectations, STAGE1_FIXTURE_FILE } from '../../scripts/stage1/expectations.js';
import { createLocalStage1Adapter } from '../../scripts/stage1/local-adapter.js';
import { runStage1Phases } from '../../scripts/stage1/runner.js';

let wrtc;
try {
  ({ default: wrtc } = await import('@roamhq/wrtc'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@roamhq/wrtc')) throw error;
}

describe.runIf(wrtc)('Stage 1 harness on three local processes', () => {
  let root, good;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-local-'));
    good = await runLocalStage1({ directory: path.join(root, 'good'), limits: { maxRunMs: 110000, phaseMs: 60000 } });
  }, 120000);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  const tampered = change => {
    const receipt = structuredClone(good.receipt);
    change(receipt);
    return checkStage1Receipt(receipt, good.expectations);
  };
  const codes = verdict => verdict.reasons.map(reason => reason.code);

  it('passes the checker as split correctness, because a fake runtime shows nothing about memory', () => {
    expect(good.verdict).toMatchObject({ ok: true, label: LABEL_SPLIT, reasons: [] });
    expect(good.receipt.runtimeClass).toBe('fake-runtime');
    expect(Object.values(good.verdict.solo).map(row => row.why)).toEqual(['no-device-memory-evidence', 'no-device-memory-evidence']);
  });

  it('carried the frozen token trace and known-wrong answer through both stages', () => {
    expect(good.receipt.split.tokens.outputIds).toEqual([17, 17, 248046]);
    expect(good.receipt.split).toMatchObject({ text: '22', parityExact: true });
    expect(good.receipt.hosts.map(host => host.assignedLayers)).toEqual([[0, 0], [1, 63]]);
    expect(good.receipt.requester.afterSplit).toEqual({ weightBytes: 0, fileCount: 0 });
  });

  it('settled the answer and the stopped answer once each on the real ledger', () => {
    expect(good.receipt.split.settlement).toMatchObject({ state: 'settled', charge: 3, outputTokens: 3, heldAfter: 0 });
    expect(good.receipt.cancel).toMatchObject({ stoppedBeforeCompletion: true, residentsActive: [0, 0] });
    // The gate holds the final token, so the stop lands with one or two of the three tokens acknowledged.
    const stopped = good.receipt.cancel.settlement;
    expect(stopped).toMatchObject({ state: 'settled', charge: stopped.outputTokens, heldAfter: 0 });
    expect([1, 2]).toContain(stopped.outputTokens);
    for (const trace of [good.receipt.split.settlement, good.receipt.cancel.settlement]) {
      expect(trace.replay).toMatchObject({ attempted: true, balancesUnchanged: true, outcomeUnchanged: true });
      expect(trace.replay.journalAfter).toBe(trace.replay.journalBefore);
    }
    expect(good.receipt.cleanup).toEqual({ processesExited: true, heldCredits: 0, openReservations: 0 });
  });

  it('dropped a stage mid-answer: partial text kept, nothing resent, the ledger expiry released the hold and charged nobody', () => {
    const { drop } = good.receipt;
    expect(drop).toMatchObject({ killed: { host: 'host-a', how: 'SIGKILL', exited: true }, completed: false,
      resend: { requesterApprovals: 1, requesterAttemptsOnThread: 1, ledgerReservations: 1 },
      settlement: { state: 'settled', status: 'expired', charge: 0, journal: [], heldAfter: 0 } });
    expect(drop.outputsReceived).toBeGreaterThanOrEqual(1);
    expect(drop.outputsReceived).toBeLessThan(3);
    expect(drop.partialText).toBe('2');
    expect(drop.accountAfter).toBe(drop.accountBefore);
  });

  it('replays every attempt from the participants\' own signed records to the ledger\'s outcome', () => {
    const rows = name => good.receipt[name].settlementReplay.result.reservations;
    expect(rows('split')).toMatchObject([{ status: 'settled', debit: 3 }]);
    expect(rows('cancel')).toMatchObject([{ status: 'settled', debit: good.receipt.cancel.settlement.charge }]);
    expect(rows('drop')).toMatchObject([{ status: 'expired', debit: 0 }]);
    for (const name of ['split', 'cancel', 'drop']) {
      const replay = good.receipt[name].settlementReplay;
      expect(replay).toMatchObject({ termsCollectedBy: 'stage1-harness', termsSigned: 'in-approval-before-dispatch', problems: [] });
      expect(replay.termsPolicyDigest).toBe(replay.ledgerPolicyDigest);
    }
    expect(good.receipt.drop.settlementReplay.acceptancesSigned).toBe('during-attempt');
    expect(good.receipt.cancel.settlementReplay.stopSigned).toBe(true);
  });

  it('records what each stage process loaded through its loader: its assigned ranges and nothing else', () => {
    good.receipt.hosts.forEach((host, index) => {
      const stage = good.expectations.stages[index];
      expect(host.loaded).toEqual({ source: 'stage-loader', rangeCount: stage.rangeCount, bytes: stage.bytes, rangesDigest: stage.rangesDigest,
        outsideStageRanges: 0, outsideStageBytes: 0 });
    });
    expect(codes(tampered(receipt => { receipt.hosts[0].loaded.outsideStageRanges = 1; }))).toEqual(['loaded-outside-stage']);
    expect(codes(tampered(receipt => { Object.assign(receipt.hosts[1].loaded, { rangeCount: 5512, bytes: good.expectations.totalWeight.bytes }); })))
      .toEqual(['executor-holds-complete-weights', 'loaded-not-assigned']);
  });

  it('rejects the same run with a charged, held, empty or resent drop', () => {
    expect(codes(tampered(receipt => { receipt.drop.settlement.charge = 1; receipt.drop.settlement.journal = [{ accountId: 'computer-requester', delta: -1 },
      { accountId: 'computer-stage1', delta: 1 }]; }))).toEqual(['drop-charged']);
    expect(codes(tampered(receipt => { receipt.drop.accountAfter -= 1; }))).toEqual(['drop-charged']);
    expect(codes(tampered(receipt => { receipt.drop.settlement.state = 'closing'; }))).toEqual(['drop-stranded-hold']);
    expect(codes(tampered(receipt => { receipt.drop.outputsReceived = 0; receipt.drop.partialText = ''; }))).toEqual(['drop-no-partial-output']);
    expect(codes(tampered(receipt => { receipt.drop.resend.ledgerReservations = 2; }))).toEqual(['drop-resent']);
  });

  it('rejects the same run when the replay disagrees with the ledger or the terms name another policy', () => {
    expect(codes(tampered(receipt => { receipt.split.settlementReplay.result.reservations[0].debit = 2; }))).toEqual(['replay-differs-from-ledger']);
    expect(codes(tampered(receipt => { receipt.cancel.settlementReplay.termsPolicyDigest = 'sha256:' + '0'.repeat(64); }))).toEqual(['replay-policy-mismatch']);
    expect(codes(tampered(receipt => { receipt.drop.settlementReplay.result.reservations[0].status = 'unknown'; }))).toContain('replay-unknown');
    expect(codes(tampered(receipt => { receipt.split.settlementReplay = null; }))).toEqual(['replay-missing']);
  });

  it('keeps host names, addresses and paths out of the receipt', () => {
    const text = JSON.stringify(good.receipt);
    for (const value of [root, os.homedir(), os.hostname(), '127.0.0.1']) expect(text).not.toContain(value);
  });

  it('rejects the same run with one changed token', () => {
    expect(codes(tampered(receipt => { receipt.split.tokens.outputIds[1] = 18; }))).toEqual(['tokens-differ']);
  });

  it('rejects the same run with a stage directory holding more than its stage', () => {
    const verdict = tampered(receipt => {
      const total = good.expectations.totalWeight;
      Object.assign(receipt.hosts[0].inventory.afterSplit, { rangeCount: total.rangeCount, bytes: total.bytes });
    });
    expect(codes(verdict)).toEqual(['inventory-mismatch']);
  });

  it('rejects the same run with requester weight bytes', () => {
    expect(codes(tampered(receipt => { receipt.requester.afterSplit = { weightBytes: 1, fileCount: 1 }; }))).toEqual(['requester-holds-weights']);
  });

  it('rejects the same run with a stranded hold', () => {
    expect(codes(tampered(receipt => { receipt.cancel.settlement.state = 'closing'; }))).toEqual(['stranded-hold']);
  });

  it('rejects the same run with a double settlement', () => {
    const verdict = tampered(receipt => { receipt.cancel.settlement.journal.push({ accountId: 'computer-requester', delta: -1 }); });
    expect(codes(verdict)).toContain('double-settlement');
  });

  it('earned before spending: the account paid the split and the stopped answer from earnings, never in debt', () => {
    const { earn, split, cancel, requester } = good.receipt;
    const earned = earn.settlements.reduce((sum, trace) => sum + trace.charge, 0);
    expect(earn.earner.computerId).toBe(requester.computerId);
    expect(earn.earner.participantId).not.toBe(requester.participantId);
    expect(split.account.before).toBe(earned);
    expect(split.account.after).toBe(earned - split.settlement.charge);
    expect(cancel.accountAfter).toBeGreaterThanOrEqual(0);
  });

  it('rejects the same run without the earning control, or with a split paid in debt', () => {
    expect(codes(tampered(receipt => { receipt.earn = null; }))).toContain('earn-missing');
    expect(codes(tampered(receipt => { receipt.split.account.before = 0; receipt.split.account.after = -receipt.split.settlement.charge; })))
      .toEqual(expect.arrayContaining(['spend-before-earning', 'spend-in-debt']));
    expect(codes(tampered(receipt => { receipt.earn.earner.participantId = receipt.requester.participantId; }))).toEqual(['earn-by-requester-device']);
    expect(good.receipt.earn.accountBefore).toBe(0);
    expect(codes(tampered(receipt => { receipt.earn.accountBefore = 10; }))).toEqual(['earn-seeded-balance']);
  });

  it('refuses a pooled capacity claim on the fake run', () => {
    expect(codes(tampered(receipt => { receipt.claim = LABEL_POOLED; }))).toEqual(['pooled-capacity-unsupported']);
  });

  it('refuses the fake run against physical expectations', () => {
    expect(codes(checkStage1Receipt(good.receipt, { ...good.expectations, runtimeClass: 'physical', inventorySource: 'hashed-on-host' })))
      .toEqual(expect.arrayContaining(['runtime-class', 'inventory-source', 'hosts-not-physically-distinct']));
  });

  it('runs a 72-token multi-character reference and stops it before its final token', async () => {
    const source = JSON.parse(await fs.readFile(STAGE1_FIXTURE_FILE, 'utf8'));
    const visibleOutputIds = Array.from({ length: 71 }, (_, index) => 1000 + index);
    const outputText = Array.from({ length: 71 }, (_, index) => `word${index} `).join('');
    const fixtureFile = path.join(root, 'long-reference.json');
    await fs.writeFile(fixtureFile, JSON.stringify({ ...source, maxOutputTokens: 80,
      reference: { ...source.reference, visibleOutputIds, outputText } }));
    const long = await runLocalStage1({ directory: path.join(root, 'long'), fixtureFile, limits: { maxRunMs: 100000, phaseMs: 60000 } });
    expect(long.verdict).toMatchObject({ ok: true, label: LABEL_SPLIT, reasons: [] });
    expect(long.receipt.split.text).toBe(outputText);
    expect(long.receipt.split.tokens.outputIds).toHaveLength(72);
    expect(long.receipt.split.settlement).toMatchObject({ charge: 72, outputTokens: 72 });
    const stopped = long.receipt.cancel.settlement.outputTokens;
    expect(stopped).toBeGreaterThanOrEqual(1);
    expect(stopped).toBeLessThan(72);
    expect(long.receipt.drop.outputsReceived).toBeGreaterThanOrEqual(1);
    expect(long.receipt.drop.outputsReceived).toBeLessThan(72);
    expect(long.receipt.drop.partialText.length).toBeLessThan(outputText.length);
  }, 110000);

  it('kills every process it started on a hard stop and does not pass', async () => {
    const loaded = await loadStage1Expectations({ runtimeClass: 'fake-runtime' });
    const adapter = createLocalStage1Adapter({ directory: path.join(root, 'stopped'), ...loaded });
    await fs.mkdir(path.join(root, 'stopped'), { recursive: true });
    let started = [];
    const guarded = { ...adapter, guard: async phase => {
      if (phase !== 'cancel') return;
      started = adapter.processIds();
      throw Error('test guard');
    } };
    const receipt = await runStage1Phases({ adapter: guarded, expectations: loaded.expectations, limits: { maxRunMs: 60000, phaseMs: 30000 } });
    expect(started).toHaveLength(3);
    expect(receipt.hardStop).toMatchObject({ confirmed: true });
    expect(receipt.phases.cancel.status).toBe('skipped');
    for (const pid of started) expect(() => process.kill(pid, 0)).toThrow();
    const verdict = checkStage1Receipt(receipt, loaded.expectations);
    expect(verdict.ok).toBe(false);
    expect(codes(verdict)).toEqual(expect.arrayContaining(['hard-stop', 'phase-not-completed:cancel', 'phase-not-completed:cleanup']));
  }, 90000);
});

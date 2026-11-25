// @vitest-environment node
// A disconnect with no signed stop and no provider failure, on three real OS processes with the real fleet ledger and a
// fake model runtime: the requester stops asking partway and signs nothing, every stage closes, and the ledger and the
// replay both charge the acknowledged prefix as an unattributed disconnect (docs/settlement-replay.md, "Unfinished answers").
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkload } from '../../scripts/stage1/run.js';
import { createLocalStage1Adapter } from '../../scripts/stage1/local-adapter.js';
import { verifyTrade } from '../../scripts/settlement/verify-trade.js';

let wrtc;
try {
  ({ default: wrtc } = await import('@roamhq/wrtc'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@roamhq/wrtc')) throw error;
}

describe.runIf(wrtc)('Stage 1 harness: a disconnect with no signed stop', () => {
  let root, adapter, preflight, gone, cleanup;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-disconnect-'));
    const loaded = await loadWorkload('fake-runtime', null);
    adapter = createLocalStage1Adapter({ directory: path.join(root, 'run'), ...loaded });
    const signal = new AbortController().signal;
    try {
      preflight = await adapter.preflight({ signal });
      gone = await adapter.disconnectAnswer({ signal });
    } finally { cleanup = await adapter.cleanup().catch(async error => { await adapter.hardStop(); throw error; }); }
  }, 120000);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('signed no stop and left the answer unfinished', () => {
    expect(gone).toMatchObject({ completed: false, stopSigned: false });
    expect(gone.disconnected).toMatchObject({ acknowledged: expect.any(Number) });
    expect(gone.outputsReceived).toBeGreaterThanOrEqual(1);
  });

  it('charged the acknowledged prefix under the unattributed-disconnect reason, and nothing stays held', () => {
    const trace = gone.settlement;
    expect(trace).toMatchObject({ state: 'settled', reason: 'unattributed-disconnect-acknowledged-prefix', heldAfter: 0 });
    expect(trace.outputTokens).toBeGreaterThanOrEqual(1);
    expect(trace.outputTokens).toBeLessThanOrEqual(gone.outputsReceived);
    expect(trace.charge).toBe(trace.outputTokens);
    expect(gone.accountAfter).toBe(gone.accountBefore - trace.charge);
    expect(cleanup).toEqual({ processesExited: true, heldCredits: 0, openReservations: 0 });
  });

  it('replays from the signed records to the same charge, and the outsider kit verifies it', async () => {
    const [row] = gone.settlementReplay.result.reservations;
    expect(row).toMatchObject({ status: 'settled', debit: gone.settlement.charge, chargedOutputs: gone.settlement.outputTokens });
    expect(row.reason).toContain('no signed stop and no verified provider failure');
    expect(gone.settlementReplay).toMatchObject({ problems: [], stopSigned: false });
    const verdict = await verifyTrade({ receipt: { requester: preflight.requester, hosts: preflight.hosts, disconnect: gone }, at: Date.now() + 24 * 3600 * 1000 });
    expect(verdict.attempts.flatMap(item => item.problems)).toEqual([]);
    expect(verdict.ok).toBe(true);
  });
});

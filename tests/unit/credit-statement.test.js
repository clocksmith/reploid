// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { signAsParticipant } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createAttemptEvidenceSigner, attemptRouteHash, outputChainGenesis, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { FLEET_SERVICE_REQUEST_SCHEMA } from '../../server/fleet/contract.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { creditSettlementDeltas } from '../../server/fleet/credit-shares.js';
import { FLEET_CREDIT_STATEMENT_V2_SCHEMA, verifyCreditStatement } from '../../server/fleet/credit-statement.js';

const runFile = promisify(execFile);
const cliScript = fileURLToPath(new URL('../../server/fleet/credit-statement.js', import.meta.url));
const hash = 'sha256:' + 'a'.repeat(64);
const other = 'sha256:' + 'b'.repeat(64);
const policy = {
  schema: 'reploid.service-credit-policy/v1',
  version: 'test/1',
  unit: 'noncash-service-credit',
  creditsPerOutputToken: 1,
  maxDebt: 50,
  maxOutputTokens: 20,
  maxPendingPerComputer: 4,
  maxClockSkewMs: 1000,
  maxRequestMs: 60000,
  allowSameOwner: true,
  wholeModelTerminalCharge: 0,
};

describe('offline service-credit statement verification', () => {
  let directory, ledger, identities, computers;
  const at = Date.now();

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'reploid-credit-statement-'));
    identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    computers = identities.map((identity, index) => ({
      id: `computer-${index}`,
      name: `Computer ${index}`,
      ownerId: `computer-${index}`,
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }],
    }));
    ledger = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'), computers, policy, now: () => at });
  });

  afterEach(async () => {
    ledger?.close();
    await rm(directory, { recursive: true, force: true });
  });

  const wholeRequest = (id, consumer = 0, provider = 1) => ({
    id,
    executionId: `execution-${id}`,
    mode: 'whole-model',
    consumer: identities[consumer].peerId,
    providers: [{ participantId: identities[provider].peerId, weight: 1 }],
    model: { id: 'model', identity: hash, adapterIdentities: [] },
    inputDigest: hash,
    maxOutputTokens: 10,
  });

  async function wholeReceipt(input, outputTokens = 6, provider = 1, consumer = 0) {
    const draft = await createReceiptDraft({
      version: 2,
      provider: identities[provider].peerId,
      consumer: identities[consumer].peerId,
      jobHash: `request:${input.executionId}`,
      model: input.model.id,
      modelIdentity: input.model.identity,
      adapterIdentities: [],
      inputDigest: input.inputDigest,
      outputDigest: other,
      inputTokens: 12,
      outputTokens,
      usage: 'raw-model-tokens/v1',
      status: 'completed',
      cleanup: 'settled',
      stopReason: 'eos',
      ownerPolicyDigest: null,
      timestamp: at,
    });
    return countersignReceipt(await signReceiptDraft(draft, identities[provider]), identities[consumer]);
  }

  function dispatch(input) {
    ledger.reserve(input);
    ledger.dispatch(input.id, input.consumer);
  }

  async function partitionBundle(id, stageIndexes, weights, count, consumer = 0, signedAtMs = at) {
    const route = {
      schema: 'reploid.partition-route/v1',
      modelId: 'model',
      modelIdentity: hash,
      planId: hash,
      stages: stageIndexes.map((ownerIndex, index) => ({
        index,
        participantId: identities[ownerIndex].peerId,
        transportId: `transport-${index}`,
        residentId: `resident-${index}`,
        executionId: `stage-${index}`,
      })),
      activation: {
        schema: 'doppler.activation-tensor/v1',
        dtype: 'f32',
        hiddenSize: 1024,
        precision: 'f32',
        components: 1,
        elementStrideBytes: 4,
      },
    };
    const identity = {
      schema: 'reploid.partition-attempt/v2',
      threadId: 'thread',
      attemptId: `execution-${id}`,
      requesterId: identities[consumer].peerId,
      placementGeneration: 0,
      route,
    };
    const input = {
      ...wholeRequest(id, consumer, stageIndexes[0]),
      mode: 'partition',
      route: identity,
      providers: stageIndexes.map((ownerIndex, i) => ({ participantId: identities[ownerIndex].peerId, weight: weights[i] })),
    };
    const routeHash = await attemptRouteHash(identity);
    const signedAt = new Date(signedAtMs).toISOString();
    const chain = count === 0 ? await outputChainGenesis({ reservationId: input.id, routeHash }) : other;
    const receipts = await Promise.all(stageIndexes.map(async (ownerIndex, index) => createAttemptEvidenceSigner({ identity: identities[ownerIndex] }).sign(
      STAGE_RECEIPT_SCHEMA,
      {
        schema: STAGE_RECEIPT_SCHEMA,
        reservationId: input.id,
        attemptId: input.executionId,
        routeHash,
        partitionIndex: index,
        participantId: identities[ownerIndex].peerId,
        sequence: 2,
        status: 'settled',
        steps: count,
        tokens: { prompt: 12, processed: 12 + count },
        timing: {
          reservedAt: signedAt,
          firstStepAt: count ? signedAt : null,
          lastStepAt: count ? signedAt : null,
          closedAt: signedAt,
        },
        output: index === stageIndexes.length - 1 ? { count, chain, done: true, stopReason: 'eos' } : null,
        signedAt,
      },
    )));
    const acknowledgment = await createAttemptEvidenceSigner({ identity: identities[consumer] }).sign(
      OUTPUT_ACKNOWLEDGMENT_SCHEMA,
      {
        schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA,
        reservationId: input.id,
        attemptId: input.executionId,
        routeHash,
        requesterId: identities[consumer].peerId,
        count,
        chain,
        signedAt,
      },
    );
    return { input, identity, receipts, acknowledgment, routeHash, signedAt };
  }

  it('recomputes balances offline across whole-model, uneven split, own-stage share and terminal cleanup', async () => {
    // 1. computer-0 serves computer-1 (earns +6).
    const req1 = wholeRequest('whole-earn', 1, 0);
    dispatch(req1);
    await ledger.settle(req1.id, await wholeReceipt(req1, 6, 0, 1));

    // 2. computer-0 spends on a 1:2 split across computer-1 and computer-2 for 7 tokens (-7, +2, +5).
    const split1 = await partitionBundle('split-spend', [1, 2], [1, 2], 7, 0);
    dispatch(split1.input);
    ledger.admit(split1.input.id, 0);
    ledger.admit(split1.input.id, 1);
    await ledger.settle(split1.input.id, { identity: split1.identity, receipts: split1.receipts, acknowledgment: split1.acknowledgment });

    // 3. computer-0 runs stage 0 of its own 1:1 split with computer-2 for 5 tokens (own share 2 unbilled; charge 3 -> -3, +3).
    const splitOwn = await partitionBundle('split-own-stage', [0, 2], [1, 1], 5, 0);
    dispatch(splitOwn.input);
    ledger.admit(splitOwn.input.id, 0);
    ledger.admit(splitOwn.input.id, 1);
    await ledger.settle(splitOwn.input.id, { identity: splitOwn.identity, receipts: splitOwn.receipts, acknowledgment: splitOwn.acknowledgment });

    // 4. computer-0 cancels a whole-model request on computer-1 with signed zero-charge terminal cleanup (0).
    const reqCancel = wholeRequest('whole-cancel', 0, 1);
    dispatch(reqCancel);
    ledger.admit(reqCancel.id, 0);
    const terminal = await signGenerationTerminal({
      requestId: reqCancel.executionId,
      provider: reqCancel.providers[0].participantId,
      consumer: reqCancel.consumer,
      model: reqCancel.model.id,
      modelIdentity: reqCancel.model.identity,
      adapterIdentities: [],
      inputDigest: reqCancel.inputDigest,
    }, 'cancelled', identities[1]);
    await ledger.settle(reqCancel.id, terminal);

    const expectedBalances = [-4, -4, 8];
    for (const [index, expected] of expectedBalances.entries()) {
      const statement = ledger.statement(`computer-${index}`);
      expect(statement.schema).toBe(FLEET_CREDIT_STATEMENT_V2_SCHEMA);
      expect(statement.balance).toBe(expected);
      const checked = await verifyCreditStatement(statement, {
        computers,
        participantIds: [identities[index].peerId],
      });
      expect(checked).toMatchObject({
        ok: true,
        accountId: `computer-${index}`,
        computerIds: [`computer-${index}`],
        statedBalance: expected,
        recomputedBalance: expected,
        balanceMatches: true,
        uncheckedCount: 0,
      });
    }

    // Offline CLI verifier succeeds on a written statement file and fails on a tampered balance.
    const statementFile = path.join(directory, 'statement-0.json');
    const statement0 = ledger.statement('computer-0');
    await writeFile(statementFile, JSON.stringify(statement0, null, 2));
    const cliOk = await runFile(process.execPath, [cliScript, statementFile]);
    expect(JSON.parse(cliOk.stdout)).toMatchObject({ ok: true, recomputedBalance: -4 });

    await writeFile(statementFile, JSON.stringify({ ...statement0, balance: 99 }, null, 2));
    const cliBad = await runFile(process.execPath, [cliScript, statementFile]).catch(error => error);
    expect(cliBad.code).toBe(1);
    expect(JSON.parse(cliBad.stdout)).toMatchObject({ ok: false, statedBalance: 99, recomputedBalance: -4, balanceMatches: false });
  });

  it('verifies interrupted partition stage closures from participant signatures offline', async () => {
    const split = await partitionBundle('split-interrupted', [1, 2], [1, 1], 4, 0);
    const ownerToken = 'f'.repeat(64);
    dispatch(split.input);
    ledger.admit(split.input.id, 0, ownerToken);
    ledger.admit(split.input.id, 1);
    const executingStage0 = await createAttemptEvidenceSigner({ identity: identities[1] }).sign(
      STAGE_RECEIPT_SCHEMA,
      {
        schema: STAGE_RECEIPT_SCHEMA,
        reservationId: split.input.id,
        attemptId: split.input.executionId,
        routeHash: split.routeHash,
        partitionIndex: 0,
        participantId: identities[1].peerId,
        sequence: 1,
        status: 'executing',
        steps: 4,
        tokens: { prompt: 12, processed: 16 },
        timing: { reservedAt: split.signedAt, firstStepAt: split.signedAt, lastStepAt: split.signedAt, closedAt: null },
        output: null,
        signedAt: split.signedAt,
      },
    );
    await ledger.collect(split.input.id, {
      identity: split.identity,
      receipts: [executingStage0, split.receipts[1]],
      acknowledgment: split.acknowledgment,
    });
    await ledger.fence(split.input.id, split.input.consumer);
    const closeBody = {
      schema: FLEET_SERVICE_REQUEST_SCHEMA,
      participantId: identities[1].peerId,
      operation: 'closeStageOwner',
      payload: { id: split.input.id, partitionIndex: 0, owner: ownerToken, receipt: executingStage0 },
      at,
      nonce: 'nonce-1',
    };
    const closeSignature = await signAsParticipant(identities[1], FLEET_SERVICE_REQUEST_SCHEMA, closeBody);
    await ledger.closeStageOwner({ ...closeBody, signature: closeSignature });

    // Under the failed-stage rules the interrupted stage forfeits its own share and nothing else: the final stage,
    // which closed, is paid its share of the 4 acknowledged outputs and the requester pays exactly that.
    expect(ledger.request(split.input.id).outcome).toMatchObject({ charge: 2, forfeitedStages: [{ partitionIndex: 0, cause: 'fault' }] });
    for (const [index, expected] of [-2, 0, 2].map((val, idx) => [idx, val])) {
      const checked = await verifyCreditStatement(ledger.statement(`computer-${index}`));
      expect(checked).toMatchObject({ ok: true, statedBalance: expected, recomputedBalance: expected, uncheckedCount: 0 });
    }
  });

  it('reports entries that cannot be checked from signed receipts, forged signatures, replays and key tampering', async () => {
    // 1. Valid whole-model entry, then tamper with stated delta, signature, replay and participant key list.
    const paid = wholeRequest('whole-paid', 0, 1);
    dispatch(paid);
    await ledger.settle(paid.id, await wholeReceipt(paid, 5, 1, 0));
    const providerStatement = ledger.statement('computer-1');
    expect(await verifyCreditStatement(providerStatement)).toMatchObject({ ok: true, recomputedBalance: 5 });

    // Operator alters stated delta on a valid receipt: recomputedBalance stays 5, entry is flagged.
    const alteredDelta = structuredClone(providerStatement);
    alteredDelta.entries[0].delta = 2;
    alteredDelta.balance = 2;
    const deltaReport = await verifyCreditStatement(alteredDelta);
    expect(deltaReport).toMatchObject({
      ok: false,
      statedBalance: 2,
      recomputedBalance: 5,
      balanceMatches: false,
      unchecked: [expect.objectContaining({ statedDelta: 2, recomputedDelta: 5, reason: expect.stringMatching(/delta differs/i) })],
    });

    // Forged signature: recomputedBalance drops the forged entry and flags it in unchecked.
    const forgedSig = structuredClone(providerStatement);
    forgedSig.entries[0].evidence.consumerSignature = 'A'.repeat(86);
    const sigReport = await verifyCreditStatement(forgedSig);
    expect(sigReport).toMatchObject({
      ok: false,
      statedBalance: 5,
      recomputedBalance: 0,
      uncheckedCount: 1,
    });

    // Replayed receipt under a second journal entry: second entry is rejected as duplicate settled work.
    const replayed = structuredClone(providerStatement);
    replayed.entries.push({ ...structuredClone(replayed.entries[0]), sequence: 99, requestId: 'replayed-id' });
    const replayReport = await verifyCreditStatement(replayed);
    expect(replayReport.ok).toBe(false);
    expect(replayReport.recomputedBalance).toBe(5);
    expect(replayReport.uncheckedCount).toBe(1);

    // Tampered account keys caught when contributor pins their own participantIds.
    await expect(verifyCreditStatement(providerStatement, { participantIds: [identities[2].peerId] }))
      .rejects.toThrow(/participant identities/);

    // 2. Partition cancelled at 0 outputs where stage 1 never signed (operator SQLite unadmitted state):
    // delta is 0, but offline verification reports that stage 1 lacks a signed closing receipt (under the failed-stage
    // rules a stage with no closing receipt is decided only after the release window, for acknowledged output).
    const unadmittedSplit = await partitionBundle('split-unadmitted-stage', [1, 2], [1, 1], 0, 0);
    dispatch(unadmittedSplit.input);
    ledger.admit(unadmittedSplit.input.id, 0);
    await ledger.fence(unadmittedSplit.input.id, unadmittedSplit.input.consumer);
    await ledger.collect(unadmittedSplit.input.id, {
      identity: unadmittedSplit.identity,
      receipts: [unadmittedSplit.receipts[0]],
      acknowledgment: unadmittedSplit.acknowledgment,
    });
    const unadmittedReport = await verifyCreditStatement(ledger.statement('computer-0'));
    expect(unadmittedReport.ok).toBe(false);
    expect(unadmittedReport.recomputedBalance).toBe(-5);
    expect(unadmittedReport.unchecked).toEqual([
      expect.objectContaining({
        requestId: 'split-unadmitted-stage',
        statedDelta: 0,
        recomputedDelta: null,
        reason: expect.stringMatching(/no closing receipt/i),
      }),
    ]);
  });

  it('conserves integer shares in creditSettlementDeltas and avoids negative zero on zero-charge entries', () => {
    const computerOf = peer => ({ p0: 'c0', p1: 'c1', p2: 'c2', p1b: 'c1' })[peer];
    // 1:1:1 on 10 units assigns stage-order remainder to the final stage (3, 3, 4) and consolidates c1 (3 + 4 = 7).
    const consolidated = creditSettlementDeltas({
      computerId: 'c0',
      providers: [
        { participantId: 'p1', weight: 1 },
        { participantId: 'p2', weight: 1 },
        { participantId: 'p1b', weight: 1 },
      ],
    }, 10, computerOf);
    expect(consolidated.credits.map(row => [row.participantId, row.amount])).toEqual([['p1', 3], ['p2', 3], ['p1b', 4]]);
    expect([...consolidated.deltas.entries()]).toEqual([['c0', -10], ['c1', 7], ['c2', 3]]);

    // Own-compute work is neither charged nor credited; 100% own-compute produces +0 (never -0).
    const allOwn = creditSettlementDeltas({
      computerId: 'c0',
      providers: [{ participantId: 'p0', weight: 1 }],
    }, 8, computerOf);
    expect(allOwn.ownComputeUnits).toBe(8);
    expect(allOwn.charge).toBe(0);
    expect(Object.is(allOwn.deltas.get('c0'), 0)).toBe(true);
  });

  it('expires stale reservations, reports active holds, rejects unknown accounts, and clones statement metadata', async () => {
    expect(() => ledger.statement('unknown-computer')).toThrow('Unknown service-credit account');

    const stale = wholeRequest('stale-hold', 0, 1);
    ledger.reserve(stale);
    expect(ledger.statement('computer-0').held).toBe(10);

    // Reopen past reservation deadline so statement() triggers recovery.expire() before reading held credits.
    ledger.close();
    ledger = await openFleetCredits({
      file: path.join(directory, 'credits.sqlite'),
      computers,
      policy,
      now: () => at + policy.maxRequestMs + 1,
    });
    const refreshed = ledger.statement('computer-0');
    expect(refreshed.held).toBe(0);

    // Mutating returned statement policy or computers does not affect subsequent statements.
    refreshed.policy.creditsPerOutputToken = 999;
    refreshed.computers[0].name = 'Tampered';
    const next = ledger.statement('computer-0');
    expect(next.policy.creditsPerOutputToken).toBe(policy.creditsPerOutputToken);
    expect(next.computers[0].name).toBe('Computer 0');
  });

  it('blocks late split receipts after hold expiry on an idle ledger, verifies non-reopening offline, and charges only a fresh retry', async () => {
    const releaseWindow = 30000;
    const boundedPolicy = { ...policy, version: 'test/window2', partitionUnclaimedReleaseMs: releaseWindow };
    const boundedFile = path.join(directory, 'window2.sqlite');
    let clock = at;
    ledger.close();
    ledger = await openFleetCredits({ file: boundedFile, computers, policy: boundedPolicy, now: () => clock });

    // Attempt 1: stage 0 disconnects after admission; stage 1's receipt arrives before the deadline, and the requester's
    // acknowledgment never reaches the ledger. With nothing acknowledged and a stage that did not close, the hold
    // expires at the window under every rule set (under the failed-stage rules an acknowledged answer would instead
    // settle there, with stage 0 forfeiting its share: settlement-replay.test.js).
    const attempt1 = await partitionBundle('split-attempt-1', [1, 2], [1, 2], 7, 0);
    dispatch(attempt1.input);
    ledger.admit(attempt1.input.id, 0);
    ledger.admit(attempt1.input.id, 1);
    await ledger.collect(attempt1.input.id, {
      identity: attempt1.identity,
      receipts: [attempt1.receipts[1]],
    });

    // Advance past deadline + partitionUnclaimedReleaseMs with NO intermediate snapshot/reserve calls.
    const lateAt = at + boundedPolicy.maxRequestMs + releaseWindow + 5000;
    clock = lateAt;
    const lateSignedIso = new Date(lateAt).toISOString();
    const { signature: _sig0, publicJwk: _jwk0, ...stage0Body } = attempt1.receipts[0];
    const lateStage0 = await createAttemptEvidenceSigner({ identity: identities[1] }).sign(
      STAGE_RECEIPT_SCHEMA,
      {
        ...stage0Body,
        sequence: 3,
        timing: { ...stage0Body.timing, closedAt: lateSignedIso },
        signedAt: lateSignedIso,
      },
    );
    const lateEvidence = {
      identity: attempt1.identity,
      receipts: [lateStage0, attempt1.receipts[1]],
      acknowledgment: attempt1.acknowledgment,
    };

    // Late receipt is the VERY FIRST ledger operation after deadline + releaseWindow (no snapshot/reserve/poll).
    await expect(ledger.collect(attempt1.input.id, { identity: attempt1.identity, receipts: [lateStage0] }))
      .rejects.toThrow('Claim window closed; this hold was released unclaimed');

    // Pre-retry offline check across all 3 accounts: zero debit, zero stage payouts, released hold (held = 0).
    for (const index of [0, 1, 2]) {
      const preRetryReport = await verifyCreditStatement(ledger.statement(`computer-${index}`), {
        lateClaims: [{ requestId: attempt1.input.id, evidence: lateEvidence, at: lateAt }],
      });
      expect(preRetryReport).toMatchObject({
        ok: true,
        statedBalance: 0,
        recomputedBalance: 0,
        held: 0,
        verifiedCount: 0,
        expiredCount: 1,
        uncheckedCount: 0,
        expired: [expect.objectContaining({ requestId: 'split-attempt-1', charge: 0 })],
        lateClaims: [{ requestId: 'split-attempt-1', reopenAllowed: false }],
      });
    }

    // Also verify direct settle() as the very first post-deadline operation on a second idle ledger.
    let settleClock = at;
    const settleOnlyLedger = await openFleetCredits({
      file: path.join(directory, 'window2-settle-first.sqlite'),
      computers,
      policy: boundedPolicy,
      now: () => settleClock,
    });
    try {
      settleOnlyLedger.reserve(attempt1.input);
      settleOnlyLedger.dispatch(attempt1.input.id, attempt1.input.consumer);
      settleOnlyLedger.admit(attempt1.input.id, 0);
      settleOnlyLedger.admit(attempt1.input.id, 1);
      settleClock = lateAt;
      await expect(settleOnlyLedger.settle(attempt1.input.id, lateEvidence))
        .rejects.toThrow('Claim window closed; this hold was released unclaimed');
      expect(settleOnlyLedger.statement('computer-0')).toMatchObject({ balance: 0, held: 0, entries: [] });
    } finally {
      settleOnlyLedger.close();
    }

    // Attempt 2: retry as a brand-new request at lateAt; completes cleanly and charges only the successful retry.
    const retry = await partitionBundle('split-retry-2', [1, 2], [1, 2], 7, 0, lateAt);
    dispatch(retry.input);
    ledger.admit(retry.input.id, 0);
    ledger.admit(retry.input.id, 1);
    await ledger.settle(retry.input.id, { identity: retry.identity, receipts: retry.receipts, acknowledgment: retry.acknowledgment });

    // Offline verification across requester and both stage hosts: 1 expired attempt (0 charge), 1 settled retry (-7, +2, +5).
    for (const [index, expected] of [[-7, 2, 5][0], [-7, 2, 5][1], [-7, 2, 5][2]].map((val, idx) => [idx, val])) {
      const statement = ledger.statement(`computer-${index}`);
      const report = await verifyCreditStatement(statement, {
        lateClaims: [{ requestId: attempt1.input.id, evidence: lateEvidence, at: lateAt }],
      });
      expect(report).toMatchObject({
        ok: true,
        statedBalance: expected,
        recomputedBalance: expected,
        held: 0,
        verifiedCount: 1,
        expiredCount: 1,
        uncheckedCount: 0,
        verified: [expect.objectContaining({ requestId: 'split-retry-2', delta: expected })],
        expired: [expect.objectContaining({ requestId: 'split-attempt-1', charge: 0 })],
        lateClaims: [{ requestId: 'split-attempt-1', reopenAllowed: false, reason: expect.stringMatching(/Claim window closed/i) }],
      });
    }

    // CLI --late-claim check + tamper check: even if an operator strips `expired` and injects the late receipt into `entries`,
    // offline verification catches `entry.at >= deadline + partitionUnclaimedReleaseMs` and keeps recomputedBalance at -7.
    const requesterStatement = ledger.statement('computer-0');
    const statementPath = path.join(directory, 'window2-statement.json');
    const lateClaimPath = path.join(directory, 'window2-late-claim.json');
    await writeFile(statementPath, JSON.stringify(requesterStatement, null, 2));
    await writeFile(lateClaimPath, JSON.stringify({ requestId: attempt1.input.id, evidence: lateEvidence, at: lateAt }, null, 2));
    const cliChecked = JSON.parse((await runFile(process.execPath, [cliScript, statementPath, '--late-claim', lateClaimPath])).stdout);
    expect(cliChecked).toMatchObject({
      ok: true,
      recomputedBalance: -7,
      verifiedCount: 1,
      expiredCount: 1,
      lateClaims: [{ requestId: 'split-attempt-1', reopenAllowed: false }],
    });

    const reopenedTamper = structuredClone(requesterStatement);
    reopenedTamper.expired = [];
    reopenedTamper.entries.unshift({
      sequence: 0,
      requestId: attempt1.input.id,
      delta: -7,
      at: lateAt,
      request: requesterStatement.expired[0].request,
      outcome: null,
      evidence: lateEvidence,
    });
    // Fix sequence monotonicity (1, 2) so only the claim-window rule rejects attempt 1.
    reopenedTamper.entries[0].sequence = 1;
    reopenedTamper.entries[1].sequence = 2;
    reopenedTamper.balance = -14;
    const tamperReport = await verifyCreditStatement(reopenedTamper);
    expect(tamperReport).toMatchObject({
      ok: false,
      statedBalance: -14,
      recomputedBalance: -7,
      uncheckedCount: 1,
      unchecked: [expect.objectContaining({ requestId: 'split-attempt-1', reason: expect.stringMatching(/Claim window closed/i) })],
    });
  });
});

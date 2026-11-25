// @vitest-environment node
import { it, expect } from 'vitest';
import { runNetworkJourney } from '../fixtures/network-journey.js';
import { JOURNEY_ANSWER } from '../helpers/journey-network.js';

// Real mesh, custody, journal, admission and credit service; the transport and the generator are test-owned.
it('carries one request through distribution, ranked placement, streaming, provider loss, a fresh route and a lost result', async () => {
  const receipt = await runNetworkJourney();
  const answer = JOURNEY_ANSWER.join('');
  expect(receipt.transportErrors).toEqual([]);

  // A provider without the model completes and verifies it from peers; the requester never holds model bytes.
  expect(receipt.requester.modelBytesHeld).toBe(0);
  expect(receipt.discovery.beforeFill).toHaveLength(2);
  expect(receipt.distribution).toMatchObject({ verifiedAfterFill: true, fetchedPieces: receipt.model.pieces, fetchedBytes: receipt.model.weightBytes });
  expect(receipt.distribution.pieces.every(piece => piece.source === 'authorized-custody-peers' && receipt.distribution.holders.includes(piece.supplier))).toBe(true);
  expect(receipt.discovery.afterFill).toHaveLength(3);

  // The same providers, ranking off and on: the default order knows nothing of speed, the coordinator's order does.
  expect(receipt.healthyRankingOff.route).toMatchObject({ provider: 'provider-1-slow', reason: 'default-order' });
  expect(receipt.healthyRankingOn.route).toMatchObject({ provider: 'provider-2-fast', reason: 'host-ranking' });
  for (const healthy of [receipt.healthyRankingOff, receipt.healthyRankingOn]) {
    expect(healthy.requesterSaw).toEqual({ content: answer, correct: true, outputTokens: JOURNEY_ANSWER.length });
    expect(healthy).toMatchObject({ deltaCount: JOURNEY_ANSWER.length, charge: JOURNEY_ANSWER.length, approvals: 1 });
    expect(healthy.terminalReceipt).toMatchObject({ schema: 'reploid.request-outcome/v1', attemptId: healthy.attemptId,
      finished: { status: 'completed', charge: JOURNEY_ANSWER.length }, unknown: null });
    expect(healthy.modelDigest).toBe(receipt.model.modelDigest);
    expect(healthy.routeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  }
  expect(receipt.healthyRankingOn.completionMs).toBeLessThan(receipt.healthyRankingOff.completionMs);
  // The requester is told every eligible provider it chose among, in the order it considered them.
  expect(receipt.healthyRankingOff.route.candidates.map(row => row.provider)).toEqual(['provider-1-slow', 'provider-2-fast', 'provider-3-medium']);
  expect(receipt.healthyRankingOn.route.candidates.map(row => row.provider)).toEqual(['provider-2-fast', 'provider-3-medium', 'provider-1-slow']);
  expect(Object.keys(receipt.healthyRankingOn.route.coordinatorEstimatesMs)).toEqual(['provider-2-fast', 'provider-3-medium', 'provider-1-slow']);

  // Provider stopped after its first token: the partial text survives, nothing is charged, the hold stays.
  expect(receipt.interrupted).toMatchObject({ stoppedProvider: 'provider-2-fast', deltaCount: 1, partialOutputRetained: JOURNEY_ANSWER[0],
    charge: null, holdAfterFailure: receipt.interrupted.disclosed.quoteMaximum });
  expect(receipt.interrupted.requesterSaw.error).toContain('retry requires a new attempt');
  expect(receipt.interrupted.terminalReceipt.unknown).toMatchObject({ providerExecution: 'unresolved' });

  // A fresh attempt needs fresh approval, goes to another provider and regenerates from the first token.
  expect(receipt.recovered.route).toMatchObject({ provider: 'provider-3-medium', reason: 'host-ranking' });
  expect(receipt.recovered.route.candidates.map(row => row.provider)).toEqual(['provider-3-medium', 'provider-1-slow']);
  expect(receipt.recovered).toMatchObject({ approvals: 1, recovery: 'restarted-generation', charge: JOURNEY_ANSWER.length });
  expect(receipt.recovered.requesterSaw.correct).toBe(true);
  expect(receipt.recovered.routeDigest).not.toBe(receipt.interrupted.routeDigest);

  // The interrupted hold is released only by the returning provider's signed failure evidence.
  expect(receipt.interruptedRelease).toMatchObject({ heldWhileProviderAway: receipt.interrupted.disclosed.quoteMaximum, finalStatus: 'failed', finalCharge: 0 });

  // Lost result: reconciled from the journal, generated once, charged once.
  expect(receipt.lostAcknowledgment.requesterSaw.error).toContain('No result arrived');
  expect(receipt.lostAcknowledgment.reconciliation).toMatchObject({ first: { status: 'completed', correct: true, charge: JOURNEY_ANSWER.length },
    second: { status: 'completed', charge: JOURNEY_ANSWER.length }, ledgerEntriesAddedBySecond: 0, generatedTwice: false, chargedTwice: false });
  expect(Object.values(receipt.lostAcknowledgment.reconciliation.executionsAdded).reduce((a, b) => a + b, 0)).toBe(1);

  // A provider that never returns: the hold survives until the claim window passes, then is released uncharged.
  expect(receipt.providerNeverReturns).toMatchObject({ stoppedProvider: 'provider-2-fast', deltaCount: 1, charge: null,
    holdBeforeWindow: receipt.providerNeverReturns.disclosed.quoteMaximum, holdAfterWindow: 0,
    afterWindow: { status: 'expired', charge: 0, reason: 'provider-unclaimed-after-window' } });

  // Four completed answers were charged, once each; no credit was created or destroyed and no hold is left open.
  expect(receipt.ledger).toMatchObject({ sumOfBalances: 0, openHolds: 0 });
  expect(receipt.ledger.balances['owner-requester'].balance).toBe(-4 * JOURNEY_ANSWER.length);
  expect(receipt.outcome).toEqual({ wholeRequestAndRecoveryWorkTogether: true, recoveryMode: 'restarted-generation' });
}, 30000);

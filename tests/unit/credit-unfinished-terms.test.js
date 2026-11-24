import { expect, it } from 'vitest';
import { creditSettlementDeltas, settledCreditUnits, UNFINISHED_ANSWER_TERMS } from '../../server/fleet/credit-shares.js';

const request = terms => ({ computerId: 'requester', ...(terms ? { unfinishedTerms: terms } : {}),
  providers: [{ participantId: 'a', weight: 1 }, { participantId: 'b', weight: 1 }] });
const computerOf = peer => `computer-${peer}`;

it('an answer whose stage owner vanished charges nothing and pays no stage', () => {
  const units = settledCreditUnits(request(UNFINISHED_ANSWER_TERMS), { outputTokens: 4, interruptedStages: [0] }, 1);
  expect(units).toBe(0);
  const settled = creditSettlementDeltas(request(UNFINISHED_ANSWER_TERMS), units, computerOf);
  expect(settled.charge).toBe(0);
  expect([...settled.deltas.values()].every(delta => delta === 0)).toBe(true);
});

it('a finished answer still charges its output', () => {
  expect(settledCreditUnits(request(UNFINISHED_ANSWER_TERMS), { outputTokens: 4 }, 3)).toBe(12);
  expect(settledCreditUnits(request(UNFINISHED_ANSWER_TERMS), { outputTokens: 4, interruptedStages: [] }, 3)).toBe(12);
});

it('a reservation made before these terms keeps the charge it was accepted under', () => {
  expect(settledCreditUnits(request(null), { outputTokens: 4, interruptedStages: [0] }, 1)).toBe(4);
});

it('a fixed terminal charge is not changed by these terms', () => {
  expect(settledCreditUnits(request(UNFINISHED_ANSWER_TERMS), { outputTokens: null, fixedCharge: 0 }, 1)).toBe(0);
});

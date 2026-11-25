import { describe, expect, it } from 'vitest';
import { accountText, creditAccounts, creditActivity, serviceCreditOutcomeText } from '../../apps/poolday/ui/pool-home/service-credit-text.js';

describe('service-credit wording for one answer', () => {
  it.each([
    [{ id: 'r', charge: 20, outputTokens: 20, settledAt: 1 }, '20 credits charged for 20 output tokens'],
    [{ id: 'r', charge: 1, outputTokens: 1, settledAt: 1 }, '1 credit charged for 1 output token'],
    // A whole-model Stop settles under the accepted fixed terminal charge, which may be zero.
    [{ id: 'r', status: 'cancelled', charge: 0, outputTokens: null, settledAt: 1 }, 'Stopped · nothing charged'],
    // A split Stop can settle its acknowledged prefix.
    [{ id: 'r', status: 'cancelled', charge: 7, outputTokens: 7, settledAt: 1 }, 'Stopped · 7 credits charged'],
    [{ id: 'r', status: 'failed', charge: 0, settledAt: 1 }, 'Answer failed · nothing charged'],
    [{ id: 'r', status: 'failed', reason: 'interrupted-stage-owner', charge: 0, settledAt: 1 }, 'A computer stopped mid-answer · nothing charged'],
    [{ id: 'r', status: 'expired', charge: 0, settledAt: 1 }, 'Hold released · the computer never reported back, nothing charged'],
    [{ id: 'r', status: 'abandoned', charge: 0, settledAt: 1 }, 'Not sent · nothing charged'],
    // Dispatched, but no computer admitted it: the fence settles at zero with no status.
    [{ id: 'r', charge: 0, outputTokens: 0, settledAt: 1 }, 'Nothing charged'],
    [{ id: 'r', status: 'pending', heldCredits: 48 }, 'Pending · 48 credits held until the computer reports back'],
    [{ id: 'r', status: 'pending', error: 'Fleet request failed' }, 'Pending · outcome not yet settled']
  ])('%j reads as %s', (credit, text) => {
    expect(serviceCreditOutcomeText(credit)).toBe(text);
  });

  it('states nothing for an answer without a service-credit record', () => {
    expect(serviceCreditOutcomeText(null)).toBe('');
  });
});

describe('service-credit account and statement wording', () => {
  it('separates the paying account and states holds and what is available', () => {
    const { own, others } = creditAccounts({ accounts: [{ id: 'a', name: 'A', balance: 5, held: 0, available: 5 },
      { id: 'b', name: 'B', balance: 10, held: 8, available: 2 }] }, 'b');
    expect(own.name).toBe('B');
    expect(others.map(row => row.id)).toEqual(['a']);
    expect(accountText(own)).toBe('10 credits · 8 credits held for unfinished answers · 2 credits available');
    expect(accountText(others[0])).toBe('5 credits');
    expect(creditAccounts({ accounts: [] }, 'b').own).toBeNull();
  });

  it('lists earned, spent and released holds newest first within a bound', () => {
    const statement = { entries: Array.from({ length: 10 }, (_, index) => ({ requestId: `r${index}`, at: index,
      delta: index % 2 ? -3 : 4, request: { model: { id: 'm' } }, outcome: { outputTokens: index % 2 ? 3 : 4 } })),
    expired: [{ requestId: 'x', request: { model: { id: 'm' }, createdAt: 50 }, outcome: { status: 'expired', settledAt: 60 } }] };
    const rows = creditActivity(statement, { modelName: () => 'Model', limit: 3 });
    expect(rows.map(row => row.text)).toEqual(['Hold released unclaimed for Model · nothing charged',
      'Spent 3 credits asking Model · 3 output tokens', 'Earned 4 credits serving Model · 4 output tokens']);
    expect(creditActivity(null)).toEqual([]);
  });
});

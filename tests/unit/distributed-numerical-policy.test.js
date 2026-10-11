// @vitest-environment node
import { it, expect } from 'vitest';
import { resolveNumericalPolicy, numericalAcceptance } from '../fixtures/distributed-numerical-policy.js';

it('requires applicable numerical checks by default and rejects an ordinary opt-out', () => {
  expect(resolveNumericalPolicy({ applicable: true, diagnostic: false })).toBe('required');
  expect(() => resolveNumericalPolicy({ applicable: true, diagnostic: false, requested: '0' }))
    .toThrow('Ordinary acceptance requires numerical tolerance');
});

it('permits explicit diagnostic tracking while retaining a failed numerical verdict', () => {
  const policy = resolveNumericalPolicy({ applicable: true, diagnostic: true, requested: '0' });
  expect(policy).toBe('tracked');
  expect(numericalAcceptance(policy, { steps: 110, failed: 56 })).toBe('failed');
  expect(numericalAcceptance(policy, null)).toBe('not-run');
  expect(resolveNumericalPolicy({ applicable: true, diagnostic: true })).toBe('required');
});

it('does not treat an inapplicable comparison as passed', () => {
  const policy = resolveNumericalPolicy({ applicable: false, diagnostic: false });
  expect(numericalAcceptance(policy, null)).toBe('not-applicable');
  expect(() => resolveNumericalPolicy({ applicable: false, requested: '1' })).toThrow('no applicable');
  expect(() => resolveNumericalPolicy({ applicable: true, requested: 'yes' })).toThrow('must be 0 or 1');
});

// @vitest-environment node
import { it, expect } from 'vitest';
import contract from '../fixtures/distributed-reference-contract.json';
import { resolveNumericalPolicy, frozenReferenceAcceptance, numericalEvidence,
  requireNumericalQualification } from '../fixtures/distributed-numerical-policy.js';

it('requires applicable numerical checks by default and rejects an ordinary opt-out', () => {
  expect(resolveNumericalPolicy({ applicable: true, diagnostic: false })).toBe('required');
  expect(() => resolveNumericalPolicy({ applicable: true, diagnostic: false, requested: '0' }))
    .toThrow('Ordinary acceptance requires numerical tolerance');
});

it('permits explicit diagnostic tracking while retaining a failed numerical verdict', () => {
  const policy = resolveNumericalPolicy({ applicable: true, diagnostic: true, requested: '0' });
  expect(policy).toBe('tracked');
  expect(frozenReferenceAcceptance(policy, { steps: 110, failed: 56 })).toBe('failed');
  expect(frozenReferenceAcceptance(policy, null)).toBe('not-run');
  expect(resolveNumericalPolicy({ applicable: true, diagnostic: true })).toBe('required');
});

it('does not treat an inapplicable comparison as passed', () => {
  const policy = resolveNumericalPolicy({ applicable: false, diagnostic: false });
  expect(frozenReferenceAcceptance(policy, null)).toBe('not-applicable');
  expect(() => resolveNumericalPolicy({ applicable: false, requested: '1' })).toThrow('no applicable');
  expect(() => resolveNumericalPolicy({ applicable: true, requested: 'yes' })).toThrow('must be 0 or 1');
});

it('never certifies independent accuracy from a passing runtime capture', () => {
  const comparison = { steps: 110, failed: 0 };
  expect(numericalEvidence('required', comparison)).toEqual({
    frozenReferenceAcceptance: 'passed',
    independentAccuracyAcceptance: 'not-run',
    numericalAcceptance: 'not-qualified',
  });
  expect(() => requireNumericalQualification('required', comparison))
    .toThrow('not established by the captured reference');
  expect(() => requireNumericalQualification('required', null)).toThrow('not established');
  expect(() => requireNumericalQualification('required', { steps: 110, failed: 56 }))
    .toThrow('Frozen numerical tolerance exceeded');
  expect(numericalEvidence('required', { steps: 110, failed: 56 }).numericalAcceptance).toBe('failed');
});

it('retains diagnostic and inapplicable scope without treating either as qualification', () => {
  expect(() => requireNumericalQualification('tracked', { steps: 110, failed: 0 })).not.toThrow();
  expect(numericalEvidence('tracked', { steps: 110, failed: 0 }).numericalAcceptance).toBe('not-qualified');
  expect(() => requireNumericalQualification('not-applicable', null)).not.toThrow();
  expect(numericalEvidence('not-applicable', null)).toEqual({
    frozenReferenceAcceptance: 'not-applicable',
    independentAccuracyAcceptance: 'not-applicable',
    numericalAcceptance: 'not-applicable',
  });
});

it('requires the approved independent identity and all 55 steps in both placements', () => {
  const reference = { kind: 'independent-f64', proposalSha256: contract.independent.proposal.sha256,
    outputIndexSha256: contract.independent.index.sha256, steps: 55 };
  const numerical = { steps: 110, failed: 0, maxDifference: 0.0009, tolerance: 0.001,
    directions: ['mac-linux', 'linux-mac'].map(direction => ({ direction, steps: 55, failed: 0,
      tolerance: 0.001, maxDifference: 0.0009 })) };
  expect(numericalEvidence('required', numerical, reference).numericalAcceptance).toBe('passed');
  expect(() => requireNumericalQualification('required', numerical, reference)).not.toThrow();
  expect(numericalEvidence('required', { ...numerical, failed: 1 }, reference).numericalAcceptance).toBe('failed');
  expect(numericalEvidence('required', { ...numerical, steps: 55, directions: numerical.directions.slice(0, 1) }, reference)
    .numericalAcceptance).toBe('not-qualified');
  expect(numericalEvidence('required', numerical, { ...reference, proposalSha256: 'capture' })
    .numericalAcceptance).toBe('not-qualified');
  expect(numericalEvidence('required', { ...numerical, directions: numerical.directions.map(row => ({ ...row, failed: 1 })) }, reference)
    .numericalAcceptance).toBe('not-qualified');
});

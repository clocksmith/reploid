import { test, expect } from 'vitest';
import { selectPartitionDiagnostic } from '../fixtures/partition-diagnostic-selection.js';
const reference = { expected: [{ steps: [{}, {}] }, { steps: [{}] }, { steps: Array.from({ length: 51 }, () => ({})) }] };
test('prompt only selects the entire existing request without an extra boundary probe', () => {
  expect(selectPartitionDiagnostic({ prompt: '2', reference })).toEqual({ prompt: 2, step: null, promptOnly: true });
  expect(reference.expected[2].steps).toHaveLength(51);
});
test('default and explicit boundary selections retain their existing meanings', () => {
  expect(selectPartitionDiagnostic({ reference })).toEqual({ prompt: null, step: null, promptOnly: false });
  expect(selectPartitionDiagnostic({ prompt: '2', step: '0', reference })).toEqual({ prompt: 2, step: 0, promptOnly: false });
});
test('missing or invalid frozen selections reject', () => {
  for (const input of [{ step: '0' }, { prompt: '-1' }, { prompt: '' }, { prompt: '3' }, { prompt: '1', step: '1' }, { prompt: '2', step: '' }]) {
    expect(() => selectPartitionDiagnostic({ ...input, reference })).toThrow();
  }
});

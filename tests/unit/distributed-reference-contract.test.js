// @vitest-environment node
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import contract from '../fixtures/distributed-reference-contract.json' with { type: 'json' };

it('limits the reviewed reference correction to logits, preserving every frozen input and token', () => {
  const read = binding => {
    const bytes = gunzipSync(readFileSync(new URL('../fixtures/' + binding.file, import.meta.url)));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(binding.sha256);
    return JSON.parse(bytes);
  };
  const original = read(contract.historical), corrected = read(contract);
  expect(contract.tolerance).toBe(0.001);
  const { expected: oldOutputs, ...oldInputs } = original;
  const { expected: newOutputs, ...newInputs } = corrected;
  expect(newInputs).toEqual(oldInputs);
  expect(newOutputs).toHaveLength(oldOutputs.length);
  let count = 0;
  for (let index = 0; index < oldOutputs.length; index++) {
    const { steps: oldSteps, ...oldOutput } = oldOutputs[index];
    const { steps: newSteps, ...newOutput } = newOutputs[index];
    expect(newOutput).toEqual(oldOutput);
    expect(newSteps).toHaveLength(oldSteps.length);
    for (let step = 0; step < oldSteps.length; step++) {
      const { logits: oldLogits, ...oldToken } = oldSteps[step];
      const { logits: newLogits, ...newToken } = newSteps[step];
      expect(newToken).toEqual(oldToken);
      expect(Buffer.from(newLogits, 'base64').length).toBe(Buffer.from(oldLogits, 'base64').length);
      count++;
    }
  }
  expect(count).toBe(55);
});

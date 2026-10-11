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
  const original = read(contract.historical), corrected = read(contract.candidate);
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

it('keeps captured-output corrections inactive while binding the approved independent target', () => {
  expect(contract.file).toBe(contract.historical.file);
  expect(contract.sha256).toBe(contract.historical.sha256);
  expect(contract.candidate.status).toBe('inactive-runtime-capture-not-an-independent-reference');
  expect(contract.candidate.sha256).not.toBe(contract.sha256);
  expect(contract.independent.approved).toBe(true);
  expect(contract.independent.kind).toBe('independent-f64');
  expect(contract.independent.proposal.sha256).toBe('138a76cff303746fe73e5307659c0aaca5a6b2c953ac44a8798c58f6ac297210');
  expect(contract.independent.index.sha256).toBe('2c95ecd599b5007b15872c7f3b1ddc5934f5319f983375a996dab536e1021979');
});

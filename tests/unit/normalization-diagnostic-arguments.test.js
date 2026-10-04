import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { normalizationArgumentLayout } from '../fixtures/normalization-argument-layout.js';

describe('normalization diagnostic argument positions', () => {
  for (const [name, file] of [
    ['doRMSNorm', 'inference/pipelines/text/ops.js'],
    ['runRMSNorm', 'gpu/kernels/rmsnorm.js'],
    ['recordRMSNorm', 'gpu/kernels/rmsnorm.js'],
  ]) it(`reads options at the installed ${name} boundary`, () => {
    const source = readFileSync(`node_modules/doppler-gpu/src/${file}`, 'utf8');
    const declaration = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .map(node => node.declaration).find(node => node?.id?.name === name);
    expect(declaration).toBeDefined();
    const values = { input: {}, weight: {}, eps: 1e-6, options: { hiddenSize: 1024 }, recorder: { beginComputePass() {} } };
    const args = declaration.params.map(param => values[(param.left ?? param).name]);
    const slots = normalizationArgumentLayout(name);
    expect(args[slots.options]).toBe(values.options);
    expect(args[slots.options]).not.toBe(values.recorder);
    expect(args[slots.input]).toBe(values.input);
    expect(args[slots.weight]).toBe(values.weight);
    expect(args[slots.epsilon]).toBe(values.eps);
    if (slots.recorder !== null) expect(args[slots.recorder]).toBe(values.recorder);
    if (name === 'doRMSNorm') expect(args[4]).toBe(values.recorder);
  });
  it('rejects an unidentified interception point', () => {
    expect(() => normalizationArgumentLayout('unknown')).toThrow('Unknown normalization interception');
  });
});

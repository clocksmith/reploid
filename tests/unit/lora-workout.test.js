import { expect, it } from 'vitest';
import { serializeLoRASafetensors } from '../../shared/vendor/doppler/0.2.0/src/experimental/training/export.js';
import { compareAdapterWeights } from '../fixtures/lora-workout-weights.js';

const weights = (a, b) => serializeLoRASafetensors(['a', 'b'].map((kind, i) => ({
  name: 'layers.23.down_proj.lora_' + kind, shape: [1, 2], data: new Float32Array(i ? b : a)
})));

it('checks every numeric element in both unaligned F32 tensors and rejects nonfinite values', () => {
  const original = weights([0, -0.3], [0.2, 0]);
  const near = compareAdapterWeights(weights([0, -0.3], [0.2, 1e-6]), original);
  expect(near.passed).toBe(true);
  expect(near.elements).toBe(4);
  expect(near.maximumAbsolute).toBeCloseTo(1e-6, 11);
  expect(near.rootMeanSquare).toBeCloseTo(5e-7, 11);
  expect(compareAdapterWeights(weights([0, -0.3], [0.2, 1e-5]), original).passed).toBe(false);
  expect(() => compareAdapterWeights(weights([NaN, 0], [0, 0]), original)).toThrow('Nonfinite');
});

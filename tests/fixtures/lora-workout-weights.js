import assert from 'node:assert/strict';
import { parseSafetensorsHeader } from '../../shared/vendor/doppler/0.2.0/src/formats/safetensors/types.js';

// Frozen before any comparison. The optimizer LR is 1e-4.
export const weightTolerance = Object.freeze({ maximumAbsolute: 2e-5, rootMeanSquare: 2e-6 });

export function compareAdapterWeights(actual, reference) {
  const parse = buffer => {
    const { tensors, dataOffset } = parseSafetensorsHeader(buffer);
    assert.deepEqual(tensors.map(t => t.name).sort(), ['layers.23.down_proj.lora_a', 'layers.23.down_proj.lora_b']);
    let offset = dataOffset;
    for (const tensor of tensors) {
      assert.equal(tensor.dtype, 'F32');
      assert.equal(tensor.offset, offset);
      assert(tensor.shape.length === 2 && tensor.shape.every(n => Number.isSafeInteger(n) && n > 0));
      assert.equal(tensor.size, tensor.shape[0] * tensor.shape[1] * 4);
      offset += tensor.size;
    }
    assert.equal(offset, buffer.byteLength);
    return { data: new DataView(buffer), tensors };
  };
  const left = parse(actual), right = parse(reference), perTensor = [];
  let maxAbsolute = 0, squared = 0, elements = 0;
  for (const a of left.tensors) {
    const b = right.tensors.find(t => t.name === a.name);
    assert.deepEqual(a.shape, b.shape);
    let tensorMaximum = 0, tensorSquared = 0;
    for (let byte = 0; byte < a.size; byte += 4) {
      const value = left.data.getFloat32(a.offset + byte, true), expected = right.data.getFloat32(b.offset + byte, true);
      assert(Number.isFinite(value) && Number.isFinite(expected), 'Nonfinite adapter weight');
      const difference = Math.abs(value - expected);
      tensorSquared += difference * difference;
      tensorMaximum = Math.max(tensorMaximum, difference);
    }
    const count = a.size / 4;
    perTensor.push({ name: a.name, shape: a.shape, elements: count, maximumAbsolute: tensorMaximum,
      rootMeanSquare: Math.sqrt(tensorSquared / count) });
    elements += count;
    squared += tensorSquared;
    maxAbsolute = Math.max(maxAbsolute, tensorMaximum);
  }
  const rootMeanSquare = Math.sqrt(squared / elements);
  return { passed: maxAbsolute <= weightTolerance.maximumAbsolute && rootMeanSquare <= weightTolerance.rootMeanSquare,
    tolerance: weightTolerance, elements, maximumAbsolute: maxAbsolute, rootMeanSquare, perTensor };
}

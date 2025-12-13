/**
 * Reference RoPE (Rotary Position Embedding) Implementation
 */

/**
 * Precompute RoPE frequencies
 * @param {number} dim - Head dimension
 * @param {number} maxSeqLen - Maximum sequence length
 * @param {number} base - Base for frequency computation (default 10000)
 * @returns {{cos: Float32Array, sin: Float32Array}} Precomputed cos/sin [maxSeqLen, dim/2]
 */
export function computeRopeFreqs(dim, maxSeqLen, base = 10000) {
  const halfDim = dim / 2;
  const cos = new Float32Array(maxSeqLen * halfDim);
  const sin = new Float32Array(maxSeqLen * halfDim);

  for (let pos = 0; pos < maxSeqLen; pos++) {
    for (let i = 0; i < halfDim; i++) {
      const freq = 1.0 / Math.pow(base, (2 * i) / dim);
      const angle = pos * freq;
      cos[pos * halfDim + i] = Math.cos(angle);
      sin[pos * halfDim + i] = Math.sin(angle);
    }
  }

  return { cos, sin };
}

/**
 * Reference RoPE application
 * Applies rotary position embeddings to Q and K
 *
 * @param {Float32Array} x - Input [seqLen, numHeads, headDim]
 * @param {Float32Array} cos - Cos frequencies [seqLen, headDim/2]
 * @param {Float32Array} sin - Sin frequencies [seqLen, headDim/2]
 * @param {number} seqLen
 * @param {number} numHeads
 * @param {number} headDim
 * @param {number} startPos - Starting position (for KV cache)
 * @returns {Float32Array} Output with RoPE applied
 */
export function ropeRef(x, cos, sin, seqLen, numHeads, headDim, startPos = 0) {
  const output = new Float32Array(x.length);
  const halfDim = headDim / 2;

  for (let s = 0; s < seqLen; s++) {
    const pos = s + startPos;

    for (let h = 0; h < numHeads; h++) {
      const offset = s * numHeads * headDim + h * headDim;

      for (let i = 0; i < halfDim; i++) {
        const x0 = x[offset + i];
        const x1 = x[offset + i + halfDim];

        const cosVal = cos[pos * halfDim + i];
        const sinVal = sin[pos * halfDim + i];

        // Apply rotation
        output[offset + i] = x0 * cosVal - x1 * sinVal;
        output[offset + i + halfDim] = x0 * sinVal + x1 * cosVal;
      }
    }
  }

  return output;
}

/**
 * Alternative RoPE layout (interleaved pairs)
 * Some models use [x0, x1, x2, x3, ...] -> rotate pairs (x0,x1), (x2,x3), ...
 */
export function ropeInterleavedRef(x, cos, sin, seqLen, numHeads, headDim, startPos = 0) {
  const output = new Float32Array(x.length);
  const halfDim = headDim / 2;

  for (let s = 0; s < seqLen; s++) {
    const pos = s + startPos;

    for (let h = 0; h < numHeads; h++) {
      const offset = s * numHeads * headDim + h * headDim;

      for (let i = 0; i < halfDim; i++) {
        const x0 = x[offset + 2 * i];
        const x1 = x[offset + 2 * i + 1];

        const cosVal = cos[pos * halfDim + i];
        const sinVal = sin[pos * halfDim + i];

        output[offset + 2 * i] = x0 * cosVal - x1 * sinVal;
        output[offset + 2 * i + 1] = x0 * sinVal + x1 * cosVal;
      }
    }
  }

  return output;
}

export default ropeRef;

/**
 * quantizer.js - Tensor Quantization for .rpl Format
 *
 * Implements Q4_K_M quantization (4-bit with k-means clustering):
 * - Super-blocks of 256 elements
 * - 8 sub-blocks of 32 elements each
 * - Per-sub-block scales and mins
 * - 4-bit weights packed as pairs
 *
 * Q4_K_M block layout (144 bytes per 256 elements):
 * - d: f16 scale for scales (2 bytes)
 * - dmin: f16 scale for mins (2 bytes)
 * - scales: 12 bytes (6-bit per sub-block, 8 sub-blocks = 48 bits, packed)
 * - mins: Actually encoded in scales bytes
 * - qs: 128 bytes (256 * 4 bits / 8)
 *
 * @module tools/quantizer
 */

// Q4_K_M constants
const QK_K = 256;           // Super-block size
const K_SCALE_SIZE = 12;    // Bytes for scales+mins encoding
const QK4_K_BLOCK_SIZE = 144; // Total bytes per super-block

/**
 * Convert float32 to float16 (stored as uint16)
 * @param {number} value - Float32 value
 * @returns {number} Float16 as uint16
 */
function float32ToFloat16(value) {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);
  floatView[0] = value;
  const f = int32View[0];

  const sign = (f >> 31) & 0x1;
  let exp = (f >> 23) & 0xff;
  let frac = f & 0x7fffff;

  if (exp === 0xff) {
    // Inf or NaN
    return (sign << 15) | 0x7c00 | (frac ? 0x200 : 0);
  }

  if (exp === 0) {
    // Zero or denormal
    return sign << 15;
  }

  // Rebias exponent
  exp = exp - 127 + 15;

  if (exp >= 31) {
    // Overflow to infinity
    return (sign << 15) | 0x7c00;
  }

  if (exp <= 0) {
    // Underflow to zero or denormal
    if (exp < -10) {
      return sign << 15;
    }
    frac = (frac | 0x800000) >> (1 - exp);
    return (sign << 15) | (frac >> 13);
  }

  return (sign << 15) | (exp << 10) | (frac >> 13);
}

/**
 * Convert float16 (uint16) back to float32
 * @param {number} h - Float16 as uint16
 * @returns {number} Float32 value
 */
function float16ToFloat32(h) {
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;

  if (exp === 0) {
    if (frac === 0) {
      return sign ? -0 : 0;
    }
    // Denormal
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }

  if (exp === 31) {
    return frac ? NaN : (sign ? -Infinity : Infinity);
  }

  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/**
 * Find min and max of array segment
 */
function findMinMax(data, offset, length) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < length; i++) {
    const val = data[offset + i];
    if (val < min) min = val;
    if (val > max) max = val;
  }
  return { min, max };
}

/**
 * Quantize a single Q4_K super-block (256 elements)
 * @param {Float32Array} data - Source data
 * @param {number} offset - Offset into data
 * @returns {Uint8Array} Quantized block (144 bytes)
 */
function quantizeQ4KBlock(data, offset) {
  const block = new Uint8Array(QK4_K_BLOCK_SIZE);
  const blockView = new DataView(block.buffer);

  // Process 8 sub-blocks of 32 elements each
  const scales = new Float32Array(8);
  const mins = new Float32Array(8);
  const quantized = new Uint8Array(256);

  for (let sb = 0; sb < 8; sb++) {
    const sbOffset = offset + sb * 32;
    const { min, max } = findMinMax(data, sbOffset, 32);

    mins[sb] = min;
    const range = max - min;
    scales[sb] = range > 0 ? range / 15 : 0; // 4-bit = 0-15

    // Quantize sub-block
    const invScale = scales[sb] > 0 ? 1 / scales[sb] : 0;
    for (let i = 0; i < 32; i++) {
      const val = data[sbOffset + i];
      let q = Math.round((val - min) * invScale);
      q = Math.max(0, Math.min(15, q));
      quantized[sb * 32 + i] = q;
    }
  }

  // Find scale for scales and mins
  let maxScale = 0;
  let maxMin = 0;
  for (let i = 0; i < 8; i++) {
    if (scales[i] > maxScale) maxScale = scales[i];
    if (Math.abs(mins[i]) > maxMin) maxMin = Math.abs(mins[i]);
  }

  const d = maxScale / 63;      // 6-bit scales
  const dmin = maxMin / 63;

  // Write d and dmin as f16
  blockView.setUint16(0, float32ToFloat16(d), true);
  blockView.setUint16(2, float32ToFloat16(dmin), true);

  // Encode scales and mins into 12 bytes
  // This is a simplified encoding; full Q4_K_M uses packed 6-bit values
  const invD = d > 0 ? 1 / d : 0;
  const invDmin = dmin > 0 ? 1 / dmin : 0;

  const scaleBits = new Uint8Array(8);
  const minBits = new Uint8Array(8);

  for (let i = 0; i < 8; i++) {
    scaleBits[i] = Math.round(scales[i] * invD);
    scaleBits[i] = Math.min(63, scaleBits[i]);
    minBits[i] = Math.round(Math.abs(mins[i]) * invDmin);
    minBits[i] = Math.min(63, minBits[i]);
    if (mins[i] < 0) minBits[i] |= 0x40; // Sign bit in bit 6
  }

  // Pack scales and mins into 12 bytes
  // Byte layout: interleaved 6-bit scale + 6-bit min pairs
  for (let i = 0; i < 4; i++) {
    const s0 = scaleBits[i * 2];
    const s1 = scaleBits[i * 2 + 1];
    const m0 = minBits[i * 2];
    const m1 = minBits[i * 2 + 1];

    // Pack two (scale, min) pairs into 3 bytes
    block[4 + i * 3 + 0] = (s0 & 0x3f) | ((m0 & 0x03) << 6);
    block[4 + i * 3 + 1] = ((m0 >> 2) & 0x0f) | ((s1 & 0x0f) << 4);
    block[4 + i * 3 + 2] = ((s1 >> 4) & 0x03) | ((m1 & 0x3f) << 2);
  }

  // Pack 4-bit quantized values (256 elements -> 128 bytes)
  for (let i = 0; i < 128; i++) {
    const q0 = quantized[i * 2];
    const q1 = quantized[i * 2 + 1];
    block[16 + i] = (q0 & 0x0f) | ((q1 & 0x0f) << 4);
  }

  return block;
}

/**
 * Dequantize a single Q4_K super-block
 * @param {Uint8Array} block - Quantized block (144 bytes)
 * @returns {Float32Array} Dequantized values (256 elements)
 */
function dequantizeQ4KBlock(block) {
  const blockView = new DataView(block.buffer, block.byteOffset);
  const result = new Float32Array(256);

  // Read d and dmin
  const d = float16ToFloat32(blockView.getUint16(0, true));
  const dmin = float16ToFloat32(blockView.getUint16(2, true));

  // Unpack scales and mins from 12 bytes
  const scales = new Float32Array(8);
  const mins = new Float32Array(8);

  for (let i = 0; i < 4; i++) {
    const b0 = block[4 + i * 3 + 0];
    const b1 = block[4 + i * 3 + 1];
    const b2 = block[4 + i * 3 + 2];

    const s0 = b0 & 0x3f;
    const m0Raw = ((b0 >> 6) & 0x03) | ((b1 & 0x0f) << 2);
    const s1 = ((b1 >> 4) & 0x0f) | ((b2 & 0x03) << 4);
    const m1Raw = (b2 >> 2) & 0x3f;

    scales[i * 2] = s0 * d;
    scales[i * 2 + 1] = s1 * d;

    // Handle sign bit
    const m0Sign = (m0Raw & 0x40) ? -1 : 1;
    const m1Sign = (m1Raw & 0x40) ? -1 : 1;
    mins[i * 2] = m0Sign * (m0Raw & 0x3f) * dmin;
    mins[i * 2 + 1] = m1Sign * (m1Raw & 0x3f) * dmin;
  }

  // Unpack and dequantize
  for (let sb = 0; sb < 8; sb++) {
    const scale = scales[sb];
    const min = mins[sb];
    for (let i = 0; i < 32; i++) {
      const byteIdx = 16 + (sb * 32 + i) / 2;
      const shift = ((sb * 32 + i) % 2) * 4;
      const q = (block[Math.floor(byteIdx)] >> shift) & 0x0f;
      result[sb * 32 + i] = q * scale + min;
    }
  }

  return result;
}

/**
 * Quantize tensor to Q4_K_M format
 * @param {Float32Array} data - Input tensor data (flattened)
 * @param {number[]} shape - Tensor shape
 * @returns {{quantized: Uint8Array, numBlocks: number, originalSize: number}}
 */
export function quantizeToQ4KM(data, shape) {
  const numElements = shape.reduce((a, b) => a * b, 1);

  if (data.length !== numElements) {
    throw new Error(`Data length ${data.length} doesn't match shape ${shape}`);
  }

  // Pad to multiple of 256 if needed
  const numBlocks = Math.ceil(numElements / QK_K);
  const paddedLength = numBlocks * QK_K;
  const paddedData = new Float32Array(paddedLength);
  paddedData.set(data);

  // Quantize each block
  const quantized = new Uint8Array(numBlocks * QK4_K_BLOCK_SIZE);

  for (let b = 0; b < numBlocks; b++) {
    const block = quantizeQ4KBlock(paddedData, b * QK_K);
    quantized.set(block, b * QK4_K_BLOCK_SIZE);
  }

  return {
    quantized,
    numBlocks,
    originalSize: numElements * 4,  // f32 size
    quantizedSize: quantized.length,
    compressionRatio: (numElements * 4) / quantized.length,
  };
}

/**
 * Dequantize Q4_K_M tensor back to float32
 * @param {Uint8Array} quantized - Quantized data
 * @param {number} numBlocks - Number of Q4_K blocks
 * @param {number[]} shape - Original tensor shape
 * @returns {Float32Array} Dequantized data
 */
export function dequantizeQ4KM(quantized, numBlocks, shape) {
  const numElements = shape.reduce((a, b) => a * b, 1);
  const result = new Float32Array(numElements);

  for (let b = 0; b < numBlocks; b++) {
    const blockOffset = b * QK4_K_BLOCK_SIZE;
    const block = quantized.slice(blockOffset, blockOffset + QK4_K_BLOCK_SIZE);
    const dequantized = dequantizeQ4KBlock(block);

    // Copy to result, handling last block padding
    const startIdx = b * QK_K;
    const copyLen = Math.min(QK_K, numElements - startIdx);
    for (let i = 0; i < copyLen; i++) {
      result[startIdx + i] = dequantized[i];
    }
  }

  return result;
}

/**
 * Calculate quantization error (MSE)
 * @param {Float32Array} original - Original data
 * @param {Float32Array} reconstructed - Dequantized data
 * @returns {{mse: number, maxError: number, snr: number}}
 */
export function calculateQuantizationError(original, reconstructed) {
  if (original.length !== reconstructed.length) {
    throw new Error('Length mismatch');
  }

  let mse = 0;
  let maxError = 0;
  let signalPower = 0;

  for (let i = 0; i < original.length; i++) {
    const diff = original[i] - reconstructed[i];
    mse += diff * diff;
    maxError = Math.max(maxError, Math.abs(diff));
    signalPower += original[i] * original[i];
  }

  mse /= original.length;
  signalPower /= original.length;

  // Signal-to-noise ratio in dB
  const snr = signalPower > 0 ? 10 * Math.log10(signalPower / mse) : Infinity;

  return { mse, maxError, snr };
}

/**
 * Quantize F16 tensor to Q4_K_M
 * @param {Uint16Array} f16Data - F16 data as uint16 array
 * @param {number[]} shape - Tensor shape
 * @returns {Object} Quantization result
 */
export function quantizeF16ToQ4KM(f16Data, shape) {
  // Convert F16 to F32 first
  const f32Data = new Float32Array(f16Data.length);
  for (let i = 0; i < f16Data.length; i++) {
    f32Data[i] = float16ToFloat32(f16Data[i]);
  }
  return quantizeToQ4KM(f32Data, shape);
}

/**
 * Check if tensor should be quantized (heuristic)
 * @param {string} tensorName - Tensor name
 * @param {number[]} shape - Tensor shape
 * @returns {boolean} True if tensor should be quantized
 */
export function shouldQuantize(tensorName, shape) {
  // Don't quantize small tensors
  const numElements = shape.reduce((a, b) => a * b, 1);
  if (numElements < 1024) {
    return false;
  }

  // Don't quantize embeddings (usually first/last layers)
  const lowerName = tensorName.toLowerCase();
  if (lowerName.includes('embed') || lowerName.includes('lm_head')) {
    return false;
  }

  // Don't quantize normalization layers
  if (lowerName.includes('norm') || lowerName.includes('ln_')) {
    return false;
  }

  // Don't quantize biases
  if (lowerName.endsWith('.bias') || lowerName.endsWith('_bias')) {
    return false;
  }

  // Quantize attention and FFN weights
  return true;
}

/**
 * Get quantized size for tensor
 * @param {number[]} shape - Tensor shape
 * @returns {number} Size in bytes after Q4_K_M quantization
 */
export function getQuantizedSize(shape) {
  const numElements = shape.reduce((a, b) => a * b, 1);
  const numBlocks = Math.ceil(numElements / QK_K);
  return numBlocks * QK4_K_BLOCK_SIZE;
}

// Export constants
export { QK_K, QK4_K_BLOCK_SIZE, float32ToFloat16, float16ToFloat32 };

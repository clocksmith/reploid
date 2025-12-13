/**
 * quantizer.js - Tensor Quantization for .rdrr Format
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
 * Uses llama.cpp Q4_K format for GPU compatibility.
 *
 * llama.cpp Q4_K dequantization formula:
 *   value = d * scale * q - dmin * min
 *
 * Where:
 * - d: global scale for scales (f16)
 * - dmin: global scale for mins (f16)
 * - scale: per-subblock scale (6-bit, stored as 0-63)
 * - min: per-subblock min offset (6-bit, stored as 0-63)
 * - q: quantized value (4-bit, 0-15)
 *
 * The "min" here is actually -actual_min, stored as a positive offset.
 * This works because neural network weights typically have negative minimums.
 *
 * @param {Float32Array} data - Source data
 * @param {number} offset - Offset into data
 * @returns {Uint8Array} Quantized block (144 bytes)
 */
function quantizeQ4KBlock(data, offset) {
  const block = new Uint8Array(QK4_K_BLOCK_SIZE);
  const blockView = new DataView(block.buffer);

  // Process 8 sub-blocks of 32 elements each
  const scales = new Float32Array(8);
  const minOffsets = new Float32Array(8); // Store -min as positive offset
  const quantized = new Uint8Array(256);

  for (let sb = 0; sb < 8; sb++) {
    const sbOffset = offset + sb * 32;
    const { min, max } = findMinMax(data, sbOffset, 32);

    // For llama.cpp format, we store -min as a positive offset to subtract
    // value = d * scale * q - dmin * minOffset
    // So: minOffset = -min (the negative of actual minimum)
    minOffsets[sb] = -min;
    const range = max - min;
    scales[sb] = range > 0 ? range / 15 : 0; // 4-bit = 0-15

    // Quantize sub-block: q = round((val - min) / scale)
    // Dequant will be: val = d * scale * q - dmin * minOffset = scale * q + min
    const invScale = scales[sb] > 0 ? 1 / scales[sb] : 0;
    for (let i = 0; i < 32; i++) {
      const val = data[sbOffset + i];
      let q = Math.round((val - min) * invScale);
      q = Math.max(0, Math.min(15, q));
      quantized[sb * 32 + i] = q;
    }
  }

  // Find global scales for the 6-bit scale/min encoding
  let maxScale = 0;
  let maxMinOffset = 0;
  for (let i = 0; i < 8; i++) {
    if (scales[i] > maxScale) maxScale = scales[i];
    if (minOffsets[i] > maxMinOffset) maxMinOffset = minOffsets[i];
    // Note: if minOffsets[i] < 0 (i.e., actual min was positive),
    // we need special handling. For now, clamp to 0.
    if (minOffsets[i] < 0) minOffsets[i] = 0;
  }

  const d = maxScale / 63;      // 6-bit scales
  const dmin = maxMinOffset / 63;

  // Write d and dmin as f16
  blockView.setUint16(0, float32ToFloat16(d), true);
  blockView.setUint16(2, float32ToFloat16(dmin), true);

  // Encode scales and mins into 12 bytes using llama.cpp format
  const invD = d > 0 ? 1 / d : 0;
  const invDmin = dmin > 0 ? 1 / dmin : 0;

  const scaleBits = new Uint8Array(8);
  const minBits = new Uint8Array(8);

  for (let i = 0; i < 8; i++) {
    scaleBits[i] = Math.min(63, Math.round(scales[i] * invD));
    minBits[i] = Math.min(63, Math.round(Math.max(0, minOffsets[i]) * invDmin));
  }

  // llama.cpp Q4_K byte layout:
  // Bytes 0-3: lower 6 bits = scales[0-3], upper 2 bits = scales[4-7] upper bits
  // Bytes 4-7: lower 6 bits = mins[0-3], upper 2 bits = mins[4-7] upper bits
  // Bytes 8-11: packed 4-bit values for subblocks 4-7 (lower 4 = scale, upper 4 = min)

  // Bytes 0-3: scales for subblocks 0-3 (6 bits each) + upper 2 bits of scales 4-7
  for (let i = 0; i < 4; i++) {
    const scale_lo = scaleBits[i] & 0x3F;
    const scale_hi_bits = (scaleBits[i + 4] >> 4) & 0x03;
    block[4 + i] = scale_lo | (scale_hi_bits << 6);
  }

  // Bytes 4-7: mins for subblocks 0-3 (6 bits each) + upper 2 bits of mins 4-7
  for (let i = 0; i < 4; i++) {
    const min_lo = minBits[i] & 0x3F;
    const min_hi_bits = (minBits[i + 4] >> 4) & 0x03;
    block[4 + 4 + i] = min_lo | (min_hi_bits << 6);
  }

  // Bytes 8-11: lower 4 bits of scales[4-7] and mins[4-7]
  for (let i = 0; i < 4; i++) {
    const scale_lo4 = scaleBits[i + 4] & 0x0F;
    const min_lo4 = minBits[i + 4] & 0x0F;
    block[4 + 8 + i] = scale_lo4 | (min_lo4 << 4);
  }

  // Pack 4-bit quantized values (256 elements -> 128 bytes)
  // llama.cpp Q4_K nibble layout per 64-element chunk:
  //   - Elements 0-31: lower nibbles of 32 bytes
  //   - Elements 32-63: upper nibbles of same 32 bytes
  // Layout: chunk0 (elem 0-63) uses bytes 0-31
  //         chunk1 (elem 64-127) uses bytes 32-63
  //         chunk2 (elem 128-191) uses bytes 64-95
  //         chunk3 (elem 192-255) uses bytes 96-127
  for (let chunk = 0; chunk < 4; chunk++) {
    const chunkBase = chunk * 64;
    const byteBase = 16 + chunk * 32;
    for (let i = 0; i < 32; i++) {
      const lo = quantized[chunkBase + i] & 0x0F;
      const hi = quantized[chunkBase + 32 + i] & 0x0F;
      block[byteBase + i] = lo | (hi << 4);
    }
  }

  return block;
}

/**
 * Dequantize a single Q4_K super-block (llama.cpp format)
 * Uses the formula: value = d * scale * q - dmin * min
 * @param {Uint8Array} block - Quantized block (144 bytes)
 * @returns {Float32Array} Dequantized values (256 elements)
 */
function dequantizeQ4KBlock(block) {
  const blockView = new DataView(block.buffer, block.byteOffset);
  const result = new Float32Array(256);

  // Read d and dmin (f16)
  const d = float16ToFloat32(blockView.getUint16(0, true));
  const dmin = float16ToFloat32(blockView.getUint16(2, true));

  // Unpack scales and mins from 12 bytes (llama.cpp format)
  const scaleBits = new Uint8Array(8);
  const minBits = new Uint8Array(8);

  // Bytes 0-3: lower 6 bits = scales[0-3], upper 2 bits = scales[4-7] upper bits
  for (let i = 0; i < 4; i++) {
    scaleBits[i] = block[4 + i] & 0x3F;
    scaleBits[i + 4] = ((block[4 + i] >> 6) & 0x03) << 4;
  }

  // Bytes 4-7: lower 6 bits = mins[0-3], upper 2 bits = mins[4-7] upper bits
  for (let i = 0; i < 4; i++) {
    minBits[i] = block[4 + 4 + i] & 0x3F;
    minBits[i + 4] = ((block[4 + 4 + i] >> 6) & 0x03) << 4;
  }

  // Bytes 8-11: lower 4 bits of scales[4-7] and mins[4-7]
  for (let i = 0; i < 4; i++) {
    scaleBits[i + 4] |= block[4 + 8 + i] & 0x0F;
    minBits[i + 4] |= (block[4 + 8 + i] >> 4) & 0x0F;
  }

  // Convert to float scales and min offsets
  const scales = new Float32Array(8);
  const minOffsets = new Float32Array(8);
  for (let i = 0; i < 8; i++) {
    scales[i] = d * scaleBits[i];
    minOffsets[i] = dmin * minBits[i];
  }

  // Unpack 4-bit values and dequantize using llama.cpp formula
  // value = d * scale * q - dmin * min = scales[sb] * q - minOffsets[sb]
  for (let chunk = 0; chunk < 4; chunk++) {
    const chunkBase = chunk * 64;
    const byteBase = 16 + chunk * 32;
    for (let i = 0; i < 32; i++) {
      const byte = block[byteBase + i];
      const lo = byte & 0x0F;
      const hi = (byte >> 4) & 0x0F;

      const sb0 = Math.floor((chunkBase + i) / 32);
      const sb1 = Math.floor((chunkBase + 32 + i) / 32);

      result[chunkBase + i] = scales[sb0] * lo - minOffsets[sb0];
      result[chunkBase + 32 + i] = scales[sb1] * hi - minOffsets[sb1];
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

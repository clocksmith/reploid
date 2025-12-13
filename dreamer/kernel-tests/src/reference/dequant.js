/**
 * Reference Dequantization Implementation
 */

/**
 * Reference INT8 dequantization
 * float = (int8 - zero_point) * scale
 *
 * @param {Int8Array} quantized - Quantized values
 * @param {Float32Array} scales - Per-channel or per-tensor scales
 * @param {Int8Array} zeroPoints - Zero points (optional, default 0)
 * @param {number} numChannels - Number of output channels
 * @param {number} channelSize - Elements per channel
 * @returns {Float32Array} Dequantized values
 */
export function dequantInt8Ref(quantized, scales, zeroPoints = null, numChannels = 1, channelSize = 0) {
  const output = new Float32Array(quantized.length);

  if (channelSize === 0) {
    channelSize = quantized.length / numChannels;
  }

  for (let c = 0; c < numChannels; c++) {
    const scale = scales[c];
    const zp = zeroPoints ? zeroPoints[c] : 0;

    for (let i = 0; i < channelSize; i++) {
      const idx = c * channelSize + i;
      output[idx] = (quantized[idx] - zp) * scale;
    }
  }

  return output;
}

/**
 * Reference INT4 dequantization (packed 2 values per byte)
 * @param {Uint8Array} quantized - Packed INT4 values (2 per byte)
 * @param {Float32Array} scales - Scales
 * @param {number} numElements - Total number of output elements
 * @returns {Float32Array} Dequantized values
 */
export function dequantInt4Ref(quantized, scales, numElements, groupSize = 32) {
  const output = new Float32Array(numElements);
  const numGroups = Math.ceil(numElements / groupSize);

  for (let i = 0; i < numElements; i++) {
    const byteIdx = Math.floor(i / 2);
    const groupIdx = Math.floor(i / groupSize);
    const scale = scales[groupIdx];

    let val;
    if (i % 2 === 0) {
      // Low nibble
      val = quantized[byteIdx] & 0x0F;
    } else {
      // High nibble
      val = (quantized[byteIdx] >> 4) & 0x0F;
    }

    // Convert from unsigned [0,15] to signed [-8,7]
    if (val >= 8) {
      val = val - 16;
    }

    output[i] = val * scale;
  }

  return output;
}

/**
 * Reference block-wise quantization (Q4_0 style)
 * Each block has: scale (fp16) + 32 int4 values (16 bytes)
 */
export function dequantQ4_0Ref(quantized, numBlocks) {
  const blockSize = 32;
  const output = new Float32Array(numBlocks * blockSize);
  const dataView = new DataView(quantized.buffer);

  for (let block = 0; block < numBlocks; block++) {
    // Q4_0 block: 2 bytes scale (fp16) + 16 bytes data (32 int4)
    const blockOffset = block * 18;

    // Read scale as fp16 (simplified - just use the bytes directly for now)
    const scaleBytes = dataView.getUint16(blockOffset, true);
    const scale = float16ToFloat32(scaleBytes);

    // Unpack 32 int4 values from 16 bytes
    for (let i = 0; i < 16; i++) {
      const byte = quantized[blockOffset + 2 + i];

      const low = (byte & 0x0F) - 8;
      const high = ((byte >> 4) & 0x0F) - 8;

      output[block * blockSize + i * 2] = low * scale;
      output[block * blockSize + i * 2 + 1] = high * scale;
    }
  }

  return output;
}

/**
 * Convert fp16 bits to fp32
 */
function float16ToFloat32(bits) {
  const sign = (bits >> 15) & 1;
  const exp = (bits >> 10) & 0x1F;
  const frac = bits & 0x3FF;

  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    // Denormalized
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }

  if (exp === 31) {
    return frac ? NaN : (sign ? -Infinity : Infinity);
  }

  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

export default dequantInt8Ref;

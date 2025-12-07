/**
 * Address Table
 * Agent-A | Domain: memory/
 *
 * Virtual address translation for segmented heap mode.
 * Encodes segment index + offset into a single 64-bit-safe number.
 *
 * Address format (fits in 53-bit JS safe integer):
 * - Upper 8 bits: segment index (0-255 segments)
 * - Lower 45 bits: offset within segment (up to 32TB per segment, but we use 4GB)
 */

const SEGMENT_BITS = 8;
const OFFSET_BITS = 45;
const MAX_SEGMENTS = (1 << SEGMENT_BITS); // 256
const MAX_OFFSET = (1 << OFFSET_BITS) - 1; // ~35TB (but we limit to segment size)

export class AddressTable {
  /**
   * @param {number} segmentSize - Size of each segment in bytes
   */
  constructor(segmentSize) {
    this.segmentSize = segmentSize;

    // Validate segment size fits in offset bits
    if (segmentSize > MAX_OFFSET) {
      throw new Error(`Segment size ${segmentSize} exceeds max offset ${MAX_OFFSET}`);
    }
  }

  /**
   * Encode segment index and offset into virtual address
   * @param {number} segmentIndex - Segment index (0-255)
   * @param {number} offset - Byte offset within segment
   * @returns {number} Virtual address
   */
  encode(segmentIndex, offset) {
    if (segmentIndex >= MAX_SEGMENTS) {
      throw new Error(`Segment index ${segmentIndex} exceeds max ${MAX_SEGMENTS - 1}`);
    }
    if (offset > this.segmentSize) {
      throw new Error(`Offset ${offset} exceeds segment size ${this.segmentSize}`);
    }

    // Use BigInt for the shift to avoid precision loss, then convert back
    // Actually, since we're within 53 bits, we can use regular math
    return (segmentIndex * (MAX_OFFSET + 1)) + offset;
  }

  /**
   * Decode virtual address into segment index and offset
   * @param {number} virtualAddress
   * @returns {{segmentIndex: number, offset: number}}
   */
  decode(virtualAddress) {
    const segmentIndex = Math.floor(virtualAddress / (MAX_OFFSET + 1));
    const offset = virtualAddress % (MAX_OFFSET + 1);

    return { segmentIndex, offset };
  }

  /**
   * Get the segment index from a virtual address
   * @param {number} virtualAddress
   * @returns {number}
   */
  getSegmentIndex(virtualAddress) {
    return Math.floor(virtualAddress / (MAX_OFFSET + 1));
  }

  /**
   * Get the offset from a virtual address
   * @param {number} virtualAddress
   * @returns {number}
   */
  getOffset(virtualAddress) {
    return virtualAddress % (MAX_OFFSET + 1);
  }

  /**
   * Check if an address range spans multiple segments
   * @param {number} virtualAddress
   * @param {number} length
   * @returns {boolean}
   */
  spansSegments(virtualAddress, length) {
    const startSegment = this.getSegmentIndex(virtualAddress);
    const endAddress = virtualAddress + length - 1;
    const endSegment = this.getSegmentIndex(endAddress);
    return startSegment !== endSegment;
  }

  /**
   * Split an address range into per-segment chunks
   * Useful when a read/write spans segment boundaries
   * @param {number} virtualAddress
   * @param {number} length
   * @returns {Array<{segmentIndex: number, offset: number, length: number}>}
   */
  splitRange(virtualAddress, length) {
    const chunks = [];
    let remaining = length;
    let currentAddress = virtualAddress;

    while (remaining > 0) {
      const { segmentIndex, offset } = this.decode(currentAddress);
      const availableInSegment = this.segmentSize - offset;
      const chunkLength = Math.min(remaining, availableInSegment);

      chunks.push({
        segmentIndex,
        offset,
        length: chunkLength,
        virtualAddress: currentAddress,
      });

      remaining -= chunkLength;
      currentAddress += chunkLength;
    }

    return chunks;
  }

  /**
   * Calculate total virtual address space
   * @returns {number}
   */
  getTotalAddressSpace() {
    return MAX_SEGMENTS * this.segmentSize;
  }
}

/**
 * Constants exported for other modules
 */
export const ADDRESS_TABLE_CONSTANTS = {
  SEGMENT_BITS,
  OFFSET_BITS,
  MAX_SEGMENTS,
  MAX_OFFSET,
};

/**
 * Titan Native Bridge Protocol
 * Phase 3: Binary Protocol for Extension <-> Native Host
 *
 * Protocol format (little-endian):
 * | Offset | Field   | Type | Description                    |
 * |--------|---------|------|--------------------------------|
 * | 0x00   | MAGIC   | u32  | 0x5245504C ("REPL")            |
 * | 0x04   | CMD     | u8   | Command type                   |
 * | 0x05   | FLAGS   | u8   | Flags (0x01=compressed)        |
 * | 0x06   | PADDING | u16  | Reserved                       |
 * | 0x08   | REQ_ID  | u32  | Request correlation ID         |
 * | 0x0C   | LEN     | u32  | Payload length                 |
 * | 0x10   | PAYLOAD | []   | Variable-length payload        |
 *
 * @module bridge/protocol
 */

// Protocol constants
export const MAGIC = 0x5245504C; // "REPL" in little-endian
export const HEADER_SIZE = 16;
export const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB max chunk (backpressure)
export const ACK_SIZE = 4;

// Command types
export const CMD = {
  PING: 0x00,
  PONG: 0x01,
  READ: 0x02,
  READ_RESPONSE: 0x03,
  WRITE: 0x04,
  WRITE_ACK: 0x05,
  LIST: 0x06,
  LIST_RESPONSE: 0x07,
  ERROR: 0xFF,
};

// Flags
export const FLAGS = {
  NONE: 0x00,
  COMPRESSED: 0x01,
  LAST_CHUNK: 0x02,
};

/**
 * Encode a protocol message
 * @param {number} cmd - Command type
 * @param {number} reqId - Request ID
 * @param {Uint8Array|null} payload - Optional payload
 * @param {number} flags - Optional flags
 * @returns {ArrayBuffer}
 */
export function encodeMessage(cmd, reqId, payload = null, flags = FLAGS.NONE) {
  const payloadLen = payload?.length || 0;
  const buffer = new ArrayBuffer(HEADER_SIZE + payloadLen);
  const view = new DataView(buffer);

  // Header
  view.setUint32(0, MAGIC, true);
  view.setUint8(4, cmd);
  view.setUint8(5, flags);
  view.setUint16(6, 0, true); // padding
  view.setUint32(8, reqId, true);
  view.setUint32(12, payloadLen, true);

  // Payload
  if (payload && payloadLen > 0) {
    new Uint8Array(buffer, HEADER_SIZE).set(payload);
  }

  return buffer;
}

/**
 * Decode a protocol message header
 * @param {ArrayBuffer} buffer - At least HEADER_SIZE bytes
 * @returns {{cmd: number, flags: number, reqId: number, payloadLen: number}|null}
 */
export function decodeHeader(buffer) {
  if (buffer.byteLength < HEADER_SIZE) {
    return null;
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);

  if (magic !== MAGIC) {
    console.error('[Protocol] Invalid magic:', magic.toString(16));
    return null;
  }

  return {
    cmd: view.getUint8(4),
    flags: view.getUint8(5),
    reqId: view.getUint32(8, true),
    payloadLen: view.getUint32(12, true),
  };
}

/**
 * Create a READ request
 * @param {number} reqId - Request ID
 * @param {string} path - File path to read
 * @param {number} offset - Byte offset
 * @param {number} length - Bytes to read
 * @returns {ArrayBuffer}
 */
export function createReadRequest(reqId, path, offset, length) {
  const encoder = new TextEncoder();
  const pathBytes = encoder.encode(path);

  // Payload: offset (u64) + length (u64) + path
  const payload = new Uint8Array(16 + pathBytes.length);
  const view = new DataView(payload.buffer);

  // Use two u32s for offset/length (JS safe integer limit)
  view.setUint32(0, offset & 0xFFFFFFFF, true);
  view.setUint32(4, Math.floor(offset / 0x100000000), true);
  view.setUint32(8, length & 0xFFFFFFFF, true);
  view.setUint32(12, Math.floor(length / 0x100000000), true);
  payload.set(pathBytes, 16);

  return encodeMessage(CMD.READ, reqId, payload);
}

/**
 * Create an ACK message (for backpressure)
 * @param {number} reqId - Request ID being acknowledged
 * @returns {ArrayBuffer}
 */
export function createAck(reqId) {
  const buffer = new ArrayBuffer(ACK_SIZE);
  new DataView(buffer).setUint32(0, reqId, true);
  return buffer;
}

/**
 * Parse READ response payload
 * @param {Uint8Array} payload
 * @returns {{offset: number, data: Uint8Array}}
 */
export function parseReadResponse(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset);

  const offsetLow = view.getUint32(0, true);
  const offsetHigh = view.getUint32(4, true);
  const offset = offsetLow + offsetHigh * 0x100000000;

  const data = payload.slice(8);

  return { offset, data };
}

/**
 * Parse ERROR response payload
 * @param {Uint8Array} payload
 * @returns {{code: number, message: string}}
 */
export function parseErrorResponse(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset);
  const code = view.getUint32(0, true);
  const message = new TextDecoder().decode(payload.slice(4));
  return { code, message };
}

// Error codes
export const ERROR_CODES = {
  OK: 0,
  NOT_FOUND: 1,
  PERMISSION_DENIED: 2,
  IO_ERROR: 3,
  INVALID_REQUEST: 4,
  QUOTA_EXCEEDED: 5,
};

export default {
  MAGIC,
  HEADER_SIZE,
  MAX_CHUNK_SIZE,
  CMD,
  FLAGS,
  ERROR_CODES,
  encodeMessage,
  decodeHeader,
  createReadRequest,
  createAck,
  parseReadResponse,
  parseErrorResponse,
};

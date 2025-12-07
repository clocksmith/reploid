#!/usr/bin/env node
/**
 * Dreamer Native Bridge Host (Node.js)
 * Phase 3: Native file access for LLM inference
 *
 * Communicates with Chrome extension via native messaging protocol.
 * Provides file access to bypass browser storage limits.
 */

import { createReadStream, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, normalize } from 'path';

// Protocol constants (must match extension-client.js and protocol.js)
const MAGIC = 0x5245504C; // "REPL"
const HEADER_SIZE = 16;
const MAX_CHUNK_SIZE = 8 * 1024 * 1024; // 8MB

// Commands
const CMD_PING = 0x00;
const CMD_PONG = 0x01;
const CMD_READ = 0x02;
const CMD_READ_RESPONSE = 0x03;
const CMD_ERROR = 0xFF;

// Flags
const FLAG_LAST_CHUNK = 0x02;

// Error codes
const ERR_NOT_FOUND = 1;
const ERR_PERMISSION_DENIED = 2;
const ERR_IO_ERROR = 3;
const ERR_INVALID_REQUEST = 4;

// Allowed directories (configurable via DREAMER_ALLOWED_DIRS env, colon-separated)
const DEFAULT_ALLOWED_DIRS = '/Users:/home:/tmp:/var/tmp';
const ALLOWED_DIRS = (process.env.DREAMER_ALLOWED_DIRS || DEFAULT_ALLOWED_DIRS).split(':');

/**
 * Check if a path is allowed (security)
 */
function isPathAllowed(filePath) {
  try {
    const resolved = resolve(filePath);
    const normalized = normalize(resolved);

    // Must be absolute
    if (!normalized.startsWith('/')) return false;

    // Must be in allowed directory
    for (const dir of ALLOWED_DIRS) {
      if (normalized.startsWith(dir)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create binary header
 */
function createHeader(cmd, flags, reqId, payloadLen) {
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt8(cmd, 4);
  header.writeUInt8(flags, 5);
  header.writeUInt32LE(reqId, 8);
  header.writeUInt32LE(payloadLen, 12);
  return header;
}

/**
 * Create PONG response
 */
function createPongResponse(reqId) {
  const header = createHeader(CMD_PONG, 0, reqId, 0);
  return { type: 'binary', data: Array.from(header) };
}

/**
 * Create READ_RESPONSE
 */
function createReadResponse(reqId, offset, data, isLast) {
  const payloadLen = 8 + data.length;
  const message = Buffer.alloc(HEADER_SIZE + payloadLen);

  // Header
  message.writeUInt32LE(MAGIC, 0);
  message.writeUInt8(CMD_READ_RESPONSE, 4);
  message.writeUInt8(isLast ? FLAG_LAST_CHUNK : 0, 5);
  message.writeUInt32LE(reqId, 8);
  message.writeUInt32LE(payloadLen, 12);

  // Payload: offset (u64 as two u32s)
  const offsetBigInt = BigInt(offset);
  message.writeUInt32LE(Number(offsetBigInt & 0xFFFFFFFFn), 16);
  message.writeUInt32LE(Number(offsetBigInt >> 32n), 20);

  // Payload: data
  data.copy(message, 24);

  return { type: 'binary', data: Array.from(message) };
}

/**
 * Create ERROR response
 */
function createErrorResponse(reqId, code, errorMsg) {
  const msgBytes = Buffer.from(errorMsg, 'utf8');
  const payloadLen = 4 + msgBytes.length;
  const message = Buffer.alloc(HEADER_SIZE + payloadLen);

  // Header
  message.writeUInt32LE(MAGIC, 0);
  message.writeUInt8(CMD_ERROR, 4);
  message.writeUInt8(0, 5);
  message.writeUInt32LE(reqId, 8);
  message.writeUInt32LE(payloadLen, 12);

  // Payload: error code + message
  message.writeUInt32LE(code, 16);
  msgBytes.copy(message, 20);

  return { type: 'binary', data: Array.from(message) };
}

/**
 * Handle READ request
 */
async function handleReadRequest(reqId, payload) {
  if (payload.length < 16) {
    return [createErrorResponse(reqId, ERR_INVALID_REQUEST, 'Payload too short')];
  }

  // Parse offset and length (u64 as two u32s)
  const offsetLow = payload.readUInt32LE(0);
  const offsetHigh = payload.readUInt32LE(4);
  const offset = BigInt(offsetLow) + (BigInt(offsetHigh) << 32n);

  const lengthLow = payload.readUInt32LE(8);
  const lengthHigh = payload.readUInt32LE(12);
  const length = BigInt(lengthLow) + (BigInt(lengthHigh) << 32n);

  // Parse path
  const filePath = payload.slice(16).toString('utf8');

  // Security check
  if (!isPathAllowed(filePath)) {
    return [createErrorResponse(reqId, ERR_PERMISSION_DENIED, 'Path not in allowed directory')];
  }

  try {
    // Get file size
    const stats = statSync(filePath);
    const fileSize = BigInt(stats.size);

    if (offset >= fileSize) {
      return [createErrorResponse(reqId, ERR_INVALID_REQUEST, 'Offset beyond file end')];
    }

    const actualLength = Number(length < (fileSize - offset) ? length : (fileSize - offset));

    // Read file in chunks and build responses
    const responses = [];
    let pos = 0;

    // For simplicity, read the requested portion into memory
    // For very large files, could use streaming, but native messaging has 1MB limit anyway
    const fd = await import('fs').then(fs => fs.promises.open(filePath, 'r'));
    const buffer = Buffer.alloc(actualLength);
    await fd.read(buffer, 0, actualLength, Number(offset));
    await fd.close();

    // Chunk the response
    while (pos < actualLength) {
      const chunkSize = Math.min(MAX_CHUNK_SIZE, actualLength - pos);
      const chunk = buffer.slice(pos, pos + chunkSize);
      const isLast = pos + chunkSize >= actualLength;

      responses.push(createReadResponse(reqId, Number(offset) + pos, chunk, isLast));
      pos += chunkSize;
    }

    return responses;
  } catch (err) {
    const code = err.code === 'ENOENT' ? ERR_NOT_FOUND :
                 err.code === 'EACCES' ? ERR_PERMISSION_DENIED :
                 ERR_IO_ERROR;
    return [createErrorResponse(reqId, code, err.message)];
  }
}

/**
 * Handle incoming message
 */
async function handleMessage(msg) {
  const msgType = msg.type;

  if (msgType === 'binary') {
    const bytes = Buffer.from(msg.data);

    if (bytes.length < HEADER_SIZE) {
      return [createErrorResponse(0, ERR_INVALID_REQUEST, 'Message too short')];
    }

    // Parse header
    const magic = bytes.readUInt32LE(0);
    if (magic !== MAGIC) {
      return [createErrorResponse(0, ERR_INVALID_REQUEST, 'Invalid magic')];
    }

    const cmd = bytes.readUInt8(4);
    const reqId = bytes.readUInt32LE(8);
    const payloadLen = bytes.readUInt32LE(12);

    const payload = payloadLen > 0 ? bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLen) : Buffer.alloc(0);

    switch (cmd) {
      case CMD_PING:
        return [createPongResponse(reqId)];
      case CMD_READ:
        return await handleReadRequest(reqId, payload);
      default:
        return [createErrorResponse(reqId, ERR_INVALID_REQUEST, 'Unknown command')];
    }
  } else if (msgType === 'ack') {
    // ACK for backpressure - just acknowledge
    return [];
  }

  return [];
}

/**
 * Write native messaging response
 */
function writeResponse(response) {
  const json = JSON.stringify(response);
  const buffer = Buffer.from(json, 'utf8');
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(buffer.length, 0);

  process.stdout.write(lenBuffer);
  process.stdout.write(buffer);
}

/**
 * Read native messaging message from stdin
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    // Read 4-byte length prefix
    const lenBuffer = Buffer.alloc(4);
    let lenBytesRead = 0;

    const readLength = () => {
      const chunk = process.stdin.read(4 - lenBytesRead);
      if (chunk) {
        chunk.copy(lenBuffer, lenBytesRead);
        lenBytesRead += chunk.length;
      }

      if (lenBytesRead === 4) {
        const msgLen = lenBuffer.readUInt32LE(0);
        if (msgLen === 0 || msgLen > 1024 * 1024) {
          reject(new Error(`Invalid message length: ${msgLen}`));
          return;
        }
        readBody(msgLen);
      }
    };

    const readBody = (msgLen) => {
      const msgBuffer = Buffer.alloc(msgLen);
      let msgBytesRead = 0;

      const readBodyChunk = () => {
        const chunk = process.stdin.read(msgLen - msgBytesRead);
        if (chunk) {
          chunk.copy(msgBuffer, msgBytesRead);
          msgBytesRead += chunk.length;
        }

        if (msgBytesRead === msgLen) {
          try {
            const msg = JSON.parse(msgBuffer.toString('utf8'));
            resolve(msg);
          } catch (err) {
            reject(err);
          }
        }
      };

      process.stdin.on('readable', readBodyChunk);
      readBodyChunk();
    };

    process.stdin.on('readable', readLength);
    process.stdin.once('end', () => resolve(null));
    readLength();
  });
}

/**
 * Main loop
 */
async function main() {
  // Ensure stdin is in binary mode (no encoding)
  if (process.stdin.setEncoding) {
    // Don't call setEncoding - we want raw buffers
  }

  // Simple synchronous read loop using readline-style approach
  let buffer = Buffer.alloc(0);

  process.stdin.on('readable', async () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      // Ensure chunk is a Buffer
      if (typeof chunk === 'string') {
        chunk = Buffer.from(chunk, 'binary');
      }
      buffer = Buffer.concat([buffer, chunk]);

      // Process complete messages
      while (buffer.length >= 4) {
        const msgLen = buffer.readUInt32LE(0);

        if (msgLen === 0 || msgLen > 1024 * 1024) {
          console.error('[DreamerBridge] Invalid message length:', msgLen);
          buffer = buffer.slice(4);
          continue;
        }

        if (buffer.length < 4 + msgLen) {
          break; // Wait for more data
        }

        const msgData = buffer.slice(4, 4 + msgLen);
        buffer = buffer.slice(4 + msgLen);

        try {
          const msg = JSON.parse(msgData.toString('utf8'));
          const responses = await handleMessage(msg);

          for (const response of responses) {
            writeResponse(response);
          }
        } catch (err) {
          console.error('[DreamerBridge] Error handling message:', err.message);
        }
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[DreamerBridge] Fatal error:', err);
  process.exit(1);
});

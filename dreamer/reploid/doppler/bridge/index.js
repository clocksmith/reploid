/**
 * DOPPLER Native Bridge Module
 * Phase 3: Native Host Communication
 *
 * @module bridge
 */

export {
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
} from './protocol.js';

export {
  ExtensionBridgeClient,
  BridgeStatus,
  getBridgeClient,
  isBridgeAvailable,
} from './extension-client.js';

/**
 * Create and connect a bridge client
 * @param {string} [extensionId] - Optional extension ID
 * @returns {Promise<ExtensionBridgeClient>}
 */
export async function createBridgeClient(extensionId = null) {
  const { ExtensionBridgeClient, isBridgeAvailable } = await import('./extension-client.js');

  if (!isBridgeAvailable()) {
    throw new Error('Native bridge not available - Chrome extension API required');
  }

  const client = new ExtensionBridgeClient();
  await client.connect(extensionId);
  return client;
}

/**
 * Read file via native bridge
 * @param {string} path - File path
 * @param {number} [offset=0] - Byte offset
 * @param {number} [length] - Bytes to read (default: entire file)
 * @returns {Promise<Uint8Array>}
 */
export async function readFileNative(path, offset = 0, length = 0) {
  const { getBridgeClient } = await import('./extension-client.js');
  const client = getBridgeClient();

  if (!client.isConnected()) {
    await client.connect();
  }

  return client.read(path, offset, length);
}

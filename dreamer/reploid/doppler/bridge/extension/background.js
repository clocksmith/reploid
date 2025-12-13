/**
 * DOPPLER Bridge Background Script
 * Phase 3: Native Messaging Bridge
 *
 * Handles:
 * - Connection to native host
 * - Message routing between web page and native host
 * - Binary protocol handling
 * - Backpressure management
 */

const NATIVE_HOST_NAME = 'dev.reploid.doppler';
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB Chrome native messaging limit

// Active connections
const connections = new Map(); // portId -> { webPort, nativePort }

// Message queue for backpressure
const messageQueues = new Map(); // reqId -> chunks[]

function handleWebConnection(webPort) {
  if (webPort.name !== 'doppler-bridge') {
    console.warn('[DopplerBridge] Unknown connection:', webPort.name);
    return;
  }

  console.log('[DopplerBridge] Web page connected');

  const portId = crypto.randomUUID();
  let nativePort = null;

  // Connect to native host
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    console.log('[DopplerBridge] Connected to native host');
  } catch (err) {
    console.error('[DopplerBridge] Failed to connect to native host:', err);
    webPort.postMessage({
      type: 'error',
      message: `Failed to connect to native host: ${err.message}`,
    });
    return;
  }

  // Store connection
  connections.set(portId, { webPort, nativePort });

  // Handle messages from web page
  webPort.onMessage.addListener((message) => {
    handleWebMessage(portId, message);
  });

  // Handle messages from native host
  nativePort.onMessage.addListener((message) => {
    handleNativeMessage(portId, message);
  });

  // Handle web page disconnect
  webPort.onDisconnect.addListener(() => {
    console.log('[DopplerBridge] Web page disconnected');
    cleanupConnection(portId);
  });

  // Handle native host disconnect
  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError;
    console.log('[DopplerBridge] Native host disconnected:', error?.message);

    // Notify web page
    try {
      webPort.postMessage({
        type: 'error',
        message: error?.message || 'Native host disconnected',
      });
    } catch (e) {
      // Port already closed
    }

    cleanupConnection(portId);
  });
}

/**
 * Handle incoming connection from web page (external)
 */
chrome.runtime.onConnectExternal.addListener(handleWebConnection);

/**
 * Handle message from web page
 */
function handleWebMessage(portId, message) {
  const conn = connections.get(portId);
  if (!conn) {
    console.error('[DopplerBridge] No connection for port:', portId);
    return;
  }

  if (message.type === 'binary') {
    // Forward binary message to native host
    // Chrome native messaging uses JSON, so we send as array
    conn.nativePort.postMessage({
      type: 'binary',
      data: message.data, // Already an array from web page
    });
  } else if (message.type === 'ack') {
    // Forward ACK to native host
    conn.nativePort.postMessage({
      type: 'ack',
      reqId: message.reqId,
    });
  } else {
    console.warn('[DopplerBridge] Unknown message type from web:', message.type);
  }
}

/**
 * Handle message from native host
 */
function handleNativeMessage(portId, message) {
  const conn = connections.get(portId);
  if (!conn) {
    console.error('[DopplerBridge] No connection for port:', portId);
    return;
  }

  if (message.type === 'binary') {
    // Forward binary message to web page
    conn.webPort.postMessage({
      type: 'binary',
      data: message.data, // Array of bytes
    });
  } else if (message.type === 'error') {
    conn.webPort.postMessage({
      type: 'error',
      message: message.message,
    });
  } else {
    console.warn('[DopplerBridge] Unknown message type from native:', message.type);
  }
}

/**
 * Cleanup connection
 */
function cleanupConnection(portId) {
  const conn = connections.get(portId);
  if (conn) {
    try {
      conn.nativePort?.disconnect();
    } catch (e) {
      // Already disconnected
    }
    connections.delete(portId);
  }
  messageQueues.delete(portId);
}

/**
 * Handle internal connections (same extension)
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'doppler-bridge') {
    handleWebConnection(port);
  }
});

console.log('[DopplerBridge] Background script loaded');

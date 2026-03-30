/**
 * @fileoverview Bridge between the live self and the browser substrate.
 */

import Utils from './core/utils.js';
import ProviderRegistry from './core/provider-registry.js';
import LLMClient from './core/llm-client.js';
import EventBus from './infrastructure/event-bus.js';
import StreamParser from './infrastructure/stream-parser.js';
import SwarmTransportModule from './capabilities/communication/swarm-transport.js';
import { readVfsFile, writeVfsFile, listVfsKeys } from './host/vfs-bootstrap.js';
import {
  SELF_OPFS_WRITABLE_ROOTS,
  SELF_PROTECTED_PATHS,
  SELF_VFS_WRITABLE_ROOTS,
  buildSelfFiles,
  listSelfMirrorPaths,
  resolveSelfSourceWebPath
} from './manifest.js';
import {
  buildIdentityDocument,
  ensureIdentityBundle,
  ensureIdentityDocument,
  rotateIdentityBundle,
  saveIdentityBundle
} from './identity.js';
import { getCurrentReploidInstanceId } from './instance.js';
import { createReceiptDraft, countersignReceipt, signReceiptDraft, verifyReceipt } from './receipt.js';
import { applyReceiptToContribution } from './reward-policy.js';
import { createPeerAdvertisement, createSwarmController } from './swarm.js';
import { createSelfToolRunner } from './tool-runner.js';

const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const BINARY_LIMIT_BYTES = 256 * 1024 * 1024;
const REMOTE_GENERATION_TIMEOUT_MS = 45000;
const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';
const PROTECTED_SYSTEM_PATHS = new Set(SELF_PROTECTED_PATHS);
const normalizePath = (rawPath, backendOverride) => {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Missing path argument');
  }

  const trimmed = rawPath.trim();
  let backend = backendOverride ? String(backendOverride).toLowerCase() : null;
  if (backend && backend !== 'vfs' && backend !== 'opfs') {
    throw new Error('Invalid backend. Use "vfs" or "opfs".');
  }

  let path = trimmed;
  if (trimmed.startsWith(OPFS_PREFIX)) {
    backend = 'opfs';
    path = trimmed.slice(OPFS_PREFIX.length);
  } else if (trimmed.startsWith(VFS_PREFIX)) {
    backend = 'vfs';
    path = trimmed.slice(VFS_PREFIX.length);
  }

  path = '/' + path.replace(/^\/+/, '');
  if (path.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }

  return { backend: backend || 'vfs', path };
};

const getTextBytes = (content) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(content || '')).length;
  }
  return String(content || '').length;
};

const SELF_TOOL_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const validateSelfToolName = (name) => {
  if (typeof name !== 'string') {
    throw new Error('Tool name must be a string');
  }
  const trimmed = name.trim();
  if (!SELF_TOOL_NAME_PATTERN.test(trimmed)) {
    throw new Error('Invalid tool name. Use CamelCase and start with an uppercase letter.');
  }
  return trimmed;
};

const validateSelfToolCode = (code) => {
  if (!code || typeof code !== 'string') {
    throw new Error('Missing or invalid code parameter');
  }
  if (!code.includes('export default') && !code.includes('export const tool')) {
    throw new Error('Tool must export default or export const tool');
  }
  const hasAsync = code.includes('async function')
    || code.includes('async (')
    || code.includes('call: async');
  if (!hasAsync) {
    throw new Error('Tool call function must be async');
  }
  return code;
};

const isWithinRoot = (path, root) => {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
};

const isWritablePath = (path, roots) => roots.some((root) => isWithinRoot(path, root));

const fetchSourceText = async (webPath) => {
  const response = await fetch(webPath, {
    cache: 'no-store',
    headers: {
      [VFS_BYPASS_HEADER]: '1'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to mirror source: ${webPath} (${response.status})`);
  }
  return response.text();
};

const toBase64 = (buffer) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64');
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const fromBase64 = (data) => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(String(data), 'base64'));
  }
  const binary = atob(String(data));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getOpfsRoot = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('OPFS not available in this environment');
  }
  if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
    throw new Error('OPFS not available in service workers');
  }
  return navigator.storage.getDirectory();
};

const getOpfsFileHandle = async (path, options = {}) => {
  const root = await getOpfsRoot();
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Invalid OPFS path');
  }

  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: !!options.createDirs });
  }

  return dir.getFileHandle(parts[parts.length - 1], { create: !!options.createFile });
};

const createVfsAdapter = ({
  canWritePath,
  hasProjectedSource,
  listProjectedPaths,
  readProjectedSource,
  onWrite
}) => ({
  async read(path) {
    const result = await readVfsFile(path);
    if (result !== null && result !== undefined) {
      return result;
    }
    if (!hasProjectedSource(path)) {
      throw new Error(`File not found: ${path}`);
    }
    return readProjectedSource(path);
  },
  async write(path, content) {
    if (!canWritePath(path)) {
      throw new Error(`Path is not writable: ${path}`);
    }
    if (getTextBytes(content) > TEXT_LIMIT_BYTES) {
      throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
    }
    const nextContent = String(content);
    await writeVfsFile(path, nextContent);
    if (typeof onWrite === 'function') {
      await onWrite(path, nextContent);
    }
    return true;
  },
  async stat(path) {
    const content = await readVfsFile(path);
    if (content === null || content === undefined) {
      if (!hasProjectedSource(path)) return null;
      const projected = await readProjectedSource(path);
      return {
        path,
        size: getTextBytes(projected),
        updated: Date.now(),
        type: 'file'
      };
    }
    return {
      path,
      size: getTextBytes(content),
      updated: Date.now(),
      type: 'file'
    };
  },
  async exists(path) {
    const content = await readVfsFile(path);
    return content !== null && content !== undefined
      ? true
      : hasProjectedSource(path);
  },
  async list(dir = '/') {
    const cleanDir = dir.startsWith('/') ? dir : `/${dir}`;
    const prefix = cleanDir.endsWith('/') ? cleanDir : `${cleanDir}/`;
    const keys = await listVfsKeys();
    return Array.from(new Set([
      ...keys,
      ...listProjectedPaths()
    ]))
      .filter((key) => key.startsWith(prefix))
      .sort();
  }
});

const normalizeModelConfig = (modelConfig = null) => {
  if (!modelConfig) return null;
  const next = { ...modelConfig };
  if (next.hostType === 'browser-local' || next.provider === 'doppler') {
    next.provider = 'webllm';
    next.queryMethod = 'browser';
  } else if ((next.hostType === 'proxy-cloud' || next.hostType === 'proxy-local') && next.proxyUrl && !next.endpoint) {
    next.endpoint = `${String(next.proxyUrl).replace(/\/$/, '')}/api/chat`;
  }
  return next;
};

const estimateTokens = (text) => {
  const value = typeof text === 'string' ? text : JSON.stringify(text || '');
  return Math.max(0, Math.ceil(value.length / 4));
};

const createBridgeEmitter = () => {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (typeof handler !== 'function') {
        return () => {};
      }
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, detail) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      handlers.forEach((handler) => {
        try {
          handler(detail);
        } catch {
          // Ignore listener errors
        }
      });
    }
  };
};

export function createSelfBridge(options = {}) {
  const modelConfig = normalizeModelConfig(options.modelConfig);
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');
  const swarmEnabled = !!options.swarmEnabled;
  let pendingFreshIdentity = !!options.forceFreshIdentity;
  const seedOverrides = Object.fromEntries(
    Object.entries(options.seedOverrides || {})
      .filter(([path, content]) => typeof path === 'string' && typeof content === 'string')
      .map(([path, content]) => [normalizePath(path, 'vfs').path, String(content)])
  );
  const utils = Utils.factory();
  const providerRegistry = ProviderRegistry.factory({ Utils: utils });
  const eventBus = EventBus.factory({ Utils: utils });
  const streamParser = StreamParser.factory();
  const llmClient = LLMClient.factory({
    Utils: utils,
    ProviderRegistry: providerRegistry,
    StreamParser: streamParser
  });

  const writableVfsRoots = [...SELF_VFS_WRITABLE_ROOTS];
  const writableOpfsRoots = [...SELF_OPFS_WRITABLE_ROOTS];
  const isWritableVfsPath = (path) => !PROTECTED_SYSTEM_PATHS.has(path) && isWritablePath(path, writableVfsRoots);
  const isWritableOpfsPath = (path) => isWritablePath(path, writableOpfsRoots);
  const bridgeEvents = createBridgeEmitter();
  const projectedSelfPaths = listSelfMirrorPaths();
  const projectedSelfPathSet = new Set(projectedSelfPaths);
  const projectedSourceCache = new Map();
  const hasProjectedSelfSource = (path) => projectedSelfPathSet.has(path);
  const readProjectedSelfSource = async (path) => {
    const webPath = resolveSelfSourceWebPath(path);
    if (!webPath) {
      throw new Error(`File not found: ${path}`);
    }
    if (!projectedSourceCache.has(path)) {
      projectedSourceCache.set(path, fetchSourceText(webPath).catch((error) => {
        projectedSourceCache.delete(path);
        throw error;
      }));
    }
    return projectedSourceCache.get(path);
  };

  const vfs = createVfsAdapter({
    canWritePath: isWritableVfsPath,
    hasProjectedSource: hasProjectedSelfSource,
    listProjectedPaths: () => projectedSelfPaths,
    readProjectedSource: readProjectedSelfSource,
    onWrite: async (path, content) => {
      bridgeEvents.emit('file-changed', {
        path,
        backend: 'vfs',
        operation: 'write',
        bytesWritten: getTextBytes(content)
      });
    }
  });
  const swarmController = createSwarmController();
  const receiptHistory = [];
  const pendingRemoteRequests = new Map();
  let identityBundle = null;
  let swarmTransport = options.swarmTransport || null;
  let swarmInitPromise = null;
  let swarmInitialized = false;
  let swarmHandlersRegistered = false;
  let toolRunner = null;

  const readFile = async (args = {}) => {
    const { backend, path } = normalizePath(args.path || args.file, args.backend);
    const mode = String(args.mode || 'text').toLowerCase();
    if (mode !== 'text' && mode !== 'binary') {
      throw new Error('Invalid mode. Use "text" or "binary".');
    }

    if (backend === 'vfs') {
      if (mode !== 'text') {
        throw new Error('VFS supports text mode only');
      }
      const content = await vfs.read(path);
      return {
        path,
        backend,
        encoding: 'utf-8',
        content,
        bytes: getTextBytes(content)
      };
    }

    const handle = await getOpfsFileHandle(path, { createDirs: false, createFile: false });
    const file = await handle.getFile();

    if (mode === 'text') {
      if (file.size > TEXT_LIMIT_BYTES) {
        throw new Error(`File too large (${file.size} bytes)`);
      }
      const content = await file.text();
      return {
        path,
        backend,
        encoding: 'utf-8',
        content,
        bytes: getTextBytes(content)
      };
    }

    const offset = Math.max(0, Number(args.offset || 0));
    const length = args.length === undefined ? file.size - offset : Number(args.length);
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('Invalid length');
    }
    if (length > BINARY_LIMIT_BYTES) {
      throw new Error(`Read length exceeds limit (${BINARY_LIMIT_BYTES} bytes)`);
    }
    const buffer = await file.slice(offset, offset + length).arrayBuffer();
    return {
      path,
      backend,
      encoding: 'base64',
      data: toBase64(buffer),
      bytes: buffer.byteLength
    };
  };

  const writeFile = async (args = {}) => {
    const { backend, path } = normalizePath(args.path || args.file, args.backend);
    const mode = String(args.mode || 'text').toLowerCase();
    if (mode !== 'text' && mode !== 'binary') {
      throw new Error('Invalid mode. Use "text" or "binary".');
    }

    if (backend === 'vfs') {
      if (mode !== 'text') {
        throw new Error('VFS supports text mode only');
      }
      if (!isWritableVfsPath(path)) {
        throw new Error(`Path is not writable: ${path}`);
      }
      if (args.content === undefined) {
        throw new Error('Missing content argument');
      }
      const content = String(args.content);
      if (getTextBytes(content) > TEXT_LIMIT_BYTES) {
        throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
      }
      await vfs.write(path, content);
      if (args.autoLoad === true && path.endsWith('.js')) {
        await toolRunner.loadModule({ path, force: true });
      }
      return {
        path,
        backend,
        bytesWritten: getTextBytes(content)
      };
    }

    if (!isWritableOpfsPath(path)) {
      throw new Error(`Path is not writable: ${OPFS_PREFIX}${path}`);
    }
    const handle = await getOpfsFileHandle(path, { createDirs: true, createFile: true });
    const writable = await handle.createWritable();
    if (mode === 'text') {
      if (args.content === undefined) {
        throw new Error('Missing content argument');
      }
      const content = String(args.content);
      if (getTextBytes(content) > TEXT_LIMIT_BYTES) {
        throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
      }
      await writable.write(content);
      await writable.close();
      return {
        path,
        backend,
        bytesWritten: getTextBytes(content)
      };
    }

    if (args.data === undefined) {
      throw new Error('Missing data argument');
    }
    const bytes = fromBase64(args.data);
    if (bytes.byteLength > BINARY_LIMIT_BYTES) {
      throw new Error(`Data exceeds limit (${BINARY_LIMIT_BYTES} bytes)`);
    }
    await writable.write(bytes);
    await writable.close();
    return {
      path,
      backend,
      bytesWritten: bytes.byteLength
    };
  };

  const createTool = async (args = {}) => {
    const name = validateSelfToolName(args.name);
    const code = validateSelfToolCode(args.code);
    const requestedPath = args.path
      ? normalizePath(args.path, 'vfs').path
      : `/self/tools/${name}.js`;

    if (!isWithinRoot(requestedPath, '/self')) {
      throw new Error('CreateTool only supports /self paths');
    }
    if (!requestedPath.endsWith('.js') && !requestedPath.endsWith('.mjs')) {
      throw new Error('CreateTool target must end with .js or .mjs');
    }

    await writeFile({
      path: requestedPath,
      content: code
    });

    const loadResult = await toolRunner.loadModule({
      path: requestedPath,
      force: true
    });

    bridgeEvents.emit('tool-created', {
      name,
      path: requestedPath,
      callable: loadResult.callable !== false
    });

    return {
      name,
      path: requestedPath,
      created: true,
      ...loadResult
    };
  };

  toolRunner = createSelfToolRunner({
    Utils: utils,
    logger: utils.logger,
    VFS: vfs,
    readFile,
    writeFile,
    builtInTools: {
      ReadFile: readFile,
      WriteFile: writeFile,
      CreateTool: createTool
    },
    isLoadablePath: (path) => isWithinRoot(path, '/self')
  });

  const getTransportState = () => ({
    connectionState: swarmTransport?.getConnectionState?.() || 'disconnected',
    transport: swarmTransport?.getTransportType?.() || null
  });

  const getSwarmSnapshot = () => ({
    instanceId,
    ...swarmController.getState({
      swarmEnabled,
      hasInference: !!modelConfig
    }),
    ...getTransportState(),
    peerId: identityBundle?.peerId || null,
    peers: swarmController.listPeers()
  });

  const emitSwarmState = () => {
    const snapshot = getSwarmSnapshot();
    bridgeEvents.emit('swarm-state', snapshot);
    if (snapshot.providerCount > 0) {
      bridgeEvents.emit('provider-ready', snapshot);
    }
    return snapshot;
  };

  const syncIdentityDocument = async () => {
    const document = buildIdentityDocument(identityBundle, {
      instanceId,
      swarmEnabled,
      hasInference: !!modelConfig
    });
    await writeVfsFile('/self/identity.json', JSON.stringify(document, null, 2));
    return document;
  };

  const advertiseSelf = () => {
    if (!swarmEnabled || !swarmTransport || !identityBundle) return null;
    const advertisement = createPeerAdvertisement({
      peerId: identityBundle.peerId,
      swarmEnabled,
      hasInference: !!modelConfig,
      capabilities: ['generation'],
      contribution: identityBundle.contribution,
      updatedAt: Date.now()
    });
    swarmTransport.broadcast('reploid:peer-advertisement', advertisement);
    return advertisement;
  };

  const updateProviderContribution = async (receipt) => {
    if (!identityBundle) return;
    const priorHistory = [...receiptHistory];
    receiptHistory.push(receipt);
    identityBundle.contribution = applyReceiptToContribution(
      identityBundle.contribution,
      receipt,
      priorHistory
    );
    saveIdentityBundle(identityBundle, undefined, { instanceId });
    await syncIdentityDocument();
    advertiseSelf();
    emitSwarmState();
  };

  const updateConsumerReceiptCount = async () => {
    if (!identityBundle) return;
    const summary = identityBundle.contribution || {};
    identityBundle.contribution = {
      ...summary,
      receiptsConsumed: Math.max(0, Number(summary.receiptsConsumed || 0)) + 1,
      updatedAt: Date.now()
    };
    saveIdentityBundle(identityBundle, undefined, { instanceId });
    await syncIdentityDocument();
  };

  const waitForProvider = (timeoutMs = REMOTE_GENERATION_TIMEOUT_MS) => {
    if (getSwarmSnapshot().providerCount > 0) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, timeoutMs);

      const unsubscribe = bridgeEvents.on('provider-ready', () => {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(true);
      });
    });
  };

  const chooseProvider = async () => {
    const snapshot = getSwarmSnapshot();
    if (snapshot.providerCount > 0) {
      return swarmController.chooseProvider(Date.now());
    }

    const available = await waitForProvider();
    if (!available) return null;
    return swarmController.chooseProvider(Date.now());
  };

  const handlePeerAdvertisement = (remotePeerId, payload = {}) => {
    const next = swarmController.upsertPeer({
      ...payload,
      peerId: payload.peerId || remotePeerId
    });
    if (next?.role === 'provider') {
      bridgeEvents.emit('provider-ready', next);
    }
    emitSwarmState();
  };

  const handleGenerationUpdate = (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;
    const chunk = String(payload.chunk || '');
    if (!chunk) return;
    pending.chunks.push(chunk);
    pending.onUpdate?.(chunk);
  };

  const handleGenerationResult = async (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;

    clearTimeout(pending.timeoutId);
    pendingRemoteRequests.delete(pending.requestId);

    if (payload.receipt && identityBundle && swarmTransport) {
      const countersigned = await countersignReceipt(payload.receipt, identityBundle);
      swarmTransport.sendToPeer(remotePeerId, 'reploid:receipt', {
        receipt: countersigned
      });
      await updateConsumerReceiptCount();
    }

    const response = payload.response && typeof payload.response === 'object'
      ? payload.response
      : {
          content: String(payload.content || ''),
          raw: String(payload.raw || payload.content || ''),
          model: payload.model || null,
          provider: payload.provider || null,
          timestamp: payload.timestamp || Date.now()
        };

    pending.resolve(response);
  };

  const handleGenerationError = (remotePeerId, payload = {}) => {
    const pending = pendingRemoteRequests.get(String(payload.requestId || ''));
    if (!pending || pending.providerPeerId !== remotePeerId) return;
    clearTimeout(pending.timeoutId);
    pendingRemoteRequests.delete(pending.requestId);
    pending.reject(new Error(String(payload.error || 'Remote generation failed')));
  };

  const handleReceipt = async (_remotePeerId, payload = {}) => {
    if (!payload?.receipt || !identityBundle) return;
    const verification = await verifyReceipt(payload.receipt);
    if (!verification.valid) return;
    if (payload.receipt.provider !== identityBundle.peerId) return;
    await updateProviderContribution(payload.receipt);
  };

  const handleGenerationRequest = async (remotePeerId, payload = {}) => {
    if (!modelConfig || !swarmEnabled || !swarmTransport || !identityBundle) return;

    const requestId = String(payload.requestId || '').trim();
    const consumer = String(payload.consumer || remotePeerId).trim() || remotePeerId;
    const targetProvider = payload.provider ? String(payload.provider).trim() : null;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (!requestId || !messages.length) return;
    if (targetProvider && targetProvider !== identityBundle.peerId) return;

    try {
      const response = await llmClient.chat(messages, modelConfig, (chunk) => {
        swarmTransport.sendToPeer(consumer, 'reploid:generation-update', {
          requestId,
          chunk
        });
      });

      const receipt = await signReceiptDraft(
        await createReceiptDraft({
          provider: identityBundle.peerId,
          consumer,
          jobHash: `request:${requestId}`,
          model: response.model || modelConfig.id,
          inputTokens: estimateTokens(messages),
          outputTokens: estimateTokens(response.raw || response.content || '')
        }),
        identityBundle
      );

      swarmTransport.sendToPeer(consumer, 'reploid:generation-result', {
        requestId,
        response,
        receipt
      });
    } catch (error) {
      swarmTransport.sendToPeer(consumer, 'reploid:generation-error', {
        requestId,
        error: error?.message || String(error)
      });
    }
  };

  const initialize = async () => {
    if (identityBundle && (!swarmEnabled || swarmInitialized)) {
      return getSwarmSnapshot();
    }
    if (swarmInitPromise) return swarmInitPromise;

    swarmInitPromise = (async () => {
      identityBundle = await ensureIdentityBundle({
        instanceId,
        swarmEnabled,
        hasInference: !!modelConfig,
        forceNew: pendingFreshIdentity
      });
      pendingFreshIdentity = false;

      if (!swarmEnabled) {
        return getSwarmSnapshot();
      }

      if (!swarmTransport) {
        swarmTransport = SwarmTransportModule.factory({
          Utils: utils,
          EventBus: eventBus
        });
      }

      if (!swarmHandlersRegistered) {
        swarmTransport.onMessage('reploid:peer-advertisement', handlePeerAdvertisement);
        swarmTransport.onMessage('reploid:generation-request', handleGenerationRequest);
        swarmTransport.onMessage('reploid:generation-update', handleGenerationUpdate);
        swarmTransport.onMessage('reploid:generation-result', handleGenerationResult);
        swarmTransport.onMessage('reploid:generation-error', handleGenerationError);
        swarmTransport.onMessage('reploid:receipt', handleReceipt);

        eventBus.on('swarm:peer-connected', () => {
          advertiseSelf();
          emitSwarmState();
        }, 'self-bridge');
        eventBus.on('swarm:peer-joined', () => {
          advertiseSelf();
          emitSwarmState();
        }, 'self-bridge');
        eventBus.on('swarm:peer-left', () => {
          emitSwarmState();
        }, 'self-bridge');
        eventBus.on('swarm:state-change', () => {
          emitSwarmState();
        }, 'self-bridge');
        swarmHandlersRegistered = true;
      }

      swarmInitialized = await swarmTransport.init();
      if (swarmInitialized) {
        advertiseSelf();
      }

      return emitSwarmState();
    })().finally(() => {
      swarmInitPromise = null;
    });

    return swarmInitPromise;
  };

  const rotateIdentity = async (input = {}) => {
    if (!identityBundle) {
      await initialize();
    }

    identityBundle = await rotateIdentityBundle({
      ...input,
      instanceId,
      retireLegacy: input.retireLegacy !== false
    });
    await syncIdentityDocument();
    if (swarmEnabled && swarmInitialized) {
      advertiseSelf();
    }
    return emitSwarmState();
  };

  const seedSystemFiles = async (input = {}) => {
    const hasInference = !!modelConfig;
    const files = buildSelfFiles({
      instanceId,
      goal: input.goal,
      environment: input.environment,
      swarmEnabled: !!input.swarmEnabled,
      hasInference
    });
    files['/self/identity.json'] = JSON.stringify(
      await ensureIdentityDocument({
        instanceId,
        swarmEnabled: !!input.swarmEnabled,
        hasInference
      }),
      null,
      2
    );
    Object.entries(seedOverrides).forEach(([path, content]) => {
      if (Object.prototype.hasOwnProperty.call(files, path)) {
        files[path] = content;
      }
    });
    const projectedOverrides = Object.entries(seedOverrides).filter(([path]) => (
      !Object.prototype.hasOwnProperty.call(files, path) && isWritableVfsPath(path)
    ));

    await Promise.all([
      ...Object.entries(files).map(([path, content]) => writeVfsFile(path, content)),
      ...projectedOverrides.map(([path, content]) => writeVfsFile(path, content))
    ]);
    return {
      ...files,
      ...Object.fromEntries(projectedOverrides)
    };
  };

  const getModelLabel = () => modelConfig?.name || modelConfig?.id || '-';

  const generate = async (messages, onUpdate) => {
    if (modelConfig) {
      return llmClient.chat(messages, modelConfig, onUpdate || null);
    }

    if (!swarmEnabled) {
      throw new Error('No model selected');
    }

    await initialize();
    const provider = await chooseProvider();
    if (!provider?.peerId || !swarmTransport || !identityBundle) {
      throw new Error('No swarm provider available');
    }

    const requestId = utils.generateId('swarmreq');
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRemoteRequests.delete(requestId);
        reject(new Error('Timed out waiting for swarm provider response'));
      }, REMOTE_GENERATION_TIMEOUT_MS);

      pendingRemoteRequests.set(requestId, {
        requestId,
        providerPeerId: provider.peerId,
        onUpdate,
        chunks: [],
        timeoutId,
        resolve,
        reject
      });

      const sent = swarmTransport.sendToPeer(provider.peerId, 'reploid:generation-request', {
        requestId,
        consumer: identityBundle.peerId,
        provider: provider.peerId,
        model: provider.model || null,
        messages
      });

      if (!sent) {
        clearTimeout(timeoutId);
        pendingRemoteRequests.delete(requestId);
        reject(new Error('Failed to send swarm generation request'));
      }
    });
  };

  return {
    initialize,
    seedSystemFiles,
    generate,
    rotateIdentity,
    executeTool: toolRunner.executeTool,
    getModelConfig: () => modelConfig,
    getModelLabel,
    listToolNames: toolRunner.listToolNames,
    on: bridgeEvents.on,
    hasAvailableProvider: () => getSwarmSnapshot().providerCount > 0,
    getSwarmSnapshot
  };
}

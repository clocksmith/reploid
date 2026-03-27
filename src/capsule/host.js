/**
 * @fileoverview Hidden host substrate for Absolute Zero capsule runtime.
 */

import Utils from '../core/utils.js';
import ProviderRegistry from '../core/provider-registry.js';
import LLMClient from '../core/llm-client.js';
import StreamParser from '../infrastructure/stream-parser.js';
import { loadVfsModule } from '../core/vfs-module-loader.js';
import { readVfsFile, writeVfsFile, listVfsKeys } from '../boot-helpers/vfs-bootstrap.js';
import {
  ABSOLUTE_ZERO_HOST_ROOT,
  ABSOLUTE_ZERO_HOST_SOURCE_MIRRORS,
  ABSOLUTE_ZERO_OPFS_WRITABLE_ROOTS,
  ABSOLUTE_ZERO_PROTECTED_PATHS,
  ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS,
  ABSOLUTE_ZERO_VFS_WRITABLE_ROOTS,
  buildAbsoluteZeroSystemFiles
} from './contract.js';

const TEXT_LIMIT_BYTES = 8 * 1024 * 1024;
const BINARY_LIMIT_BYTES = 256 * 1024 * 1024;
const OPFS_PREFIX = 'opfs:';
const VFS_PREFIX = 'vfs:';
const VFS_BYPASS_HEADER = 'x-reploid-vfs-bypass';
const PROTECTED_SYSTEM_PATHS = new Set(ABSOLUTE_ZERO_PROTECTED_PATHS);
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

const createVfsAdapter = (canWritePath) => ({
  async read(path) {
    const result = await readVfsFile(path);
    if (result === null || result === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return result;
  },
  async write(path, content) {
    if (!canWritePath(path)) {
      throw new Error(`Path is not writable: ${path}`);
    }
    if (getTextBytes(content) > TEXT_LIMIT_BYTES) {
      throw new Error(`Content exceeds limit (${TEXT_LIMIT_BYTES} bytes)`);
    }
    await writeVfsFile(path, String(content));
    return true;
  },
  async stat(path) {
    const content = await readVfsFile(path);
    if (content === null || content === undefined) return null;
    return {
      path,
      size: getTextBytes(content),
      updated: Date.now(),
      type: 'file'
    };
  },
  async exists(path) {
    const content = await readVfsFile(path);
    return content !== null && content !== undefined;
  },
  async list(dir = '/') {
    const cleanDir = dir.startsWith('/') ? dir : `/${dir}`;
    const prefix = cleanDir.endsWith('/') ? cleanDir : `${cleanDir}/`;
    const keys = await listVfsKeys();
    return keys.filter((key) => key.startsWith(prefix));
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

export function createCapsuleHost(options = {}) {
  const modelConfig = normalizeModelConfig(options.modelConfig);
  const includeHostWithinSelf = !!options.includeHostWithinSelf;
  const utils = Utils.factory();
  const providerRegistry = ProviderRegistry.factory({ Utils: utils });
  const streamParser = StreamParser.factory();
  const llmClient = LLMClient.factory({
    Utils: utils,
    ProviderRegistry: providerRegistry,
    StreamParser: streamParser
  });

  const writableVfsRoots = includeHostWithinSelf
    ? [...ABSOLUTE_ZERO_VFS_WRITABLE_ROOTS, ABSOLUTE_ZERO_HOST_ROOT]
    : [...ABSOLUTE_ZERO_VFS_WRITABLE_ROOTS];
  const writableOpfsRoots = [...ABSOLUTE_ZERO_OPFS_WRITABLE_ROOTS];
  const isWritableVfsPath = (path) => !PROTECTED_SYSTEM_PATHS.has(path) && isWritablePath(path, writableVfsRoots);
  const isWritableOpfsPath = (path) => isWritablePath(path, writableOpfsRoots);

  const vfs = createVfsAdapter(isWritableVfsPath);
  const dynamicTools = new Map();

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
        await loadModule({ path, force: true });
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

  const executeDynamicTool = async (handler, args = {}) => {
    const deps = {
      Utils: utils,
      VFS: vfs,
      readFile,
      writeFile,
      loadModule,
      callTool: executeTool
    };
    return handler(args, deps);
  };

  const loadModule = async (args = {}) => {
    const path = typeof args === 'string' ? args : args.path;
    if (!path) {
      throw new Error('Missing path argument');
    }
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!isWithinRoot(normalized, '/tools') && !isWithinRoot(normalized, '/kernel')) {
      throw new Error('LoadModule only supports /tools and /kernel paths');
    }
    const mod = await loadVfsModule({
      VFS: vfs,
      logger: utils.logger,
      path: normalized,
      forceReload: !!args.force
    });

    const toolMeta = mod.tool || {};
    const handler = typeof mod.default === 'function'
      ? mod.default
      : typeof toolMeta.call === 'function'
        ? toolMeta.call
        : null;

    if (!handler) {
      return {
        path: normalized,
        loaded: true,
        callable: false
      };
    }

    const toolName = toolMeta.name || normalized.split('/').pop().replace(/\.m?js$/, '');
    dynamicTools.set(toolName, {
      name: toolName,
      description: toolMeta.description || `Dynamic tool loaded from ${normalized}`,
      inputSchema: toolMeta.inputSchema || null,
      handler
    });

    return {
      path: normalized,
      loaded: true,
      callable: true,
      toolName
    };
  };

  const builtInTools = new Map([
    ['ReadFile', readFile],
    ['WriteFile', writeFile],
    ['LoadModule', loadModule]
  ]);

  const executeTool = async (name, args = {}) => {
    if (builtInTools.has(name)) {
      return builtInTools.get(name)(args);
    }
    const dynamic = dynamicTools.get(name);
    if (!dynamic) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return executeDynamicTool(dynamic.handler, args);
  };

  const seedSystemFiles = async (input = {}) => {
    const files = buildAbsoluteZeroSystemFiles({
      goal: input.goal,
      environment: input.environment,
      includeHostWithinSelf
    });
    const mirrorDefs = includeHostWithinSelf
      ? [...ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS, ...ABSOLUTE_ZERO_HOST_SOURCE_MIRRORS]
      : ABSOLUTE_ZERO_SELF_SOURCE_MIRRORS;
    const mirroredEntries = await Promise.all(
      mirrorDefs.map(async ({ webPath, vfsPath }) => ({
        path: vfsPath,
        content: await fetchSourceText(webPath)
      }))
    );

    await Promise.all([
      ...Object.entries(files).map(([path, content]) => writeVfsFile(path, content)),
      ...mirroredEntries.map(({ path, content }) => writeVfsFile(path, content))
    ]);
    return files;
  };

  const getModelLabel = () => modelConfig?.name || modelConfig?.id || '-';

  const generate = async (messages, onUpdate) => {
    if (!modelConfig) {
      throw new Error('No model selected');
    }
    return llmClient.chat(messages, modelConfig, onUpdate || null);
  };

  return {
    seedSystemFiles,
    generate,
    executeTool,
    getModelConfig: () => modelConfig,
    getModelLabel,
    listToolNames: () => ['ReadFile', 'WriteFile', 'LoadModule', ...dynamicTools.keys()]
  };
}

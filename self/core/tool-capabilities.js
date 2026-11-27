/** Pure capability filters shared by browser tool hosts. */
import {
  assertNoPathTraversal,
  assertNotExistingActivationReceipt,
  assertNotProtectedReceiptContent,
  assertWritableVfsPath,
  isActivationEvidencePath,
  isWithinRoot,
  normalizeVfsPath,
  PROTECTED_VFS_ARTIFACT_ROOTS
} from '../config/vfs-policy.js';
import { isValidatorMutationTarget } from './promotion-policy.js';

export const filterToolDepsForMode = (deps = {}, mode = 'reploid') => {
  if (mode !== 'x' && mode !== 'zero') return deps;
  const filtered = { ...deps };
  delete filtered.Shell;
  delete filtered.gitTools;
  return filtered;
};

const ZERO_INTERNAL_TOOL_NAMES = new Set(['CreateTool']);
const HOST_PROMOTION_TOOL_NAMES = new Set(['Promote']);

export const normalizeToolCapabilities = (capabilities = []) => {
  if (capabilities instanceof Set) {
    return new Set([...capabilities].map((capability) => String(capability || '').trim()).filter(Boolean));
  }
  if (Array.isArray(capabilities)) {
    return new Set(capabilities.map((capability) => String(capability || '').trim()).filter(Boolean));
  }
  if (typeof capabilities === 'string') {
    return new Set(capabilities.split(/[,\s]+/).map((capability) => capability.trim()).filter(Boolean));
  }
  return new Set();
};

const createReadOnlyVfs = (VFS) => {
  if (!VFS) return VFS;
  return {
    read: VFS.read?.bind(VFS),
    list: VFS.list?.bind(VFS),
    exists: VFS.exists?.bind(VFS),
    stat: VFS.stat?.bind(VFS),
    getMetadata: VFS.getMetadata?.bind(VFS)
  };
};

const createScopedToolVfs = (VFS, toolName, { allowSelfWrite = false } = {}) => {
  if (!VFS) return VFS;
  const operation = toolName || 'tool';
  const checkMutationTarget = async (rawPath, content = undefined) => {
    const path = normalizeVfsPath(rawPath);
    assertNoPathTraversal(path);
    if (PROTECTED_VFS_ARTIFACT_ROOTS.some((root) => isWithinRoot(path, root))) {
      throw new Error(`Promotion receipts under /artifacts/promotions are protected: ${path}`);
    }
    if (!allowSelfWrite) {
      assertWritableVfsPath(path, operation);
      if (isActivationEvidencePath(path)) {
        throw new Error(`Tool activation evidence is protected: ${path}`);
      }
    } else {
      if (isValidatorMutationTarget(path)) {
        throw new Error(`Validator target is protected from ${operation}: ${path}`);
      }
      if (content !== undefined) {
        assertNotProtectedReceiptContent(path, content, operation);
      }
      await assertNotExistingActivationReceipt(VFS, path, operation);
    }
    return path;
  };

  return {
    ...createReadOnlyVfs(VFS),
    write: typeof VFS.write === 'function'
      ? async (rawPath, content) => {
          const path = await checkMutationTarget(rawPath, typeof content === 'string' ? content : JSON.stringify(content));
          return VFS.write(path, content);
        }
      : undefined,
    delete: typeof VFS.delete === 'function'
      ? async (rawPath) => {
          const path = await checkMutationTarget(rawPath);
          return VFS.delete(path);
        }
      : undefined,
    mkdir: typeof VFS.mkdir === 'function'
      ? async (rawPath) => {
          const path = await checkMutationTarget(rawPath);
          return VFS.mkdir(path);
        }
      : undefined
  };
};

export const filterToolDepsForTool = (deps = {}, mode = 'reploid', toolName = '', options = {}) => {
  const filtered = filterToolDepsForMode(deps, mode);
  if (mode !== 'x' && mode !== 'zero') return filtered;
  const name = String(toolName || '');
  const isInternal = ZERO_INTERNAL_TOOL_NAMES.has(name);
  const isHostPromotion = HOST_PROMOTION_TOOL_NAMES.has(name) && options.installed !== true;
  const capabilities = normalizeToolCapabilities(options.capabilities);
  const hasSelfWrite = capabilities.has('self:write');
  const canWriteVfs = isInternal
    || isHostPromotion
    || capabilities.has('vfs:write')
    || hasSelfWrite;
  const canLoadTools = isInternal
    || capabilities.has('tool:load')
    || hasSelfWrite;
  if (!canWriteVfs) {
    filtered.VFS = createReadOnlyVfs(filtered.VFS);
  } else if (options.installed === true && !isInternal) {
    filtered.VFS = createScopedToolVfs(filtered.VFS, name, { allowSelfWrite: hasSelfWrite });
  }
  filtered.ToolRunner = {
    list: filtered.ToolRunner?.list,
    execute: filtered.ToolRunner?.execute,
    has: filtered.ToolRunner?.has,
    refresh: canLoadTools ? filtered.ToolRunner?.refresh : undefined,
    allow: canLoadTools ? filtered.ToolRunner?.allow : undefined,
    load: canLoadTools ? filtered.ToolRunner?.load : undefined,
    loadPath: canLoadTools ? filtered.ToolRunner?.loadPath : undefined,
    unload: canLoadTools ? filtered.ToolRunner?.unload : undefined
  };
  return filtered;
};

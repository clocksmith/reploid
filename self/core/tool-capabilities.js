/** Pure capability filters shared by browser tool hosts. */
export const filterToolDepsForMode = (deps = {}, mode = 'reploid') => {
  if (mode !== 'x' && mode !== 'zero') return deps;
  const filtered = { ...deps };
  delete filtered.Shell;
  delete filtered.gitTools;
  return filtered;
};

const ZERO_INTERNAL_TOOL_NAMES = new Set(['CreateTool']);

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

export const filterToolDepsForTool = (deps = {}, mode = 'reploid', toolName = '', options = {}) => {
  const filtered = filterToolDepsForMode(deps, mode);
  if (mode !== 'x' && mode !== 'zero') return filtered;
  const isInternal = ZERO_INTERNAL_TOOL_NAMES.has(String(toolName || ''));
  const capabilities = normalizeToolCapabilities(options.capabilities);
  const canWriteVfs = isInternal
    || capabilities.has('vfs:write')
    || capabilities.has('self:write');
  const canLoadTools = isInternal
    || capabilities.has('tool:load')
    || capabilities.has('self:write');
  if (!canWriteVfs) {
    filtered.VFS = createReadOnlyVfs(filtered.VFS);
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

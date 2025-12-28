/**
 * @fileoverview VFS Module Loader
 * Loads ESM modules from VFS using blob URLs with optional verification.
 */

const moduleCache = new Map();

const getCached = (path, code, forceReload) => {
  if (forceReload) return null;
  const cached = moduleCache.get(path);
  if (!cached || cached.code !== code) return null;
  return cached.module;
};

const setCached = (path, code, mod) => {
  moduleCache.set(path, { code, module: mod });
};

export async function loadVfsModule(options) {
  const {
    VFS,
    logger,
    VerificationManager,
    path,
    code,
    verify = false,
    forceReload = false
  } = options || {};

  if (!VFS) throw new Error('VFS is required');
  if (!path || typeof path !== 'string') throw new Error('Invalid module path');

  const contents = code === undefined ? await VFS.read(path) : code;
  const cached = getCached(path, contents, forceReload);
  if (cached) return cached;

  if (verify && VerificationManager) {
    const result = await VerificationManager.verifyProposal({ [path]: contents });
    if (!result?.passed) {
      const errors = result?.errors?.length ? `: ${result.errors.join('; ')}` : '';
      throw new Error(`Verification failed for ${path}${errors}`);
    }
    if (result?.warnings?.length && logger) {
      logger.warn(`[VFS] Verification warnings for ${path}: ${result.warnings.join('; ')}`);
    }
  }

  const blob = new Blob([contents], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    const mod = await import(url);
    setCached(path, contents, mod);
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function clearVfsModuleCache(path = null) {
  if (!path) {
    moduleCache.clear();
    return;
  }
  moduleCache.delete(path);
}

/**
 * @fileoverview WriteFile - Write content to VFS with audit logging and arena verification
 */

let _securityModulePromise = null;

const loadSecurityModule = () => {
  if (_securityModulePromise) return _securityModulePromise;
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : (typeof self !== 'undefined' && self.location?.origin ? self.location.origin : null);
  if (!origin) {
    _securityModulePromise = Promise.resolve(null);
    return _securityModulePromise;
  }
  const url = new URL('/core/security-config.js', origin).toString();
  _securityModulePromise = import(url).catch(() => null);
  return _securityModulePromise;
};

const getSecurityEnabled = async () => {
  const mod = await loadSecurityModule();
  if (mod && typeof mod.isSecurityEnabled === 'function') {
    return !!mod.isSecurityEnabled();
  }
  return false;
};

async function call(args = {}, deps = {}) {
  const { VFS, EventBus, AuditLogger, VFSSandbox, VerificationManager, SubstrateLoader } = deps;
  if (!VFS) throw new Error('VFS not available');

  const path = args.path || args.file;
  const content = args.content;
  const autoLoad = args.autoLoad === true;

  if (!path) throw new Error('Missing path argument');
  if (content === undefined) throw new Error('Missing content argument');

  const isCore = path.startsWith('/core/') || path.startsWith('/infrastructure/');
  const existed = await VFS.exists(path);
  const beforeContent = existed ? await VFS.read(path).catch(() => null) : null;

  // Arena verification for core file changes (when enabled)
  let arenaGatingEnabled = false;
  try {
    arenaGatingEnabled = localStorage.getItem('REPLOID_ARENA_GATING') === 'true';
  } catch (e) { /* ignore */ }
  const securityEnabled = await getSecurityEnabled();

  if (isCore && arenaGatingEnabled && securityEnabled && VFSSandbox && VerificationManager) {
    try {
      const snapshot = await VFSSandbox.createSnapshot();
      try {
        await VFSSandbox.applyChanges({ [path]: content });
        const result = await VerificationManager.verifyProposal({ [path]: content });

        if (!result.passed) {
          const errorMsg = `Core modification blocked: ${result.errors?.join(', ') || 'verification failed'}`;
          if (AuditLogger) {
            await AuditLogger.logEvent('CORE_WRITE_BLOCKED', { path, errors: result.errors }, 'WARN');
          }
          if (EventBus) {
            EventBus.emit('tool:core_blocked', { path, errors: result.errors });
          }
          throw new Error(errorMsg);
        }
      } finally {
        await VFSSandbox.restoreSnapshot(snapshot);
      }
    } catch (err) {
      if (err.message.startsWith('Core modification blocked')) throw err;
      // Verification system error - log but proceed
      console.warn('[WriteFile] Arena verification error:', err.message);
    }
  }

  await VFS.write(path, content);

  // Emit event for UI
  if (EventBus) {
    EventBus.emit(existed ? 'vfs:write' : 'artifact:created', { path });
  }

  // Audit log - use logCoreWrite for L3 substrate changes
  if (AuditLogger) {
    if (isCore) {
      await AuditLogger.logCoreWrite({
        path,
        operation: 'WriteFile',
        existed,
        bytesWritten: content.length,
        arenaVerified: arenaGatingEnabled && securityEnabled
      });
    } else {
      await AuditLogger.logEvent('FILE_WRITE', {
        path,
        existed,
        bytesWritten: content.length,
        bytesBefore: beforeContent?.length || 0
      }, 'INFO');
    }
  }

  // Emit event for core writes (L3 substrate visibility)
  if (isCore && EventBus) {
    EventBus.emit('tool:core_write', {
      path,
      operation: 'WriteFile',
      existed,
      bytesWritten: content.length
    });
  }

  // Auto-load module if requested and file is .js
  let loadResult = '';
  if (autoLoad && path.endsWith('.js') && SubstrateLoader) {
    try {
      await SubstrateLoader.loadModule(path);
      loadResult = ' + hot-reloaded';
    } catch (err) {
      loadResult = ` (autoLoad failed: ${err.message})`;
    }
  } else if (autoLoad && !SubstrateLoader) {
    loadResult = ' (autoLoad skipped: SubstrateLoader not available)';
  }

  return `Wrote ${path} (${content.length} bytes)${loadResult}`;
}

export const tool = {
  name: "WriteFile",
  description: "Write content to a file in the virtual filesystem",
  inputSchema: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: 'VFS path to write (e.g. /tools/my-tool.js)' },
      content: { type: 'string', description: 'Content to write' },
      autoLoad: { type: 'boolean', description: 'If true and path is .js, hot-reload the module after writing', default: false }
    }
  },
  call
};

export default call;

/**
 * @fileoverview Substrate Loader - Dynamically loads modules and widgets from VFS.
 */

import { loadVfsModule } from '../../core/vfs-module-loader.js';
import { isSecurityEnabled } from '../../core/security-config.js';

const SubstrateLoader = {
  metadata: {
    id: 'SubstrateLoader',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    files: ['capabilities/system/substrate-loader.js', 'core/vfs-module-loader.js'],
    dependencies: ['Utils', 'VFS', 'VerificationManager?', 'VFSSandbox?', 'HITLController?'],
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, VerificationManager, VFSSandbox, HITLController } = deps;
    const { logger } = Utils;

    let _arenaGatingEnabled = false;
    try {
      const saved = localStorage.getItem('REPLOID_ARENA_GATING');
      _arenaGatingEnabled = saved === 'true';
    } catch (e) { /* ignore */ }

    const CRITICAL_PATH_PREFIXES = ['/core/', '/infrastructure/', '/capabilities/'];

    const isCriticalPath = (path) =>
      CRITICAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

    const requiresApproval = (path) => {
      if (!isSecurityEnabled()) return false;
      if (!HITLController) return false;
      const state = HITLController.getState();
      const mode = state?.config?.approvalMode || 'autonomous';
      if (mode === 'autonomous') return false;
      return isCriticalPath(path);
    };

    const requestApproval = (path) => {
      if (!HITLController) return Promise.resolve(true);

      return new Promise((resolve) => {
        HITLController.requestApproval({
          moduleId: 'SubstrateLoader',
          capability: 'APPROVE_SELF_MODIFICATION',
          action: `Load ${path}`,
          data: { path },
          onApprove: () => resolve(true),
          onReject: (reason) => {
            logger.info(`[Substrate] Load rejected: ${path} (${reason})`);
            resolve(false);
          },
          timeout: 300000
        });
      });
    };

    // With the arena gate on, a critical path must pass the sandboxed Verification
    // Worker. A missing verifier, thrown error, or skipped/non-pass result blocks.
    const verifyInSandbox = async (path, code) => {
      if (!VFSSandbox || typeof VerificationManager?.verifyProposal !== 'function') {
        return { passed: false, reason: 'verifier unavailable', errors: ['Verifier unavailable while arena gating is enabled'] };
      }
      const snapshot = await VFSSandbox.createSnapshot();
      try {
        await VFSSandbox.applyChanges({ [path]: code });
        return await VerificationManager.verifyProposal({ [path]: code }, { requireVerification: true });
      } finally {
        await VFSSandbox.restoreSnapshot(snapshot);
      }
    };

    const loadModule = async (path, options = {}) => {
      if (!(await VFS.exists(path))) throw new Error(`Module not found: ${path}`);

      const code = await VFS.read(path);

      if (requiresApproval(path)) {
        const approved = await requestApproval(path);
        if (!approved) {
          throw new Error(`Load blocked by HITL: ${path}`);
        }
      }

      // Security off is the documented permissive default: no gate runs.
      const sandboxGate = isSecurityEnabled() && _arenaGatingEnabled && isCriticalPath(path);
      if (sandboxGate) {
        const result = await verifyInSandbox(path, code);
        if (result?.passed !== true || result.skipped === true) {
          const errors = result?.errors?.length ? `: ${result.errors.join('; ')}` : '';
          throw new Error(`Arena verification failed for ${path}${errors}`);
        }
        if (result?.warnings?.length) {
          logger.warn(`[Substrate] Arena warnings for ${path}: ${result.warnings.join('; ')}`);
        }
      }

      const module = await loadVfsModule({
        VFS,
        logger,
        VerificationManager,
        path,
        code,
        expectedSha256: options.expectedSha256,
        // Every path not already sandbox-verified goes through the loader's verifier.
        verify: !sandboxGate
      });
      logger.info(`[Substrate] Loaded module: ${path}`);
      return module;
    };

    const loadWidget = async (path, containerId) => {
      const module = await loadModule(path);
      if (!module.default || !module.default.render) {
        throw new Error('Invalid widget: missing render()');
      }

      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = ''; // Clear previous
        const element = module.default.render();
        container.appendChild(element);
        logger.info(`[Substrate] Rendered widget ${path} to ${containerId}`);
      }
    };

    return { loadModule, loadWidget };
  }
};

export default SubstrateLoader;

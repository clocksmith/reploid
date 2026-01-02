/**
 * @fileoverview Substrate Loader - Dynamically loads modules and widgets from VFS.
 */

import { loadVfsModule } from '../../core/vfs-module-loader.js';

const SubstrateLoader = {
  metadata: {
    id: 'SubstrateLoader',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
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

    const verifyInSandbox = async (path, code) => {
      if (!_arenaGatingEnabled || !VFSSandbox || !VerificationManager) {
        return { passed: true, skipped: true };
      }
      const snapshot = await VFSSandbox.createSnapshot();
      try {
        await VFSSandbox.applyChanges({ [path]: code });
        return await VerificationManager.verifyProposal({ [path]: code });
      } finally {
        await VFSSandbox.restoreSnapshot(snapshot);
      }
    };

    const loadModule = async (path) => {
      if (!(await VFS.exists(path))) throw new Error(`Module not found: ${path}`);

      const code = await VFS.read(path);

      if (requiresApproval(path)) {
        const approved = await requestApproval(path);
        if (!approved) {
          throw new Error(`Load blocked by HITL: ${path}`);
        }
      }

      if (isCriticalPath(path)) {
        const result = await verifyInSandbox(path, code);
        if (!result?.passed) {
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
        verify: !isCriticalPath(path)
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

/**
 * @fileoverview Verification Manager
 * Pre-flight safety checks via Web Worker.
 */

const VerificationManager = {
  metadata: {
    id: 'VerificationManager',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['Utils', 'VFS'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { VFS } = deps;

    const WORKER_PATH = '/core/verification-worker.js';

    const createSnapshot = async () => {
      const files = await VFS.list('/');
      const snapshot = {};
      for (const path of files) {
        if (path.endsWith('.js') || path.endsWith('.json')) {
          try { snapshot[path] = await VFS.read(path); } catch (e) {}
        }
      }
      return snapshot;
    };

    const verifyProposal = async (changes) => {
      logger.info('[Verifier] Snapshotting...');
      const snapshot = await createSnapshot();

      // Overlay changes
      for (const c of changes) {
        if (c.operation === 'DELETE') delete snapshot[c.file_path];
        else snapshot[c.file_path] = c.new_content;
      }

      return new Promise((resolve) => {
        const worker = new Worker(WORKER_PATH);

        const timeout = setTimeout(() => {
          worker.terminate();
          resolve({ passed: false, reason: 'Timeout' });
        }, 5000);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(e.data);
        };

        worker.onerror = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          logger.error('[Verifier] Crash', e);
          resolve({ passed: false, reason: 'Worker Error' });
        };

        worker.postMessage({ type: 'VERIFY', snapshot });
      });
    };

    return { verifyProposal };
  }
};

export default VerificationManager;

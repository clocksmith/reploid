/**
 * @fileoverview VFS Sandbox - Snapshot and restore for test isolation
 * Creates isolated VFS environments for arena competition testing.
 */

const VFSSandbox = {
  metadata: {
    id: 'VFSSandbox',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['VFS', 'Utils'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { VFS, Utils } = deps;
    const { logger } = Utils;

    /**
     * Create a snapshot of the current VFS state
     * @returns {Promise<{files: Object, timestamp: number}>}
     */
    const createSnapshot = async () => {
      const allPaths = await VFS.list('/');
      const snapshot = {};

      for (const path of allPaths) {
        try {
          snapshot[path] = await VFS.read(path);
        } catch (e) {
          logger.debug(`[VFSSandbox] Skipping unreadable: ${path}`);
        }
      }

      logger.info(`[VFSSandbox] Snapshot created: ${Object.keys(snapshot).length} files`);
      return { files: snapshot, timestamp: Date.now() };
    };

    /**
     * Restore VFS to a previous snapshot state
     * @param {Object} snapshot - Snapshot created by createSnapshot()
     */
    const restoreSnapshot = async (snapshot) => {
      // Get current files to determine what to delete
      const currentFiles = await VFS.list('/');

      // Delete files not in snapshot
      for (const path of currentFiles) {
        if (!snapshot.files[path]) {
          try {
            await VFS.delete(path);
          } catch (e) {
            logger.debug(`[VFSSandbox] Failed to delete: ${path}`);
          }
        }
      }

      // Restore snapshot files
      for (const [path, content] of Object.entries(snapshot.files)) {
        try {
          await VFS.write(path, content);
        } catch (e) {
          logger.warn(`[VFSSandbox] Failed to restore: ${path}`);
        }
      }

      logger.info(`[VFSSandbox] Restored ${Object.keys(snapshot.files).length} files`);
    };

    /**
     * Apply changes to current VFS state
     * @param {Object} changes - { path: content } or { path: null } for delete
     */
    const applyChanges = async (changes) => {
      let applied = 0;
      let deleted = 0;

      for (const [path, content] of Object.entries(changes)) {
        try {
          if (content === null) {
            await VFS.delete(path);
            deleted++;
          } else {
            await VFS.write(path, content);
            applied++;
          }
        } catch (e) {
          logger.warn(`[VFSSandbox] Failed to apply change: ${path}`);
        }
      }

      logger.debug(`[VFSSandbox] Applied ${applied} changes, deleted ${deleted} files`);
    };

    /**
     * Get diff between current VFS and a snapshot
     * @param {Object} snapshot - Snapshot to compare against
     * @returns {Promise<{added: string[], modified: string[], deleted: string[]}>}
     */
    const diffSnapshot = async (snapshot) => {
      const currentFiles = await VFS.list('/');
      const snapshotPaths = new Set(Object.keys(snapshot.files));
      const currentPaths = new Set(currentFiles);

      const added = currentFiles.filter(p => !snapshotPaths.has(p));
      const deleted = [...snapshotPaths].filter(p => !currentPaths.has(p));
      const modified = [];

      for (const path of currentFiles) {
        if (snapshotPaths.has(path)) {
          try {
            const currentContent = await VFS.read(path);
            if (currentContent !== snapshot.files[path]) {
              modified.push(path);
            }
          } catch (e) {
            // File unreadable, consider it modified
            modified.push(path);
          }
        }
      }

      return { added, modified, deleted };
    };

    return {
      createSnapshot,
      restoreSnapshot,
      applyChanges,
      diffSnapshot
    };
  }
};

export default VFSSandbox;

/**
 * @fileoverview Genesis Snapshot - Immutable kernel backups and rollback
 * Provides "Lifeboat" snapshots for recovery from bad mutations.
 */

const GenesisSnapshot = {
  metadata: {
    id: 'GenesisSnapshot',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'EventBus'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger, generateId } = Utils;

    const SNAPSHOT_DIR = '/.genesis/snapshots';
    const LIFEBOAT_KEY = 'REPLOID_LIFEBOAT';
    const MAX_SNAPSHOTS = 10;

    /**
     * Create a full VFS snapshot
     * @param {string} [name] - Optional snapshot name
     * @param {Object} [options] - Options
     * @param {boolean} [options.includeApps] - Include /apps/ (default: false)
     * @param {boolean} [options.includeLogs] - Include /.logs/ (default: false)
     * @returns {Promise<Object>} Snapshot metadata
     */
    const createSnapshot = async (name = null, options = {}) => {
      const { includeApps = false, includeLogs = false } = options;

      const snapshotId = generateId('snap');
      const timestamp = Date.now();
      const snapshotName = name || `snapshot-${new Date(timestamp).toISOString().split('T')[0]}`;

      logger.info(`[Genesis] Creating snapshot: ${snapshotName}`);

      // Collect all files
      const files = {};
      const collectFiles = async (dir) => {
        try {
          const entries = await VFS.list(dir);
          for (const entry of entries) {
            // Skip based on options
            if (!includeLogs && entry.startsWith('/.logs/')) continue;
            if (!includeApps && entry.startsWith('/apps/')) continue;
            if (entry.startsWith('/.genesis/')) continue; // Never include snapshots

            try {
              const stat = await VFS.stat(entry);
              if (stat.isDirectory) {
                await collectFiles(entry);
              } else {
                files[entry] = await VFS.read(entry);
              }
            } catch (e) {
              logger.debug(`[Genesis] Skip ${entry}: ${e.message}`);
            }
          }
        } catch (e) {
          logger.debug(`[Genesis] Cannot list ${dir}: ${e.message}`);
        }
      };

      await collectFiles('/');

      const snapshot = {
        id: snapshotId,
        name: snapshotName,
        timestamp,
        fileCount: Object.keys(files).length,
        isBootable: true, // This snapshot contains a complete runnable system
        version: '2.0', // Self-hosting VFS architecture version
        files
      };

      // Save snapshot to VFS
      const snapshotPath = `${SNAPSHOT_DIR}/${snapshotId}.json`;
      await VFS.write(snapshotPath, JSON.stringify(snapshot));

      // Update index
      await updateIndex(snapshotId, snapshotName, timestamp, Object.keys(files).length);

      // Prune old snapshots
      await pruneSnapshots();

      EventBus.emit('genesis:snapshot_created', {
        id: snapshotId,
        name: snapshotName,
        fileCount: Object.keys(files).length
      });

      logger.info(`[Genesis] Snapshot created: ${snapshotId} (${Object.keys(files).length} files)`);

      return {
        id: snapshotId,
        name: snapshotName,
        timestamp,
        fileCount: Object.keys(files).length,
        isBootable: true,
        version: '2.0'
      };
    };

    /**
     * Create a "Lifeboat" - immutable kernel backup stored in localStorage
     * This survives VFS corruption and can restore the system from scratch.
     */
    const createLifeboat = async () => {
      logger.info('[Genesis] Creating Lifeboat backup...');

      const coreFiles = {};
      const corePaths = ['/core/', '/infrastructure/'];

      for (const prefix of corePaths) {
        try {
          const entries = await VFS.list(prefix);
          for (const entry of entries) {
            if (entry.endsWith('.js')) {
              try {
                coreFiles[entry] = await VFS.read(entry);
              } catch (e) {
                logger.warn(`[Genesis] Cannot backup ${entry}`);
              }
            }
          }
        } catch (e) {
          logger.debug(`[Genesis] Cannot list ${prefix}`);
        }
      }

      const lifeboat = {
        version: '1.0',
        timestamp: Date.now(),
        files: coreFiles
      };

      try {
        // Compress for localStorage (simple approach)
        const json = JSON.stringify(lifeboat);
        localStorage.setItem(LIFEBOAT_KEY, json);

        EventBus.emit('genesis:lifeboat_created', {
          timestamp: lifeboat.timestamp,
          fileCount: Object.keys(coreFiles).length,
          sizeBytes: json.length
        });

        logger.info(`[Genesis] Lifeboat created: ${Object.keys(coreFiles).length} core files`);
        return { success: true, fileCount: Object.keys(coreFiles).length };
      } catch (e) {
        logger.error('[Genesis] Lifeboat creation failed:', e.message);
        return { success: false, error: e.message };
      }
    };

    /**
     * Restore from Lifeboat (emergency recovery)
     */
    const restoreFromLifeboat = async () => {
      logger.warn('[Genesis] EMERGENCY: Restoring from Lifeboat...');

      try {
        const json = localStorage.getItem(LIFEBOAT_KEY);
        if (!json) {
          throw new Error('No Lifeboat backup found');
        }

        const lifeboat = JSON.parse(json);

        for (const [path, content] of Object.entries(lifeboat.files)) {
          await VFS.write(path, content);
          logger.info(`[Genesis] Restored: ${path}`);
        }

        EventBus.emit('genesis:lifeboat_restored', {
          timestamp: lifeboat.timestamp,
          fileCount: Object.keys(lifeboat.files).length
        });

        logger.info(`[Genesis] Lifeboat restore complete: ${Object.keys(lifeboat.files).length} files`);
        return { success: true, fileCount: Object.keys(lifeboat.files).length };
      } catch (e) {
        logger.error('[Genesis] Lifeboat restore failed:', e.message);
        return { success: false, error: e.message };
      }
    };

    /**
     * Restore from a snapshot
     * @param {string} snapshotId - Snapshot ID to restore
     * @param {Object} [options] - Options
     * @param {boolean} [options.deleteExtra] - Delete files not in snapshot (default: false)
     */
    const restoreSnapshot = async (snapshotId, options = {}) => {
      const { deleteExtra = false } = options;

      logger.warn(`[Genesis] Restoring snapshot: ${snapshotId}`);

      const snapshotPath = `${SNAPSHOT_DIR}/${snapshotId}.json`;
      const snapshotJson = await VFS.read(snapshotPath);
      const snapshot = JSON.parse(snapshotJson);

      let restored = 0;
      let deleted = 0;

      // Restore all files from snapshot
      for (const [path, content] of Object.entries(snapshot.files)) {
        try {
          await VFS.write(path, content);
          restored++;
        } catch (e) {
          logger.warn(`[Genesis] Failed to restore ${path}: ${e.message}`);
        }
      }

      // Optionally delete files not in snapshot
      if (deleteExtra) {
        const currentFiles = await getAllFiles('/');
        for (const path of currentFiles) {
          if (path.startsWith('/.genesis/')) continue;
          if (path.startsWith('/.logs/')) continue;
          if (!snapshot.files[path]) {
            try {
              await VFS.delete(path);
              deleted++;
            } catch (e) {
              logger.debug(`[Genesis] Could not delete ${path}`);
            }
          }
        }
      }

      EventBus.emit('genesis:snapshot_restored', {
        id: snapshotId,
        name: snapshot.name,
        restored,
        deleted
      });

      logger.info(`[Genesis] Restore complete: ${restored} restored, ${deleted} deleted`);
      return { success: true, restored, deleted };
    };

    /**
     * Get list of available snapshots
     */
    const listSnapshots = async () => {
      try {
        const indexPath = `${SNAPSHOT_DIR}/index.json`;
        if (await VFS.exists(indexPath)) {
          const indexJson = await VFS.read(indexPath);
          return JSON.parse(indexJson);
        }
      } catch (e) {
        logger.debug('[Genesis] No snapshot index');
      }
      return [];
    };

    /**
     * Delete a snapshot
     */
    const deleteSnapshot = async (snapshotId) => {
      const snapshotPath = `${SNAPSHOT_DIR}/${snapshotId}.json`;
      await VFS.delete(snapshotPath);

      // Update index
      const index = await listSnapshots();
      const newIndex = index.filter(s => s.id !== snapshotId);
      await VFS.write(`${SNAPSHOT_DIR}/index.json`, JSON.stringify(newIndex, null, 2));

      EventBus.emit('genesis:snapshot_deleted', { id: snapshotId });
      logger.info(`[Genesis] Deleted snapshot: ${snapshotId}`);
    };

    /**
     * Export snapshot as downloadable JSON
     */
    const exportSnapshot = async (snapshotId) => {
      const snapshotPath = `${SNAPSHOT_DIR}/${snapshotId}.json`;
      const snapshotJson = await VFS.read(snapshotPath);
      const snapshot = JSON.parse(snapshotJson);

      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `genesis-${snapshot.name}-${snapshotId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info(`[Genesis] Exported: ${snapshot.name}`);
    };

    /**
     * Import snapshot from file
     */
    const importSnapshot = async (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const snapshot = JSON.parse(e.target.result);

            // Validate snapshot structure
            if (!snapshot.id || !snapshot.files || !snapshot.timestamp) {
              throw new Error('Invalid snapshot format');
            }

            // Save to VFS
            const snapshotPath = `${SNAPSHOT_DIR}/${snapshot.id}.json`;
            await VFS.write(snapshotPath, JSON.stringify(snapshot));

            // Update index
            await updateIndex(snapshot.id, snapshot.name, snapshot.timestamp, snapshot.fileCount);

            EventBus.emit('genesis:snapshot_imported', { id: snapshot.id, name: snapshot.name });
            logger.info(`[Genesis] Imported: ${snapshot.name}`);

            resolve({ success: true, id: snapshot.id, name: snapshot.name });
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
    };

    // --- Internal helpers ---

    const updateIndex = async (id, name, timestamp, fileCount) => {
      const index = await listSnapshots();
      index.push({ id, name, timestamp, fileCount });
      index.sort((a, b) => b.timestamp - a.timestamp);
      await VFS.write(`${SNAPSHOT_DIR}/index.json`, JSON.stringify(index, null, 2));
    };

    const pruneSnapshots = async () => {
      const index = await listSnapshots();
      if (index.length > MAX_SNAPSHOTS) {
        const toDelete = index.slice(MAX_SNAPSHOTS);
        for (const snap of toDelete) {
          try {
            await deleteSnapshot(snap.id);
          } catch (e) {
            logger.debug(`[Genesis] Could not prune ${snap.id}`);
          }
        }
      }
    };

    const getAllFiles = async (dir, acc = []) => {
      try {
        const entries = await VFS.list(dir);
        for (const entry of entries) {
          try {
            const stat = await VFS.stat(entry);
            if (stat.isDirectory) {
              await getAllFiles(entry, acc);
            } else {
              acc.push(entry);
            }
          } catch (e) {}
        }
      } catch (e) {}
      return acc;
    };

    /**
     * Check if Lifeboat exists
     */
    const hasLifeboat = () => {
      try {
        return !!localStorage.getItem(LIFEBOAT_KEY);
      } catch (e) {
        return false;
      }
    };

    /**
     * Get Lifeboat info
     */
    const getLifeboatInfo = () => {
      try {
        const json = localStorage.getItem(LIFEBOAT_KEY);
        if (!json) return null;
        const lifeboat = JSON.parse(json);
        return {
          timestamp: lifeboat.timestamp,
          fileCount: Object.keys(lifeboat.files).length,
          sizeBytes: json.length
        };
      } catch (e) {
        return null;
      }
    };

    return {
      createSnapshot,
      restoreSnapshot,
      listSnapshots,
      deleteSnapshot,
      exportSnapshot,
      importSnapshot,
      createLifeboat,
      restoreFromLifeboat,
      hasLifeboat,
      getLifeboatInfo
    };
  }
};

export default GenesisSnapshot;

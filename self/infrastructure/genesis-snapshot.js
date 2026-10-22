/**
 * @fileoverview Ordinary checkpoints and publication-only immutable source recovery.
 * Publication pins are immutable through this service, not against browser-global
 * storage access or a hostile host. Runtime tool installation has its own gate.
 */

import { validateSourceManifest } from '../image/export.js';
import { createSelfImageManifest, sha256Text, validateSelfImageManifest } from '../image/manifest.js';

const PUBLICATION_SCHEMA = 'reploid/genesis-publication-baseline/v1';
const PUBLICATION_DIR = '/.genesis/publication';
const PUBLICATION_PIN = `${PUBLICATION_DIR}/pin.json`;
const SOURCE_MANIFEST_PATH = '/config/self-source-manifest.json';
const SOURCE_MANIFEST_IMAGE_PATH = '/self/config/self-source-manifest.json';
const PUBLICATION_ID = /^genesis-sha256-[a-f0-9]{64}$/;
let publicationQueue = Promise.resolve();
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const clone = (value) => JSON.parse(JSON.stringify(value));

const publicationIdentity = (manifest) => ({
  schema: PUBLICATION_SCHEMA,
  version: 1,
  files: manifest.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
});

const publicationId = async (manifest) =>
  `genesis-sha256-${await sha256Text(JSON.stringify(publicationIdentity(manifest)))}`;

/** Validate all bytes and the exact declared closure before reuse or recovery. */
export async function validatePublicationBaseline(value, expectedId = value?.id) {
  const baseline = clone(value);
  if (baseline?.schema !== PUBLICATION_SCHEMA || baseline.version !== 1
    || !PUBLICATION_ID.test(baseline.id) || baseline.id !== expectedId) {
    throw new Error('Invalid Genesis publication baseline identity');
  }
  const checked = await validateSelfImageManifest(baseline);
  const sourceManifest = validateSourceManifest(JSON.parse(checked.files[SOURCE_MANIFEST_IMAGE_PATH]));
  const declared = new Set(sourceManifest.files.map((path) => `/self/${path}`));
  if (declared.size !== checked.fileCount
    || Object.keys(checked.files).some((path) => !declared.has(path))) {
    throw new Error('Genesis baseline must contain exactly its declared self-source closure');
  }
  // The descriptor itself must be recovered at the canonical discovery path.
  const descriptorIndex = sourceManifest.files.indexOf('config/self-source-manifest.json');
  if (`/${sourceManifest.seedFiles[descriptorIndex]}` !== SOURCE_MANIFEST_PATH) {
    throw new Error('Genesis source manifest has a noncanonical VFS destination');
  }
  if (sourceManifest.seedFiles.some((path) => path === '.genesis' || path.startsWith('.genesis/'))) {
    throw new Error('Genesis recovery cannot target its protected snapshot storage');
  }
  if (await publicationId(baseline.manifest) !== baseline.id) {
    throw new Error('Genesis publication baseline hash mismatch');
  }
  return { baseline, sourceManifest, fileCount: checked.fileCount, bytes: checked.bytes };
}

// Serialize all service writers in this realm, including separate VFS adapters.
// Browser Web Locks also fence tabs; other hosts must provide a single writer.
const withPublicationLock = (operation) => {
  const pending = publicationQueue.catch(() => {}).then(() => globalThis.navigator?.locks?.request
    ? globalThis.navigator.locks.request('reploid:genesis-publication', operation)
    : operation());
  publicationQueue = pending;
  return pending;
};

const GenesisSnapshot = {
  metadata: {
    id: 'GenesisSnapshot',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
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

    const baselineMetadata = ({ baseline, fileCount, bytes }) => ({
      id: baseline.id, path: `${PUBLICATION_DIR}/${baseline.id}.json`,
      fileCount, bytes, pinned: true, scope: 'publication'
    });

    const readPublicationPin = async () => {
      if (!await VFS.exists(PUBLICATION_PIN)) return null;
      const pin = JSON.parse(await VFS.read(PUBLICATION_PIN));
      if (pin?.schema !== PUBLICATION_SCHEMA || pin.version !== 1 || !PUBLICATION_ID.test(pin.id)) {
        throw new Error('Invalid Genesis publication pin');
      }
      return pin;
    };

    const readPublicationBaseline = async () => {
      const pin = await readPublicationPin();
      if (!pin) throw new Error('No Genesis publication baseline is pinned');
      return validatePublicationBaseline(
        JSON.parse(await VFS.read(`${PUBLICATION_DIR}/${pin.id}.json`)), pin.id
      );
    };

    const pinPublicationBaseline = async (checked) => {
      const { baseline } = checked;
      const pin = await readPublicationPin();
      if (pin) {
        // Never repair, overwrite or silently replace corrupt recovery evidence.
        const existing = await readPublicationBaseline();
        if (pin.id !== baseline.id) throw new Error('Genesis publication baseline is already pinned to different source bytes');
        return baselineMetadata(existing);
      }
      const path = `${PUBLICATION_DIR}/${baseline.id}.json`;
      if (await VFS.exists(path)) {
        await validatePublicationBaseline(JSON.parse(await VFS.read(path)), baseline.id);
      } else {
        await VFS.write(path, JSON.stringify(baseline));
      }
      // Read back the persisted content before publishing a recovery pin.
      const persisted = await validatePublicationBaseline(JSON.parse(await VFS.read(path)), baseline.id);
      await VFS.write(PUBLICATION_PIN, JSON.stringify({
        schema: PUBLICATION_SCHEMA, version: 1, id: baseline.id
      }));
      const confirmed = await readPublicationBaseline();
      if (confirmed.baseline.id !== baseline.id) throw new Error('Genesis publication pin changed while being written');
      EventBus.emit('genesis:publication_pinned', baselineMetadata(persisted));
      return baselineMetadata(persisted);
    };

    /** Called by publication, never by CreateTool or a per-tool activation path. */
    const createPublicationBaseline = async () => withPublicationLock(async () => {
      const sourceText = await VFS.read(SOURCE_MANIFEST_PATH);
      if (typeof sourceText !== 'string') throw new Error(`Missing text source: ${SOURCE_MANIFEST_PATH}`);
      const sourceManifest = validateSourceManifest(JSON.parse(sourceText));
      const files = {};
      for (let index = 0; index < sourceManifest.files.length; index += 1) {
        const sourcePath = `/self/${sourceManifest.files[index]}`;
        const vfsPath = `/${sourceManifest.seedFiles[index]}`;
        // No best-effort reads or export-time rewriting: preserve the exact bytes.
        const content = await VFS.read(vfsPath);
        if (typeof content !== 'string') throw new Error(`Missing text source: ${vfsPath}`);
        files[sourcePath] = content;
      }
      if (files[SOURCE_MANIFEST_IMAGE_PATH] !== sourceText) {
        throw new Error('Genesis source manifest changed during capture');
      }
      const manifest = await createSelfImageManifest({
        paths: Object.keys(files).sort(), readText: async (path) => files[path]
      });
      const baseline = {
        schema: PUBLICATION_SCHEMA, version: 1,
        id: await publicationId(manifest), manifest, files
      };
      const checked = await validatePublicationBaseline(baseline);
      for (let index = 0; index < sourceManifest.files.length; index += 1) {
        const path = `/${sourceManifest.seedFiles[index]}`;
        if (await VFS.read(path) !== files[`/self/${sourceManifest.files[index]}`]) {
          throw new Error(`Genesis source changed during capture: ${path}`);
        }
      }
      return pinPublicationBaseline(checked);
    });

    // Export/import the payload explicitly when carrying recovery into a descendant.
    // A pin alone cannot recover bytes and never fetches from a hidden repository.
    const exportPublicationBaseline = async () => (await readPublicationBaseline()).baseline;
    const getPublicationBaseline = async () => baselineMetadata(await readPublicationBaseline());
    const importPublicationBaseline = async (value) => {
      const snapshot = clone(value);
      return withPublicationLock(async () => pinPublicationBaseline(await validatePublicationBaseline(snapshot)));
    };
    const restorePublicationBaseline = async () => withPublicationLock(async () => {
      const { baseline, sourceManifest, fileCount } = await readPublicationBaseline();
      // Validate the entire payload before the first write, preserve unrelated work,
      // and fail visibly on partial writes rather than report a successful recovery.
      for (let index = 0; index < sourceManifest.files.length; index += 1) {
        const path = `/${sourceManifest.seedFiles[index]}`;
        const content = baseline.files[`/self/${sourceManifest.files[index]}`];
        await VFS.write(path, content);
        if (await VFS.read(path) !== content) throw new Error(`Genesis recovery write mismatch: ${path}`);
      }
      EventBus.emit('genesis:publication_restored', { id: baseline.id, fileCount });
      return { success: true, id: baseline.id, restored: fileCount, deleted: 0 };
    });

    const snapshotPathFor = (id) => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid snapshot ID');
      if (id.startsWith('genesis-sha256-')) throw new Error('Publication baselines are immutable; use the publication recovery API');
      return `${SNAPSHOT_DIR}/${id}.json`;
    };

    const assertSnapshotFiles = (files) => {
      if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Invalid snapshot files');
      for (const [path, content] of Object.entries(files)) {
        if (!path.startsWith('/') || /[\\%?#\u0000-\u001f]/.test(path)
          || path.split('/').slice(1).some((part) => !part || part === '.' || part === '..')
          || path === '/.genesis' || path.startsWith('/.genesis/') || typeof content !== 'string') {
          throw new Error(`Invalid or protected snapshot restore path: ${path}`);
        }
      }
    };

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
      const snapshotPath = snapshotPathFor(snapshotId);
      if (await VFS.exists(snapshotPath)) throw new Error(`Snapshot already exists: ${snapshotId}`);
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
     * Legacy core-only localStorage backup, not the immutable publication baseline.
     * Publication recovery uses restorePublicationBaseline and its complete payload.
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
        assertSnapshotFiles(lifeboat.files);

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

      const snapshotPath = snapshotPathFor(snapshotId);
      const snapshotJson = await VFS.read(snapshotPath);
      const snapshot = JSON.parse(snapshotJson);
      assertSnapshotFiles(snapshot.files);

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
          if (!hasOwn(snapshot.files, path)) {
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
      const snapshotPath = snapshotPathFor(snapshotId);
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
      const snapshotPath = snapshotPathFor(snapshotId);
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
            assertSnapshotFiles(snapshot.files);
            const snapshotPath = snapshotPathFor(snapshot.id);
            if (await VFS.exists(snapshotPath)) throw new Error(`Snapshot already exists: ${snapshot.id}`);
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
      createPublicationBaseline,
      getPublicationBaseline,
      exportPublicationBaseline,
      importPublicationBaseline,
      restorePublicationBaseline,
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

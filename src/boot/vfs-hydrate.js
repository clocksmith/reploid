/**
 * @fileoverview VFS Hydration
 * Fetches source files from network and writes to VFS for self-hosting.
 */

import { buildCoreToolSet } from './config.js';

/**
 * Convert file path to VFS path.
 * @param {string} file - File path
 * @returns {string} VFS path
 */
const toVfsPath = (file) => {
  const clean = file.replace(/^\.\//, '');
  return clean.startsWith('/') ? clean : `/${clean}`;
};

/**
 * Resolve a URL relative to the current document base.
 * @param {string} file - File path from src/
 * @returns {string} Resolved URL for fetch
 */
const toWebPath = (file) => {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/');
  return new URL(file, base).toString();
};

const loadVfsManifest = async (logger) => {
  try {
    const manifestUrl = toWebPath('config/vfs-manifest.json');
    const resp = await fetch(manifestUrl, { cache: 'no-store' });
    if (!resp.ok) {
      logger.warn(`[Boot] Failed to load VFS manifest (${resp.status})`);
      return null;
    }
    const data = await resp.json();
    if (!data || !Array.isArray(data.files)) {
      logger.warn('[Boot] VFS manifest missing files list');
      return null;
    }
    return data.files;
  } catch (err) {
    logger.warn('[Boot] Failed to parse VFS manifest', err);
    return null;
  }
};

/**
 * Reset session artifacts from VFS.
 * @param {Object} vfs - VFS instance
 * @param {Object} genesisConfig - Genesis configuration
 * @param {string} genesisLevel - Current genesis level
 * @param {Object} logger - Logger instance
 */
export async function resetSession(vfs, genesisConfig, genesisLevel, logger) {
  const resetSetting = localStorage.getItem('REPLOID_RESET_VFS');
  const shouldReset = resetSetting === null || resetSetting === 'true';

  if (!shouldReset) return;

  logger.info('[Boot] Session reset requested - clearing session artifacts...');

  try {
    let seededPaths = null;
    try {
      const seedText = await vfs.read('/config/vfs-seed.json');
      const seed = JSON.parse(seedText);
      const files = seed?.files && typeof seed.files === 'object' ? seed.files : null;
      if (files) {
        seededPaths = new Set(Object.keys(files));
      }
    } catch {
      seededPaths = null;
    }

    // Use preserveOnReset from config, or fall back to defaults
    const preserveConfig = genesisConfig.preserveOnReset || {};
    const coreTools = buildCoreToolSet(genesisConfig, genesisLevel);
    const coreUIFiles = new Set(preserveConfig.ui || ['proto.js', 'toast.js']);
    const coreStyles = new Set(preserveConfig.styles || [
      'rd.css',
      'landing-mono.css',
      'vfs-explorer.css',
      'index.css',
      'layout.css',
      'components.css',
      'history.css',
      'panels.css',
      'vfs.css',
      'responsive.css',
      'inline-chat.css',
      'hitl.css'
    ]);

    // Clear non-core tools
    const allTools = await vfs.list('/tools/');
    for (const file of allTools) {
      if (seededPaths && seededPaths.has(file)) continue;
      const toolName = file.replace('/tools/', '').replace('.js', '');
      if (!coreTools.has(toolName)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    // Clear session UI files (except core)
    const uiFiles = await vfs.list('/ui/');
    for (const file of uiFiles) {
      if (seededPaths && seededPaths.has(file)) continue;
      const fileName = file.split('/').pop();
      if (!file.includes('/ui/components/') &&
          !file.includes('/ui/dashboard/') &&
          !file.includes('/ui/panels/') &&
          !file.includes('/ui/boot/') &&
          !coreUIFiles.has(fileName)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    // Clear agent-created capabilities
    const capFiles = await vfs.list('/capabilities/');
    for (const file of capFiles) {
      if (seededPaths && seededPaths.has(file)) continue;
      if (file.match(/^\/capabilities\/[^/]+\.js$/)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    // Clear non-core styles
    const styleFiles = await vfs.list('/styles/');
    for (const file of styleFiles) {
      if (seededPaths && seededPaths.has(file)) continue;
      const fileName = file.split('/').pop();
      if (!coreStyles.has(fileName)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    logger.info('[Boot] Session reset complete');
    if (localStorage.getItem('REPLOID_RESET_VFS') !== 'false') {
      localStorage.setItem('REPLOID_RESET_VFS', 'false');
    }
  } catch (e) {
    logger.warn('[Boot] Session reset failed:', e.message);
  }
}

/**
 * Seed FileOutline tool if missing.
 * @param {Object} vfs - VFS instance
 * @param {Object} logger - Logger instance
 */
export async function seedCodeIntel(vfs, logger) {
  const toolPath = '/tools/FileOutline.js';
  if (await vfs.exists(toolPath)) return;

  logger.info('[Boot] Seeding FileOutline tool...');
  try {
    const resp = await fetch('../tools/FileOutline.js', { cache: 'no-store' });
    if (!resp.ok) {
      logger.warn('[Boot] FileOutline.js not found on server, skipping seed.');
      return;
    }
    const code = await resp.text();
    await vfs.write(toolPath, code);
    logger.info('[Boot] Seeding complete: FileOutline.js');
  } catch (e) {
    logger.error('[Boot] Failed to seed FileOutline', e);
  }
}

/**
 * Hydrate VFS with source files from network.
 * @param {Object} vfs - VFS instance
 * @param {Object} genesisConfig - Genesis configuration
 * @param {string[]} resolvedModules - Resolved module list
 * @param {string} genesisLevel - Current genesis level
 * @param {Object} logger - Logger instance
 */
export async function hydrateVFS(vfs, genesisConfig, resolvedModules, genesisLevel, logger) {
  try {
    const preserveOnBoot = typeof localStorage !== 'undefined' &&
      localStorage.getItem('REPLOID_PRESERVE_ON_BOOT') === 'true';

    logger.info('[Boot] Beginning full VFS hydration (self-hosting mode)...');
    if (preserveOnBoot) {
      logger.info('[Boot] Preserve on boot enabled. Existing VFS files will not be overwritten.');
    }

    const filesToSeed = new Set();
    const manifestFiles = await loadVfsManifest(logger);
    if (manifestFiles && manifestFiles.length > 0) {
      for (const file of manifestFiles) {
        filesToSeed.add(file);
      }
    } else {
      const moduleFiles = genesisConfig?.moduleFiles || {};
      const sharedFiles = genesisConfig?.sharedFiles || {};

      // Add files for each resolved module
      for (const moduleName of resolvedModules) {
        const files = moduleFiles[moduleName];
        if (files) {
          for (const file of files) {
            filesToSeed.add(file);
          }
        }
      }

      // Add shared files (tools, ui, styles)
      for (const category of Object.keys(sharedFiles)) {
        for (const file of sharedFiles[category]) {
          filesToSeed.add(file);
        }
      }

      // Add level-specific files
      const levelFiles = genesisConfig?.levelFiles?.[genesisLevel];
      if (levelFiles) {
        for (const category of Object.keys(levelFiles)) {
          for (const file of levelFiles[category]) {
            filesToSeed.add(file);
          }
        }
        logger.debug(`[Boot] Added ${Object.values(levelFiles).flat().length} level-specific files`);
      }
    }

    logger.info(`[Boot] Hydrating ${filesToSeed.size} files...`);

    const hydrateFile = async (file) => {
      const vfsPath = toVfsPath(file);
      const webPath = toWebPath(file);

      try {
        if (preserveOnBoot) {
          try {
            if (await vfs.exists(vfsPath)) return;
          } catch {
            // Continue hydration if exists check fails
          }
        }

        const resp = await fetch(webPath, { cache: 'no-store' });
        if (!resp.ok) {
          logger.warn(`[Boot] Failed to fetch ${webPath} (${resp.status})`);
          return;
        }
        const contents = await resp.text();

        // Skip write if content is identical (bandwidth/perf optimization)
        let existingContent = null;
        try {
          existingContent = await vfs.read(vfsPath);
        } catch {
          // File doesn't exist yet
        }
        if (existingContent === contents) return;

        await vfs.write(vfsPath, contents);
        logger.info(`[Boot] Hydrated ${vfsPath}`);
      } catch (err) {
        logger.warn(`[Boot] Failed to hydrate ${webPath}`, err);
      }
    };

    // Parallel hydration with concurrency limit
    const files = Array.from(filesToSeed);
    const concurrency = Math.min(6, files.length || 1);
    let index = 0;

    const worker = async () => {
      while (index < files.length) {
        const file = files[index];
        index += 1;
        await hydrateFile(file);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    logger.info('[Boot] VFS hydration complete');
  } catch (err) {
    logger.warn('[Boot] VFS hydration failed:', err.message);
  }
}

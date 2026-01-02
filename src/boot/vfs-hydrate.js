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
 * Convert file path to web fetch path.
 * File paths in config are relative to src/ (e.g., "core/vfs.js").
 * Since this file is in src/boot/, we need to go up one level.
 * @param {string} file - File path from src/
 * @returns {string} Web path for fetch
 */
const toWebPath = (file) => {
  if (file.startsWith('./') || file.startsWith('../')) {
    return file;
  }
  // Paths are relative to src/, but we're in src/boot/, so go up one level
  return `../${file}`;
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
    // Use preserveOnReset from config, or fall back to defaults
    const preserveConfig = genesisConfig.preserveOnReset || {};
    const coreTools = buildCoreToolSet(genesisConfig, genesisLevel);
    const coreUIFiles = new Set(preserveConfig.ui || ['proto.js', 'toast.js']);
    const coreStyles = new Set(preserveConfig.styles || ['theme.css', 'proto.css', 'wizard.css', 'vfs-explorer.css']);

    // Clear non-core tools
    const allTools = await vfs.list('/tools/');
    for (const file of allTools) {
      const toolName = file.replace('/tools/', '').replace('.js', '');
      if (!coreTools.has(toolName)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    // Clear session UI files (except core)
    const uiFiles = await vfs.list('/ui/');
    for (const file of uiFiles) {
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
      if (file.match(/^\/capabilities\/[^/]+\.js$/)) {
        await vfs.delete(file);
        logger.info(`[Boot] Deleted session artifact: ${file}`);
      }
    }

    // Clear non-core styles
    const styleFiles = await vfs.list('/styles/');
    for (const file of styleFiles) {
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
    const resp = await fetch('../tools/FileOutline.js');
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
    logger.info('[Boot] Beginning full VFS hydration (self-hosting mode)...');

    const filesToSeed = new Set();
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

    logger.info(`[Boot] Hydrating ${filesToSeed.size} files...`);

    const refreshOnBoot = genesisConfig?.refreshOnBoot || [];
    const refreshSet = new Set(refreshOnBoot.map(toVfsPath));

    const hydrateFile = async (file) => {
      const vfsPath = toVfsPath(file);
      const webPath = toWebPath(file);
      const shouldRefresh = refreshSet.has(vfsPath);

      let existingContent = null;
      try {
        existingContent = await vfs.read(vfsPath);
      } catch {
        existingContent = null;
      }

      const exists = existingContent !== null;
      if (exists && !shouldRefresh) return;

      try {
        const resp = await fetch(webPath);
        if (!resp.ok) {
          logger.warn(`[Boot] Failed to fetch ${webPath} (${resp.status})`);
          return;
        }
        const contents = await resp.text();

        // Skip if unchanged
        if (exists && existingContent === contents) return;

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

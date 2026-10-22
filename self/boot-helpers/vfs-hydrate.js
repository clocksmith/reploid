/**
 * @fileoverview VFS Hydration
 * Fetches source files from network and writes to VFS for self-hosting.
 */

import { buildCoreToolSet } from './config.js';
import { toSourceWebPath } from '../boot-spec.js';
import '../config/boot-seed.js';

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
 * @param {string} file - File path from self/
 * @returns {string} Resolved URL for fetch
 */
const toWebPath = (file) => {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/');
  const normalized = String(file || '').startsWith('/') ? String(file) : `/${String(file || '')}`;
  return new URL(toSourceWebPath(normalized), base).toString();
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
  const shouldReset = resetSetting === 'true';

  if (!shouldReset) return;

  logger.info('[Boot] Session reset requested - clearing session artifacts...');

  try {
    let seededPaths = null;
    try {
      const manifestText = await vfs.read('/config/vfs-manifest.json');
      const manifest = JSON.parse(manifestText);
      const files = Array.isArray(manifest?.files) ? manifest.files : null;
      if (files) {
        seededPaths = new Set(files.map((file) => toVfsPath(file)));
      }
    } catch {
      seededPaths = null;
    }

    // Use preserveOnReset from config, or fall back to defaults
    const preserveConfig = genesisConfig.preserveOnReset || {};
    const coreTools = buildCoreToolSet(genesisConfig, genesisLevel);
    const coreUIFiles = new Set(preserveConfig.ui || ['toast.js']);
    const coreStyles = new Set(preserveConfig.styles || [
      'zero.css',
      'rd.css',
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
          !file.includes('/ui/boot-wizard/') &&
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

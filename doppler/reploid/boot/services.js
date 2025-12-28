/**
 * @fileoverview Core Service Resolution
 * Resolves critical services and exposes global REPLOID object.
 */

/**
 * Create genesis snapshot for rollback.
 * @param {Object} container - DI container
 * @param {Object} logger - Logger instance
 */
export async function createGenesisSnapshot(container, logger) {
  logger.info('[Boot] Creating genesis snapshot...');
  try {
    const GenesisSnapshot = await container.resolve('GenesisSnapshot');
    await GenesisSnapshot.createSnapshot('genesis-' + new Date().toISOString().split('T')[0], {
      includeApps: false,
      includeLogs: false
    });
    logger.info('[Boot] Genesis snapshot created - pristine state preserved');
  } catch (e) {
    logger.warn('[Boot] Failed to create genesis snapshot:', e.message);
  }
}

/**
 * Initialize swarm transport if enabled.
 * @param {Object} container - DI container
 * @param {string[]} resolvedModules - Resolved module list
 * @param {Object} logger - Logger instance
 */
export async function initializeSwarm(container, resolvedModules, logger) {
  if (!resolvedModules.includes('SwarmTransport')) return;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const swarmParam = urlParams.get('swarm');
    const swarmEnabled = swarmParam || localStorage.getItem('REPLOID_SWARM_ENABLED') === 'true';

    if (!swarmEnabled) {
      logger.info('[Boot] Swarm disabled (add ?swarm=true or set REPLOID_SWARM_ENABLED=true)');
      return;
    }

    const transport = await container.resolve('SwarmTransport');
    const initOk = await transport.init();

    if (initOk) {
      logger.info(`[Boot] Swarm Transport initialized (${transport.getTransportType()})`);
      window.__REPLOID_CONTAINER__ = container;

      if (resolvedModules.includes('SwarmSync')) {
        const swarmSync = await container.resolve('SwarmSync');
        await swarmSync.init();
        logger.info('[Boot] Swarm Sync initialized');
      }
    }
  } catch (e) {
    logger.warn('[Boot] Swarm Transport failed to initialize:', e.message);
  }
}

/**
 * Resolve core services and expose global REPLOID object.
 * @param {Object} container - DI container
 * @param {Object} logger - Logger instance
 * @returns {Promise<Object>} Object with resolved services
 */
export async function resolveServices(container, logger) {
  logger.info('[Boot] Resolving core services...');

  const vfs = await container.resolve('VFS');
  await container.resolve('StateManager');
  await container.resolve('ToolRunner');

  const schemaRegistry = await container.resolve('SchemaRegistry');
  const telemetryTimeline = await container.resolve('TelemetryTimeline');
  const agent = await container.resolve('AgentLoop');
  const llmClient = await container.resolve('LLMClient');
  const toolRunner = await container.resolve('ToolRunner');
  let observability = null;
  try {
    observability = await container.resolve('Observability');
  } catch {
    // Observability not available for this genesis level
  }

  let transformersClient = null;
  try {
    transformersClient = await container.resolve('TransformersClient');
  } catch {
    // TransformersClient not available
  }

  // Expose global REPLOID object
  window.REPLOID = {
    container,
    agent,
    vfs,
    llmClient,
    toolRunner,
    schemaRegistry,
    telemetryTimeline,
    transformersClient,
    observability
  };

  // DI helper for sync access
  window.REPLOID_DI = {
    get: (name) => window.REPLOID[name.charAt(0).toLowerCase() + name.slice(1)] || null,
    resolve: (name) => container.resolve(name)
  };

  logger.info('[Boot] Core services resolved');

  return { vfs, agent, schemaRegistry, telemetryTimeline, observability };
}

/**
 * Setup import/export functions on window.
 * @param {Object} container - DI container
 * @param {Object} logger - Logger instance
 */
export function setupExportFunctions(container, logger) {
  window.downloadReploid = async (filename = 'reploid-export.json') => {
    const stateManager = await container.resolve('StateManager');
    const vfs = await container.resolve('VFS');

    const vfsExport = await vfs.exportAll();
    const vfsFiles = {};
    for (const [path, entry] of Object.entries(vfsExport.files)) {
      vfsFiles[path] = entry.content;
    }

    const state = stateManager.getState();

    let activityLog = [];
    try {
      if (window.REPLOID?.agent?.getRecentActivities) {
        activityLog = await window.REPLOID.agent.getRecentActivities();
      }
    } catch (e) {
      logger.warn('[Export] Unable to load activity log', e.message);
    }

    let conversationContext = [];
    let systemPrompt = '';
    try {
      if (window.REPLOID?.agent?.getContext) {
        conversationContext = window.REPLOID.agent.getContext();
      }
      if (window.REPLOID?.agent?.getSystemPrompt) {
        systemPrompt = window.REPLOID.agent.getSystemPrompt();
      }
    } catch (e) {
      logger.warn('[Export] Unable to load conversation context', e.message);
    }

    const exportData = {
      version: '1.1',
      exportedAt: new Date().toISOString(),
      state,
      activityLog,
      conversationContext,
      systemPrompt,
      vfs: vfsFiles,
      metadata: {
        totalCycles: state.totalCycles || 0,
        fileCount: Object.keys(vfsFiles).length,
        contextMessages: conversationContext.length
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    logger.info(`[Export] Downloaded ${filename}`);
  };

  window.importREPLOID = async (jsonData, options = {}) => {
    const { clearFirst = false } = options;
    const vfs = await container.resolve('VFS');

    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;

    if (!data.vfs || typeof data.vfs !== 'object') {
      throw new Error('Invalid import data: missing vfs object');
    }

    const importData = { files: {} };
    for (const [path, content] of Object.entries(data.vfs)) {
      importData.files[path] = { content };
    }

    const count = await vfs.importAll(importData, clearFirst);
    logger.info(`[Import] Imported ${count} files`);

    return { imported: count };
  };
}

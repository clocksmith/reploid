/**
 * @fileoverview REPLOID Bootstrapper
 * Slim entry point that delegates to modular boot components.
 *
 * Genesis Levels:
 *   TABULA     - Minimal agent core (17 modules)
 *   REFLECTION - +self-awareness, HITL (6 modules)
 *   FULL       - +cognition, arena, swarm (28 modules)
 */

// === BOOT INFRASTRUCTURE ===
import Utils from './core/utils.js';
import DIContainer from './infrastructure/di-container.js';

// === MODULAR BOOT ===
import { boot, renderErrorUI } from './boot/index.js';

/**
 * Parse models from localStorage with fallback
 */
function parseModels() {
  try {
    const saved = localStorage.getItem('SELECTED_MODELS');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[Boot] Failed to parse SELECTED_MODELS, resetting');
    localStorage.removeItem('SELECTED_MODELS');
    return [];
  }
}

/**
 * Complete the awaken process after boot
 */
async function completeAwaken(bootResult, goal, wizardContainer) {
  const { agent, vfs, container, genesisConfig } = bootResult;
  const logger = Utils.factory().logger;

  // Lazy load Proto styles
  if (!document.getElementById('proto-stylesheet')) {
    const link = document.createElement('link');
    link.id = 'proto-stylesheet';
    link.rel = 'stylesheet';
    link.href = 'styles/proto/index.css';
    document.head.appendChild(link);
  }

  const { default: Proto } = await import('./ui/proto.js');

  let workerManager = null;
  try {
    workerManager = await container.resolve('WorkerManager');
  } catch (e) {
    logger.debug('[Boot] WorkerManager not available');
  }

  let arenaHarness = null;
  try {
    arenaHarness = await container.resolve('ArenaHarness');
  } catch (e) {
    logger.debug('[Boot] ArenaHarness not available');
  }

  const proto = Proto.factory({
    Utils: Utils.factory(),
    EventBus: await container.resolve('EventBus'),
    AgentLoop: agent,
    StateManager: await container.resolve('StateManager'),
    WorkerManager: workerManager,
    ArenaHarness: arenaHarness
  });

  // Remove boot UI
  if (wizardContainer) wizardContainer.remove();
  document.body.classList.add('no-grid-pattern');

  const appEl = document.getElementById('app');
  appEl.classList.add('active');
  proto.mount(appEl);
  proto.setVFS(vfs);

  logger.info('[Boot] UI Mounted.');

  // Start agent if goal provided
  if (goal) {
    const consensusStrategy = localStorage.getItem('CONSENSUS_TYPE') || 'arena';
    let models = parseModels();

    if (models.length === 0 && navigator.gpu) {
      models = [{
        id: 'smollm2-360m',
        name: 'SmolLM2 360M (Auto)',
        provider: 'transformers',
        hostType: 'browser-local'
      }];
      logger.info('[Boot] Auto-selected: ' + models[0].name);
    }

    if (models.length > 0) {
      agent.setModels(models);
      agent.setConsensusStrategy(consensusStrategy);

      if (workerManager) {
        try {
          await workerManager.init(genesisConfig);
          workerManager.setModelConfig(models[0]);
        } catch (e) {
          logger.warn('[Boot] WorkerManager init failed');
        }
      }
    }

    logger.info('[Boot] Starting agent with goal: ' + goal);
    agent.run(goal).catch(e => logger.error('[Boot] Agent error:', e.message));
  }
}

(async () => {
  try {
    // Show wizard FIRST, before boot
    const { initWizard: initWizardUI } = await import('./ui/boot/wizard/index.js');
    const wizardContainer = document.getElementById('wizard-container');

    if (wizardContainer) {
      wizardContainer.style.display = 'block';
      initWizardUI(wizardContainer);
    }

    // Expose awaken trigger - this runs boot() when user clicks Awaken
    window.triggerAwaken = async (goal) => {
      try {
        // NOW run the boot sequence
        const bootResult = await boot(Utils, DIContainer);
        await completeAwaken(bootResult, goal, wizardContainer);
      } catch (err) {
        console.error('[Boot] CRITICAL BOOT FAILURE', err);
        renderErrorUI(err);
      }
    };

  } catch (err) {
    console.error('[Boot] CRITICAL BOOT FAILURE', err);
    renderErrorUI(err);
  }
})();

/**
 * @fileoverview REPLOID Bootstrapper
 * Initializes the Dependency Injection container and starts the agent.
 */

import Utils from './core/utils.js';
import DIContainer from './infrastructure/di-container.js';
import EventBus from './infrastructure/event-bus.js';
import AuditLogger from './infrastructure/audit-logger.js';
import RateLimiter from './infrastructure/rate-limiter.js';

import VFS from './core/vfs.js';
import StateManager from './core/state-manager.js';
import StateHelpersPure from './core/state-helpers-pure.js';

import LLMClient from './core/llm-client.js';
import TransformersClient from './core/transformers-client.js';
import ResponseParser from './core/response-parser.js';
import ContextManager from './core/context-manager.js';
import VerificationManager from './core/verification-manager.js';

import ToolRunner from './core/tool-runner.js';
import ToolWriter from './core/tool-writer.js';
import MetaToolWriter from './core/meta-tool-writer.js';

import AgentLoop from './core/agent-loop.js';
import PersonaManager from './core/persona-manager.js';

// Capabilities moved to their own directories
import SubstrateLoader from './capabilities/system/substrate-loader.js';
import ReflectionStore from './capabilities/reflection/reflection-store.js';
import ReflectionAnalyzer from './capabilities/reflection/reflection-analyzer.js';
import PerformanceMonitor from './capabilities/performance/performance-monitor.js';
import SelfTester from './capabilities/testing/self-tester.js';

// Boot UI (model config, provider detection)
import { initModelConfig } from './ui/boot/model-config/index.js';

// UI Imports (Dynamic to allow headless boot)
// import Dashboard from './ui/dashboard.js';

(async () => {
  const logger = Utils.factory().logger;
  logger.info('[Boot] Starting REPLOID System...');

  // Initialize boot screen UI (provider detection, model selector)
  initModelConfig();

  try {
    // 1. Load Configuration
    const configResponse = await fetch('./config/genesis-levels.json');
    if (!configResponse.ok) throw new Error('Failed to load genesis configuration');
    const genesisConfig = await configResponse.json();

    // 2. Initialize Infrastructure
    const container = DIContainer.factory({ Utils: Utils.factory() });

    // Get genesis level from localStorage (set by boot UI)
    const genesisLevel = localStorage.getItem('REPLOID_GENESIS_LEVEL') || genesisConfig.default;
    const levelConfig = genesisConfig.levels[genesisLevel];

    if (!levelConfig) {
      throw new Error(`Unknown genesis level: ${genesisLevel}`);
    }

    logger.info(`[Boot] Genesis level: ${levelConfig.name}`);

    // Module registry mapping names to imports
    const moduleRegistry = {
      Utils, EventBus, RateLimiter, VFS, StateHelpersPure, AuditLogger,
      StateManager, LLMClient, TransformersClient, ResponseParser, ContextManager, VerificationManager,
      ToolWriter, MetaToolWriter, ToolRunner, PersonaManager, ReflectionStore,
      ReflectionAnalyzer, AgentLoop, SubstrateLoader, PerformanceMonitor, SelfTester
    };

    // Register modules based on genesis level config
    const registerModules = (moduleNames, category) => {
      for (const name of moduleNames) {
        if (moduleRegistry[name]) {
          container.register(moduleRegistry[name]);
        } else {
          logger.warn(`[Boot] Module not found in registry: ${name}`);
        }
      }
      logger.info(`[Boot] Registered ${moduleNames.length} ${category} modules`);
    };

    // Register all module categories from config
    registerModules(levelConfig.modules.foundation, 'foundation');
    registerModules(levelConfig.modules.storage, 'storage');
    registerModules(levelConfig.modules.services, 'services');
    registerModules(levelConfig.modules.tools, 'tools');
    registerModules(levelConfig.modules.agent, 'agent');

    // Register capabilities (varies by genesis level)
    if (levelConfig.modules.capabilities.length > 0) {
      registerModules(levelConfig.modules.capabilities, 'capabilities');
    } else {
      logger.info('[Boot] No additional capabilities for this genesis level');
    }

    // 3. Boot Sequence
    logger.info('[Boot] Resolving dependencies...');

    // Force resolution of critical services to trigger their init()
    const vfs = await container.resolve('VFS');

    const seedCodeIntel = async () => {
      const toolPath = '/tools/code_intel.js';
      if (await vfs.exists(toolPath)) return;

      logger.info('[Boot] Seeding code_intel tool...');
      try {
        const toolResp = await fetch('./tools/code_intel.js');
        if (!toolResp.ok) {
          logger.warn('[Boot] code_intel.js not found on server, skipping seed.');
          return;
        }
        const toolCode = await toolResp.text();
        await vfs.write(toolPath, toolCode);
        logger.info('[Boot] Seeding complete: code_intel.js');
      } catch (e) {
        logger.error('[Boot] Failed to seed code_intel', e);
      }
    };

    await seedCodeIntel();
    await seedWorkspaceFiles(vfs, genesisConfig);

    await container.resolve('StateManager');
    await container.resolve('ToolRunner');

    const agent = await container.resolve('AgentLoop');

    // Expose global for debugging (and for dynamic tools to access system)
    window.REPLOID = {
      container,
      agent,
      utils: Utils.factory(),
      vfs: await container.resolve('VFS')
    };

    logger.info('[Boot] Core System Ready.');

    // Notify UI that genesis level is loaded
    if (window.onGenesisLevelLoaded) {
      window.onGenesisLevelLoaded();
    }

    // 4. UI Initialization - wait for user to click Awaken
    const awakenBtn = document.getElementById('awaken-btn');
    if (awakenBtn) {
      // Enable the button now that system is ready
      awakenBtn.disabled = false;
      awakenBtn.textContent = 'Awaken Agent';

      awakenBtn.addEventListener('click', async () => {
        try {
          // Save goal from boot screen
          const goalInput = document.getElementById('goal-input');
          const goal = goalInput?.value?.trim() || '';
          if (goal) {
            localStorage.setItem('REPLOID_GOAL', goal);
          }

          const { default: Dashboard } = await import('./ui/dashboard.js');
          const dashboard = Dashboard.factory({
            Utils: Utils.factory(),
            EventBus: await container.resolve('EventBus'),
            AgentLoop: agent,
            StateManager: await container.resolve('StateManager')
          });

          // Remove boot screen before mounting dashboard
          const bootContainer = document.getElementById('boot-container');
          if (bootContainer) {
            bootContainer.remove();
          }

          dashboard.mount(document.getElementById('app'));

          // Pass VFS to dashboard for browser
          dashboard.setVFS(vfs);

          // Wire up refresh button
          const refreshBtn = document.getElementById('vfs-refresh');
          if (refreshBtn) {
            refreshBtn.onclick = () => dashboard.refreshVFS();
          }

          logger.info('[Boot] UI Mounted.');

          // Auto-start the agent if goal is set
          if (goal) {
            // Get model config from localStorage
            const savedModels = localStorage.getItem('SELECTED_MODELS');
            if (savedModels) {
              const models = JSON.parse(savedModels);
              if (models.length > 0) {
                agent.setModel(models[0]);
              }
            }

            logger.info('[Boot] Starting agent with goal: ' + goal);
            agent.run(goal).catch(e => {
              logger.error('[Boot] Agent error: ' + e.message);
            });
          }
        } catch (e) {
          logger.error('[Boot] UI failed to load', {
            message: e.message,
            stack: e.stack
          });
        }
      });
    } else {
      // Headless mode - no awaken button
      logger.warn('[Boot] Running in headless mode (no awaken button)');
    }

  } catch (err) {
    const logger = Utils.factory().logger;
    logger.error('[Boot] CRITICAL BOOT FAILURE', err);
    document.body.innerHTML = `<div style="color:red; padding:20px;">
      <h1>System Crash</h1>
      <pre>${err.stack || err.message}</pre>
    </div>`;
  }
})();

async function seedWorkspaceFiles(vfs, genesisConfig) {
  try {
    const logger = Utils.factory().logger;
    const filesToSeed = new Set(Object.values(genesisConfig?.moduleImports || {}));
    filesToSeed.add('./boot.js');
    filesToSeed.add('./index.html');
    filesToSeed.add('./tools/code_intel.js');

    for (const file of filesToSeed) {
      const webPath = toWebPath(file);
      const vfsPath = webPath.replace(/^\.\//, '/');
      const needsHydration = await shouldHydrateFile(vfs, vfsPath);
      if (!needsHydration) continue;

      try {
        const resp = await fetch(webPath);
        if (!resp.ok) {
          logger.warn(`[Boot] Failed to fetch ${webPath} (${resp.status})`);
          continue;
        }
        const contents = await resp.text();
        await vfs.write(vfsPath, contents);
        logger.info(`[Boot] Hydrated ${vfsPath}`);
      } catch (err) {
        logger.warn(`[Boot] Failed to hydrate ${webPath}`, err);
      }
    }

    // Helper ensures VFS path is considered
    function toWebPath(path) {
      if (path.startsWith('./')) return path;
      if (path.startsWith('/')) return `.${path}`;
      return `./${path}`;
    }

    async function shouldHydrateFile(vfs, path) {
      if (!(await vfs.exists(path))) return true;
      if (path !== '/tools/code_intel.js') return false;
      try {
        const code = await vfs.read(path);
        return code.includes('import { z');
      } catch {
        return true;
      }
    }
  } catch (err) {
    const logger = Utils.factory().logger;
    logger.warn('[Boot] Workspace hydration skipped', err);
  }
}
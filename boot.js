/**
 * @fileoverview REPLOID Bootstrapper
 * Initializes the Dependency Injection container and starts the agent.
 */

import Utils from './core/utils.js';
import DIContainer from './infrastructure/di-container.js';
import EventBus from './infrastructure/event-bus.js';
import AuditLogger from './infrastructure/audit-logger.js';
import RateLimiter from './infrastructure/rate-limiter.js';
import CircuitBreaker from './infrastructure/circuit-breaker.js';
import StreamParser from './infrastructure/stream-parser.js';
import IndexedDBHelper from './infrastructure/indexed-db-helper.js';
import HITLController from './infrastructure/hitl-controller.js';
import GenesisSnapshot from './infrastructure/genesis-snapshot.js';
import Observability from './infrastructure/observability.js';
import VFSHMR from './infrastructure/vfs-hmr.js';

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

import AgentLoop from './core/agent-loop.js';
import PersonaManager from './core/persona-manager.js';

// Capabilities moved to their own directories
import SubstrateLoader from './capabilities/system/substrate-loader.js';
import ReflectionStore from './capabilities/reflection/reflection-store.js';
import ReflectionAnalyzer from './capabilities/reflection/reflection-analyzer.js';
import PerformanceMonitor from './capabilities/performance/performance-monitor.js';
import SelfTester from './capabilities/testing/self-tester.js';

// Arena testing modules
import { VFSSandbox, ArenaCompetitor, ArenaMetrics, ArenaHarness } from './testing/arena/index.js';

// Cognition modules
import EmbeddingStore from './capabilities/cognition/semantic/embedding-store.js';
import SemanticMemory from './capabilities/cognition/semantic/semantic-memory.js';
import KnowledgeGraph from './capabilities/cognition/symbolic/knowledge-graph.js';
import RuleEngine from './capabilities/cognition/symbolic/rule-engine.js';
import SymbolGrounder from './capabilities/cognition/symbolic/symbol-grounder.js';
import CognitionAPI from './capabilities/cognition/cognition-api.js';
import MultiModelCoordinator from './capabilities/intelligence/multi-model-coordinator.js';

// Boot UI (model config, provider detection)
import { initModelConfig } from './ui/boot/model-config/index.js';
import GoalHistory from './ui/goal-history.js';

// UI Imports (Dynamic to allow headless boot)
// import Proto from './ui/proto.js';


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
    let genesisLevel = localStorage.getItem('REPLOID_GENESIS_LEVEL') || genesisConfig.default;
    let levelConfig = genesisConfig.levels[genesisLevel];

    // Fallback to default if selected level doesn't exist
    if (!levelConfig) {
      logger.warn(`[Boot] Unknown genesis level: ${genesisLevel}, falling back to ${genesisConfig.default}`);
      genesisLevel = genesisConfig.default;
      levelConfig = genesisConfig.levels[genesisLevel];
      localStorage.setItem('REPLOID_GENESIS_LEVEL', genesisLevel);
    }

    logger.info(`[Boot] Genesis level: ${levelConfig.name}`);

    // Conditionally load Transformers.js for FULL SUBSTRATE (semantic capabilities)
    if (genesisLevel === 'full' || levelConfig.modules.capabilities.includes('SemanticMemory')) {
      logger.info('[Boot] Loading Transformers.js for semantic capabilities...');
      try {
        const { pipeline, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
        env.backends.onnx.wasm.proxy = false;
        window.transformers = { pipeline, env };
        logger.info('[Boot] Transformers.js loaded');
      } catch (e) {
        logger.warn('[Boot] Failed to load Transformers.js:', e.message);
      }
    } else {
      logger.info('[Boot] Skipping Transformers.js (not needed for this genesis level)');
    }

    // Module registry mapping names to imports
    const moduleRegistry = {
      Utils, EventBus, RateLimiter, AuditLogger,
      CircuitBreaker, StreamParser, IndexedDBHelper, HITLController, GenesisSnapshot, Observability,
      VFS, VFSHMR, StateHelpersPure, StateManager,
      LLMClient, TransformersClient, ResponseParser, ContextManager, VerificationManager,
      ToolWriter, ToolRunner, PersonaManager, ReflectionStore,
      ReflectionAnalyzer, AgentLoop, SubstrateLoader, PerformanceMonitor, SelfTester,
      EmbeddingStore, SemanticMemory, KnowledgeGraph, RuleEngine, SymbolGrounder, CognitionAPI, MultiModelCoordinator,
      VFSSandbox, ArenaCompetitor, ArenaMetrics, ArenaHarness
    };

    // Register modules based on genesis level config
    const registerModules = (moduleNames, category) => {
      for (const name of moduleNames) {
        if (moduleRegistry[name]) {
          try {
            const module = moduleRegistry[name];
            // Validate module has metadata before registering
            if (!module || !module.metadata || !module.metadata.id) {
              logger.error(`[Boot] Invalid module structure for ${name}: missing metadata.id`);
              logger.warn(`[Boot] Skipping invalid module: ${name}`);
              continue;
            }
            container.register(module);
          } catch (e) {
            logger.error(`[Boot] Failed to register ${name}: ${e.message}`);
            logger.error(`[Boot] Module structure:`, moduleRegistry[name]?.metadata);
            throw new Error(`Module registration failed for ${name}: ${e.message}`);
          }
        } else {
          logger.warn(`[Boot] Module not found in registry: ${name}`);
        }
      }
      logger.info(`[Boot] Registered ${category} modules`);
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

    // Register testing modules (arena, etc.)
    if (levelConfig.modules.testing) {
      registerModules(levelConfig.modules.testing, 'testing');
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

    // Create genesis snapshot AFTER full VFS hydration
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

    // Export function for downloading full REPLOID state
    window.downloadREPLOID = async (filename = 'reploid-export.json') => {
      const stateManager = await container.resolve('StateManager');
      const vfs = await container.resolve('VFS');

      // Get all VFS files
      const vfsFiles = {};
      const allPaths = await vfs.list('/');

      const collectFiles = async (paths) => {
        for (const path of paths) {
          try {
            const stat = await vfs.stat(path);
            if (stat.isDirectory) {
              const subPaths = await vfs.list(path);
              await collectFiles(subPaths);
            } else {
              vfsFiles[path] = await vfs.read(path);
            }
          } catch (e) {
            logger.warn(`[Export] Failed to read ${path}:`, e.message);
          }
        }
      };
      await collectFiles(allPaths);

      // Get state
      const state = stateManager.getState();

      // Collect recent agent log entries if available
      let activityLog = [];
      try {
        if (window.REPLOID?.agent?.getRecentActivities) {
          activityLog = await window.REPLOID.agent.getRecentActivities();
        }
      } catch (e) {
        logger.warn('[Export] Unable to load activity log', e.message);
      }

      // Collect conversation context (what LLM sees after compaction)
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

      // Build export object
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

      // Download as JSON
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      logger.info(`[Export] Downloaded ${filename} with ${Object.keys(vfsFiles).length} files, ${conversationContext.length} context messages`);
    };

    logger.info('[Boot] Core System Ready.');

    // Notify UI that genesis level is loaded
    if (window.onGenesisLevelLoaded) {
      window.onGenesisLevelLoaded();
    }

    // 4. UI Initialization - wait for user to click Awaken
    const awakenBtn = document.getElementById('awaken-btn');
    const goalInput = document.getElementById('goal-input');

    // Initialize goal history dropdown
    if (goalInput) {
      GoalHistory.initDropdown(goalInput, (selectedGoal) => {
        goalInput.value = selectedGoal;
      });
    }

    if (awakenBtn) {
      // Enable the button now that system is ready
      awakenBtn.disabled = false;
      awakenBtn.textContent = 'Awaken Agent';

      awakenBtn.addEventListener('click', async () => {
        try {
          // Save goal from boot screen
          const goal = goalInput?.value?.trim() || '';
          if (goal) {
            localStorage.setItem('REPLOID_GOAL', goal);
            // Add to goal history
            GoalHistory.add(goal);
          }

          const { default: Proto } = await import('./ui/proto.js');
          const proto = Proto.factory({
            Utils: Utils.factory(),
            EventBus: await container.resolve('EventBus'),
            AgentLoop: agent,
            StateManager: await container.resolve('StateManager')
          });

          // Remove boot screen and crosshair before mounting dashboard
          const bootContainer = document.getElementById('boot-container');
          if (bootContainer) {
            bootContainer.remove();
          }

          // Remove crosshair lines
          ['tl', 'tr', 'bl', 'br'].forEach(corner => {
            const line = document.getElementById(`reticle-${corner}`);
            if (line) line.remove();
          });

          // Remove grid pattern overlay
          document.body.classList.add('no-grid-pattern');

          const appEl = document.getElementById('app');
          appEl.classList.add('active');
          proto.mount(appEl);

          // Pass VFS to proto for browser
          proto.setVFS(vfs);

          // Wire up refresh button
          const refreshBtn = document.getElementById('vfs-refresh');
          if (refreshBtn) {
            refreshBtn.onclick = () => proto.refreshVFS();
          }

          logger.info('[Boot] UI Mounted.');

          // CLI tools are now available as agent tool calls (no separate UI mode needed)

          // Auto-start the agent if goal is set
          if (goal) {
            // Get model config from localStorage
            const savedModels = localStorage.getItem('SELECTED_MODELS');
            const consensusStrategy = localStorage.getItem('CONSENSUS_TYPE') || 'arena';

            if (savedModels) {
              const models = JSON.parse(savedModels);
              if (models.length > 0) {
                // Set all models for multi-model support
                agent.setModels(models);
                agent.setConsensusStrategy(consensusStrategy);

                logger.info(`[Boot] Configured ${models.length} model(s), consensus: ${consensusStrategy}`);
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

    logger.info('[Boot] Beginning full VFS hydration (self-hosting mode)...');

    // Seed ALL module imports (core, infrastructure, capabilities, testing)
    const filesToSeed = new Set(Object.values(genesisConfig?.moduleImports || {}));

    // NOTE: Entry points (boot.js, index.html, sw-module-loader.js) should NOT be in VFS
    // They must be served from network to enable proper genesis snapshots
    // Config files also load from network (not VFS) to allow runtime reconfiguration

    // Add ALL tools
    filesToSeed.add('./tools/code_intel.js');
    const fileTools = [
      'search_content', 'find_by_name', 'git',
      'create_directory', 'remove', 'move', 'copy'
    ];
    fileTools.forEach(tool => filesToSeed.add(`./tools/${tool}.js`));

    // Add runtime UI (agent's interface to operator)
    filesToSeed.add('./ui/proto.js');

    // NOTE: Boot screen UI (model-config, goal-history) loads from network, not VFS
    // These are pre-agent bootstrap interfaces, not runtime agent UI
    // NOTE: Styles (theme.css, boot.css, proto.css) load from network, not VFS
    // These are static CSS assets that should not be in genesis snapshots
    // NOTE: Config files (genesis-levels.json) load from network, not VFS
    // This allows runtime reconfiguration without VFS snapshots

    logger.info(`[Boot] Hydrating ${filesToSeed.size} files into VFS...`);

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

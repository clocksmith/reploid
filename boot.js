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
import WorkerManager from './core/worker-manager.js';

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

  // Iframe child mode detection - auto-awaken with goal from parent
  const isIframeChild = window.parent !== window;
  let pendingParentGoal = null;
  let systemReadyCallback = null;

  if (isIframeChild) {
    logger.info('[Boot] Running as iframe child, setting up parent communication');

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'PARENT_GOAL') {
        pendingParentGoal = event.data.goal;
        logger.info('[Boot] Received goal from parent:', pendingParentGoal?.slice(0, 50));

        // If system already ready, trigger awaken immediately
        if (systemReadyCallback) {
          systemReadyCallback();
        }
      }
    });

    // Notify parent we're ready - use same origin or '*' for localhost dev
    const targetOrigin = window.location.origin || '*';
    window.parent.postMessage({ type: 'CHILD_READY' }, targetOrigin);
  }

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
    const validLevels = Object.keys(genesisConfig.levels || {});
    const defaultLevel = genesisConfig.defaultLevel || validLevels[0] || 'tabula';
    let genesisLevel = localStorage.getItem('REPLOID_GENESIS_LEVEL');

    // Validate and fallback
    if (!genesisLevel || !validLevels.includes(genesisLevel)) {
      if (genesisLevel) logger.warn(`[Boot] Unknown genesis level: ${genesisLevel}, falling back to ${defaultLevel}`);
      genesisLevel = defaultLevel;
      localStorage.setItem('REPLOID_GENESIS_LEVEL', genesisLevel);
    }

    // Resolve extends chain to get full module list
    const resolveLevel = (levelName, visited = new Set()) => {
      if (visited.has(levelName)) {
        throw new Error(`Circular extends detected: ${[...visited, levelName].join(' -> ')}`);
      }
      visited.add(levelName);

      const level = genesisConfig.levels[levelName];
      if (!level) return [];

      const parentModules = level.extends ? resolveLevel(level.extends, visited) : [];
      return [...parentModules, ...level.modules];
    };

    let levelConfig = genesisConfig.levels[genesisLevel];
    if (!levelConfig) {
      throw new Error(`Genesis level "${genesisLevel}" not found in config. Available: ${validLevels.join(', ')}`);
    }

    // Resolve full module list (including inherited modules)
    const resolvedModules = resolveLevel(genesisLevel);
    logger.info(`[Boot] Genesis level: ${levelConfig.name} (${resolvedModules.length} modules)`);

    // Conditionally load Transformers.js for FULL SUBSTRATE (semantic capabilities)
    if (genesisLevel === 'full' || resolvedModules.includes('SemanticMemory')) {
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
      VFSSandbox, ArenaCompetitor, ArenaMetrics, ArenaHarness,
      WorkerManager
    };

    // Register all modules from resolved list (includes inherited)
    logger.info(`[Boot] Registering ${resolvedModules.length} modules...`);
    for (const moduleName of resolvedModules) {
      if (moduleRegistry[moduleName]) {
        container.register(moduleRegistry[moduleName]);
      } else {
        logger.warn(`[Boot] Module "${moduleName}" not found in registry`);
      }
    }
    logger.info('[Boot] Module registration complete');

    // 3. Boot Sequence
    logger.info('[Boot] Resolving dependencies...');

    // Force resolution of critical services to trigger their init()
    const vfs = await container.resolve('VFS');

    // Check if session reset was requested (default: true if not set)
    const resetSetting = localStorage.getItem('REPLOID_RESET_VFS');
    const shouldResetVFS = resetSetting === null || resetSetting === 'true';
    if (shouldResetVFS) {
      logger.info('[Boot] Session reset requested - clearing session artifacts...');
      try {
        // Core tools that should NOT be deleted (part of genesis)
        const coreTools = new Set([
          'AwaitWorkers', 'Cat', 'Cp', 'CreateTool', 'DeleteFile', 'Edit',
          'FileOutline', 'Find', 'Git', 'Grep', 'Head', 'Jq', 'ListFiles',
          'ListKnowledge', 'ListMemories', 'ListTools', 'ListWorkers',
          'LoadModule', 'Ls', 'Mkdir', 'Mv', 'Pwd', 'ReadFile', 'Rm', 'Sed',
          'SpawnWorker', 'Tail', 'Touch', 'WriteFile'
        ]);

        // Clear non-core tools
        const allFiles = await vfs.list('/tools/');
        for (const file of allFiles) {
          const toolName = file.replace('/tools/', '').replace('.js', '');
          if (!coreTools.has(toolName)) {
            await vfs.delete(file);
            logger.info(`[Boot] Deleted session artifact: ${file}`);
          }
        }

        // Clear session UI files (except core UI components)
        const coreUIFiles = new Set([
          'proto.js', 'toast.js', 'command-palette.js'
        ]);
        const uiFiles = await vfs.list('/ui/');
        for (const file of uiFiles) {
          const fileName = file.split('/').pop();
          // Only delete files directly in /ui/, not subdirectories
          if (!file.includes('/ui/components/') &&
              !file.includes('/ui/dashboard/') &&
              !file.includes('/ui/panels/') &&
              !file.includes('/ui/boot/') &&
              !coreUIFiles.has(fileName)) {
            await vfs.delete(file);
            logger.info(`[Boot] Deleted session artifact: ${file}`);
          }
        }

        // Clear agent-created capabilities (files directly in /capabilities/, not in subdirs)
        const capFiles = await vfs.list('/capabilities/');
        for (const file of capFiles) {
          // Core capabilities are in subdirectories (cognition/, reflection/, system/, etc.)
          // Agent-created go directly in /capabilities/
          if (file.match(/^\/capabilities\/[^/]+\.js$/)) {
            await vfs.delete(file);
            logger.info(`[Boot] Deleted session artifact: ${file}`);
          }
        }

        // Clear agent-created styles (non-core CSS files)
        const coreStyles = new Set(['theme.css', 'proto.css', 'boot.css', 'vfs-explorer.css']);
        const styleFiles = await vfs.list('/styles/');
        for (const file of styleFiles) {
          const fileName = file.split('/').pop();
          if (!coreStyles.has(fileName)) {
            await vfs.delete(file);
            logger.info(`[Boot] Deleted session artifact: ${file}`);
          }
        }

        logger.info('[Boot] Session reset complete');
        // Clear the flag after reset (one-time action)
        localStorage.setItem('REPLOID_RESET_VFS', 'false');
      } catch (e) {
        logger.warn('[Boot] Session reset failed:', e.message);
      }
    }

    const seedCodeIntel = async () => {
      const toolPath = '/tools/FileOutline.js';
      if (await vfs.exists(toolPath)) return;

      logger.info('[Boot] Seeding FileOutline tool...');
      try {
        const toolResp = await fetch('./tools/FileOutline.js');
        if (!toolResp.ok) {
          logger.warn('[Boot] FileOutline.js not found on server, skipping seed.');
          return;
        }
        const toolCode = await toolResp.text();
        await vfs.write(toolPath, toolCode);
        logger.info('[Boot] Seeding complete: FileOutline.js');
      } catch (e) {
        logger.error('[Boot] Failed to seed FileOutline', e);
      }
    };

    await seedCodeIntel();
    await seedWorkspaceFiles(vfs, genesisConfig, resolvedModules);

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
      vfs: await container.resolve('VFS'),
      // Pre-resolve commonly needed modules for sync access by tools
      transformersClient: await container.resolve('TransformersClient').catch(() => null),
      llmClient: await container.resolve('LLMClient'),
      toolRunner: await container.resolve('ToolRunner')
    };

    // Expose DI helper for sync module access (convenience wrapper)
    window.REPLOID_DI = {
      get: (name) => window.REPLOID[name.charAt(0).toLowerCase() + name.slice(1)] || null,
      resolve: (name) => container.resolve(name)
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

    // Awaken function - can be triggered by button click or iframe message
    const triggerAwaken = async (overrideGoal) => {
      try {
        // Use override goal (from parent iframe) or get from input
        const goal = overrideGoal || goalInput?.value?.trim() || '';
        if (goal) {
          localStorage.setItem('REPLOID_GOAL', goal);
          // Add to goal history (skip for iframe children)
          if (!isIframeChild) {
            GoalHistory.add(goal);
          }
        }

        const { default: Proto } = await import('./ui/proto.js');

        let workerManager = null;
        try {
          workerManager = await container.resolve('WorkerManager');
        } catch (e) {
          logger.debug('[Boot] WorkerManager not available:', e.message);
        }

        const proto = Proto.factory({
          Utils: Utils.factory(),
          EventBus: await container.resolve('EventBus'),
          AgentLoop: agent,
          StateManager: await container.resolve('StateManager'),
          WorkerManager: workerManager
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

              // Initialize WorkerManager with model config (FULL SUBSTRATE only)
              if (workerManager) {
                try {
                  await workerManager.init(genesisConfig);
                  workerManager.setModelConfig(models[0]);
                  logger.info('[Boot] WorkerManager initialized with model config');
                } catch (e) {
                  logger.warn('[Boot] WorkerManager init failed:', e.message);
                }
              }
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
    };

    if (awakenBtn) {
      // Enable the button now that system is ready
      awakenBtn.disabled = false;
      awakenBtn.textContent = 'Awaken Agent';

      awakenBtn.addEventListener('click', () => triggerAwaken());

      // Iframe child mode: auto-awaken when goal received from parent
      if (isIframeChild) {
        systemReadyCallback = () => {
          if (pendingParentGoal) {
            logger.info('[Boot] Auto-awakening as iframe child with parent goal');
            triggerAwaken(pendingParentGoal);
          }
        };

        // If goal already received before system ready, trigger now
        if (pendingParentGoal) {
          systemReadyCallback();
        }
      }
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

async function seedWorkspaceFiles(vfs, genesisConfig, resolvedModules) {
  const logger = Utils.factory().logger;

  try {
    logger.info('[Boot] Beginning full VFS hydration (self-hosting mode)...');

    // Build file list based on resolved modules + shared files
    const filesToSeed = new Set();
    const moduleFiles = genesisConfig?.moduleFiles || {};
    const sharedFiles = genesisConfig?.sharedFiles || {};

    // 1. Add files for each resolved module
    for (const moduleName of resolvedModules) {
      const files = moduleFiles[moduleName];
      if (files) {
        for (const file of files) {
          filesToSeed.add(file);
        }
      }
    }

    // 2. Add shared files (tools, ui, styles - always needed)
    for (const category of Object.keys(sharedFiles)) {
      for (const file of sharedFiles[category]) {
        filesToSeed.add(file);
      }
    }

    // NOTE: Entry points (boot.js, index.html, sw-module-loader.js) should NOT be in VFS
    // They must be served from network to enable proper genesis snapshots
    // Config files also load from network (not VFS) to allow runtime reconfiguration

    logger.info(`[Boot] Hydrating ${filesToSeed.size} files for ${resolvedModules.length} modules...`);

    for (const file of filesToSeed) {
      const webPath = file.startsWith('./') ? file : `./${file}`;
      const vfsPath = '/' + file.replace(/^\.\//, '');

      // Skip if already exists (unless it's FileOutline which may need updating)
      const exists = await vfs.exists(vfsPath);
      if (exists && vfsPath !== '/tools/FileOutline.js') continue;

      // Check if FileOutline needs updating (old version had zod import)
      if (exists && vfsPath === '/tools/FileOutline.js') {
        try {
          const code = await vfs.read(vfsPath);
          if (!code.includes('import { z')) continue;
        } catch { /* proceed with hydration */ }
      }

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
  } catch (err) {
    logger.warn('[Boot] Workspace hydration skipped', err);
  }
}

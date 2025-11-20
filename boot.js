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
import ResponseParser from './core/response-parser.js';
import ContextManager from './core/context-manager.js';
import VerificationManager from './core/verification-manager.js';

import ToolRunner from './core/tool-runner.js';
import ToolWriter from './core/tool-writer.js';
import MetaToolWriter from './core/meta-tool-writer.js';

import AgentLoop from './core/agent-loop.js';
import PersonaManager from './core/persona-manager.js';
import SubstrateLoader from './core/substrate-loader.js';

import ReflectionStore from './capabilities/reflection/reflection-store.js';
import PerformanceMonitor from './capabilities/performance/performance-monitor.js';
import SelfTester from './capabilities/testing/self-tester.js';

// UI Imports (Dynamic to allow headless boot)
// import Dashboard from './ui/dashboard.js';

(async () => {
  const logger = Utils.factory().logger;
  logger.info('[Boot] Starting REPLOID System...');

  try {
    // 1. Initialize Infrastructure
    const container = DIContainer.factory({ Utils: Utils.factory() });

    // Register Foundation & Infra
    container.register(Utils);
    container.register(EventBus);
    container.register(RateLimiter);

    // Register Storage
    container.register(VFS);
    container.register(StateHelpersPure);

    // We need to resolve VFS before registering AuditLogger/StateManager if they init immediately
    // But our DI handles lazy factory resolution, so we can register order-independent.
    container.register(AuditLogger);
    container.register(StateManager);

    // Register Core Services
    container.register(LLMClient);
    container.register(ResponseParser);
    container.register(ContextManager);
    container.register(VerificationManager);

    // Register Tool System
    container.register(ToolWriter);
    container.register(MetaToolWriter);
    container.register(ToolRunner); // Depends on Writers

    // Register Agent Core
    container.register(PersonaManager);
    container.register(SubstrateLoader);
    container.register(AgentLoop);

    // Register Capabilities
    container.register(ReflectionStore);
    container.register(PerformanceMonitor);
    container.register(SelfTester);

    // 2. Boot Sequence
    logger.info('[Boot] Resolving dependencies...');

    // Force resolution of critical services to trigger their init()
    await container.resolve('VFS');
    await container.resolve('StateManager');
    await container.resolve('ToolRunner'); // Loads tools

    const agent = await container.resolve('AgentLoop');

    // Expose global for debugging (and for dynamic tools to access system)
    window.REPLOID = {
      container,
      agent,
      utils: Utils.factory(),
      vfs: await container.resolve('VFS')
    };

    logger.info('[Boot] Core System Ready.');

    // 3. UI Initialization
    try {
      const { default: Dashboard } = await import('./ui/dashboard.js');
      const dashboard = Dashboard.factory({
        Utils: Utils.factory(),
        EventBus: await container.resolve('EventBus'),
        AgentLoop: agent,
        StateManager: await container.resolve('StateManager')
      });
      dashboard.mount(document.getElementById('app'));
      logger.info('[Boot] UI Mounted.');
    } catch (e) {
      logger.warn('[Boot] UI failed to load (running headless?)', e);
    }

  } catch (err) {
    console.error('CRITICAL BOOT FAILURE:', err);
    document.body.innerHTML = `<div style="color:red; padding:20px;">
      <h1>System Crash</h1>
      <pre>${err.stack}</pre>
    </div>`;
  }
})();

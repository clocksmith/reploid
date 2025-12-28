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

// === UI (Boot interface) ===
import { initModelConfig } from './ui/boot/model-config/index.js';
import GoalHistory from './ui/goal-history.js';

// === MODULAR BOOT ===
import { boot, setupAwaken, renderErrorUI } from './boot/index.js';

(async () => {
  try {
    // Run main boot sequence
    const bootResult = await boot(Utils, DIContainer, initModelConfig, GoalHistory);

    // Setup UI awakening
    setupAwaken(bootResult, Utils, GoalHistory);

  } catch (err) {
    // Render safe mode error UI
    console.error('[Boot] CRITICAL BOOT FAILURE', err);
    renderErrorUI(err);
  }
})();

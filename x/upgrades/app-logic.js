// REPLOID Core Logic Module - Using Standardized Module Loader
// This module orchestrates the initialization of all agent components

const CoreLogicModule = async (initialConfig, vfs) => {
  console.log("[CoreLogic] Starting agent initialization");
  
  try {
    // Check if module loader is available
    const hasModuleLoader = await vfs.read("/modules/boot-module-loader.js");
    
    if (hasModuleLoader) {
      // Use new standardized module loader
      console.log("[CoreLogic] Using standardized module loader");
      await initializeWithModuleLoader(initialConfig, vfs);
    } else {
      // Fallback to legacy initialization
      console.log("[CoreLogic] Falling back to legacy module loading");
      await initializeLegacy(initialConfig, vfs);
    }
  } catch (e) {
    handleInitializationError(e);
  }
};

// Initialize using the new module loader system
async function initializeWithModuleLoader(initialConfig, vfs) {
  // Load the module loader
  const loaderCode = await vfs.read("/modules/boot-module-loader.js");
  const ModuleLoader = new Function(loaderCode + "\nreturn ModuleLoader;")();
  
  // Initialize the loader
  ModuleLoader.init(vfs, initialConfig);
  
  // Check for manifest
  let manifest;
  const manifestContent = await vfs.read("/modules/module-manifest.json");
  
  if (manifestContent) {
    manifest = JSON.parse(manifestContent);
    console.log("[CoreLogic] Loading modules from manifest");
  } else {
    // Create default manifest if missing
    console.log("[CoreLogic] No manifest found, using default module list");
    manifest = createDefaultManifest();
  }
  
  // Load all modules according to manifest
  await ModuleLoader.loadFromManifest(manifest);
  
  // Instantiate all modules in dependency order
  await ModuleLoader.instantiateAll();
  
  // Get critical modules for final initialization
  const StateManager = await ModuleLoader.getModule("StateManager");
  const UI = await ModuleLoader.getModule("UI");
  const CycleLogic = await ModuleLoader.getModule("CycleLogic");
  
  // Initialize state if needed
  if (StateManager && StateManager.init) {
    await StateManager.init();
  }
  
  // Initialize UI with dependencies
  if (UI && UI.init) {
    await UI.init(StateManager, CycleLogic);
  }
  
  console.log("[CoreLogic] Agent initialization complete");
  
  // Hide boot container and show app
  const bootContainer = document.getElementById("boot-container");
  const appRoot = document.getElementById("app-root");
  if (bootContainer) bootContainer.style.display = "none";
  if (appRoot) appRoot.style.display = "block";
}

// Legacy initialization (backward compatibility)
async function initializeLegacy(initialConfig, vfs) {
  let Utils, Storage, StateManager, ApiClient, CycleLogic, ToolRunner, UI;
  let Errors, AgentLogicPureHelpers, StateHelpersPure, ToolRunnerPureHelpers;
  let logger;
  
  // Level 0: Pure modules
  const utilsContent = await vfs.read("/modules/utils.js");
  Utils = new Function(utilsContent + "\nreturn UtilsModule;")();
  logger = Utils.logger;
  Errors = Utils.Errors;
  
  const alpContent = await vfs.read("/modules/agent-logic-pure.js");
  AgentLogicPureHelpers = new Function(alpContent + "\nreturn AgentLogicPureHelpersModule;")();
  
  const shpContent = await vfs.read("/modules/state-helpers-pure.js");
  StateHelpersPure = new Function(shpContent + "\nreturn StateHelpersPureModule;")();
  
  const trhContent = await vfs.read("/modules/tool-runner-pure-helpers.js");
  ToolRunnerPureHelpers = new Function(trhContent + "\nreturn ToolRunnerPureHelpersModule;")();
  
  logger.logEvent("info", "Orchestrator: Pure modules loaded.");
  
  // Level 1: Core services
  const storageContent = await vfs.read("/modules/storage-indexeddb.js");
  Storage = new Function(
    "config", "logger", "Errors",
    storageContent + "\nreturn StorageModule(config, logger, Errors);"
  )(initialConfig, logger, Errors);
  
  const smContent = await vfs.read("/modules/state-manager.js");
  StateManager = new Function(
    "config", "logger", "Storage", "Errors", "StateHelpersPure", "Utils",
    smContent + "\nreturn StateManagerModule(config, logger, Storage, Errors, StateHelpersPure, Utils);"
  )(initialConfig, logger, Storage, Errors, StateHelpersPure, Utils);
  await StateManager.init();
  
  logger.logEvent("info", "Orchestrator: Storage and StateManager loaded.");
  
  // Level 2: Services with state/storage access
  const apiClientContent = await vfs.read("/modules/api-client.js");
  ApiClient = new Function(
    "config", "logger", "Errors", "Utils", "StateManager",
    apiClientContent + "\nreturn ApiClientModule(config, logger, Errors, Utils, StateManager);"
  )(initialConfig, logger, Errors, Utils, StateManager);
  
  const trContent = await vfs.read("/modules/tool-runner.js");
  ToolRunner = new Function(
    "config", "logger", "Storage", "StateManager", "ApiClient", "Errors", "Utils", "ToolRunnerPureHelpers",
    trContent + "\nreturn ToolRunnerModule(config, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers);"
  )(initialConfig, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers);
  
  logger.logEvent("info", "Orchestrator: ApiClient and ToolRunner loaded.");
  
  // Level 3: UI and Cycle Logic
  const uiContent = await vfs.read("/modules/ui-manager.js");
  UI = new Function(
    "config", "logger", "Utils", "Storage", "StateManager", "Errors",
    uiContent + "\nreturn UIModule(config, logger, Utils, Storage, StateManager, Errors);"
  )(initialConfig, logger, Utils, Storage, StateManager, Errors);
  
  const cycleLogicContent = await vfs.read("/modules/agent-cycle.js");
  CycleLogic = new Function(
    "config", "logger", "Utils", "Storage", "StateManager", "UI", "ApiClient", "ToolRunner", "Errors", "AgentLogicPureHelpers",
    cycleLogicContent + "\nreturn CycleLogicModule(config, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers);"
  )(initialConfig, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers);
  
  logger.logEvent("info", "Orchestrator: UI and CycleLogic loaded.");
  
  // Final initialization
  await UI.init(StateManager, CycleLogic);
  logger.logEvent("info", "Orchestrator: Application initialization complete.");
}

// Create a default manifest if none exists
function createDefaultManifest() {
  return {
    loadGroups: [
      {
        level: 0,
        description: "Pure utilities",
        modules: [
          { id: "Utils", path: "/modules/utils.js" },
          { id: "AgentLogicPureHelpers", path: "/modules/agent-logic-pure.js" },
          { id: "StateHelpersPure", path: "/modules/state-helpers-pure.js" },
          { id: "ToolRunnerPureHelpers", path: "/modules/tool-runner-pure-helpers.js" }
        ]
      },
      {
        level: 1,
        description: "Core services",
        modules: [
          { id: "Storage", path: "/modules/storage-indexeddb.js" },
          { id: "StateManager", path: "/modules/state-manager.js" }
        ]
      },
      {
        level: 2,
        description: "Application services",
        modules: [
          { id: "ApiClient", path: "/modules/api-client.js" },
          { id: "ToolRunner", path: "/modules/tool-runner.js" }
        ]
      },
      {
        level: 3,
        description: "High-level components",
        modules: [
          { id: "UI", path: "/modules/ui-manager.js" },
          { id: "CycleLogic", path: "/modules/agent-cycle.js" }
        ]
      }
    ]
  };
}

// Handle initialization errors
function handleInitializationError(error) {
  console.error("[CoreLogic] Initialization failed:", error);
  
  const appRoot = document.getElementById("app-root");
  if (appRoot) {
    appRoot.style.display = "block";
    appRoot.innerHTML = `
      <div style="color: red; padding: 2em; font-family: monospace;">
        <h1>FATAL ERROR</h1>
        <p>Agent Awakening Failed: ${error.message}</p>
        <pre>${error.stack}</pre>
        <hr>
        <p style="color: #888;">
          This may be due to missing modules or configuration issues.
          Please check the console for more details.
        </p>
      </div>
    `;
  }
}

// Make CoreLogicModule available
CoreLogicModule;
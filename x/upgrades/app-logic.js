// Note: This file is executed by boot.js within a new Function scope.
// 'config' and 'vfs' are passed in as arguments.
const CoreLogicModule = (initialConfig, vfs) => {
  let Utils,
    Storage,
    StateManager,
    ApiClient,
    CycleLogic,
    ToolRunner,
    UI,
    Errors,
    AgentLogicPureHelpers,
    StateHelpersPure,
    ToolRunnerPureHelpers;
  let logger;

  const initializeApplication = async () => {
    try {
      // --- Level 0: Pure code, no dependencies ---
      // The orchestrator must be async-aware from the very beginning.
      const utilsContent = await vfs.read("/modules/utils.js");
      Utils = new Function(utilsContent + "\nreturn UtilsModule;")();
      logger = Utils.logger;
      Errors = Utils.Errors;

      const alpContent = await vfs.read("/modules/agent-logic-pure.js");
      AgentLogicPureHelpers = new Function(
        alpContent + "\nreturn AgentLogicPureHelpersModule;"
      )();

      const shpContent = await vfs.read("/modules/state-helpers-pure.js");
      StateHelpersPure = new Function(
        shpContent + "\nreturn StateHelpersPureModule;"
      )();

      const trhContent = await vfs.read("/modules/tool-runner-pure-helpers.js");
      ToolRunnerPureHelpers = new Function(
        trhContent + "\nreturn ToolRunnerPureHelpersModule;"
      )();

      logger.logEvent("info", "Orchestrator: Pure modules loaded.");

      // --- Level 1: Core services ---
      const storageContent = await vfs.read("/modules/storage-indexeddb.js");
      Storage = new Function(
        "config",
        "logger",
        "Errors",
        storageContent + "\nreturn StorageModule(config, logger, Errors);"
      )(initialConfig, logger, Errors);

      const smContent = await vfs.read("/modules/state-manager.js");
      StateManager = new Function(
        "config",
        "logger",
        "Storage",
        "Errors",
        "StateHelpersPure",
        "Utils",
        smContent +
          "\nreturn StateManagerModule(config, logger, Storage, Errors, StateHelpersPure, Utils);"
      )(initialConfig, logger, Storage, Errors, StateHelpersPure, Utils);
      await StateManager.init(); // Initialize state from VFS (now async)

      logger.logEvent("info", "Orchestrator: Storage and StateManager loaded.");

      // --- Level 2: Services with state/storage access ---
      const apiClientContent = await vfs.read("/modules/api-client.js");
      ApiClient = new Function(
        "config",
        "logger",
        "Errors",
        "Utils",
        "StateManager",
        apiClientContent +
          "\nreturn ApiClientModule(config, logger, Errors, Utils, StateManager);"
      )(initialConfig, logger, Errors, Utils, StateManager);

      const trContent = await vfs.read("/modules/tool-runner.js");
      ToolRunner = new Function(
        "config",
        "logger",
        "Storage",
        "StateManager",
        "ApiClient",
        "Errors",
        "Utils",
        "ToolRunnerPureHelpers",
        trContent +
          "\nreturn ToolRunnerModule(config, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers);"
      )(
        initialConfig,
        logger,
        Storage,
        StateManager,
        ApiClient,
        Errors,
        Utils,
        ToolRunnerPureHelpers
      );

      logger.logEvent("info", "Orchestrator: ApiClient and ToolRunner loaded.");

      // --- Level 3: UI and Cycle Logic ---
      const uiContent = await vfs.read("/modules/ui-manager.js");
      UI = new Function(
        "config",
        "logger",
        "Utils",
        "Storage",
        "StateManager",
        "Errors",
        uiContent +
          "\nreturn UIModule(config, logger, Utils, Storage, StateManager, Errors);"
      )(initialConfig, logger, Utils, Storage, StateManager, Errors);

      const cycleLogicContent = await vfs.read("/modules/agent-cycle.js");
      CycleLogic = new Function(
        "config",
        "logger",
        "Utils",
        "Storage",
        "StateManager",
        "UI",
        "ApiClient",
        "ToolRunner",
        "Errors",
        "AgentLogicPureHelpers",
        cycleLogicContent +
          "\nreturn CycleLogicModule(config, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers);"
      )(
        initialConfig,
        logger,
        Utils,
        Storage,
        StateManager,
        UI,
        ApiClient,
        ToolRunner,
        Errors,
        AgentLogicPureHelpers
      );

      logger.logEvent("info", "Orchestrator: UI and CycleLogic loaded.");

      // --- Final Initialization ---
      await UI.init(StateManager, CycleLogic);
      logger.logEvent(
        "info",
        "Orchestrator: Application initialization complete."
      );
    } catch (e) {
      console.error("Orchestrator: Initialization failed.", e);
      if (logger) {
        logger.logEvent(
          "error",
          `Orchestrator Init Failed: ${e.message}`,
          e.stack
        );
      }
      const appRoot = document.getElementById("app-root");
      if (appRoot) {
        appRoot.style.display = "block";
        appRoot.innerHTML = `<div style="color:red;padding:2em;"><h1>FATAL ERROR</h1><p>Agent Awakening Failed: ${e.message}</p><pre>${e.stack}</pre></div>`;
      }
    }
  };

  initializeApplication();
};
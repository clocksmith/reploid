const CoreLogicModule = (initialConfig, initialUtils, initialStorage) => {
  const loadModule = async (filePath, exportName, dependencies = {}) => {
    const logger = initialUtils?.logger || {
      logEvent: (lvl, msg, det) =>
        console.error(`[ORCHESTRATOR FALLBACK] ${msg}`, det || ""),
    };
    const depNames = Object.keys(dependencies);
    const depValues = Object.values(dependencies);

    if (
      depNames.length !== depValues.length ||
      depValues.some((dep) => dep === undefined || dep === null)
    ) {
      const missing = depNames.filter(
        (name, i) => depValues[i] === undefined || depValues[i] === null
      );
      logger.logEvent(
        "error",
        `Cannot load module ${filePath}: Missing dependencies ${missing.join(
          ", "
        )}`,
        dependencies
      );
      throw new Error(`Dependency error for ${filePath}`);
    }

    try {
      const response = await fetch(
        filePath + `?v=${initialConfig?.STATE_VERSION || Date.now()}`
      );
      if (!response.ok)
        throw new Error(`HTTP ${response.status} for ${filePath}`);
      const scriptContent = await response.text();
      const tempScope = {};
      const funcArgs = ["tempScope", ...depNames];
      const funcBody = `
        ${scriptContent}
        tempScope.result = (typeof ${exportName} !== 'undefined') ? ${exportName} : undefined;
      `;

      const factoryFunction = new Function(...funcArgs, funcBody);
      factoryFunction(tempScope, ...depValues);

      if (tempScope.result === undefined) {
        logger.logEvent(
          "warn",
          `Module ${filePath} executed, but export '${exportName}' was not found.`,
          scriptContent.substring(0, 200)
        );
        throw new Error(
          `Module ${filePath} did not yield expected export '${exportName}'.`
        );
      }
      logger.logEvent("debug", `Module ${filePath} loaded successfully.`);

      if (
        exportName.endsWith("Module") &&
        typeof tempScope.result === "function"
      ) {
        return tempScope.result(...depValues);
      } else {
        return tempScope.result;
      }
    } catch (error) {
      logger.logEvent(
        "error",
        `Fatal Error loading/executing module ${filePath}`,
        error.message + (error.stack ? `\nStack: ${error.stack}` : "")
      );
      throw error;
    }
  };

  const initializeApplication = async () => {
    let config = initialConfig;
    let Utils = initialUtils;
    let Storage = initialStorage;
    let logger = null;
    let StateManager, ToolRunner, ApiClient, UI, CycleLogic;

    const fatalErrorHandler = (message, error = null) => {
      console.error("Orchestrator: Initialization failed.", message, error);
      const log = logger || {
        logEvent: (lvl, msg, det) =>
          console.error(`[ORCHESTRATOR FALLBACK] ${msg}`, det || ""),
      };
      log.logEvent(
        "error",
        `Orchestrator: Initialization failed. ${message}`,
        error
      );
      document.body.innerHTML = `<div style="color:red; padding: 20px; font-family: monospace;"><h1>FATAL ERROR</h1><p>App init failed: ${message}</p>${
        error ? `<p>${error.message}</p>` : ""
      }<p>Check console.</p></div>`;
    };

    try {
      if (!config || !Utils || !Storage) {
        throw new Error(
          "Core modules (Config, Utils, Storage) not passed from bootstrap."
        );
      }
      logger = Utils.logger;
      logger.logEvent("info", "Orchestrator: Initializing application...");

      const stage1Deps = { config, logger, Storage };
      StateManager = await loadModule(
        "state-manager.js",
        "StateManagerModule",
        stage1Deps
      );
      ApiClient = await loadModule("api-client.js", "ApiClientModule", {
        config,
        logger,
      });
      logger.logEvent("debug", "Orchestrator: Stage 1 modules loaded.");

      StateManager.init();
      logger.logEvent("debug", "Orchestrator: StateManager initialized.");

      const stage2DepsTool = {
        config,
        logger,
        Storage,
        StateManager,
        ApiClient,
      };
      const stage2DepsUI = { config, logger, Utils, Storage };
      ToolRunner = await loadModule(
        "tool-runner.js",
        "ToolRunnerModule",
        stage2DepsTool
      );
      UI = await loadModule("ui-manager.js", "UIModule", stage2DepsUI);
      logger.logEvent("debug", "Orchestrator: Stage 2 modules loaded.");

      const stage3Deps = {
        config,
        logger,
        Utils,
        Storage,
        StateManager,
        UI,
        ApiClient,
        ToolRunner,
      };
      CycleLogic = await loadModule(
        "agent-cycle.js",
        "CycleLogicModule",
        stage3Deps
      );
      logger.logEvent("debug", "Orchestrator: Stage 3 modules loaded.");

      CycleLogic.init();
      logger.logEvent("debug", "Orchestrator: CycleLogic initialized.");

      setTimeout(() => {
        try {
          UI.init(StateManager, CycleLogic);
          logger.logEvent(
            "info",
            "Orchestrator: Application initialization complete."
          );
        } catch (uiError) {
          fatalErrorHandler(
            "UI Initialization failed inside setTimeout.",
            uiError
          );
        }
      }, 0);
    } catch (error) {
      fatalErrorHandler(error.message || "Unknown initialization error", error);
    }
  };

  initializeApplication();
};

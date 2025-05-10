const CoreLogicModule = (
  initialConfig,
  initialUtils,
  initialStorage,
  initialErrors
) => {
  const loadModule = async (filePath, exportName, dependencies = {}) => {
    const logger = initialUtils?.logger || {
      logEvent: (lvl, msg, det) =>
        console.error(`[ORCHESTRATOR FALLBACK] ${msg}`, det || ""),
    };
    const allDependencies = { ...dependencies, Errors: initialErrors }; // Ensure Errors is always available
    const depNames = Object.keys(allDependencies);
    const depValues = Object.values(allDependencies);

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
        allDependencies
      );
      throw new initialErrors.ConfigError(
        `Dependency error for ${filePath}: Missing ${missing.join(", ")}`,
        filePath
      );
    }

    try {
      const response = await fetch(
        filePath + `?v=${initialConfig?.STATE_VERSION || Date.now()}`
      );
      if (!response.ok)
        throw new initialErrors.ApiError(
          `HTTP ${response.status} for ${filePath}`,
          response.status
        );
      const scriptContent = await response.text();
      const tempScope = {};
      const funcArgsString = ["tempScope", ...depNames].join(", ");
      const funcBody = `${scriptContent}\ntempScope.result = (typeof ${exportName} !== 'undefined') ? ${exportName} : undefined;`;

      const factoryFunction = new Function(funcArgsString, funcBody);
      factoryFunction(tempScope, ...depValues);

      if (tempScope.result === undefined) {
        logger.logEvent(
          "warn",
          `Module ${filePath} executed, but export '${exportName}' was not found.`
        );
        throw new initialErrors.ConfigError(
          `Module ${filePath} did not yield expected export '${exportName}'.`,
          filePath
        );
      }
      logger.logEvent("debug", `Module ${filePath} loaded successfully.`);

      if (
        exportName.endsWith("Module") &&
        typeof tempScope.result === "function"
      ) {
        return tempScope.result(...depValues); // Pass all dependencies
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

  /**
   * Registers core Web Components defined in artifacts.
   * This is called after StateManager is initialized.
   * @param {object} StateManagerInstance - The initialized StateManager.
   * @param {object} StorageInstance - The initialized Storage.
   * @param {object} LoggerInstance - The logger.
   */
  const registerCoreWebComponents = async (
    StateManagerInstance,
    StorageInstance,
    LoggerInstance
  ) => {
    if (
      !StateManagerInstance ||
      !StorageInstance ||
      !LoggerInstance ||
      typeof customElements === "undefined"
    ) {
      LoggerInstance.logEvent(
        "warn",
        "Cannot register core web components: missing dependencies or customElements API."
      );
      return;
    }
    LoggerInstance.logEvent(
      "info",
      "AppLogic: Attempting to register core Web Components..."
    );
    const artifactMetadata = StateManagerInstance.getAllArtifactMetadata(); // Gets latest versions
    let registeredCount = 0;

    for (const id in artifactMetadata) {
      if (id.startsWith("reploid.core.webcomponent.")) {
        const meta = artifactMetadata[id]; // This is already the latest meta
        if (
          meta &&
          meta.type === "WEB_COMPONENT_DEF" &&
          meta.latestCycle >= 0
        ) {
          const jsContent = StorageInstance.getArtifactContent(
            id,
            meta.latestCycle,
            meta.version_id
          );
          if (jsContent) {
            // e.g., reploid.core.webcomponent.status-bar -> status-bar
            const componentName = id
              .substring("reploid.core.webcomponent.".length)
              .replace(/\./g, "-");
            if (!customElements.get(componentName)) {
              try {
                const ComponentClass = new Function(
                  "return (" + jsContent + ")"
                )();
                if (
                  typeof ComponentClass === "function" &&
                  HTMLElement.isPrototypeOf(ComponentClass)
                ) {
                  customElements.define(componentName, ComponentClass);
                  StateManagerInstance.registerWebComponent(componentName); // Mark as registered in state
                  LoggerInstance.logEvent(
                    "info",
                    `AppLogic: Registered core WC <${componentName}> from ${id}`
                  );
                  registeredCount++;
                } else {
                  LoggerInstance.logEvent(
                    "warn",
                    `AppLogic: Invalid class structure for core WC ${componentName} in ${id}`
                  );
                }
              } catch (e) {
                LoggerInstance.logEvent(
                  "error",
                  `AppLogic: Error defining core WC ${componentName} from ${id}: ${e.message}`
                );
              }
            } else {
              // If already defined by browser/another script, still mark in our state if not already
              if (
                !StateManagerInstance.isWebComponentRegistered(componentName)
              ) {
                StateManagerInstance.registerWebComponent(componentName);
              }
              LoggerInstance.logEvent(
                "debug",
                `AppLogic: Core WC <${componentName}> from ${id} was already defined globally.`
              );
            }
          } else {
            LoggerInstance.logEvent(
              "warn",
              `AppLogic: Content missing for core WC definition: ${id} (Cycle ${meta.latestCycle})`
            );
          }
        }
      }
    }
    if (registeredCount > 0)
      LoggerInstance.logEvent(
        "info",
        `AppLogic: ${registeredCount} core Web Components newly registered.`
      );
    else
      LoggerInstance.logEvent(
        "info",
        `AppLogic: No new core Web Components to register at this stage.`
      );
  };

  const initializeApplication = async () => {
    let config = initialConfig;
    let Utils = initialUtils;
    let Storage = initialStorage;
    let Errors = initialErrors;
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
        error ? `<p>${error.message || error}</p>` : ""
      }<p>Check console.</p></div>`;
    };

    try {
      if (!config || !Utils || !Storage || !Errors) {
        throw new Error(
          "Core modules (Config, Utils, Storage, Errors) not passed from bootstrap."
        );
      }
      logger = Utils.logger;
      logger.logEvent("info", "Orchestrator: Initializing application...");

      const stage1Deps = { config, logger, Storage, Errors };
      StateManager = await loadModule(
        "state-manager.js",
        "StateManagerModule",
        stage1Deps
      );
      ApiClient = await loadModule("api-client.js", "ApiClientModule", {
        config,
        logger,
        Errors,
      });
      logger.logEvent("debug", "Orchestrator: Stage 1 modules loaded.");

      StateManager.init();
      await registerCoreWebComponents(StateManager, Storage, logger); // Register core WCs after StateManager is ready

      logger.logEvent(
        "debug",
        "Orchestrator: StateManager initialized and core WCs registered."
      );

      const stage2DepsTool = {
        config,
        logger,
        Storage,
        StateManager,
        ApiClient,
        Errors,
      };
      const stage2DepsUI = {
        config,
        logger,
        Utils,
        Storage,
        StateManager,
        Errors,
      }; // UI might need StateManager for WC list
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
        Errors,
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
        // Defer UI init slightly to ensure DOM is fully ready
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

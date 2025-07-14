const CoreLogicModule = (
  initialConfig,
  initialUtils,
  initialStorage,
  initialErrors,
  initialAgentLogicPureHelpers,
  initialStateHelpersPure
) => {
  const loadModule = async (filePath, exportName, dependencies = {}) => {
    const logger = initialUtils?.logger || {
      logEvent: (lvl, msg, det) =>
        console.error(`[ORCHESTRATOR_FALLBACK] ${msg}`, det || ""),
    };
    const allDependencies = {
      ...dependencies,
      Errors: initialErrors,
      Utils: initialUtils,
    };
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
        return tempScope.result(...Object.values(dependencies));
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
    const artifactMetadata = StateManagerInstance.getAllArtifactMetadata();
    let registeredCount = 0;

    for (const id in artifactMetadata) {
      if (id.startsWith("reploid.core.webcomponent.")) {
        const meta = artifactMetadata[id];
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
                  StateManagerInstance.registerWebComponent(componentName);
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
    let AgentLogicPureHelpers = initialAgentLogicPureHelpers;
    let StateHelpersPure = initialStateHelpersPure;
    let logger = null;
    let StateManager,
      ToolRunner,
      ApiClient,
      UI,
      CycleLogic,
      ToolRunnerPureHelpers;

    const fatalErrorHandler = (message, error = null) => {
      console.error("Orchestrator: Initialization failed.", message, error);
      const log = logger || {
        logEvent: (lvl, msg, det) =>
          console.error(`[ORCHESTRATOR_FALLBACK] ${msg}`, det || ""),
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
      if (
        !config ||
        !Utils ||
        !Storage ||
        !Errors ||
        !AgentLogicPureHelpers ||
        !StateHelpersPure
      ) {
        throw new Error(
          "Core modules (Config, Utils, Storage, Errors, PureHelpers) not passed from bootstrap."
        );
      }
      logger = Utils.logger;
      logger.logEvent("info", "Orchestrator: Initializing application...");

      const stateManagerDeps = {
        config,
        logger,
        Storage,
        Errors,
        StateHelpersPure,
        Utils,
      };
      StateManager = await loadModule(
        "state-manager.js",
        "StateManagerModule",
        stateManagerDeps
      );

      const apiClientDeps = { config, logger, Errors, Utils, StateManager };
      ApiClient = await loadModule(
        "api-client.js",
        "ApiClientModule",
        apiClientDeps
      );
      logger.logEvent(
        "debug",
        "Orchestrator: StateManager and ApiClient loaded."
      );

      StateManager.init();
      await registerCoreWebComponents(StateManager, Storage, logger);
      logger.logEvent(
        "debug",
        "Orchestrator: StateManager initialized and core WCs registered."
      );

      ToolRunnerPureHelpers = await loadModule(
        "tool-runner-pure-helpers.js",
        "ToolRunnerPureHelpersModule",
        { logger }
      );

      const toolRunnerDeps = {
        config,
        logger,
        Storage,
        StateManager,
        ApiClient,
        Errors,
        Utils,
        ToolRunnerPureHelpers,
      };
      ToolRunner = await loadModule(
        "tool-runner.js",
        "ToolRunnerModule",
        toolRunnerDeps
      );

      const uiManagerDeps = {
        config,
        logger,
        Utils,
        Storage,
        StateManager,
        Errors,
        StateHelpersPure,
      }; // Added StateHelpersPure
      UI = await loadModule("ui-manager.js", "UIModule", uiManagerDeps);
      logger.logEvent("debug", "Orchestrator: ToolRunner and UI loaded.");

      const cycleLogicDeps = {
        config,
        logger,
        Utils,
        Storage,
        StateManager,
        UI,
        ApiClient,
        ToolRunner,
        Errors,
        AgentLogicPureHelpers,
      };
      CycleLogic = await loadModule(
        "agent-cycle.js",
        "CycleLogicModule",
        cycleLogicDeps
      );
      logger.logEvent("debug", "Orchestrator: CycleLogic loaded.");

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

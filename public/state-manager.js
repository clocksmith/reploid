const StateManagerModule = (config, logger, Storage, Errors) => {
  if (!config || !logger || !Storage || !Errors) {
    console.error(
      "StateManagerModule requires config, logger, Storage, and Errors."
    );
    const log = logger || {
      logEvent: (lvl, msg) =>
        console[lvl === "error" ? "error" : "log"](
          `[STATEMANAGER FALLBACK] ${msg}`
        ),
    };
    log.logEvent(
      "error",
      "StateManagerModule initialization failed: Missing dependencies."
    );
    // Return a dummy object
    const dummyMethods = [
      "init",
      "getState",
      "setState",
      "save",
      "getArtifactMetadata",
      "getArtifactMetadataAllVersions",
      "updateArtifactMetadata",
      "deleteArtifactMetadata",
      "getAllArtifactMetadata",
      "capturePreservationState",
      "restoreStateFromSession",
      "exportState",
      "importState",
      "getDefaultState",
      "addEvaluationResult",
      "addCritiqueFeedback",
      "isInitialized",
      "registerWebComponent",
      "isWebComponentRegistered",
      "getRegisteredWebComponents",
    ];
    const dummyStateManager = {};
    dummyMethods.forEach((method) => {
      dummyStateManager[method] = () => {
        log.logEvent(
          "error",
          `StateManager not initialized. Called ${method}.`
        );
        if (method === "isInitialized") return false;
        if (method === "getState") return null;
        if (
          method === "getAllArtifactMetadata" ||
          method === "getRegisteredWebComponents"
        )
          return {};
        if (method === "getArtifactMetadataAllVersions") return [];
      };
    });
    return dummyStateManager;
  }

  const { StateError, ConfigError } = Errors;

  let globalState = null;
  let artifactMetadata = {}; // This will be part of globalState.artifactMetadata
  let dynamicToolDefinitions = []; // This will be part of globalState.dynamicTools
  let registeredWebComponents = []; // This will be part of globalState.registeredWebComponents
  let isInitialized = false;

  const STATE_VERSION_MAJOR = config.STATE_VERSION.split(".")[0];
  const STATE_VERSION_MINOR = config.STATE_VERSION.split(".")[1];
  const STATE_VERSION_PATCH = config.STATE_VERSION.split(".")[2];

  const MAX_HISTORY_ITEMS = config.MAX_HISTORY_ITEMS || 20;
  const EVAL_PASS_THRESHOLD = config.EVAL_PASS_THRESHOLD || 0.75;

  const getDefaultState = () => ({
    version: config.STATE_VERSION,
    totalCycles: 0,
    agentIterations: 0,
    humanInterventions: 0,
    failCount: 0,
    currentGoal: {
      seed: null,
      cumulative: null,
      latestType: "Idle",
      summaryContext: null,
      currentContextFocus: null,
    },
    lastCritiqueType: "N/A",
    personaMode: "XYZ",
    lastFeedback: null,
    lastSelfAssessment: null,
    forceHumanReview: false,
    apiKey: "",
    confidenceHistory: [],
    critiqueFailHistory: [],
    tokenHistory: [],
    failHistory: [],
    evaluationHistory: [],
    critiqueFeedbackHistory: [],
    avgConfidence: null,
    critiqueFailRate: null,
    avgTokens: null,
    avgEvalScore: null,
    evalPassRate: null,
    contextTokenEstimate: 0,
    contextTokenTarget: config.CTX_TARGET || 700000,
    lastGeneratedFullSource: null,
    htmlHistory: [],
    lastApiResponse: null,
    retryCount: 0,
    autonomyMode: "Manual",
    autonomyCyclesRemaining: 0,
    cfg: { ...(config.DEFAULT_CFG || {}) },
    artifactMetadata: {},
    dynamicTools: [],
    registeredWebComponents: [], // New state field
  });

  const calculateDerivedStats = (state) => {
    if (!state) return;

    const confHistory =
      state.confidenceHistory?.slice(-MAX_HISTORY_ITEMS) || [];
    if (confHistory.length > 0) {
      state.avgConfidence =
        confHistory.reduce((a, b) => a + (b || 0), 0) / confHistory.length;
    } else {
      state.avgConfidence = null;
    }

    const critHistory =
      state.critiqueFailHistory?.slice(-MAX_HISTORY_ITEMS) || [];
    if (critHistory.length > 0) {
      const fails = critHistory.filter((v) => v === true).length;
      state.critiqueFailRate = (fails / critHistory.length) * 100;
    } else {
      state.critiqueFailRate = null;
    }

    const tokenHistory = state.tokenHistory?.slice(-MAX_HISTORY_ITEMS) || [];
    if (tokenHistory.length > 0) {
      state.avgTokens =
        tokenHistory.reduce((a, b) => a + (b || 0), 0) / tokenHistory.length;
    } else {
      state.avgTokens = null;
    }

    const evalHistory =
      state.evaluationHistory?.slice(-MAX_HISTORY_ITEMS) || [];
    if (evalHistory.length > 0) {
      const validScores = evalHistory
        .map((e) => e.evaluation_score)
        .filter((s) => typeof s === "number" && !isNaN(s));
      if (validScores.length > 0) {
        state.avgEvalScore =
          validScores.reduce((a, b) => a + b, 0) / validScores.length;
        const passes = validScores.filter(
          (s) => s >= EVAL_PASS_THRESHOLD
        ).length;
        state.evalPassRate = (passes / validScores.length) * 100;
      } else {
        state.avgEvalScore = null;
        state.evalPassRate = null;
      }
    } else {
      state.avgEvalScore = null;
      state.evalPassRate = null;
    }
  };

  const validateStateStructure = (stateObj, source = "unknown") => {
    if (!stateObj || typeof stateObj !== "object")
      return `Invalid state object (${source})`;
    const defaultState = getDefaultState(); // Use this module's getDefaultState
    const requiredKeys = Object.keys(defaultState);
    const optionalKeys = [
      "lastApiResponse",
      "lastGeneratedFullSource",
      "lastSelfAssessment",
    ]; // These can be null initially

    for (const key of requiredKeys) {
      if (!(key in stateObj) && !optionalKeys.includes(key)) {
        const loadedVersion = stateObj.version?.split(".").map(Number) || [
          0, 0, 0,
        ];
        const currentVersion = config.STATE_VERSION.split(".").map(Number);
        // If loading an older version, some new keys might be missing, which is acceptable
        // and will be filled by mergeWithDefaults.
        let isOlderMajorMinor = false;
        if (loadedVersion.length === 3 && currentVersion.length === 3) {
          if (
            loadedVersion[0] < currentVersion[0] ||
            (loadedVersion[0] === currentVersion[0] &&
              loadedVersion[1] < currentVersion[1])
          ) {
            isOlderMajorMinor = true;
          }
        }
        // Only fail if it's not an older version missing a newly introduced key.
        // Example: If 'registeredWebComponents' is missing and version is older, that's fine.
        if (!isOlderMajorMinor) {
          // Critical keys that must always exist
          const criticalKeys = [
            "version",
            "totalCycles",
            "artifactMetadata",
            "dynamicTools",
            "cfg",
            "registeredWebComponents",
          ];
          if (criticalKeys.includes(key)) {
            return `Missing critical property: '${key}' in state from ${source} (v${stateObj.version})`;
          }
        }
      }
    }
    if (!Array.isArray(stateObj.registeredWebComponents)) {
      return `Property 'registeredWebComponents' must be an array in state from ${source}`;
    }
    return null;
  };

  const mergeWithDefaults = (loadedState) => {
    const defaultState = getDefaultState();
    const mergedState = {
      ...defaultState,
      ...loadedState,
      cfg: { ...defaultState.cfg, ...(loadedState.cfg || {}) },
      artifactMetadata: loadedState.artifactMetadata || {},
      dynamicTools: loadedState.dynamicTools || [],
      registeredWebComponents: Array.isArray(
        loadedState.registeredWebComponents
      )
        ? loadedState.registeredWebComponents
        : [], // Ensure it's an array
    };
    // Ensure history arrays are arrays
    const historyKeys = [
      "confidenceHistory",
      "critiqueFailHistory",
      "tokenHistory",
      "failHistory",
      "evaluationHistory",
      "critiqueFeedbackHistory",
      "htmlHistory",
    ];
    historyKeys.forEach((key) => {
      if (!Array.isArray(mergedState[key])) {
        mergedState[key] = [];
      }
    });
    return mergedState;
  };

  const checkAndLogVersionDifference = (loadedVersion, source) => {
    if (!loadedVersion || typeof loadedVersion !== "string") return true; // No version to check, proceed
    const [major, minor, patch] = loadedVersion.split(".").map(Number);
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
      logger.logEvent(
        "warn",
        `Invalid version string '${loadedVersion}' in state from ${source}. Proceeding cautiously.`
      );
      return true; // Allow loading but log
    }

    if (major !== parseInt(STATE_VERSION_MAJOR, 10)) {
      logger.logEvent(
        "error",
        `Incompatible MAJOR version detected in state from ${source}.`,
        `Loaded: ${loadedVersion}, Required: ${config.STATE_VERSION}. Discarding state.`
      );
      return false; // Incompatible major version
    } else if (
      minor < parseInt(STATE_VERSION_MINOR, 10) ||
      (minor === parseInt(STATE_VERSION_MINOR, 10) &&
        patch < parseInt(STATE_VERSION_PATCH, 10))
    ) {
      logger.logEvent(
        "warn",
        `Loading older MINOR/PATCH version state from ${source}.`,
        `Loaded: ${loadedVersion}, Current: ${config.STATE_VERSION}. Applying defaults for new fields.`
      );
    } else if (
      minor > parseInt(STATE_VERSION_MINOR, 10) ||
      (minor === parseInt(STATE_VERSION_MINOR, 10) &&
        patch > parseInt(STATE_VERSION_PATCH, 10))
    ) {
      logger.logEvent(
        "warn",
        `Loading newer MINOR/PATCH version state from ${source}.`,
        `Loaded: ${loadedVersion}, Current: ${config.STATE_VERSION}. May encounter issues.`
      );
    }
    return true;
  };

  const init = () => {
    if (isInitialized) return true;
    const savedState = Storage.getState();
    let validationError = null;

    if (savedState) {
      validationError = validateStateStructure(savedState, "localStorage");
      if (validationError) {
        logger.logEvent(
          "error",
          `Saved state validation failed: ${validationError}. Discarding and re-initializing.`
        );
        Storage.removeState();
        globalState = getDefaultState();
      } else {
        const isCompatible = checkAndLogVersionDifference(
          savedState.version,
          "localStorage"
        );
        if (!isCompatible) {
          Storage.removeState();
          globalState = getDefaultState();
        } else {
          globalState = mergeWithDefaults(savedState);
          globalState.version = config.STATE_VERSION; // Always update to current version after merge
          logger.logEvent(
            "info",
            `Loaded state v${savedState.version} (Cycle ${globalState.totalCycles}), updated to v${config.STATE_VERSION}`
          );
        }
      }
    } else {
      logger.logEvent(
        "info",
        `No saved state found. Initializing new default state v${config.STATE_VERSION}`
      );
      globalState = getDefaultState();
      // Populate initial artifact metadata placeholders if genesis definitions exist
      if (config.GENESIS_ARTIFACT_DEFS) {
        for (const id in config.GENESIS_ARTIFACT_DEFS) {
          if (id === "reploid.core.config" || id === "reploid.core.errors")
            continue;
          const def = config.GENESIS_ARTIFACT_DEFS[id];
          if (!globalState.artifactMetadata[id]) {
            // Ensure not to overwrite if somehow present
            globalState.artifactMetadata[id] = [
              {
                id: id,
                version_id: null,
                type: def.type || "UNKNOWN",
                description: def.description || `Artifact ${id}`,
                latestCycle: -1,
                source: "Initial Definition",
                checksum: null,
                timestamp: 0,
              },
            ];
          }
        }
      }
    }

    // Ensure these point to the correct parts of globalState after init/load
    artifactMetadata = globalState.artifactMetadata;
    dynamicToolDefinitions = globalState.dynamicTools;
    registeredWebComponents = globalState.registeredWebComponents;
    calculateDerivedStats(globalState);
    save(); // Save potentially migrated/defaulted state
    isInitialized = true;
    return globalState && globalState.totalCycles >= 0; // Check for valid cycle count
  };

  const getState = () => globalState;

  const setState = (newState) => {
    const validationError = validateStateStructure(newState, "setState call");
    if (validationError) {
      logger.logEvent(
        "error",
        `Attempted to set invalid state: ${validationError}`
      );
      throw new StateError(
        `Attempted to set invalid state: ${validationError}`
      );
    }
    globalState = newState;
    // Update local references
    artifactMetadata = globalState.artifactMetadata || {};
    dynamicToolDefinitions = globalState.dynamicTools || [];
    registeredWebComponents = globalState.registeredWebComponents || [];
  };

  const save = () => {
    if (!globalState || !Storage) return;
    try {
      // Create a clean object for saving, excluding potentially large or unserializable parts temporarily
      const stateToSave = JSON.parse(
        JSON.stringify({
          ...globalState,
          lastApiResponse: null /* Exclude large API responses */,
        })
      );
      Storage.saveState(stateToSave);
      logger.logEvent(
        "debug",
        `Saved state (Cycle ${globalState.totalCycles})`
      );
    } catch (e) {
      logger.logEvent("error", `Save state failed: ${e.message}`, e);
      // Consider throwing a StateError here if saving is critical
    }
  };

  const getArtifactMetadata = (id, versionId = null) => {
    const history = artifactMetadata[id]; // artifactMetadata is now a direct reference
    if (!history || history.length === 0) return null;
    if (versionId === null) {
      // Get latest
      return history.sort(
        (a, b) =>
          b.latestCycle - a.latestCycle ||
          (b.timestamp || 0) - (a.timestamp || 0)
      )[0];
    } else {
      // Get specific version
      return history.find((meta) => meta.version_id === versionId) || null;
    }
  };

  const getArtifactMetadataAllVersions = (id) => {
    return artifactMetadata[id] || [];
  };

  const updateArtifactMetadata = (
    id,
    type,
    description,
    cycle,
    checksum = null,
    source = "Agent Modified",
    versionId = null,
    isModular = false
  ) => {
    if (!artifactMetadata[id]) {
      artifactMetadata[id] = [];
    }
    const now = Date.now();
    let existingMetaIndex = -1;

    // Find existing metadata entry to update, prioritizing versionId match
    if (versionId !== null) {
      existingMetaIndex = artifactMetadata[id].findIndex(
        (meta) => meta.version_id === versionId && meta.latestCycle === cycle
      );
      if (existingMetaIndex === -1) {
        // If not found by versionId and cycle, try just versionId
        existingMetaIndex = artifactMetadata[id].findIndex(
          (meta) => meta.version_id === versionId
        );
      }
    } else {
      // If no versionId, find the one with the highest cycle that matches current cycle, or highest overall
      const cycleMatches = artifactMetadata[id].filter(
        (meta) => meta.latestCycle === cycle && meta.version_id === null
      );
      if (cycleMatches.length > 0) {
        const latestCycleMatch = cycleMatches.sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        )[0];
        existingMetaIndex = artifactMetadata[id].indexOf(latestCycleMatch);
      } else {
        // If no match for current cycle and null versionId, update the overall latest null-versionId entry
        const latestNullVersionMetas = artifactMetadata[id]
          .filter((m) => m.version_id === null)
          .sort(
            (a, b) =>
              b.latestCycle - a.latestCycle ||
              (b.timestamp || 0) - (a.timestamp || 0)
          );
        if (latestNullVersionMetas.length > 0) {
          existingMetaIndex = artifactMetadata[id].indexOf(
            latestNullVersionMetas[0]
          );
        }
      }
    }

    const newMetaEntry = {
      id: id,
      version_id: versionId,
      type: type,
      description: description,
      latestCycle: cycle,
      checksum: checksum,
      source: source,
      timestamp: now,
      isModularEdit: isModular,
    };

    if (existingMetaIndex !== -1) {
      // Update existing entry: ensure we don't lose vital info like original type if not provided
      const currentMeta = artifactMetadata[id][existingMetaIndex];
      newMetaEntry.type = type ?? currentMeta.type;
      newMetaEntry.description = description ?? currentMeta.description;
      // latestCycle should definitely be the new cycle
      // checksum should be the new checksum
      // source should be the new source
      artifactMetadata[id][existingMetaIndex] = newMetaEntry;
    } else {
      // Add as a new metadata entry (potentially for a new version_id or if no suitable existing entry)
      const baseMeta = getArtifactMetadata(id, null); // Get latest non-versioned as a base if needed
      newMetaEntry.type = type ?? baseMeta?.type ?? "UNKNOWN"; // Fallback type
      newMetaEntry.description =
        description ?? baseMeta?.description ?? `Artifact ${id}`;
      artifactMetadata[id].push(newMetaEntry);
    }
    // No need to update globalState.artifactMetadata explicitly if artifactMetadata is a direct reference
  };

  const deleteArtifactMetadata = (id, versionId = null) => {
    if (!artifactMetadata[id]) return;
    if (versionId !== null) {
      artifactMetadata[id] = artifactMetadata[id].filter(
        (meta) => meta.version_id !== versionId
      );
      if (artifactMetadata[id].length === 0) {
        delete artifactMetadata[id];
      }
    } else {
      // Delete all versions for this ID
      delete artifactMetadata[id];
    }
  };

  const getAllArtifactMetadata = () => {
    // Returns map of ID to LATEST metadata object
    const latestMetaMap = {};
    for (const id in artifactMetadata) {
      const latest = getArtifactMetadata(id, null); // Gets the one with highest cycle (and null version_id if multiple at same cycle)
      if (latest) {
        latestMetaMap[id] = latest;
      }
    }
    return latestMetaMap;
  };

  const capturePreservationState = (uiRefs = {}) => {
    if (!globalState) return null;
    try {
      // Deep clone to avoid modifying globalState, especially for nested objects like cfg
      const stateToPreserve = JSON.parse(
        JSON.stringify({ ...globalState, lastApiResponse: null })
      );
      stateToPreserve.logBuffer = logger.getLogBuffer
        ? logger.getLogBuffer()
        : null;
      stateToPreserve.timelineHTML = uiRefs.timelineLog?.innerHTML || "";
      // Add other UI specific states if necessary
      return stateToPreserve;
    } catch (e) {
      logger.logEvent(
        "error",
        `Failed to capture preservation state: ${e.message}`,
        e
      );
      return null;
    }
  };

  const restoreStateFromSession = (restoreUIFn = () => {}) => {
    if (!isInitialized) {
      logger.logEvent(
        "warn",
        "Cannot restore session, StateManager not initialized."
      );
      return false;
    }
    const preservedData = Storage.getSessionState();
    if (!preservedData) return false;

    logger.logEvent(
      "info",
      "Preserved session state found. Attempting restore."
    );
    try {
      const validationError = validateStateStructure(
        preservedData,
        "sessionStorage"
      );
      if (validationError) {
        throw new StateError(
          `Session state validation failed: ${validationError}`
        );
      }

      const isCompatible = checkAndLogVersionDifference(
        preservedData.version,
        "sessionStorage"
      );
      if (!isCompatible) {
        throw new StateError(
          `Incompatible MAJOR version in session state: ${preservedData.version}`
        );
      }

      globalState = mergeWithDefaults(preservedData);
      globalState.version = config.STATE_VERSION; // Update to current version

      if (logger.setLogBuffer && preservedData.logBuffer) {
        logger.setLogBuffer(preservedData.logBuffer);
      }
      // Update local references
      artifactMetadata = globalState.artifactMetadata;
      dynamicToolDefinitions = globalState.dynamicTools;
      registeredWebComponents = globalState.registeredWebComponents;
      calculateDerivedStats(globalState);

      restoreUIFn(preservedData); // Callback for UI to restore its specific parts

      logger.logEvent(
        "info",
        "Session state restored successfully by StateManager."
      );
      save(); // Save the restored and potentially migrated state
      return true;
    } catch (e) {
      logger.logEvent("error", `Restore from session failed: ${e.message}`, e);
      // Fallback to a clean init if restore fails badly
      init(); // This will load from localStorage or default, effectively discarding session
      return false;
    } finally {
      Storage.removeSessionState();
      logger.logEvent(
        "debug",
        "Cleared session state from storage after attempt."
      );
    }
  };

  const exportState = (uiRefs = {}) => {
    logger.logEvent(
      "info",
      "Exporting state (metadata and UI state only, NOT artifact content)..."
    );
    try {
      const stateData = capturePreservationState(uiRefs);
      if (!stateData) {
        logger.logEvent("error", "Failed to capture state for export.");
        if (typeof showNotification === "function")
          showNotification?.("Error capturing state for export.", "error");
        return;
      }
      const fileName = `x0_state_${config.STATE_VERSION}_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      const dataStr = JSON.stringify(stateData, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logger.logEvent("info", "State export initiated.");
    } catch (e) {
      logger.logEvent("error", `State export failed: ${e.message}`, e);
      if (typeof showNotification === "function")
        showNotification?.(`State export failed: ${e.message}`, "error");
    }
  };

  const importState = (file, importCallback = () => {}) => {
    logger.logEvent(
      "info",
      "Attempting to import state (metadata and UI state only, NOT artifact content)..."
    );
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!e.target?.result)
          throw new Error("File read returned null result.");
        const importedData = JSON.parse(e.target.result);

        const validationError = validateStateStructure(
          importedData,
          `imported file '${file.name}'`
        );
        if (validationError) {
          throw new StateError(
            `Imported state validation failed: ${validationError}`
          );
        }
        logger.logEvent("info", `Importing state v${importedData.version}`);

        const isCompatible = checkAndLogVersionDifference(
          importedData.version,
          `imported file '${file.name}'`
        );
        if (!isCompatible) {
          throw new StateError(
            `Incompatible MAJOR version in imported state: ${importedData.version}`
          );
        }

        globalState = mergeWithDefaults(importedData);
        globalState.version = config.STATE_VERSION; // Update to current version

        if (logger.setLogBuffer && importedData.logBuffer) {
          logger.setLogBuffer(importedData.logBuffer);
        }
        // Update local references
        artifactMetadata = globalState.artifactMetadata;
        dynamicToolDefinitions = globalState.dynamicTools;
        registeredWebComponents = globalState.registeredWebComponents;
        calculateDerivedStats(globalState);

        importCallback(true, importedData); // Notify UI or other parts

        logger.logEvent("info", "State imported successfully by StateManager.");
        save(); // Save the imported and merged state
      } catch (err) {
        logger.logEvent("error", `Import failed: ${err.message}`, err);
        importCallback(false, null, err.message);
      }
    };
    reader.onerror = (e) => {
      const errorMsg = `File read error: ${reader.error || "Unknown"}`;
      logger.logEvent("error", errorMsg);
      importCallback(false, null, errorMsg);
    };
    reader.readAsText(file);
  };

  const addEvaluationResult = (result) => {
    if (!globalState || !globalState.evaluationHistory) return;
    globalState.evaluationHistory.push(result);
    while (globalState.evaluationHistory.length > MAX_HISTORY_ITEMS) {
      globalState.evaluationHistory.shift();
    }
    calculateDerivedStats(globalState); // Recalculate stats
  };

  const addCritiqueFeedback = (feedbackData) => {
    if (!globalState || !globalState.critiqueFeedbackHistory) return;
    globalState.critiqueFeedbackHistory.push({
      cycle: globalState.totalCycles,
      feedback: feedbackData,
      timestamp: Date.now(),
    });
    while (globalState.critiqueFeedbackHistory.length > MAX_HISTORY_ITEMS) {
      globalState.critiqueFeedbackHistory.shift();
    }
    // No specific stats for critique feedback, but save could be called if needed
  };

  /**
   * Marks a web component tag name as registered in the current state.
   * @param {string} tagName - The tag name of the web component (e.g., 'my-element').
   */
  const registerWebComponent = (tagName) => {
    if (!globalState || !Array.isArray(globalState.registeredWebComponents)) {
      logger.logEvent(
        "error",
        "StateManager: Cannot register web component, state or registry array is invalid."
      );
      return;
    }
    if (
      typeof tagName === "string" &&
      tagName.includes("-") &&
      !globalState.registeredWebComponents.includes(tagName)
    ) {
      globalState.registeredWebComponents.push(tagName);
      logger.logEvent(
        "info",
        `StateManager: Web component '${tagName}' marked as registered.`
      );
    } else if (globalState.registeredWebComponents.includes(tagName)) {
      logger.logEvent(
        "debug",
        `StateManager: Web component '${tagName}' was already marked as registered.`
      );
    } else {
      logger.logEvent(
        "warn",
        `StateManager: Invalid or already registered web component tag name: '${tagName}'`
      );
    }
  };

  /**
   * Checks if a web component tag name is marked as registered in the state.
   * @param {string} tagName - The tag name to check.
   * @returns {boolean} True if registered, false otherwise.
   */
  const isWebComponentRegistered = (tagName) => {
    return globalState?.registeredWebComponents?.includes(tagName) || false;
  };

  /**
   * Gets the list of registered web component tag names from the state.
   * @returns {string[]} An array of registered tag names.
   */
  const getRegisteredWebComponents = () => {
    return [...(globalState?.registeredWebComponents || [])];
  };

  return {
    init,
    getState,
    setState,
    save,
    getArtifactMetadata,
    getArtifactMetadataAllVersions,
    updateArtifactMetadata,
    deleteArtifactMetadata,
    getAllArtifactMetadata,
    capturePreservationState,
    restoreStateFromSession,
    exportState,
    importState,
    getDefaultState,
    isInitialized: () => isInitialized,
    addEvaluationResult,
    addCritiqueFeedback,
    registerWebComponent,
    isWebComponentRegistered,
    getRegisteredWebComponents,
  };
};

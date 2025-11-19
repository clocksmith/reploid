const StateManagerModule = (
  config,
  logger,
  Storage,
  Errors,
  StateHelpersPure,
  Utils
) => {
  if (
    !config ||
    !logger ||
    !Storage ||
    !Errors ||
    !StateHelpersPure ||
    !Utils
  ) {
    const internalLog = logger || {
      logEvent: (lvl, msg, det) =>
        console[lvl === "error" ? "error" : "log"](
          `[STATEMANAGER_FALLBACK] ${msg}`,
          det || ""
        ),
    };
    internalLog.logEvent(
      "error",
      "StateManagerModule initialization failed: Missing dependencies."
    );
    const fakeMethods = [
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
      "isInitialized",
      "addEvaluationResult",
      "addCritiqueFeedback",
      "registerWebComponent",
      "isWebComponentRegistered",
      "getRegisteredWebComponents",
      "updateAndSaveState",
    ];
    const fakeStateManager = {};
    fakeMethods.forEach((method) => {
      fakeStateManager[method] = () => {
        internalLog.logEvent(
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
    return fakeStateManager;
  }

  const { StateError } = Errors;
  let globalState = null;
  let isInitializedFlag = false;

  const STATE_VERSION_MAJOR = config.STATE_VERSION.split(".")[0];
  const STATE_VERSION_MINOR = config.STATE_VERSION.split(".")[1];
  const STATE_VERSION_PATCH = config.STATE_VERSION.split(".")[2];
  const MAX_HISTORY_ITEMS = config.MAX_HISTORY_ITEMS || 20;
  const EVAL_PASS_THRESHOLD = config.EVAL_PASS_THRESHOLD || 0.75;

  const calculateDerivedStatsAndUpdateState = (stateToUpdate) => {
    if (!stateToUpdate) return;
    const derived = StateHelpersPure.calculateDerivedStatsPure(
      stateToUpdate.confidenceHistory,
      stateToUpdate.critiqueFailHistory,
      stateToUpdate.tokenHistory,
      stateToUpdate.evaluationHistory,
      MAX_HISTORY_ITEMS,
      EVAL_PASS_THRESHOLD
    );
    Object.assign(stateToUpdate, derived);
  };

  const checkAndLogVersionDifference = (loadedVersion, source) => {
    if (!loadedVersion || typeof loadedVersion !== "string") return true;
    const [major, minor, patch] = loadedVersion.split(".").map(Number);
    if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
      logger.logEvent(
        "warn",
        `Invalid version string '${loadedVersion}' in state from ${source}. Proceeding cautiously.`
      );
      return true;
    }
    if (major !== parseInt(STATE_VERSION_MAJOR, 10)) {
      logger.logEvent(
        "error",
        `Incompatible MAJOR version detected in state from ${source}.`,
        `Loaded: ${loadedVersion}, Required: ${config.STATE_VERSION}. Discarding state.`
      );
      return false;
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
    if (isInitializedFlag) return true;
    const savedState = Storage.getState();
    let validationError = null;

    if (savedState) {
      validationError = StateHelpersPure.validateStateStructurePure(
        savedState,
        config.STATE_VERSION,
        Utils.getDefaultState
      );
      if (validationError) {
        logger.logEvent(
          "error",
          `Saved state validation failed: ${validationError}. Discarding and re-initializing.`
        );
        Storage.removeState();
        globalState = Utils.getDefaultState(config);
      } else {
        const isCompatible = checkAndLogVersionDifference(
          savedState.version,
          "localStorage"
        );
        if (!isCompatible) {
          Storage.removeState();
          globalState = Utils.getDefaultState(config);
        } else {
          globalState = StateHelpersPure.mergeWithDefaultsPure(
            savedState,
            Utils.getDefaultState,
            config.STATE_VERSION
          );
          globalState.version = config.STATE_VERSION;
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
      globalState = Utils.getDefaultState(config);
      if (config.GENESIS_ARTIFACT_DEFS) {
        for (const id in config.GENESIS_ARTIFACT_DEFS) {
          if (id === "reploid.core.config") continue;
          const def = config.GENESIS_ARTIFACT_DEFS[id];
          if (!globalState.artifactMetadata[id]) {
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
                paradigm: def.paradigm || "unknown",
              },
            ];
          }
        }
      }
    }
    calculateDerivedStatsAndUpdateState(globalState);
    _saveInternal();
    isInitializedFlag = true;
    return globalState && globalState.totalCycles >= 0;
  };

  const getState = () => globalState;

  const _updateGlobalStateReference = (newState) => {
    globalState = newState;
  };

  const updateAndSaveState = (updaterFn) => {
    if (typeof updaterFn !== "function") {
      logger.logEvent(
        "error",
        "Invalid updater function provided to updateAndSaveState."
      );
      return globalState;
    }
    const currentState = getState();
    const newState = updaterFn(JSON.parse(JSON.stringify(currentState))); // Pass a deep copy to updater

    const validationError = StateHelpersPure.validateStateStructurePure(
      newState,
      config.STATE_VERSION,
      Utils.getDefaultState
    );
    if (validationError) {
      logger.logEvent(
        "error",
        `Attempted to set invalid state via updaterFn: ${validationError}`
      );
      throw new StateError(
        `Attempted to set invalid state via updaterFn: ${validationError}`
      );
    }
    _updateGlobalStateReference(newState);
    calculateDerivedStatsAndUpdateState(globalState);
    _saveInternal();
    return globalState;
  };

  const _saveInternal = () => {
    if (!globalState || !Storage) return;
    try {
      const stateToSave = JSON.parse(
        JSON.stringify({ ...globalState, lastApiResponse: null })
      );
      Storage.saveState(stateToSave);
      logger.logEvent(
        "debug",
        `Saved state (Cycle ${globalState.totalCycles})`
      );
    } catch (e) {
      logger.logEvent("error", `Save state failed: ${e.message}`, e);
    }
  };

  const getArtifactMetadata = (id, versionId = null) => {
    const history = globalState?.artifactMetadata?.[id];
    if (!history || history.length === 0) return null;
    if (versionId === null) {
      return Utils.getLatestMeta(history);
    } else {
      return history.find((meta) => meta.version_id === versionId) || null;
    }
  };

  const getArtifactMetadataAllVersions = (id) =>
    globalState?.artifactMetadata?.[id] || [];

  const updateArtifactMetadata = (
    id,
    type,
    description,
    cycle,
    checksum = null,
    source = "Agent Modified",
    versionId = null,
    isModular = false,
    newParadigm = null
  ) => {
    return updateAndSaveState((currentState) => {
      if (!currentState.artifactMetadata[id])
        currentState.artifactMetadata[id] = [];
      const now = Date.now();
      let existingMetaIndex = -1;

      if (versionId !== null) {
        existingMetaIndex = currentState.artifactMetadata[id].findIndex(
          (meta) => meta.version_id === versionId && meta.latestCycle === cycle
        );
        if (existingMetaIndex === -1)
          existingMetaIndex = currentState.artifactMetadata[id].findIndex(
            (meta) => meta.version_id === versionId
          );
      } else {
        const cycleMatches = currentState.artifactMetadata[id].filter(
          (meta) => meta.latestCycle === cycle && meta.version_id === null
        );
        if (cycleMatches.length > 0) {
          const latestCycleMatch = cycleMatches.sort(
            (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
          )[0];
          existingMetaIndex =
            currentState.artifactMetadata[id].indexOf(latestCycleMatch);
        } else {
          const latestNullVersionMetas = currentState.artifactMetadata[id]
            .filter((m) => m.version_id === null)
            .sort(
              (a, b) =>
                b.latestCycle - a.latestCycle ||
                (b.timestamp || 0) - (a.timestamp || 0)
            );
          if (latestNullVersionMetas.length > 0)
            existingMetaIndex = currentState.artifactMetadata[id].indexOf(
              latestNullVersionMetas[0]
            );
        }
      }

      const baseMeta = getArtifactMetadata(id, versionId); // Read before modifying array

      const newMetaEntry = {
        id: id,
        version_id: versionId,
        type: type ?? baseMeta?.type ?? "UNKNOWN",
        description: description ?? baseMeta?.description ?? `Artifact ${id}`,
        latestCycle: cycle,
        checksum: checksum,
        source: source,
        timestamp: now,
        isModularEdit: isModular,
        paradigm:
          newParadigm ??
          baseMeta?.paradigm ??
          config.GENESIS_ARTIFACT_DEFS?.[id]?.paradigm ??
          "unknown",
      };

      if (existingMetaIndex !== -1) {
        currentState.artifactMetadata[id][existingMetaIndex] = newMetaEntry;
      } else {
        currentState.artifactMetadata[id].push(newMetaEntry);
      }
      return currentState;
    });
  };

  const deleteArtifactMetadata = (id, versionId = null) => {
    return updateAndSaveState((currentState) => {
      if (!currentState.artifactMetadata[id]) return currentState;
      if (versionId !== null) {
        currentState.artifactMetadata[id] = currentState.artifactMetadata[
          id
        ].filter((meta) => meta.version_id !== versionId);
        if (currentState.artifactMetadata[id].length === 0)
          delete currentState.artifactMetadata[id];
      } else {
        delete currentState.artifactMetadata[id];
      }
      return currentState;
    });
  };

  const getAllArtifactMetadata = () => {
    const latestMetaMap = {};
    if (!globalState?.artifactMetadata) return latestMetaMap;
    for (const id in globalState.artifactMetadata) {
      const latest = getArtifactMetadata(id, null);
      if (latest) latestMetaMap[id] = latest;
    }
    return latestMetaMap;
  };

  const capturePreservationState = (uiRefs = {}) => {
    if (!globalState || !Storage) return null;
    try {
      const stateToPreserve = JSON.parse(
        JSON.stringify({ ...globalState, lastApiResponse: null })
      );
      stateToPreserve.logBuffer = logger.getLogBuffer
        ? logger.getLogBuffer()
        : null;
      stateToPreserve.timelineHTML = uiRefs.timelineLog?.innerHTML || "";

      stateToPreserve._artifactContents = {};
      const prefix = config.LS_PREFIX;
      for (const id in stateToPreserve.artifactMetadata) {
        const versions = stateToPreserve.artifactMetadata[id];
        versions.forEach((meta) => {
          const content = Storage.getArtifactContent(
            meta.id,
            meta.latestCycle,
            meta.version_id
          );
          if (content !== null) {
            let key = `${prefix}${meta.id}_${meta.latestCycle}`;
            if (meta.version_id) key += `#${meta.version_id}`;
            stateToPreserve._artifactContents[key] = content;
          }
        });
      }

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
    if (!isInitializedFlag) {
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
      if (preservedData._artifactContents) {
        for (const key in preservedData._artifactContents) {
          localStorage.setItem(key, preservedData._artifactContents[key]);
        }
        logger.logEvent(
          "info",
          `Restored ${
            Object.keys(preservedData._artifactContents).length
          } artifact contents from session.`
        );
      }

      const validationError = StateHelpersPure.validateStateStructurePure(
        preservedData,
        config.STATE_VERSION,
        Utils.getDefaultState
      );
      if (validationError)
        throw new StateError(
          `Session state validation failed: ${validationError}`
        );
      const isCompatible = checkAndLogVersionDifference(
        preservedData.version,
        "sessionStorage"
      );
      if (!isCompatible)
        throw new StateError(
          `Incompatible MAJOR version in session state: ${preservedData.version}`
        );

      _updateGlobalStateReference(
        StateHelpersPure.mergeWithDefaultsPure(
          preservedData,
          Utils.getDefaultState,
          config.STATE_VERSION
        )
      );
      globalState.version = config.STATE_VERSION;

      if (logger.setLogBuffer && preservedData.logBuffer)
        logger.setLogBuffer(preservedData.logBuffer);
      calculateDerivedStatsAndUpdateState(globalState);
      restoreUIFn(preservedData);
      logger.logEvent(
        "info",
        "Session state restored successfully by StateManager."
      );
      _saveInternal();
      return true;
    } catch (e) {
      logger.logEvent("error", `Restore from session failed: ${e.message}`, e);
      init();
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
      "Exporting full state including artifact content..."
    );
    try {
      const stateData = capturePreservationState(uiRefs);
      if (!stateData) {
        logger.logEvent("error", "Failed to capture state for export.");
        if (typeof showNotification === "function")
          showNotification?.("Error capturing state for export.", "error");
        return;
      }
      const fileName = `x0_state_full_${
        config.STATE_VERSION
      }_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
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
      logger.logEvent("info", "Full state export initiated.");
    } catch (e) {
      logger.logEvent("error", `State export failed: ${e.message}`, e);
      if (typeof showNotification === "function")
        showNotification?.(`State export failed: ${e.message}`, "error");
    }
  };

  const importState = (file, importCallback = () => {}) => {
    logger.logEvent("info", "Attempting to import full state...");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!e.target?.result)
          throw new Error("File read returned null result.");
        const importedData = JSON.parse(e.target.result);

        if (importedData._artifactContents) {
          logger.logEvent(
            "info",
            `Importing ${
              Object.keys(importedData._artifactContents).length
            } artifact contents.`
          );
          for (const key in importedData._artifactContents) {
            localStorage.setItem(key, importedData._artifactContents[key]);
          }
        }

        const validationError = StateHelpersPure.validateStateStructurePure(
          importedData,
          config.STATE_VERSION,
          Utils.getDefaultState,
          `imported file '${file.name}'`
        );
        if (validationError)
          throw new StateError(
            `Imported state validation failed: ${validationError}`
          );
        logger.logEvent("info", `Importing state v${importedData.version}`);
        const isCompatible = checkAndLogVersionDifference(
          importedData.version,
          `imported file '${file.name}'`
        );
        if (!isCompatible)
          throw new StateError(
            `Incompatible MAJOR version in imported state: ${importedData.version}`
          );

        _updateGlobalStateReference(
          StateHelpersPure.mergeWithDefaultsPure(
            importedData,
            Utils.getDefaultState,
            config.STATE_VERSION
          )
        );
        globalState.version = config.STATE_VERSION;

        if (logger.setLogBuffer && importedData.logBuffer)
          logger.setLogBuffer(importedData.logBuffer);
        calculateDerivedStatsAndUpdateState(globalState);
        importCallback(true, importedData);
        logger.logEvent("info", "State imported successfully by StateManager.");
        _saveInternal();
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
    return updateAndSaveState((currentState) => {
      if (!currentState.evaluationHistory) currentState.evaluationHistory = [];
      currentState.evaluationHistory.push(result);
      while (currentState.evaluationHistory.length > MAX_HISTORY_ITEMS)
        currentState.evaluationHistory.shift();
      return currentState;
    });
  };

  const addCritiqueFeedback = (feedbackData) => {
    return updateAndSaveState((currentState) => {
      if (!currentState.critiqueFeedbackHistory)
        currentState.critiqueFeedbackHistory = [];
      currentState.critiqueFeedbackHistory.push({
        cycle: currentState.totalCycles,
        feedback: feedbackData,
        timestamp: Date.now(),
      });
      while (currentState.critiqueFeedbackHistory.length > MAX_HISTORY_ITEMS)
        currentState.critiqueFeedbackHistory.shift();
      return currentState;
    });
  };

  const registerWebComponent = (tagName) => {
    return updateAndSaveState((currentState) => {
      if (!Array.isArray(currentState.registeredWebComponents))
        currentState.registeredWebComponents = [];
      if (
        typeof tagName === "string" &&
        tagName.includes("-") &&
        !currentState.registeredWebComponents.includes(tagName)
      ) {
        currentState.registeredWebComponents.push(tagName);
        logger.logEvent(
          "info",
          `StateManager: Web component '${tagName}' marked as registered.`
        );
      } else if (currentState.registeredWebComponents.includes(tagName)) {
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
      return currentState;
    });
  };

  const isWebComponentRegistered = (tagName) =>
    globalState?.registeredWebComponents?.includes(tagName) || false;
  const getRegisteredWebComponents = () => [
    ...(globalState?.registeredWebComponents || []),
  ];

  return {
    init,
    getState,
    updateAndSaveState,
    getArtifactMetadata,
    getArtifactMetadataAllVersions,
    updateArtifactMetadata,
    deleteArtifactMetadata,
    getAllArtifactMetadata,
    capturePreservationState,
    restoreStateFromSession,
    exportState,
    importState,
    isInitialized: () => isInitializedFlag,
    addEvaluationResult,
    addCritiqueFeedback,
    registerWebComponent,
    isWebComponentRegistered,
    getRegisteredWebComponents,
  };
};
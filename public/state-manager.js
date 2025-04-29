const StateManagerModule = (config, logger, Storage) => {
  if (!config || !logger || !Storage) {
    console.error("StateManagerModule requires config, logger, and Storage.");
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
    return {
      init: () => {
        log.logEvent("error", "StateManager not initialized.");
        return false;
      },
      getState: () => null,
      setState: () => {
        log.logEvent("error", "StateManager not initialized.");
      },
      save: () => {
        log.logEvent("error", "StateManager not initialized.");
      },
      getArtifactMetadata: () => null,
      getArtifactMetadataAllVersions: () => [],
      updateArtifactMetadata: () => {},
      deleteArtifactMetadata: () => {},
      getAllArtifactMetadata: () => ({}),
      capturePreservationState: () => null,
      restoreStateFromSession: () => false,
      exportState: () => {},
      importState: () => {},
      getDefaultState: () => ({}),
      addEvaluationResult: () => {},
      addCritiqueFeedback: () => {},
      isInitialized: () => false,
    };
  }

  let globalState = null;
  let artifactMetadata = {};
  let dynamicToolDefinitions = [];
  let isInitialized = false;

  const STATE_VERSION_MAJOR = config.STATE_VERSION.split(".")[0];
  const STATE_VERSION_MINOR = config.STATE_VERSION.split(".")[1];
  const STATE_VERSION_PATCH = config.STATE_VERSION.split(".")[2];

  const MAX_HISTORY_ITEMS = 20;
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
    cfg: { ...config.DEFAULT_CFG },
    artifactMetadata: {},
    dynamicTools: [],
  });

  const calculateDerivedStats = (state) => {
    if (!state) return;

    if (state.confidenceHistory && state.confidenceHistory.length > 0) {
      state.avgConfidence =
        state.confidenceHistory.reduce((a, b) => a + (b || 0), 0) /
        state.confidenceHistory.length;
    } else {
      state.avgConfidence = null;
    }

    if (state.critiqueFailHistory && state.critiqueFailHistory.length > 0) {
      const fails = state.critiqueFailHistory.filter((v) => v === true).length;
      state.critiqueFailRate = (fails / state.critiqueFailHistory.length) * 100;
    } else {
      state.critiqueFailRate = null;
    }

    if (state.tokenHistory && state.tokenHistory.length > 0) {
      state.avgTokens =
        state.tokenHistory.reduce((a, b) => a + b, 0) /
        state.tokenHistory.length;
    } else {
      state.avgTokens = null;
    }

    if (state.evaluationHistory && state.evaluationHistory.length > 0) {
      const validScores = state.evaluationHistory
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
    const defaultState = getDefaultState();
    const requiredKeys = Object.keys(defaultState);
    const optionalKeys = [
      "lastApiResponse",
      "lastGeneratedFullSource",
      "lastSelfAssessment",
    ];

    for (const key of requiredKeys) {
      if (!(key in stateObj) && !optionalKeys.includes(key)) {
        const loadedVersion = stateObj.version?.split(".").map(Number) || [
          0, 0, 0,
        ];
        const currentVersion = config.STATE_VERSION.split(".").map(Number);
        let isOldVersion = false;
        if (loadedVersion.length === 3 && currentVersion.length === 3) {
          if (
            loadedVersion[0] < currentVersion[0] ||
            (loadedVersion[0] === currentVersion[0] &&
              loadedVersion[1] < currentVersion[1]) ||
            (loadedVersion[0] === currentVersion[0] &&
              loadedVersion[1] === currentVersion[1] &&
              loadedVersion[2] < currentVersion[2])
          ) {
            isOldVersion = true;
          }
        }
        if (
          !isOldVersion ||
          ![
            "autonomyMode",
            "autonomyCyclesRemaining",
            "evaluationHistory",
            "critiqueFeedbackHistory",
            "avgEvalScore",
            "evalPassRate",
            "currentContextFocus",
            "contextTokenTarget",
          ].includes(key)
        ) {
          return `Missing required property: '${key}' in state from ${source}`;
        }
      }
    }
    return null;
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
    if (isInitialized) return true;
    const savedState = Storage.getState();
    let validationError = null;

    if (savedState) {
      validationError = validateStateStructure(savedState, "localStorage");
      if (validationError) {
        logger.logEvent(
          "error",
          `Saved state validation failed: ${validationError}. Discarding.`
        );
        Storage.removeState();
        globalState = getDefaultState();
        artifactMetadata = globalState.artifactMetadata || {};
        dynamicToolDefinitions = globalState.dynamicTools || [];
      } else {
        const isCompatible = checkAndLogVersionDifference(
          savedState.version,
          "localStorage"
        );
        if (!isCompatible) {
          Storage.removeState();
          globalState = getDefaultState();
          artifactMetadata = globalState.artifactMetadata || {};
          dynamicToolDefinitions = globalState.dynamicTools || [];
        } else {
          const defaultState = getDefaultState();
          globalState = {
            ...defaultState,
            ...savedState,
            cfg: { ...defaultState.cfg, ...(savedState.cfg || {}) },
            artifactMetadata: savedState.artifactMetadata || {},
            dynamicTools: savedState.dynamicTools || [],
            evaluationHistory: savedState.evaluationHistory || [],
            critiqueFeedbackHistory: savedState.critiqueFeedbackHistory || [],
            autonomyMode: savedState.autonomyMode || "Manual",
            autonomyCyclesRemaining: savedState.autonomyCyclesRemaining || 0,
            contextTokenTarget:
              savedState.contextTokenTarget || defaultState.contextTokenTarget,
          };
          globalState.version = config.STATE_VERSION;
          dynamicToolDefinitions = globalState.dynamicTools;
          artifactMetadata = globalState.artifactMetadata;
          calculateDerivedStats(globalState);
          logger.logEvent(
            "info",
            `Loaded state v${savedState.version} (Cycle ${globalState.totalCycles})`
          );
        }
      }
    } else {
      logger.logEvent(
        "info",
        `No saved state found. Initializing new default state v${config.STATE_VERSION}`
      );
      globalState = getDefaultState();
      artifactMetadata = globalState.artifactMetadata || {};
      if (config.GENESIS_ARTIFACT_DEFS) {
        for (const id in config.GENESIS_ARTIFACT_DEFS) {
          if (id === "reploid.core.config") continue;
          const def = config.GENESIS_ARTIFACT_DEFS[id];
          if (!artifactMetadata[id]) {
            artifactMetadata[id] = [
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
      globalState.artifactMetadata = artifactMetadata;
      dynamicToolDefinitions = globalState.dynamicTools || [];
    }

    save();
    isInitialized = true;
    return globalState && globalState.totalCycles > 0;
  };

  const getState = () => globalState;

  const setState = (newState) => {
    const validationError = validateStateStructure(newState, "setState call");
    if (validationError) {
      logger.logEvent(
        "error",
        `Attempted to set invalid state: ${validationError}`
      );
      return;
    }
    globalState = newState;
    if (globalState) {
      artifactMetadata = globalState.artifactMetadata || {};
      dynamicToolDefinitions = globalState.dynamicTools || [];
    } else {
      artifactMetadata = {};
      dynamicToolDefinitions = [];
    }
  };

  const save = () => {
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
    const history = artifactMetadata[id];
    if (!history || history.length === 0) return null;
    if (versionId === null) {
      return history.sort((a, b) => {
        if (b.latestCycle !== a.latestCycle)
          return b.latestCycle - a.latestCycle;
        return b.timestamp - a.timestamp;
      })[0];
    } else {
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
    let existingIndex = -1;
    if (versionId !== null) {
      existingIndex = artifactMetadata[id].findIndex(
        (meta) => meta.version_id === versionId
      );
    } else {
      const latestMeta = getArtifactMetadata(id, null);
      if (latestMeta) {
        existingIndex = artifactMetadata[id].findIndex(
          (meta) => meta === latestMeta
        );
      }
    }

    const newMeta = {
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

    if (existingIndex !== -1) {
      const currentMeta = artifactMetadata[id][existingIndex];
      newMeta.type = type ?? currentMeta.type;
      newMeta.description = description ?? currentMeta.description;
      newMeta.latestCycle = Math.max(cycle, currentMeta.latestCycle ?? -1);
      newMeta.checksum = checksum ?? currentMeta.checksum;
      newMeta.source = source ?? currentMeta.source;
      newMeta.isModularEdit = isModular ?? currentMeta.isModularEdit ?? false;

      artifactMetadata[id][existingIndex] = newMeta;
    } else {
      const baseMeta = getArtifactMetadata(id, null);
      newMeta.type = type ?? baseMeta?.type ?? "UNKNOWN";
      newMeta.description =
        description ?? baseMeta?.description ?? `Artifact ${id}`;
      newMeta.latestCycle = cycle;
      newMeta.checksum = checksum;
      newMeta.source = source;
      newMeta.isModularEdit = isModular;
      artifactMetadata[id].push(newMeta);
    }

    if (globalState) globalState.artifactMetadata = artifactMetadata;
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
      delete artifactMetadata[id];
    }
    if (globalState) globalState.artifactMetadata = artifactMetadata;
  };

  const getAllArtifactMetadata = () => {
    const latestMetaMap = {};
    for (const id in artifactMetadata) {
      const latest = getArtifactMetadata(id, null);
      if (latest) {
        latestMetaMap[id] = latest;
      }
    }
    return latestMetaMap;
  };

  const capturePreservationState = (uiRefs = {}) => {
    if (!globalState) return null;
    try {
      const stateToSave = JSON.parse(
        JSON.stringify({ ...globalState, lastApiResponse: null })
      );
      stateToSave.logBuffer = logger.getLogBuffer
        ? logger.getLogBuffer()
        : null;
      stateToSave.timelineHTML = uiRefs.timelineLog?.innerHTML || "";

      return stateToSave;
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

    logger.logEvent("info", "Preserved session state found.");
    try {
      const validationError = validateStateStructure(
        preservedData,
        "sessionStorage"
      );
      if (validationError) {
        throw new Error(`Session state validation failed: ${validationError}`);
      }

      const isCompatible = checkAndLogVersionDifference(
        preservedData.version,
        "sessionStorage"
      );
      if (!isCompatible) {
        throw new Error(
          `Incompatible MAJOR version in session state: ${preservedData.version}`
        );
      }

      const defaultState = getDefaultState();
      globalState = {
        ...defaultState,
        ...preservedData,
        cfg: { ...defaultState.cfg, ...(preservedData.cfg || {}) },
        artifactMetadata: preservedData.artifactMetadata || {},
        dynamicTools: preservedData.dynamicTools || [],
        evaluationHistory: preservedData.evaluationHistory || [],
        critiqueFeedbackHistory: preservedData.critiqueFeedbackHistory || [],
        autonomyMode: preservedData.autonomyMode || "Manual",
        autonomyCyclesRemaining: preservedData.autonomyCyclesRemaining || 0,
        contextTokenTarget:
          preservedData.contextTokenTarget || defaultState.contextTokenTarget,
      };
      globalState.version = config.STATE_VERSION;

      if (logger.setLogBuffer && preservedData.logBuffer) {
        logger.setLogBuffer(preservedData.logBuffer);
      }
      dynamicToolDefinitions = globalState.dynamicTools;
      artifactMetadata = globalState.artifactMetadata;
      calculateDerivedStats(globalState);

      restoreUIFn(preservedData);

      logger.logEvent(
        "info",
        "Session state restored successfully by StateManager."
      );
      save();
      return true;
    } catch (e) {
      logger.logEvent("error", `Restore from session failed: ${e.message}`, e);
      init();
      return false;
    } finally {
      Storage.removeSessionState();
      logger.logEvent("debug", "Cleared session state from storage.");
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
          throw new Error(
            `Imported state validation failed: ${validationError}`
          );
        }
        logger.logEvent("info", `Importing state v${importedData.version}`);

        const isCompatible = checkAndLogVersionDifference(
          importedData.version,
          `imported file '${file.name}'`
        );
        if (!isCompatible) {
          throw new Error(
            `Incompatible MAJOR version in imported state: ${importedData.version}`
          );
        }

        const defaultState = getDefaultState();
        globalState = {
          ...defaultState,
          ...importedData,
          cfg: { ...defaultState.cfg, ...(importedData.cfg || {}) },
          artifactMetadata: importedData.artifactMetadata || {},
          dynamicTools: importedData.dynamicTools || [],
          evaluationHistory: importedData.evaluationHistory || [],
          critiqueFeedbackHistory: importedData.critiqueFeedbackHistory || [],
          autonomyMode: importedData.autonomyMode || "Manual",
          autonomyCyclesRemaining: importedData.autonomyCyclesRemaining || 0,
          contextTokenTarget:
            importedData.contextTokenTarget || defaultState.contextTokenTarget,
        };
        globalState.version = config.STATE_VERSION;

        if (logger.setLogBuffer && importedData.logBuffer) {
          logger.setLogBuffer(importedData.logBuffer);
        }
        dynamicToolDefinitions = globalState.dynamicTools;
        artifactMetadata = globalState.artifactMetadata;
        calculateDerivedStats(globalState);

        importCallback(true, importedData);

        logger.logEvent("info", "State imported successfully by StateManager.");
        save();
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
    calculateDerivedStats(globalState);
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
  };
};

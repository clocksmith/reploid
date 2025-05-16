const StateHelpersPureModule = (() => {

  const calculateDerivedStatsPure = (
    confidenceHistory = [],
    critiqueFailHistory = [],
    tokenHistory = [],
    evaluationHistory = [],
    maxHistoryItems = 20,
    evalPassThreshold = 0.75
  ) => {
    const stats = {
      avgConfidence: null,
      critiqueFailRate: null,
      avgTokens: null,
      avgEvalScore: null,
      evalPassRate: null,
    };

    const confHistorySlice = confidenceHistory.slice(-maxHistoryItems);
    if (confHistorySlice.length > 0) {
      stats.avgConfidence = confHistorySlice.reduce((a, b) => a + (b || 0), 0) / confHistorySlice.length;
    }

    const critHistorySlice = critiqueFailHistory.slice(-maxHistoryItems);
    if (critHistorySlice.length > 0) {
      const fails = critHistorySlice.filter((v) => v === true).length;
      stats.critiqueFailRate = (fails / critHistorySlice.length) * 100;
    }

    const tokenHistorySlice = tokenHistory.slice(-maxHistoryItems);
    if (tokenHistorySlice.length > 0) {
      stats.avgTokens = tokenHistorySlice.reduce((a, b) => a + (b || 0), 0) / tokenHistorySlice.length;
    }

    const evalHistorySlice = evaluationHistory.slice(-maxHistoryItems);
    if (evalHistorySlice.length > 0) {
      const validScores = evalHistorySlice.map((e) => e.evaluation_score).filter((s) => typeof s === "number" && !isNaN(s));
      if (validScores.length > 0) {
        stats.avgEvalScore = validScores.reduce((a, b) => a + b, 0) / validScores.length;
        const passes = validScores.filter((s) => s >= evalPassThreshold).length;
        stats.evalPassRate = (passes / validScores.length) * 100;
      }
    }
    return stats;
  };

  const validateStateStructurePure = (stateObj, configStateVersion, defaultStateFactory) => {
    if (!stateObj || typeof stateObj !== "object") return "Invalid state object";

    const defaultState = defaultStateFactory(configStateVersion ? { STATE_VERSION: configStateVersion, DEFAULT_CFG: {} } : null );
    const requiredKeys = Object.keys(defaultState);
    const optionalKeys = ["lastApiResponse", "lastGeneratedFullSource", "lastSelfAssessment"];

    for (const key of requiredKeys) {
      if (!(key in stateObj) && !optionalKeys.includes(key)) {
        const loadedVersion = stateObj.version?.split(".").map(Number) || [0,0,0];
        const currentVersion = configStateVersion?.split(".").map(Number) || [0,0,0];
        let isOlderMajorMinor = false;
        if (loadedVersion.length === 3 && currentVersion.length === 3) {
          if (loadedVersion[0] < currentVersion[0] || (loadedVersion[0] === currentVersion[0] && loadedVersion[1] < currentVersion[1])) {
            isOlderMajorMinor = true;
          }
        }
        if (!isOlderMajorMinor) {
          const criticalKeys = ["version", "totalCycles", "artifactMetadata", "dynamicTools", "cfg", "registeredWebComponents"];
          if (criticalKeys.includes(key)) {
            return `Missing critical property: '${key}' (v${stateObj.version})`;
          }
        }
      }
    }
    if (!Array.isArray(stateObj.registeredWebComponents)) {
      return "Property 'registeredWebComponents' must be an array";
    }
    return null;
  };

  const mergeWithDefaultsPure = (loadedState, defaultStateFactory, configStateVersion) => {
    const defaultState = defaultStateFactory(configStateVersion ? { STATE_VERSION: configStateVersion, DEFAULT_CFG: {} } : null );
    const mergedState = {
      ...defaultState,
      ...loadedState,
      cfg: { ...defaultState.cfg, ...(loadedState.cfg || {}) },
      artifactMetadata: loadedState.artifactMetadata || {},
      dynamicTools: loadedState.dynamicTools || [],
      registeredWebComponents: Array.isArray(loadedState.registeredWebComponents) ? loadedState.registeredWebComponents : [],
    };
    const historyKeys = [
      "confidenceHistory", "critiqueFailHistory", "tokenHistory",
      "failHistory", "evaluationHistory", "critiqueFeedbackHistory", "htmlHistory",
    ];
    historyKeys.forEach((key) => {
      if (!Array.isArray(mergedState[key])) mergedState[key] = [];
    });
    return mergedState;
  };

  return {
    calculateDerivedStatsPure,
    validateStateStructurePure,
    mergeWithDefaultsPure,
  };
})();
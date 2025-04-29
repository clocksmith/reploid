const UtilsModule = (() => {
  const MAX_LOG_ENTRIES = 1000;
  let logBufferArray = new Array(MAX_LOG_ENTRIES);
  let logBufferIndex = 0;
  let logBufferInitialized = false;

  const initLogBuffer = () => {
    logBufferArray.fill(null);
    logBufferIndex = 0;
    logBufferArray[
      logBufferIndex++
    ] = `REPLOID Session Log Start - ${new Date().toISOString()}\n=========================================\n`;
    logBufferInitialized = true;
  };

  const stringifyDetail = (detail) => {
    if (detail === undefined || detail === null) return "";
    if (typeof detail === "string") return detail;
    if (detail instanceof Error)
      return `Error: ${detail.message}${
        detail.stack ? `\nStack: ${detail.stack}` : ""
      }`;
    try {
      return JSON.stringify(detail, (key, value) =>
        typeof value === "bigint" ? value.toString() : value
      );
    } catch (e) {
      return "[Unserializable Object]";
    }
  };

  const logger = {
    logEvent: (level = "info", message = "[No Message]", ...details) => {
      if (!logBufferInitialized) {
        initLogBuffer();
      }

      const timestamp = new Date().toISOString();
      const levelUpper = String(level).toUpperCase();
      let logLine = `[${timestamp}] [${levelUpper}] ${String(message)}`;

      const detailsString = details
        .map(stringifyDetail)
        .filter((s) => s !== "")
        .join(" | ");
      if (detailsString) {
        logLine += ` | ${detailsString}`;
      }

      logBufferArray[logBufferIndex % MAX_LOG_ENTRIES] = logLine;
      logBufferIndex++;

      const consoleMethod =
        level?.toLowerCase() === "error"
          ? console.error
          : level?.toLowerCase() === "warn"
          ? console.warn
          : level?.toLowerCase() === "debug"
          ? console.debug
          : console.log;

      consoleMethod(logLine);
    },

    getLogBuffer: () => {
      if (!logBufferInitialized) return "Log buffer not initialized.\n";
      const bufferSize = Math.min(logBufferIndex, MAX_LOG_ENTRIES);
      const startIndex =
        logBufferIndex <= MAX_LOG_ENTRIES
          ? 0
          : logBufferIndex % MAX_LOG_ENTRIES;
      const logLines = [];
      for (let i = 0; i < bufferSize; i++) {
        const currentIndex = (startIndex + i) % MAX_LOG_ENTRIES;
        if (logBufferArray[currentIndex] !== null) {
          logLines.push(logBufferArray[currentIndex]);
        }
      }
      let logContent = logLines.join("\n") + "\n";

      if (logBufferIndex > MAX_LOG_ENTRIES) {
        logContent =
          `... (Log truncated - showing last ${MAX_LOG_ENTRIES} entries) ...\n` +
          logContent;
      }
      return logContent;
    },

    setLogBuffer: (newBuffer) => {
      initLogBuffer();
      if (typeof newBuffer === "string") {
        const lines = newBuffer.split("\n").filter((line) => line);
        const startIndex = Math.max(0, lines.length - MAX_LOG_ENTRIES);
        let loadedCount = 0;
        for (let i = startIndex; i < lines.length; i++) {
          logBufferArray[logBufferIndex % MAX_LOG_ENTRIES] = lines[i];
          logBufferIndex++;
          loadedCount++;
        }
        if (lines.length > MAX_LOG_ENTRIES) {
          const header = `... (Log truncated during import - loaded last ${loadedCount} lines) ...`;
          const headerIndex = (logBufferIndex - loadedCount) % MAX_LOG_ENTRIES;
          logBufferArray[headerIndex] = header;
        }
      } else {
        logger.logEvent(
          "warn",
          "setLogBuffer received invalid buffer type, resetting."
        );
      }
    },
  };

  const $id = (id) => document.getElementById(id);
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const kabobToCamel = (s) =>
    String(s ?? "").replace(/-([a-z])/g, (g) => g[1].toUpperCase());
  const camelToKabob = (s) =>
    String(s ?? "")
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase();

  const trunc = (str, len, ellipsis = "...") => {
    const s = String(str ?? "");
    if (s.length <= len) return s;
    const ellipsisLen = ellipsis?.length ?? 0;
    return s.substring(0, Math.max(0, len - ellipsisLen)) + ellipsis;
  };

  const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return "";
    return String(unsafe)
      .replace(/&/g, "&")
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/"/g, '"')
      .replace(/'/g, "'");
  };

  const lc = (s) => String(s ?? "").toLowerCase();
  const uc = (s) => String(s ?? "").toUpperCase();

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getRandomInt = (min, max) => {
    const minCeil = Math.ceil(min);
    const maxFloor = Math.floor(max);
    return Math.floor(Math.random() * (maxFloor - minCeil + 1)) + minCeil;
  };

  const getLatestMeta = (historyArray) => {
    if (!historyArray || historyArray.length === 0) return null;
    return [...historyArray].sort((a, b) => {
      if (b.latestCycle !== a.latestCycle) return b.latestCycle - a.latestCycle;
      return (b.timestamp || 0) - (a.timestamp || 0);
    })[0];
  };

  const getDefaultState = () => ({
    version: "0.0.0",
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
    contextTokenTarget: 350000,
    lastGeneratedFullSource: null,
    htmlHistory: [],
    lastApiResponse: null,
    retryCount: 0,
    autonomyMode: "Manual",
    autonomyCyclesRemaining: 0,
    cfg: {},
    artifactMetadata: {},
    dynamicTools: [],
  });

  return {
    logger,
    $id,
    $,
    $$,
    kabobToCamel,
    camelToKabob,
    trunc,
    escapeHtml,
    lc,
    uc,
    delay,
    getRandomInt,
    getLatestMeta,
    getDefaultState,
  };
})();

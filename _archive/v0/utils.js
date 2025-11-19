const UtilsModule = (() => {
  class ApplicationError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = this.constructor.name;
      this.details = details;
      if (typeof Error.captureStackTrace === "function") {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error(message).stack;
      }
    }
  }

  class ApiError extends ApplicationError {
    constructor(message, status = null, code = null, apiDetails = {}) {
      super(message, { status, code, ...apiDetails });
      this.status = status;
      this.code = code;
    }
  }

  class ToolError extends ApplicationError {
    constructor(message, toolName = null, toolArgs = null, toolDetails = {}) {
      super(message, { toolName, toolArgs, ...toolDetails });
      this.toolName = toolName;
    }
  }

  class StateError extends ApplicationError {
    constructor(message, stateDetails = {}) {
      super(message, stateDetails);
    }
  }

  class ConfigError extends ApplicationError {
    constructor(message, configKey = null, configDetails = {}) {
      super(message, { configKey, ...configDetails });
      this.configKey = configKey;
    }
  }

  class ArtifactError extends ApplicationError {
    constructor(
      message,
      artifactId = null,
      artifactCycle = null,
      artifactDetails = {}
    ) {
      super(message, { artifactId, artifactCycle, ...artifactDetails });
      this.artifactId = artifactId;
    }
  }

  class AbortError extends ApplicationError {
    constructor(message = "Operation aborted") {
      super(message);
      this.isAbortError = true;
    }
  }

  class WebComponentError extends ApplicationError {
    constructor(message, componentName = null, componentDetails = {}) {
      super(message, { componentName, ...componentDetails });
      this.componentName = componentName;
    }
  }

  const Errors = {
    ApplicationError,
    ApiError,
    ToolError,
    StateError,
    ConfigError,
    ArtifactError,
    AbortError,
    WebComponentError,
  };

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
      if (!logBufferInitialized) initLogBuffer();
      const timestamp = new Date().toISOString();
      const levelUpper = String(level).toUpperCase();
      let logLine = `[${timestamp}] [${levelUpper}] ${String(message)}`;
      const detailsString = details
        .map(stringifyDetail)
        .filter((s) => s !== "")
        .join(" | ");
      if (detailsString) logLine += ` | ${detailsString}`;
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
        if (logBufferArray[currentIndex] !== null)
          logLines.push(logBufferArray[currentIndex]);
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
  const ucFirst = (s) => {
    const str = String(s ?? "");
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const trunc = (str, len, ellipsis = "...") => {
    const s = String(str ?? "");
    if (s.length <= len) return s;
    const ellipsisLen = ellipsis?.length ?? 0;
    return s.substring(0, Math.max(0, len - ellipsisLen)) + ellipsis;
  };

  const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return "";
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  const getDefaultState = (appConfig) => ({
    version: appConfig.STATE_VERSION,
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
    contextTokenTarget: appConfig.CTX_TARGET || 700000,
    lastGeneratedFullSource: null,
    htmlHistory: [],
    lastApiResponse: null,
    retryCount: 0,
    autonomyMode: "Manual",
    autonomyCyclesRemaining: 0,
    cfg: { ...(appConfig.DEFAULT_CFG || {}) },
    artifactMetadata: {},
    dynamicTools: [],
    registeredWebComponents: [],
  });

  async function calculateChecksum(content) {
    if (typeof content !== "string") return null;
    try {
      const msgUint8 = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return `sha256-${hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`;
    } catch (error) {
      logger.logEvent("error", "Checksum calculation failed:", error);
      return null;
    }
  }

  function sanitizeLlmJsonRespPure(rawText, externalLogger) {
    if (!rawText || typeof rawText !== "string")
      return { sanitizedJson: "{}", method: "invalid input" };
    let text = rawText.trim();
    let jsonString = null;
    let method = "none";

    try {
      JSON.parse(text);
      jsonString = text;
      method = "direct parse";
    } catch (e1) {
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        text = codeBlockMatch[1].trim();
        method = "code block";
        try {
          JSON.parse(text);
          jsonString = text;
        } catch (e2) {}
      }

      if (!jsonString) {
        const firstBrace = text.indexOf("{");
        const firstBracket = text.indexOf("[");
        let startIndex = -1;

        if (firstBrace !== -1 && firstBracket !== -1)
          startIndex = Math.min(firstBrace, firstBracket);
        else if (firstBrace !== -1) startIndex = firstBrace;
        else startIndex = firstBracket;

        if (startIndex !== -1) {
          text = text.substring(startIndex);
          const startChar = text[0];
          const endChar = startChar === "{" ? "}" : "]";
          let balance = 0;
          let lastValidIndex = -1;
          let inString = false;
          let escapeNext = false;
          method = "heuristic balance";

          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inString) {
              if (escapeNext) escapeNext = false;
              else if (char === "\\") escapeNext = true;
              else if (char === '"') inString = false;
            } else {
              if (char === '"') inString = true;
              else if (char === startChar) balance++;
              else if (char === endChar) balance--;
            }
            if (!inString && balance === 0 && startIndex === 0) {
              lastValidIndex = i;
              break;
            }
            if (!inString && balance === 0 && i > 0 && startIndex > 0) {
              lastValidIndex = i;
              break;
            }
          }

          if (lastValidIndex !== -1) {
            text = text.substring(0, lastValidIndex + 1);
            try {
              JSON.parse(text);
              jsonString = text;
            } catch (e3) {
              externalLogger?.logEvent(
                "warn",
                `JSON sanitization failed (heuristic parse): ${e3.message}`,
                text.substring(0, 100) + "..."
              );
              method = "heuristic failed";
              jsonString = null;
            }
          } else {
            externalLogger?.logEvent(
              "warn",
              "JSON sanitization failed: Unbalanced structure after heuristic.",
              text.substring(0, 100)
            );
            method = "heuristic unbalanced";
            jsonString = null;
          }
        } else {
          method = "no structure found";
          jsonString = null;
        }
      }
    }
    return { sanitizedJson: jsonString || "{}", method };
  }

  return {
    Errors,
    logger,
    $id,
    $,
    $$,
    kabobToCamel,
    camelToKabob,
    ucFirst,
    trunc,
    escapeHtml,
    lc,
    uc,
    delay,
    getRandomInt,
    getLatestMeta,
    getDefaultState,
    calculateChecksum,
    sanitizeLlmJsonRespPure,
  };
})();

(async () => {
  const startContainer = document.getElementById("start-container");
  const loadingContainer = document.getElementById("loading-container");
  const loadingIndicator = document.getElementById("loading-indicator");
  const appRoot = document.getElementById("app-root");
  const continueButton = document.getElementById("continue-button");
  const resetButton = document.getElementById("reset-button");

  let bootstrapLogMessages = `REPLOID Bootstrap Log - ${new Date().toISOString()}\n=========================================\n`;
  let audioCtx = null;
  let isAudioInitAttempted = false;
  let interactionStarted = false;
  let uiUpdatePromise = Promise.resolve();
  let skipBootstrapAnimation = false;

  let config = null;
  let Utils = null;
  let Storage = null;
  // Errors should be globally available from errors.js loaded in index.html
  // but we can assign it here for clarity if needed within this scope after loading
  let ErrorsScope = null;
  let blLogger = null;

  const bl = (() => {
    const MIN_TONE_INTERVAL_MS = 32;
    const TONE_DURATION_MS = 50;
    let lastToneTime = 0;

    const initAudioContextInternal = () => {
      if (!isAudioInitAttempted && !audioCtx) {
        isAudioInitAttempted = true;
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
          const logFunc = blLogger ? blLogger.logEvent : console.warn;
          logFunc("warn", "AudioContext init failed:", e.message);
          audioCtx = null;
        }
      }
      return audioCtx;
    };

    const playTone = (frequency, fixedDurationMs, oscType) => {
      if (skipBootstrapAnimation) return;
      const currentAudioCtx = initAudioContextInternal();
      if (
        !currentAudioCtx ||
        typeof currentAudioCtx.createOscillator !== "function"
      )
        return;
      try {
        const oscillator = currentAudioCtx.createOscillator();
        const gainNode = currentAudioCtx.createGain();
        const duration = Math.max(fixedDurationMs / 1000, 0.01);
        oscillator.type = oscType;
        oscillator.frequency.setValueAtTime(
          frequency,
          currentAudioCtx.currentTime
        );
        gainNode.gain.setValueAtTime(0.3, currentAudioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.001,
          currentAudioCtx.currentTime + duration
        );
        oscillator.connect(gainNode).connect(currentAudioCtx.destination);
        oscillator.start();
        oscillator.stop(currentAudioCtx.currentTime + duration);
      } catch (e) {
        const logFunc = blLogger ? blLogger.logEvent : console.warn;
        logFunc("warn", "Tone playback error:", e.message);
        audioCtx = null;
      }
    };

    return async function blInternal(
      message,
      level = "info",
      detail = null,
      charDelay = 1
    ) {
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${
        detail ? ` | ${detail}` : ""
      }`;
      bootstrapLogMessages += logLine + "\n";

      let skipConsoleOutput = false;
      let skipUiOutput = false;
      let effectiveLevel = level;

      if (level === "only-gui") {
        skipConsoleOutput = true;
        effectiveLevel = "info";
      } else if (level === "only-console" || level === "detail") {
        skipUiOutput = true;
        effectiveLevel = "info";
      }

      if (!skipConsoleOutput) {
        const logFunc = blLogger
          ? blLogger.logEvent
          : console[
              effectiveLevel === "error"
                ? "error"
                : effectiveLevel === "warn"
                ? "warn"
                : "log"
            ];
        if (blLogger) {
          logFunc(effectiveLevel, message, detail || "");
        } else {
          logFunc(logLine);
        }
      }

      if (skipUiOutput || !loadingIndicator) return;

      uiUpdatePromise = uiUpdatePromise
        .then(async () => {
          const logEntryContainer = document.createElement("div");
          logEntryContainer.className = `log-entry log-${effectiveLevel}`;
          loadingIndicator.appendChild(logEntryContainer);
          const fullText = `> ${message}${detail ? ` | ${detail}` : ""}`;

          if (skipBootstrapAnimation) {
            logEntryContainer.textContent = fullText;
          } else {
            if (effectiveLevel === "error")
              playTone(220, TONE_DURATION_MS, "square");
            lastToneTime = performance.now();
            for (const char of fullText) {
              logEntryContainer.textContent += char;
              if (loadingIndicator.scrollTop !== undefined) {
                loadingIndicator.scrollTop = loadingIndicator.scrollHeight;
              }
              const currentTime = performance.now();
              if (
                char.trim() &&
                effectiveLevel !== "error" &&
                currentTime - lastToneTime >= MIN_TONE_INTERVAL_MS
              ) {
                playTone(990, TONE_DURATION_MS, "triangle");
                lastToneTime = currentTime;
              }
              if (charDelay > 0) {
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.max(charDelay, 1))
                );
              }
              if (skipBootstrapAnimation) {
                logEntryContainer.textContent = fullText;
                break;
              }
            }
          }
          if (loadingIndicator.scrollTop !== undefined) {
            loadingIndicator.scrollTop = loadingIndicator.scrollHeight;
          }
        })
        .catch((error) => {
          const logMsg = "Error during bootstrap logging UI update:";
          const errorLogFunc = blLogger ? blLogger.logEvent : console.error;
          errorLogFunc("error", logMsg, error);
          uiUpdatePromise = Promise.resolve();
        });
      await uiUpdatePromise;
    };
  })();

  const initAudioContext = () => {
    if (!isAudioInitAttempted && !audioCtx) {
      isAudioInitAttempted = true;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        const logFunc = blLogger ? blLogger.logEvent : console.warn;
        logFunc("warn", "AudioContext init failed on demand:", e.message);
        audioCtx = null;
      }
    }
    return audioCtx;
  };

  async function calculateChecksum(content) {
    if (typeof content !== "string") return null;
    try {
      const msgUint8 = new TextEncoder().encode(content);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `sha256-${hashHex}`;
    } catch (error) {
      const logFunc = blLogger ? blLogger.logEvent : console.error;
      logFunc("error", "Checksum calculation failed:", error);
      return null;
    }
  }

  async function fetchAndExecuteModule(
    filePath,
    exportName,
    dependencies = {}
  ) {
    const loggerInstance = blLogger || {
      logEvent: (lvl, msg, det) =>
        console.error(`[BOOTSTRAP FALLBACK] ${msg}`, det || ""),
    };
    // Ensure Errors (globally defined by errors.js) is part of dependencies if not already passed explicitly
    const allDependencies = {
      ...dependencies,
      Errors: window.Errors || ErrorsScope,
    }; // Use window.Errors as it's set by errors.js
    const depNames = Object.keys(allDependencies);
    const depValues = Object.values(allDependencies);

    if (
      depNames.length !== depValues.length ||
      depValues.some((dep) => dep === undefined || dep === null)
    ) {
      const missing = depNames.filter(
        (name, i) => depValues[i] === undefined || depValues[i] === null
      );
      loggerInstance.logEvent(
        "error",
        `Cannot load module ${filePath}: Missing dependencies ${missing.join(
          ", "
        )}`,
        allDependencies
      );
      throw new (window.ConfigError || Error)(
        `Dependency error for ${filePath}: Missing ${missing.join(", ")}`,
        filePath
      );
    }

    try {
      const response = await fetch(
        filePath + `?v=${config?.STATE_VERSION || Date.now()}`
      );
      if (!response.ok)
        throw new (window.ApiError || Error)(
          `HTTP ${response.status} for ${filePath}`,
          response.status
        );
      const scriptContent = await response.text();
      const tempScope = {};
      const funcArgs = ["tempScope", ...depNames];
      const funcBody = `${scriptContent}\ntempScope.result = (typeof ${exportName} !== 'undefined') ? ${exportName} : undefined;`;

      const factoryFunction = new Function(...funcArgs, funcBody);
      factoryFunction(tempScope, ...depValues);

      if (tempScope.result === undefined) {
        loggerInstance.logEvent(
          "warn",
          `Module ${filePath} executed, but export '${exportName}' was not found.`
        );
        throw new (window.ConfigError || Error)(
          `Module ${filePath} did not yield expected export '${exportName}'.`,
          filePath
        );
      }

      if (
        exportName.endsWith("Module") &&
        typeof tempScope.result === "function"
      ) {
        const moduleFactory = tempScope.result;
        const moduleInstance = moduleFactory(...depValues); // Pass all dependencies
        if (!moduleInstance) {
          loggerInstance.logEvent(
            "error",
            `Module factory ${exportName} from ${filePath} returned null/undefined.`
          );
          throw new (window.ConfigError || Error)(
            `Module factory ${exportName} did not return an instance.`,
            filePath
          );
        }
        loggerInstance.logEvent(
          "debug",
          `Module factory ${exportName} executed successfully.`
        );
        return moduleInstance;
      } else {
        loggerInstance.logEvent(
          "debug",
          `Returning direct export ${exportName} from ${filePath}.`
        );
        return tempScope.result;
      }
    } catch (error) {
      loggerInstance.logEvent(
        "error",
        `Fatal Error loading/executing module ${filePath}`,
        error.message + (error.stack ? `\nStack: ${error.stack}` : "")
      );
      throw error;
    }
  }

  async function loadCoreDependencies() {
    try {
      await bl("Loading core configuration...", "info", null, 0);
      const configResponse = await fetch("config.json");
      if (!configResponse.ok)
        throw new (window.ApiError || Error)(
          `HTTP ${configResponse.status} loading config.json`,
          configResponse.status
        );
      config = await configResponse.json();
      if (!config)
        throw new (window.ConfigError || Error)("Failed to parse config.json");
      await bl(
        "Config loaded.",
        "only-console",
        `Version: ${config.STATE_VERSION}`
      );

      // Errors are loaded via script tag in index.html, so window.Errors should be available.
      // Assign to ErrorsScope for clarity within this module if needed, or ensure all modules get it.
      if (typeof window.Errors === "object") {
        ErrorsScope = window.Errors;
      } else {
        throw new Error(
          "Custom Error definitions (errors.js) not loaded globally."
        );
      }
      await bl("Custom errors assumed loaded.", "only-console");

      await bl("Loading core utilities...", "info", null, 0);
      Utils = await fetchAndExecuteModule("utils.js", "UtilsModule", {
        Errors: ErrorsScope,
      }); // Pass Errors
      if (!Utils || !Utils.logger)
        throw new (window.ConfigError || Error)(
          "Failed to load UtilsModule correctly."
        );
      blLogger = Utils.logger;
      await bl("Utils loaded.", "only-console");

      await bl("Loading core storage...", "info", null, 0);
      Storage = await fetchAndExecuteModule("storage.js", "StorageModule", {
        config,
        logger: Utils.logger,
        Errors: ErrorsScope,
      });
      if (!Storage || typeof Storage.getState !== "function")
        throw new (window.ConfigError || Error)(
          "Failed to load StorageModule correctly."
        );
      await bl("Storage loaded.", "only-console");

      await bl("Core dependencies loaded.", "success", null, 0);
      return true;
    } catch (error) {
      const errorMsg =
        error.message || "Unknown error loading core dependencies.";
      await bl("FATAL: Failed to load core dependencies.", "error", errorMsg);
      console.error("Dependency Load Error:", error);
      if (loadingIndicator)
        loadingIndicator.innerHTML = `<div class="log-entry log-error">> FATAL BOOTSTRAP ERROR: ${errorMsg}. Cannot continue. Check console.</div>`;
      if (loadingContainer) loadingContainer.classList.remove("hidden");
      if (startContainer) startContainer.classList.add("hidden");
      removeInteractionListeners();
      return false;
    }
  }

  // isValidState, verifyArtifactChecksum, checkEssentialArtifactsPresent, clearAllReploidData remain similar
  // but should use window.ConfigError, window.ApiError etc. if they throw.
  function isValidState(parsedState) {
    if (!config || !parsedState) return false;
    const stateVersionMajor = config.STATE_VERSION.split(".")[0];
    const parsedVersionMajor = parsedState.version?.split(".")[0];
    const validVersion = parsedVersionMajor === stateVersionMajor;
    const basicStructureValid =
      typeof parsedState.totalCycles === "number" &&
      parsedState.totalCycles >= 0 &&
      parsedState.artifactMetadata &&
      typeof parsedState.artifactMetadata === "object" &&
      Array.isArray(parsedState.registeredWebComponents); // New check
    if (!validVersion)
      bl(
        "State version mismatch.",
        "warn",
        `Found: ${parsedState.version}, Required Major: ${stateVersionMajor}`
      );
    if (!basicStructureValid)
      bl(
        "State basic structure invalid.",
        "warn",
        `Missing cycles, metadata, or web component registry.`
      );
    return validVersion && basicStructureValid;
  }

  async function verifyArtifactChecksum(
    id,
    cycle,
    expectedChecksum,
    versionId = null
  ) {
    if (!expectedChecksum) return true;
    const content = Storage.getArtifactContent(id, cycle, versionId);
    if (content === null) return false;
    let actualChecksum = await calculateChecksum(content);
    if (!actualChecksum) {
      await bl(
        `Checksum calculation failed for ${id}_${cycle}${
          versionId ? "#" + versionId : ""
        }`,
        "error"
      );
      return false;
    }
    if (actualChecksum !== expectedChecksum) {
      await bl(
        `Checksum mismatch for ${id}_${cycle}${
          versionId ? "#" + versionId : ""
        }`,
        "warn",
        `Expected: ${expectedChecksum}, Actual: ${actualChecksum}`
      );
      return false;
    }
    return true;
  }

  async function checkEssentialArtifactsPresent(stateCycle, artifactMetadata) {
    if (!Storage || !config || !artifactMetadata) return false;
    await bl(
      `Verifying essential artifacts for state cycle ${stateCycle}...`,
      "info",
      null,
      0
    );
    let allFoundAndValid = true;
    const essentialDefs = config.GENESIS_ARTIFACT_DEFS || {};
    const verificationPromises = [];

    for (const id in essentialDefs) {
      if (id === "reploid.core.config" || id === "reploid.core.errors")
        continue; // Not stored/verified this way
      const metaHistory = artifactMetadata[id];
      let latestMeta = null;
      if (metaHistory && metaHistory.length > 0) {
        const getLatestMetaFn =
          Utils?.getLatestMeta ||
          ((arr) =>
            arr
              ? arr.sort(
                  (a, b) =>
                    b.latestCycle - a.latestCycle || b.timestamp - a.timestamp
                )[0]
              : null);
        latestMeta = getLatestMetaFn(metaHistory);
      }
      const cycleToCheck = latestMeta ? latestMeta.latestCycle : 0;
      const versionIdToCheck = latestMeta ? latestMeta.version_id : null;
      const expectedChecksum = latestMeta ? latestMeta.checksum : null;
      const content = Storage.getArtifactContent(
        id,
        cycleToCheck,
        versionIdToCheck
      );

      if (content === null) {
        await bl(
          `Essential artifact MISSING: ${id}`,
          "error",
          `Expected Cycle: ${cycleToCheck}, V: ${versionIdToCheck || "def"}`
        );
        allFoundAndValid = false;
      } else {
        verificationPromises.push(
          verifyArtifactChecksum(
            id,
            cycleToCheck,
            expectedChecksum,
            versionIdToCheck
          ).then((isValid) => {
            if (!isValid) allFoundAndValid = false;
            else
              bl(
                `Verified: ${id}`,
                "only-console",
                `Cyc: ${cycleToCheck}, V: ${versionIdToCheck || "def"}, Len: ${
                  content.length
                }${expectedChecksum ? ", CS OK" : ""}`
              );
          })
        );
      }
    }
    await Promise.all(verificationPromises);
    if (!allFoundAndValid)
      await bl("One or more essential artifacts missing or invalid.", "error");
    else await bl("All essential artifacts verified.", "success", null, 0);
    return allFoundAndValid;
  }

  async function clearAllReploidData() {
    if (!Storage || typeof Storage.clearAllReploidData !== "function") {
      await bl("Cannot clear data, Storage module not loaded.", "error");
      return;
    }
    await bl(
      "Clearing all REPLOID data from LocalStorage...",
      "warn",
      null,
      16
    );
    try {
      Storage.clearAllReploidData();
      await bl("LocalStorage cleared.", "info", null, 8);
    } catch (e) {
      await bl("Error clearing LocalStorage.", "error", e.message);
    }
  }

  async function bootstrapReploid(performGenesis = false) {
    if (!config || !Utils || !Storage || !ErrorsScope) {
      // Check for ErrorsScope
      await bl("Core dependencies check failed, cannot bootstrap.", "error");
      return;
    }
    if (!blLogger) blLogger = Utils.logger;

    let state = null;
    let needsGenesis = performGenesis;
    let stateSource = performGenesis ? "Forced Genesis" : "None";

    if (!performGenesis) {
      await bl("Checking for existing state...", "info", null, 0);
      const stateJSON = Storage.getState();
      if (stateJSON) {
        state = stateJSON;
        if (isValidState(state)) {
          if (
            await checkEssentialArtifactsPresent(
              state.totalCycles,
              state.artifactMetadata
            )
          ) {
            stateSource = `localStorage (Cycle ${state.totalCycles})`;
            await bl(
              `Found valid state and artifacts.`,
              "success",
              `Source: ${stateSource}`,
              0
            );
            needsGenesis = false;
          } else {
            await bl(
              `State valid (Cycle ${state.totalCycles}) but artifacts missing/invalid. Discarding.`,
              "error"
            );
            state = null;
            Storage.removeState();
            needsGenesis = true;
            stateSource = "Discarded Invalid State";
          }
        } else {
          await bl(
            `Found invalid/incompatible state (v${
              state?.version || "?"
            }). Discarding.`,
            "warn"
          );
          state = null;
          Storage.removeState();
          needsGenesis = true;
          stateSource = "Discarded Invalid State";
        }
      } else {
        await bl("No existing state found. Initiating genesis.", "info");
        needsGenesis = true;
        stateSource = "Genesis";
      }
    } else {
      await bl("Reset requested...", "only-gui", null, 6);
      needsGenesis = true;
      stateSource = "Forced Genesis";
    }

    try {
      if (needsGenesis) {
        await bl("Running genesis boot process...", "info");
        state = await runGenesisProcess();
        if (!state)
          throw new (window.StateError || Error)(
            "Genesis boot process failed."
          );
        await bl("Genesis complete.", "success");
      }
      await bl(`Loading application with state from: ${stateSource}`, "info");
      await uiUpdatePromise;
      await loadAndExecuteApp(state);
    } catch (error) {
      await bl("Fatal bootstrap error", "error", error.message);
      console.error("Bootstrap stack trace:", error);
      if (loadingIndicator)
        loadingIndicator.innerHTML += `<div class="log-error">FATAL BOOTSTRAP ERROR: ${error.message}. Check console.</div>`;
    }
  }

  async function fetchGenesisArtifacts() {
    if (!config || !config.GENESIS_ARTIFACT_DEFS) {
      await bl(
        "Cannot fetch genesis artifacts: Config definitions missing.",
        "error"
      );
      return null;
    }
    await bl("Fetching genesis artifacts...", "info", null, 0);
    const fetchedArtifacts = {};
    let success = true;
    const fetchPromises = Object.entries(config.GENESIS_ARTIFACT_DEFS).map(
      async ([id, def]) => {
        if (
          id === "reploid.core.config" ||
          id === "reploid.core.errors" ||
          !def.filename
        )
          return;
        try {
          const response = await fetch(def.filename + `?t=${Date.now()}`);
          if (!response.ok)
            throw new (window.ApiError || Error)(
              `HTTP ${response.status} for ${def.filename}`,
              response.status
            );
          let content;
          if (def.type === "JSON" || def.type === "JSON_CONFIG")
            content = JSON.stringify(await response.json(), null, 2);
          else content = await response.text();
          fetchedArtifacts[id] = content;
          await bl(
            `Fetched: ${def.filename}`,
            "only-console",
            `${content.length} bytes`
          );
        } catch (error) {
          await bl(`Failed to fetch ${def.filename}`, "error", error.message);
          success = false;
        }
      }
    );
    await Promise.all(fetchPromises);
    if (!success) {
      await bl("Genesis artifact fetch failed.", "error");
      return null;
    }
    await bl(
      `Fetched ${Object.keys(fetchedArtifacts).length} genesis artifacts.`,
      "only-console"
    );
    return fetchedArtifacts;
  }

  async function saveGenesisArtifacts(artifacts) {
    if (!Storage || !config || !artifacts) return null;
    await bl("Saving genesis artifacts (Cycle 0)...", "info", null, 0);
    const metadata = {};
    let success = true;
    const genesisDefs = config.GENESIS_ARTIFACT_DEFS || {};
    const now = Date.now();

    for (const id in artifacts) {
      try {
        const checksum = await calculateChecksum(artifacts[id]);
        if (!checksum) {
          await bl(`Checksum failed for genesis artifact: ${id}`, "error");
          success = false;
          continue;
        }
        Storage.setArtifactContent(id, 0, artifacts[id]);
        metadata[id] = [
          {
            id,
            version_id: null,
            latestCycle: 0,
            type: genesisDefs[id]?.type || "UNKNOWN",
            description: genesisDefs[id]?.description || "Unknown Genesis",
            source: "Genesis",
            checksum,
            timestamp: now,
          },
        ];
        await bl(
          `Saved: ${id}`,
          "only-console",
          `Cyc 0, CS: ${checksum.substring(0, 15)}...`
        );
      } catch (e) {
        await bl(`Failed save artifact: ${id} (Cycle 0)`, "error", e.message);
        success = false;
      }
    }

    const bootScriptElement = document.querySelector('script[src="boot.js"]');
    const bootScriptContent = bootScriptElement
      ? await fetch(bootScriptElement.src + `?t=${Date.now()}`).then((res) =>
          res.ok ? res.text() : "(Fetch failed)"
        )
      : "(Element Not Found)";
    const bootStyleContent =
      document.getElementById("boot-style")?.textContent || "";
    const errorsScriptContent = document.querySelector(
      'script[src="errors.js"]'
    )
      ? await fetch("errors.js" + `?t=${Date.now()}`).then((res) =>
          res.ok ? res.text() : "(Fetch failed)"
        )
      : "(errors.js Not Found)";

    await uiUpdatePromise;
    const finalBootstrapLog = bootstrapLogMessages;

    const bootArtifactsToSave = {
      "reploid.boot.style": {
        content: bootStyleContent,
        type: "CSS",
        description: "Bootstrap CSS",
      },
      "reploid.boot.script": {
        content: bootScriptContent,
        type: "JS",
        description: "Bootstrap script",
      },
      "reploid.boot.errors": {
        content: errorsScriptContent,
        type: "JS",
        description: "Error definitions script",
      },
      "reploid.boot.log": {
        content: finalBootstrapLog,
        type: "LOG",
        description: "Bootstrap log",
      },
    };

    for (const id in bootArtifactsToSave) {
      const { content, type, description } = bootArtifactsToSave[id];
      try {
        const checksum = await calculateChecksum(content);
        if (!checksum && id !== "reploid.boot.log") {
          await bl(`Checksum failed for bootstrap artifact: ${id}`, "warn");
          continue;
        }
        Storage.setArtifactContent(id, 0, content);
        metadata[id] = [
          {
            id,
            version_id: null,
            latestCycle: 0,
            type,
            description,
            source: "Bootstrap",
            checksum,
            timestamp: now,
          },
        ];
        await bl(
          `Saved: ${id}`,
          "only-console",
          `Cyc 0, CS: ${checksum ? checksum.substring(0, 15) + "..." : "N/A"}`
        );
      } catch (e) {
        await bl(`Failed save bootstrap artifact: ${id}`, "warn", e.message);
      }
    }

    Object.keys(genesisDefs).forEach((id) => {
      if (
        !metadata[id] &&
        id !== "reploid.core.config" &&
        id !== "reploid.core.errors"
      ) {
        const def = genesisDefs[id];
        if (def) {
          metadata[id] = [
            {
              id,
              version_id: null,
              latestCycle: -1,
              type: def.type,
              description: def.description,
              source: "Genesis Definition",
              checksum: null,
              timestamp: now,
            },
          ];
          bl(`Added placeholder metadata for ${id}`, "only-console");
        }
      }
    });

    await bl(
      "Genesis artifact save completed.",
      success ? "only-console" : "warn"
    );
    return success ? metadata : null;
  }

  async function runGenesisProcess() {
    const fetchedArtifacts = await fetchGenesisArtifacts();
    if (!fetchedArtifacts) return null;
    const artifactMetadata = await saveGenesisArtifacts(fetchedArtifacts);
    if (!artifactMetadata) return null;

    const getDefaultStateFn =
      Utils?.getDefaultState ||
      (() => {
        blLogger.logEvent(
          "warn",
          "Utils.getDefaultState not found, using basic default."
        );
        return {
          version: config.STATE_VERSION,
          totalCycles: 0,
          cfg: {},
          artifactMetadata: {},
          registeredWebComponents: [],
        };
      });
    const defaultState = getDefaultStateFn();

    const initialState = {
      ...defaultState,
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
      lastFeedback: "Genesis completed.",
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
      artifactMetadata: artifactMetadata,
      dynamicTools: [],
      registeredWebComponents: [], // Initialize new field
    };
    initialState.cfg.coreModel =
      initialState.cfg.coreModel ||
      config.DEFAULT_MODELS?.ADVANCED ||
      "gemini-1.5-flash-latest";
    initialState.cfg.critiqueModel =
      initialState.cfg.critiqueModel ||
      config.DEFAULT_MODELS?.BASE ||
      initialState.cfg.coreModel;

    try {
      Storage.saveState(initialState);
      await bl("Initial state saved.", "success", null, 0);
      return initialState;
    } catch (e) {
      await bl("Failed to save initial state!", "error", e.message);
      return null;
    }
  }

  async function loadAndExecuteApp(currentState) {
    await bl(
      `Loading application core (State Cycle ${currentState.totalCycles})...`,
      "info",
      null,
      0
    );
    if (!config || !Utils || !Storage || !ErrorsScope) {
      // Check ErrorsScope
      await bl("Core dependencies not available for app execution.", "error");
      return;
    }
    const coreStyleId = "reploid.core.style";
    const coreLogicId = "reploid.core.logic";
    const coreBodyId = "reploid.core.body";

    try {
      const getLatestMeta =
        Utils.getLatestMeta ||
        ((arr) =>
          arr
            ? arr.sort(
                (a, b) =>
                  b.latestCycle - a.latestCycle || b.timestamp - a.timestamp
              )[0]
            : { latestCycle: 0 });

      const latestStyleMeta = getLatestMeta(
        currentState.artifactMetadata[coreStyleId]
      );
      const styleCycle =
        latestStyleMeta?.latestCycle >= 0 ? latestStyleMeta.latestCycle : 0;
      const styleContent = Storage.getArtifactContent(
        coreStyleId,
        styleCycle,
        latestStyleMeta?.version_id
      );
      if (styleContent) {
        const styleElement = document.createElement("style");
        styleElement.id = `${coreStyleId}-loaded-${styleCycle}${
          latestStyleMeta?.version_id ? "-" + latestStyleMeta.version_id : ""
        }`;
        styleElement.textContent = styleContent;
        document.head.appendChild(styleElement);
        await bl(
          `Applied style: ${coreStyleId} (Cycle ${styleCycle}${
            latestStyleMeta?.version_id
              ? ", V:" + latestStyleMeta.version_id
              : ""
          })`,
          "only-console"
        );
      } else await bl(`Core style missing (Cyc ${styleCycle}/0).`, "warn");

      const latestBodyMeta = getLatestMeta(
        currentState.artifactMetadata[coreBodyId]
      );
      const bodyCycle =
        latestBodyMeta?.latestCycle >= 0 ? latestBodyMeta.latestCycle : 0;
      const coreBodyContent = Storage.getArtifactContent(
        coreBodyId,
        bodyCycle,
        latestBodyMeta?.version_id
      );
      if (coreBodyContent && appRoot) {
        await bl(
          `Injecting body: ${coreBodyId} (Cycle ${bodyCycle}${
            latestBodyMeta?.version_id ? ", V:" + latestBodyMeta.version_id : ""
          })`,
          "only-console"
        );
        appRoot.innerHTML = coreBodyContent;
      } else
        throw new (window.ConfigError || Error)(
          "Failed to load core UI structure (body or app-root)."
        );

      // Register core Web Components before loading app-logic
      await registerCoreWebComponents(currentState.artifactMetadata);

      const latestLogicMeta = getLatestMeta(
        currentState.artifactMetadata[coreLogicId]
      );
      const logicCycle =
        latestLogicMeta?.latestCycle >= 0 ? latestLogicMeta.latestCycle : 0;
      const orchestratorScriptContent = Storage.getArtifactContent(
        coreLogicId,
        logicCycle,
        latestLogicMeta?.version_id
      );
      if (!orchestratorScriptContent)
        throw new (window.ConfigError || Error)(
          `Core logic missing (Cyc ${logicCycle}/0).`
        );

      await bl(
        `Executing orchestrator: ${coreLogicId} (Cycle ${logicCycle}${
          latestLogicMeta?.version_id ? ", V:" + latestLogicMeta.version_id : ""
        })...`,
        "info",
        null,
        0
      );
      const orchestratorFunction = new Function(
        "config",
        "Utils",
        "Storage",
        "Errors",
        orchestratorScriptContent +
          "\nreturn CoreLogicModule(config, Utils, Storage, Errors);"
      );
      const maybePromise = orchestratorFunction(
        config,
        Utils,
        Storage,
        ErrorsScope
      );
      if (maybePromise instanceof Promise) await maybePromise;
      await bl("Orchestrator execution initiated.", "success", null, 0);

      setTimeout(() => {
        if (loadingContainer) {
          loadingContainer.style.transition = "opacity 0.5s ease-out";
          loadingContainer.style.opacity = "0";
          setTimeout(() => loadingContainer.classList.add("hidden"), 500);
        }
        if (appRoot) appRoot.classList.add("visible");
      }, 500);
    } catch (error) {
      await bl(
        `Error loading/executing core components`,
        "error",
        error.message
      );
      console.error("Core execution failed", error);
      if (loadingIndicator)
        loadingIndicator.innerHTML += `<div class="log-error">FATAL CORE EXECUTION ERROR: ${error.message}. Check console.</div>`;
    }
  }

  /**
   * Registers core Web Components defined in artifacts.
   * @param {object} artifactMetadata - The application's artifact metadata.
   */
  async function registerCoreWebComponents(artifactMetadata) {
    if (!artifactMetadata || typeof customElements === "undefined") return;
    await bl("Registering core Web Components...", "info", null, 0);
    let registeredCount = 0;
    for (const id in artifactMetadata) {
      if (id.startsWith("reploid.core.webcomponent.")) {
        const metaHistory = artifactMetadata[id];
        const getLatestMetaFn =
          Utils?.getLatestMeta ||
          ((arr) =>
            arr
              ? arr.sort(
                  (a, b) =>
                    b.latestCycle - a.latestCycle || b.timestamp - a.timestamp
                )[0]
              : null);
        const latestMeta = getLatestMetaFn(metaHistory);

        if (
          latestMeta &&
          latestMeta.type === "WEB_COMPONENT_DEF" &&
          latestMeta.latestCycle >= 0
        ) {
          const jsContent = Storage.getArtifactContent(
            id,
            latestMeta.latestCycle,
            latestMeta.version_id
          );
          if (jsContent) {
            const componentName = id
              .substring("reploid.core.webcomponent.".length)
              .replace(/\./g, "-"); // e.g., reploid.core.webcomponent.status-bar -> status-bar
            if (!customElements.get(componentName)) {
              try {
                // This is a simplified way to define class from string.
                // A more robust way would involve a separate script tag or module loader.
                const ComponentClass = new Function(
                  "return (" + jsContent + ")"
                )();
                if (
                  typeof ComponentClass === "function" &&
                  HTMLElement.isPrototypeOf(ComponentClass)
                ) {
                  customElements.define(componentName, ComponentClass);
                  await bl(
                    `Registered core WC: <${componentName}> from ${id}`,
                    "only-console"
                  );
                  registeredCount++;
                } else {
                  await bl(
                    `Invalid class structure for core WC ${componentName} in ${id}`,
                    "warn"
                  );
                }
              } catch (e) {
                await bl(
                  `Error defining core WC ${componentName} from ${id}: ${e.message}`,
                  "error"
                );
              }
            } else {
              await bl(
                `Core WC <${componentName}> already registered.`,
                "only-console"
              );
            }
          } else {
            await bl(`Content missing for core WC definition: ${id}`, "warn");
          }
        }
      }
    }
    if (registeredCount > 0)
      await bl(
        `${registeredCount} core Web Components registered.`,
        "info",
        null,
        0
      );
  }

  function startInteraction(action) {
    if (interactionStarted) return;
    interactionStarted = true;
    skipBootstrapAnimation = false;
    if (startContainer) startContainer.classList.add("hidden");
    if (loadingContainer) loadingContainer.classList.remove("hidden");
    document.body.style.justifyContent = "flex-start";
    initAudioContext();
    removeInteractionListeners();
    addSkipListener();

    loadCoreDependencies()
      .then(async (dependenciesLoaded) => {
        if (!dependenciesLoaded) {
          removeSkipListener();
          return;
        }
        if (action === "reset") {
          await clearAllReploidData();
          await bl("Rebooting after reset...", "info", null, 64);
          await bl("            ", "only-gui", null, 8);
          await bootstrapReploid(true);
        } else {
          await bootstrapReploid(false);
        }
        removeSkipListener();
      })
      .catch(async (err) => {
        const errorMsg =
          err.message || "Unknown error during dependency loading phase.";
        await bl(
          "FATAL: Unhandled error in core dependency loading.",
          "error",
          errorMsg
        );
        console.error("Unhandled Core Dependency Error:", err);
        if (loadingIndicator)
          loadingIndicator.innerHTML = `<div class="log-entry log-error">> FATAL BOOTSTRAP ERROR: ${errorMsg}. Check console.</div>`;
        removeSkipListener();
      });
  }

  // handleSkip, handleKeydown, removeInteractionListeners, addSkipListener, removeSkipListener remain the same

  function handleSkip(e) {
    if (e.key === "Enter" || e.type === "click" || e.type === "touchstart") {
      if (!skipBootstrapAnimation) {
        skipBootstrapAnimation = true;
        bl("[BOOTSTRAP SKIP]", "only-gui", null, 0);
        if (e.type === "touchstart") e.preventDefault();
      }
    }
  }
  function handleKeydown(e) {
    if (!interactionStarted) {
      if (e.key === "Enter") startInteraction("continue");
      else if (e.key === " ") startInteraction("reset");
    }
  }
  function removeInteractionListeners() {
    document.removeEventListener("keydown", handleKeydown);
    if (continueButton)
      continueButton.removeEventListener("click", handleContinueClick);
    if (resetButton) resetButton.removeEventListener("click", handleResetClick);
  }
  function addSkipListener() {
    document.addEventListener("keydown", handleSkip);
    document.addEventListener("click", handleSkip);
    document.addEventListener("touchstart", handleSkip, { passive: false });
  }
  function removeSkipListener() {
    document.removeEventListener("keydown", handleSkip);
    document.removeEventListener("click", handleSkip);
    document.removeEventListener("touchstart", handleSkip);
  }

  // Define named handlers for add/removeEventListener
  const handleContinueClick = () => startInteraction("continue");
  const handleResetClick = () => startInteraction("reset");

  if (continueButton)
    continueButton.addEventListener("click", handleContinueClick);
  if (resetButton) resetButton.addEventListener("click", handleResetClick);
  document.addEventListener("keydown", handleKeydown);
})();

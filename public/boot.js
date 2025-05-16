(async () => {
  const startContainer = document.getElementById("start-container");
  const loadingContainer = document.getElementById("loading-container");
  const loadingIndicator = document.getElementById("loading-indicator");
  const appRoot = document.getElementById("app-root");
  const continueButton = document.getElementById("continue-button");
  const resetButton = document.getElementById("reset-button");

  let bootstrapLogMessages = `REPLOID Bootstrap Log - ${new Date().toISOString()}\n=========================================\n`;
  let audioCtx = null; let isAudioInitAttempted = false; let interactionStarted = false;
  let uiUpdatePromise = Promise.resolve(); let skipBootstrapAnimation = false;

  let config = null; let Utils = null; let Storage = null; let ErrorsGlobal = null; let blLogger = null;
  let AgentLogicPureHelpers = null; let StateHelpersPure = null;

  const bl = (() => {
    const MIN_TONE_INTERVAL_MS = 32; const TONE_DURATION_MS = 50; let lastToneTime = 0;
    const initAudioContextInternal = () => {
      if (!isAudioInitAttempted && !audioCtx) {
        isAudioInitAttempted = true;
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { (blLogger ? blLogger.logEvent : console.warn)("warn", "AudioContext init failed:", e.message); audioCtx = null; }
      } return audioCtx;
    };
    const playTone = (frequency, fixedDurationMs, oscType) => {
      if (skipBootstrapAnimation) return; const currentAudioCtx = initAudioContextInternal();
      if (!currentAudioCtx || typeof currentAudioCtx.createOscillator !== "function") return;
      try {
        const oscillator = currentAudioCtx.createOscillator(); const gainNode = currentAudioCtx.createGain();
        const duration = Math.max(fixedDurationMs / 1000, 0.01);
        oscillator.type = oscType; oscillator.frequency.setValueAtTime(frequency, currentAudioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.3, currentAudioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, currentAudioCtx.currentTime + duration);
        oscillator.connect(gainNode).connect(currentAudioCtx.destination);
        oscillator.start(); oscillator.stop(currentAudioCtx.currentTime + duration);
      } catch (e) { (blLogger ? blLogger.logEvent : console.warn)("warn", "Tone playback error:", e.message); audioCtx = null; }
    };
    return async function blInternal(message, level = "info", detail = null, charDelay = 1) {
      const timestamp = new Date().toISOString(); const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${detail ? ` | ${detail}` : ""}`;
      bootstrapLogMessages += logLine + "\n";
      let skipConsoleOutput = false; let skipUiOutput = false; let effectiveLevel = level;
      if (level === "only-gui") { skipConsoleOutput = true; effectiveLevel = "info"; }
      else if (level === "only-console" || level === "detail") { skipUiOutput = true; effectiveLevel = "info"; }
      if (!skipConsoleOutput) {
        const logFunc = blLogger ? blLogger.logEvent : console[effectiveLevel === "error" ? "error" : effectiveLevel === "warn" ? "warn" : "log"];
        if (blLogger) { logFunc(effectiveLevel, message, detail || ""); }
        else { console[effectiveLevel === "error" ? "error" : effectiveLevel === "warn" ? "warn" : "log"](logLine); }
      }
      if (skipUiOutput || !loadingIndicator) return;
      uiUpdatePromise = uiUpdatePromise.then(async () => {
          const logEntryContainer = document.createElement("div"); logEntryContainer.className = `log-entry log-${effectiveLevel}`;
          loadingIndicator.appendChild(logEntryContainer); const fullText = `> ${message}${detail ? ` | ${detail}` : ""}`;
          if (skipBootstrapAnimation) logEntryContainer.textContent = fullText;
          else {
            if (effectiveLevel === "error") playTone(220, TONE_DURATION_MS, "square"); lastToneTime = performance.now();
            for (const char of fullText) {
              logEntryContainer.textContent += char; if (loadingIndicator.scrollTop !== undefined) loadingIndicator.scrollTop = loadingIndicator.scrollHeight;
              const currentTime = performance.now();
              if (char.trim() && effectiveLevel !== "error" && currentTime - lastToneTime >= MIN_TONE_INTERVAL_MS) { playTone(990, TONE_DURATION_MS, "triangle"); lastToneTime = currentTime; }
              if (charDelay > 0) await new Promise((resolve) => setTimeout(resolve, Math.max(charDelay, 1)));
              if (skipBootstrapAnimation) { logEntryContainer.textContent = fullText; break; }
            }
          } if (loadingIndicator.scrollTop !== undefined) loadingIndicator.scrollTop = loadingIndicator.scrollHeight;
        }).catch((error) => { (blLogger ? blLogger.logEvent : console.error)("error", "Error during bootstrap logging UI update:", error); uiUpdatePromise = Promise.resolve(); });
      await uiUpdatePromise;
    };
  })();

  const initAudioContext = () => {
    if (!isAudioInitAttempted && !audioCtx) {
      isAudioInitAttempted = true;
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { (blLogger ? blLogger.logEvent : console.warn)("warn", "AudioContext init failed on demand:", e.message); audioCtx = null; }
    } return audioCtx;
  };

  async function calculateChecksumViaUtils(content) {
    if (Utils && typeof Utils.calculateChecksum === 'function') return await Utils.calculateChecksum(content);
    console.warn("calculateChecksumViaUtils called before Utils.calculateChecksum was available."); return null;
  }

  async function fetchAndExecuteModule(filePath, exportName, dependencies = {}) {
    const loggerInstance = blLogger || { logEvent: (lvl, msg, det) => console.error(`[BOOT_FETCH_FALLBACK] ${msg}`, det || "") };
    const { Errors: CustomErrorsFromDeps } = dependencies;
    const depNames = Object.keys(dependencies); const depValues = Object.values(dependencies);
    if (depNames.length !== depValues.length || depValues.some((dep) => dep === undefined || dep === null)) {
      const missing = depNames.filter((name, i) => depValues[i] === undefined || depValues[i] === null);
      const errorMsg = `Cannot load module ${filePath}: Missing dependencies ${missing.join(", ")}`;
      loggerInstance.logEvent("error", errorMsg, dependencies);
      throw (CustomErrorsFromDeps?.ConfigError ? new CustomErrorsFromDeps.ConfigError(errorMsg, filePath) : new Error(errorMsg));
    }
    try {
      const response = await fetch(filePath + `?v=${config?.STATE_VERSION || Date.now()}`);
      if (!response.ok) throw (CustomErrorsFromDeps?.ApiError ? new CustomErrorsFromDeps.ApiError(`HTTP ${response.status} for ${filePath}`, response.status) : new Error(`HTTP ${response.status} for ${filePath}`));
      const scriptContent = await response.text(); const tempScope = {};
      const funcArgs = ["tempScope", ...depNames]; const funcBody = `${scriptContent}\ntempScope.result = (typeof ${exportName} !== 'undefined') ? ${exportName} : undefined;`;
      const factoryFunction = new Function(...funcArgs, funcBody);
      factoryFunction(tempScope, ...depValues);
      if (tempScope.result === undefined) {
        const errorMsg = `Module ${filePath} did not yield expected export '${exportName}'.`;
        loggerInstance.logEvent("warn", errorMsg);
        throw (CustomErrorsFromDeps?.ConfigError ? new CustomErrorsFromDeps.ConfigError(errorMsg, filePath) : new Error(errorMsg));
      }
      if (exportName.endsWith("Module") && typeof tempScope.result === "function") {
        const moduleFactory = tempScope.result; const moduleInstance = moduleFactory(...depValues);
        if (!moduleInstance) {
          const errorMsg = `Module factory ${exportName} from ${filePath} returned null/undefined.`;
          loggerInstance.logEvent("error", errorMsg);
          throw (CustomErrorsFromDeps?.ConfigError ? new CustomErrorsFromDeps.ConfigError(errorMsg, filePath) : new Error(errorMsg));
        }
        loggerInstance.logEvent("debug", `Module factory ${exportName} from ${filePath} executed successfully.`);
        return moduleInstance;
      } else {
        loggerInstance.logEvent("debug", `Returning direct export ${exportName} from ${filePath}.`);
        return tempScope.result;
      }
    } catch (error) {
      loggerInstance.logEvent("error", `Fatal Error loading/executing module ${filePath}`, error.message + (error.stack ? `\nStack: ${error.stack}` : ""));
      throw error;
    }
  }

  async function loadCoreDependencies() {
    try {
      await bl("Loading core configuration...", "info", null, 0);
      const configResponse = await fetch("config.json" + `?v=${Date.now()}`);
      if (!configResponse.ok) throw new Error(`HTTP ${configResponse.status} loading config.json`);
      config = await configResponse.json(); if (!config) throw new Error("Failed to parse config.json");
      await bl("Config loaded.", "only-console", `Version: ${config.STATE_VERSION}`);

      await bl("Loading core utilities (incl. Errors)...", "info", null, 0);
      Utils = await fetchAndExecuteModule("utils.js", "UtilsModule", {});
      if (!Utils || !Utils.logger || !Utils.Errors) throw new Error("Failed to load UtilsModule or its components (logger, Errors) correctly.");
      blLogger = Utils.logger; ErrorsGlobal = Utils.Errors;
      await bl("Utils (incl. Errors) loaded.", "only-console");

      await bl("Loading core storage...", "info", null, 0);
      Storage = await fetchAndExecuteModule("storage.js", "StorageModule", { config, logger: blLogger, Errors: ErrorsGlobal });
      if (!Storage || typeof Storage.getState !== "function") throw new Error("Failed to load StorageModule correctly.");
      await bl("Storage loaded.", "only-console");

      await bl("Loading pure helper modules...", "info", null, 0);
      AgentLogicPureHelpers = await fetchAndExecuteModule("agent-logic-pure.js", "AgentLogicPureHelpersModule", { Utils, logger: blLogger });
      StateHelpersPure = await fetchAndExecuteModule("state-helpers-pure.js", "StateHelpersPureModule", { Utils, logger: blLogger });
      if(!AgentLogicPureHelpers || !StateHelpersPure) throw new Error("Failed to load pure helper modules.");
      await bl("Pure helper modules loaded.", "only-console");

      await bl("Core dependencies loaded.", "success", null, 0); return true;
    } catch (error) {
      const errorMsg = error.message || "Unknown error loading core dependencies.";
      await bl("FATAL: Failed to load core dependencies.", "error", errorMsg);
      console.error("Dependency Load Error:", error, error.stack);
      if (loadingIndicator) loadingIndicator.innerHTML = `<div class="log-entry log-error">> FATAL BOOTSTRAP ERROR: ${errorMsg}. Cannot continue. Check console.</div>`;
      if (loadingContainer) loadingContainer.classList.remove("hidden");
      if (startContainer) startContainer.classList.add("hidden");
      removeInteractionListeners(); return false;
    }
  }

  function isValidState(parsedState) {
    if (!config || !parsedState || !Utils || !StateHelpersPure) return false;
    const validationError = StateHelpersPure.validateStateStructurePure(parsedState, config.STATE_VERSION, Utils.getDefaultState);
    if (validationError) {
      bl(`State validation failed: ${validationError}`, "warn", `Found version: ${parsedState.version}`);
      return false;
    }
    return true;
  }

  async function verifyArtifactChecksum(id, cycle, expectedChecksum, versionId = null) {
    if (!expectedChecksum) return true;
    const content = Storage.getArtifactContent(id, cycle, versionId);
    if (content === null && expectedChecksum) { await bl(`Content missing for checksum verification: ${id}_${cycle}${versionId ? "#" + versionId : ""}`, "warn"); return false; }
    if (content === null && !expectedChecksum) return true;
    let actualChecksum = await calculateChecksumViaUtils(content);
    if (!actualChecksum) { await bl(`Checksum calculation failed for ${id}_${cycle}${versionId ? "#" + versionId : ""}`, "error"); return false; }
    if (actualChecksum !== expectedChecksum) { await bl(`Checksum mismatch for ${id}_${cycle}${versionId ? "#" + versionId : ""}`, "warn", `Expected: ${expectedChecksum}, Actual: ${actualChecksum}`); return false; }
    return true;
  }

  async function checkEssentialArtifactsPresent(stateCycle, artifactMetadata) {
    if (!Storage || !config || !artifactMetadata || !Utils) return false;
    await bl(`Verifying essential artifacts for state cycle ${stateCycle}...`, "info", null, 0);
    let allFoundAndValid = true; const essentialDefs = config.GENESIS_ARTIFACT_DEFS || {}; const verificationPromises = [];
    for (const id in essentialDefs) {
      if (id === "reploid.core.config") continue;
      const metaHistory = artifactMetadata[id]; let latestMeta = null;
      if (metaHistory && metaHistory.length > 0) latestMeta = Utils.getLatestMeta(metaHistory);
      const cycleToCheck = latestMeta ? latestMeta.latestCycle : 0;
      const versionIdToCheck = latestMeta ? latestMeta.version_id : null;
      const expectedChecksum = latestMeta ? latestMeta.checksum : null;
      const content = Storage.getArtifactContent(id, cycleToCheck, versionIdToCheck);
      if (content === null) {
        if(latestMeta && latestMeta.latestCycle !== -1) { await bl(`Essential artifact MISSING: ${id}`, "error", `Expected Cycle: ${cycleToCheck}, V: ${versionIdToCheck || "def"}`); allFoundAndValid = false; }
        else if (!latestMeta) { await bl(`Essential artifact DEFINITION MISSING from state metadata: ${id}`, "error"); allFoundAndValid = false; }
      } else {
        verificationPromises.push( verifyArtifactChecksum(id, cycleToCheck, expectedChecksum, versionIdToCheck).then((isValid) => {
            if (!isValid) allFoundAndValid = false; else bl(`Verified: ${id}`, "only-console", `Cyc: ${cycleToCheck}, V: ${versionIdToCheck || "def"}, Len: ${content.length}${expectedChecksum ? ", CS OK" : ""}`);
          }) );
      }
    }
    await Promise.all(verificationPromises);
    if (!allFoundAndValid) await bl("One or more essential artifacts missing or invalid.", "error");
    else await bl("All essential artifacts verified.", "success", null, 0);
    return allFoundAndValid;
  }

  async function clearAllReploidData() {
    if (!Storage || typeof Storage.clearAllReploidData !== "function") { await bl("Cannot clear data, Storage module not loaded.", "error"); return; }
    await bl("Clearing all REPLOID data from LocalStorage...", "warn", null, 16);
    try { Storage.clearAllReploidData(); await bl("LocalStorage cleared.", "info", null, 8); }
    catch (e) { await bl("Error clearing LocalStorage.", "error", e.message); }
  }

  async function bootstrapReploid(performGenesis = false) {
    if (!config || !Utils || !Storage || !ErrorsGlobal || !AgentLogicPureHelpers || !StateHelpersPure) { await bl("Core dependencies check failed, cannot bootstrap.", "error"); return; }
    if (!blLogger) blLogger = Utils.logger;
    let state = null; let needsGenesis = performGenesis; let stateSource = performGenesis ? "Forced Genesis" : "None";
    if (!performGenesis) {
      await bl("Checking for existing state...", "info", null, 0);
      const stateJSON = Storage.getState();
      if (stateJSON) {
        state = stateJSON;
        if (isValidState(state)) {
          if (await checkEssentialArtifactsPresent(state.totalCycles, state.artifactMetadata)) {
            stateSource = `localStorage (Cycle ${state.totalCycles}, v${state.version})`;
            await bl(`Found valid state and artifacts.`, "success", `Source: ${stateSource}`, 0); needsGenesis = false;
          } else {
            await bl(`State valid (Cycle ${state.totalCycles}) but artifacts missing/invalid. Discarding.`, "error");
            state = null; Storage.removeState(); needsGenesis = true; stateSource = "Discarded Invalid State";
          }
        } else {
          await bl(`Found invalid/incompatible state (v${state?.version || "?"}). Discarding.`, "warn");
          state = null; Storage.removeState(); needsGenesis = true; stateSource = "Discarded Invalid State";
        }
      } else { await bl("No existing state found. Initiating genesis.", "info"); needsGenesis = true; stateSource = "Genesis"; }
    } else { await bl("Reset requested...", "only-gui", null, 6); needsGenesis = true; stateSource = "Forced Genesis"; }
    try {
      if (needsGenesis) {
        await bl("Running genesis boot process...", "info"); state = await runGenesisProcess();
        if (!state) throw new Error("Genesis boot process failed."); await bl("Genesis complete.", "success");
      }
      await bl(`Loading application with state from: ${stateSource}`, "info"); await uiUpdatePromise;
      await loadAndExecuteApp(state);
    } catch (error) {
      await bl("Fatal bootstrap error", "error", error.message); console.error("Bootstrap stack trace:", error);
      if (loadingIndicator) loadingIndicator.innerHTML += `<div class="log-error">FATAL BOOTSTRAP ERROR: ${error.message}. Check console.</div>`;
    }
  }

  async function fetchGenesisArtifacts() {
    if (!config || !config.GENESIS_ARTIFACT_DEFS) { await bl("Cannot fetch genesis artifacts: Config definitions missing.", "error"); return null; }
    await bl("Fetching genesis artifacts...", "info", null, 0);
    const fetchedArtifacts = {}; let success = true;
    const fetchPromises = Object.entries(config.GENESIS_ARTIFACT_DEFS).map(async ([id, def]) => {
      if (!def.filename) return;
      try {
        const response = await fetch(def.filename + `?t=${Date.now()}`);
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${def.filename}`);
        let content;
        if (def.type === "JSON" || def.type === "JSON_CONFIG") content = JSON.stringify(await response.json(), null, 2);
        else content = await response.text();
        fetchedArtifacts[id] = content; await bl(`Fetched: ${def.filename}`, "only-console", `${content.length} bytes`);
      } catch (error) { await bl(`Failed to fetch ${def.filename}`, "error", error.message); success = false; }
    });
    await Promise.all(fetchPromises);
    if (!success) { await bl("Genesis artifact fetch failed.", "error"); return null; }
    await bl(`Fetched ${Object.keys(fetchedArtifacts).length} genesis artifacts.`, "only-console");
    return fetchedArtifacts;
  }

  async function saveGenesisArtifacts(artifacts) {
    if (!Storage || !config || !artifacts || !Utils) return null;
    await bl("Saving genesis artifacts (Cycle 0)...", "info", null, 0);
    const metadata = {}; let success = true; const genesisDefs = config.GENESIS_ARTIFACT_DEFS || {}; const now = Date.now();
    for (const id in artifacts) {
      try {
        const checksum = await Utils.calculateChecksum(artifacts[id]);
        if (!checksum) { await bl(`Checksum failed for genesis artifact: ${id}`, "error"); success = false; continue; }
        Storage.setArtifactContent(id, 0, artifacts[id]);
        metadata[id] = [{ id, version_id: null, latestCycle: 0, type: genesisDefs[id]?.type || "UNKNOWN", description: genesisDefs[id]?.description || `Genesis Artifact ${id}`, source: "Genesis", checksum, timestamp: now, paradigm: genesisDefs[id]?.paradigm || "unknown" }];
        await bl(`Saved: ${id}`, "only-console", `Cyc 0, CS: ${checksum.substring(0, 15)}...`);
      } catch (e) { await bl(`Failed save artifact: ${id} (Cycle 0)`, "error", e.message); success = false; }
    }
    const bootScriptElement = document.querySelector('script[src="boot.js"]');
    const bootScriptContent = bootScriptElement ? await fetch(bootScriptElement.src + `?t=${Date.now()}`).then(res => res.ok ? res.text() : "(Fetch boot.js failed)") : "(boot.js script element Not Found)";
    const bootStyleContent = document.getElementById("boot-style")?.textContent || "";
    await uiUpdatePromise; const finalBootstrapLog = bootstrapLogMessages;
    const bootArtifactsToSave = {
      "reploid.boot.style": { content: bootStyleContent, type: "CSS", description: "Bootstrap CSS from index.html", paradigm: "data" },
      "reploid.boot.script": { content: bootScriptContent, type: "JS", description: "Bootstrap script (boot.js) content", paradigm: "boundary_orchestration" },
      "reploid.boot.log": { content: finalBootstrapLog, type: "LOG", description: "Bootstrap execution log", paradigm: "data" },
    };
    for (const id in bootArtifactsToSave) {
      const { content, type, description, paradigm } = bootArtifactsToSave[id];
      try {
        const checksum = await Utils.calculateChecksum(content);
        if (!checksum && id !== "reploid.boot.log") { await bl(`Checksum failed for bootstrap artifact: ${id}`, "warn"); continue; }
        Storage.setArtifactContent(id, 0, content);
        metadata[id] = [{ id, version_id: null, latestCycle: 0, type, description, source: "BootstrapCapture", checksum, timestamp: now, paradigm }];
        await bl(`Saved: ${id}`, "only-console", `Cyc 0, CS: ${checksum ? checksum.substring(0, 15) + "..." : "N/A"}`);
      } catch (e) { await bl(`Failed save bootstrap artifact: ${id}`, "warn", e.message); }
    }
    Object.keys(genesisDefs).forEach((id) => {
      if (!metadata[id]) {
        const def = genesisDefs[id];
        if (def) {
          metadata[id] = [{ id, version_id: null, latestCycle: (id === "reploid.core.config" ? 0 : -1), type: def.type, description: def.description, source: "Genesis Definition", checksum: null, timestamp: now, paradigm: def.paradigm || "unknown" }];
          if (id === "reploid.core.config") Storage.setArtifactContent(id, 0, JSON.stringify(config, null, 2));
          bl(`Added metadata for ${id} (cycle ${metadata[id][0].latestCycle})`, "only-console");
        }
      }
    });
    await bl("Genesis artifact save completed.", success ? "only-console" : "warn");
    return success ? metadata : null;
  }

  async function runGenesisProcess() {
    const fetchedArtifacts = await fetchGenesisArtifacts(); if (!fetchedArtifacts) return null;
    const artifactMetadata = await saveGenesisArtifacts(fetchedArtifacts); if (!artifactMetadata) return null;
    const initialState = Utils.getDefaultState(config);
    initialState.artifactMetadata = artifactMetadata; initialState.lastFeedback = "Genesis completed.";
    try { Storage.saveState(initialState); await bl("Initial state saved.", "success", null, 0); return initialState; }
    catch (e) { await bl("Failed to save initial state!", "error", e.message); return null; }
  }

  async function registerCoreWebComponentsOnBoot(currentArtifactMetadata) {
    if (!currentArtifactMetadata || typeof customElements === "undefined" || !Storage || !Utils) { bl("Cannot register core WCs on boot: missing dependencies.", "warn"); return; }
    await bl("Boot: Registering core Web Components from artifacts...", "info", null, 0);
    let registeredCount = 0;
    for (const id in currentArtifactMetadata) {
      if (id.startsWith("reploid.core.webcomponent.")) {
        const metaHistory = currentArtifactMetadata[id]; const latestMeta = Utils.getLatestMeta(metaHistory);
        if (latestMeta && latestMeta.type === "WEB_COMPONENT_DEF" && latestMeta.latestCycle >= 0) {
          const jsContent = Storage.getArtifactContent(id, latestMeta.latestCycle, latestMeta.version_id);
          if (jsContent) {
            const componentName = id.substring("reploid.core.webcomponent.".length).replace(/\./g, "-");
            if (!customElements.get(componentName)) {
              try {
                const ComponentClass = new Function("return (" + jsContent + ")")();
                if (typeof ComponentClass === "function" && HTMLElement.isPrototypeOf(ComponentClass)) {
                  customElements.define(componentName, ComponentClass);
                  await bl(`Boot: Registered core WC <${componentName}> from ${id}`, "only-console"); registeredCount++;
                } else await bl(`Boot: Invalid class structure for core WC ${componentName} in ${id}`, "warn");
              } catch (e) { await bl(`Boot: Error defining core WC ${componentName} from ${id}: ${e.message}`, "error"); }
            } else await bl(`Boot: Core WC <${componentName}> from ${id} was already defined globally.`, "debug");
          } else await bl(`Boot: Content missing for core WC definition: ${id} (Cycle ${latestMeta.latestCycle})`, "warn");
        }
      }
    }
    if (registeredCount > 0) await bl(`Boot: ${registeredCount} core Web Components registered globally.`, "info", null, 0);
    else await bl(`Boot: No new core Web Components to register globally at this stage.`, "info", null, 0);
  }

  async function loadAndExecuteApp(currentState) {
    await bl(`Loading application core (State Cycle ${currentState.totalCycles})...`, "info", null, 0);
    if (!config || !Utils || !Storage || !ErrorsGlobal || !AgentLogicPureHelpers || !StateHelpersPure) { await bl("Core dependencies not available for app execution.", "error"); return; }
    const coreStyleId = "reploid.core.style"; const coreLogicId = "reploid.core.logic"; const coreBodyId = "reploid.core.body";
    try {
      const latestStyleMeta = Utils.getLatestMeta(currentState.artifactMetadata[coreStyleId]);
      const styleCycle = latestStyleMeta?.latestCycle >= 0 ? latestStyleMeta.latestCycle : 0;
      const styleContent = Storage.getArtifactContent(coreStyleId, styleCycle, latestStyleMeta?.version_id);
      if (styleContent) {
        const styleElement = document.createElement("style");
        styleElement.id = `${coreStyleId}-loaded-${styleCycle}${latestStyleMeta?.version_id ? "-" + latestStyleMeta.version_id : ""}`;
        styleElement.textContent = styleContent; document.head.appendChild(styleElement);
        await bl(`Applied style: ${coreStyleId} (Cycle ${styleCycle}${latestStyleMeta?.version_id ? ", V:" + latestStyleMeta.version_id : ""})`, "only-console");
      } else await bl(`Core style artifact missing (Cyc ${styleCycle}/0). Using only boot style.`, "warn");

      const latestBodyMeta = Utils.getLatestMeta(currentState.artifactMetadata[coreBodyId]);
      const bodyCycle = latestBodyMeta?.latestCycle >= 0 ? latestBodyMeta.latestCycle : 0;
      const coreBodyContent = Storage.getArtifactContent(coreBodyId, bodyCycle, latestBodyMeta?.version_id);
      if (coreBodyContent && appRoot) {
        await bl(`Injecting body: ${coreBodyId} (Cycle ${bodyCycle}${latestBodyMeta?.version_id ? ", V:" + latestBodyMeta.version_id : ""})`, "only-console");
        appRoot.innerHTML = coreBodyContent;
      } else throw new Error("Failed to load core UI structure (body artifact or app-root element missing).");
      await registerCoreWebComponentsOnBoot(currentState.artifactMetadata);
      const latestLogicMeta = Utils.getLatestMeta(currentState.artifactMetadata[coreLogicId]);
      const logicCycle = latestLogicMeta?.latestCycle >= 0 ? latestLogicMeta.latestCycle : 0;
      const orchestratorScriptContent = Storage.getArtifactContent(coreLogicId, logicCycle, latestLogicMeta?.version_id);
      if (!orchestratorScriptContent) throw new Error(`Core logic artifact (${coreLogicId}) missing (Cyc ${logicCycle}/0).`);
      await bl(`Executing orchestrator: ${coreLogicId} (Cycle ${logicCycle}${latestLogicMeta?.version_id ? ", V:" + latestLogicMeta.version_id : ""})...`, "info", null, 0);
      const orchestratorFunction = new Function("initialConfig", "initialUtils", "initialStorage", "initialErrors", "initialAgentLogicPureHelpers", "initialStateHelpersPure", orchestratorScriptContent + "\nreturn CoreLogicModule(initialConfig, initialUtils, initialStorage, initialErrors, initialAgentLogicPureHelpers, initialStateHelpersPure);");
      const maybePromise = orchestratorFunction(config, Utils, Storage, ErrorsGlobal, AgentLogicPureHelpers, StateHelpersPure);
      if (maybePromise instanceof Promise) await maybePromise;
      await bl("Orchestrator execution initiated.", "success", null, 0);
      setTimeout(() => {
        if (loadingContainer) { loadingContainer.style.transition = "opacity 0.5s ease-out"; loadingContainer.style.opacity = "0"; setTimeout(() => loadingContainer.classList.add("hidden"), 500); }
        if (appRoot) appRoot.classList.add("visible");
      }, 500);
    } catch (error) {
      await bl(`Error loading/executing core components`, "error", error.message); console.error("Core execution failed", error);
      if (loadingIndicator) loadingIndicator.innerHTML += `<div class="log-error">FATAL CORE EXECUTION ERROR: ${error.message}. Check console.</div>`;
    }
  }

  function handleSkip(e) { if (e.key === "Enter" || e.type === "click" || e.type === "touchstart") { if (!skipBootstrapAnimation) { skipBootstrapAnimation = true; bl("[BOOTSTRAP SKIP]", "only-gui", null, 0); if (e.type === "touchstart") e.preventDefault(); } } }
  function handleKeydown(e) { if (!interactionStarted) { if (e.key === "Enter") startInteraction("continue"); else if (e.key === " ") startInteraction("reset"); } }
  function removeInteractionListeners() { document.removeEventListener("keydown", handleKeydown); if (continueButton) continueButton.removeEventListener("click", handleContinueClick); if (resetButton) resetButton.removeEventListener("click", handleResetClick); }
  function addSkipListener() { document.addEventListener("keydown", handleSkip); document.addEventListener("click", handleSkip); document.addEventListener("touchstart", handleSkip, { passive: false }); }
  function removeSkipListener() { document.removeEventListener("keydown", handleSkip); document.removeEventListener("click", handleSkip); document.removeEventListener("touchstart", handleSkip); }
  const handleContinueClick = () => startInteraction("continue"); const handleResetClick = () => startInteraction("reset");

  async function startInteraction(action) {
    if (interactionStarted) return; interactionStarted = true; skipBootstrapAnimation = false;
    if (startContainer) startContainer.classList.add("hidden"); if (loadingContainer) loadingContainer.classList.remove("hidden");
    document.body.style.justifyContent = "flex-start"; initAudioContext(); removeInteractionListeners(); addSkipListener();
    try {
        const dependenciesLoaded = await loadCoreDependencies();
        if (!dependenciesLoaded) { removeSkipListener(); return; }
        if (action === "reset") { await clearAllReploidData(); await bl("Rebooting after reset...", "info", null, 64); await bl("            ", "only-gui", null, 8); await bootstrapReploid(true); }
        else await bootstrapReploid(false);
    } catch (err) {
        const errorMsg = err.message || "Unknown error during startInteraction."; await bl("FATAL: Unhandled error in startInteraction.", "error", errorMsg);
        console.error("Unhandled startInteraction Error:", err); if (loadingIndicator) loadingIndicator.innerHTML = `<div class="log-entry log-error">> FATAL BOOTSTRAP ERROR: ${errorMsg}. Check console.</div>`;
    } finally { removeSkipListener(); }
  }
  if (continueButton) continueButton.addEventListener("click", handleContinueClick);
  if (resetButton) resetButton.addEventListener("click", handleResetClick);
  document.addEventListener("keydown", handleKeydown);
})();
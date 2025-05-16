const UIModule = (config, logger, Utils, Storage, StateManager, Errors) => {
  if (!config || !logger || !Utils || !Storage || !StateManager || !Errors) {
    const internalLog = logger || {
      logEvent: (lvl, msg, det) =>
        console[lvl === "error" ? "error" : "log"](
          `[UI_FALLBACK] ${msg}`,
          det || ""
        ),
    };
    internalLog.logEvent(
      "error",
      "UIModule initialization failed: Missing base dependencies."
    );
    const fakeUI = {};
    [
      "init",
      "updateStatus",
      "updateApiProgress",
      "updateStreamingOutput",
      "clearStreamingOutput",
      "highlightCoreStep",
      "showNotification",
      "logToTimeline",
      "logCoreLoopStep",
      "updateTimelineItem",
      "summarizeCompletedCycleLog",
      "clearCurrentCycleDetails",
      "displayCycleArtifact",
      "displayToolExecutionSummary",
      "hideHumanInterventionUI",
      "showHumanInterventionUI",
      "hideMetaSandbox",
      "showMetaSandbox",
      "updateStateDisplay",
      "updateAutonomyControls",
      "setRunButtonState",
      "getRefs",
      "isMetaSandboxPending",
      "isHumanInterventionHidden",
      "updateHtmlHistoryControls",
    ].forEach((methodName) => {
      fakeUI[methodName] = () => {
        internalLog.logEvent(
          "error",
          `UIModule not initialized. Called ${methodName}.`
        );
        if (
          methodName === "isMetaSandboxPending" ||
          methodName === "isHumanInterventionHidden"
        )
          return true;
        if (methodName === "getRefs") return {};
      };
    });
    return fakeUI;
  }

  let uiRefs = {};
  let isInitialized = false;
  let CycleLogic = null;
  let metaSandboxPending = false;
  let activeCoreStepIdx = -1;
  let lastCycleLogItem = null;
  let syntaxHighlightTimer = null;

  const APP_MODELS = [
    config.DEFAULT_MODELS.BASE,
    config.DEFAULT_MODELS.ADVANCED,
  ];
  if (
    config.DEFAULT_MODELS.CRITIQUE &&
    !APP_MODELS.includes(config.DEFAULT_MODELS.CRITIQUE)
  ) {
    APP_MODELS.push(config.DEFAULT_MODELS.CRITIQUE);
  }

  const CTX_WARN_THRESH = config.CTX_WARN_THRESH;
  const EVAL_PASS_THRESHOLD = config.EVAL_PASS_THRESHOLD || 0.75;
  const SYNTAX_HIGHLIGHT_DEBOUNCE = 250;
  const TIMELINE_LOG_LIMIT = config.TIMELINE_LOG_LIMIT || 250;

  const logIconMap = {
    error: "✗",
    warn: "⚠",
    api: "🌐",
    tool: "🛠️",
    crit: "⚖️",
    human: "👤",
    apply: "💾",
    artifact: "📄",
    state: "⚙️",
    context: "📚",
    goal: "🎯",
    cycle: "🔄",
    retry: "⏳",
    decide: "🤔",
    finish: "🏁",
    eval: "📊",
    learn: "💡",
    info: "ℹ️",
    default: "➡️",
  };
  const stepIconMap = [
    "🎯",
    "🔍",
    "💡",
    "⚙️",
    "🚦",
    "⚖️",
    "💾",
    "📊",
    "🧠",
    "🏁",
  ];
  const artifactTypeMap = {
    JS: "[JS]",
    CSS: "[CSS]",
    HTML_HEAD: "[HEAD]",
    HTML_BODY: "[BODY]",
    JSON: "[JSON]",
    PROMPT: "[PROMPT]",
    FULL_HTML_SOURCE: "[PAGE]",
    TEXT: "[TEXT]",
    DIAGRAM_JSON: "[DIAG]",
    JSON_CONFIG: "[CONFIG]",
    LOG: "[LOG]",
    EVAL_DEF: "[EVAL_DEF]",
    WEB_COMPONENT_DEF: "[WC-DEF]",
    UNKNOWN: "[?]",
  };

  const getLogIcon = (message, type) =>
    logIconMap[type?.toLowerCase()] || logIconMap.default;
  const getStepIcon = (index) => stepIconMap[index] || logIconMap.default;
  const getArtifactTypeIndicator = (type) =>
    artifactTypeMap[type?.toUpperCase()] || artifactTypeMap.UNKNOWN;

  const initializeUIElementReferences = () => {
    const elementIds = [
      "total-cycles",
      "max-cycles-display",
      "agent-iterations",
      "human-interventions",
      "fail-count",
      "current-goal",
      "last-critique-type",
      "persona-mode",
      "html-history-count",
      "context-token-estimate",
      "avg-confidence",
      "critique-fail-rate",
      "avg-tokens",
      "avg-eval-score",
      "eval-pass-rate",
      "context-token-warning",
      "context-token-target-display",
      "current-cycle-details",
      "current-cycle-content",
      "current-cycle-number",
      "goal-input",
      "seed-prompt-core",
      "seed-prompt-critique",
      "seed-prompt-summarize",
      "seed-prompt-evaluator",
      "api-key-input",
      "lsd-persona-percent-input",
      "xyz-persona-percent-input",
      "llm-critique-prob-input",
      "human-review-prob-input",
      "max-cycle-time-input",
      "auto-critique-thresh-input",
      "max-cycles-input",
      "html-history-limit-input",
      "pause-after-cycles-input",
      "max-retries-input",
      "timeline-log",
      "status-indicator",
      "core-loop-steps-minimap",
      "run-cycle-button",
      "force-human-review-button",
      "go-back-button",
      "export-state-button",
      "import-state-button",
      "import-file-input",
      "download-log-button",
      "summarize-context-button",
      "clear-local-storage-button",
      "human-intervention-section",
      "human-intervention-title",
      "human-intervention-reason",
      "human-intervention-reason-summary",
      "hitl-options-mode",
      "hitl-options-list",
      "submit-hitl-options-button",
      "hitl-prompt-mode",
      "human-critique-input",
      "submit-critique-button",
      "hitl-code-edit-mode",
      "human-edit-artifact-selector",
      "human-edit-artifact-textarea",
      "submit-human-code-edit-button",
      "hitl-critique-feedback-mode",
      "hitl-critiques-display",
      "hitl-critique-selection",
      "hitl-critique-notes",
      "submit-critique-feedback-button",
      "meta-sandbox-container",
      "meta-sandbox-output",
      "approve-meta-change-button",
      "discard-meta-change-button",
      "genesis-state-display",
      "genesis-metrics-display",
      "notifications-container",
      "core-model-selector",
      "critique-model-selector",
      "streaming-output-container",
      "streaming-output-pre",
      "api-progress",
      "tools-executed-container",
      "tools-executed-list",
      "autonomy-mode-selector",
      "autonomy-n-cycles-input",
      "autonomy-start-stop-button",
    ];
    const selectorsForClasses = ["goal-type-selector", "autonomy-n-label"];
    uiRefs = {};
    elementIds.forEach((kebabId) => {
      let element = selectorsForClasses.includes(kebabId)
        ? Utils.$(`.${kebabId}`)
        : Utils.$id(kebabId);
      if (element) uiRefs[Utils.kabobToCamel(kebabId)] = element;
      else {
        const optionalElements = [
          "hitl-critique-selection",
          "hitl-critique-notes",
          "hitl-critiques-display",
          "notifications-container",
          "autonomy-n-label",
        ];
        if (!optionalElements.includes(kebabId))
          logger.logEvent(
            "warn",
            `UI element not found: ${
              selectorsForClasses.includes(kebabId) ? "." : "#"
            }${kebabId}`
          );
      }
    });
    logger.logEvent("debug", "UI element references initialized.");
  };

  const updateStatus = (message, isActive = false, isError = false) => {
    if (!uiRefs.statusIndicator) return;
    uiRefs.statusIndicator.textContent = `Status: ${message}`;
    uiRefs.statusIndicator.classList.toggle("active", isActive);
    uiRefs.statusIndicator.classList.toggle("error", isError);
  };

  const updateApiProgress = (message) => {
    if (uiRefs.apiProgress)
      uiRefs.apiProgress.textContent = message
        ? `API: ${Utils.trunc(message, 30)}`
        : "";
  };

  const updateStreamingOutput = (content, isFinal = false) => {
    if (uiRefs.streamingOutputContainer && uiRefs.streamingOutputPre) {
      uiRefs.streamingOutputContainer.classList.remove("hidden");
      uiRefs.streamingOutputPre.textContent = content;
      uiRefs.streamingOutputPre.scrollTop =
        uiRefs.streamingOutputPre.scrollHeight;
    }
  };

  const clearStreamingOutput = () => {
    if (uiRefs.streamingOutputContainer && uiRefs.streamingOutputPre) {
      uiRefs.streamingOutputPre.textContent = "(Stream ended)";
      setTimeout(() => {
        if (uiRefs.streamingOutputContainer)
          uiRefs.streamingOutputContainer.classList.add("hidden");
      }, 2000);
    }
  };

  const highlightCoreStep = (stepIndex) => {
    activeCoreStepIdx = stepIndex;
    const minimap = uiRefs.coreLoopStepsMinimap;
    if (!minimap) return;
    const stepsList = minimap.querySelector("ol");
    if (!stepsList) return;
    const listItems = stepsList.querySelectorAll("li");
    listItems.forEach((li, idx) => {
      const isActive = idx === stepIndex;
      li.classList.toggle("active-step", isActive);
      let iconSpan = li.querySelector(".step-icon");
      if (!iconSpan) {
        iconSpan = document.createElement("span");
        iconSpan.className = "step-icon";
        li.insertBefore(iconSpan, li.firstChild);
      }
      iconSpan.textContent = getStepIcon(idx);
      iconSpan.setAttribute("aria-hidden", "true");
    });
  };

  const showNotification = (message, type = "info", duration = 5000) => {
    const container =
      uiRefs.notificationsContainer || Utils.$id("notifications-container");
    if (!container) {
      console.error("Notification container not found!");
      alert(`[${Utils.ucFirst(type)}] ${message}`);
      return;
    }
    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.innerHTML = `${Utils.escapeHtml(
      message
    )}<button style="background:none;border:none;float:right;cursor:pointer;color:inherit;font-size:1.2em;line-height:1;padding:0;margin-left:10px;">×</button>`;
    const button = notification.querySelector("button");
    if (button) button.onclick = () => notification.remove();
    container.appendChild(notification);
    if (duration > 0)
      setTimeout(() => {
        if (notification.parentElement) notification.remove();
      }, duration);
  };

  const updateMetricsDisplay = (state) => {
    if (!state || !StateManager) return;
    const derivedStats = StateHelpersPure.calculateDerivedStatsPure(
      state.confidenceHistory,
      state.critiqueFailHistory,
      state.tokenHistory,
      state.evaluationHistory,
      config.MAX_HISTORY_ITEMS || 20,
      EVAL_PASS_THRESHOLD
    );

    if (uiRefs.avgConfidence)
      uiRefs.avgConfidence.textContent =
        derivedStats.avgConfidence?.toFixed(2) || "N/A";
    if (uiRefs.critiqueFailRate)
      uiRefs.critiqueFailRate.textContent =
        derivedStats.critiqueFailRate?.toFixed(1) + "%" || "N/A";
    if (uiRefs.avgEvalScore)
      uiRefs.avgEvalScore.textContent =
        derivedStats.avgEvalScore?.toFixed(2) || "N/A";
    if (uiRefs.evalPassRate)
      uiRefs.evalPassRate.textContent =
        derivedStats.evalPassRate?.toFixed(1) + "%" || "N/A";
    if (uiRefs.avgTokens)
      uiRefs.avgTokens.textContent =
        derivedStats.avgTokens?.toFixed(0) || "N/A";
    if (uiRefs.contextTokenEstimate)
      uiRefs.contextTokenEstimate.textContent =
        state.contextTokenEstimate?.toLocaleString() || "0";
    if (uiRefs.failCount) uiRefs.failCount.textContent = state.failCount || 0;
    if (uiRefs.contextTokenTargetDisplay)
      uiRefs.contextTokenTargetDisplay.textContent =
        state.contextTokenTarget?.toLocaleString() ||
        config.CTX_TARGET.toLocaleString();
    checkContextTokenWarning(state);
  };

  const checkContextTokenWarning = (state) => {
    if (!state || !uiRefs.contextTokenWarning) return;
    const threshold = state.contextTokenTarget * 0.9 || CTX_WARN_THRESH;
    const isWarn = state.contextTokenEstimate >= threshold;
    uiRefs.contextTokenWarning.classList.toggle("hidden", !isWarn);
    if (
      isWarn &&
      !uiRefs.contextTokenWarning.classList.contains("warning-logged")
    ) {
      logger.logEvent(
        "warn",
        `Context high! (${state.contextTokenEstimate.toLocaleString()}/${state.contextTokenTarget.toLocaleString()}). Consider summarizing.`
      );
      uiRefs.contextTokenWarning.classList.add("warning-logged");
    } else if (!isWarn)
      uiRefs.contextTokenWarning.classList.remove("warning-logged");
  };

  const updateHtmlHistoryControls = (state) => {
    if (!uiRefs.htmlHistoryCount || !state) return;
    const count = state.htmlHistory?.length || 0;
    uiRefs.htmlHistoryCount.textContent = count.toString();
    if (uiRefs.goBackButton) uiRefs.goBackButton.disabled = count === 0;
  };

  const updateFieldsetSummaries = (state) => {
    if (!state || !StateManager) return;
    const updateSummary = (fieldsetRefOrId, text) => {
      let fieldset =
        typeof fieldsetRefOrId === "string"
          ? Utils.$id(fieldsetRefOrId)
          : fieldsetRefOrId;
      if (fieldset) {
        const summary = fieldset.querySelector(".summary-line");
        if (summary)
          summary.textContent = text ? `| ${Utils.trunc(text, 80)}` : "";
      }
    };
    const cfg = state.cfg || {};
    const coreModelName = (cfg.coreModel || "unknown")
      .split("/")
      .pop()
      .replace("-latest", "");
    const critiqueModelName = (cfg.critiqueModel || "unknown")
      .split("/")
      .pop()
      .replace("-latest", "");
    updateSummary(
      "genesis-config",
      `LSD:${cfg.personaBalance ?? "?"}% Crit:${
        cfg.llmCritiqueProb ?? "?"
      }% Rev:${cfg.humanReviewProb ?? "?"}% MaxC:${
        cfg.maxCycles || "Inf"
      } Core:${coreModelName} Util:${critiqueModelName}`
    );
    const promptLens = {
      core:
        Storage.getArtifactContent("reploid.core.sys-prompt", 0)?.length || 0,
      crit:
        Storage.getArtifactContent("reploid.core.critiquer-prompt", 0)
          ?.length || 0,
      sum:
        Storage.getArtifactContent("reploid.core.summarizer-prompt", 0)
          ?.length || 0,
      eval:
        Storage.getArtifactContent("reploid.core.evaluator-prompt", 0)
          ?.length || 0,
    };
    updateSummary(
      "seed-prompts",
      `Core:${promptLens.core}c Crit:${promptLens.crit}c Sum:${promptLens.sum}c Eval:${promptLens.eval}c`
    );
    updateSummary(uiRefs.genesisStateDisplay, "Cycle 0 Info");
    const cycleContentDiv = uiRefs.currentCycleContent;
    let itemCount = 0;
    let totalChars = 0;
    if (cycleContentDiv) {
      const sections = cycleContentDiv.querySelectorAll(".artifact-section");
      itemCount = sections.length;
      sections.forEach((section) => {
        const pre = section.querySelector("pre code");
        if (pre) totalChars += pre.textContent.length;
      });
    }
    updateSummary(
      uiRefs.currentCycleDetails,
      `Items: ${itemCount}, Content Chars: ${totalChars.toLocaleString()}`
    );
    updateSummary(
      "timeline-fieldset",
      `Entries: ${uiRefs.timelineLog?.childElementCount || 0}`
    );
    const registeredWCs = StateManager.getRegisteredWebComponents();
    const wcSummary =
      registeredWCs.length > 0
        ? ` WCs: ${registeredWCs.length} (${Utils.trunc(
            registeredWCs.join(", "),
            20
          )})`
        : "";
    updateSummary(
      "controls-fieldset",
      `API Key: ${state.apiKey ? "Set" : "Not Set"} | Mode: ${
        state.autonomyMode || "Manual"
      } ${wcSummary}`
    );
  };

  const updateStateDisplay = () => {
    if (!StateManager) {
      logger.logEvent("error", "updateStateDisplay: StateManager missing.");
      return;
    }
    const state = StateManager.getState();
    if (!state) {
      logger.logEvent("error", "updateStateDisplay: state is null.");
      return;
    }
    const cfg = state.cfg || {};
    if (uiRefs.lsdPersonaPercentInput)
      uiRefs.lsdPersonaPercentInput.value = cfg.personaBalance ?? 50;
    if (uiRefs.xyzPersonaPercentInput)
      uiRefs.xyzPersonaPercentInput.value = 100 - (cfg.personaBalance ?? 50);
    if (uiRefs.llmCritiqueProbInput)
      uiRefs.llmCritiqueProbInput.value = cfg.llmCritiqueProb ?? 50;
    if (uiRefs.humanReviewProbInput)
      uiRefs.humanReviewProbInput.value = cfg.humanReviewProb ?? 50;
    if (uiRefs.maxCycleTimeInput)
      uiRefs.maxCycleTimeInput.value = cfg.maxCycleTime ?? 600;
    if (uiRefs.autoCritiqueThreshInput)
      uiRefs.autoCritiqueThreshInput.value = cfg.autoCritiqueThresh ?? 0.75;
    if (uiRefs.maxCyclesInput) uiRefs.maxCyclesInput.value = cfg.maxCycles ?? 0;
    if (uiRefs.htmlHistoryLimitInput)
      uiRefs.htmlHistoryLimitInput.value = cfg.htmlHistoryLimit ?? 5;
    if (uiRefs.pauseAfterCyclesInput)
      uiRefs.pauseAfterCyclesInput.value = cfg.pauseAfterCycles ?? 10;
    if (uiRefs.maxRetriesInput)
      uiRefs.maxRetriesInput.value = cfg.maxRetries ?? 1;
    if (uiRefs.apiKeyInput) uiRefs.apiKeyInput.value = state.apiKey || "";
    if (uiRefs.coreModelSelector)
      uiRefs.coreModelSelector.value =
        cfg.coreModel || config.DEFAULT_MODELS.BASE;
    if (uiRefs.critiqueModelSelector)
      uiRefs.critiqueModelSelector.value =
        cfg.critiqueModel || config.DEFAULT_MODELS.CRITIQUE; // TODO: this should use critiqueModel from config
    if (uiRefs.autonomyModeSelector)
      uiRefs.autonomyModeSelector.value = state.autonomyMode || "Manual";
    if (uiRefs.autonomyNCyclesInput && state.autonomyMode === "N_Cycles") {
      uiRefs.autonomyNCyclesInput.value =
        state.autonomyCyclesRemaining > 0
          ? state.autonomyCyclesRemaining
          : cfg.autonomyDefaultNCycles || 5;
    }
    const maxC = cfg.maxCycles || 0;
    if (uiRefs.maxCyclesDisplay)
      uiRefs.maxCyclesDisplay.textContent =
        maxC === 0 ? "Inf" : maxC.toString();
    if (uiRefs.totalCycles)
      uiRefs.totalCycles.textContent = state.totalCycles || 0;
    if (uiRefs.agentIterations)
      uiRefs.agentIterations.textContent = state.agentIterations || 0;
    if (uiRefs.humanInterventions)
      uiRefs.humanInterventions.textContent = state.humanInterventions || 0;
    const goalInfo = CycleLogic?.getActiveGoalInfo() || {
      type: "Idle",
      latestGoal: "Idle",
    };
    let goalText =
      goalInfo.type === "Idle"
        ? "Idle"
        : `${goalInfo.type}: ${goalInfo.latestGoal}`;
    if (state.currentGoal?.summaryContext)
      goalText += ` (Ctx: ${Utils.trunc(
        state.currentGoal.summaryContext,
        20
      )}...)`;
    if (uiRefs.currentGoal)
      uiRefs.currentGoal.textContent = Utils.trunc(goalText, 60);
    if (uiRefs.lastCritiqueType)
      uiRefs.lastCritiqueType.textContent = state.lastCritiqueType || "N/A";
    if (uiRefs.personaMode)
      uiRefs.personaMode.textContent = state.personaMode || "N/A";
    updateMetricsDisplay(state);
    updateHtmlHistoryControls(state);
    updateAutonomyControls(
      state.autonomyMode,
      CycleLogic?.isRunning() && CycleLogic?.isAutonomous()
    );
    const humanInterventionVisible =
      !uiRefs.humanInterventionSection?.classList.contains("hidden");
    const isCycleRunning = CycleLogic ? CycleLogic.isRunning() : false;
    const isAutonomousRunning = CycleLogic ? CycleLogic.isAutonomous() : false;
    setRunButtonState(
      isCycleRunning ? "Abort Cycle" : "Run Cycle",
      isCycleRunning && isAutonomousRunning
    );
    updateFieldsetSummaries(state);
  };

  const displayGenesisState = () => {
    if (!uiRefs.genesisMetricsDisplay || !StateManager) {
      logger.logEvent(
        "warn",
        "displayGenesisState: Required elements or StateManager missing."
      );
      return;
    }
    const state = StateManager.getState();
    if (!state || !state.cfg) {
      uiRefs.genesisMetricsDisplay.innerHTML =
        "<p>Genesis state not fully loaded or config missing.</p>";
      return;
    }
    const metricsEl = Utils.$id("core-metrics-display");
    if (metricsEl) {
      const staticMetricsHTML = `<div>Cycles <strong>0</strong>/${
        state.cfg.maxCycles || "Inf"
      }</div><div>Agent Itr <strong>0</strong></div><div>Human Int <strong>0</strong></div><div>Goal <strong>Idle</strong></div><div>Critique <strong>N/A</strong></div><div>Persona <strong>XYZ</strong></div><div>History <strong>0</strong></div><div>Ctx Tokens <strong>0</strong> / ${
        state.contextTokenTarget?.toLocaleString() ||
        config.CTX_TARGET.toLocaleString()
      }</div>`;
      uiRefs.genesisMetricsDisplay.innerHTML = `<div class="metrics-grid">${staticMetricsHTML}</div>`;
    } else
      uiRefs.genesisMetricsDisplay.innerHTML =
        "<p>Core Metrics Display template not found for Genesis.</p>";
  };

  const logToTimeline = (
    cycle,
    message,
    type = "info",
    isSubStep = false,
    animate = false
  ) => {
    if (!uiRefs.timelineLog || !StateManager) return null;
    if (typeof cycle !== "number")
      cycle = StateManager.getState()?.totalCycles ?? 0;
    const state = StateManager.getState();
    const persona = state?.personaMode === "XYZ" ? "[X]" : "[L]";
    const icon = getLogIcon(message, type);
    const li = document.createElement("li");
    li.setAttribute("data-cycle", cycle);
    li.setAttribute("data-timestamp", Date.now());
    li.classList.add(isSubStep ? "sub-step" : "log-entry");
    if (type === "error") li.classList.add("error");
    if (type === "warn") li.classList.add("warn");
    if (logIconMap[type?.toLowerCase()])
      li.classList.add(`log-type-${type.toLowerCase()}`);
    const cycleSpan = document.createElement("span");
    cycleSpan.className = "log-cycle-marker";
    cycleSpan.textContent = cycle;
    li.appendChild(cycleSpan);
    const contentSpan = document.createElement("span");
    let iconHTML = `<span class="log-icon" title="${type}" aria-hidden="true">${icon}</span>`;
    if (animate)
      iconHTML = `<span class="log-icon animated-icon" title="${type}" aria-hidden="true">⚙️</span>`;
    contentSpan.innerHTML = `${iconHTML} <span class="log-persona">${persona}</span> ${Utils.escapeHtml(
      Utils.trunc(message, 250)
    )}`;
    contentSpan.title = message;
    li.appendChild(contentSpan);
    const targetList = uiRefs.timelineLog;
    targetList.insertBefore(li, targetList.firstChild);
    while (targetList.children.length > TIMELINE_LOG_LIMIT)
      targetList.removeChild(targetList.lastChild);
    if (message.startsWith("[CYCLE] === Cycle")) lastCycleLogItem = li;
    return li;
  };

  const logCoreLoopStep = (cycle, stepIndex, message) => {
    highlightCoreStep(stepIndex);
    if (!uiRefs.timelineLog) return null;
    const li = document.createElement("li");
    li.classList.add("core-step");
    li.setAttribute("data-cycle", cycle);
    li.setAttribute("data-timestamp", Date.now());
    const span = document.createElement("span");
    const stepIcon = getStepIcon(stepIndex);
    span.innerHTML = `<span class="log-icon">${stepIcon}</span> <strong>Step ${
      stepIndex + 1
    }:</strong> ${Utils.escapeHtml(message)}`;
    li.appendChild(span);
    uiRefs.timelineLog.insertBefore(li, uiRefs.timelineLog.firstChild);
    while (uiRefs.timelineLog.children.length > TIMELINE_LOG_LIMIT)
      uiRefs.timelineLog.removeChild(uiRefs.timelineLog.lastChild);
    return li;
  };

  const updateTimelineItem = (
    logItem,
    newMessage,
    newType = "info",
    stopAnimate = true
  ) => {
    if (!logItem || !StateManager) return;
    const contentSpan = logItem.querySelector("span:last-child");
    if (!contentSpan) return;
    const state = StateManager.getState();
    const persona = state?.personaMode === "XYZ" ? "[X]" : "[L]";
    let iconElement = contentSpan.querySelector(".log-icon");
    let icon = iconElement?.textContent || logIconMap.default;
    let iconClass = "log-icon";
    let currentTitle = iconElement?.getAttribute("title") || newType;
    if (newMessage.includes(" OK")) icon = "✓";
    else if (newMessage.includes(" ERR")) icon = logIconMap.error;
    else if (newMessage.includes("[API OK")) icon = "▼";
    if (newType === "warn") icon = logIconMap.warn;
    if (newType === "error") icon = logIconMap.error;
    if (stopAnimate) {
      const animatedIconEl = contentSpan.querySelector(".animated-icon");
      if (animatedIconEl) {
        animatedIconEl.classList.remove("animated-icon");
        iconClass = "log-icon";
        currentTitle = newType;
      }
    } else {
      if (contentSpan.querySelector(".animated-icon")) {
        icon = logIconMap.tool;
        iconClass = "log-icon animated-icon";
      }
    }
    contentSpan.innerHTML = `<span class="${iconClass}" title="${currentTitle}">${icon}</span> ${persona} ${Utils.escapeHtml(
      newMessage
    )}`;
    logItem.classList.remove("error", "warn");
    Object.keys(logIconMap).forEach((key) =>
      logItem.classList.remove(`log-type-${key}`)
    );
    if (newType === "error") logItem.classList.add("error");
    if (newType === "warn") logItem.classList.add("warn");
    if (logIconMap[newType]) logItem.classList.add(`log-type-${newType}`);
  };

  const summarizeCompletedCycleLog = (outcome) => {
    if (!lastCycleLogItem || !lastCycleLogItem.classList.contains("log-entry"))
      return;
    lastCycleLogItem.classList.add("summary");
    const contentSpan = lastCycleLogItem.querySelector("span:last-child");
    if (contentSpan)
      contentSpan.innerHTML = `<span class="log-icon" aria-hidden="true">${
        logIconMap.finish
      }</span> Cycle ${lastCycleLogItem.getAttribute(
        "data-cycle"
      )} Completed: ${Utils.escapeHtml(
        outcome
      )} <span class="expand-hint">(Expand?)</span>`;
    lastCycleLogItem = null;
  };

  const clearCurrentCycleDetails = () => {
    if (!uiRefs.currentCycleDetails || !uiRefs.currentCycleContent) return;
    uiRefs.currentCycleContent.innerHTML =
      "<p><i>Cycle details will appear here.</i></p>";
    if (uiRefs.toolsExecutedContainer)
      uiRefs.toolsExecutedContainer.classList.add("hidden");
    if (uiRefs.toolsExecutedList) uiRefs.toolsExecutedList.innerHTML = "";
    if (uiRefs.streamingOutputContainer)
      uiRefs.streamingOutputContainer.classList.add("hidden");
    if (uiRefs.streamingOutputPre)
      uiRefs.streamingOutputPre.textContent = "(No stream active)";
    const state = StateManager?.getState();
    if (state) updateFieldsetSummaries(state);
  };

  const triggerSyntaxHighlighting = () => {
    clearTimeout(syntaxHighlightTimer);
    syntaxHighlightTimer = setTimeout(() => {
      if (window.Prism && typeof Prism.highlightAllUnder === "function") {
        try {
          Prism.highlightAllUnder(uiRefs.currentCycleContent);
        } catch (e) {
          logger.logEvent("warn", "Prism highlighting failed.", e);
        }
      } else if (window.hljs && typeof hljs.highlightAll === "function") {
        try {
          uiRefs.currentCycleContent
            .querySelectorAll("pre code")
            .forEach((block) => hljs.highlightElement(block));
        } catch (e) {
          logger.logEvent("warn", "highlight.js highlighting failed.", e);
        }
      }
    }, SYNTAX_HIGHLIGHT_DEBOUNCE);
  };

  const displayCycleArtifact = (
    label,
    content,
    type = "info",
    isModified = false,
    source = null,
    artifactId = null,
    cycle = null,
    versionId = null
  ) => {
    if (
      !uiRefs.currentCycleDetails ||
      !uiRefs.currentCycleContent ||
      !StateManager
    )
      return;
    if (
      uiRefs.currentCycleContent.children.length === 1 &&
      uiRefs.currentCycleContent.firstChild.tagName === "P"
    )
      uiRefs.currentCycleContent.innerHTML = "";
    if (uiRefs.currentCycleDetails.classList.contains("collapsed"))
      uiRefs.currentCycleDetails.classList.remove("collapsed");
    const section = document.createElement("div");
    section.className = "artifact-section";
    if (type) section.classList.add(`artifact-type-${type}`);
    if (source) {
      const sanitizedSource = String(source)
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      if (sanitizedSource)
        section.classList.add(`artifact-source-${sanitizedSource}`);
    }
    const labelEl = document.createElement("div");
    labelEl.className = "artifact-label-container";
    const meta = artifactId
      ? StateManager.getArtifactMetadata(artifactId, versionId)
      : { type: "TEXT" };
    const typeIndicator = getArtifactTypeIndicator(meta?.type);
    const langMap = {
      JS: "javascript",
      CSS: "css",
      HTML_HEAD: "html",
      HTML_BODY: "html",
      JSON: "json",
      JSON_CONFIG: "json",
      FULL_HTML_SOURCE: "html",
      PROMPT: "text",
      TEXT: "text",
      EVAL_DEF: "json",
      WEB_COMPONENT_DEF: "javascript",
    };
    const languageClass = langMap[meta?.type?.toUpperCase()]
      ? `language-${langMap[meta.type.toUpperCase()]}`
      : "language-text";
    let labelHTML = `<span class="type-indicator" aria-hidden="true">${typeIndicator}</span> <strong class="artifact-title">${Utils.escapeHtml(
      label
    )}</strong>`;
    if (artifactId)
      labelHTML += ` <span class="artifact-id-ref">(ID: ${Utils.escapeHtml(
        artifactId
      )})</span>`;
    if (versionId)
      labelHTML += ` <span class="artifact-version-ref">#${Utils.escapeHtml(
        versionId
      )}</span>`;
    if (cycle !== null)
      labelHTML += ` <span class="artifact-cycle-ref">[Cyc ${cycle}]</span>`;
    if (source)
      labelHTML += ` <span class="source-indicator">(Source: ${Utils.escapeHtml(
        source
      )})</span>`;
    if (isModified)
      labelHTML +=
        ' <span class="change-indicator" aria-label="Modified">*</span>';
    labelEl.innerHTML = labelHTML;
    section.appendChild(labelEl);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    pre.className = languageClass;
    code.className = languageClass;
    code.textContent =
      content === null || content === undefined ? "(empty)" : String(content);
    pre.appendChild(code);
    pre.classList.add(type);
    if (isModified) pre.classList.add("modified");
    section.appendChild(pre);
    uiRefs.currentCycleContent.appendChild(section);
    triggerSyntaxHighlighting();
    const state = StateManager.getState();
    if (state) updateFieldsetSummaries(state);
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const displayToolExecutionSummary = (toolSummaries) => {
    if (!uiRefs.toolsExecutedContainer || !uiRefs.toolsExecutedList) return;
    if (!toolSummaries || toolSummaries.length === 0) {
      uiRefs.toolsExecutedContainer.classList.add("hidden");
      uiRefs.toolsExecutedList.innerHTML = "";
      return;
    }
    uiRefs.toolsExecutedContainer.classList.remove("hidden");
    const fragment = document.createDocumentFragment();
    toolSummaries.forEach((summary) => {
      const li = document.createElement("li");
      li.classList.add(summary.success ? "tool-success" : "tool-fail");
      let content = `<strong>${Utils.escapeHtml(summary.name)}</strong>`;
      if (summary.args)
        content += `<span class="tool-args">Args: ${Utils.trunc(
          Utils.escapeHtml(JSON.stringify(summary.args)),
          150
        )}</span>`;
      if (summary.success) {
        if (summary.result !== undefined && summary.result !== null)
          content += `<span class="tool-result">Result: ${Utils.trunc(
            Utils.escapeHtml(JSON.stringify(summary.result)),
            150
          )}</span>`;
        else
          content += `<span class="tool-result">Result: OK (No specific return value)</span>`;
      } else
        content += `<span class="tool-error">Error: ${Utils.escapeHtml(
          summary.error || "Unknown failure"
        )}</span>`;
      li.innerHTML = content;
      fragment.appendChild(li);
    });
    uiRefs.toolsExecutedList.innerHTML = "";
    uiRefs.toolsExecutedList.appendChild(fragment);
  };

  const hideHumanInterventionUI = () => {
    if (!uiRefs.humanInterventionSection) return;
    uiRefs.humanInterventionSection.classList.add("hidden");
    if (uiRefs.hitlOptionsMode) uiRefs.hitlOptionsMode.classList.add("hidden");
    if (uiRefs.hitlPromptMode) uiRefs.hitlPromptMode.classList.add("hidden");
    if (uiRefs.hitlCodeEditMode)
      uiRefs.hitlCodeEditMode.classList.add("hidden");
    if (uiRefs.hitlCritiqueFeedbackMode)
      uiRefs.hitlCritiqueFeedbackMode.classList.add("hidden");
    const state = StateManager?.getState();
    const isCycleRunning = CycleLogic ? CycleLogic.isRunning() : false;
    const isAutonomousRunning = CycleLogic ? CycleLogic.isAutonomous() : false;
    if (
      !metaSandboxPending &&
      uiRefs.runCycleButton &&
      state &&
      !isCycleRunning &&
      !isAutonomousRunning
    )
      setRunButtonState("Run Cycle", false);
  };

  const showHumanInterventionUI = (
    mode = "prompt",
    reason = "",
    options = [],
    artifactIdToEdit = null,
    critiques = []
  ) => {
    if (!uiRefs.humanInterventionSection || !StateManager) return;
    const state = StateManager.getState();
    if (!state) return;
    highlightCoreStep(5);
    hideMetaSandbox();
    uiRefs.humanInterventionSection.classList.remove("hidden");
    const fieldset = uiRefs.humanInterventionSection.querySelector("fieldset");
    if (fieldset) fieldset.classList.remove("collapsed");
    const titleText = `Human Intervention: ${Utils.ucFirst(
      mode.replace("_", " ")
    )}`;
    if (uiRefs.humanInterventionTitle)
      uiRefs.humanInterventionTitle.textContent = titleText;
    if (uiRefs.humanInterventionReason)
      uiRefs.humanInterventionReason.innerHTML = `<strong>Reason:</strong> ${Utils.escapeHtml(
        reason
      )}`;
    if (uiRefs.humanInterventionReasonSummary)
      uiRefs.humanInterventionReasonSummary.textContent = `| Reason: ${Utils.trunc(
        reason,
        50
      )}...`;
    if (uiRefs.runCycleButton) setRunButtonState("Run Cycle", true);
    if (uiRefs.autonomyStartStopButton) setAutonomyButtonState(false, true);
    logToTimeline(
      state.totalCycles,
      `[HUMAN] Intervention Required (${mode}): ${Utils.trunc(reason, 100)}`,
      "warn",
      true
    );
    if (uiRefs.hitlOptionsMode) uiRefs.hitlOptionsMode.classList.add("hidden");
    if (uiRefs.hitlPromptMode) uiRefs.hitlPromptMode.classList.add("hidden");
    if (uiRefs.hitlCodeEditMode)
      uiRefs.hitlCodeEditMode.classList.add("hidden");
    if (uiRefs.hitlCritiqueFeedbackMode)
      uiRefs.hitlCritiqueFeedbackMode.classList.add("hidden");
    let activeModeContainer = null;
    let focusElement = null;
    if (
      mode === "critique_feedback" &&
      critiques &&
      critiques.length > 0 &&
      uiRefs.hitlCritiqueFeedbackMode
    ) {
      activeModeContainer = uiRefs.hitlCritiqueFeedbackMode;
      if (uiRefs.hitlCritiquesDisplay)
        uiRefs.hitlCritiquesDisplay.innerHTML = "";
      if (uiRefs.hitlCritiqueSelection)
        uiRefs.hitlCritiqueSelection.innerHTML = "";
      const displayFragment = document.createDocumentFragment();
      const selectionFragment = document.createDocumentFragment();
      let firstFailingCritiqueIndex = -1;
      critiques.forEach((crit, index) => {
        const critDiv = document.createElement("div");
        critDiv.className = `critique-item ${
          crit.critique_passed ? "pass" : "fail"
        }`;
        critDiv.innerHTML = `<h4>Critique ${index + 1} (${
          crit.critique_passed ? "Pass" : "FAIL"
        })</h4><pre>${Utils.escapeHtml(crit.critique_report)}</pre>`;
        displayFragment.appendChild(critDiv);
        const radioLabel = document.createElement("label");
        const radioInput = document.createElement("input");
        radioInput.type = "radio";
        radioInput.name = "critique_selection";
        radioInput.value = index;
        radioInput.id = `critique_select_${index}`;
        if (!crit.critique_passed && firstFailingCritiqueIndex === -1)
          firstFailingCritiqueIndex = index;
        radioLabel.appendChild(radioInput);
        radioLabel.appendChild(
          document.createTextNode(
            ` Select Critique ${index + 1} as most relevant`
          )
        );
        selectionFragment.appendChild(radioLabel);
        selectionFragment.appendChild(document.createElement("br"));
      });
      const defaultCheckedIndex =
        firstFailingCritiqueIndex !== -1 ? firstFailingCritiqueIndex : 0;
      const defaultRadio = selectionFragment.querySelector(
        `#critique_select_${defaultCheckedIndex}`
      );
      if (defaultRadio) defaultRadio.checked = true;
      if (uiRefs.hitlCritiquesDisplay)
        uiRefs.hitlCritiquesDisplay.appendChild(displayFragment);
      if (uiRefs.hitlCritiqueSelection)
        uiRefs.hitlCritiqueSelection.appendChild(selectionFragment);
      if (uiRefs.hitlCritiqueNotes) uiRefs.hitlCritiqueNotes.value = "";
      triggerSyntaxHighlighting();
      focusElement =
        uiRefs.hitlCritiqueNotes ||
        uiRefs.hitlCritiqueSelection?.querySelector('input[type="radio"]');
    } else if (mode === "code_edit" && uiRefs.hitlCodeEditMode) {
      activeModeContainer = uiRefs.hitlCodeEditMode;
      if (uiRefs.humanEditArtifactSelector)
        uiRefs.humanEditArtifactSelector.innerHTML = "";
      if (uiRefs.humanEditArtifactTextarea)
        uiRefs.humanEditArtifactTextarea.value = "";
      const editableTypes = [
        "HTML_HEAD",
        "HTML_BODY",
        "CSS",
        "JS",
        "JSON",
        "FULL_HTML_SOURCE",
        "PROMPT",
        "TEXT",
        "EVAL_DEF",
        "WEB_COMPONENT_DEF",
      ];
      const currentCycle = state.totalCycles;
      const allMetaMap = StateManager.getAllArtifactMetadata();
      const relevantArtifacts = Object.values(allMetaMap)
        .filter(
          (meta) =>
            meta && editableTypes.includes(meta.type) && meta.latestCycle >= 0
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const fragment = document.createDocumentFragment();
      relevantArtifacts.forEach((meta) => {
        const opt = document.createElement("option");
        opt.value = meta.id;
        opt.textContent = `${meta.id} (${meta.type}) - Last Mod: Cyc ${meta.latestCycle}`;
        fragment.appendChild(opt);
      });
      if (
        state.lastGeneratedFullSource &&
        (artifactIdToEdit === "full_html_source" ||
          artifactIdToEdit === "page_composition_preview")
      ) {
        const opt = document.createElement("option");
        opt.value = artifactIdToEdit;
        opt.textContent = `Proposed ${Utils.ucFirst(
          artifactIdToEdit.replace("_", " ")
        )} (Cycle ${currentCycle})`;
        fragment.appendChild(opt);
      }
      if (uiRefs.humanEditArtifactSelector)
        uiRefs.humanEditArtifactSelector.appendChild(fragment);
      const selectArtifact = (id) => {
        if (!uiRefs.humanEditArtifactTextarea) return;
        let contentToEdit = "";
        let currentArtCycle = currentCycle;
        let currentArtVersionId = null;
        if (id === "full_html_source" || id === "page_composition_preview") {
          contentToEdit = state.lastGeneratedFullSource || "";
          currentArtCycle = state.totalCycles;
        } else {
          const meta = StateManager.getArtifactMetadata(id);
          if (meta && meta.latestCycle >= 0) {
            contentToEdit =
              Storage.getArtifactContent(
                id,
                meta.latestCycle,
                meta.version_id
              ) || "";
            currentArtCycle = meta.latestCycle;
            currentArtVersionId = meta.version_id;
          } else contentToEdit = "(Artifact not found or empty)";
        }
        uiRefs.humanEditArtifactTextarea.value = contentToEdit;
        uiRefs.humanEditArtifactTextarea.setAttribute(
          "data-current-artifact-id",
          id
        );
        uiRefs.humanEditArtifactTextarea.setAttribute(
          "data-current-artifact-cycle",
          currentArtCycle
        );
        if (currentArtVersionId)
          uiRefs.humanEditArtifactTextarea.setAttribute(
            "data-current-artifact-version-id",
            currentArtVersionId
          );
        else
          uiRefs.humanEditArtifactTextarea.removeAttribute(
            "data-current-artifact-version-id"
          );
        triggerSyntaxHighlighting();
      };
      if (uiRefs.humanEditArtifactSelector)
        uiRefs.humanEditArtifactSelector.onchange = () =>
          selectArtifact(uiRefs.humanEditArtifactSelector.value);
      const metaToEdit = artifactIdToEdit
        ? StateManager.getArtifactMetadata(artifactIdToEdit)
        : null;
      const initialId =
        artifactIdToEdit &&
        ((metaToEdit && metaToEdit.latestCycle >= 0) ||
          artifactIdToEdit === "full_html_source" ||
          artifactIdToEdit === "page_composition_preview")
          ? artifactIdToEdit
          : relevantArtifacts[0]?.id;
      if (initialId && uiRefs.humanEditArtifactSelector) {
        uiRefs.humanEditArtifactSelector.value = initialId;
        selectArtifact(initialId);
      } else if (uiRefs.humanEditArtifactTextarea) {
        uiRefs.humanEditArtifactTextarea.value =
          "(No editable artifacts found)";
        uiRefs.humanEditArtifactTextarea.removeAttribute(
          "data-current-artifact-id"
        );
        uiRefs.humanEditArtifactTextarea.removeAttribute(
          "data-current-artifact-cycle"
        );
        uiRefs.humanEditArtifactTextarea.removeAttribute(
          "data-current-artifact-version-id"
        );
      }
      focusElement =
        uiRefs.humanEditArtifactSelector || uiRefs.humanEditArtifactTextarea;
    } else {
      activeModeContainer = uiRefs.hitlPromptMode;
      if (uiRefs.humanCritiqueInput) {
        uiRefs.humanCritiqueInput.value = "";
        uiRefs.humanCritiqueInput.placeholder = `Provide feedback or next instructions related to: ${Utils.trunc(
          reason,
          80
        )}`;
        focusElement = uiRefs.humanCritiqueInput;
      }
    }
    if (activeModeContainer) activeModeContainer.classList.remove("hidden");
    if (focusElement) focusElement.focus();
    if (uiRefs.humanInterventionSection)
      uiRefs.humanInterventionSection.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  };

  const hideMetaSandbox = () => {
    if (!uiRefs.metaSandboxContainer) return;
    uiRefs.metaSandboxContainer.classList.add("hidden");
    metaSandboxPending = false;
    const humanInterventionVisible =
      !uiRefs.humanInterventionSection?.classList.contains("hidden");
    const isCycleRunning = CycleLogic ? CycleLogic.isRunning() : false;
    const isAutonomousRunning = CycleLogic ? CycleLogic.isAutonomous() : false;
    if (
      !humanInterventionVisible &&
      uiRefs.runCycleButton &&
      !isCycleRunning &&
      !isAutonomousRunning
    )
      setRunButtonState("Run Cycle", false);
    if (uiRefs.autonomyStartStopButton && !isCycleRunning)
      setAutonomyButtonState(!isAutonomousRunning, false);
  };

  const showMetaSandbox = (htmlSource) => {
    if (
      !uiRefs.metaSandboxContainer ||
      !uiRefs.metaSandboxOutput ||
      !StateManager
    )
      return;
    const state = StateManager.getState();
    if (!state) return;
    highlightCoreStep(6);
    hideHumanInterventionUI();
    uiRefs.metaSandboxContainer.classList.remove("hidden");
    const fieldset = uiRefs.metaSandboxContainer.querySelector("fieldset");
    if (fieldset) fieldset.classList.remove("collapsed");
    if (uiRefs.runCycleButton) setRunButtonState("Run Cycle", true);
    if (uiRefs.autonomyStartStopButton) setAutonomyButtonState(false, true);
    const iframe = uiRefs.metaSandboxOutput;
    try {
      if (!iframe.contentWindow)
        throw new Error("Meta sandbox iframe contentWindow is not accessible.");
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(htmlSource);
      doc.close();
      logger.logEvent("info", "Meta sandbox rendered for approval.");
      metaSandboxPending = true;
      logToTimeline(
        state.totalCycles,
        "[STATE] Meta-Sandbox Ready for Review.",
        "state",
        true
      );
      uiRefs.metaSandboxContainer.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (e) {
      logger.logEvent("error", `Cannot render meta sandbox: ${e.message}`, e);
      showNotification("Error: Failed to show meta sandbox preview.", "error");
      logToTimeline(
        state.totalCycles,
        "[ERROR] Meta-Sandbox failed to render.",
        "error",
        true
      );
      hideMetaSandbox();
      if (uiRefs.runCycleButton) setRunButtonState("Run Cycle", false);
    }
  };

  const loadPromptsFromLS = () => {
    if (
      !uiRefs.seedPromptCore ||
      !uiRefs.seedPromptCritique ||
      !uiRefs.seedPromptSummarize ||
      !uiRefs.seedPromptEvaluator
    ) {
      logger.logEvent("warn", "Prompt textareas not found during UI init.");
      return;
    }
    uiRefs.seedPromptCore.value =
      Storage.getArtifactContent("reploid.core.sys-prompt", 0) || "";
    uiRefs.seedPromptCritique.value =
      Storage.getArtifactContent("reploid.core.critiquer-prompt", 0) || "";
    uiRefs.seedPromptSummarize.value =
      Storage.getArtifactContent("reploid.core.summarizer-prompt", 0) || "";
    uiRefs.seedPromptEvaluator.value =
      Storage.getArtifactContent("reploid.core.evaluator-prompt", 0) || "";
    logger.logEvent("debug", "Loaded prompts from LS into UI.");
  };

  const loadCoreLoopSteps = () => {
    highlightCoreStep(activeCoreStepIdx);
    logger.logEvent("debug", "Initialized core loop steps minimap.");
  };

  const populateModelSelectors = () => {
    [uiRefs.coreModelSelector, uiRefs.critiqueModelSelector].forEach(
      (selector) => {
        if (!selector) return;
        selector.innerHTML = "";
        const fragment = document.createDocumentFragment();
        APP_MODELS.forEach((modelName) => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName.split("/").pop();
          fragment.appendChild(option);
        });
        selector.appendChild(fragment);
      }
    );
  };

  const handleConfigChange = (key, value) => {
    StateManager.updateAndSaveState((currentState) => {
      if (!currentState.cfg) currentState.cfg = {};
      if (currentState.cfg[key] !== value) {
        currentState.cfg[key] = value;
        logger.logEvent("info", `UI Config Update: ${key} = ${value}`);
        if (key === "maxCycles" && uiRefs.maxCyclesDisplay)
          uiRefs.maxCyclesDisplay.textContent =
            value === 0 ? "Inf" : String(value);
        if (key === "htmlHistoryLimit") updateHtmlHistoryControls(currentState);
      }
      return currentState;
    });
    updateFieldsetSummaries(StateManager.getState());
  };

  const _setupControlButtonListeners = () => {
    uiRefs.runCycleButton?.addEventListener("click", () => {
      if (CycleLogic.isRunning()) CycleLogic.abortCurrentCycle();
      else CycleLogic.executeCycle();
    });
    uiRefs.forceHumanReviewButton?.addEventListener("click", () => {
      StateManager.updateAndSaveState((s) => {
        s.forceHumanReview = true;
        return s;
      });
      showNotification("Next cycle will pause for Human Review.", "info");
      logToTimeline(
        StateManager.getState()?.totalCycles || 0,
        "[HUMAN] User forced Human Review.",
        "human"
      );
    });
    uiRefs.downloadLogButton?.addEventListener("click", () => {
      try {
        const logData = logger.getLogBuffer
          ? logger.getLogBuffer()
          : "(Log buffer unavailable)";
        const blob = new Blob([logData], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `x0_log_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        logger.logEvent("info", "Log download initiated.");
      } catch (e) {
        logger.logEvent("error", `Log download failed: ${e.message}`, e);
        showNotification(`Log download failed: ${e.message}`, "error");
      }
    });
    uiRefs.exportStateButton?.addEventListener("click", () =>
      StateManager?.exportState(uiRefs)
    );
    uiRefs.summarizeContextButton?.addEventListener("click", () =>
      CycleLogic?.handleSummarizeContext()
    );
    uiRefs.importStateButton?.addEventListener("click", () =>
      uiRefs.importFileInput?.click()
    );
    uiRefs.importFileInput?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file && StateManager) {
        StateManager.importState(file, (success, importedData, errorMsg) => {
          if (success && importedData) {
            if (uiRefs.timelineLog)
              uiRefs.timelineLog.innerHTML = importedData.timelineHTML || "";
            clearCurrentCycleDetails();
            populateModelSelectors();
            updateStateDisplay();
            displayGenesisState();
            loadPromptsFromLS();
            loadCoreLoopSteps();
            logToTimeline(
              importedData.totalCycles,
              "[STATE] State imported.",
              "state"
            );
            showNotification(
              "State imported. Ensure required artifacts exist in localStorage.",
              "info"
            );
          } else {
            showNotification(
              `Import failed: ${errorMsg || "Unknown error"}`,
              "error"
            );
            logToTimeline(
              StateManager?.getState()?.totalCycles ?? 0,
              `[STATE] State import failed: ${errorMsg || "Unknown"}`,
              "error"
            );
          }
          if (uiRefs.importFileInput) uiRefs.importFileInput.value = "";
        });
      }
    });
    uiRefs.goBackButton?.addEventListener("click", () => {
      const state = StateManager.getState();
      if (!state?.htmlHistory?.length) {
        showNotification("No history.", "warn");
        return;
      }
      if (
        !confirm("Revert page to previous version? State will attempt restore.")
      )
        return;
      const prevStateHtml = state.htmlHistory[state.htmlHistory.length - 1];
      StateManager.updateAndSaveState((s) => {
        s.htmlHistory.pop();
        return s;
      });
      updateHtmlHistoryControls(StateManager.getState());
      logger.logEvent(
        "info",
        `Reverting page HTML. History size: ${
          StateManager.getState().htmlHistory.length
        }`
      );
      logToTimeline(
        state.totalCycles,
        "[STATE] Reverting HTML (Page Reload).",
        "state"
      );
      try {
        const stateToPreserve = StateManager.capturePreservationState(uiRefs);
        Storage.saveSessionState(stateToPreserve);
        document.open();
        document.write(prevStateHtml);
        document.close();
      } catch (e) {
        logger.logEvent("error", `Go Back failed: ${e.message}`, e);
        showNotification(`Go Back failed: ${e.message}`, "error");
        Storage.removeSessionState();
        StateManager.updateAndSaveState((s) => {
          if (prevStateHtml) s.htmlHistory.push(prevStateHtml);
          return s;
        });
        updateHtmlHistoryControls(StateManager.getState());
      }
    });
    uiRefs.clearLocalStorageButton?.addEventListener("click", () => {
      if (
        !confirm(
          "WARNING: Delete ALL Reploid data from LocalStorage? Cannot be undone."
        )
      )
        return;
      try {
        Storage.clearAllReploidData();
        showNotification("LocalStorage cleared. Reloading...", "info", 0);
        setTimeout(() => window.location.reload(), 1000);
      } catch (e) {
        logger.logEvent(
          "error",
          `Error clearing LocalStorage: ${e.message}`,
          e
        );
        showNotification(`Error clearing LocalStorage: ${e.message}`, "error");
      }
    });
  };

  const _setupHitlButtonListeners = () => {
    uiRefs.submitCritiqueButton?.addEventListener("click", () => {
      if (CycleLogic.proceedAfterHumanIntervention && uiRefs.humanCritiqueInput)
        CycleLogic.proceedAfterHumanIntervention(
          "Human Prompt",
          uiRefs.humanCritiqueInput.value.trim()
        );
    });
    uiRefs.submitHitlOptionsButton?.addEventListener("click", () => {
      if (CycleLogic.proceedAfterHumanIntervention && uiRefs.hitlOptionsList) {
        const selected = Array.from(
          uiRefs.hitlOptionsList.querySelectorAll("input:checked")
        )
          .map((el) => el.value)
          .join(", ");
        CycleLogic.proceedAfterHumanIntervention(
          "Human Options",
          selected || "None"
        );
      }
    });
    uiRefs.submitHumanCodeEditButton?.addEventListener("click", async () => {
      if (
        !CycleLogic.runTool ||
        !CycleLogic.proceedAfterHumanIntervention ||
        !uiRefs.humanEditArtifactTextarea ||
        !StateManager
      )
        return;
      const artifactId = uiRefs.humanEditArtifactTextarea.getAttribute(
        "data-current-artifact-id"
      );
      const cycleStr = uiRefs.humanEditArtifactTextarea.getAttribute(
        "data-current-artifact-cycle"
      );
      const versionId =
        uiRefs.humanEditArtifactTextarea.getAttribute(
          "data-current-artifact-version-id"
        ) || null;
      const newContent = uiRefs.humanEditArtifactTextarea.value;
      if (!artifactId || cycleStr === null) {
        showNotification(
          "Error: No artifact selected or cycle info missing.",
          "error"
        );
        return;
      }
      const cycle = parseInt(cycleStr, 10);
      if (isNaN(cycle)) {
        showNotification("Error: Invalid cycle number for artifact.", "error");
        return;
      }
      updateStatus("Validating Edit...", true);
      try {
        const toolResult = await CycleLogic.runTool("code_edit", {
          artifactId,
          cycle,
          versionId,
          newContent,
        });
        updateStatus("Idle");
        if (toolResult?.success) {
          showNotification(
            `Edit for ${artifactId} validated. Proceeding...`,
            "info"
          );
          CycleLogic.proceedAfterHumanIntervention(
            "Human Code Edit",
            toolResult
          );
        } else {
          showNotification(
            `Edit Validation Failed: ${
              toolResult?.error || "Unknown validation error"
            }`,
            "error"
          );
          logger.logEvent(
            "error",
            `Human edit validation failed for ${artifactId}: ${toolResult?.error}`
          );
        }
      } catch (e) {
        updateStatus("Idle");
        logger.logEvent(
          "error",
          `Error running code_edit tool for ${artifactId}: ${e.message}`,
          e
        );
        showNotification(`Error validating edit: ${e.message}`, "error");
      }
    });
    uiRefs.submitCritiqueFeedbackButton?.addEventListener("click", () => {
      if (!CycleLogic.proceedAfterHumanIntervention || !StateManager) return;
      const selectedCritiqueIndex = uiRefs.hitlCritiqueSelection?.querySelector(
        'input[name="critique_selection"]:checked'
      )?.value;
      const notes = uiRefs.hitlCritiqueNotes?.value.trim() || "";
      const feedbackData = {
        selectedCritique:
          selectedCritiqueIndex !== undefined
            ? parseInt(selectedCritiqueIndex, 10)
            : -1,
        feedbackNotes: notes,
      };
      CycleLogic.proceedAfterHumanIntervention(
        "Human Critique Selection",
        feedbackData
      );
    });
  };

  const _setupSandboxButtonListeners = () => {
    uiRefs.approveMetaChangeButton?.addEventListener("click", () => {
      const state = StateManager.getState();
      if (metaSandboxPending && state?.lastGeneratedFullSource) {
        const sourceToApply = state.lastGeneratedFullSource;
        logger.logEvent("info", "Approved meta-change.");
        logToTimeline(
          state.totalCycles,
          "[STATE] Approved Meta-Sandbox. Applying & Reloading...",
          "state",
          true
        );
        hideMetaSandbox();
        const currentHtml = document.documentElement.outerHTML;
        CycleLogic?.saveHtmlToHistory(currentHtml);
        const stateToPreserve = StateManager.capturePreservationState(uiRefs);
        StateManager.updateAndSaveState((s) => {
          s.metaSandboxPending = false;
          return s;
        });
        try {
          Storage.saveSessionState(stateToPreserve);
          document.open();
          document.write(sourceToApply);
          document.close();
        } catch (e) {
          logger.logEvent("error", `Apply meta-change failed: ${e.message}`, e);
          showNotification(`Apply failed: ${e.message}`, "error");
          Storage.removeSessionState();
          StateManager.updateAndSaveState((s) => {
            if (s?.htmlHistory?.length > 0) s.htmlHistory.pop();
            return s;
          });
          updateHtmlHistoryControls(StateManager.getState());
          metaSandboxPending = true;
          showMetaSandbox(sourceToApply);
          if (uiRefs.runCycleButton) setRunButtonState("Run Cycle", true);
        }
      } else
        showNotification(
          "No sandbox content pending or state missing.",
          "warn"
        );
    });
    uiRefs.discardMetaChangeButton?.addEventListener("click", () => {
      const state = StateManager.getState();
      logger.logEvent("info", "Discarded meta-sandbox changes.");
      logToTimeline(
        state?.totalCycles || 0,
        "[STATE] Discarded Meta-Sandbox changes.",
        "warn",
        true
      );
      hideMetaSandbox();
      StateManager.updateAndSaveState((s) => {
        s.lastGeneratedFullSource = null;
        return s;
      });
      CycleLogic?.proceedAfterHumanIntervention(
        "Sandbox Discarded",
        "User discarded changes",
        true
      );
    });
  };

  const _setupConfigInputListeners = () => {
    uiRefs.lsdPersonaPercentInput?.addEventListener("input", () => {
      const lsdInput = uiRefs.lsdPersonaPercentInput;
      const xyzInput = uiRefs.xyzPersonaPercentInput;
      if (!lsdInput || !xyzInput) return;
      let lsd = parseInt(lsdInput.value, 10) || 0;
      lsd = Math.max(0, Math.min(100, lsd));
      lsdInput.value = lsd;
      xyzInput.value = 100 - lsd;
      handleConfigChange("personaBalance", lsd);
    });
    const defaultConfig = config.DEFAULT_CFG || {};
    Object.keys(defaultConfig).forEach((key) => {
      if (
        key === "personaBalance" ||
        key === "coreModel" ||
        key === "critiqueModel"
      )
        return;
      const inputId = Utils.camelToKabob(key) + "-input";
      const inputEl = uiRefs[Utils.kabobToCamel(inputId)];
      if (inputEl) {
        inputEl.addEventListener("change", (e) => {
          const target = e.target;
          let value;
          if (target.type === "number") {
            value =
              target.step === "any" || target.step?.includes(".")
                ? parseFloat(target.value)
                : parseInt(target.value, 10);
            const min = parseFloat(target.min);
            const max = parseFloat(target.max);
            if (!isNaN(min) && value < min) value = min;
            if (!isNaN(max) && value > max) value = max;
            target.value = value;
          } else value = target.value;
          handleConfigChange(key, value);
        });
      }
    });
    uiRefs.coreModelSelector?.addEventListener("change", (e) =>
      handleConfigChange("coreModel", e.target.value)
    );
    uiRefs.critiqueModelSelector?.addEventListener("change", (e) =>
      handleConfigChange("critiqueModel", e.target.value)
    );
    uiRefs.apiKeyInput?.addEventListener("change", (e) =>
      handleConfigChange("apiKey", e.target.value.trim())
    );
  };

  const _setupAutonomyListeners = () => {
    uiRefs.autonomyModeSelector?.addEventListener("change", (e) => {
      const mode = e.target.value;
      StateManager.updateAndSaveState((s) => {
        s.autonomyMode = mode;
        if (mode !== "N_Cycles") s.autonomyCyclesRemaining = 0;
        return s;
      });
      updateAutonomyControls(mode, false);
      updateStateDisplay();
    });
    uiRefs.autonomyNCyclesInput?.addEventListener("change", (e) => {
      StateManager.updateAndSaveState((s) => {
        if (s.autonomyMode === "N_Cycles") {
          let cycles = parseInt(e.target.value, 10);
          cycles = Math.max(1, isNaN(cycles) ? 1 : cycles);
          s.autonomyCyclesRemaining = cycles;
          e.target.value = cycles;
        }
        return s;
      });
    });
    uiRefs.autonomyStartStopButton?.addEventListener("click", () => {
      const state = StateManager.getState();
      if (!state) return;
      if (CycleLogic.isAutonomous())
        CycleLogic.stopAutonomousRun("User Stop Request");
      else {
        const mode = state.autonomyMode || "Manual";
        const cycles = parseInt(uiRefs.autonomyNCyclesInput?.value || "5", 10);
        if (mode === "Manual")
          showNotification(
            "Select 'Run N Cycles' or 'Continuous' mode first.",
            "warn"
          );
        else if (mode === "N_Cycles" && (isNaN(cycles) || cycles <= 0))
          showNotification(
            "Please enter a valid number of cycles > 0.",
            "warn"
          );
        else CycleLogic.startAutonomousRun(mode, cycles);
      }
    });
  };

  const updateAutonomyControls = (mode, isRunning) => {
    const nCyclesInput = uiRefs.autonomyNCyclesInput;
    const nCyclesLabel = uiRefs.autonomyNLabel;
    const startStopButton = uiRefs.autonomyStartStopButton;
    if (nCyclesInput && nCyclesLabel) {
      const showNCycles = mode === "N_Cycles";
      nCyclesInput.classList.toggle("hidden", !showNCycles);
      nCyclesLabel.classList.toggle("hidden", !showNCycles);
      nCyclesInput.disabled = isRunning && mode === "N_Cycles";
    }
    if (startStopButton) {
      startStopButton.disabled =
        mode === "Manual" || (CycleLogic?.isRunning() && !isRunning);
      startStopButton.textContent = isRunning
        ? "Stop Autonomous Run"
        : "Start Autonomous Run";
    }
    setRunButtonState(
      uiRefs.runCycleButton?.textContent || "Run Cycle",
      isRunning || (CycleLogic?.isRunning() && !isRunning)
    );
  };

  const setRunButtonState = (text, disabled) => {
    if (uiRefs.runCycleButton) {
      uiRefs.runCycleButton.textContent = text;
      uiRefs.runCycleButton.disabled = disabled;
    }
  };
  const setAutonomyButtonState = (isRunning, disabled) => {
    if (uiRefs.autonomyStartStopButton) {
      uiRefs.autonomyStartStopButton.textContent = isRunning
        ? "Stop Autonomous Run"
        : "Start Autonomous Run";
      uiRefs.autonomyStartStopButton.disabled = disabled;
    }
    if (uiRefs.autonomyModeSelector)
      uiRefs.autonomyModeSelector.disabled = disabled || isRunning;
    if (uiRefs.autonomyNCyclesInput)
      uiRefs.autonomyNCyclesInput.disabled = disabled || isRunning;
  };

  const _setupFieldsetListeners = () => {
    document.querySelectorAll("fieldset legend").forEach((legend) => {
      legend.addEventListener("click", (event) => {
        if (event.target.closest("button, input, a, select, textarea")) return;
        const fieldset = legend.closest("fieldset");
        fieldset?.classList.toggle("collapsed");
      });
    });
  };

  const setupEventListeners = () => {
    if (!isInitialized || !CycleLogic || !StateManager) {
      logger.logEvent(
        "error",
        "UI elements or core logic refs not ready for event listeners."
      );
      return;
    }
    _setupControlButtonListeners();
    _setupHitlButtonListeners();
    _setupSandboxButtonListeners();
    _setupConfigInputListeners();
    _setupAutonomyListeners();
    _setupFieldsetListeners();
    logger.logEvent("info", "UI Event listeners set up.");
  };

  const _loadInitialUIData = () => {
    const state = StateManager.getState();
    if (!state) {
      logger.logEvent("error", "Cannot load initial UI data, state is null.");
      return;
    }
    updateStateDisplay();
    displayGenesisState();
    loadPromptsFromLS();
    loadCoreLoopSteps();
    document.querySelectorAll("fieldset").forEach((fs) => {
      if (fs.id !== "controls-fieldset" && fs.id !== "current-cycle-details")
        fs.classList.add("collapsed");
      else fs.classList.remove("collapsed");
    });
    if (state) updateFieldsetSummaries(state);
    logToTimeline(
      state?.totalCycles || 0,
      "[STATE] System Initialized.",
      "state"
    );
  };

  const restoreUIState = (preservedData) => {
    if (!isInitialized || !uiRefs.timelineLog) {
      logger.logEvent(
        "warn",
        "Cannot restore UI state, UI not fully initialized or timeline missing."
      );
      return;
    }
    metaSandboxPending = preservedData.metaSandboxPending || false;
    if (uiRefs.timelineLog)
      uiRefs.timelineLog.innerHTML = preservedData.timelineHTML || "";
    populateModelSelectors();
    updateStateDisplay();
    displayGenesisState();
    loadPromptsFromLS();
    loadCoreLoopSteps();
    logToTimeline(
      preservedData.totalCycles,
      "[STATE] Restored after self-mod.",
      "state"
    );
    const isAutonomousRunning = preservedData.autonomyMode !== "Manual";
    setRunButtonState("Run Cycle", metaSandboxPending || isAutonomousRunning);
    setAutonomyButtonState(isAutonomousRunning, metaSandboxPending);
    updateStatus(metaSandboxPending ? "Meta Sandbox Pending..." : "Idle");
    document.querySelectorAll("fieldset").forEach((fs) => {
      if (
        !fs.classList.contains("collapsed") &&
        fs.id !== "controls-fieldset" &&
        fs.id !== "current-cycle-details"
      )
        fs.classList.add("collapsed");
    });
    if (preservedData) updateFieldsetSummaries(preservedData);
    logger.logEvent("info", "UI state restored from session data.");
  };

  const init = (injectedStateManager, injectedCycleLogic) => {
    if (isInitialized) return;
    logger.logEvent("info", "Initializing UI Module...");
    StateManager = injectedStateManager;
    CycleLogic = injectedCycleLogic;
    if (!StateManager || !CycleLogic) {
      logger.logEvent(
        "error",
        "UI Init failed: StateManager or CycleLogic not provided."
      );
      return;
    }
    initializeUIElementReferences();
    populateModelSelectors();
    isInitialized = true;
    const restored = StateManager.restoreStateFromSession(restoreUIState);
    if (!restored) _loadInitialUIData();
    setupEventListeners();
    highlightCoreStep(-1);
    updateStatus("Idle");
    logger.logEvent("info", "UI Module initialization complete.");
  };

  return {
    init,
    updateStatus,
    updateApiProgress,
    updateStreamingOutput,
    clearStreamingOutput,
    highlightCoreStep,
    showNotification,
    logToTimeline,
    logCoreLoopStep,
    updateTimelineItem,
    summarizeCompletedCycleLog,
    clearCurrentCycleDetails,
    displayCycleArtifact,
    displayToolExecutionSummary,
    hideHumanInterventionUI,
    showHumanInterventionUI,
    hideMetaSandbox,
    showMetaSandbox,
    updateStateDisplay,
    updateAutonomyControls,
    setRunButtonState,
    getRefs: () => uiRefs,
    isMetaSandboxPending: () => metaSandboxPending,
    isHumanInterventionHidden: () =>
      uiRefs.humanInterventionSection?.classList.contains("hidden") ?? true,
    updateHtmlHistoryControls,
  };
};

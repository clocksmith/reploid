const CycleLogicModule = (
  config,
  logger,
  Utils,
  Storage,
  StateManager,
  UI,
  ApiClient,
  ToolRunner
) => {
  if (
    !config ||
    !logger ||
    !Utils ||
    !Storage ||
    !StateManager ||
    !UI ||
    !ApiClient ||
    !ToolRunner
  ) {
    console.error("CycleLogicModule requires all core modules.");
    const log = logger || {
      logEvent: (lvl, msg) =>
        console[lvl === "error" ? "error" : "log"](
          `[CYCLELOGIC FALLBACK] ${msg}`
        ),
    };
    log.logEvent(
      "error",
      "CycleLogicModule initialization failed: Missing dependencies."
    );
    return {
      init: () => log.logEvent("error", "CycleLogic not initialized."),
      executeCycle: async () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      isRunning: () => false,
      getActiveGoalInfo: () => ({ type: "Idle", latestGoal: "Idle" }),
      proceedAfterHumanIntervention: () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      handleSummarizeContext: async () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      abortCurrentCycle: () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      saveHtmlToHistory: () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      runTool: async () => {
        throw new Error("CycleLogic not initialized.");
      },
      startAutonomousRun: () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
      stopAutonomousRun: () => {
        log.logEvent("error", "CycleLogic not initialized.");
      },
    };
  }

  let _isRunning = false;
  let _isAutonomous = false;
  let _abortRequested = false;
  let currentLlmResponse = null;
  let loadedStaticTools = [];
  let isLogicInitialized = false;
  const NUM_CRITIQUES_TO_GENERATE = config.NUM_CRITIQUES_TO_GENERATE || 1;

  const init = () => {
    if (isLogicInitialized) return;
    logger.logEvent("info", "Initializing CycleLogic Module...");
    try {
      const staticToolsContent = Storage.getArtifactContent(
        "reploid.core.static-tools",
        0
      );
      if (staticToolsContent) {
        loadedStaticTools = JSON.parse(staticToolsContent);
        logger.logEvent(
          "debug",
          `CycleLogic loaded ${loadedStaticTools.length} static tools definitions.`
        );
      } else {
        logger.logEvent(
          "warn",
          "Static tools artifact not found during CycleLogic init."
        );
        loadedStaticTools = [];
      }
    } catch (e) {
      logger.logEvent(
        "error",
        `Failed to load/parse static tools in CycleLogic: ${e.message}`,
        e
      );
      loadedStaticTools = [];
    }
    isLogicInitialized = true;
    logger.logEvent("info", "CycleLogic Module initialized.");
  };

  const isRunning = () => _isRunning;
  const isAutonomous = () => _isAutonomous;

  const getActiveGoalInfo = () => {
    const state = StateManager?.getState();
    if (!state || !state.currentGoal)
      return {
        seedGoal: "N/A",
        cumulativeGoal: "N/A",
        latestGoal: "Idle",
        type: "Idle",
      };
    const latestGoal = state.currentGoal.cumulative || state.currentGoal.seed;
    return {
      seedGoal: state.currentGoal.seed || "None",
      cumulativeGoal: state.currentGoal.cumulative || "None",
      latestGoal: latestGoal || "Idle",
      type: state.currentGoal.latestType || "Idle",
      summaryContext: state.currentGoal.summaryContext || null,
      currentContextFocus: state.currentGoal.currentContextFocus || null,
    };
  };

  const _getArtifactListSummary = () => {
    if (!StateManager) return "Error: StateManager not available.";
    const allMetaMap = StateManager.getAllArtifactMetadata();
    return (
      Object.values(allMetaMap)
        .filter((meta) => meta && meta.latestCycle >= 0)
        .map(
          (meta) => `* ${meta.id} (${meta.type}) - Cycle ${meta.latestCycle}`
        )
        .join("\n") || "None"
    );
  };

  const _getToolListSummary = () => {
    if (!StateManager) return "Error: StateManager not available.";
    const state = StateManager.getState();
    const dynamicTools = state?.dynamicTools || [];
    const staticToolSummary = loadedStaticTools
      .map((t) => `* [S] ${t.name}: ${Utils.trunc(t.description, 60)}`)
      .join("\n");
    const dynamicToolSummary = dynamicTools
      .map(
        (t) =>
          `* [D] ${t.declaration.name}: ${Utils.trunc(
            t.declaration.description,
            60
          )}`
      )
      .join("\n");
    return (
      [staticToolSummary, dynamicToolSummary].filter((s) => s).join("\n") ||
      "None"
    );
  };

  const _summarizeHistory = (historyArray, label, maxItems = 5) => {
    if (!historyArray || historyArray.length === 0)
      return `No ${label} available.`;
    const recentItems = historyArray.slice(-maxItems);
    return recentItems
      .map((item, index) => {
        const itemIndex = historyArray.length - recentItems.length + index + 1;
        let summary = `${label} ${itemIndex}: `;
        if (label.includes("Eval")) {
          summary += `Score=${item.evaluation_score?.toFixed(2)}, Target=${
            item.targetArtifactId || "N/A"
          }(C${item.targetArtifactCycle ?? "N/A"}), Report=${Utils.trunc(
            item.evaluation_report,
            50
          )}`;
        } else if (label.includes("Critique History")) {
          summary += item ? "Fail" : "Pass";
        } else if (label.includes("Critique Feedback")) {
          summary += `Selected: ${
            item.feedback?.selectedCritique ?? "N/A"
          }, Notes: ${Utils.trunc(item.feedback?.feedbackNotes, 60)}`;
        } else if (label.includes("Fail History")) {
          summary += `Cycle ${item.cycle}, Reason: ${Utils.trunc(
            item.reason,
            60
          )}`;
        } else {
          summary += Utils.trunc(JSON.stringify(item), 80);
        }
        return summary;
      })
      .join(" | ");
  };

  const _assembleCorePrompt = (state, goalInfo, currentCycle) => {
    const corePromptTemplate = Storage.getArtifactContent(
      "reploid.core.sys-prompt",
      0
    );
    if (!corePromptTemplate)
      throw new Error(
        "Core prompt artifact 'reploid.core.sys-prompt' not found!"
      );

    const personaBalance = state.cfg?.personaBalance ?? 50;
    const primaryPersona = state.personaMode;

    const critiqueHistorySummary = _summarizeHistory(
      state.critiqueFailHistory,
      "Critique History"
    );
    const critiqueFeedbackSummary = _summarizeHistory(
      state.critiqueFeedbackHistory,
      "Critique Feedback"
    );
    const evaluationHistorySummary = _summarizeHistory(
      state.evaluationHistory,
      "Evaluation History"
    );
    const failHistorySummary = _summarizeHistory(
      state.failHistory,
      "Fail History"
    );

    let currentContext = goalInfo.cumulativeGoal || "None";
    if (goalInfo.summaryContext) {
      currentContext += `\n\n--- Current Summary Context ---\n${goalInfo.summaryContext}`;
    }

    let prompt = corePromptTemplate
      .replace(/\[LSD_PERCENT\]/g, String(personaBalance))
      .replace(/\[PERSONA_MODE\]/g, primaryPersona)
      .replace(/\[CYCLE_COUNT\]/g, String(state.totalCycles))
      .replace(/\[AGENT_ITR_COUNT\]/g, String(state.agentIterations))
      .replace(/\[HUMAN_INT_COUNT\]/g, String(state.humanInterventions))
      .replace(/\[FAIL_COUNT\]/g, String(state.failCount))
      .replace(
        /\[LAST_FEEDBACK\]/g,
        Utils.trunc(state.lastFeedback || "None", 500)
      )
      .replace(/\[\[CRITIQUE_HISTORY_SUMMARY\]\]/g, critiqueHistorySummary)
      .replace(/\[\[CRITIQUE_FEEDBACK_SUMMARY\]\]/g, critiqueFeedbackSummary)
      .replace(/\[\[EVALUATION_HISTORY_SUMMARY\]\]/g, evaluationHistorySummary)
      .replace(/\[AVG_CONF\]/g, state.avgConfidence?.toFixed(2) || "N/A")
      .replace(
        /\[CRIT_FAIL_RATE\]/g,
        state.critiqueFailRate?.toFixed(1) + "%" || "N/A"
      )
      .replace(/\[AVG_TOKENS\]/g, state.avgTokens?.toFixed(0) || "N/A")
      .replace(/\[AVG_EVAL_SCORE\]/g, state.avgEvalScore?.toFixed(2) || "N/A")
      .replace(
        /\[CTX_TOKENS\]/g,
        state.contextTokenEstimate?.toLocaleString() || "0"
      )
      .replace(
        /\[CTX_TARGET\]/g,
        state.contextTokenTarget?.toLocaleString() || "~1M"
      )
      .replace(/\[\[DYNAMIC_TOOLS_LIST\]\]/g, _getToolListSummary())
      .replace(
        /\[\[RECENT_LOGS\]\]/g,
        Utils.trunc(
          logger.getLogBuffer
            ? logger.getLogBuffer().split("\n").slice(-15).join("\n")
            : "Logs unavailable",
          1000
        )
      )
      .replace(/\[\[ARTIFACT_LIST\]\]/g, _getArtifactListSummary())
      .replace(
        /\[\[SEED_GOAL_DESC\]\]/g,
        Utils.trunc(goalInfo.seedGoal || "None", 1000)
      )
      .replace(
        /\[\[CUMULATIVE_GOAL_DESC\]\]/g,
        Utils.trunc(currentContext, 4000)
      )
      .replace(
        /\[\[SUMMARY_CONTEXT\]\]/g,
        Utils.trunc(goalInfo.summaryContext || "None", 2000)
      )
      .replace(
        /\[\[CURRENT_CONTEXT_FOCUS\]\]/g,
        goalInfo.currentContextFocus || "Full Goal Context"
      );

    const allMetaMap = StateManager.getAllArtifactMetadata();
    const relevantArtifacts = Object.keys(allMetaMap)
      .filter(
        (id) =>
          allMetaMap[id]?.latestCycle >= 0 &&
          (id.startsWith("target.") ||
            (goalInfo.type === "Meta" && id.startsWith("reploid.")))
      )
      .sort(
        (a, b) =>
          (allMetaMap[b]?.latestCycle ?? -1) -
          (allMetaMap[a]?.latestCycle ?? -1)
      )
      .slice(0, 10);

    let snippets = "";
    for (const id of relevantArtifacts) {
      const meta = allMetaMap[id];
      if (!meta) continue;
      const content = Storage.getArtifactContent(id, meta.latestCycle);
      if (content !== null) {
        snippets += `\n---\nArtifact: ${id} (Cycle ${
          meta.latestCycle
        })\n${Utils.trunc(content, 500)}\n---`;
      }
    }
    prompt = prompt.replace(
      /\[\[ARTIFACT_CONTENT_SNIPPETS\]\]/g,
      snippets || "No relevant artifact snippets found or loaded."
    );

    UI.displayCycleArtifact(
      "LLM Input Prompt",
      prompt,
      "input",
      false,
      "System",
      "prompt.core",
      currentCycle
    );
    if (goalInfo.summaryContext) {
      UI.displayCycleArtifact(
        "LLM Input Context",
        goalInfo.summaryContext,
        "input",
        false,
        "System",
        "prompt.summary",
        currentCycle
      );
    }
    return prompt;
  };

  const _prepareFunctionDeclarations = async (state) => {
    let allFuncDecls = [];
    const dynamicTools = state?.dynamicTools || [];
    const uiHooks = {
      updateStatus: () => {},
      logTimeline: () => ({}),
      updateTimelineItem: () => {},
    };
    try {
      const toolRunnerWithApiClient = ToolRunnerModule(
        config,
        logger,
        Storage,
        StateManager,
        ApiClient
      );

      const staticToolPromises = loadedStaticTools.map(async (toolDef) => {
        try {
          return (
            await toolRunnerWithApiClient.runTool(
              "convert_to_gemini_fc",
              { mcpToolDefinition: toolDef },
              loadedStaticTools,
              [],
              uiHooks
            )
          ).geminiFunctionDeclaration;
        } catch (e) {
          logger.logEvent(
            "error",
            `Failed converting static tool ${toolDef.name}: ${e.message}`
          );
          return null;
        }
      });
      const dynamicToolPromises = dynamicTools.map(async (toolDef) => {
        try {
          return (
            await toolRunnerWithApiClient.runTool(
              "convert_to_gemini_fc",
              { mcpToolDefinition: toolDef.declaration },
              loadedStaticTools,
              [],
              uiHooks
            )
          ).geminiFunctionDeclaration;
        } catch (e) {
          logger.logEvent(
            "error",
            `Failed converting dynamic tool ${toolDef.declaration.name}: ${e.message}`
          );
          return null;
        }
      });
      const results = await Promise.all([
        ...staticToolPromises,
        ...dynamicToolPromises,
      ]);
      allFuncDecls = results.filter(Boolean);
    } catch (toolConvError) {
      logger.logEvent(
        "error",
        `Error during tool conversion phase: ${toolConvError.message}`,
        toolConvError
      );
    }
    return allFuncDecls;
  };

  const _handleToolExecution = async (
    toolCall,
    state,
    currentCycle,
    uiHooks
  ) => {
    const { name: toolName, arguments: toolArgs } = toolCall;
    uiHooks.updateStatus(`Running Tool: ${toolName}...`, true);
    let toolLogItem = uiHooks.logTimeline(
      currentCycle,
      `[TOOL] Calling '${toolName}'... Args: ${Utils.trunc(
        JSON.stringify(toolArgs),
        60
      )}`,
      "tool",
      true,
      true
    );

    UI.displayCycleArtifact(
      `Tool Call: ${toolName}`,
      JSON.stringify(toolArgs, null, 2),
      "info",
      false,
      "LLM",
      `tool.call.${toolName}`,
      currentCycle
    );
    let funcRespContent;
    let toolResult = null;
    let toolError = null;
    let toolSuccess = false;

    try {
      const toolRunnerWithApiClient = ToolRunnerModule(
        config,
        logger,
        Storage,
        StateManager,
        ApiClient
      );
      toolResult = await toolRunnerWithApiClient.runTool(
        toolName,
        toolArgs,
        loadedStaticTools,
        state.dynamicTools || [],
        uiHooks
      );
      toolSuccess = true;
      if (
        toolResult &&
        typeof toolResult.success === "boolean" &&
        !toolResult.success
      ) {
        toolSuccess = false;
        toolError = new Error(
          toolResult.error || `Tool '${toolName}' reported failure.`
        );
      }

      funcRespContent = {
        name: toolName,
        response: { content: JSON.stringify(toolResult) },
      };
      uiHooks.updateTimelineItem(
        toolLogItem,
        `[TOOL ${
          toolSuccess ? "OK" : "FAIL"
        }] '${toolName}'. Result: ${Utils.trunc(
          JSON.stringify(toolResult),
          80
        )}`,
        toolSuccess ? "tool" : "error",
        true
      );
      UI.displayCycleArtifact(
        `Tool Response: ${toolName}`,
        JSON.stringify(toolResult, null, 2),
        toolSuccess ? "output" : "error",
        false,
        "Tool",
        `tool.response.${toolName}`,
        currentCycle
      );

      if (toolName === "run_self_evaluation" && toolResult && toolSuccess) {
        StateManager.addEvaluationResult(toolResult);
      }
      if (!toolSuccess && toolError) {
        throw toolError;
      }
    } catch (e) {
      toolSuccess = false;
      toolError = e;
      logger.logEvent("error", `Tool failed ${toolName}: ${e.message}`, e);
      funcRespContent = {
        name: toolName,
        response: { error: `Tool failed: ${e.message}` },
      };
      uiHooks.updateTimelineItem(
        toolLogItem,
        `[TOOL ERR] '${toolName}': ${e.message}`,
        "error",
        true
      );
      UI.displayCycleArtifact(
        `Tool Error: ${toolName}`,
        e.message,
        "error",
        false,
        "Tool",
        `tool.error.${toolName}`,
        currentCycle
      );
    }

    return {
      role: "function",
      parts: [{ functionResponse: funcRespContent }],
      _toolExecutionInfo: {
        name: toolName,
        args: toolArgs,
        success: toolSuccess,
        result: toolResult,
        error: toolError?.message || null,
      },
    };
  };

  const _executeLlmApiCallSequence = async (
    prompt,
    sysInstruction,
    coreModel,
    apiKey,
    allFuncDecls,
    state,
    currentCycle
  ) => {
    let apiHistory = [];
    let currentApiResult = null;
    let accumulatedText = "";
    let isContinuation = false;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let toolExecutionSummaries = [];

    const uiHooks = {
      updateStatus: UI.updateStatus,
      logTimeline: UI.logToTimeline,
      updateTimelineItem: UI.updateTimelineItem,
      displayArtifact: UI.displayCycleArtifact,
    };

    let currentPrompt = prompt;
    let currentHistory = null;

    for (let i = 0; i < 5; i++) {
      logger.logEvent("debug", `API Call Sequence: Iteration ${i + 1}`);
      let loopApiResult = null;
      let loopAccumulatedText = "";

      const callResult = await ApiClient.callApiWithRetry(
        currentPrompt,
        sysInstruction,
        coreModel,
        apiKey,
        allFuncDecls,
        isContinuation,
        currentHistory,
        state.cfg?.maxRetries ?? 1,
        {},
        uiHooks.updateStatus,
        uiHooks.logTimeline,
        uiHooks.updateTimelineItem,
        (progress) => {
          if (progress.type === "text") {
            loopAccumulatedText += progress.content;
            UI.updateStreamingOutput(loopAccumulatedText);
          } else if (progress.type === "functionCall") {
            UI.updateStreamingOutput(
              "Function Call received: " +
                progress.content.name +
                "\nArgs:\n" +
                JSON.stringify(progress.content.args, null, 2)
            );
          }
          if (progress.accumulatedResult)
            loopApiResult = progress.accumulatedResult;
        }
      );

      if (!loopApiResult) loopApiResult = callResult;
      currentApiResult = loopApiResult;
      accumulatedText = loopAccumulatedText;
      totalInputTokens += loopApiResult.inputTokenCount || 0;
      totalOutputTokens += loopApiResult.outputTokenCount || 0;

      if (currentPrompt)
        apiHistory.push({ role: "user", parts: [{ text: currentPrompt }] });
      if (loopApiResult.rawResp?.candidates?.[0]?.content) {
        apiHistory.push(loopApiResult.rawResp.candidates[0].content);
      } else if (loopApiResult.type === "text" && loopApiResult.content) {
        apiHistory.push({
          role: "model",
          parts: [{ text: loopApiResult.content }],
        });
      }

      if (
        loopApiResult.type === "functionCall" &&
        loopApiResult.content?.name
      ) {
        uiHooks.updateStatus("Processing Tool Call...", true);
        const fc = loopApiResult.content;
        const toolResponse = await _handleToolExecution(
          fc,
          state,
          currentCycle,
          uiHooks
        );
        toolExecutionSummaries.push(toolResponse._toolExecutionInfo);
        apiHistory.push(toolResponse);

        currentPrompt = null;
        currentHistory = [...apiHistory];
        isContinuation = true;
        loopAccumulatedText = "";
        continue;
      } else {
        break;
      }
    }

    state.lastApiResponse = currentApiResult;
    state.contextTokenEstimate += totalOutputTokens;

    return {
      apiResult: currentApiResult,
      accumulatedText: accumulatedText,
      toolExecutionSummaries: toolExecutionSummaries,
    };
  };

  const _processLlmApiResponse = (apiCallResult, state, currentCycle) => {
    UI.updateStatus("Processing Final Response...");
    const finalContent =
      apiCallResult.apiResult?.type === "text" ||
      !apiCallResult.apiResult?.content
        ? apiCallResult.apiResult?.content || apiCallResult.accumulatedText
        : apiCallResult.accumulatedText;
    UI.updateStreamingOutput(finalContent || "(No final text output)", true);

    const sanitized = ApiClient.sanitizeLlmJsonResp(finalContent);
    let parsedResp;

    UI.displayCycleArtifact(
      "LLM Final Output Raw",
      finalContent || "(No text content)",
      "info",
      false,
      "LLM",
      "llm.raw",
      currentCycle
    );
    UI.displayCycleArtifact(
      "LLM Final Output Sanitized",
      sanitized,
      "output",
      false,
      "LLM",
      "llm.sanitized",
      currentCycle
    );

    try {
      parsedResp = JSON.parse(sanitized);
      logger.logEvent(
        "info",
        `Parsed final LLM JSON after iteration ${currentCycle}.`
      );
      UI.logToTimeline(
        currentCycle,
        `[LLM OK] Received and parsed final response.`
      );

      if (parsedResp.self_assessment_notes) {
        UI.displayCycleArtifact(
          "Agent Self-Assessment",
          parsedResp.self_assessment_notes,
          "info",
          false,
          "LLM",
          "llm.self_assessment",
          currentCycle
        );
        logger.logEvent(
          "info",
          `LLM provided self-assessment notes: ${Utils.trunc(
            parsedResp.self_assessment_notes,
            100
          )}`
        );
        state.lastSelfAssessment = parsedResp.self_assessment_notes;
      }
      if (parsedResp.current_context_focus && state.currentGoal) {
        state.currentGoal.currentContextFocus =
          parsedResp.current_context_focus;
        logger.logEvent(
          "info",
          `LLM updated context focus: ${state.currentGoal.currentContextFocus}`
        );
      }
    } catch (e) {
      logger.logEvent(
        "error",
        `LLM final JSON parse failed: ${e.message}. Content: ${Utils.trunc(
          sanitized,
          500
        )}`,
        e
      );
      UI.logToTimeline(
        currentCycle,
        `[LLM ERR] Invalid final JSON response.`,
        "error"
      );
      UI.displayCycleArtifact(
        "Parse Error",
        e.message,
        "error",
        false,
        "System",
        "parse.error",
        currentCycle
      );
      throw new Error(`LLM response invalid JSON: ${e.message}`);
    }

    const outputTokens = apiCallResult.apiResult?.outputTokenCount || 0;
    if (outputTokens > 0 && state.tokenHistory) {
      state.tokenHistory.push(outputTokens);
      if (state.tokenHistory.length > config.MAX_HISTORY_ITEMS)
        state.tokenHistory.shift();
    }
    return parsedResp;
  };

  const _runLlmIteration = async (state, goalInfo, currentCycle) => {
    UI.highlightCoreStep(1);
    const startTime = performance.now();
    let finalResult = null;
    let toolSummaries = [];

    try {
      const prompt = _assembleCorePrompt(state, goalInfo, currentCycle);
      const sysInstruction = `You are x0. DELIBERATE, adopt ${state.personaMode}. Respond ONLY valid JSON matching the schema. Refer to artifacts by ID and optional versionId (e.g., file.js#v1). Use artifactId and cycle args for tools. Use run_self_evaluation tool if appropriate. Provide modular edits via 'artifact_changes.modular' when possible.`;
      const allFuncDecls = await _prepareFunctionDeclarations(state);
      const coreModel = state.cfg?.coreModel || config.DEFAULT_MODELS.BASE;
      const apiKey = state.apiKey;

      UI.clearStreamingOutput();

      const apiCallResult = await _executeLlmApiCallSequence(
        prompt,
        sysInstruction,
        coreModel,
        apiKey,
        allFuncDecls,
        state,
        currentCycle
      );
      toolSummaries = apiCallResult.toolExecutionSummaries || [];

      const parsedResp = _processLlmApiResponse(
        apiCallResult,
        state,
        currentCycle
      );

      const cycleMs = performance.now() - startTime;
      finalResult = {
        response: parsedResp,
        cycleTimeMillis: cycleMs,
        toolSummaries: toolSummaries,
        error: null,
      };
    } catch (error) {
      const cycleMs = performance.now() - startTime;
      if (error.name !== "AbortError") {
        logger.logEvent(
          "error",
          `Core LLM Iteration failed (Cycle ${currentCycle}): ${error.message}`,
          error
        );
        UI.logToTimeline(
          currentCycle,
          `[LLM ERR] Iteration failed: ${error.message}`,
          "error"
        );
      }
      finalResult = {
        response: null,
        cycleTimeMillis: cycleMs,
        toolSummaries: toolSummaries,
        error: error,
      };
    } finally {
      UI.clearStreamingOutput();
    }
    return finalResult;
  };

  const _runSingleAutoCritiqueInstance = async (
    apiKey,
    llmProposal,
    goalInfo,
    currentCycle,
    critiqueIndex
  ) => {
    const state = StateManager?.getState();
    if (!state) throw new Error("State not initialized for critique instance");

    const template = Storage.getArtifactContent(
      "reploid.core.critiquer-prompt",
      0
    );
    if (!template) throw new Error("Critique prompt artifact not found!");

    const changes = llmProposal.artifact_changes || {};
    const modSummary =
      (changes.modified || [])
        .map((a) => `${a.id}${a.version_id ? "#" + a.version_id : ""}`)
        .join(", ") || "None";
    const newSummary =
      (changes.new || [])
        .map(
          (a) => `${a.id}(${a.type})${a.version_id ? "#" + a.version_id : ""}`
        )
        .join(", ") || "None";
    const delSummary = (changes.deleted || []).join(", ") || "None";
    const modularSummary =
      (changes.modular || [])
        .map((a) => `${a.id}${a.version_id ? "#" + a.version_id : ""}`)
        .join(", ") || "None";
    const fullSourceSummary = changes.full_html_source ? "Yes" : "No";
    const newToolsSummary =
      (llmProposal.proposed_new_tools || [])
        .map((t) => t.declaration?.name || "?")
        .join(", ") || "None";

    let prompt = template
      .replace(
        /\[\[PROPOSED_CHANGES_DESC\]\]/g,
        Utils.trunc(llmProposal.proposed_changes_description, 1000) || "None"
      )
      .replace(/\[\[MODIFIED_ARTIFACT_IDS_VERSIONS\]\]/g, modSummary)
      .replace(/\[\[NEW_ARTIFACT_IDS_TYPES_VERSIONS\]\]/g, newSummary)
      .replace(/\[\[DELETED_ARTIFACT_IDS\]\]/g, delSummary)
      .replace(/\[\[MODULAR_ARTIFACT_IDS_VERSIONS\]\]/g, modularSummary)
      .replace(/\[\[HAS_FULL_HTML_SOURCE\]\]/g, fullSourceSummary)
      .replace(/\[\[NEW_TOOL_NAMES\]\]/g, newToolsSummary)
      .replace(/\[LATEST_GOAL_TYPE\]/g, goalInfo.type)
      .replace(
        /\[\[CUMULATIVE_GOAL_CONTEXT\]\]/g,
        Utils.trunc(goalInfo.cumulativeGoal || goalInfo.summaryContext, 2000)
      )
      .replace(
        /\[AGENT_CONFIDENCE\]/g,
        llmProposal.agent_confidence_score?.toFixed(3) ?? "N/A"
      );

    const critiqueModel =
      state.cfg?.critiqueModel || config.DEFAULT_MODELS.CRITIQUE;
    const sysInstruction =
      'Critiquer x0. Analyze objectively. Output ONLY valid JSON: {"critique_passed": boolean, "critique_report": "string"}';

    UI.displayCycleArtifact(
      `Critique Input [${critiqueIndex + 1}/${NUM_CRITIQUES_TO_GENERATE}]`,
      prompt,
      "input",
      false,
      "System",
      `prompt.critique.${critiqueIndex}`,
      currentCycle
    );

    let critiqueResultText = "";
    let critiqueApiResult = null;
    let finalResult = {
      critique_passed: false,
      critique_report: "Critique execution failed",
    };

    try {
      let accumulatedCritiqueText = "";
      const genConfigOverrides =
        NUM_CRITIQUES_TO_GENERATE > 1
          ? { temperature: 0.7 + Math.random() * 0.2 }
          : {};

      critiqueApiResult = await ApiClient.callApiWithRetry(
        prompt,
        sysInstruction,
        critiqueModel,
        apiKey,
        [],
        false,
        null,
        state.cfg?.maxRetries ?? 1,
        genConfigOverrides,
        (msg, active, isErr) =>
          UI.updateStatus(
            `Critique ${critiqueIndex + 1}: ${msg}`,
            active,
            isErr
          ),
        (cyc, msg, type, sub, anim) =>
          UI.logToTimeline(
            cyc,
            `[CRIT ${critiqueIndex + 1}] ${msg}`,
            type,
            sub,
            anim
          ),
        UI.updateTimelineItem,
        (progress) => {
          if (progress.type === "text")
            accumulatedCritiqueText += progress.content;
          if (progress.accumulatedResult)
            critiqueApiResult = progress.accumulatedResult;
          critiqueResultText =
            progress.accumulatedResult?.content || accumulatedCritiqueText;
        }
      );
      if (!critiqueResultText && critiqueApiResult?.content)
        critiqueResultText = critiqueApiResult.content;

      UI.displayCycleArtifact(
        `Critique Output Raw [${critiqueIndex + 1}]`,
        critiqueResultText || "(No text content)",
        "info",
        false,
        "LLM",
        `critique.raw.${critiqueIndex}`,
        currentCycle
      );

      const sanitized = ApiClient.sanitizeLlmJsonResp(critiqueResultText);
      UI.displayCycleArtifact(
        `Critique Output Sanitized [${critiqueIndex + 1}]`,
        sanitized,
        "output",
        false,
        "LLM",
        `critique.sanitized.${critiqueIndex}`,
        currentCycle
      );

      const parsedCritique = JSON.parse(sanitized);
      if (
        typeof parsedCritique.critique_passed !== "boolean" ||
        typeof parsedCritique.critique_report !== "string"
      ) {
        throw new Error("Critique JSON missing required fields.");
      }
      finalResult = parsedCritique;
    } catch (e) {
      logger.logEvent(
        "error",
        `Critique instance ${critiqueIndex + 1} API/Parse failed: ${e.message}`,
        e
      );
      UI.logToTimeline(
        currentCycle,
        `[CRIT ${critiqueIndex + 1} ERR] Failed: ${e.message}`,
        "error",
        true
      );
      UI.displayCycleArtifact(
        `Critique Error [${critiqueIndex + 1}]`,
        e.message,
        "error",
        false,
        "System",
        `critique.error.${critiqueIndex}`,
        currentCycle
      );
      finalResult.critique_report = `Critique instance ${
        critiqueIndex + 1
      } failed: ${e.message}`;
    }
    return finalResult;
  };

  const _runAutoCritique = async (
    apiKey,
    llmProposal,
    goalInfo,
    currentCycle
  ) => {
    UI.highlightCoreStep(5);
    UI.updateStatus(
      `Running ${NUM_CRITIQUES_TO_GENERATE} Auto-Critiques...`,
      true
    );

    const critiquePromises = [];
    for (let i = 0; i < NUM_CRITIQUES_TO_GENERATE; i++) {
      critiquePromises.push(
        _runSingleAutoCritiqueInstance(
          apiKey,
          llmProposal,
          goalInfo,
          currentCycle,
          i
        )
      );
    }

    const results = await Promise.allSettled(critiquePromises);

    const successfulCritiques = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);
    const failedCritiques = results
      .filter((r) => r.status === "rejected")
      .map((r) => ({
        critique_passed: false,
        critique_report: `Critique generation failed: ${
          r.reason?.message || "Unknown reason"
        }`,
      }));

    const allCritiqueOutputs = [...successfulCritiques, ...failedCritiques];
    const overallPassed =
      successfulCritiques.length === NUM_CRITIQUES_TO_GENERATE &&
      successfulCritiques.every((c) => c.critique_passed);

    let combinedReport = allCritiqueOutputs
      .map(
        (c, i) =>
          `Critique ${i + 1}: ${c.critique_passed ? "Pass" : "FAIL"}. Report: ${
            c.critique_report
          }`
      )
      .join("\n---\n");
    if (failedCritiques.length > 0)
      combinedReport += `\n---\nWARNING: ${failedCritiques.length} critique generation(s) failed.`;

    logger.logEvent(
      "info",
      `Multi-Critique finished. Overall Pass: ${overallPassed}`
    );
    UI.logToTimeline(
      currentCycle,
      `[CRITIQUE] Multi-Critique completed. Overall Passed: ${overallPassed}`
    );

    UI.updateStatus("Idle");
    UI.clearStreamingOutput();

    return {
      critiques: allCritiqueOutputs,
      overall_passed: overallPassed,
      combined_report: combinedReport,
    };
  };

  const calculateChecksum = async (content) => {
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
      logger.logEvent("error", "Checksum calculation failed:", error);
      return null;
    }
  };

  const _applyArtifactChanges = async (
    artifactChanges,
    nextCycleNum,
    critiqueSource,
    state,
    changesMade,
    errors
  ) => {
    const {
      modified,
      new: newArtifacts,
      deleted,
      modular,
      full_html_source,
    } = artifactChanges || {};

    for (const modArt of modified || []) {
      if (!modArt.id || modArt.content === undefined) {
        errors.push(
          `Invalid modified artifact structure: ID=${modArt.id || "?"}`
        );
        continue;
      }
      const currentMeta = StateManager.getArtifactMetadata(modArt.id);
      if (!currentMeta) {
        errors.push(`Modify failed (original not found): ${modArt.id}`);
        continue;
      }

      const currentContent = Storage.getArtifactContent(
        modArt.id,
        currentMeta.latestCycle,
        currentMeta.version_id
      );
      if (currentContent === null) {
        errors.push(
          `Modify failed (original content missing): ${modArt.id} C${
            currentMeta.latestCycle
          } V${currentMeta.version_id || "def"}`
        );
        continue;
      }

      if (currentContent !== modArt.content) {
        try {
          const checksum = await calculateChecksum(modArt.content);
          Storage.setArtifactContent(
            modArt.id,
            nextCycleNum,
            modArt.content,
            modArt.version_id
          );
          StateManager.updateArtifactMetadata(
            modArt.id,
            currentMeta.type,
            currentMeta.description,
            nextCycleNum,
            checksum,
            critiqueSource,
            modArt.version_id,
            false
          );
          changesMade.push(
            `Modified: ${modArt.id}${
              modArt.version_id ? "#" + modArt.version_id : ""
            }`
          );
          UI.displayCycleArtifact(
            `Modified Artifact${
              modArt.version_id ? " (V: " + modArt.version_id + ")" : ""
            }`,
            modArt.content,
            "output",
            true,
            critiqueSource,
            modArt.id,
            nextCycleNum
          );
          if (modArt.id.startsWith("reploid."))
            logger.logEvent("warn", `Core artifact ${modArt.id} modified.`);
        } catch (e) {
          errors.push(`Failed save mod ${modArt.id}: ${e.message}`);
        }
      } else {
        UI.displayCycleArtifact(
          `Modified (No Change)${
            modArt.version_id ? " (V: " + modArt.version_id + ")" : ""
          }`,
          currentContent,
          "info",
          false,
          critiqueSource,
          modArt.id,
          currentMeta.latestCycle
        );
      }
    }

    for (const newArt of newArtifacts || []) {
      if (!newArt.id || !newArt.type || newArt.content === undefined) {
        errors.push(`Invalid new artifact structure: ID=${newArt.id || "?"}`);
        continue;
      }
      try {
        const checksum = await calculateChecksum(newArt.content);
        Storage.setArtifactContent(
          newArt.id,
          nextCycleNum,
          newArt.content,
          newArt.version_id
        );
        StateManager.updateArtifactMetadata(
          newArt.id,
          newArt.type,
          newArt.description || `New ${newArt.type}`,
          nextCycleNum,
          checksum,
          critiqueSource,
          newArt.version_id,
          false
        );
        changesMade.push(
          `Created: ${newArt.id}${
            newArt.version_id ? "#" + newArt.version_id : ""
          } (${newArt.type})`
        );
        UI.displayCycleArtifact(
          `New Artifact${
            newArt.version_id ? " (V: " + newArt.version_id + ")" : ""
          }`,
          newArt.content,
          "output",
          true,
          critiqueSource,
          newArt.id,
          nextCycleNum
        );
      } catch (e) {
        errors.push(`Failed save new ${newArt.id}: ${e.message}`);
      }
    }

    for (const idToDelete of deleted || []) {
      const meta = StateManager.getArtifactMetadata(idToDelete);
      if (meta) {
        const allVersions =
          StateManager.getArtifactMetadataAllVersions(idToDelete);
        allVersions.forEach((v) =>
          Storage.deleteArtifactVersion(idToDelete, v.latestCycle, v.version_id)
        );
        StateManager.deleteArtifactMetadata(idToDelete);
        changesMade.push(`Deleted: ${idToDelete} (All versions)`);
        UI.displayCycleArtifact(
          "Deleted Artifact (All Versions)",
          idToDelete,
          "output",
          true,
          critiqueSource
        );
      } else {
        errors.push(`Delete failed (not found): ${idToDelete}`);
      }
    }

    for (const modEdit of modular || []) {
      if (!modEdit.id || !modEdit.patch_content || !modEdit.patch_format) {
        errors.push(`Invalid modular edit structure: ID=${modEdit.id || "?"}`);
        continue;
      }
      UI.displayCycleArtifact(
        `Modular Edit Proposed${
          modEdit.version_id ? " (V: " + modEdit.version_id + ")" : ""
        }`,
        JSON.stringify(modEdit, null, 2),
        "info",
        true,
        critiqueSource,
        modEdit.id,
        nextCycleNum
      );

      try {
        const baseMeta = StateManager.getArtifactMetadata(modEdit.id);
        if (!baseMeta) {
          throw new Error(`Base artifact not found: ${modEdit.id}`);
        }
        const baseContent = Storage.getArtifactContent(
          modEdit.id,
          baseMeta.latestCycle,
          baseMeta.version_id
        );
        if (baseContent === null) {
          throw new Error(`Base content missing for ${modEdit.id}`);
        }

        let patchedContent = null;
        let toolToRun = null;
        let toolArgs = {
          artifactId: modEdit.id,
          cycle: baseMeta.latestCycle,
          versionId: baseMeta.version_id,
          patchContent: modEdit.patch_content,
        };

        if (
          modEdit.patch_format.toLowerCase() === "diff" ||
          modEdit.patch_format.toLowerCase() === "unified-diff"
        ) {
          toolToRun = "apply_diff_patch";
        } else if (
          modEdit.patch_format.toLowerCase() === "json-patch" ||
          modEdit.patch_format.toLowerCase() === "rfc6902"
        ) {
          toolToRun = "apply_json_patch";
          try {
            toolArgs.patchContent = JSON.parse(modEdit.patch_content);
          } catch {
            toolArgs.patchContent = modEdit.patch_content;
          }
        } else if (
          modEdit.patch_format.toLowerCase() === "replace-function" ||
          modEdit.patch_format.toLowerCase() === "replace-block"
        ) {
          toolToRun = "apply_block_replacement";
          toolArgs.target_block = modEdit.target_block;
        } else {
          throw new Error(`Unsupported patch format: ${modEdit.patch_format}`);
        }

        const toolRunnerWithApiClient = ToolRunnerModule(
          config,
          logger,
          Storage,
          StateManager,
          ApiClient
        );
        const patchResult = await toolRunnerWithApiClient.runTool(
          toolToRun,
          toolArgs,
          loadedStaticTools,
          state.dynamicTools || [],
          {}
        );

        if (!patchResult || !patchResult.success) {
          throw new Error(
            `Patch tool '${toolToRun}' failed: ${
              patchResult?.error || "Unknown tool error"
            }`
          );
        }
        patchedContent = patchResult.result_content;

        const checksum = await calculateChecksum(patchedContent);
        Storage.setArtifactContent(
          modEdit.id,
          nextCycleNum,
          patchedContent,
          modEdit.version_id
        );
        StateManager.updateArtifactMetadata(
          modEdit.id,
          baseMeta.type,
          baseMeta.description,
          nextCycleNum,
          checksum,
          critiqueSource,
          modEdit.version_id,
          true
        );
        changesMade.push(
          `Modular Edit: ${modEdit.id}${
            modEdit.version_id ? "#" + modEdit.version_id : ""
          } (${modEdit.patch_format})`
        );
        UI.displayCycleArtifact(
          `Modular Edit Applied${
            modEdit.version_id ? " (V: " + modEdit.version_id + ")" : ""
          }`,
          patchedContent,
          "output",
          true,
          critiqueSource,
          modEdit.id,
          nextCycleNum
        );
      } catch (e) {
        errors.push(`Failed apply modular edit ${modEdit.id}: ${e.message}`);
        UI.displayCycleArtifact(
          `Modular Edit Failed ${modEdit.id}`,
          e.message,
          "error",
          false,
          critiqueSource
        );
      }
    }

    let requiresSandbox = false;
    if (full_html_source) {
      state.lastGeneratedFullSource = full_html_source;
      changesMade.push("Generated Full HTML (Sandbox Required)");
      UI.displayCycleArtifact(
        "Full HTML Source",
        "(Prepared for Sandbox)",
        "output",
        true,
        critiqueSource
      );
      requiresSandbox = true;
    }

    return { requiresSandbox };
  };

  const _applyToolDefinitionChanges = (
    newTools,
    critiqueSource,
    state,
    changesMade,
    errors,
    currentCycleNum
  ) => {
    (newTools || []).forEach((tool) => {
      const decl = tool.declaration;
      const impl = tool.implementation;

      if (
        !decl ||
        !impl ||
        !decl.name ||
        !decl.description ||
        !decl.inputSchema
      ) {
        errors.push(`Invalid new tool structure: Name=${decl?.name || "?"}`);
        UI.displayCycleArtifact(
          "Invalid Tool Def",
          JSON.stringify(tool),
          "error",
          false,
          critiqueSource
        );
        return;
      }

      UI.displayCycleArtifact(
        `Proposed Tool Decl: ${decl.name}`,
        JSON.stringify(decl, null, 2),
        "output",
        true,
        critiqueSource
      );
      UI.displayCycleArtifact(
        `Generated Tool Impl: ${decl.name}`,
        impl,
        "output",
        true,
        critiqueSource
      );

      if (
        !impl.includes("async function run(params)") &&
        !impl.includes("async (params)") &&
        !impl.includes("run = async (params)")
      ) {
        errors.push(
          `Generated tool implementation for ${decl.name} missing valid async run(params) function.`
        );
        UI.logToTimeline(
          currentCycleNum,
          `[APPLY ERR] Tool impl ${decl.name} invalid structure.`,
          "error",
          true
        );
      } else {
        const dynamicTools = state.dynamicTools || [];
        const existingIndex = dynamicTools.findIndex(
          (t) => t.declaration.name === decl.name
        );
        const toolEntry = { declaration: decl, implementation: impl };
        let toolChangeType = "";
        if (existingIndex !== -1) {
          dynamicTools[existingIndex] = toolEntry;
          toolChangeType = `Tool Updated: ${decl.name}`;
        } else {
          dynamicTools.push(toolEntry);
          toolChangeType = `Tool Defined: ${decl.name}`;
        }
        state.dynamicTools = dynamicTools;
        changesMade.push(toolChangeType);
        UI.logToTimeline(
          currentCycleNum,
          `[ARTIFACT] ${toolChangeType}`,
          "info",
          true
        );
      }
    });
  };

  const _applyLLMChanges = async (llmResp, currentCycleNum, critiqueSource) => {
    UI.highlightCoreStep(6);
    const state = StateManager?.getState();
    if (!state)
      return {
        success: false,
        errors: ["State not initialized"],
        nextCycle: currentCycleNum,
        requiresSandbox: false,
        changes: [],
      };

    let changesMade = [];
    let errors = [];
    currentLlmResponse = llmResp;
    const nextCycleNum = currentCycleNum + 1;

    const { requiresSandbox } = await _applyArtifactChanges(
      llmResp.artifact_changes,
      nextCycleNum,
      critiqueSource,
      state,
      changesMade,
      errors
    );
    _applyToolDefinitionChanges(
      llmResp.proposed_new_tools,
      critiqueSource,
      state,
      changesMade,
      errors,
      currentCycleNum
    );

    const success = errors.length === 0;
    if (success) {
      if (!requiresSandbox) {
        state.totalCycles = nextCycleNum;
        state.agentIterations++;
      }
      const confidence = llmResp.agent_confidence_score ?? 0.0;
      state.confidenceHistory.push(confidence);
      if (state.confidenceHistory.length > config.MAX_HISTORY_ITEMS)
        state.confidenceHistory.shift();
    } else {
      state.failCount = (state.failCount || 0) + 1;
      state.failHistory = state.failHistory || [];
      state.failHistory.push({
        cycle: currentCycleNum,
        reason: `Apply Error: ${errors.join(", ")}`,
      });
      if (state.failHistory.length > config.MAX_HISTORY_ITEMS)
        state.failHistory.shift();
    }

    const targetArtifactChanged = changesMade.some(
      (c) =>
        c.includes("target.") ||
        c.includes("reploid.") ||
        c.includes("Full HTML")
    );
    if (targetArtifactChanged && success && !requiresSandbox) {
      UI.logToTimeline(
        currentCycleNum,
        `[APPLY] Applying changes for Cycle ${nextCycleNum}.`,
        "info",
        true
      );
    }

    UI.logToTimeline(
      currentCycleNum,
      `[APPLY] Changes applied for Cycle ${nextCycleNum} from ${critiqueSource}: ${
        changesMade.join(", ") || "None"
      }. Errors: ${errors.length}`,
      errors.length > 0 ? "warn" : "info",
      true
    );

    return {
      success: success,
      changes: changesMade,
      errors: errors,
      nextCycle: success && !requiresSandbox ? nextCycleNum : currentCycleNum,
      requiresSandbox: requiresSandbox,
    };
  };

  const _checkHitlTriggers = (
    state,
    cycleTimeSecs,
    confidence,
    currentCycle
  ) => {
    const pauseThresh = state.cfg?.pauseAfterCycles || 0;
    const confThresh = state.cfg?.autoCritiqueThresh ?? 0.75;
    const humanProb = (state.cfg?.humanReviewProb ?? 0) / 100.0;
    const maxTime = state.cfg?.maxCycleTime ?? 600;
    let hitlReason = null;
    let hitlModePref = "prompt";

    if (state.forceHumanReview) {
      hitlReason = "Forced Review";
      state.forceHumanReview = false;
    } else if (
      pauseThresh > 0 &&
      currentCycle > 0 &&
      currentCycle % pauseThresh === 0
    ) {
      hitlReason = `Auto Pause (${currentCycle}/${pauseThresh})`;
      hitlModePref = "code_edit";
    } else if (Math.random() < humanProb) {
      hitlReason = `Random Review (${(humanProb * 100).toFixed(0)}%)`;
      hitlModePref = "critique_feedback";
    } else if (cycleTimeSecs > maxTime) {
      hitlReason = `Time Limit (${cycleTimeSecs.toFixed(1)}s > ${maxTime}s)`;
    } else if (confidence < confThresh) {
      hitlReason = `Low Confidence (${confidence.toFixed(2)} < ${confThresh})`;
    }

    if (hitlReason) {
      logger.logEvent("info", `HITL triggered: ${hitlReason}`);
      return { reason: hitlReason, mode: hitlModePref };
    }
    return null;
  };

  const _performCritique = async (
    state,
    llmResponse,
    goalInfo,
    currentCycle
  ) => {
    const llmProb = (state.cfg?.llmCritiqueProb ?? 50) / 100.0;
    let overallPassed = false;
    let combinedReport = "Critique Skipped";
    let applySource = "Skipped";
    let allCritiques = [];

    if (Math.random() < llmProb) {
      UI.logToTimeline(
        currentCycle,
        `[DECIDE] Triggering Auto Critique...`,
        "decide",
        true
      );
      UI.logCoreLoopStep(currentCycle, 5, "Critique: Auto");

      const multiCritiqueResult = await _runAutoCritique(
        state.apiKey,
        llmResponse.response,
        goalInfo,
        currentCycle
      );

      allCritiques = multiCritiqueResult.critiques;
      overallPassed = multiCritiqueResult.overall_passed;
      combinedReport = multiCritiqueResult.combined_report;
      applySource = `AutoCrit (${allCritiques.length} runs) ${
        overallPassed ? "Pass" : "Fail"
      }`;
      state.lastCritiqueType = `Automated (${overallPassed ? "Pass" : "Fail"})`;

      if (state.critiqueFailHistory)
        state.critiqueFailHistory.push(!overallPassed);
      if (state.critiqueFailHistory?.length > config.MAX_HISTORY_ITEMS)
        state.critiqueFailHistory.shift();

      UI.displayCycleArtifact(
        "Auto Critique Combined Report",
        combinedReport,
        overallPassed ? "info" : "error",
        false,
        "LLM",
        "critique.combined_report",
        currentCycle
      );
    } else {
      overallPassed = true;
      applySource = "Skipped";
      state.lastCritiqueType = "Skipped";
      if (state.critiqueFailHistory) state.critiqueFailHistory.push(false);
      if (state.critiqueFailHistory?.length > config.MAX_HISTORY_ITEMS)
        state.critiqueFailHistory.shift();

      UI.logCoreLoopStep(currentCycle, 5, "Critique: Skipped");
      UI.logToTimeline(
        currentCycle,
        `[DECIDE] Critique Skipped.`,
        "info",
        true
      );
    }
    return {
      critiquePassed: overallPassed,
      critiqueReport: combinedReport,
      applySource: applySource,
      critiques: allCritiques,
    };
  };

  const _handleCritiqueDecision = async (
    state,
    llmResponse,
    goalInfo,
    currentCycle
  ) => {
    UI.highlightCoreStep(4);
    const cycleTimeMillis = llmResponse.cycleTimeMillis || 0;
    const cycleSecs = cycleTimeMillis / 1000;
    const confidence = llmResponse.response?.agent_confidence_score ?? 0.0;

    const hitlTrigger = _checkHitlTriggers(
      state,
      cycleSecs,
      confidence,
      currentCycle
    );

    UI.logToTimeline(
      currentCycle,
      `[DECIDE] Time:${cycleSecs.toFixed(1)}s, Conf:${confidence.toFixed(
        2
      )}. Human: ${hitlTrigger ? hitlTrigger.reason : "No"}.`,
      "decide",
      true
    );

    if (hitlTrigger) {
      state.lastCritiqueType = `Human (${hitlTrigger.reason})`;
      if (state.critiqueFailHistory) state.critiqueFailHistory.push(false);
      if (state.critiqueFailHistory?.length > config.MAX_HISTORY_ITEMS)
        state.critiqueFailHistory.shift();

      UI.logCoreLoopStep(
        currentCycle,
        5,
        `Critique: Human Intervention (${hitlTrigger.reason})`
      );
      UI.updateStatus(`Paused: Human Review (${hitlTrigger.reason})`);
      const primaryModId =
        llmResponse.response?.artifact_changes?.modified?.[0]?.id;
      const primaryNewId = llmResponse.response?.artifact_changes?.new?.[0]?.id;
      const primaryModularId =
        llmResponse.response?.artifact_changes?.modular?.[0]?.id;
      const hasFullSource =
        !!llmResponse.response?.artifact_changes?.full_html_source;

      const artifactToEdit =
        primaryModId ||
        primaryNewId ||
        primaryModularId ||
        (hasFullSource ? "full_html_source" : null);
      UI.showHumanInterventionUI(
        hitlTrigger.mode,
        hitlTrigger.reason,
        [],
        artifactToEdit,
        []
      );
      return {
        status: "HITL_REQUIRED",
        critiquePassed: false,
        critiqueReport: `Human Intervention: ${hitlTrigger.reason}`,
      };
    }

    const critiqueResult = await _performCritique(
      state,
      llmResponse,
      goalInfo,
      currentCycle
    );

    if (!critiqueResult.critiquePassed) {
      UI.logToTimeline(
        currentCycle,
        `[STATE] Auto-Critique failed. Forcing HITL.`,
        "warn",
        true
      );
      state.failCount = (state.failCount || 0) + 1;
      state.failHistory = state.failHistory || [];
      state.failHistory.push({
        cycle: currentCycle,
        reason: `Critique Failed: ${Utils.trunc(
          critiqueResult.critiqueReport,
          100
        )}`,
      });
      if (state.failHistory.length > config.MAX_HISTORY_ITEMS)
        state.failHistory.shift();

      UI.showHumanInterventionUI(
        "critique_feedback",
        `Auto Critique Failed: ${Utils.trunc(
          critiqueResult.critiqueReport,
          150
        )}...`,
        [],
        null,
        critiqueResult.critiques
      );
      return {
        status: "HITL_REQUIRED",
        critiquePassed: false,
        critiqueReport: critiqueResult.critiqueReport,
      };
    }

    return {
      status: "PROCEED",
      critiquePassed: critiqueResult.critiquePassed,
      critiqueReport: critiqueResult.critiqueReport,
      applySource: critiqueResult.applySource,
    };
  };

  const _runSelfEvaluationStep = async (
    state,
    llmResponse,
    currentCycle,
    applyResult
  ) => {
    UI.highlightCoreStep(7);
    if (!llmResponse?.response) return;

    const contentToEvaluate =
      llmResponse.response.justification_persona_musing ||
      "(No justification provided)";
    if (contentToEvaluate === "(No justification provided)") {
      logger.logEvent(
        "info",
        `Skipping self-evaluation for Cycle ${currentCycle}: No justification provided.`
      );
      UI.logToTimeline(
        currentCycle,
        `[EVAL] Skipped (no justification).`,
        "info",
        true
      );
      return;
    }

    logger.logEvent(
      "info",
      `Running Self-Evaluation for Cycle ${currentCycle} justification`
    );
    UI.logToTimeline(
      currentCycle,
      `[EVAL] Evaluating cycle justification...`,
      "eval",
      true
    );

    let evaluationCriteria = Storage.getArtifactContent(
      "reploid.core.default-eval",
      0
    );
    if (!evaluationCriteria) {
      logger.logEvent(
        "warn",
        "Default evaluation criteria artifact (reploid.core.default-eval) not found. Using basic criteria."
      );
      evaluationCriteria =
        "Evaluate if the justification accurately reflects the proposed changes and aligns with the goal context. Rate clarity and reasoning.";
    }
    let evalCriteriaText = evaluationCriteria;
    try {
      const parsedCriteria = JSON.parse(evaluationCriteria);
      if (
        parsedCriteria.criteria &&
        typeof parsedCriteria.criteria === "string"
      ) {
        evalCriteriaText = parsedCriteria.criteria;
      }
    } catch (e) {}

    const goalContext =
      getActiveGoalInfo().cumulativeGoal ||
      getActiveGoalInfo().summaryContext ||
      "N/A";
    const targetArtifactId = "llm.justification";
    const targetArtifactCycle = currentCycle;

    try {
      const uiHooks = {
        updateStatus: UI.updateStatus,
        logTimeline: UI.logToTimeline,
        updateTimelineItem: UI.updateTimelineItem,
      };
      const toolRunnerWithApiClient = ToolRunnerModule(
        config,
        logger,
        Storage,
        StateManager,
        ApiClient
      );
      const evalResult = await toolRunnerWithApiClient.runTool(
        "run_self_evaluation",
        {
          targetArtifactId: targetArtifactId,
          targetArtifactCycle: targetArtifactCycle,
          evalCriteriaText: evalCriteriaText,
          goalContextText: goalContext,
          contentToEvaluate: contentToEvaluate,
        },
        loadedStaticTools,
        state.dynamicTools || [],
        uiHooks
      );

      StateManager.addEvaluationResult(evalResult);

      UI.logToTimeline(
        currentCycle,
        `[EVAL OK] Score: ${evalResult.evaluation_score.toFixed(
          2
        )}. Report: ${Utils.trunc(evalResult.evaluation_report, 60)}`,
        "eval",
        true
      );
      UI.displayCycleArtifact(
        "Self-Evaluation Result",
        JSON.stringify(evalResult, null, 2),
        "info",
        false,
        "System",
        "eval.result",
        currentCycle
      );
    } catch (e) {
      logger.logEvent("error", `Self-evaluation step failed: ${e.message}`, e);
      UI.logToTimeline(
        currentCycle,
        `[EVAL ERR] Failed: ${e.message}`,
        "error",
        true
      );
    }

    UI.logToTimeline(
      currentCycle,
      `[LEARN] Learning phase placeholder.`,
      "learn",
      true
    );
  };

  const _prepareCycle = () => {
    const state = StateManager?.getState();
    if (!state) throw new Error("State not initialized!");
    if (!StateManager.isInitialized())
      throw new Error("StateManager lost initialization!");
    if (UI.isMetaSandboxPending()) {
      UI.showNotification("Meta Sandbox approval pending.", "warn");
      throw new Error("Sandbox Pending");
    }
    if (!UI.isHumanInterventionHidden()) {
      UI.showNotification("Human Intervention required.", "warn");
      throw new Error("HITL Required");
    }

    UI.clearCurrentCycleDetails();
    currentLlmResponse = null;
    _abortRequested = false;
    const uiRefs = UI.getRefs();
    state.apiKey = uiRefs.apiKeyInput?.value.trim() || state.apiKey;
    if (!state.apiKey || state.apiKey.length < 10)
      throw new Error("Valid Gemini API Key required.");

    UI.logCoreLoopStep(state.totalCycles, 0, "Define Goal");
    const goalText = uiRefs.goalInput?.value.trim() || "";
    const goalTypeElement = document.querySelector(
      'input[name="goalType"]:checked'
    );
    const goalType = goalTypeElement ? goalTypeElement.value : "System";

    if (!goalText && !state.currentGoal?.seed)
      throw new Error("Initial Goal required.");

    const maxC = state.cfg?.maxCycles || 0;
    if (
      maxC > 0 &&
      state.totalCycles >= maxC &&
      state.autonomyMode !== "Manual"
    )
      throw new Error(`Max cycles (${maxC}) reached.`);

    if (
      state.autonomyMode === "N_Cycles" &&
      state.autonomyCyclesRemaining <= 0
    ) {
      logger.logEvent(
        "info",
        "Autonomous run finished (N cycles complete). Switching to Manual."
      );
      state.autonomyMode = "Manual";
      _isAutonomous = false;
      UI.updateAutonomyControls(state.autonomyMode, false);
      throw new Error("Autonomy N Cycles Finished");
    }
    if (state.autonomyMode !== "Manual") {
      _isAutonomous = true;
      if (state.autonomyMode === "N_Cycles") state.autonomyCyclesRemaining--;
    } else {
      _isAutonomous = false;
    }

    if (state.contextTokenEstimate >= state.contextTokenTarget)
      UI.showNotification("Context tokens high. Consider summarizing.", "warn");

    const currentCycle = state.totalCycles;
    const newGoalProvided = !!goalText;
    if (newGoalProvided) {
      if (!state.currentGoal?.seed) {
        state.currentGoal = {
          seed: goalText,
          cumulative: goalText,
          latestType: goalType,
          summaryContext: null,
          currentContextFocus: null,
        };
      } else {
        state.currentGoal.cumulative =
          (state.currentGoal.cumulative || state.currentGoal.seed || "") +
          `\n\n[Cycle ${currentCycle} Refinement (${goalType})]: ${goalText}`;
        state.currentGoal.latestType = goalType;
        state.currentGoal.summaryContext = null;
        state.currentGoal.currentContextFocus = null;
      }
      UI.displayCycleArtifact(
        "New Goal Input",
        `${goalType}: ${goalText}`,
        "input",
        false,
        "User",
        "goal.input",
        currentCycle
      );
      if (uiRefs.goalInput) uiRefs.goalInput.value = "";
    } else if (!state.currentGoal?.seed && !state.currentGoal?.cumulative) {
      throw new Error("No active goal context.");
    }

    const goalInfo = getActiveGoalInfo();
    state.retryCount = 0;
    state.personaMode = (state.cfg?.personaBalance ?? 50) >= 50 ? "LSD" : "XYZ";

    UI.updateStatus("Starting Cycle...", true);
    if (uiRefs.currentCycleNumber)
      uiRefs.currentCycleNumber.textContent = currentCycle;
    UI.updateStateDisplay();
    UI.logToTimeline(
      currentCycle,
      `[CYCLE] === Cycle ${currentCycle} Start === Goal: ${goalInfo.type}, Persona: ${state.personaMode}, Auto: ${state.autonomyMode}`
    );
    UI.logToTimeline(
      currentCycle,
      `[GOAL] Latest: "${Utils.trunc(goalInfo.latestGoal, 70)}..."`,
      "goal",
      true
    );
    UI.displayCycleArtifact(
      "Cumulative Goal",
      goalInfo.cumulativeGoal || "(Not Set)",
      "input",
      false,
      "System",
      "goal.cumulative",
      currentCycle
    );
    if (goalInfo.summaryContext)
      UI.displayCycleArtifact(
        "Summary Context",
        goalInfo.summaryContext,
        "input",
        false,
        "System",
        "meta.summary_context",
        currentCycle
      );
    if (goalInfo.currentContextFocus)
      UI.displayCycleArtifact(
        "Context Focus",
        goalInfo.currentContextFocus,
        "input",
        false,
        "LLM",
        "meta.context_focus",
        currentCycle
      );

    return { state, goalInfo, currentCycle };
  };

  const _handleCycleIterationFailure = (state, error, currentCycle) => {
    if (error.name === "AbortError" || _abortRequested)
      throw new Error("Aborted");

    logger.logEvent(
      "error",
      `Iteration attempt ${state.retryCount} failed: ${error.message}`
    );
    state.retryCount++;
    const maxRetries = state.cfg?.maxRetries ?? 1;

    if (state.retryCount > maxRetries) {
      UI.logToTimeline(
        currentCycle,
        `[RETRY] Max retries (${maxRetries}) exceeded. Forcing HITL.`,
        "error"
      );
      state.failCount = (state.failCount || 0) + 1;
      state.failHistory = state.failHistory || [];
      state.failHistory.push({
        cycle: currentCycle,
        reason: `Max Retries: ${error.message || "Unknown error"}`,
      });
      if (state.failHistory.length > config.MAX_HISTORY_ITEMS)
        state.failHistory.shift();

      if (_isAutonomous) {
        logger.logEvent("warn", "Stopping autonomous run due to max retries.");
        stopAutonomousRun("Max retries reached");
      }

      UI.showHumanInterventionUI(
        "prompt",
        `Cycle failed after ${state.retryCount} attempts: ${
          error.message || "Unknown error"
        }`
      );
      throw new Error("HITL Required");
    } else {
      UI.logToTimeline(
        currentCycle,
        `[RETRY] Attempting retry ${state.retryCount}/${maxRetries}...`,
        "warn",
        true
      );
      state.lastFeedback = `Retry ${state.retryCount}: ${
        Utils.trunc(error.message, 100) || "No response"
      }`;
      return Utils.delay(1000 * state.retryCount);
    }
  };

  const _displayLlmIterationSuccessDetails = (
    llmIterationResult,
    state,
    currentCycle
  ) => {
    UI.logToTimeline(
      currentCycle,
      `[STATE] Agent Iteration successful.`,
      "info",
      true
    );
    UI.highlightCoreStep(3);

    if (
      llmIterationResult.toolSummaries &&
      llmIterationResult.toolSummaries.length > 0
    ) {
      UI.displayToolExecutionSummary(llmIterationResult.toolSummaries);
    }

    UI.displayCycleArtifact(
      "Agent Deliberation",
      llmIterationResult.response?.persona_analysis_musing || "(N/A)",
      "info",
      false,
      "LLM",
      "llm.musing",
      currentCycle
    );
    UI.displayCycleArtifact(
      "Proposed Changes",
      llmIterationResult.response?.proposed_changes_description || "(N/A)",
      "info",
      false,
      "LLM",
      "llm.proposal",
      currentCycle
    );
    UI.displayCycleArtifact(
      "Agent Justification",
      llmIterationResult.response?.justification_persona_musing || "(N/A)",
      "info",
      false,
      "LLM",
      "llm.justification",
      currentCycle
    );
    UI.displayCycleArtifact(
      "Agent Confidence",
      llmIterationResult.response?.agent_confidence_score?.toFixed(3) ||
        "(N/A)",
      "info",
      false,
      "LLM",
      "llm.confidence",
      currentCycle
    );
    if (llmIterationResult.response?.current_context_focus) {
      UI.displayCycleArtifact(
        "Next Context Focus",
        llmIterationResult.response.current_context_focus,
        "info",
        false,
        "LLM",
        "llm.context_focus",
        currentCycle
      );
    }
  };

  const _handleApplyFailure = (
    state,
    applyResult,
    critiqueDecision,
    currentCycle
  ) => {
    const errorReason = `Apply Failed: ${applyResult.errors.join(", ")}`;
    state.lastFeedback = `${critiqueDecision.applySource}, ${errorReason}`;
    state.failCount = (state.failCount || 0) + 1;
    state.failHistory = state.failHistory || [];
    state.failHistory.push({ cycle: currentCycle, reason: errorReason });
    if (state.failHistory.length > config.MAX_HISTORY_ITEMS)
      state.failHistory.shift();

    UI.logToTimeline(
      currentCycle,
      `[APPLY ERR] Failed apply: ${applyResult.errors.join(
        ", "
      )}. Forcing HITL.`,
      "error"
    );

    if (_isAutonomous) {
      logger.logEvent("warn", "Stopping autonomous run due to apply failure.");
      stopAutonomousRun("Apply failure");
    }

    UI.showHumanInterventionUI(
      "prompt",
      `Failed apply after critique: ${applyResult.errors.join(", ")}`
    );
    throw new Error("HITL Required");
  };

  const executeCycle = async () => {
    if (_isRunning && !_isAutonomous) {
      UI.showNotification(
        "Manual cycle start ignored: Cycle already running.",
        "warn"
      );
      return;
    }
    if (_abortRequested) {
      logger.logEvent(
        "info",
        "Cycle execution skipped due to pending abort request."
      );
      _abortRequested = false;
      _isRunning = false;
      if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false);
      return;
    }

    _isRunning = true;
    if (UI.setRunButtonState) UI.setRunButtonState("Abort Cycle", false);

    let state, goalInfo, currentCycle;
    let cycleOutcome = "Unknown";
    let llmIterationResult = null;
    let applyResult = null;
    let shouldContinueAutonomous = false;

    try {
      const prepResult = _prepareCycle();
      state = prepResult.state;
      goalInfo = prepResult.goalInfo;
      currentCycle = prepResult.currentCycle;

      let successfulIteration = false;
      do {
        if (_abortRequested) throw new Error("Aborted");
        UI.logToTimeline(
          currentCycle,
          `[STATE] Agent Iteration Attempt (Retry: ${state.retryCount})`,
          "info",
          true
        );
        llmIterationResult = await _runLlmIteration(
          state,
          goalInfo,
          currentCycle
        );
        if (_abortRequested) throw new Error("Aborted");

        if (llmIterationResult.error) {
          await _handleCycleIterationFailure(
            state,
            llmIterationResult.error,
            currentCycle
          );
          if (_abortRequested) throw new Error("Aborted");
        } else {
          successfulIteration = true;
          state.retryCount = 0;
          _displayLlmIterationSuccessDetails(
            llmIterationResult,
            state,
            currentCycle
          );
        }
      } while (!successfulIteration);

      const critiqueDecision = await _handleCritiqueDecision(
        state,
        llmIterationResult,
        goalInfo,
        currentCycle
      );
      if (_abortRequested) throw new Error("Aborted");

      if (critiqueDecision.status === "HITL_REQUIRED") {
        cycleOutcome = `Paused (HITL: ${
          critiqueDecision.critiqueReport.split(":")[0]
        })`;
        if (_isAutonomous) stopAutonomousRun("HITL Required");
        throw new Error("HITL Required");
      }

      if (critiqueDecision.critiquePassed) {
        UI.updateStatus("Applying Changes...", true);
        UI.logCoreLoopStep(currentCycle, 6, "Refine & Apply");
        applyResult = await _applyLLMChanges(
          llmIterationResult.response,
          currentCycle,
          critiqueDecision.applySource
        );
        if (_abortRequested) throw new Error("Aborted");

        if (applyResult.requiresSandbox) {
          state.lastCritiqueType = `${critiqueDecision.applySource} (Sandbox Pending)`;
          if (_isAutonomous) stopAutonomousRun("Sandbox Required");
          UI.showMetaSandbox(state.lastGeneratedFullSource);
          cycleOutcome = `Paused (Sandbox Pending)`;
          throw new Error("Sandbox Pending");
        }

        if (applyResult.success) {
          state.lastFeedback = `${critiqueDecision.applySource}, applied successfully for Cycle ${applyResult.nextCycle}.`;
          cycleOutcome = `OK (${state.lastCritiqueType})`;

          await _runSelfEvaluationStep(
            state,
            llmIterationResult,
            currentCycle,
            applyResult
          );
          if (_abortRequested) throw new Error("Aborted");

          shouldContinueAutonomous = _isAutonomous && !_abortRequested;
        } else {
          _handleApplyFailure(
            state,
            applyResult,
            critiqueDecision,
            currentCycle
          );
        }
      } else {
        logger.logEvent(
          "error",
          "Reached unexpected state where critique failed but HITL was not triggered."
        );
        cycleOutcome = `Failed (Critique Failed)`;
        if (_isAutonomous) stopAutonomousRun("Critique Failed");
        throw new Error("Critique Failed");
      }

      UI.highlightCoreStep(8);
    } catch (error) {
      const knownStops = [
        "Aborted",
        "Sandbox Pending",
        "HITL Required",
        "Max cycles reached.",
        "Critique Failed",
        "Autonomy N Cycles Finished",
      ];
      const isKnownStop =
        knownStops.some((stopMsg) => error.message.includes(stopMsg)) ||
        error.name === "AbortError";

      if (
        !isKnownStop &&
        !error.message.startsWith("Valid Gemini API Key required") &&
        !error.message.startsWith("Initial Goal required")
      ) {
        logger.logEvent(
          "error",
          `Unhandled cycle error (Cycle ${currentCycle ?? "N/A"}): ${
            error.message
          }`,
          error
        );
        UI.showNotification(`Cycle Error: ${error.message}`, "error");
        UI.logToTimeline(
          currentCycle ?? 0,
          `[CYCLE FATAL] ${error.message}`,
          "error"
        );
        cycleOutcome = `Failed (Fatal Error)`;
        UI.updateStatus("Cycle Failed", false, true);
        if (_isAutonomous) stopAutonomousRun("Fatal Error");
      } else if (error.name === "AbortError" || error.message === "Aborted") {
        UI.logToTimeline(
          currentCycle ?? 0,
          `[CYCLE] Cycle aborted by user/system.`,
          "warn"
        );
        cycleOutcome = "Aborted";
        UI.updateStatus("Aborted");
        if (_isAutonomous) stopAutonomousRun("Aborted");
      } else {
        logger.logEvent("info", `Cycle stopped: ${error.message}`);
        if (!cycleOutcome || cycleOutcome === "Unknown")
          cycleOutcome = `Paused (${error.message})`;
        if (_isAutonomous && error.message !== "Autonomy N Cycles Finished") {
          stopAutonomousRun(error.message);
        }
      }
      shouldContinueAutonomous = false;
    } finally {
      _isRunning = false;
      if (!_isAutonomous) {
        if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false);
      }

      if (state) {
        StateManager.calculateDerivedStats(state);
        if (!UI.isMetaSandboxPending() && UI.isHumanInterventionHidden()) {
          UI.summarizeCompletedCycleLog(cycleOutcome);
          UI.updateStateDisplay();
          UI.clearCurrentCycleDetails();
          UI.logToTimeline(
            state.totalCycles,
            `[STATE] Cycle ended (${
              state.lastCritiqueType || cycleOutcome
            }). Ready.`
          );
          StateManager.save();
          UI.updateStatus("Idle");
        } else {
          UI.updateStateDisplay();
          StateManager.save();
        }
      } else {
        UI.updateStatus("Error - State Lost?", false, true);
      }
      UI.highlightCoreStep(-1);
    }

    if (shouldContinueAutonomous) {
      logger.logEvent(
        "info",
        `Autonomous mode active. Triggering next cycle. Remaining: ${
          state?.autonomyCyclesRemaining ?? "N/A"
        }`
      );
      await Utils.delay(500);
      if (!_abortRequested) {
        executeCycle();
      } else {
        logger.logEvent(
          "info",
          "Autonomous continuation cancelled due to abort request during delay."
        );
        _isAutonomous = false;
        _isRunning = false;
        if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false);
      }
    } else if (_isAutonomous && cycleOutcome !== "Aborted") {
      logger.logEvent("info", `Autonomous run ended. Reason: ${cycleOutcome}`);
      stopAutonomousRun(cycleOutcome);
    }
  };

  const proceedAfterHumanIntervention = async (
    feedbackType,
    feedbackData = "",
    skipCycleIncrement = false
  ) => {
    const state = StateManager?.getState();
    if (!state) {
      logger.logEvent("error", "Cannot proceed HITL, state missing.");
      return;
    }
    const currentCycle = state.totalCycles;
    let nextCycle = currentCycle;
    let feedbackMsg = String(feedbackData);
    let applySuccess = true;
    let isCodeEditSuccess = false;
    let requiresSandbox = false;

    if (feedbackType === "Human Code Edit") {
      const {
        artifactId,
        cycle,
        versionId,
        success,
        validatedContent,
        error,
        contentChanged,
      } = feedbackData;
      feedbackMsg = `Edited ${artifactId}: ${
        success
          ? contentChanged
            ? "Applied successfully."
            : "No changes detected."
          : `Validation Failed: ${error || "Unknown"}`
      }`;
      isCodeEditSuccess = success && contentChanged;

      if (isCodeEditSuccess && artifactId !== "full_html_source") {
        nextCycle = currentCycle + 1;
        try {
          const checksum = await calculateChecksum(validatedContent);
          Storage.setArtifactContent(
            artifactId,
            nextCycle,
            validatedContent,
            versionId
          );
          const currentMeta = StateManager.getArtifactMetadata(
            artifactId,
            versionId
          );
          StateManager.updateArtifactMetadata(
            artifactId,
            currentMeta?.type,
            currentMeta?.description,
            nextCycle,
            checksum,
            "Human Edit",
            versionId,
            false
          );
          UI.displayCycleArtifact(
            `Human Edit Applied${versionId ? " (V: " + versionId + ")" : ""}`,
            validatedContent,
            "info",
            true,
            "Human",
            artifactId,
            nextCycle
          );
          logger.logEvent(
            "info",
            `Human edit applied to ${artifactId} for cycle ${nextCycle}`
          );
          UI.logToTimeline(
            currentCycle,
            `[HUMAN] Applied edit to ${artifactId} for cycle ${nextCycle}`,
            "human",
            true
          );
          if (artifactId.startsWith("target.")) UI.renderGeneratedUI(nextCycle);
        } catch (e) {
          logger.logEvent(
            "error",
            `Failed saving human edit for ${artifactId}: ${e.message}`,
            e
          );
          UI.showNotification(`Failed saving edit: ${e.message}`, "error");
          applySuccess = false;
          nextCycle = currentCycle;
        }
      } else if (artifactId === "full_html_source" && isCodeEditSuccess) {
        logger.logEvent(
          "warn",
          "Full source edited via HITL. Staging for sandbox."
        );
        state.lastGeneratedFullSource = validatedContent;
        applySuccess = true;
        requiresSandbox = true;
        skipCycleIncrement = true;
        UI.showMetaSandbox(validatedContent);
      } else if (!success) {
        applySuccess = false;
      }
    } else if (feedbackType === "Human Options") {
      feedbackMsg = `Selected: ${feedbackData || "None"}`;
      applySuccess = true;
    } else if (feedbackType === "Sandbox Discarded") {
      feedbackMsg = "User discarded sandbox changes.";
      applySuccess = true;
    } else if (feedbackType === "Human Prompt") {
      feedbackMsg = `Provided prompt: ${Utils.trunc(feedbackData, 100)}`;
      applySuccess = true;
    } else if (feedbackType === "Human Critique Selection") {
      feedbackMsg = `User provided critique feedback. Selected: ${
        feedbackData?.selectedCritique ?? "N/A"
      }`;
      StateManager.addCritiqueFeedback(feedbackData);
      logger.logEvent(
        "info",
        `Received critique feedback: ${JSON.stringify(feedbackData)}`
      );
      applySuccess = true;
    }

    state.lastFeedback = `${feedbackType}: ${Utils.trunc(feedbackMsg, 150)}`;
    if (feedbackType.startsWith("Human")) {
      if (state.humanInterventions !== undefined) state.humanInterventions++;
    }

    const summaryOutcome = !applySuccess
      ? `Failed (${feedbackType})`
      : `OK (${feedbackType})`;
    UI.summarizeCompletedCycleLog(summaryOutcome);
    UI.logToTimeline(
      currentCycle,
      `[STATE] ${feedbackType} processed. Feedback: "${Utils.trunc(
        feedbackMsg,
        70
      )}..."`,
      "state"
    );
    UI.hideHumanInterventionUI();

    if (applySuccess && !skipCycleIncrement) {
      state.totalCycles =
        nextCycle === currentCycle ? currentCycle + 1 : nextCycle;
      state.agentIterations++;
    } else if (!applySuccess) {
      state.failCount = (state.failCount || 0) + 1;
      state.failHistory = state.failHistory || [];
      state.failHistory.push({
        cycle: currentCycle,
        reason: `HITL Apply Fail: ${feedbackType}`,
      });
      if (state.failHistory.length > config.MAX_HISTORY_ITEMS)
        state.failHistory.shift();
      state.totalCycles = currentCycle;
    }

    if (!skipCycleIncrement) {
      state.personaMode =
        (state.cfg?.personaBalance ?? 50) < 50 ? "XYZ" : "LSD";
      state.retryCount = 0;
      const uiRefs = UI.getRefs();
      if (uiRefs.goalInput) uiRefs.goalInput.value = "";
      UI.updateStatus("Idle");
      UI.clearCurrentCycleDetails();
      UI.logToTimeline(state.totalCycles, `[STATE] Ready.`);
    } else {
      UI.updateStatus("Meta Sandbox Pending...");
    }
    StateManager.calculateDerivedStats(state);
    UI.updateStateDisplay();
    UI.highlightCoreStep(-1);
    StateManager.save();
  };

  const saveHtmlToHistory = (htmlContent) => {
    const state = StateManager?.getState();
    if (!state) return;
    const limit = state.cfg?.htmlHistoryLimit ?? 5;
    if (!state.htmlHistory) state.htmlHistory = [];
    state.htmlHistory.push(htmlContent);
    while (state.htmlHistory.length > limit) {
      state.htmlHistory.shift();
    }
    UI.updateHtmlHistoryControls(state);
    logger.logEvent(
      "info",
      `Saved HTML state. History size: ${state.htmlHistory.length}`
    );
  };

  const _runSummarization = async (apiKey, stateSummary, currentCycle) => {
    const template =
      Storage.getArtifactContent("reploid.core.summarizer-prompt", 0) || "";
    if (!template) throw new Error("Summarizer prompt not found.");

    const prompt = template
      .replace(
        /\[\[AGENT_STATE_SUMMARY\]\]/g,
        JSON.stringify(stateSummary, null, 2)
      )
      .replace(
        /\[\[RECENT_LOGS\]\]/g,
        Utils.trunc(
          logger.getLogBuffer
            ? logger.getLogBuffer().split("\n").slice(-20).join("\n")
            : "N/A",
          1500
        )
      )
      .replace(/\[\[LATEST_ARTIFACTS\]\]/g, _getArtifactListSummary());

    const critiqueModel =
      StateManager?.getState()?.cfg?.critiqueModel ||
      config.DEFAULT_MODELS.CRITIQUE;
    let summaryResultText = "";

    try {
      let accumulatedSummaryText = "";
      const apiResult = await ApiClient.callApiWithRetry(
        prompt,
        'You are Summarizer x0. Output ONLY valid JSON: {"summary": "string"}',
        critiqueModel,
        apiKey,
        [],
        false,
        null,
        1,
        {},
        (msg, act, err) => UI.updateStatus(`Summarize: ${msg}`, act, err),
        (cyc, msg, type, sub, anim) =>
          UI.logToTimeline(cyc, `[SUM] ${msg}`, type, sub, anim),
        UI.updateTimelineItem,
        (progress) => {
          if (progress.type === "text")
            accumulatedSummaryText += progress.content;
          summaryResultText =
            progress.accumulatedResult?.content || accumulatedSummaryText;
        }
      );
      if (!summaryResultText && apiResult?.content)
        summaryResultText = apiResult.content;

      const sanitized = ApiClient.sanitizeLlmJsonResp(summaryResultText);
      const parsed = JSON.parse(sanitized);
      if (typeof parsed.summary === "string") {
        return parsed.summary;
      } else {
        throw new Error("Summarizer response missing 'summary' field.");
      }
    } catch (e) {
      logger.logEvent(
        "error",
        `Summarization LLM call failed: ${e.message}`,
        e
      );
      return null;
    }
  };

  const handleSummarizeContext = async () => {
    const state = StateManager?.getState();
    if (!state || !state.apiKey) {
      UI.showNotification("API Key required for summarization.", "warn");
      return;
    }
    if (_isRunning) {
      UI.showNotification(
        "Cannot summarize context while cycle is running.",
        "warn"
      );
      return;
    }

    UI.updateStatus("Summarizing context...", true);
    UI.showNotification("Starting context summarization...", "info", 3000);
    const currentCycle = state.totalCycles;
    const nextCycle = currentCycle + 1;
    UI.logToTimeline(
      currentCycle,
      "[CONTEXT] Running summarization...",
      "context",
      true
    );
    UI.clearCurrentCycleDetails();

    try {
      const stateSummary = {
        totalCycles: state.totalCycles,
        agentIterations: state.agentIterations,
        humanInterventions: state.humanInterventions,
        failCount: state.failCount,
        currentGoal: {
          seed: Utils.trunc(state.currentGoal?.seed, 200),
          cumulative: Utils.trunc(state.currentGoal?.cumulative, 500),
          latestType: state.currentGoal?.latestType,
          currentContextFocus: state.currentGoal?.currentContextFocus,
        },
        lastCritiqueType: state.lastCritiqueType,
        lastFeedback: Utils.trunc(state.lastFeedback, 200),
        avgConfidence: state.avgConfidence?.toFixed(2),
        critiqueFailRate: state.critiqueFailRate?.toFixed(1),
        dynamicTools: (state.dynamicTools || []).map((t) => t.declaration.name),
        evaluationHistory: _summarizeHistory(
          state.evaluationHistory,
          "Eval",
          3
        ),
      };
      const summaryText = await _runSummarization(
        state.apiKey,
        stateSummary,
        currentCycle
      );
      if (summaryText === null)
        throw new Error("Summarization LLM call or parsing failed.");

      const checksum = await calculateChecksum(summaryText);
      Storage.setArtifactContent(
        "meta.summary_context",
        nextCycle,
        summaryText
      );
      StateManager.updateArtifactMetadata(
        "meta.summary_context",
        "TEXT",
        "Last Context Summary",
        nextCycle,
        checksum,
        "Summarizer"
      );

      state.currentGoal = {
        seed: state.currentGoal?.seed,
        cumulative: `Context summarized up to Cycle ${currentCycle}. Original Seed: ${
          state.currentGoal?.seed || "None"
        }. New Summary:\n${summaryText}`,
        latestType: "Idle",
        summaryContext: summaryText,
        currentContextFocus: null,
      };
      state.contextTokenEstimate =
        Math.round((summaryText.length / 4) * 1.1) + 500;
      state.lastFeedback = `Context summarized at Cycle ${currentCycle}.`;
      state.lastCritiqueType = "Context Summary";
      state.totalCycles = nextCycle;

      UI.logToTimeline(
        currentCycle,
        `[CONTEXT] Summarized. Saved as meta.summary_context_${nextCycle}. Est. tokens: ${state.contextTokenEstimate.toLocaleString()}.`,
        "context"
      );
      UI.displayCycleArtifact(
        "Generated Context Summary",
        summaryText,
        "output",
        true,
        "System",
        "meta.summary_context",
        nextCycle
      );
      UI.showNotification("Context summarization complete.", "info", 5000);
    } catch (error) {
      logger.logEvent("error", `Summarization failed: ${error.message}`, error);
      UI.showNotification(`Summarization failed: ${error.message}`, "error");
      UI.logToTimeline(
        currentCycle,
        `[CONTEXT ERR] Summarization failed: ${error.message}`,
        "error"
      );
    } finally {
      StateManager.calculateDerivedStats(state);
      UI.updateStateDisplay();
      UI.updateStatus("Idle");
      StateManager.save();
    }
  };

  const abortCurrentCycle = () => {
    if (_isRunning) {
      logger.logEvent("info", "Abort request received.");
      _abortRequested = true;
      ApiClient.abortCurrentCall("User Abort Request");
      if (_isAutonomous) {
        stopAutonomousRun("Aborted");
      } else {
        UI.updateStatus("Aborting...");
      }
    } else {
      logger.logEvent("info", "Abort request ignored: No cycle running.");
    }
  };

  const startAutonomousRun = (mode = "Continuous", cycles = 0) => {
    if (_isRunning) {
      UI.showNotification(
        "Cannot start autonomous run: Cycle already in progress.",
        "warn"
      );
      return;
    }
    const state = StateManager.getState();
    if (!state) {
      UI.showNotification(
        "Cannot start autonomous run: State not loaded.",
        "error"
      );
      return;
    }
    if (mode === "N_Cycles" && (!cycles || cycles <= 0)) {
      UI.showNotification(
        "Cannot start N_Cycles run: Invalid number of cycles specified.",
        "warn"
      );
      return;
    }

    logger.logEvent(
      "info",
      `Starting autonomous run. Mode: ${mode}, Cycles: ${cycles}`
    );
    state.autonomyMode = mode;
    state.autonomyCyclesRemaining = mode === "N_Cycles" ? cycles : Infinity;
    _isAutonomous = true;
    _abortRequested = false;
    StateManager.save();
    UI.updateAutonomyControls(mode, true);
    UI.updateStatus(`Autonomous Run (${mode}) Started...`);
    executeCycle();
  };

  const stopAutonomousRun = (reason = "User Stop Request") => {
    logger.logEvent("info", `Stopping autonomous run. Reason: ${reason}`);
    _abortRequested = true;
    _isAutonomous = false;
    const state = StateManager.getState();
    if (state) {
      state.autonomyMode = "Manual";
      state.autonomyCyclesRemaining = 0;
      StateManager.save();
    }
    UI.updateAutonomyControls("Manual", false);
    UI.updateStatus(`Autonomous Run Stopped (${reason})`);
    if (_isRunning) {
      if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false);
      _isRunning = false;
    }
  };

  const runTool = async (toolName, args) => {
    const state = StateManager?.getState();
    if (!state) throw new Error("Cannot run tool, state not available.");
    const dynamicTools = state.dynamicTools || [];
    const dummyHooks = {
      updateStatus: () => {},
      logTimeline: () => ({}),
      updateTimelineItem: () => {},
    };
    const toolRunnerWithApiClient = ToolRunnerModule(
      config,
      logger,
      Storage,
      StateManager,
      ApiClient
    );
    return await toolRunnerWithApiClient.runTool(
      toolName,
      args,
      loadedStaticTools,
      dynamicTools,
      dummyHooks
    );
  };

  return {
    init,
    executeCycle,
    isRunning,
    isAutonomous,
    getActiveGoalInfo,
    proceedAfterHumanIntervention,
    handleSummarizeContext,
    abortCurrentCycle,
    saveHtmlToHistory,
    runTool,
    startAutonomousRun,
    stopAutonomousRun,
  };
};

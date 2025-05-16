const CycleLogicModule = (
  config, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers
) => {
  if (!config || !logger || !Utils || !Storage || !StateManager || !UI || !ApiClient || !ToolRunner || !Errors || !AgentLogicPureHelpers) {
    const internalLog = logger || { logEvent: (lvl, msg, det) => console[lvl === "error" ? "error" : "log"](`[CYCLELOGIC_FALLBACK] ${msg}`, det || "") };
    internalLog.logEvent("error", "CycleLogicModule initialization failed: Missing one or more core dependencies.");
    const fallback = {};
    const methods = [ "init", "executeCycle", "isRunning", "getActiveGoalInfo", "proceedAfterHumanIntervention", "handleSummarizeContext", "abortCurrentCycle", "saveHtmlToHistory", "runTool", "startAutonomousRun", "stopAutonomousRun" ];
    methods.forEach(m => {
      fallback[m] = () => {
        internalLog.logEvent("error", `CycleLogic not initialized. Called ${m}.`);
        if (m === "isRunning") return false; if (m === "getActiveGoalInfo") return { type: "Idle", latestGoal: "Idle" };
        if (["executeCycle", "handleSummarizeContext", "runTool"].includes(m)) return Promise.reject(new Error("CycleLogic not initialized"));
        return undefined;
      };
    });
    return fallback;
  }

  const { ApplicationError, ApiError, ToolError, StateError, ConfigError, ArtifactError, AbortError, WebComponentError } = Errors;
  let _isRunning = false; let _isAutonomous = false; let _abortRequested = false;
  let currentLlmResponse = null; let loadedStaticTools = []; let isLogicInitialized = false;
  const NUM_CRITIQUES_TO_GENERATE = config.NUM_CRITIQUES_TO_GENERATE || 1;

  const init = () => {
    if (isLogicInitialized) return;
    logger.logEvent("info", "Initializing CycleLogic Module...");
    try {
      const staticToolsContent = Storage.getArtifactContent("reploid.core.static-tools", 0);
      if (staticToolsContent) {
        loadedStaticTools = JSON.parse(staticToolsContent);
        logger.logEvent("debug", `CycleLogic loaded ${loadedStaticTools.length} static tools definitions.`);
      } else {
        logger.logEvent("warn", "Static tools artifact (reploid.core.static-tools) not found. Using empty list.");
        loadedStaticTools = [];
      }
    } catch (e) {
      logger.logEvent("error", `Failed to load/parse static tools: ${e.message}`, e);
      loadedStaticTools = [];
    }
    isLogicInitialized = true;
    logger.logEvent("info", "CycleLogic Module initialized.");
  };

  const isRunning = () => _isRunning;
  const isAutonomous = () => _isAutonomous;

  const getActiveGoalInfo = () => {
    const state = StateManager.getState();
    if (!state || !state.currentGoal) return { seedGoal: "N/A", cumulativeGoal: "N/A", latestGoal: "Idle", type: "Idle", summaryContext: null, currentContextFocus: null };
    const latestGoal = state.currentGoal.cumulative || state.currentGoal.seed;
    return {
      seedGoal: state.currentGoal.seed || "None", cumulativeGoal: state.currentGoal.cumulative || "None",
      latestGoal: latestGoal || "Idle", type: state.currentGoal.latestType || "Idle",
      summaryContext: state.currentGoal.summaryContext || null, currentContextFocus: state.currentGoal.currentContextFocus || null,
    };
  };
  
  const _assembleCorePromptContext = (state, goalInfo, currentCycle) => {
      const corePromptTemplate = Storage.getArtifactContent("reploid.core.sys-prompt", 0);
      if (!corePromptTemplate) throw new ArtifactError("Core prompt artifact 'reploid.core.sys-prompt' not found!", "reploid.core.sys-prompt", 0);

      const allMetaMap = StateManager.getAllArtifactMetadata();
      const artifactListSummary = AgentLogicPureHelpers.getArtifactListSummaryPure(allMetaMap);
      const registeredWebComponentsList = AgentLogicPureHelpers.getRegisteredWebComponentsListPure(StateManager.getRegisteredWebComponents());
      const toolListSummary = AgentLogicPureHelpers.getToolListSummaryPure(loadedStaticTools, state?.dynamicTools || [], Utils.trunc);
      const recentLogs = logger.getLogBuffer ? logger.getLogBuffer().split("\n").slice(-15).join("\n") : "Logs unavailable";
      
      const getArtifactContentForSnippets = (id, cycle, versionId) => Storage.getArtifactContent(id, cycle, versionId);
      const artifactSnippets = AgentLogicPureHelpers.prepareArtifactSnippetsPure(allMetaMap, getArtifactContentForSnippets, goalInfo.type, Utils.trunc);

      const { prompt, error } = AgentLogicPureHelpers.assembleCorePromptPure(
          corePromptTemplate, state, goalInfo,
          artifactListSummary, registeredWebComponentsList, toolListSummary,
          recentLogs, artifactSnippets, Utils.trunc
      );
      if (error) throw new ApplicationError(error);

      UI.displayCycleArtifact("LLM Input Prompt", prompt, "input", false, "System", "prompt.core", currentCycle);
      if (goalInfo.summaryContext) UI.displayCycleArtifact("LLM Input Context (Summary)", goalInfo.summaryContext, "input", false, "System", "prompt.summary", currentCycle);
      return prompt;
  };

  const _prepareFunctionDeclarations = async (state) => {
    let allFuncDecls = [];
    const dynamicTools = state?.dynamicTools || [];
    const uiHooks = { updateStatus: () => {}, logTimeline: () => ({}), updateTimelineItem: () => {} };

    const convertToolToFc = async (toolDef, type) => {
        try {
            const conversionResult = await ToolRunner.runTool("convert_to_gemini_fc", { mcpToolDefinition: toolDef }, loadedStaticTools, [], uiHooks);
            return conversionResult?.geminiFunctionDeclaration;
        } catch (e) {
            logger.logEvent("error", `Failed converting ${type} tool ${toolDef.name || toolDef.declaration?.name}: ${e.message}`, e instanceof ToolError ? e.details : e);
            return null;
        }
    };
    const staticToolPromises = loadedStaticTools.map(toolDef => convertToolToFc(toolDef, "static"));
    const dynamicToolPromises = dynamicTools.map(toolDef => convertToolToFc(toolDef.declaration, "dynamic"));
    try {
        const results = await Promise.all([...staticToolPromises, ...dynamicToolPromises]);
        allFuncDecls = results.filter(Boolean);
    } catch (error) {
        logger.logEvent("error", `Error during tool declaration preparation: ${error.message}`, error);
    }
    return allFuncDecls;
  };

  const _handleToolExecution = async (toolCall, state, currentCycle, uiHooks) => {
    const { name: toolName, arguments: toolArgs } = toolCall;
    uiHooks.updateStatus(`Running Tool: ${toolName}...`, true);
    let toolLogItem = uiHooks.logTimeline(currentCycle, `[TOOL] Calling '${toolName}'... Args: ${Utils.trunc(JSON.stringify(toolArgs), 60)}`, "tool", true, true);
    UI.displayCycleArtifact(`Tool Call: ${toolName}`, JSON.stringify(toolArgs, null, 2), "info", false, "LLM", `tool.call.${toolName}`, currentCycle);
    let funcRespContent; let toolResult = null; let toolError = null; let toolSuccess = false;
    try {
      toolResult = await ToolRunner.runTool(toolName, toolArgs, loadedStaticTools, state.dynamicTools || [], uiHooks);
      toolSuccess = true;
      if (toolResult && typeof toolResult.success === "boolean" && !toolResult.success) {
        toolSuccess = false; toolError = new ToolError(toolResult.error || `Tool '${toolName}' reported failure.`, toolName, toolArgs, toolResult);
      }
      funcRespContent = { name: toolName, response: { content: JSON.stringify(toolResult) } };
      uiHooks.updateTimelineItem(toolLogItem, `[TOOL ${toolSuccess ? "OK" : "FAIL"}] '${toolName}'. Result: ${Utils.trunc(JSON.stringify(toolResult), 80)}`, toolSuccess ? "tool" : "error", true);
      UI.displayCycleArtifact(`Tool Response: ${toolName}`, JSON.stringify(toolResult, null, 2), toolSuccess ? "output" : "error", false, "Tool", `tool.response.${toolName}`, currentCycle);
      if (toolName === "run_self_evaluation" && toolResult && toolSuccess) StateManager.addEvaluationResult(toolResult);
      if (!toolSuccess && toolError) throw toolError;
    } catch (e) {
      toolSuccess = false; toolError = e instanceof ToolError ? e : new ToolError(`Tool '${toolName}' failed: ${e.message}`, toolName, toolArgs, e);
      logger.logEvent("error", `Tool Execution Error (${toolName}): ${toolError.message}`, toolError.details || toolError);
      funcRespContent = { name: toolName, response: { error: `Tool failed: ${toolError.message}` } };
      uiHooks.updateTimelineItem(toolLogItem, `[TOOL ERR] '${toolName}': ${Utils.trunc(toolError.message, 60)}`, "error", true);
      UI.displayCycleArtifact(`Tool Error: ${toolName}`, toolError.message + (toolError.details ? `\nDetails: ${JSON.stringify(toolError.details)}` : ""), "error", false, "Tool", `tool.error.${toolName}`, currentCycle);
    }
    return { role: "function", parts: [{ functionResponse: funcRespContent }], _toolExecutionInfo: { name: toolName, args: toolArgs, success: toolSuccess, result: toolResult, error: toolError?.message || null, errorDetails: toolError?.details || null } };
  };

  const _executeLlmApiCallSequence = async (prompt, sysInstruction, coreModelIdentifier, apiKey, allFuncDecls, state, currentCycle) => {
    let apiHistory = []; let currentApiResult = null; let accumulatedText = ""; let isContinuation = false;
    let totalInputTokens = 0; let totalOutputTokens = 0; let toolExecutionSummaries = [];
    const uiHooks = { updateStatus: UI.updateStatus, logTimeline: UI.logToTimeline, updateTimelineItem: UI.updateTimelineItem, displayArtifact: UI.displayCycleArtifact };
    let currentPrompt = prompt; let currentHistory = null;
    for (let i = 0; i < 5; i++) {
      logger.logEvent("debug", `API Call Sequence: Iteration ${i + 1}`);
      let loopApiResult = null; let loopAccumulatedText = "";
      const callResult = await ApiClient.callApiWithRetry(currentPrompt, sysInstruction, coreModelIdentifier, apiKey, allFuncDecls, isContinuation, currentHistory, state.cfg?.maxRetries ?? 1, {}, uiHooks.updateStatus, uiHooks.logTimeline, uiHooks.updateTimelineItem, (progress) => {
          if (progress.type === "text") { loopAccumulatedText += progress.content; UI.updateStreamingOutput(loopAccumulatedText); }
          else if (progress.type === "functionCall") UI.updateStreamingOutput(`Function Call received: ${progress.content.name}\nArgs:\n${JSON.stringify(progress.content.args, null, 2)}`);
          if (progress.accumulatedResult) loopApiResult = progress.accumulatedResult;
        }
      );
      if (!loopApiResult) loopApiResult = callResult;
      currentApiResult = loopApiResult; accumulatedText = loopAccumulatedText;
      totalInputTokens += loopApiResult.inputTokenCount || 0; totalOutputTokens += loopApiResult.outputTokenCount || 0;
      if (currentPrompt) apiHistory.push({ role: "user",parts: [{ text: currentPrompt }] });
      if (loopApiResult.rawResp?.candidates?.[0]?.content) apiHistory.push(loopApiResult.rawResp.candidates[0].content);
      else if (loopApiResult.type === "text" && loopApiResult.content) apiHistory.push({ role: "model", parts: [{ text: loopApiResult.content }] });
      
      if (loopApiResult.type === "functionCall" && loopApiResult.content?.name) {
        uiHooks.updateStatus("Processing Tool Call...", true);
        const fc = loopApiResult.content;
        const toolResponse = await _handleToolExecution(fc, state, currentCycle, uiHooks);
        toolExecutionSummaries.push(toolResponse._toolExecutionInfo);
        apiHistory.push(toolResponse);
        currentPrompt = null; currentHistory = [...apiHistory]; isContinuation = true; loopAccumulatedText = "";
        continue;
      } else { break; }
    }
    StateManager.updateAndSaveState(s => { s.lastApiResponse = currentApiResult; s.contextTokenEstimate += totalOutputTokens; return s; });
    return { apiResult: currentApiResult, accumulatedText: accumulatedText, toolExecutionSummaries: toolExecutionSummaries };
  };

  const _processLlmApiResponse = (apiCallResult, state, currentCycle) => {
    UI.updateStatus("Processing Final Response...");
    const finalContent = apiCallResult.accumulatedText || apiCallResult.apiResult?.content || "(No final text output)";
    UI.updateStreamingOutput(finalContent, true);
    const sanitized = ApiClient.sanitizeLlmJsonResp(finalContent);
    let parsedResp;
    UI.displayCycleArtifact("LLM Final Output Raw", finalContent, "info", false, "LLM", "llm.raw", currentCycle);
    UI.displayCycleArtifact("LLM Final Output Sanitized", sanitized, "output", false, "LLM", "llm.sanitized", currentCycle);
    try {
      parsedResp = JSON.parse(sanitized);
      logger.logEvent("info", `Parsed final LLM JSON after iteration ${currentCycle}.`);
      UI.logToTimeline(currentCycle, "[LLM OK] Received and parsed final response.");
      StateManager.updateAndSaveState(s => {
        if (parsedResp.self_assessment_notes) {
          UI.displayCycleArtifact("Agent Self-Assessment", parsedResp.self_assessment_notes, "info", false, "LLM", "llm.self_assessment", currentCycle);
          logger.logEvent("info", `LLM provided self-assessment notes: ${Utils.trunc(parsedResp.self_assessment_notes, 100)}`);
          s.lastSelfAssessment = parsedResp.self_assessment_notes;
        }
        if (parsedResp.current_context_focus && s.currentGoal) {
          s.currentGoal.currentContextFocus = parsedResp.current_context_focus;
          logger.logEvent("info", `LLM updated context focus: ${s.currentGoal.currentContextFocus}`);
        }
        return s;
      });
    } catch (e) {
      logger.logEvent("error", `LLM final JSON parse failed: ${e.message}. Content: ${Utils.trunc(sanitized, 500)}`, e);
      UI.logToTimeline(currentCycle, "[LLM ERR] Invalid final JSON response.", "error");
      UI.displayCycleArtifact("Parse Error", e.message, "error", false, "System", "parse.error", currentCycle);
      throw new ApplicationError(`LLM response invalid JSON: ${e.message}`, { content: sanitized });
    }
    const outputTokens = apiCallResult.apiResult?.outputTokenCount || 0;
    if (outputTokens > 0) {
        StateManager.updateAndSaveState(s => {
            if (!s.tokenHistory) s.tokenHistory = [];
            s.tokenHistory.push(outputTokens);
            if (s.tokenHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.tokenHistory.shift();
            return s;
        });
    }
    return parsedResp;
  };

  const _runLlmIteration = async (state, goalInfo, currentCycle) => {
    UI.highlightCoreStep(1); const startTime = performance.now();
    let finalResult = null; let toolSummaries = [];
    try {
      const prompt = _assembleCorePromptContext(state, goalInfo, currentCycle);
      const sysInstruction = `You are x0. DELIBERATE, adopt ${state.personaMode}. Respond ONLY valid JSON matching the schema. Refer to artifacts by ID and optional versionId (e.g., file.js#v1). Use artifactId and cycle args for tools. Use run_self_evaluation tool if appropriate. Provide modular edits via 'artifact_changes.modular' when possible. If generating full page changes, use 'page_composition' over 'full_html_source' string if 'enablePageComposition' config is true and it's suitable. Consider artifact paradigms.`;
      const allFuncDecls = await _prepareFunctionDeclarations(state);
      const coreModelKey = state.cfg?.coreModel || "ADVANCED";
      const coreModelIdentifier = config.DEFAULT_MODELS[coreModelKey.toUpperCase()] || coreModelKey;
      const apiKey = state.apiKey;
      if (!apiKey) throw new ConfigError("API Key is missing. Cannot make LLM call.", "apiKey");
      UI.clearStreamingOutput();
      const apiCallResult = await _executeLlmApiCallSequence(prompt, sysInstruction, coreModelIdentifier, apiKey, allFuncDecls, state, currentCycle);
      toolSummaries = apiCallResult.toolExecutionSummaries || [];
      const parsedResp = _processLlmApiResponse(apiCallResult, state, currentCycle);
      finalResult = { response: parsedResp, cycleTimeMillis: performance.now() - startTime, toolSummaries: toolSummaries, error: null };
    } catch (error) {
      if (!(error instanceof AbortError)) {
        logger.logEvent("error", `Core LLM Iteration failed (Cycle ${currentCycle}): ${error.message}`, error instanceof ApplicationError ? error.details : error);
        UI.logToTimeline(currentCycle, `[LLM ERR] Iteration failed: ${Utils.trunc(error.message, 100)}`, "error");
      }
      finalResult = { response: null, cycleTimeMillis: performance.now() - startTime, toolSummaries: toolSummaries, error: error };
    } finally { UI.clearStreamingOutput(); }
    return finalResult;
  };
  
  const _assembleCritiquePromptContext = (llmProposal, goalInfo) => {
      const template = Storage.getArtifactContent("reploid.core.critiquer-prompt", 0);
      if (!template) throw new ArtifactError("Critique prompt artifact not found!", "reploid.core.critiquer-prompt", 0);
      
      const getParadigm = (id) => StateManager.getArtifactMetadata(id)?.paradigm || "unknown";
      const changes = llmProposal.artifact_changes || {};
      const modifiedParadigmSummary = (changes.modified || []).map(a => getParadigm(a.id)).join(", ") || "N/A";
      const newParadigmSummary = (changes.new || []).map(a => a.paradigm || getParadigm(a.id)).join(", ") || "N/A";
      const deletedParadigmSummary = (changes.deleted || []).map(id => getParadigm(id)).join(", ") || "N/A";
      const modularParadigmSummary = (changes.modular || []).map(a => getParadigm(a.id)).join(", ") || "N/A";

      const { prompt, error } = AgentLogicPureHelpers.assembleCritiquePromptPure(template, llmProposal, goalInfo, Utils.trunc);
      if(error) throw new ApplicationError(error);

      return prompt
          .replace(/\[\[MODIFIED_ARTIFACT_PARADIGMS\]\]/g, modifiedParadigmSummary)
          .replace(/\[\[NEW_ARTIFACT_PARADIGMS\]\]/g, newParadigmSummary)
          .replace(/\[\[DELETED_ARTIFACT_PARADIGMS\]\]/g, deletedParadigmSummary)
          .replace(/\[\[MODULAR_ARTIFACT_PARADIGMS\]\]/g, modularParadigmSummary);
  };

  const _runSingleAutoCritiqueInstance = async (apiKey, llmProposal, goalInfo, currentCycle, critiqueIndex) => {
    const state = StateManager.getState(); if (!state) throw new StateError("State not initialized for critique instance");
    const prompt = _assembleCritiquePromptContext(llmProposal, goalInfo);
    const critiqueModelKey = state.cfg?.critiqueModel || "BASE";
    const critiqueModelIdentifier = config.DEFAULT_MODELS[critiqueModelKey.toUpperCase()] || critiqueModelKey;
    const sysInstruction = 'Critiquer x0. Analyze objectively. Output ONLY valid JSON: {"critique_passed": boolean, "critique_report": "string"}';
    UI.displayCycleArtifact(`Critique Input [${critiqueIndex + 1}/${NUM_CRITIQUES_TO_GENERATE}]`, prompt, "input", false, "System", `prompt.critique.${critiqueIndex}`, currentCycle);
    let critiqueResultText = ""; let critiqueApiResult = null; let finalResult = { critique_passed: false, critique_report: "Critique execution failed" };
    try {
      let accumulatedCritiqueText = "";
      const genConfigOverrides = NUM_CRITIQUES_TO_GENERATE > 1 ? { temperature: 0.7 + Math.random() * 0.2 } : {};
      critiqueApiResult = await ApiClient.callApiWithRetry(prompt, sysInstruction, critiqueModelIdentifier, apiKey, [], false, null, state.cfg?.maxRetries ?? 1, genConfigOverrides,
        (msg, active, isErr) => UI.updateStatus(`Critique ${critiqueIndex + 1}: ${msg}`, active, isErr),
        (cyc, msg, type, sub, anim) => UI.logToTimeline(cyc, `[CRIT ${critiqueIndex + 1}] ${msg}`, type, sub, anim),
        UI.updateTimelineItem,
        (progress) => {
          if (progress.type === "text") accumulatedCritiqueText += progress.content;
          if (progress.accumulatedResult) critiqueApiResult = progress.accumulatedResult;
          critiqueResultText = progress.accumulatedResult?.content || accumulatedCritiqueText;
        }
      );
      if (!critiqueResultText && critiqueApiResult?.content) critiqueResultText = critiqueApiResult.content;
      UI.displayCycleArtifact(`Critique Output Raw [${critiqueIndex + 1}]`, critiqueResultText || "(No text content)", "info", false, "LLM", `critique.raw.${critiqueIndex}`, currentCycle);
      const sanitized = ApiClient.sanitizeLlmJsonResp(critiqueResultText);
      UI.displayCycleArtifact(`Critique Output Sanitized [${critiqueIndex + 1}]`, sanitized, "output", false, "LLM", `critique.sanitized.${critiqueIndex}`, currentCycle);
      const parsedCritique = JSON.parse(sanitized);
      if (typeof parsedCritique.critique_passed !== "boolean" || typeof parsedCritique.critique_report !== "string") throw new ApplicationError("Critique JSON missing required fields.");
      finalResult = parsedCritique;
    } catch (e) {
      logger.logEvent("error", `Critique instance ${critiqueIndex + 1} API/Parse failed: ${e.message}`, e);
      UI.logToTimeline(currentCycle, `[CRIT ${critiqueIndex + 1} ERR] Failed: ${e.message}`, "error", true);
      UI.displayCycleArtifact(`Critique Error [${critiqueIndex + 1}]`, e.message, "error", false, "System", `critique.error.${critiqueIndex}`, currentCycle);
      finalResult.critique_report = `Critique instance ${critiqueIndex + 1} failed: ${e.message}`;
    }
    return finalResult;
  };

  const _runAutoCritique = async (apiKey, llmProposal, goalInfo, currentCycle) => {
    UI.highlightCoreStep(5); UI.updateStatus(`Running ${NUM_CRITIQUES_TO_GENERATE} Auto-Critiques...`, true);
    const critiquePromises = [];
    for (let i = 0; i < NUM_CRITIQUES_TO_GENERATE; i++) critiquePromises.push(_runSingleAutoCritiqueInstance(apiKey, llmProposal, goalInfo, currentCycle, i));
    const results = await Promise.allSettled(critiquePromises);
    const successfulCritiques = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failedCritiques = results.filter((r) => r.status === "rejected").map((r) => ({ critique_passed: false, critique_report: `Critique generation failed: ${r.reason?.message || "Unknown reason"}`}));
    const allCritiqueOutputs = [...successfulCritiques, ...failedCritiques];
    const overallPassed = successfulCritiques.length === NUM_CRITIQUES_TO_GENERATE && successfulCritiques.every((c) => c.critique_passed);
    let combinedReport = allCritiqueOutputs.map((c, i) => `Critique ${i + 1}: ${c.critique_passed ? "Pass" : "FAIL"}. Report: ${c.critique_report}`).join("\n---\n");
    if (failedCritiques.length > 0) combinedReport += `\n---\nWARNING: ${failedCritiques.length} critique generation(s) failed.`;
    logger.logEvent("info", `Multi-Critique finished. Overall Pass: ${overallPassed}`);
    UI.logToTimeline(currentCycle, `[CRITIQUE] Multi-Critique completed. Overall Passed: ${overallPassed}`);
    UI.updateStatus("Idle"); UI.clearStreamingOutput();
    return { critiques: allCritiqueOutputs, overall_passed: overallPassed, combined_report: combinedReport };
  };
  
  const _assembleHtmlFromPageComposition = async (composition, nextCycleNum, critiqueSource, state) => {
    logger.logEvent("info", "Assembling HTML from page_composition object.", { composition });
    let htmlParts = [];
    try {
      htmlParts.push(composition.doctype || "<!DOCTYPE html>");
      const htmlAttrsObj = composition.html_attributes || { lang: "en" };
      const htmlAttrs = Object.entries(htmlAttrsObj).map(([key, value]) => `${Utils.escapeHtml(key)}="${Utils.escapeHtml(String(value))}"`).join(" ");
      htmlParts.push(`<html ${htmlAttrs}>`);
      htmlParts.push("<head>");
      if (composition.head_elements && Array.isArray(composition.head_elements)) {
        for (const el of composition.head_elements) {
          if (el.type === "artifact_id" && el.id) {
            const meta = StateManager.getArtifactMetadata(el.id);
            const content = meta ? Storage.getArtifactContent(el.id, meta.latestCycle, meta.version_id) : null;
            if (content !== null) {
              htmlParts.push(content); UI.displayCycleArtifact(`Loaded Head Artifact: ${el.id}`, Utils.trunc(content,100), "info", false, critiqueSource, el.id, nextCycleNum);
            } else {
              logger.logEvent("warn", `Head artifact ${el.id} not found for page_composition.`); htmlParts.push(`<!-- Head artifact ${el.id} not found -->`);
            }
          } else if (el.type === "inline_tag" && el.tag) {
            const tagAttrsObj = el.attributes || {};
            const tagAttrs = Object.entries(tagAttrsObj).map(([key, value]) => `${Utils.escapeHtml(key)}="${Utils.escapeHtml(String(value))}"`).join(" ");
            let tagContent = "";
            if (el.content) tagContent = Utils.escapeHtml(el.content);
            else if (el.content_artifact_id) {
                const metaContent = StateManager.getArtifactMetadata(el.content_artifact_id);
                const artifactContent = metaContent ? Storage.getArtifactContent(el.content_artifact_id, metaContent.latestCycle, metaContent.version_id) : null;
                if (artifactContent !== null) {
                    tagContent = artifactContent; UI.displayCycleArtifact(`Loaded Content for <${el.tag}>: ${el.content_artifact_id}`, Utils.trunc(artifactContent,100), "info", false, critiqueSource, el.content_artifact_id, nextCycleNum);
                } else { logger.logEvent("warn", `Content artifact ${el.content_artifact_id} for <${el.tag}> not found.`); tagContent = `<!-- Content artifact ${el.content_artifact_id} not found -->`;}
            }
            const voidElements = ["meta", "link", "br", "hr", "img", "input", "base", "col", "embed", "param", "source", "track", "area", "keygen", "wbr"];
            if (voidElements.includes(el.tag.toLowerCase())) htmlParts.push(`<${el.tag} ${tagAttrs}>`);
            else htmlParts.push(`<${el.tag} ${tagAttrs}>${tagContent}</${el.tag}>`);
          }
        }
      }
      htmlParts.push("</head>");
      const bodyAttrsObj = composition.body_attributes || {};
      const bodyAttrs = Object.entries(bodyAttrsObj).map(([key, value]) => `${Utils.escapeHtml(key)}="${Utils.escapeHtml(String(value))}"`).join(" ");
      htmlParts.push(`<body ${bodyAttrs}>`);
      if (composition.body_elements && Array.isArray(composition.body_elements)) {
        for (const el of composition.body_elements) {
          if (el.type === "artifact_id" && el.id) {
            const meta = StateManager.getArtifactMetadata(el.id);
            const content = meta ? Storage.getArtifactContent(el.id, meta.latestCycle, meta.version_id) : null;
            if (content !== null) {
              htmlParts.push(content); UI.displayCycleArtifact(`Loaded Body Artifact: ${el.id}`, Utils.trunc(content,100), "info", false, critiqueSource, el.id, nextCycleNum);
            } else {
              logger.logEvent("warn", `Body artifact ${el.id} not found for page_composition.`); htmlParts.push(`<!-- Body artifact ${el.id} not found -->`);
            }
          } else if (el.type === "web_component_tag" && el.tag) {
            const wcAttrsObj = el.attributes || {};
            const wcAttrs = Object.entries(wcAttrsObj).map(([key, value]) => `${Utils.escapeHtml(key)}="${Utils.escapeHtml(String(value))}"`).join(" ");
            htmlParts.push(`<${el.tag} ${wcAttrs}></${el.tag}>`);
          } else if (el.type === "inline_html" && el.content) htmlParts.push(el.content);
        }
      }
      if (composition.script_references && Array.isArray(composition.script_references)) {
        for (const ref of composition.script_references) {
          const scriptAttrsList = [];
          if (ref.attributes) {
            if (ref.attributes.defer) scriptAttrsList.push("defer"); if (ref.attributes.async) scriptAttrsList.push("async");
            Object.entries(ref.attributes).forEach(([key,value]) => { if (!["defer", "async", "src"].includes(key) && value !== undefined) scriptAttrsList.push(`${Utils.escapeHtml(key)}="${Utils.escapeHtml(String(value))}"`); });
          }
          const scriptAttrs = scriptAttrsList.join(" ");
          if (ref.type === "artifact_id" && ref.id) {
            const meta = StateManager.getArtifactMetadata(ref.id);
            const content = meta ? Storage.getArtifactContent(ref.id, meta.latestCycle, meta.version_id) : null;
            if (content !== null) {
              htmlParts.push(`<script ${scriptAttrs}>${content}</script>`); UI.displayCycleArtifact(`Inlined Script Artifact: ${ref.id}`, `(${content.length} chars)`, "info", false, critiqueSource, ref.id, nextCycleNum);
            } else {
              logger.logEvent("warn", `Script artifact ${ref.id} not found for inlining.`); htmlParts.push(`<!-- Script artifact ${ref.id} not found -->`);
            }
          } else if (ref.type === "path" && ref.src) htmlParts.push(`<script src="${Utils.escapeHtml(ref.src)}" ${scriptAttrs}></script>`);
        }
      }
      htmlParts.push("</body></html>");
      const assembledHtml = htmlParts.join("\n");
      logger.logEvent("info", `Successfully assembled HTML from page_composition (${assembledHtml.length} chars).`);
      UI.displayCycleArtifact("Assembled Page Composition (Preview)", Utils.trunc(assembledHtml, 500), "output", true, critiqueSource, "page_composition_output", nextCycleNum);
      return assembledHtml;
    } catch (error) {
      logger.logEvent("error", "Failed to assemble HTML from page_composition", error);
      throw new ApplicationError("HTML assembly from page_composition failed.", { originalError: error.message || String(error), composition });
    }
  };

  const _applyArtifactChanges = async (artifactChanges, nextCycleNum, critiqueSource, state, changesMade, errors) => {
    const { modified, new: newArtifacts, deleted, modular, full_html_source, page_composition } = artifactChanges || {};
    let requiresSandbox = false;

    if (page_composition && state.cfg?.enablePageComposition === true) {
      try {
        const assembledHtml = await _assembleHtmlFromPageComposition(page_composition, nextCycleNum, critiqueSource, state);
        StateManager.updateAndSaveState(s => { s.lastGeneratedFullSource = assembledHtml; return s; });
        changesMade.push("Generated Page Composition (Sandbox Required)");
        UI.displayCycleArtifact("Proposed Page Composition Structure", JSON.stringify(page_composition, null, 2), "info", true, critiqueSource, "page_composition_input", state.totalCycles);
        requiresSandbox = true;
      } catch (e) {
        errors.push(`Failed to process page_composition: ${e.message}`); logger.logEvent("error", "Page Composition processing error", e);
        UI.displayCycleArtifact("Page Composition Error", e.message, "error", false, critiqueSource, "page_composition_error", state.totalCycles);
      }
    } else if (full_html_source) {
      StateManager.updateAndSaveState(s => { s.lastGeneratedFullSource = full_html_source; return s; });
      changesMade.push("Generated Full HTML (Sandbox Required)");
      UI.displayCycleArtifact("Full HTML Source (Prepared for Sandbox)", `(${full_html_source.length} chars)`, "output", true, critiqueSource, "full_html_output", state.totalCycles);
      requiresSandbox = true;
    }

    for (const modArt of modified || []) {
      if (!modArt.id || modArt.content === undefined) { errors.push(`Invalid modified artifact structure: ID=${modArt.id || "?"}`); continue; }
      const currentMeta = StateManager.getArtifactMetadata(modArt.id);
      if (!currentMeta) { errors.push(`Modify failed (original not found): ${modArt.id}`); continue; }
      const currentContent = Storage.getArtifactContent(modArt.id, currentMeta.latestCycle, currentMeta.version_id);
      if (currentContent === null) { errors.push(`Modify failed (original content missing): ${modArt.id} C${currentMeta.latestCycle} V${currentMeta.version_id || "def"}`); continue; }
      if (currentContent !== modArt.content) {
        try {
          const checksum = await Utils.calculateChecksum(modArt.content);
          Storage.setArtifactContent(modArt.id, nextCycleNum, modArt.content, modArt.version_id);
          StateManager.updateArtifactMetadata(modArt.id, currentMeta.type, currentMeta.description, nextCycleNum, checksum, critiqueSource, modArt.version_id, false, currentMeta.paradigm);
          changesMade.push(`Modified: ${modArt.id}${modArt.version_id ? "#" + modArt.version_id : ""}`);
          UI.displayCycleArtifact(`Modified Artifact${modArt.version_id ? " (V: " + modArt.version_id + ")" : ""}`, Utils.trunc(modArt.content, 200), "output", true, critiqueSource, modArt.id, nextCycleNum);
          if (modArt.id.startsWith("reploid.")) logger.logEvent("warn", `Core artifact ${modArt.id} modified.`);
        } catch (e) { errors.push(`Failed save mod ${modArt.id}: ${e.message}`); }
      } else { UI.displayCycleArtifact(`Modified (No Change)${modArt.version_id ? " (V: " + modArt.version_id + ")" : ""}`, Utils.trunc(currentContent, 200), "info", false, critiqueSource, modArt.id, currentMeta.latestCycle); }
    }
    for (const newArt of newArtifacts || []) {
      if (!newArt.id || !newArt.type || newArt.content === undefined) { errors.push(`Invalid new artifact structure: ID=${newArt.id || "?"}`); continue; }
      try {
        const checksum = await Utils.calculateChecksum(newArt.content);
        Storage.setArtifactContent(newArt.id, nextCycleNum, newArt.content, newArt.version_id);
        StateManager.updateArtifactMetadata(newArt.id, newArt.type, newArt.description || `New ${newArt.type}`, nextCycleNum, checksum, critiqueSource, newArt.version_id, false, newArt.paradigm);
        changesMade.push(`Created: ${newArt.id}${newArt.version_id ? "#" + newArt.version_id : ""} (${newArt.type})`);
        UI.displayCycleArtifact(`New Artifact${newArt.version_id ? " (V: " + newArt.version_id + ")" : ""}`, Utils.trunc(newArt.content, 200), "output", true, critiqueSource, newArt.id, nextCycleNum);
      } catch (e) { errors.push(`Failed save new ${newArt.id}: ${e.message}`); }
    }
    for (const idToDelete of deleted || []) {
      const meta = StateManager.getArtifactMetadata(idToDelete);
      if (meta) {
        const allVersions = StateManager.getArtifactMetadataAllVersions(idToDelete);
        allVersions.forEach((v) => Storage.deleteArtifactVersion(idToDelete, v.latestCycle, v.version_id));
        StateManager.deleteArtifactMetadata(idToDelete);
        changesMade.push(`Deleted: ${idToDelete} (All versions)`);
        UI.displayCycleArtifact("Deleted Artifact (All Versions)", idToDelete, "output", true, critiqueSource);
      } else { errors.push(`Delete failed (not found): ${idToDelete}`); }
    }
    for (const modEdit of modular || []) {
      if (!modEdit.id || !modEdit.patch_content || !modEdit.patch_format) { errors.push(`Invalid modular edit structure: ID=${modEdit.id || "?"}`); continue; }
      UI.displayCycleArtifact(`Modular Edit Proposed${modEdit.version_id ? " (V: " + modEdit.version_id + ")" : ""}`, JSON.stringify(modEdit, null, 2), "info", true, critiqueSource, modEdit.id, nextCycleNum);
      try {
        const baseMeta = StateManager.getArtifactMetadata(modEdit.id);
        if (!baseMeta) throw new ArtifactError(`Base artifact not found: ${modEdit.id}`, modEdit.id);
        const baseContent = Storage.getArtifactContent(modEdit.id, baseMeta.latestCycle, baseMeta.version_id);
        if (baseContent === null) throw new ArtifactError(`Base content missing for ${modEdit.id}`, modEdit.id, baseMeta.latestCycle);
        let toolToRun = null; let toolArgs = { artifactId: modEdit.id, cycle: baseMeta.latestCycle, versionId: baseMeta.version_id, patchContent: modEdit.patch_content };
        if (modEdit.patch_format.toLowerCase() === "diff" || modEdit.patch_format.toLowerCase() === "unified-diff") toolToRun = "apply_diff_patch";
        else if (modEdit.patch_format.toLowerCase() === "json-patch" || modEdit.patch_format.toLowerCase() === "rfc6902") {
          toolToRun = "apply_json_patch"; try { toolArgs.patchContent = JSON.parse(modEdit.patch_content); } catch { toolArgs.patchContent = modEdit.patch_content; }
        } else if (modEdit.patch_format.toLowerCase() === "replace-function" || modEdit.patch_format.toLowerCase() === "replace-block") {
          toolToRun = "apply_block_replacement"; toolArgs.target_block = modEdit.target_block;
        } else throw new ToolError(`Unsupported patch format: ${modEdit.patch_format}`, "apply_modular_edit", toolArgs);
        const patchResult = await ToolRunner.runTool(toolToRun, toolArgs, loadedStaticTools, state.dynamicTools || [], {});
        if (!patchResult || !patchResult.success) throw new ToolError(`Patch tool '${toolToRun}' failed: ${patchResult?.error || "Unknown tool error"}`, toolToRun, toolArgs, patchResult);
        const patchedContent = patchResult.result_content;
        const checksum = await Utils.calculateChecksum(patchedContent);
        Storage.setArtifactContent(modEdit.id, nextCycleNum, patchedContent, modEdit.version_id);
        StateManager.updateArtifactMetadata(modEdit.id, baseMeta.type, baseMeta.description, nextCycleNum, checksum, critiqueSource, modEdit.version_id, true, baseMeta.paradigm);
        changesMade.push(`Modular Edit: ${modEdit.id}${modEdit.version_id ? "#" + modEdit.version_id : ""} (${modEdit.patch_format})`);
        UI.displayCycleArtifact(`Modular Edit Applied${modEdit.version_id ? " (V: " + modEdit.version_id + ")" : ""}`, Utils.trunc(patchedContent, 200), "output", true, critiqueSource, modEdit.id, nextCycleNum);
      } catch (e) { errors.push(`Failed apply modular edit ${modEdit.id}: ${e.message}`); UI.displayCycleArtifact(`Modular Edit Failed ${modEdit.id}`, e.message, "error", false, critiqueSource); }
    }
    return { requiresSandbox };
  };

  const _applyToolDefinitionChanges = (newTools, critiqueSource, state, changesMade, errors, currentCycleNum) => {
    (newTools || []).forEach((tool) => {
      const decl = tool.declaration; const impl = tool.implementation; const paradigm = tool.suggested_paradigm || "semi-pure";
      if (!decl || !impl || !decl.name || !decl.description || !decl.inputSchema) {
        errors.push(`Invalid new tool structure: Name=${decl?.name || "?"}`); UI.displayCycleArtifact("Invalid Tool Def", JSON.stringify(tool), "error", false, critiqueSource); return;
      }
      UI.displayCycleArtifact(`Proposed Tool Decl: ${decl.name}`, JSON.stringify(decl, null, 2), "output", true, critiqueSource);
      UI.displayCycleArtifact(`Generated Tool Impl: ${decl.name} (Paradigm: ${paradigm})`, impl, "output", true, critiqueSource);
      if (!impl.includes("async function run(params)") && !impl.includes("async (params)") && !impl.includes("run = async (params)")) {
        errors.push(`Generated tool implementation for ${decl.name} missing valid async run(params) function.`);
        UI.logToTimeline(currentCycleNum, `[APPLY ERR] Tool impl ${decl.name} invalid structure.`, "error", true);
      } else {
        StateManager.updateAndSaveState(s => {
            const dynamicTools = s.dynamicTools || [];
            const existingIndex = dynamicTools.findIndex((t) => t.declaration.name === decl.name);
            const toolEntry = { declaration: decl, implementation: impl, paradigm: paradigm };
            let toolChangeType = "";
            if (existingIndex !== -1) { dynamicTools[existingIndex] = toolEntry; toolChangeType = `Tool Updated: ${decl.name}`; }
            else { dynamicTools.push(toolEntry); toolChangeType = `Tool Defined: ${decl.name}`; }
            s.dynamicTools = dynamicTools;
            changesMade.push(toolChangeType);
            UI.logToTimeline(currentCycleNum, `[ARTIFACT] ${toolChangeType}`, "info", true);
            return s;
        });
      }
    });
  };

  const _applyLLMChanges = async (llmResp, currentCycleNum, critiqueSource) => {
    UI.highlightCoreStep(6);
    let state = StateManager.getState();
    if (!state) return { success: false, errors: ["State not initialized"], nextCycle: currentCycleNum, requiresSandbox: false, changes: [] };
    let changesMade = []; let errors = [];
    currentLlmResponse = llmResp;
    const nextCycleNum = currentCycleNum + 1;
    const { requiresSandbox } = await _applyArtifactChanges(llmResp.artifact_changes, nextCycleNum, critiqueSource, state, changesMade, errors);
    _applyToolDefinitionChanges(llmResp.proposed_new_tools, critiqueSource, state, changesMade, errors, currentCycleNum); // state is passed for read, changes are applied via StateManager.updateAndSaveState inside
    
    state = StateManager.getState(); // Re-fetch state as _applyToolDefinitionChanges might have updated it
    const success = errors.length === 0;
    if (success) {
        StateManager.updateAndSaveState(s => {
            if (!requiresSandbox) { s.totalCycles = nextCycleNum; s.agentIterations++; }
            const confidence = llmResp.agent_confidence_score ?? 0.0;
            s.confidenceHistory.push(confidence);
            if (s.confidenceHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.confidenceHistory.shift();
            return s;
        });
    } else {
        StateManager.updateAndSaveState(s => {
            s.failCount = (s.failCount || 0) + 1;
            s.failHistory = s.failHistory || [];
            s.failHistory.push({ cycle: currentCycleNum, reason: `Apply Error: ${errors.join(", ")}` });
            if (s.failHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.failHistory.shift();
            return s;
        });
    }
    const targetArtifactChanged = changesMade.some((c) => c.includes("target.") || c.includes("reploid.") || c.includes("Full HTML") || c.includes("Page Composition"));
    if (targetArtifactChanged && success && !requiresSandbox) UI.logToTimeline(currentCycleNum, `[APPLY] Applying changes for Cycle ${nextCycleNum}.`, "info", true);
    UI.logToTimeline(currentCycleNum, `[APPLY] Changes applied for Cycle ${nextCycleNum} from ${critiqueSource}: ${changesMade.join(", ") || "None"}. Errors: ${errors.length}`, errors.length > 0 ? "warn" : "info", true);
    return { success: success, changes: changesMade, errors: errors, nextCycle: success && !requiresSandbox ? nextCycleNum : currentCycleNum, requiresSandbox: requiresSandbox };
  };
  
  const _checkHitlTriggersContext = (state, cycleTimeSecs, confidence, currentCycle, llmResponse) => {
      const proposedCoreChanges = state.cfg?.hitlOnMetaChanges === true && llmResponse?.response && getActiveGoalInfo().type === "Meta" && (
          llmResponse.response.artifact_changes?.modified?.some(a => a.id.startsWith("reploid.core.") && StateManager.getArtifactMetadata(a.id)?.paradigm?.startsWith("boundary")) ||
          llmResponse.response.artifact_changes?.new?.some(a => a.id.startsWith("reploid.core.") && a.paradigm?.startsWith("boundary")) ||
          llmResponse.response.artifact_changes?.deleted?.some(id => id.startsWith("reploid.core.") && StateManager.getArtifactMetadata(id)?.paradigm?.startsWith("boundary")) ||
          llmResponse.response.artifact_changes?.modular?.some(a => a.id.startsWith("reploid.core.") && StateManager.getArtifactMetadata(a.id)?.paradigm?.startsWith("boundary")) ||
          llmResponse.response.artifact_changes?.full_html_source || llmResponse.response.artifact_changes?.page_composition ||
          llmResponse.response.tool_calls?.some(tc => tc.name === "define_web_component" && tc.arguments?.targetArtifactId?.startsWith("reploid.core."))
      );

      return AgentLogicPureHelpers.checkHitlTriggersPure(
          currentCycle, state.cfg?.pauseAfterCycles || 0, (state.cfg?.humanReviewProb ?? 0) / 100.0,
          cycleTimeSecs, state.cfg?.maxCycleTime ?? 600, confidence, state.cfg?.autoCritiqueThresh ?? 0.75,
          state.forceHumanReview, getActiveGoalInfo().type, state.cfg?.hitlOnMetaChanges === true, proposedCoreChanges
      );
  };

  const _performCritique = async (state, llmResponse, goalInfo, currentCycle) => {
    const llmProb = (state.cfg?.llmCritiqueProb ?? 50) / 100.0;
    let overallPassed = false; let combinedReport = "Critique Skipped"; let applySource = "Skipped"; let allCritiques = [];

    if (Math.random() < llmProb) {
      UI.logToTimeline(currentCycle, "[DECIDE] Triggering Auto Critique...", "decide", true); UI.logCoreLoopStep(currentCycle, 5, "Critique: Auto");
      const multiCritiqueResult = await _runAutoCritique(state.apiKey, llmResponse.response, goalInfo, currentCycle);
      allCritiques = multiCritiqueResult.critiques; overallPassed = multiCritiqueResult.overall_passed; combinedReport = multiCritiqueResult.combined_report;
      applySource = `AutoCrit (${allCritiques.length} runs) ${overallPassed ? "Pass" : "Fail"}`;
      StateManager.updateAndSaveState(s => {
          s.lastCritiqueType = `Automated (${overallPassed ? "Pass" : "Fail"})`;
          if (s.critiqueFailHistory) s.critiqueFailHistory.push(!overallPassed);
          if (s.critiqueFailHistory?.length > (config.MAX_HISTORY_ITEMS || 20)) s.critiqueFailHistory.shift();
          return s;
      });
      UI.displayCycleArtifact("Auto Critique Combined Report", combinedReport, overallPassed ? "info" : "error", false, "LLM", "critique.combined_report", currentCycle);
    } else {
      overallPassed = true; applySource = "Critique Skipped";
      StateManager.updateAndSaveState(s => {
          s.lastCritiqueType = "Skipped";
          if (s.critiqueFailHistory) s.critiqueFailHistory.push(false);
          if (s.critiqueFailHistory?.length > (config.MAX_HISTORY_ITEMS || 20)) s.critiqueFailHistory.shift();
          return s;
      });
      UI.logCoreLoopStep(currentCycle, 5, "Critique: Skipped"); UI.logToTimeline(currentCycle, "[DECIDE] Critique Skipped.", "info", true);
    }
    return { critiquePassed: overallPassed, critiqueReport: combinedReport, applySource: applySource, critiques: allCritiques };
  };

  const _handleCritiqueDecision = async (state, llmResponse, goalInfo, currentCycle) => {
    UI.highlightCoreStep(4);
    const cycleTimeMillis = llmResponse.cycleTimeMillis || 0; const cycleSecs = cycleTimeMillis / 1000;
    const confidence = llmResponse.response?.agent_confidence_score ?? 0.0;
    const hitlTrigger = _checkHitlTriggersContext(state, cycleSecs, confidence, currentCycle, llmResponse);
    UI.logToTimeline(currentCycle, `[DECIDE] Time:${cycleSecs.toFixed(1)}s, Conf:${confidence.toFixed(2)}. Human: ${hitlTrigger ? hitlTrigger.reason : "No"}.`, "decide", true);
    if (hitlTrigger) {
      StateManager.updateAndSaveState(s => {
          s.lastCritiqueType = `Human (${hitlTrigger.reason})`; s.forceHumanReview = false;
          if (s.critiqueFailHistory) s.critiqueFailHistory.push(false);
          if (s.critiqueFailHistory?.length > (config.MAX_HISTORY_ITEMS || 20)) s.critiqueFailHistory.shift();
          return s;
      });
      UI.logCoreLoopStep(currentCycle, 5, `Critique: Human Intervention (${hitlTrigger.reason})`); UI.updateStatus(`Paused: Human Review (${hitlTrigger.reason})`);
      const primaryModId = llmResponse.response?.artifact_changes?.modified?.[0]?.id; const primaryNewId = llmResponse.response?.artifact_changes?.new?.[0]?.id;
      const primaryModularId = llmResponse.response?.artifact_changes?.modular?.[0]?.id;
      const hasFullSource = !!llmResponse.response?.artifact_changes?.full_html_source || !!llmResponse.response?.artifact_changes?.page_composition;
      const artifactToEdit = primaryModId || primaryNewId || primaryModularId || (hasFullSource ? (llmResponse.response.artifact_changes.page_composition ? "page_composition_preview" : "full_html_source") : null);
      UI.showHumanInterventionUI(hitlTrigger.mode, hitlTrigger.reason, [], artifactToEdit, []);
      return { status: "HITL_REQUIRED", critiquePassed: false, critiqueReport: `Human Intervention: ${hitlTrigger.reason}` };
    }
    const critiqueResult = await _performCritique(state, llmResponse, goalInfo, currentCycle);
    if (!critiqueResult.critiquePassed) {
      UI.logToTimeline(currentCycle, "[STATE] Auto-Critique failed. Forcing HITL.", "warn", true);
      StateManager.updateAndSaveState(s => {
          s.failCount = (s.failCount || 0) + 1; s.failHistory = s.failHistory || [];
          s.failHistory.push({ cycle: currentCycle, reason: `Critique Failed: ${Utils.trunc(critiqueResult.critiqueReport, 100)}` });
          if (s.failHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.failHistory.shift();
          return s;
      });
      UI.showHumanInterventionUI("critique_feedback", `Auto Critique Failed: ${Utils.trunc(critiqueResult.critiqueReport, 150)}...`, [], null, critiqueResult.critiques);
      return { status: "HITL_REQUIRED", critiquePassed: false, critiqueReport: critiqueResult.critiqueReport };
    }
    return { status: "PROCEED", critiquePassed: critiqueResult.critiquePassed, critiqueReport: critiqueResult.critiqueReport, applySource: critiqueResult.applySource };
  };

  const _runSelfEvaluationStep = async (state, llmResponse, currentCycle) => {
    UI.highlightCoreStep(7); if (!llmResponse?.response) return;
    const contentToEvaluate = llmResponse.response.justification_persona_musing || "(No justification provided)";
    if (contentToEvaluate === "(No justification provided)") {
      logger.logEvent("info", `Skipping self-evaluation for Cycle ${currentCycle}: No justification provided.`);
      UI.logToTimeline(currentCycle, "[EVAL] Skipped (no justification).", "info", true); return;
    }
    logger.logEvent("info", `Running Self-Evaluation for Cycle ${currentCycle} justification`); UI.logToTimeline(currentCycle, "[EVAL] Evaluating cycle justification...", "eval", true);
    let evaluationCriteria = Storage.getArtifactContent("reploid.core.default-eval", 0);
    if (!evaluationCriteria) {
      logger.logEvent("warn", "Default evaluation criteria artifact (reploid.core.default-eval) not found. Using basic criteria.");
      evaluationCriteria = "Evaluate if the justification accurately reflects the proposed changes and aligns with the goal context. Rate clarity and reasoning.";
    }
    let evalCriteriaText = evaluationCriteria;
    try { const parsedCriteria = JSON.parse(evaluationCriteria); if (parsedCriteria.criteria && typeof parsedCriteria.criteria === "string") evalCriteriaText = parsedCriteria.criteria; else if (parsedCriteria.criteria && Array.isArray(parsedCriteria.criteria)) evalCriteriaText = JSON.stringify(parsedCriteria.criteria); } catch (e) {}
    const goalContext = getActiveGoalInfo().cumulativeGoal || getActiveGoalInfo().summaryContext || "N/A";
    const targetArtifactId = "llm.justification"; const targetArtifactCycle = currentCycle;
    try {
      const uiHooks = { updateStatus: UI.updateStatus, logTimeline: UI.logToTimeline, updateTimelineItem: UI.updateTimelineItem };
      const evalResult = await ToolRunner.runTool("run_self_evaluation", { targetArtifactId, targetArtifactCycle, evalCriteriaText, goalContextText: goalContext, contentToEvaluate }, loadedStaticTools, state.dynamicTools || [], uiHooks);
      StateManager.addEvaluationResult(evalResult);
      UI.logToTimeline(currentCycle, `[EVAL OK] Score: ${evalResult.evaluation_score.toFixed(2)}. Report: ${Utils.trunc(evalResult.evaluation_report, 60)}`, "eval", true);
      UI.displayCycleArtifact("Self-Evaluation Result", JSON.stringify(evalResult, null, 2), "info", false, "System", "eval.result", currentCycle);
    } catch (e) {
      logger.logEvent("error", `Self-evaluation step failed: ${e.message}`, e); UI.logToTimeline(currentCycle, `[EVAL ERR] Failed: ${e.message}`, "error", true);
    }
    UI.logToTimeline(currentCycle, "[LEARN] Learning phase placeholder.", "learn", true);
  };

  const _prepareCycle = () => {
    const state = StateManager.getState(); if (!state) throw new StateError("State not initialized!");
    if (!StateManager.isInitialized()) throw new StateError("StateManager lost initialization!");
    if (UI.isMetaSandboxPending()) { UI.showNotification("Meta Sandbox approval pending.", "warn"); throw new StateError("Sandbox Pending"); }
    if (!UI.isHumanInterventionHidden()) { UI.showNotification("Human Intervention required.", "warn"); throw new StateError("HITL Required"); }
    UI.clearCurrentCycleDetails(); currentLlmResponse = null; _abortRequested = false;
    const uiRefs = UI.getRefs();
    let updatedState = StateManager.updateAndSaveState(s => { s.apiKey = uiRefs.apiKeyInput?.value.trim() || s.apiKey; return s;});
    if (!updatedState.apiKey || updatedState.apiKey.length < 10) throw new ConfigError("Valid Gemini API Key required.", "apiKey");
    UI.logCoreLoopStep(updatedState.totalCycles, 0, "Define Goal");
    const goalText = uiRefs.goalInput?.value.trim() || "";
    const goalTypeElement = document.querySelector('input[name="goalType"]:checked');
    const goalType = goalTypeElement ? goalTypeElement.value : "System";
    if (!goalText && !updatedState.currentGoal?.seed) throw new ApplicationError("Initial Goal required.");
    const maxC = updatedState.cfg?.maxCycles || 0;
    if (maxC > 0 && updatedState.totalCycles >= maxC && updatedState.autonomyMode !== "Manual") throw new StateError(`Max cycles (${maxC}) reached.`);
    if (updatedState.autonomyMode === "N_Cycles" && updatedState.autonomyCyclesRemaining <= 0) {
      logger.logEvent("info", "Autonomous run finished (N cycles complete). Switching to Manual.");
      updatedState = StateManager.updateAndSaveState(s => { s.autonomyMode = "Manual"; return s; });
      _isAutonomous = false; UI.updateAutonomyControls(updatedState.autonomyMode, false);
      throw new StateError("Autonomy N Cycles Finished");
    }
    if (updatedState.autonomyMode !== "Manual") {
      _isAutonomous = true;
      if (updatedState.autonomyMode === "N_Cycles") updatedState = StateManager.updateAndSaveState(s => { s.autonomyCyclesRemaining--; return s; });
    } else { _isAutonomous = false; }
    if (updatedState.contextTokenEstimate >= updatedState.contextTokenTarget) UI.showNotification("Context tokens high. Consider summarizing.", "warn");
    const currentCycle = updatedState.totalCycles;
    const newGoalProvided = !!goalText;
    if (newGoalProvided) {
        updatedState = StateManager.updateAndSaveState(s => {
            if (!s.currentGoal?.seed) s.currentGoal = { seed: goalText, cumulative: goalText, latestType: goalType, summaryContext: null, currentContextFocus: null };
            else {
                s.currentGoal.cumulative = (s.currentGoal.cumulative || s.currentGoal.seed || "") + `\n\n[Cycle ${currentCycle} Refinement (${goalType})]: ${goalText}`;
                s.currentGoal.latestType = goalType; s.currentGoal.summaryContext = null; s.currentGoal.currentContextFocus = null;
            }
            return s;
        });
      UI.displayCycleArtifact("New Goal Input", `${goalType}: ${goalText}`, "input", false, "User", "goal.input", currentCycle);
      if (uiRefs.goalInput) uiRefs.goalInput.value = "";
    } else if (!updatedState.currentGoal?.seed && !updatedState.currentGoal?.cumulative) throw new ApplicationError("No active goal context.");
    const goalInfo = getActiveGoalInfo(); // Uses the latest state from StateManager
    updatedState = StateManager.updateAndSaveState(s => { s.retryCount = 0; s.personaMode = (s.cfg?.personaBalance ?? 50) >= 50 ? "LSD" : "XYZ"; return s; });
    UI.updateStatus("Starting Cycle...", true); if (uiRefs.currentCycleNumber) uiRefs.currentCycleNumber.textContent = currentCycle;
    UI.updateStateDisplay(); UI.logToTimeline(currentCycle, `[CYCLE] === Cycle ${currentCycle} Start === Goal: ${goalInfo.type}, Persona: ${updatedState.personaMode}, Auto: ${updatedState.autonomyMode}`);
    UI.logToTimeline(currentCycle, `[GOAL] Latest: "${Utils.trunc(goalInfo.latestGoal, 70)}..."`, "goal", true);
    UI.displayCycleArtifact("Cumulative Goal", goalInfo.cumulativeGoal || "(Not Set)", "input", false, "System", "goal.cumulative", currentCycle);
    if (goalInfo.summaryContext) UI.displayCycleArtifact("Summary Context", goalInfo.summaryContext, "input", false, "System", "meta.summary_context", currentCycle);
    if (goalInfo.currentContextFocus) UI.displayCycleArtifact("Context Focus", goalInfo.currentContextFocus, "input", false, "LLM", "meta.context_focus", currentCycle);
    return { state: updatedState, goalInfo, currentCycle };
  };

  const _handleCycleIterationFailure = async (state, error, currentCycle) => {
    if (error instanceof AbortError || _abortRequested) throw new AbortError("Aborted during iteration failure handling.");
    logger.logEvent("error", `Iteration attempt ${state.retryCount} failed: ${error.message}`);
    let updatedState = StateManager.updateAndSaveState(s => { s.retryCount++; return s; });
    const maxRetries = updatedState.cfg?.maxRetries ?? 1;
    if (updatedState.retryCount > maxRetries) {
      UI.logToTimeline(currentCycle, `[RETRY] Max retries (${maxRetries}) exceeded. Forcing HITL.`, "error");
      StateManager.updateAndSaveState(s => {
          s.failCount = (s.failCount || 0) + 1; s.failHistory = s.failHistory || [];
          s.failHistory.push({ cycle: currentCycle, reason: `Max Retries: ${error.message || "Unknown error"}` });
          if (s.failHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.failHistory.shift();
          return s;
      });
      if (_isAutonomous) { logger.logEvent("warn", "Stopping autonomous run due to max retries."); stopAutonomousRun("Max retries reached"); }
      UI.showHumanInterventionUI("prompt", `Cycle failed after ${updatedState.retryCount} attempts: ${error.message || "Unknown error"}`);
      throw new StateError("HITL Required due to max retries");
    } else {
      UI.logToTimeline(currentCycle, `[RETRY] Attempting retry ${updatedState.retryCount}/${maxRetries}...`, "warn", true);
      StateManager.updateAndSaveState(s => { s.lastFeedback = `Retry ${s.retryCount}: ${Utils.trunc(error.message, 100) || "No response"}`; return s; });
      await Utils.delay(1000 * updatedState.retryCount);
    }
  };

  const _displayLlmIterationSuccessDetails = (llmIterationResult, currentCycle) => {
    UI.logToTimeline(currentCycle, "[STATE] Agent Iteration successful.", "info", true); UI.highlightCoreStep(3);
    if (llmIterationResult.toolSummaries && llmIterationResult.toolSummaries.length > 0) UI.displayToolExecutionSummary(llmIterationResult.toolSummaries);
    UI.displayCycleArtifact("Agent Deliberation", llmIterationResult.response?.persona_analysis_musing || "(N/A)", "info", false, "LLM", "llm.musing", currentCycle);
    UI.displayCycleArtifact("Proposed Changes", llmIterationResult.response?.proposed_changes_description || "(N/A)", "info", false, "LLM", "llm.proposal", currentCycle);
    UI.displayCycleArtifact("Agent Justification", llmIterationResult.response?.justification_persona_musing || "(N/A)", "info", false, "LLM", "llm.justification", currentCycle);
    UI.displayCycleArtifact("Agent Confidence", llmIterationResult.response?.agent_confidence_score?.toFixed(3) || "(N/A)", "info", false, "LLM", "llm.confidence", currentCycle);
    if (llmIterationResult.response?.current_context_focus) UI.displayCycleArtifact("Next Context Focus", llmIterationResult.response.current_context_focus, "info", false, "LLM", "llm.context_focus", currentCycle);
  };

  const _handleApplyFailure = (applyResult, critiqueDecision, currentCycle) => {
    const errorReason = `Apply Failed: ${applyResult.errors.join(", ")}`;
    StateManager.updateAndSaveState(s => {
        s.lastFeedback = `${critiqueDecision.applySource}, ${errorReason}`; s.failCount = (s.failCount || 0) + 1;
        s.failHistory = s.failHistory || []; s.failHistory.push({ cycle: currentCycle, reason: errorReason });
        if (s.failHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.failHistory.shift();
        return s;
    });
    UI.logToTimeline(currentCycle, `[APPLY ERR] Failed apply: ${applyResult.errors.join(", ")}. Forcing HITL.`, "error");
    if (_isAutonomous) { logger.logEvent("warn", "Stopping autonomous run due to apply failure."); stopAutonomousRun("Apply failure"); }
    UI.showHumanInterventionUI("prompt", `Failed apply after critique: ${applyResult.errors.join(", ")}`);
    throw new StateError("HITL Required due to apply failure");
  };

  const executeCycle = async () => {
    if (_isRunning && !_isAutonomous) { UI.showNotification("Manual cycle start ignored: Cycle already running.", "warn"); return; }
    if (_abortRequested) {
      logger.logEvent("info", "Cycle execution skipped due to pending abort request.");
      _abortRequested = false; _isRunning = false; if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false); return;
    }
    _isRunning = true; if (UI.setRunButtonState) UI.setRunButtonState("Abort Cycle", false);
    let state, goalInfo, currentCycle; let cycleOutcome = "Unknown"; let llmIterationResult = null; let applyResult = null; let shouldContinueAutonomous = false;

    try {
      const prepResult = _prepareCycle(); state = prepResult.state; goalInfo = prepResult.goalInfo; currentCycle = prepResult.currentCycle;
      let successfulIteration = false;
      do {
        if (_abortRequested) throw new AbortError("Cycle aborted during LLM iteration loop.");
        UI.logToTimeline(currentCycle, `[STATE] Agent Iteration Attempt (Retry: ${state.retryCount})`, "info", true);
        llmIterationResult = await _runLlmIteration(state, goalInfo, currentCycle);
        if (llmIterationResult.error) {
          if (llmIterationResult.error instanceof AbortError) throw llmIterationResult.error;
          await _handleCycleIterationFailure(state, llmIterationResult.error, currentCycle);
          state = StateManager.getState(); // Re-fetch state after potential update in failure handler
        } else {
          successfulIteration = true; StateManager.updateAndSaveState(s => { s.retryCount = 0; return s; });
          _displayLlmIterationSuccessDetails(llmIterationResult, currentCycle);
        }
      } while (!successfulIteration);
      state = StateManager.getState(); // Ensure state is fresh before critique decision

      const critiqueDecision = await _handleCritiqueDecision(state, llmIterationResult, goalInfo, currentCycle);
      if (_abortRequested) throw new AbortError("Cycle aborted after critique decision.");
      if (critiqueDecision.status === "HITL_REQUIRED") {
        cycleOutcome = `Paused (HITL: ${Utils.trunc(critiqueDecision.critiqueReport.split(":")[0], 30)})`;
        if (_isAutonomous) stopAutonomousRun("HITL Required");
        throw new StateError("HITL Required");
      }

      if (critiqueDecision.critiquePassed) {
        UI.updateStatus("Applying Changes...", true); UI.logCoreLoopStep(currentCycle, 6, "Refine & Apply");
        applyResult = await _applyLLMChanges(llmIterationResult.response, currentCycle, critiqueDecision.applySource);
        if (_abortRequested) throw new AbortError("Cycle aborted during apply changes.");
        state = StateManager.getState(); // Re-fetch state

        if (applyResult.requiresSandbox) {
          StateManager.updateAndSaveState(s => { s.lastCritiqueType = `${critiqueDecision.applySource} (Sandbox Pending)`; return s; });
          if (_isAutonomous) stopAutonomousRun("Sandbox Required");
          UI.showMetaSandbox(state.lastGeneratedFullSource); cycleOutcome = "Paused (Sandbox Pending)";
          throw new StateError("Sandbox Pending");
        }
        if (applyResult.success) {
          StateManager.updateAndSaveState(s => { s.lastFeedback = `${critiqueDecision.applySource}, applied successfully for Cycle ${applyResult.nextCycle}.`; return s; });
          cycleOutcome = `OK (${state.lastCritiqueType})`;
          await _runSelfEvaluationStep(state, llmIterationResult, currentCycle);
          if (_abortRequested) throw new AbortError("Cycle aborted during self-evaluation.");
          UI.highlightCoreStep(8); shouldContinueAutonomous = _isAutonomous && !_abortRequested;
        } else _handleApplyFailure(applyResult, critiqueDecision, currentCycle);
      } else {
        logger.logEvent("error", "Reached unexpected state: critique failed but HITL not triggered."); cycleOutcome = "Failed (Critique Logic Error)";
        if (_isAutonomous) stopAutonomousRun("Critique Logic Error");
        throw new ApplicationError("Critique Failed without HITL trigger");
      }
    } catch (error) {
      const knownStopNames = [ "AbortError", "StateError", "ConfigError", "ApiError", "ToolError", "ArtifactError" ];
      const isKnownStopError = error instanceof ApplicationError && knownStopNames.includes(error.name);
      if (error instanceof AbortError) {
        UI.logToTimeline(currentCycle ?? 0, `[CYCLE] Cycle aborted by user/system. Reason: ${error.message}`, "warn");
        cycleOutcome = "Aborted"; UI.updateStatus("Aborted"); if (_isAutonomous) stopAutonomousRun("Aborted by user/system");
      } else if (isKnownStopError && (error.message.includes("HITL Required") || error.message.includes("Sandbox Pending"))) {
        logger.logEvent("info", `Cycle paused: ${error.message}`); if (!cycleOutcome || cycleOutcome === "Unknown") cycleOutcome = `Paused (${error.message})`;
      } else if (isKnownStopError && error.message.includes("Max cycles reached")) {
        logger.logEvent("info", `Cycle stopped: ${error.message}`); cycleOutcome = "Paused (Max Cycles Reached)"; if (_isAutonomous) stopAutonomousRun("Max cycles reached");
      } else {
        logger.logEvent("error", `Unhandled cycle error (Cycle ${currentCycle ?? "N/A"}): ${error.message}`, error.details || error);
        UI.showNotification(`Cycle Error: ${Utils.trunc(error.message, 100)}`, "error");
        UI.logToTimeline(currentCycle ?? 0, `[CYCLE FATAL] ${Utils.trunc(error.message, 100)}`, "error");
        cycleOutcome = "Failed (Fatal Error)"; UI.updateStatus("Cycle Failed", false, true); if (_isAutonomous) stopAutonomousRun("Fatal Error");
      }
      shouldContinueAutonomous = false;
    } finally {
      _isRunning = false; _abortRequested = false;
      if (!_isAutonomous || !shouldContinueAutonomous) { if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false); }
      state = StateManager.getState(); 
      if (state) {
        StateManager.updateAndSaveState(s => s); // This recalculates derived stats and saves
        if (!UI.isMetaSandboxPending() && UI.isHumanInterventionHidden()) {
          UI.summarizeCompletedCycleLog(cycleOutcome); UI.updateStateDisplay(); UI.clearCurrentCycleDetails();
          UI.logToTimeline(state.totalCycles, `[STATE] Cycle ended (${state.lastCritiqueType || cycleOutcome}). Ready.`); UI.updateStatus("Idle");
        } else { UI.updateStateDisplay(); }
      } else {
        UI.updateStatus("Error - State Lost?", false, true); logger.logEvent("critical", "Global state became null during cycle finally block.");
      }
      UI.highlightCoreStep(-1);
    }

    if (shouldContinueAutonomous) {
      state = StateManager.getState();
      logger.logEvent("info", `Autonomous mode active. Triggering next cycle. Remaining: ${state?.autonomyCyclesRemaining ?? "N/A"}`);
      await Utils.delay(config.AUTONOMOUS_CYCLE_DELAY_MS || 500);
      if (!_abortRequested) executeCycle();
      else {
        logger.logEvent("info", "Autonomous continuation cancelled due to abort request during delay.");
        if (_isAutonomous) stopAutonomousRun("Aborted during delay");
        else { _isRunning = false; if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false); }
      }
    } else if (_isAutonomous && cycleOutcome !== "Aborted") {
      logger.logEvent("info", `Autonomous run ended. Reason: ${cycleOutcome}`);
      stopAutonomousRun(cycleOutcome);
    }
  };

  const proceedAfterHumanIntervention = async (feedbackType, feedbackData = "", skipCycleIncrement = false) => {
    let state = StateManager.getState(); if (!state) { logger.logEvent("error", "Cannot proceed HITL, state missing."); return; }
    const currentCycle = state.totalCycles; let nextCycle = currentCycle; let feedbackMsg = String(feedbackData); let applySuccess = true; let requiresSandbox = false;

    if (feedbackType === "Human Code Edit") {
      const { artifactId, cycle, versionId, success, validatedContent, error, contentChanged } = feedbackData;
      feedbackMsg = `Edited ${artifactId}: ${ success ? (contentChanged ? "Applied successfully." : "No changes detected.") : `Validation Failed: ${error || "Unknown"}` }`;
      let isCodeEditSuccess = success && contentChanged;
      if (isCodeEditSuccess && artifactId !== "full_html_source" && artifactId !== "page_composition_preview") {
        nextCycle = currentCycle + 1;
        try {
          const checksum = await Utils.calculateChecksum(validatedContent);
          Storage.setArtifactContent(artifactId, nextCycle, validatedContent, versionId);
          const currentMeta = StateManager.getArtifactMetadata(artifactId, versionId);
          StateManager.updateArtifactMetadata(artifactId, currentMeta?.type, currentMeta?.description, nextCycle, checksum, "Human Edit", versionId, false, currentMeta?.paradigm);
          UI.displayCycleArtifact(`Human Edit Applied${versionId ? " (V: " + versionId + ")" : ""}`, validatedContent, "info", true, "Human", artifactId, nextCycle);
          logger.logEvent("info", `Human edit applied to ${artifactId} for cycle ${nextCycle}`);
          UI.logToTimeline(currentCycle, `[HUMAN] Applied edit to ${artifactId} for cycle ${nextCycle}`, "human", true);
        } catch (e) {
          logger.logEvent("error", `Failed saving human edit for ${artifactId}: ${e.message}`, e); UI.showNotification(`Failed saving edit: ${e.message}`, "error");
          applySuccess = false; nextCycle = currentCycle;
        }
      } else if ((artifactId === "full_html_source" || artifactId === "page_composition_preview") && isCodeEditSuccess) {
        logger.logEvent("warn", "Full source/Page Composition edited via HITL. Staging for sandbox.");
        StateManager.updateAndSaveState(s => { s.lastGeneratedFullSource = validatedContent; return s; });
        applySuccess = true; requiresSandbox = true; skipCycleIncrement = true; UI.showMetaSandbox(validatedContent);
      } else if (!success) applySuccess = false;
    } else if (feedbackType === "Human Options") { feedbackMsg = `Selected: ${feedbackData || "None"}`; applySuccess = true;
    } else if (feedbackType === "Sandbox Discarded") { feedbackMsg = "User discarded sandbox changes."; applySuccess = true;
    } else if (feedbackType === "Human Prompt") { feedbackMsg = `Provided prompt: ${Utils.trunc(feedbackData, 100)}`; applySuccess = true;
    } else if (feedbackType === "Human Critique Selection") {
      feedbackMsg = `User provided critique feedback. Selected: ${feedbackData?.selectedCritique ?? "N/A"}`;
      StateManager.addCritiqueFeedback(feedbackData); logger.logEvent("info", `Received critique feedback: ${JSON.stringify(feedbackData)}`); applySuccess = true;
    }
    
    state = StateManager.updateAndSaveState(s => {
        s.lastFeedback = `${feedbackType}: ${Utils.trunc(feedbackMsg, 150)}`;
        if (feedbackType.startsWith("Human")) { if (s.humanInterventions !== undefined) s.humanInterventions++; }
        if (applySuccess && !skipCycleIncrement) {
            s.totalCycles = nextCycle === currentCycle ? currentCycle + 1 : nextCycle;
            s.agentIterations++;
        } else if (!applySuccess) {
            s.failCount = (s.failCount || 0) + 1; s.failHistory = s.failHistory || [];
            s.failHistory.push({ cycle: currentCycle, reason: `HITL Apply Fail: ${feedbackType}` });
            if (s.failHistory.length > (config.MAX_HISTORY_ITEMS || 20)) s.failHistory.shift();
            s.totalCycles = currentCycle;
        }
        if (!skipCycleIncrement) {
            s.personaMode = (s.cfg?.personaBalance ?? 50) < 50 ? "XYZ" : "LSD";
            s.retryCount = 0;
        }
        return s;
    });

    const summaryOutcome = !applySuccess ? `Failed (${feedbackType})` : `OK (${feedbackType})`;
    UI.summarizeCompletedCycleLog(summaryOutcome); UI.logToTimeline(currentCycle, `[STATE] ${feedbackType} processed. Feedback: "${Utils.trunc(feedbackMsg, 70)}..."`, "state");
    UI.hideHumanInterventionUI();
    const uiRefs = UI.getRefs(); if (!skipCycleIncrement && uiRefs.goalInput) uiRefs.goalInput.value = "";
    UI.updateStatus(skipCycleIncrement ? "Meta Sandbox Pending..." : "Idle");
    if (!skipCycleIncrement) UI.clearCurrentCycleDetails();
    UI.updateStateDisplay(); UI.highlightCoreStep(-1);
  };

  const saveHtmlToHistory = (htmlContent) => {
    StateManager.updateAndSaveState(s => {
        const limit = s.cfg?.htmlHistoryLimit ?? 5;
        if (!s.htmlHistory) s.htmlHistory = [];
        s.htmlHistory.push(htmlContent);
        while (s.htmlHistory.length > limit) s.htmlHistory.shift();
        logger.logEvent("info", `Saved HTML state. History size: ${s.htmlHistory.length}`);
        UI.updateHtmlHistoryControls(s); // UI must be able to handle state directly
        return s;
    });
  };
  
  const _runSummarizationContext = async (apiKey, state, currentCycle) => {
    const template = Storage.getArtifactContent("reploid.core.summarizer-prompt", 0) || "";
    if (!template) throw new ArtifactError("Summarizer prompt not found.", "reploid.core.summarizer-prompt", 0);

    const stateSummary = {
      totalCycles: state.totalCycles, agentIterations: state.agentIterations, humanInterventions: state.humanInterventions, failCount: state.failCount,
      currentGoal: { seed: Utils.trunc(state.currentGoal?.seed, 200), cumulative: Utils.trunc(state.currentGoal?.cumulative, 500), latestType: state.currentGoal?.latestType, currentContextFocus: state.currentGoal?.currentContextFocus },
      lastCritiqueType: state.lastCritiqueType, lastFeedback: Utils.trunc(state.lastFeedback, 200),
      avgConfidence: state.avgConfidence?.toFixed(2), critiqueFailRate: state.critiqueFailRate?.toFixed(1),
      dynamicTools: (state.dynamicTools || []).map((t) => t.declaration.name),
      evaluationHistory: AgentLogicPureHelpers.summarizeHistoryPure(state.evaluationHistory, "Eval", 3, Utils.trunc),
    };
    const artifactListSummary = AgentLogicPureHelpers.getArtifactListSummaryPure(StateManager.getAllArtifactMetadata());
    const recentLogs = logger.getLogBuffer ? logger.getLogBuffer().split("\n").slice(-20).join("\n") : "N/A";
    
    const { prompt, error } = AgentLogicPureHelpers.assembleSummarizerPromptPure(template, stateSummary, recentLogs, artifactListSummary, Utils.trunc);
    if (error) throw new ApplicationError(error);
    
    const summarizerModelKey = state.cfg?.summarizerModel || "BASE";
    const summarizerModelIdentifier = config.DEFAULT_MODELS[summarizerModelKey.toUpperCase()] || summarizerModelKey;
    let summaryResultText = "";
    try {
      let accumulatedSummaryText = "";
      const apiResult = await ApiClient.callApiWithRetry(prompt, 'You are Summarizer x0. Output ONLY valid JSON: {"summary": "string"}', summarizerModelIdentifier, apiKey, [], false, null, 1, {},
        (msg, act, err) => UI.updateStatus(`Summarize: ${msg}`, act, err),
        (cyc, msg, type, sub, anim) => UI.logToTimeline(cyc, `[SUM] ${msg}`, type, sub, anim),
        UI.updateTimelineItem,
        (progress) => {
          if (progress.type === "text") accumulatedSummaryText += progress.content;
          summaryResultText = progress.accumulatedResult?.content || accumulatedSummaryText;
        }
      );
      if (!summaryResultText && apiResult?.content) summaryResultText = apiResult.content;
      const sanitized = ApiClient.sanitizeLlmJsonResp(summaryResultText); const parsed = JSON.parse(sanitized);
      if (typeof parsed.summary === "string") return parsed.summary;
      else throw new ApplicationError("Summarizer response missing 'summary' field.");
    } catch (e) {
      logger.logEvent("error", `Summarization LLM call failed: ${e.message}`, e); return null;
    }
  };

  const handleSummarizeContext = async () => {
    let state = StateManager.getState();
    if (!state || !state.apiKey) { UI.showNotification("API Key required for summarization.", "warn"); return; }
    if (_isRunning) { UI.showNotification("Cannot summarize context while cycle is running.", "warn"); return; }
    UI.updateStatus("Summarizing context...", true); UI.showNotification("Starting context summarization...", "info", 3000);
    const currentCycle = state.totalCycles; const nextCycle = currentCycle + 1;
    UI.logToTimeline(currentCycle, "[CONTEXT] Running summarization...", "context", true); UI.clearCurrentCycleDetails();
    try {
      const summaryText = await _runSummarizationContext(state.apiKey, state, currentCycle);
      if (summaryText === null) throw new ApplicationError("Summarization LLM call or parsing failed.");
      const checksum = await Utils.calculateChecksum(summaryText);
      Storage.setArtifactContent("meta.summary_context", nextCycle, summaryText);
      StateManager.updateArtifactMetadata("meta.summary_context", "TEXT", "Last Context Summary", nextCycle, checksum, "Summarizer", null, false, "data");
      StateManager.updateAndSaveState(s => {
          s.currentGoal = {
            seed: s.currentGoal?.seed,
            cumulative: `Context summarized up to Cycle ${currentCycle}. Original Seed: ${s.currentGoal?.seed || "None"}. New Summary:\n${summaryText}`,
            latestType: "Idle", summaryContext: summaryText, currentContextFocus: null,
          };
          s.contextTokenEstimate = Math.round((summaryText.length / 4) * 1.1) + 500;
          s.lastFeedback = `Context summarized at Cycle ${currentCycle}.`; s.lastCritiqueType = "Context Summary";
          s.totalCycles = nextCycle;
          return s;
      });
      UI.logToTimeline(currentCycle, `[CONTEXT] Summarized. Saved as meta.summary_context_${nextCycle}. Est. tokens: ${StateManager.getState().contextTokenEstimate.toLocaleString()}.`, "context");
      UI.displayCycleArtifact("Generated Context Summary", summaryText, "output", true, "System", "meta.summary_context", nextCycle);
      UI.showNotification("Context summarization complete.", "info", 5000);
    } catch (error) {
      logger.logEvent("error", `Summarization failed: ${error.message}`, error); UI.showNotification(`Summarization failed: ${error.message}`, "error");
      UI.logToTimeline(currentCycle, `[CONTEXT ERR] Summarization failed: ${error.message}`, "error");
    } finally {
      UI.updateStateDisplay(); UI.updateStatus("Idle");
    }
  };

  const abortCurrentCycle = () => {
    if (_isRunning) {
      logger.logEvent("info", "Abort request received."); _abortRequested = true; ApiClient.abortCurrentCall("User Abort Request");
      if (_isAutonomous) stopAutonomousRun("Aborted"); else UI.updateStatus("Aborting...");
    } else logger.logEvent("info", "Abort request ignored: No cycle running.");
  };

  const startAutonomousRun = (mode = "Continuous", cycles = 0) => {
    if (_isRunning) { UI.showNotification("Cannot start autonomous run: Cycle already in progress.", "warn"); return; }
    let state = StateManager.getState(); if (!state) { UI.showNotification("Cannot start autonomous run: State not loaded.", "error"); return; }
    if (mode === "N_Cycles" && (!cycles || cycles <= 0)) { UI.showNotification("Cannot start N_Cycles run: Invalid number of cycles specified.", "warn"); return; }
    logger.logEvent("info", `Starting autonomous run. Mode: ${mode}, Cycles: ${cycles}`);
    StateManager.updateAndSaveState(s => {
        s.autonomyMode = mode; s.autonomyCyclesRemaining = mode === "N_Cycles" ? cycles : Infinity; return s;
    });
    _isAutonomous = true; _abortRequested = false;
    UI.updateAutonomyControls(mode, true); UI.updateStatus(`Autonomous Run (${mode}) Started...`);
    executeCycle();
  };

  const stopAutonomousRun = (reason = "User Stop Request") => {
    logger.logEvent("info", `Stopping autonomous run. Reason: ${reason}`); _abortRequested = true; _isAutonomous = false;
    StateManager.updateAndSaveState(s => { s.autonomyMode = "Manual"; s.autonomyCyclesRemaining = 0; return s; });
    UI.updateAutonomyControls("Manual", false); UI.updateStatus(`Autonomous Run Stopped (${reason})`);
    if (_isRunning) { if (UI.setRunButtonState) UI.setRunButtonState("Run Cycle", false); _isRunning = false; }
  };

  const runTool = async (toolName, args) => {
    const state = StateManager.getState(); if (!state) throw new StateError("Cannot run tool, state not available.");
    const fallbackUiHooks = { updateStatus: () => {}, logTimeline: () => ({}), updateTimelineItem: () => {} };
    return await ToolRunner.runTool(toolName, args, loadedStaticTools, state.dynamicTools || [], fallbackUiHooks);
  };

  return {
    init, executeCycle, isRunning, isAutonomous, getActiveGoalInfo,
    proceedAfterHumanIntervention, handleSummarizeContext, abortCurrentCycle,
    saveHtmlToHistory, runTool, startAutonomousRun, stopAutonomousRun,
  };
};
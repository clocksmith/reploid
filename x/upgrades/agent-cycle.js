const CycleLogicModule = (
  config,
  logger,
  Utils,
  Storage,
  StateManager,
  UI,
  ApiClient,
  ToolRunner,
  Errors,
  AgentLogicPureHelpers
) => {
  if (
    !config ||
    !logger ||
    !Utils ||
    !Storage ||
    !StateManager ||
    !UI ||
    !ApiClient ||
    !ToolRunner ||
    !Errors ||
    !AgentLogicPureHelpers
  ) {
    // Basic fallback for when dependencies are not met
    const internalLog = logger || console;
    internalLog.error("CycleLogicModule initialization failed: Missing dependencies.");
    return {
        executeCycle: () => Promise.reject(new Error("CycleLogic not initialized.")),
        isRunning: () => false,
        isAutonomous: () => false,
        // Add other methods with dummy implementations if needed
    };
  }

  const {
    ApplicationError,
    ApiError,
    ToolError,
    StateError,
    ConfigError,
    ArtifactError,
    AbortError,
  } = Errors;
  let _isRunning = false;
  let _abortRequested = false;

  const getActiveGoalInfo = () => {
    const state = StateManager.getState();
    if (!state || !state.currentGoal) return { latestGoal: "Idle", type: "Idle" };
    return {
      latestGoal: state.currentGoal.cumulative || state.currentGoal.seed,
      type: state.currentGoal.latestType || "System",
    };
  };

  const _assembleCorePromptContext = (state, goalInfo, currentCycle) => {
    const corePromptTemplate = Storage.getArtifactContent("/modules/prompt-system.md");
    if (!corePromptTemplate) {
        throw new ArtifactError("Core prompt artifact '/modules/prompt-system.md' not found!");
    }

    const artifactListSummary = AgentLogicPureHelpers.getArtifactListSummaryPure(StateManager.getAllArtifactMetadata());
    const toolList = JSON.parse(Storage.getArtifactContent("/modules/data-tools-static.json") || "[]");
    const toolListSummary = AgentLogicPureHelpers.getToolListSummaryPure(toolList, state?.dynamicTools || [], Utils.trunc);

    const { prompt, error } = AgentLogicPureHelpers.assembleCorePromptPure(
      corePromptTemplate,
      state,
      goalInfo,
      artifactListSummary,
      toolListSummary
    );

    if (error) throw new ApplicationError(error);

    UI.displayCycleArtifact("LLM Input Prompt", prompt, "input", "System", `prompt.core.${currentCycle}`);
    return prompt;
  };

  const _handleToolExecution = async (toolCall, state, currentCycle) => {
    const { name: toolName, arguments: toolArgs } = toolCall;
    UI.updateStatus(`Running Tool: ${toolName}...`);
    UI.displayCycleArtifact(`Tool Call: ${toolName}`, JSON.stringify(toolArgs, null, 2), "info", "LLM", `tool.call.${toolName}`);
    
    let toolResult;
    try {
        const staticTools = JSON.parse(Storage.getArtifactContent("/modules/data-tools-static.json") || "[]");
        toolResult = await ToolRunner.runTool(toolName, toolArgs, staticTools, state.dynamicTools || []);
        UI.displayCycleArtifact(`Tool Response: ${toolName}`, JSON.stringify(toolResult, null, 2), "output", "Tool", `tool.response.${toolName}`);
        return { role: "function", parts: [{ functionResponse: { name: toolName, response: { content: JSON.stringify(toolResult) } } }] };
    } catch (e) {
        logger.error(`Tool Execution Error (${toolName}): ${e.message}`, e);
        UI.displayCycleArtifact(`Tool Error: ${toolName}`, e.message, "error", "Tool", `tool.error.${toolName}`);
        return { role: "function", parts: [{ functionResponse: { name: toolName, response: { error: `Tool failed: ${e.message}` } } }] };
    }
  };
  
   const _executeLlmApiCallSequence = async (prompt, state, currentCycle) => {
        let apiHistory = [{ role: "user", parts: [{ text: prompt }] }];
        let finalResult = null;

        for (let i = 0; i < 5; i++) { // Max 5 tool calls
            if (_abortRequested) throw new AbortError("API sequence aborted.");

            const staticTools = JSON.parse(Storage.getArtifactContent("/modules/data-tools-static.json") || "[]");
            const funcDeclarations = staticTools.map(t => ToolRunner.convertToGeminiFunctionDeclaration(t));

            const apiResult = await ApiClient.callApiWithRetry(
                apiHistory,
                state.apiKey,
                funcDeclarations
            );

            apiHistory.push(apiResult.rawResp.candidates[0].content);

            if (apiResult.type === "functionCall") {
                const toolResponse = await _handleToolExecution(apiResult.content, state, currentCycle);
                apiHistory.push(toolResponse);
                continue; // Loop for next API call
            }
            
            finalResult = apiResult;
            break; // End of sequence
        }
        return finalResult;
    };


  const _applyLLMChanges = async (llmResp, currentCycleNum) => {
    const changesMade = [];
    const errors = [];
    const { artifact_changes } = llmResp;
    
    if (artifact_changes) {
        if (artifact_changes.new) {
            for (const newArt of artifact_changes.new) {
                try {
                    await StateManager.createArtifact(newArt.id, newArt.type, newArt.content, newArt.description);
                    changesMade.push(`Created: ${newArt.id}`);
                } catch (e) { errors.push(`Failed to create ${newArt.id}: ${e.message}`); }
            }
        }
        if (artifact_changes.modified) {
            for (const modArt of artifact_changes.modified) {
                 try {
                    await StateManager.updateArtifact(modArt.id, modArt.content);
                    changesMade.push(`Modified: ${modArt.id}`);
                } catch (e) { errors.push(`Failed to modify ${modArt.id}: ${e.message}`); }
            }
        }
        if (artifact_changes.deleted) {
            for (const delId of artifact_changes.deleted) {
                try {
                    await StateManager.deleteArtifact(delId);
                    changesMade.push(`Deleted: ${delId}`);
                } catch (e) { errors.push(`Failed to delete ${delId}: ${e.message}`); }
            }
        }
    }
    
    if (errors.length > 0) {
        logger.error("Errors applying changes:", errors.join('\n'));
        throw new ApplicationError("Failed to apply all LLM changes.", { errors });
    }

    StateManager.incrementCycle();
    logger.logEvent("info", "LLM changes applied successfully.", changesMade);
    return { success: true, changes: changesMade };
  };

  const _checkHitlTriggers = (state) => {
    // Primordial agent has a very simple HITL trigger.
    // E.g. 10% chance for random review.
    if (Math.random() < 0.10) {
        return { reason: "Random quality check." };
    }
    return null;
  };

  const executeCycle = async () => {
    if (_isRunning) return;
    _isRunning = true;
    _abortRequested = false;
    UI.setRunButtonState("Abort Cycle", false);

    const state = StateManager.getState();
    const currentCycle = state.totalCycles;
    UI.clearCurrentCycleDetails();
    UI.logToTimeline(currentCycle, `--- Cycle ${currentCycle} Start ---`);

    try {
        const goalInfo = getActiveGoalInfo();
        UI.logToTimeline(currentCycle, `Goal: ${Utils.trunc(goalInfo.latestGoal, 80)}`, "goal");

        // 1. THINK
        const prompt = _assembleCorePromptContext(state, goalInfo, currentCycle);
        const llmResult = await _executeLlmApiCallSequence(prompt, state, currentCycle);
        if (!llmResult) throw new Error("LLM did not return a final text response.");

        UI.displayCycleArtifact("LLM Final Output", llmResult.content, "output", "LLM", `llm.final.${currentCycle}`);
        const parsedResp = JSON.parse(ApiClient.sanitizeLlmJsonResp(llmResult.content));
        UI.displayCycleArtifact("LLM Proposal", parsedResp.proposed_changes_description, "info", "LLM", `llm.proposal.${currentCycle}`);

        // 2. CRITIQUE (Simplified)
        const hitlTrigger = _checkHitlTriggers(state);
        if (hitlTrigger) {
            UI.showHumanInterventionUI("prompt", hitlTrigger.reason);
            // This would halt the cycle in a real implementation
            throw new StateError("HITL Required: " + hitlTrigger.reason);
        }

        // 3. APPLY
        await _applyLLMChanges(parsedResp, currentCycle);
        UI.logToTimeline(currentCycle, `--- Cycle ${currentCycle} Complete ---`, "finish");

    } catch (error) {
        if (error instanceof AbortError) {
            UI.logToTimeline(currentCycle, "Cycle aborted by user.", "warn");
        } else if (error instanceof StateError) {
            UI.logToTimeline(currentCycle, `Cycle paused: ${error.message}`, "warn");
        } else {
            logger.error(`Cycle ${currentCycle} failed`, error);
            UI.logToTimeline(currentCycle, `Cycle failed: ${error.message}`, "error");
        }
    } finally {
        _isRunning = false;
        UI.setRunButtonState("Run Cycle", false);
        UI.updateStateDisplay();
    }
  };

  const abortCurrentCycle = () => {
    _abortRequested = true;
    ApiClient.abortCurrentCall("User Abort Request");
  };

  return {
    executeCycle,
    isRunning: () => _isRunning,
    isAutonomous: () => false, // No autonomous mode in primordial version
    abortCurrentCycle,
    // Expose other methods if the new UI needs them
  };
};
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
    const internalLog = logger || console;
    internalLog.error("CycleLogicModule initialization failed: Missing dependencies.");
    return {
        executeCycle: () => Promise.reject(new Error("CycleLogic not initialized.")),
        isRunning: () => false,
        isAutonomous: () => false,
    };
  }

  const {
    ApplicationError,
    ApiError,
    ToolError,
    StateError,
    AbortError,
  } = Errors;
  let _isRunning = false;
  let _abortRequested = false;

  const getActiveGoalInfo = () => {
    const state = StateManager.getState();
    if (!state || !state.currentGoal) return { latestGoal: "Idle", type: "Idle", stack: [] };
    return {
      latestGoal: state.currentGoal.cumulative || state.currentGoal.seed,
      type: state.currentGoal.latestType || "System",
      stack: state.currentGoal.stack || [],
    };
  };

  const _assembleCorePromptContext = async (state, goalInfo, currentCycle) => {
    let corePromptTemplate = await Storage.getArtifactContent("/modules/prompt-system.md");
    if (!corePromptTemplate) {
        // Self-healing: Create default prompt if missing
        logger.warn("Core prompt not found, creating default prompt");
        const defaultPrompt = `You are an AI agent operating in cycle [[CYCLE_COUNT]].

Your current goal: [[CUMULATIVE_GOAL]]

Available tools:
[[TOOL_LIST]]

Available artifacts:
[[ARTIFACT_LIST]]

Analyze the goal and available resources, then propose changes to achieve it.
Respond with a JSON object containing your proposed changes.`;
        
        await StateManager.createArtifact(
            "/modules/prompt-system.md",
            "markdown",
            defaultPrompt,
            "Default system prompt (auto-generated)"
        );
        corePromptTemplate = defaultPrompt;
    }

    const artifactListSummary = AgentLogicPureHelpers.getArtifactListSummaryPure(await StateManager.getAllArtifactMetadata());
    
    // Load tools from multiple files - try new split files first, fallback to legacy
    let staticTools = [];
    
    // Try loading split tool files
    const toolsReadContent = await Storage.getArtifactContent("/modules/tools-read.json");
    if (toolsReadContent) {
        staticTools = [...staticTools, ...JSON.parse(toolsReadContent)];
    }
    
    const toolsWriteContent = await Storage.getArtifactContent("/modules/tools-write.json");
    if (toolsWriteContent) {
        staticTools = [...staticTools, ...JSON.parse(toolsWriteContent)];
    }
    
    // Fallback to legacy single file if split files not found
    if (staticTools.length === 0) {
        const staticToolsContent = await Storage.getArtifactContent("/modules/data-tools-static.json");
        staticTools = JSON.parse(staticToolsContent || "[]");
    }
    
    const dynamicToolsContent = await Storage.getArtifactContent("/system/tools-dynamic.json");
    const dynamicTools = JSON.parse(dynamicToolsContent || "[]");

    const toolListSummary = AgentLogicPureHelpers.getToolListSummaryPure(staticTools, dynamicTools, Utils.trunc);

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
    
    try {
        // Load tools from multiple files for execution
        let staticTools = [];
        const toolsReadContent = await Storage.getArtifactContent("/modules/data-tools-read.json");
        if (toolsReadContent) staticTools = [...staticTools, ...JSON.parse(toolsReadContent)];
        const toolsWriteContent = await Storage.getArtifactContent("/modules/data-tools-write.json");
        if (toolsWriteContent) staticTools = [...staticTools, ...JSON.parse(toolsWriteContent)];
        if (staticTools.length === 0) {
            const staticToolsContent = await Storage.getArtifactContent("/modules/data-tools-static.json");
            staticTools = JSON.parse(staticToolsContent || "[]");
        }
        
        const dynamicToolsContent = await Storage.getArtifactContent("/system/tools-dynamic.json");
        const dynamicTools = JSON.parse(dynamicToolsContent || "[]");

        const toolResult = await ToolRunner.runTool(toolName, toolArgs, staticTools, dynamicTools);
        
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
        
        // Load tools from multiple files for API declarations
        let staticTools = [];
        const toolsReadContent = await Storage.getArtifactContent("/modules/data-tools-read.json");
        if (toolsReadContent) staticTools = [...staticTools, ...JSON.parse(toolsReadContent)];
        const toolsWriteContent = await Storage.getArtifactContent("/modules/data-tools-write.json");
        if (toolsWriteContent) staticTools = [...staticTools, ...JSON.parse(toolsWriteContent)];
        if (staticTools.length === 0) {
            const staticToolsContent = await Storage.getArtifactContent("/modules/data-tools-static.json");
            staticTools = JSON.parse(staticToolsContent || "[]");
        }

        const dynamicToolsContent = await Storage.getArtifactContent("/system/tools-dynamic.json");
        const dynamicTools = JSON.parse(dynamicToolsContent || "[]");
        
        const allTools = [...staticTools, ...dynamicTools.map(t => t.declaration)];
        const funcDeclarations = allTools.map(t => ToolRunner.convertToGeminiFunctionDeclaration(t));

        for (let i = 0; i < 5; i++) {
            if (_abortRequested) throw new AbortError("API sequence aborted.");

            const apiResult = await ApiClient.callApiWithRetry(
                apiHistory,
                state.apiKey,
                funcDeclarations
            );

            apiHistory.push(apiResult.rawResp.candidates[0].content);

            if (apiResult.type === "functionCall") {
                const toolResponse = await _handleToolExecution(apiResult.content, state, currentCycle);
                apiHistory.push(toolResponse);
                continue;
            }
            
            return apiResult;
        }
        
        throw new ApplicationError("LLM did not return a final text response after 5 tool calls.");
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

    await StateManager.incrementCycle();
    logger.logEvent("info", "LLM changes applied successfully.", changesMade);
    return { success: true, changes: changesMade };
  };

  const _checkHitlTriggers = (state) => {
    const hitlProb = state.cfg?.humanReviewProb ?? 10;
    if (Math.random() < (hitlProb / 100.0)) {
        return { reason: `Random quality check (${hitlProb}% probability).` };
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
        // Create or update scratchpad - self-healing pattern
        const scratchpadPath = "/system/scratchpad.md";
        const scratchpadContent = `Cycle ${currentCycle} Scratchpad:\n`;
        const scratchpadMeta = await StateManager.getArtifactMetadata(scratchpadPath);
        
        if (!scratchpadMeta) {
            // Create if missing - upgrade is self-sufficient
            await StateManager.createArtifact(
                scratchpadPath,
                "markdown",
                scratchpadContent,
                "Agent's working memory scratchpad"
            );
        } else {
            // Update if exists
            await StateManager.updateArtifact(scratchpadPath, scratchpadContent);
        }
        
        const goalInfo = getActiveGoalInfo();
        UI.logToTimeline(currentCycle, `Goal: ${Utils.trunc(goalInfo.latestGoal, 80)}`, "goal");

        // 1. THINK
        const prompt = await _assembleCorePromptContext(state, goalInfo, currentCycle);
        const llmResult = await _executeLlmApiCallSequence(prompt, state, currentCycle);
        
        UI.displayCycleArtifact("LLM Final Output", llmResult.content, "output", "LLM", `llm.final.${currentCycle}`);
        const parsedResp = JSON.parse(ApiClient.sanitizeLlmJsonResp(llmResult.content));
        UI.displayCycleArtifact("LLM Proposal", parsedResp.proposed_changes_description, "info", "LLM", `llm.proposal.${currentCycle}`);

        // 2. CRITIQUE (Simplified)
        const hitlTrigger = _checkHitlTriggers(state);
        if (hitlTrigger) {
            UI.showHumanInterventionUI("prompt", hitlTrigger.reason);
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
        await UI.updateStateDisplay();
    }
  };

  const abortCurrentCycle = () => {
    _abortRequested = true;
    ApiClient.abortCurrentCall("User Abort Request");
  };

  return {
    executeCycle,
    isRunning: () => _isRunning,
    isAutonomous: () => false,
    abortCurrentCycle,
  };
};
// Standardized Cycle Logic Module for REPLOID
// Implements the agent's main cognitive loop

const CycleLogic = {
  metadata: {
    id: 'CycleLogic',
    version: '1.0.0',
    dependencies: ['config', 'Utils', 'Storage', 'StateManager', 'UI', 'ApiClient', 'ToolRunner', 'AgentLogicPureHelpers'],
    async: false,
    type: 'service'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, AgentLogicPureHelpers } = deps;
    const { logger, Errors } = Utils;
    
    if (!config || !logger || !Utils || !Storage || !StateManager || !UI || !ApiClient || !ToolRunner || !Errors || !AgentLogicPureHelpers) {
      throw new Error('CycleLogic: Missing required dependencies');
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

    const toolsSystemContent = await Storage.getArtifactContent("/modules/tools-system.json");
    if (toolsSystemContent) {
        staticTools = [...staticTools, ...JSON.parse(toolsSystemContent)];
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
        const toolsSystemContent = await Storage.getArtifactContent("/modules/tools-system.json");
        if (toolsSystemContent) {
            staticTools = [...staticTools, ...JSON.parse(toolsSystemContent)];
        }
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
        const toolsSystemContent = await Storage.getArtifactContent("/modules/tools-system.json");
        if (toolsSystemContent) {
            staticTools = [...staticTools, ...JSON.parse(toolsSystemContent)];
        }
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
    // UI.setRunButtonState("Abort Cycle", false); // Old UI

    const state = StateManager.getState();
    const currentCycle = state.totalCycles;
    UI.clearThoughts();
    UI.clearFileDiffs();
    UI.logToAdvanced(`--- Cycle ${currentCycle} Start ---`);

    try {
        const goalInfo = getActiveGoalInfo();
        UI.updateGoal(goalInfo.latestGoal);
        UI.logToAdvanced(`Goal: ${Utils.trunc(goalInfo.latestGoal, 80)}`);

        // 1. THINK
        const prompt = await _assembleCorePromptContext(state, goalInfo, currentCycle);
        const llmResult = await _executeLlmApiCallSequence(prompt, state, currentCycle);
        
        const parsedResp = JSON.parse(ApiClient.sanitizeLlmJsonResp(llmResult.content));
        UI.streamThought(parsedResp.proposed_changes_description);
        UI.logToAdvanced(`LLM Proposal: ${parsedResp.proposed_changes_description}`);

        // 2. APPLY
        await _applyLLMChanges(parsedResp, currentCycle);
        UI.logToAdvanced(`--- Cycle ${currentCycle} Complete ---`);

    } catch (error) {
        if (error instanceof AbortError) {
            UI.logToAdvanced("Cycle aborted by user.");
        } else {
            logger.error(`Cycle ${currentCycle} failed`, error);
            UI.logToAdvanced(`Cycle failed: ${error.message}`);
        }
    } finally {
        _isRunning = false;
        // UI.setRunButtonState("Run Cycle", false); // Old UI
    }
  };

  const abortCurrentCycle = () => {
    _abortRequested = true;
    ApiClient.abortCurrentCall("User Abort Request");
  };

    // Public API
    return {
      api: {
        executeCycle,
        isRunning: () => _isRunning,
        isAutonomous: () => false,
        abortCurrentCycle,
      }
    };
  }
};

// Legacy compatibility wrapper
const CycleLogicModule = (config, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers) => {
  const instance = CycleLogic.factory({ config, logger, Utils, Storage, StateManager, UI, ApiClient, ToolRunner, Errors, AgentLogicPureHelpers });
  return instance.api;
};

// Export both formats
CycleLogic;
CycleLogicModule;
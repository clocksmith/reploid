const ToolRunnerModule = (config, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers) => {
  if (!config || !logger || !Storage || !StateManager || !ApiClient || !Errors || !Utils || !ToolRunnerPureHelpers) {
    const internalLog = logger || { logEvent: (lvl, msg, det) => console[lvl === "error" ? "error" : "log"](`[TOOLRUNNER_FALLBACK] ${msg}`, det || "") };
    internalLog.logEvent("error", "ToolRunnerModule initialization failed: Missing dependencies.");
    return {
      runTool: async (toolName) => { throw new (Errors?.ConfigError || Error)(`ToolRunner not initialized, cannot run ${toolName}`); },
    };
  }

  const { ToolError, ArtifactError, WebComponentError } = Errors;
  const DYNAMIC_TOOL_TIMEOUT_MS = config.DYNAMIC_TOOL_TIMEOUT_MS || 10000;
  const WORKER_SCRIPT_PATH = config.WORKER_SCRIPT_PATH || "tool-worker.js";

  const runToolInternal = async (toolName, toolArgs, injectedStaticTools, injectedDynamicTools, uiHooks = {}) => {
    logger.logEvent("info", `Run tool: ${toolName}`, toolArgs || {});
    const staticTool = injectedStaticTools.find((t) => t.name === toolName);

    if (staticTool) {
      let artifactContent = null;
      if (toolArgs && toolArgs.artifactId && typeof toolArgs.cycle === "number") {
        artifactContent = Storage.getArtifactContent(toolArgs.artifactId, toolArgs.cycle, toolArgs.versionId);
        if (artifactContent === null && !["list_artifacts", "define_web_component", "apply_diff_patch", "apply_json_patch", "convert_to_gemini_fc", "run_self_evaluation"].includes(toolName)) {
          throw new ArtifactError(`Artifact content not found for ${toolArgs.artifactId} cycle ${toolArgs.cycle} (vId: ${toolArgs.versionId || "latest"})`, toolArgs.artifactId, toolArgs.cycle);
        }
      }

      switch (toolName) {
        case "code_linter":
          const lintResult = ToolRunnerPureHelpers.basicCodeLintPure(artifactContent, toolArgs.language);
          return { result: `Basic lint ${lintResult.linting_passed ? "passed" : "failed"} for ${toolArgs.language}.${lintResult.error_message ? " Error: " + lintResult.error_message : ""}`, ...lintResult };

        case "json_validator":
          const validation = ToolRunnerPureHelpers.validateJsonStructurePure(artifactContent);
          return { result: `JSON structure is ${validation.valid ? "valid" : "invalid"}.${validation.error ? " Error: " + validation.error : ""}`, ...validation };

        case "read_artifact":
          if (artifactContent === null) throw new ArtifactError(`Artifact content not found for ${toolArgs.artifactId} cycle ${toolArgs.cycle} (vId: ${toolArgs.versionId || "latest"})`, toolArgs.artifactId, toolArgs.cycle);
          return { content: artifactContent, artifactId: toolArgs.artifactId, cycle: toolArgs.cycle, versionId: toolArgs.versionId || null };

        case "list_artifacts":
          const allMetaMap = StateManager.getAllArtifactMetadata();
          let filteredMeta = Object.values(allMetaMap);
          if (toolArgs.filterType) filteredMeta = filteredMeta.filter((meta) => meta.type && meta.type.toUpperCase() === toolArgs.filterType.toUpperCase());
          if (toolArgs.filterPattern) {
            try {
              const regex = new RegExp(toolArgs.filterPattern);
              filteredMeta = filteredMeta.filter((meta) => regex.test(meta.id));
            } catch (e) { throw new ToolError(`Invalid regex pattern: ${e.message}`, toolName, toolArgs); }
          }
          if (toolArgs.includeAllVersions) {
            const allVersions = [];
            for (const meta of filteredMeta) allVersions.push(...StateManager.getArtifactMetadataAllVersions(meta.id));
            return { artifacts: allVersions.map(m => ({ id: m.id, type: m.type, latestCycle: m.latestCycle, versionId: m.version_id, timestamp: m.timestamp, source: m.source, paradigm: m.paradigm })) };
          } else {
            return { artifacts: filteredMeta.map(meta => ({ id: meta.id, type: meta.type, latestCycle: meta.latestCycle, paradigm: meta.paradigm })) };
          }
        
        case "diff_text":
            return ToolRunnerPureHelpers.diffTextPure(toolArgs.textA, toolArgs.textB);

        case "convert_to_gemini_fc":
            const geminiFc = ToolRunnerPureHelpers.convertToGeminiFunctionDeclarationPure(toolArgs.mcpToolDefinition, logger);
            if (!geminiFc) throw new ToolError("Failed to convert MCP tool to Gemini FC format.", toolName, toolArgs);
            return { geminiFunctionDeclaration: geminiFc };

        case "code_edit":
          const { success, validatedContent, error, contentChanged } = await (async () => {
            const originalContent = Storage.getArtifactContent(toolArgs.artifactId, toolArgs.cycle, toolArgs.versionId);
            if (originalContent === null && toolArgs.artifactId !== "full_html_source" && toolArgs.artifactId !== "page_composition_preview") { // Allow new full source
                 throw new ArtifactError(`Original artifact not found for code_edit: ${toolArgs.artifactId}`, toolArgs.artifactId, toolArgs.cycle);
            }
            const isSame = originalContent === toolArgs.newContent;
            let validationError = null;
            try {
              const artifactMeta = StateManager.getArtifactMetadata(toolArgs.artifactId);
              if (artifactMeta?.type === "JSON" || artifactMeta?.type === "JSON_CONFIG") JSON.parse(toolArgs.newContent);
            } catch (e) { validationError = `Invalid JSON: ${e.message}`; }

            return {
                success: !validationError,
                validatedContent: toolArgs.newContent,
                error: validationError,
                contentChanged: !isSame,
                artifactId: toolArgs.artifactId,
                cycle: toolArgs.cycle,
                versionId: toolArgs.versionId
            };
          })();
          return { success, validatedContent, error, contentChanged, artifactId: toolArgs.artifactId, cycle: toolArgs.cycle, versionId: toolArgs.versionId };
        
        case "run_self_evaluation":
            const evalState = StateManager.getState();
            if (!evalState?.apiKey) throw new Errors.ConfigError("API Key required for self-evaluation tool.");
            const { targetArtifactId, targetArtifactCycle, targetArtifactVersionId, evalCriteriaText, goalContextText, evalDefinitionId, contentToEvaluate: explicitContent } = toolArgs;
            let finalContentToEvaluate = explicitContent;
            if (!finalContentToEvaluate) {
                const meta = StateManager.getArtifactMetadata(targetArtifactId, targetArtifactVersionId);
                const cycleToUse = meta ? meta.latestCycle : targetArtifactCycle;
                finalContentToEvaluate = Storage.getArtifactContent(targetArtifactId, cycleToUse, targetArtifactVersionId);
            }
            if (finalContentToEvaluate === null) throw new ArtifactError("Content to evaluate not found or provided.", targetArtifactId, targetArtifactCycle);
            
            const evalPromptTemplate = Storage.getArtifactContent("reploid.core.evaluator-prompt", 0);
            if(!evalPromptTemplate) throw new ArtifactError("Evaluator prompt artifact not found.", "reploid.core.evaluator-prompt");

            const evalPrompt = evalPromptTemplate
                .replace(/\[\[GOAL_CONTEXT\]\]/g, goalContextText)
                .replace(/\[\[EVALUATION_CRITERIA\]\]/g, evalCriteriaText)
                .replace(/\[\[TARGET_CONTENT_OR_PROPOSAL\]\]/g, finalContentToEvaluate)
                .replace(/\[\[TARGET_ARTIFACT_ID\]\]/g, targetArtifactId)
                .replace(/\[\[TARGET_ARTIFACT_PARADIGM\]\]/g, StateManager.getArtifactMetadata(targetArtifactId)?.paradigm || "unknown");

            const evaluatorModelKey = evalState.cfg?.evaluatorModel || "BASE";
            const evaluatorModelIdentifier = config.DEFAULT_MODELS[evaluatorModelKey.toUpperCase()] || evaluatorModelKey;

            const apiResult = await ApiClient.callApiWithRetry(
                evalPrompt,
                'You are Evaluator x0. Output ONLY valid JSON: {"evaluation_score": float, "evaluation_report": "string"}',
                evaluatorModelIdentifier, evalState.apiKey, [], false, null, 1, {},
                uiHooks.updateStatus, uiHooks.logTimeline, uiHooks.updateTimelineItem
            );
            if (!apiResult || apiResult.type !== "text" || !apiResult.content) throw new ToolError("Self-evaluation LLM call failed or returned no content.", toolName, toolArgs);
            
            const sanitized = ApiClient.sanitizeLlmJsonResp(apiResult.content);
            try {
                const parsed = JSON.parse(sanitized);
                if (typeof parsed.evaluation_score !== 'number' || typeof parsed.evaluation_report !== 'string') {
                    throw new Error("Evaluation response missing required fields.");
                }
                return {
                    ...parsed,
                    targetArtifactId, targetArtifactCycle, targetArtifactVersionId,
                    evalDefinitionId: evalDefinitionId || "reploid.core.default-eval", // or extract from evalCriteriaText
                    timestamp: Date.now()
                };
            } catch(e) {
                throw new ToolError(`Failed to parse self-evaluation LLM response: ${e.message}`, toolName, toolArgs, {rawResponse: sanitized});
            }

        case "define_web_component":
          const { tagName, classContent, targetArtifactId: wcTargetId, description } = toolArgs;
          if (!tagName || !classContent || !wcTargetId || !description) throw new ToolError("Missing required arguments for define_web_component.", toolName, toolArgs);
          if (!tagName.includes("-") || tagName.toLowerCase() !== tagName) throw new ToolError("Invalid tagName: must include a hyphen and be lowercase.", toolName, toolArgs, { tagName });

          try {
            const ComponentClass = new Function("return (" + classContent + ")")();
            if (typeof ComponentClass !== "function" || !HTMLElement.isPrototypeOf(ComponentClass)) {
              throw new WebComponentError("Provided classContent does not evaluate to a valid HTMLElement subclass.", tagName, { classContent });
            }
            customElements.define(tagName, ComponentClass); // Impure DOM interaction
            StateManager.registerWebComponent(tagName); // Impure StateManager interaction

            const nextCycle = (StateManager.getState()?.totalCycles || 0) + 1; // Semi-pure state read
            const checksum = await Utils.calculateChecksum(classContent); // Impure (async crypto) but deterministic
            
            Storage.setArtifactContent(wcTargetId, nextCycle, classContent); // Impure Storage interaction
            StateManager.updateArtifactMetadata(wcTargetId, "WEB_COMPONENT_DEF", description, nextCycle, checksum, "Tool: define_web_component", null, false, "data"); // Impure StateManager interaction

            logger.logEvent("info", `Web Component '${tagName}' defined and artifact '${wcTargetId}' saved.`);
            return { success: true, tagName, artifactId: wcTargetId, message: `Web Component <${tagName}> defined and saved as ${wcTargetId}.` };
          } catch (e) {
            logger.logEvent("error", `Failed to define Web Component '${tagName}': ${e.message}`, e);
            throw new WebComponentError(`Failed to define Web Component '${tagName}': ${e.message}`, tagName, { originalError: e.toString(), classContent });
          }

        case "apply_diff_patch":
          logger.logEvent("warn", "Tool 'apply_diff_patch' is a placeholder.");
          const origContentPatch = Storage.getArtifactContent(toolArgs.artifactId, toolArgs.cycle, toolArgs.versionId);
          if (origContentPatch === null) throw new ArtifactError(`Original artifact not found for patching: ${toolArgs.artifactId}`, toolArgs.artifactId, toolArgs.cycle);
          return { success: false, result_content: origContentPatch + `\n\n--- PATCHED (Placeholder) ---\n${toolArgs.patchContent}`, error: "Tool not fully implemented", original_content: origContentPatch, patch_applied: false };

        case "apply_json_patch":
          logger.logEvent("warn", "Tool 'apply_json_patch' is a placeholder.");
          const origJsonContent = Storage.getArtifactContent(toolArgs.artifactId, toolArgs.cycle, toolArgs.versionId);
          if (origJsonContent === null) throw new ArtifactError(`Original JSON artifact not found for patching: ${toolArgs.artifactId}`, toolArgs.artifactId, toolArgs.cycle);
          return { success: false, result_content: JSON.stringify({ ...JSON.parse(origJsonContent), __PATCHED_PLACEHOLDER__: toolArgs.patchContent }, null, 2), error: "Tool not fully implemented", original_content: origJsonContent, patch_applied: false };

        default:
          logger.logEvent("warn", `Static tool '${toolName}' execution logic not fully implemented or recognized.`);
          return { success: true, message: `Static tool ${toolName} placeholder executed.`, argsReceived: toolArgs };
      }
    }

    const dynamicTool = injectedDynamicTools.find((t) => t.declaration.name === toolName);
    if (dynamicTool) {
      if (!dynamicTool.implementation) throw new ToolError(`Dynamic tool '${toolName}' has no implementation defined.`, toolName);
      logger.logEvent("info", `Executing dynamic tool '${toolName}' in Web Worker sandbox.`);

      return new Promise((resolve, reject) => {
        let worker = null; let timeoutId = null;
        try {
          worker = new Worker(WORKER_SCRIPT_PATH);
          timeoutId = setTimeout(() => {
            const errorMsg = `Dynamic tool '${toolName}' timed out after ${DYNAMIC_TOOL_TIMEOUT_MS}ms.`;
            logger.logEvent("error", errorMsg);
            if (worker) worker.terminate();
            reject(new ToolError(`Dynamic tool '${toolName}' execution timed out.`, toolName));
          }, DYNAMIC_TOOL_TIMEOUT_MS);

          worker.onmessage = async (event) => {
            const { type, success, result, error: workerError, id: msgId, requestType, payload } = event.data;
            if (type === "request") {
              try {
                let shimResult;
                if (requestType === "getArtifactContent" && payload) shimResult = Storage.getArtifactContent(payload.id, payload.cycle, payload.versionId);
                else if (requestType === "getArtifactMetadata" && payload) shimResult = StateManager.getArtifactMetadata(payload.id, payload.versionId);
                else if (requestType === "getArtifactMetadataAllVersions" && payload) shimResult = StateManager.getArtifactMetadataAllVersions(payload.id);
                else if (requestType === "getAllArtifactMetadata") shimResult = StateManager.getAllArtifactMetadata();
                else throw new Error(`Unknown shim requestType: ${requestType}`);
                worker.postMessage({ type: "response", id: msgId, data: shimResult });
              } catch (e) {
                worker.postMessage({ type: "response", id: msgId, error: { message: e.message, name: e.name } });
              }
            } else {
              clearTimeout(timeoutId);
              if (success) {
                logger.logEvent("info", `Dynamic tool '${toolName}' execution succeeded.`);
                resolve(result);
              } else {
                const errorMsg = workerError?.message || "Unknown worker error";
                logger.logEvent("error", `Dynamic tool '${toolName}' execution failed in worker: ${errorMsg}\nStack: ${workerError?.stack}`);
                reject(new ToolError(`Dynamic tool '${toolName}' failed: ${errorMsg}`, toolName, toolArgs, { workerError }));
              }
              if (worker) worker.terminate();
            }
          };
          worker.onerror = (errorEvent) => {
            clearTimeout(timeoutId);
            const errorMsg = errorEvent.message || "Unknown worker error";
            logger.logEvent("error", `Web Worker error for tool '${toolName}': ${errorMsg}`, errorEvent);
            reject(new ToolError(`Worker error for dynamic tool '${toolName}': ${errorMsg}`, toolName, toolArgs, { workerEventError: errorEvent }));
            if (worker) worker.terminate();
          };
          worker.postMessage({ type: "init", payload: { toolCode: dynamicTool.implementation, toolArgs } });
        } catch (e) {
          clearTimeout(timeoutId);
          logger.logEvent("error", `Error setting up worker for '${toolName}': ${e.message}`);
          if (worker) worker.terminate();
          reject(new ToolError(`Failed to initialize worker for tool '${toolName}': ${e.message}`, toolName, toolArgs, { setupError: e }));
        }
      });
    }
    throw new ToolError(`Tool not found: ${toolName}`, toolName);
  };

  return {
    runTool: runToolInternal,
  };
};
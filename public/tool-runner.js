const ToolRunnerModule = (config, logger, Storage, StateManager, ApiClient) => {
  if (!config || !logger || !Storage || !StateManager || !ApiClient) {
    console.error(
      "ToolRunnerModule requires config, logger, Storage, StateManager, and ApiClient."
    );
    const log = logger || {
      logEvent: (lvl, msg) =>
        console[lvl === "error" ? "error" : "log"](
          `[TOOLRUNNER FALLBACK] ${msg}`
        ),
    };
    log.logEvent(
      "error",
      "ToolRunnerModule initialization failed: Missing dependencies."
    );
    return {
      runTool: async (toolName) => {
        throw new Error(`ToolRunner not initialized, cannot run ${toolName}`);
      },
    };
  }

  const DYNAMIC_TOOL_TIMEOUT_MS = config.DYNAMIC_TOOL_TIMEOUT_MS || 10000;
  const WORKER_SCRIPT_PATH = config.WORKER_SCRIPT_PATH || "tool-worker.js";

  function mapMcpTypeToGemini(mcpType) {
    switch (mcpType?.toLowerCase()) {
      case "string":
        return "STRING";
      case "integer":
        return "INTEGER";
      case "number":
        return "NUMBER";
      case "boolean":
        return "BOOLEAN";
      case "array":
        return "ARRAY";
      case "object":
        return "OBJECT";
      default:
        logger.logEvent("warn", `Unsupported MCP type encountered: ${mcpType}`);
        return "TYPE_UNSPECIFIED";
    }
  }

  function convertMcpPropertiesToGemini(mcpProps) {
    if (!mcpProps) return {};
    const geminiProps = {};
    for (const key in mcpProps) {
      const mcpProp = mcpProps[key];
      geminiProps[key] = {
        type: mapMcpTypeToGemini(mcpProp.type),
        description: mcpProp.description || "",
      };
      if (mcpProp.enum) {
        geminiProps[key].enum = mcpProp.enum;
      }
      if (mcpProp.type === "array" && mcpProp.items) {
        geminiProps[key].items = {
          type: mapMcpTypeToGemini(mcpProp.items.type),
        };
      }
      if (mcpProp.type === "object" && mcpProp.properties) {
        geminiProps[key].properties = convertMcpPropertiesToGemini(
          mcpProp.properties
        );
        if (mcpProp.required) {
          geminiProps[key].required = mcpProp.required;
        }
      }
    }
    return geminiProps;
  }

  async function runToolInternal(
    toolName,
    toolArgs,
    injectedStaticTools,
    injectedDynamicTools,
    uiHooks = {}
  ) {
    logger.logEvent("info", `Run tool: ${toolName}`, toolArgs || {});
    const staticTool = injectedStaticTools.find((t) => t.name === toolName);

    if (staticTool) {
      let artifactContent = null;
      let artifactMetaData = null;
      if (
        toolArgs &&
        toolArgs.artifactId &&
        typeof toolArgs.cycle === "number"
      ) {
        artifactContent = Storage.getArtifactContent(
          toolArgs.artifactId,
          toolArgs.cycle,
          toolArgs.versionId
        );
        artifactMetaData = StateManager.getArtifactMetadata(
          toolArgs.artifactId
        );
        if (
          artifactContent === null &&
          toolName !== "list_artifacts" &&
          toolName !== "apply_diff_patch" &&
          toolName !== "apply_json_patch"
        ) {
          throw new Error(
            `Artifact content not found for ${toolArgs.artifactId} cycle ${
              toolArgs.cycle
            } (vId: ${toolArgs.versionId || "latest"})`
          );
        }
      }

      switch (toolName) {
        case "code_linter":
          const code = artifactContent;
          let hasError = false;
          let errorMessage = "";
          try {
            if (!code) throw new Error("Artifact content is null or empty.");
            if (toolArgs.language === "json") {
              JSON.parse(code);
            } else if (toolArgs.language === "html") {
              if (code.includes("<script") && !code.includes("</script>")) {
                hasError = true;
                errorMessage = "Potentially unclosed script tag.";
              }
            } else if (toolArgs.language === "javascript") {
              if (
                (code.match(/{/g) || []).length !==
                  (code.match(/}/g) || []).length ||
                (code.match(/\(/g) || []).length !==
                  (code.match(/\)/g) || []).length
              ) {
                hasError = true;
                errorMessage = "Mismatched braces or parentheses.";
              }
            }
          } catch (e) {
            hasError = true;
            errorMessage = e.message;
          }
          return {
            result: `Basic lint ${hasError ? "failed" : "passed"} for ${
              toolArgs.language
            }.${hasError ? " Error: " + errorMessage : ""}`,
            linting_passed: !hasError,
            error_message: hasError ? errorMessage : null,
          };

        case "json_validator":
          try {
            if (!artifactContent)
              throw new Error("Artifact content is null or empty.");
            JSON.parse(artifactContent);
            return { result: "JSON structure is valid.", valid: true };
          } catch (e) {
            return {
              result: `JSON invalid: ${e.message}`,
              valid: false,
              error: e.message,
            };
          }

        case "read_artifact":
          if (artifactContent === null) {
            throw new Error(
              `Artifact content not found for ${toolArgs.artifactId} cycle ${
                toolArgs.cycle
              } (vId: ${toolArgs.versionId || "latest"})`
            );
          }
          return {
            content: artifactContent,
            artifactId: toolArgs.artifactId,
            cycle: toolArgs.cycle,
            versionId: toolArgs.versionId || null,
          };

        case "list_artifacts":
          const allMetaMap = StateManager.getAllArtifactMetadata();
          let filteredMeta = Object.values(allMetaMap);

          if (toolArgs.filterType) {
            filteredMeta = filteredMeta.filter(
              (meta) =>
                meta.type &&
                meta.type.toUpperCase() === toolArgs.filterType.toUpperCase()
            );
          }
          if (toolArgs.filterPattern) {
            try {
              const regex = new RegExp(toolArgs.filterPattern);
              filteredMeta = filteredMeta.filter((meta) => regex.test(meta.id));
            } catch (e) {
              throw new Error(`Invalid regex pattern: ${e.message}`);
            }
          }

          if (toolArgs.includeAllVersions) {
            const allVersions = [];
            for (const meta of filteredMeta) {
              allVersions.push(
                ...StateManager.getArtifactMetadataAllVersions(meta.id)
              );
            }
            return {
              artifacts: allVersions.map((m) => ({
                id: m.id,
                type: m.type,
                latestCycle: m.latestCycle,
                versionId: m.version_id,
                timestamp: m.timestamp,
                source: m.source,
              })),
            };
          } else {
            return {
              artifacts: filteredMeta.map((meta) => ({
                id: meta.id,
                type: meta.type,
                latestCycle: meta.latestCycle,
              })),
            };
          }

        case "diff_text":
          const linesA = (toolArgs.textA || "").split("\n");
          const linesB = (toolArgs.textB || "").split("\n");
          if (toolArgs.textA === toolArgs.textB) {
            return { differences: 0, result: "Texts are identical." };
          }
          const diff = [];
          const maxLen = Math.max(linesA.length, linesB.length);
          let diffCount = 0;
          for (let i = 0; i < maxLen; i++) {
            if (linesA[i] !== linesB[i]) {
              diff.push(
                `L${i + 1}: A='${(linesA[i] || "").substring(0, 50)}' B='${(
                  linesB[i] || ""
                ).substring(0, 50)}'`
              );
              diffCount++;
            }
          }
          return {
            differences: diffCount,
            result: `Found ${diffCount} differing lines.`,
            details: diff.slice(0, 20),
          };

        case "convert_to_gemini_fc":
          const mcpDef = toolArgs.mcpToolDefinition;
          if (
            !mcpDef ||
            !mcpDef.name ||
            !mcpDef.inputSchema ||
            mcpDef.inputSchema.type !== "object"
          ) {
            throw new Error(
              "Invalid MCP tool definition provided for conversion."
            );
          }
          const geminiDecl = {
            name: mcpDef.name,
            description: mcpDef.description || "",
            parameters: {
              type: "OBJECT",
              properties: convertMcpPropertiesToGemini(
                mcpDef.inputSchema.properties
              ),
              required: mcpDef.inputSchema.required || [],
            },
          };
          return { geminiFunctionDeclaration: geminiDecl };

        case "code_edit":
          const { artifactId, cycle, newContent, versionId } = toolArgs;
          const originalContent = Storage.getArtifactContent(
            artifactId,
            cycle,
            versionId
          );
          if (originalContent === null) {
            throw new Error(
              `Original artifact not found for ${artifactId} cycle ${cycle} (vId: ${
                versionId || "latest"
              })`
            );
          }
          let isValid = true;
          let validationError = null;
          const meta = StateManager.getArtifactMetadata(artifactId);

          if (meta && meta.type === "JSON") {
            try {
              JSON.parse(newContent);
            } catch (e) {
              isValid = false;
              validationError = `Invalid JSON: ${e.message}`;
            }
          } else if (meta && meta.type === "JS") {
            if (
              (newContent.match(/{/g) || []).length !==
                (newContent.match(/}/g) || []).length ||
              (newContent.match(/\(/g) || []).length !==
                (newContent.match(/\)/g) || []).length
            ) {
              isValid = false;
              validationError =
                "Mismatched braces or parentheses detected in JS.";
            }
          } else if (meta && meta.type === "HTML") {
            if (
              newContent.includes("<script") &&
              !newContent.includes("</script>")
            ) {
              isValid = false;
              validationError =
                "Potentially unclosed script tag detected in HTML.";
            }
          }

          return {
            success: isValid,
            validatedContent: isValid ? newContent : null,
            error: validationError,
            originalContent: originalContent,
            artifactId: artifactId,
            cycle: cycle,
            versionId: versionId || null,
            contentChanged: newContent !== originalContent,
          };

        case "run_self_evaluation":
          const {
            targetArtifactId,
            targetArtifactCycle,
            targetArtifactVersionId,
            evalCriteriaText,
            goalContextText,
            evalDefinitionId,
            contentToEvaluate,
          } = toolArgs;

          let targetContent = contentToEvaluate;

          if (targetContent === undefined || targetContent === null) {
            targetContent = Storage.getArtifactContent(
              targetArtifactId,
              targetArtifactCycle,
              targetArtifactVersionId
            );
            if (targetContent === null) {
              throw new Error(
                `Target artifact for evaluation not found: ${targetArtifactId} cycle ${targetArtifactCycle} (vId: ${
                  targetArtifactVersionId || "latest"
                })`
              );
            }
          }

          let finalEvalCriteria = evalCriteriaText;
          if (evalDefinitionId) {
            const evalDefContent = Storage.getArtifactContent(
              evalDefinitionId,
              0
            );
            if (evalDefContent) {
              try {
                const evalDef = JSON.parse(evalDefContent);
                if (evalDef.criteria && typeof evalDef.criteria === "string") {
                  finalEvalCriteria = evalDef.criteria;
                  logger.logEvent(
                    "info",
                    `Using evaluation criteria from EVAL_DEF artifact: ${evalDefinitionId}`
                  );
                } else {
                  logger.logEvent(
                    "warn",
                    `EVAL_DEF artifact ${evalDefinitionId} found but has invalid 'criteria' field.`
                  );
                }
              } catch (e) {
                logger.logEvent(
                  "error",
                  `Failed to parse EVAL_DEF artifact ${evalDefinitionId}: ${e.message}`
                );
              }
            } else {
              logger.logEvent(
                "warn",
                `EVAL_DEF artifact ${evalDefinitionId} not found.`
              );
            }
          }

          const evaluatorPromptTemplate =
            Storage.getArtifactContent("reploid.core.evaluator-prompt", 0) ||
            "";
          if (!evaluatorPromptTemplate) {
            throw new Error("Evaluator prompt artifact not found.");
          }

          const evaluatorPrompt = evaluatorPromptTemplate
            .replace(/\[\[GOAL_CONTEXT\]\]/g, goalContextText || "N/A")
            .replace(/\[\[EVALUATION_CRITERIA\]\]/g, finalEvalCriteria)
            .replace(/\[\[TARGET_CONTENT_OR_PROPOSAL\]\]/g, targetContent);

          const state = StateManager.getState();
          const apiKey = state?.apiKey;
          const critiqueModel =
            state?.cfg?.critiqueModel || config.DEFAULT_MODELS.CRITIQUE;

          if (!apiKey) {
            throw new Error("API Key is required to run evaluation.");
          }

          logger.logEvent(
            "info",
            `Running evaluation LLM call for ${targetArtifactId} (Cycle ${targetArtifactCycle})`
          );

          const dummyUpdateStatusFn = () => {};
          const dummyLogTimelineFn = () => ({});
          const dummyUpdateTimelineFn = () => {};
          let evalResultText = "";
          let evalApiResult = null;

          try {
            const apiResult = await ApiClient.callApiWithRetry(
              evaluatorPrompt,
              "You are Evaluator x0. Output ONLY valid JSON.",
              critiqueModel,
              apiKey,
              [],
              false,
              null,
              state?.cfg?.maxRetries ?? 1,
              {},
              uiHooks.updateStatus || dummyUpdateStatusFn,
              uiHooks.logTimeline || dummyLogTimelineFn,
              uiHooks.updateTimelineItem || dummyUpdateTimelineFn,
              (progress) => {
                if (progress.type === "text")
                  evalResultText += progress.content;
                if (progress.accumulatedResult)
                  evalApiResult = progress.accumulatedResult;
                if (uiHooks.handleProgress) uiHooks.handleProgress(progress);
              }
            );

            if (!evalApiResult) evalApiResult = apiResult;
            if (!evalResultText && evalApiResult?.content) {
              evalResultText = evalApiResult.content;
            }

            const sanitizedJson = ApiClient.sanitizeLlmJsonResp(evalResultText);
            const parsedResult = JSON.parse(sanitizedJson);

            if (
              typeof parsedResult.evaluation_score !== "number" ||
              typeof parsedResult.evaluation_report !== "string"
            ) {
              throw new Error(
                "Evaluation LLM response missing required fields (evaluation_score, evaluation_report)."
              );
            }
            parsedResult.targetArtifactId = targetArtifactId;
            parsedResult.targetArtifactCycle = targetArtifactCycle;
            parsedResult.targetArtifactVersionId =
              targetArtifactVersionId || null;

            logger.logEvent(
              "info",
              `Evaluation successful for ${targetArtifactId}. Score: ${parsedResult.evaluation_score}`
            );
            return parsedResult;
          } catch (e) {
            logger.logEvent(
              "error",
              `Self-evaluation failed for ${targetArtifactId}: ${e.message}`,
              e
            );
            throw new Error(`Evaluation tool failed: ${e.message}`);
          }

        case "apply_diff_patch":
          logger.logEvent(
            "warn",
            "Tool 'apply_diff_patch' is not fully implemented yet. Needs a diff library."
          );
          const origContentPatch = Storage.getArtifactContent(
            toolArgs.artifactId,
            toolArgs.cycle,
            toolArgs.versionId
          );
          if (origContentPatch === null) {
            throw new Error(
              `Original artifact not found for patching: ${
                toolArgs.artifactId
              } cycle ${toolArgs.cycle} (vId: ${
                toolArgs.versionId || "latest"
              })`
            );
          }
          const patchedContentPlaceholder =
            origContentPatch +
            `\n\n--- PATCHED (Placeholder) ---\n${toolArgs.patchContent}`;
          return {
            success: false,
            result_content: patchedContentPlaceholder,
            error: "Tool not fully implemented",
            original_content: origContentPatch,
            patch_applied: false,
          };

        case "apply_json_patch":
          logger.logEvent(
            "warn",
            "Tool 'apply_json_patch' is not fully implemented yet. Needs a JSON Patch library."
          );
          const origJsonContent = Storage.getArtifactContent(
            toolArgs.artifactId,
            toolArgs.cycle,
            toolArgs.versionId
          );
          if (origJsonContent === null) {
            throw new Error(
              `Original JSON artifact not found for patching: ${
                toolArgs.artifactId
              } cycle ${toolArgs.cycle} (vId: ${
                toolArgs.versionId || "latest"
              })`
            );
          }
          let originalJson;
          try {
            originalJson = JSON.parse(origJsonContent);
          } catch (e) {
            throw new Error(
              `Original artifact ${toolArgs.artifactId} is not valid JSON: ${e.message}`
            );
          }
          const patchedJsonPlaceholder = JSON.stringify(
            { ...originalJson, __PATCHED_PLACEHOLDER__: toolArgs.patchContent },
            null,
            2
          );
          return {
            success: false,
            result_content: patchedJsonPlaceholder,
            error: "Tool not fully implemented",
            original_content: origJsonContent,
            patch_applied: false,
          };

        default:
          logger.logEvent(
            "warn",
            `Static tool '${toolName}' execution logic not fully implemented or recognized.`
          );
          return {
            success: true,
            message: `Static tool ${toolName} placeholder executed.`,
            argsReceived: toolArgs,
          };
      }
    }

    const dynamicTool = injectedDynamicTools.find(
      (t) => t.declaration.name === toolName
    );
    if (dynamicTool) {
      if (!dynamicTool.implementation) {
        throw new Error(
          `Dynamic tool '${toolName}' has no implementation defined.`
        );
      }
      logger.logEvent(
        "info",
        `Executing dynamic tool '${toolName}' in Web Worker sandbox.`
      );

      return new Promise((resolve, reject) => {
        let worker = null;
        let timeoutId = null;

        try {
          worker = new Worker(WORKER_SCRIPT_PATH);

          timeoutId = setTimeout(() => {
            const errorMsg = `Dynamic tool '${toolName}' timed out after ${DYNAMIC_TOOL_TIMEOUT_MS}ms.`;
            logger.logEvent("error", errorMsg);
            if (worker) worker.terminate();
            reject(
              new Error(`Dynamic tool '${toolName}' execution timed out.`)
            );
          }, DYNAMIC_TOOL_TIMEOUT_MS);

          worker.onmessage = async (event) => {
            const { type, success, result, error, id, requestType, payload } =
              event.data;

            if (type === "request") {
              try {
                let responseData = null;
                let responseError = null;
                switch (requestType) {
                  case "getArtifactContent":
                    responseData = Storage.getArtifactContent(
                      payload.id,
                      payload.cycle,
                      payload.versionId
                    );
                    if (responseData === null)
                      responseError = {
                        message: `Artifact ${payload.id} C${payload.cycle} V${
                          payload.versionId || "latest"
                        } not found`,
                      };
                    break;
                  case "getArtifactMetadata":
                    responseData = StateManager.getArtifactMetadata(
                      payload.id,
                      payload.versionId
                    );
                    if (responseData === null)
                      responseError = {
                        message: `Metadata for ${payload.id} V${
                          payload.versionId || "latest"
                        } not found`,
                      };
                    break;
                  case "getArtifactMetadataAllVersions":
                    responseData = StateManager.getArtifactMetadataAllVersions(
                      payload.id
                    );
                    break;
                  case "getAllArtifactMetadata":
                    responseData = StateManager.getAllArtifactMetadata();
                    break;
                  default:
                    responseError = {
                      message: `Unknown request type: ${requestType}`,
                    };
                    logger.logEvent(
                      "warn",
                      `Worker requested unknown type: ${requestType}`
                    );
                }
                worker.postMessage({
                  type: "response",
                  id: id,
                  data: responseData,
                  error: responseError,
                });
              } catch (e) {
                logger.logEvent(
                  "error",
                  `Error handling worker request ${requestType}: ${e.message}`
                );
                worker.postMessage({
                  type: "response",
                  id: id,
                  data: null,
                  error: {
                    message: e.message || "Main thread error handling request",
                  },
                });
              }
            } else {
              clearTimeout(timeoutId);
              if (success) {
                logger.logEvent(
                  "info",
                  `Dynamic tool '${toolName}' execution succeeded.`
                );
                resolve(result);
              } else {
                const errorMsg = error?.message || "Unknown worker error";
                const errorStack = error?.stack || "(No stack trace)";
                logger.logEvent(
                  "error",
                  `Dynamic tool '${toolName}' execution failed in worker: ${errorMsg}\nStack: ${errorStack}`
                );
                reject(
                  new Error(`Dynamic tool '${toolName}' failed: ${errorMsg}`)
                );
              }
              if (worker) worker.terminate();
            }
          };

          worker.onerror = (error) => {
            clearTimeout(timeoutId);
            const errorMsg = error.message || "Unknown worker error";
            logger.logEvent(
              "error",
              `Web Worker error for tool '${toolName}': ${errorMsg}`,
              error
            );
            reject(
              new Error(
                `Worker error for dynamic tool '${toolName}': ${errorMsg}`
              )
            );
            if (worker) worker.terminate();
          };

          worker.postMessage({
            type: "init",
            payload: {
              toolCode: dynamicTool.implementation,
              toolArgs: toolArgs,
            },
          });
        } catch (e) {
          clearTimeout(timeoutId);
          logger.logEvent(
            "error",
            `Error setting up worker for '${toolName}': ${e.message}`
          );
          if (worker) worker.terminate();
          reject(
            new Error(
              `Failed to initialize worker for tool '${toolName}': ${e.message}`
            )
          );
        }
      });
    }

    throw new Error(`Tool not found: ${toolName}`);
  }

  return {
    runTool: runToolInternal,
  };
};

const ApiClientModule = (config, logger) => {
  if (!config || !logger) {
    console.error("ApiClientModule requires config and logger.");
    const log = logger || {
      logEvent: (lvl, msg) =>
        console[lvl === "error" ? "error" : "log"](
          `[APICLIENT FALLBACK] ${msg}`
        ),
    };
    log.logEvent(
      "error",
      "ApiClientModule initialization failed: Missing dependencies."
    );
    return {
      callApiWithRetry: async () => {
        throw new Error("ApiClient not initialized");
      },
      abortCurrentCall: () => {
        log.logEvent("warn", "ApiClient not initialized, cannot abort.");
      },
      sanitizeLlmJsonResp: (rawText) => "{}",
    };
  }

  let currentAbortController = null;
  const API_ENDPOINT_BASE =
    config.GEMINI_STREAM_ENDPOINT_BASE ||
    "https://generativelanguage.googleapis.com/v1beta/models/";
  const RETRY_DELAY_BASE_MS = config.API_RETRY_DELAY_BASE_MS || 1500;
  const RETRY_DELAY_MAX_MS = 30000;
  const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

  const sanitizeLlmJsonResp = (rawText) => {
    if (!rawText || typeof rawText !== "string") return "{}";
    let text = rawText.trim();
    let jsonString = null;
    let method = "none";

    try {
      JSON.parse(text);
      jsonString = text;
      method = "direct parse";
    } catch (e1) {
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        text = codeBlockMatch[1].trim();
        method = "code block";
        try {
          JSON.parse(text);
          jsonString = text;
        } catch (e2) {}
      }

      if (!jsonString) {
        const firstBrace = text.indexOf("{");
        const firstBracket = text.indexOf("[");
        let startIndex = -1;

        if (firstBrace !== -1 && firstBracket !== -1) {
          startIndex = Math.min(firstBrace, firstBracket);
        } else if (firstBrace !== -1) {
          startIndex = firstBrace;
        } else {
          startIndex = firstBracket;
        }

        if (startIndex !== -1) {
          text = text.substring(startIndex);
          const startChar = text[0];
          const endChar = startChar === "{" ? "}" : "]";
          let balance = 0;
          let lastValidIndex = -1;
          let inString = false;
          let escapeNext = false;
          method = "heuristic balance";

          for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (inString) {
              if (escapeNext) {
                escapeNext = false;
              } else if (char === "\\") {
                escapeNext = true;
              } else if (char === '"') {
                inString = false;
              }
            } else {
              if (char === '"') {
                inString = true;
              } else if (char === startChar) {
                balance++;
              } else if (char === endChar) {
                balance--;
              }
            }
            if (!inString && balance === 0 && startIndex === 0) {
              lastValidIndex = i;
              break;
            }
            if (!inString && balance === 1 && startIndex > 0 && i > 0) {
            }
            if (!inString && balance === 0 && i > 0 && startIndex > 0) {
              lastValidIndex = i;
              break;
            }
          }

          if (lastValidIndex !== -1) {
            text = text.substring(0, lastValidIndex + 1);
            try {
              JSON.parse(text);
              jsonString = text;
            } catch (e3) {
              logger.logEvent(
                "warn",
                `JSON sanitization failed (heuristic parse): ${e3.message}`,
                text.substring(0, 100) + "..."
              );
              method = "heuristic failed";
              jsonString = null;
            }
          } else {
            logger.logEvent(
              "warn",
              "JSON sanitization failed: Unbalanced structure after heuristic.",
              text.substring(0, 100)
            );
            method = "heuristic unbalanced";
            jsonString = null;
          }
        } else {
          method = "no structure found";
          jsonString = null;
        }
      }
    }

    logger.logEvent("debug", `JSON sanitization method: ${method}`);
    return jsonString || "{}";
  };

  const callGeminiAPIStream = async (
    prompt,
    sysInstr,
    modelName,
    apiKey,
    funcDecls = [],
    prevContent = null,
    abortSignal,
    generationConfigOverrides = {},
    progressCallback = () => {}
  ) => {
    const apiEndpoint = `${API_ENDPOINT_BASE}${modelName}:streamGenerateContent`;
    logger.logEvent("info", `Streaming API Call: ${modelName}`, {
      endpoint: apiEndpoint,
      hasSysInstr: !!sysInstr,
      toolsCount: funcDecls.length,
      isContinuation: !!prevContent,
    });
    if (progressCallback)
      progressCallback({ type: "status", content: "Starting..." });

    const baseGenCfg = {
      temperature: 0.777,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      ...(generationConfigOverrides || {}),
    };

    const safetySettings = [
      "HARASSMENT",
      "HATE_SPEECH",
      "SEXUALLY_EXPLICIT",
      "DANGEROUS_CONTENT",
    ].map((cat) => ({
      category: `HARM_CATEGORY_${cat}`,
      threshold: "BLOCK_MEDIUM_AND_ABOVE",
    }));

    const reqBody = {
      contents: [],
      safetySettings: safetySettings,
      generationConfig: { ...baseGenCfg },
    };

    if (sysInstr) {
      reqBody.systemInstruction = {
        role: "system",
        parts: [{ text: sysInstr }],
      };
    }

    if (prevContent) {
      reqBody.contents = [...prevContent];
    }
    if (prompt) {
      reqBody.contents.push({ role: "user", parts: [{ text: prompt }] });
    }

    if (funcDecls?.length > 0) {
      reqBody.tools = [{ functionDeclarations: funcDecls }];
      reqBody.tool_config = { function_calling_config: { mode: "AUTO" } };
      delete reqBody.generationConfig.responseMimeType;
    } else {
      reqBody.generationConfig.responseMimeType = "application/json";
    }

    let accumulatedText = "";
    let accumulatedFunctionCall = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalFinishReason = "UNKNOWN";
    let finalRawResponse = null;
    let lastReportedAccumulatedResult = null;
    let responseStatus = 0;
    let responseHeaders = {};
    let blockReason = null;
    let safetyRatings = [];

    try {
      const response = await fetch(`${apiEndpoint}?key=${apiKey}&alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: abortSignal,
      });

      responseStatus = response.status;
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      if (!response.ok || !response.body) {
        let errBodyText = "(Failed to read error body)";
        try {
          errBodyText = await response.text();
        } catch (e) {}
        let errJson = {};
        try {
          errJson = JSON.parse(errBodyText);
        } catch (e) {}
        const errorMessage =
          errJson?.error?.message || response.statusText || errBodyText;
        const error = new Error(
          `API Error (${response.status}): ${errorMessage}`
        );
        error.status = response.status;
        error.headers = responseHeaders;
        error.body = errBodyText;
        throw error;
      }

      if (progressCallback)
        progressCallback({ type: "status", content: "Receiving..." });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (abortSignal?.aborted) {
          const abortError = new Error("Aborted");
          abortError.name = "AbortError";
          throw abortError;
        }
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.substring(6));
              finalRawResponse = chunk;

              if (chunk.promptFeedback?.blockReason) {
                blockReason = chunk.promptFeedback.blockReason;
                safetyRatings = chunk.promptFeedback.safetyRatings || [];
                const blockError = new Error(
                  `API Blocked (Prompt): ${blockReason}`
                );
                blockError.status = 400;
                blockError.reason = "PROMPT_BLOCK";
                blockError.safetyRatings = safetyRatings;
                throw blockError;
              }
              if (chunk.error) {
                const apiError = new Error(
                  `API Error in chunk: ${chunk.error.message || "Unknown"}`
                );
                apiError.status = chunk.error.code || 500;
                apiError.reason = "API_CHUNK_ERROR";
                throw apiError;
              }

              if (chunk.usageMetadata) {
                totalInputTokens =
                  chunk.usageMetadata.promptTokenCount || totalInputTokens;
                totalOutputTokens =
                  chunk.usageMetadata.candidatesTokenCount || totalOutputTokens;
              }

              const candidate = chunk.candidates?.[0];
              if (candidate) {
                if (candidate.tokenCount) {
                  totalOutputTokens = Math.max(
                    totalOutputTokens,
                    candidate.tokenCount
                  );
                }

                finalFinishReason = candidate.finishReason || finalFinishReason;
                safetyRatings = candidate.safetyRatings || safetyRatings;

                if (finalFinishReason === "SAFETY") {
                  blockReason = "SAFETY";
                  const safetyError = new Error(`API Response Blocked: SAFETY`);
                  safetyError.status = 400;
                  safetyError.reason = "RESPONSE_BLOCK_SAFETY";
                  safetyError.safetyRatings = safetyRatings;
                  throw safetyError;
                }
                if (finalFinishReason === "RECITATION") {
                  blockReason = "RECITATION";
                  const recitationError = new Error(
                    `API Response Blocked: RECITATION`
                  );
                  recitationError.status = 400;
                  recitationError.reason = "RESPONSE_BLOCK_RECITATION";
                  throw recitationError;
                }
                if (finalFinishReason === "MAX_TOKENS") {
                  logger.logEvent(
                    "warn",
                    "API response hit MAX_TOKENS limit.",
                    chunk
                  );
                }
                if (finalFinishReason === "OTHER") {
                  logger.logEvent(
                    "warn",
                    `API response finished with reason OTHER.`,
                    chunk
                  );
                }

                const part = candidate.content?.parts?.[0];
                let progressUpdate = null;

                if (part?.text) {
                  accumulatedText += part.text;
                  progressUpdate = {
                    type: "text",
                    content: part.text,
                    accumulated: accumulatedText,
                  };
                } else if (part?.functionCall) {
                  if (!accumulatedFunctionCall) {
                    accumulatedFunctionCall = {
                      name: part.functionCall.name || "",
                      args: {},
                    };
                  } else if (
                    part.functionCall.name &&
                    !accumulatedFunctionCall.name
                  ) {
                    accumulatedFunctionCall.name = part.functionCall.name;
                  }

                  if (
                    typeof part.functionCall.args === "object" &&
                    part.functionCall.args !== null
                  ) {
                    try {
                      Object.assign(
                        accumulatedFunctionCall.args,
                        part.functionCall.args
                      );
                    } catch (mergeError) {
                      logger.logEvent(
                        "warn",
                        `Error merging function call args for ${accumulatedFunctionCall.name}`,
                        mergeError
                      );
                      accumulatedFunctionCall.args = part.functionCall.args;
                    }
                  }
                  logger.logEvent(
                    "debug",
                    `Received function call chunk: ${accumulatedFunctionCall.name}`,
                    part.functionCall.args
                  );
                  progressUpdate = {
                    type: "functionCall",
                    content: part.functionCall,
                    accumulated: { ...accumulatedFunctionCall },
                  };
                }

                if (progressCallback && progressUpdate) {
                  lastReportedAccumulatedResult = {
                    type: accumulatedFunctionCall
                      ? "functionCall"
                      : accumulatedText
                      ? "text"
                      : "empty",
                    content: accumulatedFunctionCall
                      ? { ...accumulatedFunctionCall }
                      : accumulatedText,
                    inputTokenCount: totalInputTokens,
                    outputTokenCount: totalOutputTokens,
                    totalTokenCount: totalInputTokens + totalOutputTokens,
                    finishReason: finalFinishReason,
                    blockReason: blockReason,
                    safetyRatings: safetyRatings,
                    rawResp: finalRawResponse,
                    status: responseStatus,
                    headers: responseHeaders,
                  };
                  progressUpdate.accumulatedResult =
                    lastReportedAccumulatedResult;
                  progressCallback(progressUpdate);
                }
              }
              if (
                progressCallback &&
                (totalInputTokens > 0 || totalOutputTokens > 0)
              ) {
                progressCallback({
                  type: "status",
                  content: `Tokens: In ${totalInputTokens}, Out ${totalOutputTokens}`,
                });
              }
            } catch (e) {
              if (e.name === "AbortError" || e.reason?.includes("_BLOCK"))
                throw e;
              logger.logEvent(
                "warn",
                `Failed to parse/process SSE chunk: ${e.message}`,
                line
              );
            }
          }
        }
      }

      if (finalRawResponse?.usageMetadata) {
        totalInputTokens =
          finalRawResponse.usageMetadata.promptTokenCount || totalInputTokens;
        totalOutputTokens =
          finalRawResponse.usageMetadata.candidatesTokenCount ||
          totalOutputTokens;
      }

      logger.logEvent(
        "info",
        `API Stream OK. Finish:${finalFinishReason}. Tokens In:${totalInputTokens}, Out:${totalOutputTokens}`
      );
      if (progressCallback)
        progressCallback({ type: "status", content: "Done" });

      const finalResult = {
        type: accumulatedFunctionCall
          ? "functionCall"
          : accumulatedText
          ? "text"
          : "empty",
        content: accumulatedFunctionCall
          ? accumulatedFunctionCall
          : accumulatedText,
        inputTokenCount: totalInputTokens,
        outputTokenCount: totalOutputTokens,
        totalTokenCount: totalInputTokens + totalOutputTokens,
        finishReason: finalFinishReason,
        blockReason: blockReason,
        safetyRatings: safetyRatings,
        rawResp: finalRawResponse,
        status: responseStatus,
        headers: responseHeaders,
      };

      if (finalFinishReason === "MAX_TOKENS") {
        finalResult.warning =
          "Response may be truncated due to maximum output token limit.";
      }

      return finalResult;
    } catch (error) {
      if (error.name !== "AbortError") {
        logger.logEvent("error", `API Stream Error: ${error.message}`, {
          status: error.status,
          reason: error.reason,
          safetyRatings: error.safetyRatings,
          error,
        });
      } else {
        logger.logEvent("info", "API call aborted by user or signal.");
      }
      if (progressCallback)
        progressCallback({
          type: "status",
          content: error.name === "AbortError" ? "Aborted" : "Error",
        });
      throw error;
    }
  };

  const callApiWithRetry = async (
    prompt,
    sysInstr,
    modelName,
    apiKey,
    funcDecls = [],
    isContinuation = false,
    prevContent = null,
    maxRetries = 1,
    generationConfigOverrides = {},
    updateStatusFn = () => {},
    logTimelineFn = () => ({}),
    updateTimelineFn = () => {},
    progressCallback = () => {}
  ) => {
    if (currentAbortController) {
      logger.logEvent(
        "warn",
        "Aborting previous API call before starting new one."
      );
      currentAbortController.abort("New call initiated");
    }
    currentAbortController = new AbortController();
    let attempt = 0;
    let currentDelay = RETRY_DELAY_BASE_MS;

    while (attempt <= maxRetries) {
      let logItem = null;
      try {
        const attemptMsg =
          attempt > 0 ? `[RETRY ${attempt}/${maxRetries}]` : "";
        const statusMsg = `${attemptMsg} Calling Gemini (${modelName})...`;
        const currentCycle = StateManager?.getState()?.totalCycles ?? 0;
        if (attempt === 0 && !isContinuation) {
          updateStatusFn(statusMsg, true);
          logItem = logTimelineFn(
            currentCycle,
            `[API] Calling ${modelName}...`,
            "api",
            true,
            true
          );
        } else if (attempt > 0) {
          updateStatusFn(statusMsg, true);
          logItem = logTimelineFn(
            currentCycle,
            `[API RETRY ${attempt}] Calling ${modelName}...`,
            "retry",
            true,
            true
          );
        }

        const result = await callGeminiAPIStream(
          prompt,
          sysInstr,
          modelName,
          apiKey,
          funcDecls,
          prevContent,
          currentAbortController.signal,
          generationConfigOverrides,
          (progress) => {
            if (
              progress.type === "status" &&
              !["Starting...", "Receiving...", "Done"].includes(
                progress.content
              )
            ) {
              if (logItem)
                updateTimelineFn(
                  logItem,
                  `[API:${modelName}] ${progress.content}`,
                  "api",
                  false
                );
            }
            progressCallback(progress);
            if (
              progress.type === "status" &&
              progress.content !== "Starting..."
            ) {
              updateStatusFn(
                progress.content === "Done" ? "Processing..." : progress.content
              );
            }
          }
        );

        if (logItem)
          updateTimelineFn(
            logItem,
            `[API OK:${modelName}] Fin: ${result.finishReason}, TkIn: ${
              result.inputTokenCount
            }, TkOut: ${result.outputTokenCount}, St: ${result.status}${
              result.warning ? " (Warn: Truncated?)" : ""
            }`,
            "api",
            true
          );
        if (!isContinuation) updateStatusFn("Processing...");

        currentAbortController = null;
        return result;
      } catch (error) {
        const isAbort = error.name === "AbortError";
        const wasManuallyAborted =
          isAbort && error.message !== "New call initiated";

        if (isAbort) {
          if (logItem)
            updateTimelineFn(
              logItem,
              `[API Aborted:${modelName}] ${error.message || "User cancelled"}`,
              "warn",
              true
            );
          if (!isContinuation) updateStatusFn("Aborted");
          currentAbortController = null;
          throw error;
        }

        const status = error.status || 0;
        const reason = error.reason || "UNKNOWN_ERROR";
        const errorMessage = error.message || "Unknown API error";

        logger.logEvent(
          "warn",
          `API attempt ${attempt} failed: ${errorMessage}. Status: ${status}, Reason: ${reason}. Retries left: ${
            maxRetries - attempt
          }`
        );
        if (logItem)
          updateTimelineFn(
            logItem,
            `[API ERR ${attempt}:${modelName}] ${status} ${reason} ${String(
              errorMessage
            ).substring(0, 50)} (Retries left: ${maxRetries - attempt})`,
            "error",
            true
          );

        attempt++;
        if (attempt > maxRetries) {
          logger.logEvent(
            "error",
            `API call failed after ${maxRetries} retries.`
          );
          if (!isContinuation)
            updateStatusFn(`API Failed (${status} ${reason})`, false, true);
          currentAbortController = null;
          error.finalAttempt = true;
          throw error;
        }

        let shouldRetry = false;
        let specificDelay = null;

        if (status === 429 || status === 408) {
          shouldRetry = true;
          const retryAfterHeader = error.headers?.["retry-after"];
          if (retryAfterHeader) {
            const retrySeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(retrySeconds)) {
              specificDelay = Math.min(retrySeconds * 1000, RETRY_DELAY_MAX_MS);
              logger.logEvent(
                "info",
                `API Rate limit/Timeout (${status}). Retrying after specified ${retrySeconds}s.`
              );
            }
          }
          if (!specificDelay) {
            logger.logEvent(
              "info",
              `API Rate limit/Timeout (${status}). Retrying with exponential backoff.`
            );
          }
        } else if (status >= 500 && status < 600) {
          shouldRetry = true;
          logger.logEvent(
            "info",
            `API server error (${status}). Retrying with exponential backoff.`
          );
        } else if (
          reason === "PROMPT_BLOCK" ||
          reason === "RESPONSE_BLOCK_SAFETY" ||
          reason === "RESPONSE_BLOCK_RECITATION"
        ) {
          shouldRetry = false;
          logger.logEvent(
            "error",
            `API error non-retryable (content block): ${reason}`,
            error.safetyRatings
          );
        } else if (
          error.message.includes("Failed to fetch") ||
          error.message.includes("NetworkError")
        ) {
          shouldRetry = true;
          logger.logEvent(
            "info",
            `API network error. Retrying with exponential backoff.`
          );
        } else {
          shouldRetry = false;
          logger.logEvent(
            "error",
            `API error deemed non-retryable: Status ${status}, Reason ${reason}, Msg: ${errorMessage}`
          );
        }

        if (!shouldRetry) {
          if (!isContinuation)
            updateStatusFn(`API Failed (${status} Non-retryable)`, false, true);
          currentAbortController = null;
          error.finalAttempt = true;
          throw error;
        }

        const delayMs = specificDelay !== null ? specificDelay : currentDelay;
        if (!isContinuation)
          updateStatusFn(
            `API Error (${status}). Retrying in ${Math.round(
              delayMs / 1000
            )}s...`
          );
        if (currentAbortController?.signal.aborted) {
          const abortError = new Error("Aborted during retry delay");
          abortError.name = "AbortError";
          currentAbortController = null;
          throw abortError;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (currentAbortController?.signal.aborted) {
          const abortError = new Error("Aborted after retry delay");
          abortError.name = "AbortError";
          currentAbortController = null;
          throw abortError;
        }

        currentDelay = Math.min(currentDelay * 2, RETRY_DELAY_MAX_MS);
      }
    }

    const finalError = new Error("callApiWithRetry reached end unexpectedly.");
    currentAbortController = null;
    throw finalError;
  };

  const abortCurrentCall = (reason = "User requested abort") => {
    if (currentAbortController) {
      logger.logEvent(
        "info",
        `User requested API call abort. Reason: ${reason}`
      );
      currentAbortController.abort(reason);
      currentAbortController = null;
    } else {
      logger.logEvent("info", "No active API call to abort.");
    }
  };

  return {
    callApiWithRetry,
    abortCurrentCall,
    sanitizeLlmJsonResp,
  };
};

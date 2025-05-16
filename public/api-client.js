const ApiClientModule = (config, logger, Errors, Utils) => {
  if (!config || !logger || !Errors || !Utils) {
    const internalLog = logger || { logEvent: (lvl, msg, det) => console[lvl === "error" ? "error" : "log"](`[APICLIENT_FALLBACK] ${msg}`, det || "") };
    internalLog.logEvent("error", "ApiClientModule initialization failed: Missing dependencies.");
    return {
      callApiWithRetry: async () => { throw new (Errors?.ApiError || Error)("ApiClient not initialized"); },
      abortCurrentCall: () => { internalLog.logEvent("warn", "ApiClient not initialized, cannot abort."); },
      sanitizeLlmJsonResp: (rawText) => Utils?.sanitizeLlmJsonRespPure(rawText, internalLog).sanitizedJson || "{}",
    };
  }

  let currentAbortController = null;
  const API_ENDPOINT_BASE = config.GEMINI_STREAM_ENDPOINT_BASE || "https://generativelanguage.googleapis.com/v1beta/models/";
  const RETRY_DELAY_BASE_MS = config.API_RETRY_DELAY_BASE_MS || 1500;
  const RETRY_DELAY_MAX_MS = 30000;
  const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
  const { ApiError, AbortError } = Errors;

  const sanitizeLlmJsonResp = (rawText) => {
    const { sanitizedJson, method } = Utils.sanitizeLlmJsonRespPure(rawText, logger);
    logger.logEvent("debug", `JSON sanitization method used: ${method}`);
    return sanitizedJson;
  };

  const callGeminiAPIStream = async (
    prompt, sysInstr, modelName, apiKey, funcDecls = [],
    prevContent = null, abortSignal, generationConfigOverrides = {},
    progressCallback = () => {}
  ) => {
    const apiEndpoint = `${API_ENDPOINT_BASE}${modelName}:streamGenerateContent`;
    logger.logEvent("info", `Streaming API Call: ${modelName}`, {
      endpoint: apiEndpoint, hasSysInstr: !!sysInstr,
      toolsCount: funcDecls.length, isContinuation: !!prevContent,
    });
    if (progressCallback) progressCallback({ type: "status", content: "Starting..." });

    const baseGenCfg = {
      temperature: 0.777,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      ...(generationConfigOverrides || {}),
    };

    const safetySettings = [
      "HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT",
    ].map((cat) => ({ category: `HARM_CATEGORY_${cat}`, threshold: "BLOCK_MEDIUM_AND_ABOVE" }));

    const reqBody = {
      contents: [],
      safetySettings: safetySettings,
      generationConfig: { ...baseGenCfg },
    };

    if (sysInstr) reqBody.systemInstruction = { role: "system", parts: [{ text: sysInstr }] };
    if (prevContent) reqBody.contents = [...prevContent];
    if (prompt) reqBody.contents.push({ role: "user", parts: [{ text: prompt }] });

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
    let blockSafetyRatings = [];

    try {
      const response = await fetch(`${apiEndpoint}?key=${apiKey}&alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: abortSignal,
      });

      responseStatus = response.status;
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });

      if (!response.ok || !response.body) {
        let errBodyText = "(Failed to read error body)";
        try { errBodyText = await response.text(); } catch (e) {}
        let errJson = {};
        try { errJson = JSON.parse(errBodyText); } catch (e) {}
        const errorMessage = errJson?.error?.message || response.statusText || errBodyText;
        throw new ApiError(`API Error (${response.status}): ${errorMessage}`, response.status, null, { body: errBodyText, headers: responseHeaders });
      }

      if (progressCallback) progressCallback({ type: "status", content: "Receiving..." });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (abortSignal?.aborted) throw new AbortError("Aborted by signal");
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
                blockSafetyRatings = chunk.promptFeedback.safetyRatings || [];
                throw new ApiError(`API Blocked (Prompt): ${blockReason}`, 400, "PROMPT_BLOCK", { safetyRatings: blockSafetyRatings });
              }
              if (chunk.error) {
                throw new ApiError(`API Error in chunk: ${chunk.error.message || "Unknown"}`, chunk.error.code || 500, "API_CHUNK_ERROR");
              }

              if (chunk.usageMetadata) {
                totalInputTokens = chunk.usageMetadata.promptTokenCount || totalInputTokens;
                totalOutputTokens = chunk.usageMetadata.candidatesTokenCount || totalOutputTokens;
              }

              const candidate = chunk.candidates?.[0];
              if (candidate) {
                if (candidate.tokenCount) totalOutputTokens = Math.max(totalOutputTokens, candidate.tokenCount);
                finalFinishReason = candidate.finishReason || finalFinishReason;
                const currentSafetyRatings = candidate.safetyRatings || [];

                if (finalFinishReason === "SAFETY") {
                  blockReason = "SAFETY";
                  throw new ApiError("API Response Blocked: SAFETY", 400, "RESPONSE_BLOCK_SAFETY", { safetyRatings: currentSafetyRatings });
                }
                if (finalFinishReason === "RECITATION") {
                  blockReason = "RECITATION";
                  throw new ApiError("API Response Blocked: RECITATION", 400, "RESPONSE_BLOCK_RECITATION");
                }
                if (finalFinishReason === "MAX_TOKENS") logger.logEvent("warn", "API response hit MAX_TOKENS limit.", chunk);
                if (finalFinishReason === "OTHER") logger.logEvent("warn", `API response finished with reason OTHER.`, chunk);

                const part = candidate.content?.parts?.[0];
                let progressUpdate = null;

                if (part?.text) {
                  accumulatedText += part.text;
                  progressUpdate = { type: "text", content: part.text, accumulated: accumulatedText };
                } else if (part?.functionCall) {
                  if (!accumulatedFunctionCall) accumulatedFunctionCall = { name: part.functionCall.name || "", args: {} };
                  else if (part.functionCall.name && !accumulatedFunctionCall.name) accumulatedFunctionCall.name = part.functionCall.name;

                  if (typeof part.functionCall.args === "object" && part.functionCall.args !== null) {
                    try { Object.assign(accumulatedFunctionCall.args, part.functionCall.args); }
                    catch (mergeError) {
                      logger.logEvent("warn", `Error merging function call args for ${accumulatedFunctionCall.name}`, mergeError);
                      accumulatedFunctionCall.args = part.functionCall.args;
                    }
                  }
                  progressUpdate = { type: "functionCall", content: part.functionCall, accumulated: { ...accumulatedFunctionCall } };
                }

                if (progressCallback && progressUpdate) {
                  lastReportedAccumulatedResult = {
                    type: accumulatedFunctionCall ? "functionCall" : accumulatedText ? "text" : "empty",
                    content: accumulatedFunctionCall ? { ...accumulatedFunctionCall } : accumulatedText,
                    inputTokenCount: totalInputTokens, outputTokenCount: totalOutputTokens,
                    totalTokenCount: totalInputTokens + totalOutputTokens,
                    finishReason: finalFinishReason, blockReason: blockReason,
                    safetyRatings: currentSafetyRatings, rawResp: finalRawResponse,
                    status: responseStatus, headers: responseHeaders,
                  };
                  progressUpdate.accumulatedResult = lastReportedAccumulatedResult;
                  progressCallback(progressUpdate);
                }
              }
              if (progressCallback && (totalInputTokens > 0 || totalOutputTokens > 0)) {
                progressCallback({ type: "status", content: `Tokens: In ${totalInputTokens}, Out ${totalOutputTokens}` });
              }
            } catch (e) {
              if (e instanceof AbortError || e instanceof ApiError) throw e;
              logger.logEvent("warn", `Failed to parse/process SSE chunk: ${e.message}`, line);
            }
          }
        }
      }

      if (finalRawResponse?.usageMetadata) {
        totalInputTokens = finalRawResponse.usageMetadata.promptTokenCount || totalInputTokens;
        totalOutputTokens = finalRawResponse.usageMetadata.candidatesTokenCount || totalOutputTokens;
      }

      logger.logEvent("info", `API Stream OK. Finish:${finalFinishReason}. Tokens In:${totalInputTokens}, Out:${totalOutputTokens}`);
      if (progressCallback) progressCallback({ type: "status", content: "Done" });

      const finalResult = {
        type: accumulatedFunctionCall ? "functionCall" : accumulatedText ? "text" : "empty",
        content: accumulatedFunctionCall ? accumulatedFunctionCall : accumulatedText,
        inputTokenCount: totalInputTokens, outputTokenCount: totalOutputTokens,
        totalTokenCount: totalInputTokens + totalOutputTokens,
        finishReason: finalFinishReason, blockReason: blockReason,
        safetyRatings: finalRawResponse?.candidates?.[0]?.safetyRatings || blockSafetyRatings,
        rawResp: finalRawResponse, status: responseStatus, headers: responseHeaders,
      };
      if (finalFinishReason === "MAX_TOKENS") finalResult.warning = "Response may be truncated due to maximum output token limit.";
      return finalResult;

    } catch (error) {
      if (!(error instanceof AbortError)) {
        logger.logEvent("error", `API Stream Error: ${error.message}`, { status: error.status, reason: error.code, details: error.details, error });
      } else {
        logger.logEvent("info", "API call aborted by user or signal.");
      }
      if (progressCallback) progressCallback({ type: "status", content: error instanceof AbortError ? "Aborted" : "Error" });
      throw error;
    }
  };

  const callApiWithRetry = async (
    prompt, sysInstr, modelName, apiKey, funcDecls = [],
    isContinuation = false, prevContent = null, maxRetries = 1,
    generationConfigOverrides = {},
    updateStatusFn = () => {}, logTimelineFn = () => ({}), updateTimelineFn = () => {},
    progressCallback = () => {}
  ) => {
    if (currentAbortController) {
      logger.logEvent("warn", "Aborting previous API call before starting new one.");
      currentAbortController.abort("New call initiated");
    }
    currentAbortController = new AbortController();
    let attempt = 0;
    let currentDelay = RETRY_DELAY_BASE_MS;

    while (attempt <= maxRetries) {
      let logItem = null;
      try {
        const attemptMsg = attempt > 0 ? `[RETRY ${attempt}/${maxRetries}]` : "";
        const statusMsg = `${attemptMsg} Calling Gemini (${modelName})...`;
        const currentCycle = StateManager?.getState()?.totalCycles ?? 0;

        if (attempt === 0 && !isContinuation) {
          updateStatusFn(statusMsg, true);
          logItem = logTimelineFn(currentCycle, `[API] Calling ${modelName}...`, "api", true, true);
        } else if (attempt > 0) {
          updateStatusFn(statusMsg, true);
          logItem = logTimelineFn(currentCycle, `[API RETRY ${attempt}] Calling ${modelName}...`, "retry", true, true);
        }

        const result = await callGeminiAPIStream(
          prompt, sysInstr, modelName, apiKey, funcDecls, prevContent,
          currentAbortController.signal, generationConfigOverrides,
          (progress) => {
            if (progress.type === "status" && !["Starting...", "Receiving...", "Done"].includes(progress.content)) {
              if (logItem) updateTimelineFn(logItem, `[API:${modelName}] ${progress.content}`, "api", false);
            }
            progressCallback(progress);
            if (progress.type === "status" && progress.content !== "Starting...") {
              updateStatusFn(progress.content === "Done" ? "Processing..." : progress.content);
            }
          }
        );

        if (logItem) updateTimelineFn(logItem, `[API OK:${modelName}] Fin: ${result.finishReason}, TkIn: ${result.inputTokenCount}, TkOut: ${result.outputTokenCount}, St: ${result.status}${result.warning ? " (Warn: Truncated?)" : ""}`, "api", true);
        if (!isContinuation) updateStatusFn("Processing...");
        currentAbortController = null;
        return result;

      } catch (error) {
        if (error instanceof AbortError) {
          if (logItem) updateTimelineFn(logItem, `[API Aborted:${modelName}] ${error.message || "User cancelled"}`, "warn", true);
          if (!isContinuation) updateStatusFn("Aborted");
          currentAbortController = null;
          throw error;
        }

        const status = error.status || 0;
        const reason = error.code || "UNKNOWN_ERROR";
        const errorMessage = error.message || "Unknown API error";

        logger.logEvent("warn", `API attempt ${attempt} failed: ${errorMessage}. Status: ${status}, Reason: ${reason}. Retries left: ${maxRetries - attempt}`);
        if (logItem) updateTimelineFn(logItem, `[API ERR ${attempt}:${modelName}] ${status} ${reason} ${String(errorMessage).substring(0,50)} (Retries left: ${maxRetries - attempt})`, "error", true);

        attempt++;
        if (attempt > maxRetries) {
          logger.logEvent("error", `API call failed after ${maxRetries} retries.`);
          if (!isContinuation) updateStatusFn(`API Failed (${status} ${reason})`, false, true);
          currentAbortController = null;
          throw new ApiError(`API call failed after ${maxRetries} retries: ${errorMessage}`, status, reason, { finalAttempt: true, originalError: error });
        }

        let shouldRetry = false;
        let specificDelay = null;

        if (status === 429 || status === 408) {
          shouldRetry = true;
          const retryAfterHeader = error.details?.headers?.["retry-after"];
          if (retryAfterHeader) {
            const retrySeconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(retrySeconds)) {
              specificDelay = Math.min(retrySeconds * 1000, RETRY_DELAY_MAX_MS);
              logger.logEvent("info", `API Rate limit/Timeout (${status}). Retrying after specified ${retrySeconds}s.`);
            }
          }
          if (!specificDelay) logger.logEvent("info", `API Rate limit/Timeout (${status}). Retrying with exponential backoff.`);
        } else if (status >= 500 && status < 600) {
          shouldRetry = true;
          logger.logEvent("info", `API server error (${status}). Retrying with exponential backoff.`);
        } else if (reason === "PROMPT_BLOCK" || reason === "RESPONSE_BLOCK_SAFETY" || reason === "RESPONSE_BLOCK_RECITATION") {
          shouldRetry = false;
          logger.logEvent("error", `API error non-retryable (content block): ${reason}`, error.details?.safetyRatings);
        } else if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError")) {
          shouldRetry = true;
          logger.logEvent("info", `API network error. Retrying with exponential backoff.`);
        } else {
          shouldRetry = false;
          logger.logEvent("error", `API error deemed non-retryable: Status ${status}, Reason ${reason}, Msg: ${errorMessage}`);
        }

        if (!shouldRetry) {
          if (!isContinuation) updateStatusFn(`API Failed (${status} Non-retryable)`, false, true);
          currentAbortController = null;
          throw new ApiError(`API call failed (non-retryable): ${errorMessage}`, status, reason, { finalAttempt: true, originalError: error });
        }

        const delayMs = specificDelay !== null ? specificDelay : currentDelay;
        if (!isContinuation) updateStatusFn(`API Error (${status}). Retrying in ${Math.round(delayMs / 1000)}s...`);
        if (currentAbortController?.signal.aborted) { currentAbortController = null; throw new AbortError("Aborted during retry delay"); }
        await Utils.delay(delayMs);
        if (currentAbortController?.signal.aborted) { currentAbortController = null; throw new AbortError("Aborted after retry delay"); }
        currentDelay = Math.min(currentDelay * 2, RETRY_DELAY_MAX_MS);
      }
    }
    currentAbortController = null;
    throw new ApiError("callApiWithRetry reached end unexpectedly.", 500, "UNEXPECTED_END");
  };

  const abortCurrentCall = (reason = "User requested abort") => {
    if (currentAbortController) {
      logger.logEvent("info", `User requested API call abort. Reason: ${reason}`);
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
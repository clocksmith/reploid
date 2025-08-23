// Standardized API Client Module for REPLOID
// Handles all communication with the Gemini API

const ApiClient = {
  metadata: {
    id: 'ApiClient',
    version: '1.0.0',
    dependencies: ['config', 'logger', 'Errors', 'Utils', 'StateManager'],
    async: false,
    type: 'service'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, logger, Errors, Utils, StateManager } = deps;
    
    if (!config || !logger || !Errors || !Utils || !StateManager) {
      throw new Error('ApiClient: Missing required dependencies');
    }
    
    // Extract error classes
    const { ApiError, AbortError } = Errors;
    
    // Module state
    let currentAbortController = null;
    const API_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
    
    // Private functions
    const sanitizeLlmJsonResp = (rawText) => {
      return Utils.sanitizeLlmJsonRespPure(rawText, logger).sanitizedJson;
    };
    
    const callApiWithRetry = async (history, apiKey, funcDecls = []) => {
      // Abort any existing call
      if (currentAbortController) {
        currentAbortController.abort("New call initiated");
      }
      currentAbortController = new AbortController();
      
      const modelName = "gemini-1.5-flash-latest";
      const apiEndpoint = `${API_ENDPOINT_BASE}${modelName}:generateContent`;
      
      const reqBody = {
        contents: history,
        safetySettings: [
          "HARASSMENT", "HATE_SPEECH", "SEXUALLY_EXPLICIT", "DANGEROUS_CONTENT"
        ].map(cat => ({ 
          category: `HARM_CATEGORY_${cat}`, 
          threshold: "BLOCK_ONLY_HIGH" 
        })),
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 8192,
          responseMimeType: "application/json"
        },
      };
      
      // Add function declarations if provided
      if (funcDecls && funcDecls.length > 0) {
        reqBody.tools = [{ functionDeclarations: funcDecls }];
        reqBody.tool_config = { function_calling_config: { mode: "AUTO" } };
        delete reqBody.generationConfig.responseMimeType;
      }
      
      try {
        const response = await fetch(`${apiEndpoint}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
          signal: currentAbortController.signal,
        });
        
        if (!response.ok) {
          const errBody = await response.text();
          throw new ApiError(
            `API Error (${response.status}): ${errBody}`, 
            response.status
          );
        }
        
        const data = await response.json();
        
        // Validate response
        if (!data.candidates || data.candidates.length === 0) {
          if (data.promptFeedback && data.promptFeedback.blockReason) {
            throw new ApiError(
              `Request blocked: ${data.promptFeedback.blockReason}`, 
              400, 
              "PROMPT_BLOCK", 
              data.promptFeedback
            );
          }
          throw new ApiError("API returned no candidates.", 500, "NO_CANDIDATES");
        }
        
        // Extract result
        const candidate = data.candidates[0];
        const part = candidate.content.parts[0];
        
        let resultType = "empty";
        let resultContent = "";
        
        if (part.text) {
          resultType = "text";
          resultContent = part.text;
        } else if (part.functionCall) {
          resultType = "functionCall";
          resultContent = part.functionCall;
        }
        
        return {
          type: resultType,
          content: resultContent,
          rawResp: data,
        };
        
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new AbortError("API call aborted.");
        }
        logger.error("API Call Failed", error);
        throw error;
      } finally {
        currentAbortController = null;
      }
    };
    
    const abortCurrentCall = (reason = "User requested abort") => {
      if (currentAbortController) {
        currentAbortController.abort(reason);
        currentAbortController = null;
      }
    };
    
    // Public API
    return {
      api: {
        callApiWithRetry,
        abortCurrentCall,
        sanitizeLlmJsonResp
      }
    };
  }
};

// Legacy compatibility wrapper
const ApiClientModule = (config, logger, Errors, Utils, StateManager) => {
  const instance = ApiClient.factory({ config, logger, Errors, Utils, StateManager });
  return instance.api;
};

// Export both formats for compatibility
ApiClient;
ApiClientModule;
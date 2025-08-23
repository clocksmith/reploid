// Standardized Utils Module for REPLOID
// Core utilities, error classes, and helper functions

const Utils = {
  metadata: {
    id: 'Utils',
    version: '1.0.0',
    dependencies: [],  // No dependencies - pure utility module
    async: false,
    type: 'pure'
  },
  
  factory: (deps = {}) => {
    // Define error classes
    class ApplicationError extends Error {
      constructor(message, details = {}) {
        super(message);
        this.name = this.constructor.name;
        this.details = details;
      }
    }
    
    class ApiError extends ApplicationError {}
    class ToolError extends ApplicationError {}
    class StateError extends ApplicationError {}
    class ConfigError extends ApplicationError {}
    class ArtifactError extends ApplicationError {}
    class AbortError extends ApplicationError {}
    class WebComponentError extends ApplicationError {}
    
    const Errors = { 
      ApplicationError, 
      ApiError, 
      ToolError, 
      StateError, 
      ConfigError, 
      ArtifactError, 
      AbortError, 
      WebComponentError 
    };
    
    // Logger utility
    const logger = {
      logEvent: (level, message, ...details) => 
        console[level] 
          ? console[level](`[${level.toUpperCase()}] ${message}`, ...details) 
          : console.log(`[${level.toUpperCase()}] ${message}`, ...details),
      debug: (...args) => logger.logEvent('debug', ...args),
      info: (...args) => logger.logEvent('info', ...args),
      warn: (...args) => logger.logEvent('warn', ...args),
      error: (...args) => logger.logEvent('error', ...args),
    };
    
    // Helper functions
    const kabobToCamel = (s) => s.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    
    const trunc = (str, len) => 
      (str.length > len ? str.substring(0, len - 3) + "..." : str);
    
    const escapeHtml = (unsafe) => 
      String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    
    const sanitizeLlmJsonRespPure = (rawText, externalLogger) => {
      if (!rawText || typeof rawText !== "string") {
        return { sanitizedJson: "{}", method: "invalid input" };
      }
      
      let text = rawText.trim();
      let jsonString = null;
      let method = "none";
      
      // Check for code block
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        text = codeBlockMatch[1].trim();
        method = "code block";
      }
      
      // Try direct parse
      try {
        JSON.parse(text);
        jsonString = text;
        method = method === 'code block' ? 'code block' : 'direct parse';
      } catch (e) {
        // Try heuristic extraction
        const firstBrace = text.indexOf("{");
        if (firstBrace !== -1) {
          const lastBrace = text.lastIndexOf("}");
          if (lastBrace > firstBrace) {
            text = text.substring(firstBrace, lastBrace + 1);
            method = "heuristic slice";
            try {
              JSON.parse(text);
              jsonString = text;
            } catch (e2) {
              externalLogger?.warn('JSON sanitization failed after heuristic slice', e2.message);
              jsonString = null;
            }
          }
        }
      }
      
      return { sanitizedJson: jsonString || "{}", method };
    };
    
    // Public API
    return {
      Errors,
      logger,
      kabobToCamel,
      trunc,
      escapeHtml,
      sanitizeLlmJsonRespPure
    };
  }
};

// Legacy compatibility wrapper
const UtilsModule = (() => {
  return Utils.factory({});
})();

// Export both formats
Utils;
UtilsModule;
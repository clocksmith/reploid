/**
 * @file Custom error classes for more specific error handling across REPLOID.
 */

/**
 * Base class for custom application errors.
 * @param {string} message - Error message.
 * @param {object} [details={}] - Additional details about the error.
 */
class ApplicationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

/**
 * Error related to API interactions (e.g., Gemini API).
 * @param {string} message - Error message.
 * @param {number|null} [status=null] - HTTP status code from API response.
 * @param {string|null} [code=null] - API-specific error code.
 * @param {object} [apiDetails={}] - Other API-related details.
 */
class ApiError extends ApplicationError {
  constructor(message, status = null, code = null, apiDetails = {}) {
    super(message, { status, code, ...apiDetails });
    this.status = status;
    this.code = code;
  }
}

/**
 * Error related to tool execution (static or dynamic).
 * @param {string} message - Error message.
 * @param {string|null} [toolName=null] - Name of the tool that failed.
 * @param {object|null} [toolArgs=null] - Arguments passed to the tool.
 * @param {object} [toolDetails={}] - Other tool-related details.
 */
class ToolError extends ApplicationError {
  constructor(message, toolName = null, toolArgs = null, toolDetails = {}) {
    super(message, { toolName, toolArgs, ...toolDetails });
    this.toolName = toolName;
  }
}

/**
 * Error related to state management or invalid state.
 * @param {string} message - Error message.
 * @param {object} [stateDetails={}] - Details about the state issue.
 */
class StateError extends ApplicationError {
  constructor(message, stateDetails = {}) {
    super(message, stateDetails);
  }
}

/**
 * Error related to configuration issues.
 * @param {string} message - Error message.
 * @param {string|null} [configKey=null] - Configuration key related to the error.
 * @param {object} [configDetails={}] - Other configuration-related details.
 */
class ConfigError extends ApplicationError {
  constructor(message, configKey = null, configDetails = {}) {
    super(message, { configKey, ...configDetails });
    this.configKey = configKey;
  }
}

/**
 * Error related to artifact processing or validation.
 * @param {string} message - Error message.
 * @param {string|null} [artifactId=null] - ID of the artifact related to the error.
 * @param {number|null} [artifactCycle=null] - Cycle of the artifact.
 * @param {object} [artifactDetails={}] - Other artifact-related details.
 */
class ArtifactError extends ApplicationError {
  constructor(
    message,
    artifactId = null,
    artifactCycle = null,
    artifactDetails = {}
  ) {
    super(message, { artifactId, artifactCycle, ...artifactDetails });
    this.artifactId = artifactId;
  }
}

/**
 * Error indicating a user or system abort request.
 * @param {string} [message="Operation aborted"] - Abort message.
 */
class AbortError extends ApplicationError {
  constructor(message = "Operation aborted") {
    super(message);
    this.isAbortError = true;
  }
}

/**
 * Error related to Web Component definition or registration.
 * @param {string} message - Error message.
 * @param {string|null} [componentName=null] - Name of the Web Component.
 * @param {object} [componentDetails={}] - Other Web Component related details.
 */
class WebComponentError extends ApplicationError {
  constructor(message, componentName = null, componentDetails = {}) {
    super(message, { componentName, ...componentDetails });
    this.componentName = componentName;
  }
}

// Make errors available globally if running in a browser context without modules
if (typeof window !== "undefined") {
  window.ApplicationError = ApplicationError;
  window.ApiError = ApiError;
  window.ToolError = ToolError;
  window.StateError = StateError;
  window.ConfigError = ConfigError;
  window.ArtifactError = ArtifactError;
  window.AbortError = AbortError;
  window.WebComponentError = WebComponentError;
}

// Export for potential module usage
const Errors = {
  ApplicationError,
  ApiError,
  ToolError,
  StateError,
  ConfigError,
  ArtifactError,
  AbortError,
  WebComponentError,
};

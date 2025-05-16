const ToolRunnerPureHelpersModule = (() => {

  function mapMcpTypeToGeminiPure(mcpType, externalLogger) {
    switch (mcpType?.toLowerCase()) {
      case "string": return "STRING";
      case "integer": return "INTEGER";
      case "number": return "NUMBER";
      case "boolean": return "BOOLEAN";
      case "array": return "ARRAY";
      case "object": return "OBJECT";
      default:
        externalLogger?.logEvent("warn", `Unsupported MCP type encountered in pure helper: ${mcpType}`);
        return "TYPE_UNSPECIFIED";
    }
  }

  function convertMcpPropertiesToGeminiPure(mcpProps, externalLogger) {
    if (!mcpProps) return {};
    const geminiProps = {};
    for (const key in mcpProps) {
      const mcpProp = mcpProps[key];
      geminiProps[key] = {
        type: mapMcpTypeToGeminiPure(mcpProp.type, externalLogger),
        description: mcpProp.description || "",
      };
      if (mcpProp.enum) geminiProps[key].enum = mcpProp.enum;
      if (mcpProp.type === "array" && mcpProp.items) {
        geminiProps[key].items = { type: mapMcpTypeToGeminiPure(mcpProp.items.type, externalLogger) };
      }
      if (mcpProp.type === "object" && mcpProp.properties) {
        geminiProps[key].properties = convertMcpPropertiesToGeminiPure(mcpProp.properties, externalLogger);
        if (mcpProp.required) geminiProps[key].required = mcpProp.required;
      }
    }
    return geminiProps;
  }

  function convertToGeminiFunctionDeclarationPure(mcpToolDefinition, externalLogger) {
    if (!mcpToolDefinition || !mcpToolDefinition.name || !mcpToolDefinition.description) {
        externalLogger?.logEvent("error", "Invalid MCP tool definition for Gemini FC conversion.", mcpToolDefinition);
        return null;
    }
    return {
        name: mcpToolDefinition.name,
        description: mcpToolDefinition.description,
        parameters: {
            type: "OBJECT",
            properties: convertMcpPropertiesToGeminiPure(mcpToolDefinition.inputSchema?.properties, externalLogger),
            required: mcpToolDefinition.inputSchema?.required || [],
        },
    };
  }

  function basicCodeLintPure(code, language) {
    let hasError = false;
    let errorMessage = "";
    try {
      if (!code && language !== "web_component_def") { // web_component_def might be an empty class initially
          return { linting_passed: true, error_message: null }; // or false if empty is an error for other types
      }
      if (language === "json") {
        JSON.parse(code);
      } else if (language === "html") {
        if (code.includes("<script") && !code.includes("</script>")) {
          hasError = true; errorMessage = "Potentially unclosed script tag.";
        }
      } else if (language === "javascript" || language === "web_component_def") {
        if ((code.match(/{/g) || []).length !== (code.match(/}/g) || []).length ||
            (code.match(/\(/g) || []).length !== (code.match(/\)/g) || []).length) {
          hasError = true; errorMessage = "Mismatched braces or parentheses.";
        }
      }
    } catch (e) {
      hasError = true; errorMessage = e.message;
    }
    return { linting_passed: !hasError, error_message: hasError ? errorMessage : null };
  }

  function validateJsonStructurePure(jsonString) {
    try {
        if (!jsonString) return { valid: false, error: "Input string is null or empty."};
        JSON.parse(jsonString);
        return { valid: true, error: null };
    } catch (e) {
        return { valid: false, error: e.message };
    }
  }

  function diffTextPure(textA, textB) {
    if (textA === textB) return { differences: false, summary: "Texts are identical." };
    return { differences: true, summary: "Texts differ (detailed diff not implemented in pure helper)." };
  }


  return {
    mapMcpTypeToGeminiPure,
    convertMcpPropertiesToGeminiPure,
    convertToGeminiFunctionDeclarationPure,
    basicCodeLintPure,
    validateJsonStructurePure,
    diffTextPure
  };
})();
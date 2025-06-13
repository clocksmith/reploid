const ToolRunnerModule = (
  config,
  logger,
  Storage,
  StateManager,
  ApiClient,
  Errors,
  Utils,
  ToolRunnerPureHelpers
) => {

  const { ToolError, ArtifactError } = Errors;

  const runTool = async (
    toolName,
    toolArgs,
    injectedStaticTools,
    injectedDynamicTools
  ) => {
    logger.logEvent("info", `Run tool: ${toolName}`, toolArgs || {});
    const staticTool = injectedStaticTools.find((t) => t.name === toolName);

    if (staticTool) {
      switch (toolName) {
        case "read_artifact":
          const content = Storage.getArtifactContent(toolArgs.path);
          if (content === null) {
            throw new ArtifactError(`Artifact not found at path: ${toolArgs.path}`, toolArgs.path);
          }
          return { content };

        case "list_artifacts":
          const allMeta = StateManager.getAllArtifactMetadata();
          let paths = Object.keys(allMeta);
          if (toolArgs.path) {
            paths = paths.filter(p => p.startsWith(toolArgs.path));
          }
          return { paths };

        default:
          throw new ToolError(`Static tool '${toolName}' is not implemented in the primordial tool runner.`);
      }
    }
    
    // Dynamic tools not supported in primordial version
    throw new ToolError(`Tool not found: ${toolName}`);
  };

  const convertToGeminiFunctionDeclaration = (mcpToolDefinition) => {
      return ToolRunnerPureHelpers.convertToGeminiFunctionDeclarationPure(mcpToolDefinition);
  };

  return {
    runTool,
    convertToGeminiFunctionDeclaration
  };
};
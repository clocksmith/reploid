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
    const allTools = [...injectedStaticTools, ...injectedDynamicTools.map(t=>t.declaration)];
    const toolDef = allTools.find((t) => t.name === toolName);
    
    if (!toolDef) {
        throw new ToolError(`Tool not found: ${toolName}`);
    }

    if (injectedStaticTools.some(t => t.name === toolName)) {
      switch (toolName) {
        case "read_artifact":
          const content = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version);
          if (content === null) {
            throw new ArtifactError(`Artifact not found at path: ${toolArgs.path} (version: ${toolArgs.version || 'latest'})`, toolArgs.path);
          }
          return { content };

        case "list_artifacts":
          const allMeta = await StateManager.getAllArtifactMetadata();
          let paths = Object.keys(allMeta);
          if (toolArgs.path) {
            paths = paths.filter(p => p.startsWith(toolArgs.path));
          }
          return { paths };
          
        case "diff_artifacts":
            const contentA = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version_a);
            const contentB = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version_b);
            if (contentA === null || contentB === null) {
                throw new ArtifactError(`One or both artifact versions not found for diffing: ${toolArgs.path}`);
            }
            // Basic diff for now, a proper library would be better.
            return { diff: `(Basic diff not implemented. Len A: ${contentA.length}, Len B: ${contentB.length})`, differences: contentA !== contentB };

        case "get_artifact_history":
            const meta = StateManager.getArtifactMetadata(toolArgs.path);
            return meta ? meta.versions : [];

        case "search_vfs":
            // This would be slow. In a real system, an index would be needed.
            const allArtifacts = await StateManager.getAllArtifactMetadata();
            const results = [];
            const regex = toolArgs.is_regex ? new RegExp(toolArgs.query) : null;
            for (const path in allArtifacts) {
                const fileContent = await StateManager.getArtifactContent(path);
                if (fileContent) {
                    if (regex && regex.test(fileContent)) {
                        results.push(path);
                    } else if (!regex && fileContent.includes(toolArgs.query)) {
                        results.push(path);
                    }
                }
            }
            return { results };

        default:
          throw new ToolError(`Static tool '${toolName}' is not implemented.`);
      }
    }
    
    throw new ToolError(`Dynamic tool execution for '${toolName}' is not yet implemented.`);
  };

  const convertToGeminiFunctionDeclaration = (mcpToolDefinition) => {
      return ToolRunnerPureHelpers.convertToGeminiFunctionDeclarationPure(mcpToolDefinition);
  };

  return {
    runTool,
    convertToGeminiFunctionDeclaration
  };
};
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
        case "read_artifact": {
          const content = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version);
          if (content === null) {
            throw new ArtifactError(`Artifact not found at path: ${toolArgs.path} (version: ${toolArgs.version || 'latest'})`, toolArgs.path);
          }
          return { content };
        }

        case "list_artifacts": {
          const allMeta = await StateManager.getAllArtifactMetadata();
          let paths = Object.keys(allMeta);
          if (toolArgs.path) {
            paths = paths.filter(p => p.startsWith(toolArgs.path));
          }
          return { paths };
        }
          
        case "diff_artifacts": {
            const contentA = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version_a);
            const contentB = await StateManager.getArtifactContent(toolArgs.path, toolArgs.version_b);
            if (contentA === null || contentB === null) {
                throw new ArtifactError(`One or both artifact versions not found for diffing: ${toolArgs.path}`);
            }
            // Basic diff for now, a proper library would be better.
            return { diff: `(Basic diff not implemented. Len A: ${contentA.length}, Len B: ${contentB.length})`, differences: contentA !== contentB };
        }

        case "get_artifact_history": {
            const meta = StateManager.getArtifactMetadata(toolArgs.path);
            return meta ? meta.versions : [];
        }

        case "search_vfs": {
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
        }

        case "write_artifact": {
            // Create or update an artifact to enable self-modification
            const { path, content, metadata } = toolArgs;
            if (!path || !content) {
                throw new ToolError("write_artifact requires both 'path' and 'content' parameters");
            }
            
            // Check if artifact exists to decide between create and update
            const existingMeta = await StateManager.getArtifactMetadata(path);
            let success;
            
            try {
                if (existingMeta) {
                    // Update existing artifact
                    success = await StateManager.updateArtifact(path, content);
                } else {
                    // Create new artifact
                    const type = path.endsWith('.js') ? 'javascript' : 
                                path.endsWith('.css') ? 'css' : 
                                path.endsWith('.html') ? 'html' : 
                                path.endsWith('.json') ? 'json' : 
                                path.endsWith('.md') ? 'markdown' : 'text';
                    success = await StateManager.createArtifact(
                        path, 
                        type, 
                        content, 
                        metadata?.reason || "Agent-created artifact"
                    );
                }
            } catch (e) {
                throw new ArtifactError(`Failed to write artifact at path: ${path} - ${e.message}`);
            }
            
            logger.logEvent("info", `Artifact written: ${path}`, metadata?.reason || "No reason provided");
            return { 
                success: true, 
                path: path,
                size: content.length,
                reason: metadata?.reason || "Self-modification" 
            };
        }

        case "delete_artifact": {
            // Delete an artifact - use with extreme caution
            const deletePath = toolArgs.path;
            const deleteReason = toolArgs.reason;
            
            if (!deletePath || !deleteReason) {
                throw new ToolError("delete_artifact requires both 'path' and 'reason' parameters");
            }
            
            // Check if artifact exists
            const artifactToDelete = await StateManager.getArtifactMetadata(deletePath);
            if (!artifactToDelete) {
                throw new ArtifactError(`Cannot delete non-existent artifact: ${deletePath}`);
            }
            
            // Perform deletion
            const deleteSuccess = await StateManager.deleteArtifact(deletePath);
            
            logger.logEvent("warn", `Artifact DELETED: ${deletePath}`, deleteReason);
            return { 
                success: deleteSuccess, 
                path: deletePath,
                reason: deleteReason,
                warning: "Artifact permanently deleted from VFS" 
            };
        }

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
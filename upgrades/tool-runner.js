// Standardized Tool Runner Module for REPLOID
// Executes static and dynamic tools within the agent

const ToolRunner = {
  metadata: {
    id: 'ToolRunner',
    version: '1.0.0',
    dependencies: ['config', 'Storage', 'StateManager', 'ApiClient', 'Utils', 'ToolRunnerPureHelpers'],
    async: false,
    type: 'service'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, Storage, StateManager, ApiClient, Utils, ToolRunnerPureHelpers } = deps;
    const { logger, Errors } = Utils;
    
    if (!config || !logger || !Storage || !StateManager || !ApiClient || !Errors || !Utils || !ToolRunnerPureHelpers) {
      throw new Error('ToolRunner: Missing required dependencies');
    }
    
    const { ToolError, ArtifactError } = Errors;

  const runTool = async (
    toolName,
    toolArgs,
    injectedStaticTools,
    injectedDynamicTools
  ) => {
    logger.logEvent("info", `Run tool: ${toolName}`, toolArgs || {});
    UI.logToAdvanced(`Running tool: ${toolName} with args: ${JSON.stringify(toolArgs)}`);
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

        case "system.backup": {
          try {
            // StateManager doesn't have a getAllArtifacts, so we get all keys and then get content for each
            const allMeta = await StateManager.getAllArtifactMetadata();
            const allArtifacts = {};
            for (const path of Object.keys(allMeta)) {
                allArtifacts[path] = await StateManager.getArtifactContent(path);
            }
            const result = await Utils.post('/api/vfs/backup', allArtifacts);
            return { success: true, message: result.message };
          } catch (error) {
            throw new ToolError(`System backup failed: ${error.message}`);
          }
        }

        default:
          throw new ToolError(`Static tool '${toolName}' is not implemented.`);
      }
    }
    
    // Execute dynamic tool
    const dynamicTool = injectedDynamicTools.find(t => t.declaration.name === toolName);
    if (dynamicTool) {
      return await executeDynamicTool(dynamicTool, toolArgs);
    }
    
    throw new ToolError(`Tool '${toolName}' is not implemented.`);
  };
  
  // Execute dynamic tool with safe execution options
  const executeDynamicTool = async (toolDef, toolArgs) => {
    logger.info(`[ToolRunner] Executing dynamic tool: ${toolDef.declaration.name}`);
    
    const { implementation } = toolDef;
    
    if (implementation.type === 'javascript') {
      // Use blob URL for safe execution if enabled
      if (config.useBlobExecution) {
        return await executeInBlobContext(implementation.code, toolArgs);
      } else {
        // Fallback to worker execution
        return await executeInWorker(implementation.code, toolArgs);
      }
    } else if (implementation.type === 'composite') {
      // Execute composite tool steps
      const results = [];
      for (const step of implementation.steps) {
        const stepResult = await runTool(step.tool, 
          JSON.parse(step.args_template.replace(/\$(\w+)/g, (_, key) => 
            JSON.stringify(toolArgs[key]))));
        results.push(stepResult);
      }
      return results;
    } else {
      throw new ToolError(`Unknown implementation type: ${implementation.type}`);
    }
  };
  
  // Execute code in blob context for safe isolation
  const executeInBlobContext = async (code, args) => {
    logger.debug('[ToolRunner] Creating blob context for safe execution');
    
    // Create isolated module code
    const moduleCode = `
      // Blob Context for Safe Tool Execution
      const execute = async (args) => {
        const run = async (params) => {
          ${code}
        };
        return await run(args);
      };
      
      // Export the executor
      export default execute;
    `;
    
    // Create blob URL
    const blob = new Blob([moduleCode], { type: 'application/javascript' });
    const moduleUrl = URL.createObjectURL(blob);
    
    try {
      // Dynamic import from blob URL
      const module = await import(moduleUrl);
      const result = await module.default(args);
      
      // Clean up
      URL.revokeObjectURL(moduleUrl);
      return result;
    } catch (error) {
      URL.revokeObjectURL(moduleUrl);
      logger.error('[ToolRunner] Blob execution failed:', error);
      throw new ToolError(`Tool execution failed: ${error.message}`, error);
    }
  };
  
  // Execute code in worker (existing functionality)
  const executeInWorker = async (code, args) => {
    logger.debug('[ToolRunner] Executing in worker');
    
    return new Promise((resolve, reject) => {
      const worker = new Worker('/upgrades/tool-worker.js');
      
      worker.onmessage = (event) => {
        const { success, result, error } = event.data;
        
        if (success) {
          resolve(result);
        } else {
          reject(new ToolError(error?.message || 'Worker execution failed', error));
        }
        worker.terminate();
      };
      
      worker.onerror = (error) => {
        reject(new ToolError('Worker error', error));
        worker.terminate();
      };
      
      worker.postMessage({
        type: 'init',
        payload: { toolCode: code, toolArgs: args }
      });
    });
  };

  const convertToGeminiFunctionDeclaration = (mcpToolDefinition) => {
      return ToolRunnerPureHelpers.convertToGeminiFunctionDeclarationPure(mcpToolDefinition);
  };

    // Public API
    return {
      api: {
        runTool,
        convertToGeminiFunctionDeclaration
      }
    };
  }
};

// Legacy compatibility wrapper
const ToolRunnerModule = (config, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers) => {
  const instance = ToolRunner.factory({ config, logger, Storage, StateManager, ApiClient, Errors, Utils, ToolRunnerPureHelpers });
  return instance.api;
};

// Export both formats
ToolRunner;
ToolRunnerModule;
// Standardized State Manager Module for REPLOID
// Central state management with versioning and persistence

const StateManager = {
  metadata: {
    id: 'StateManager',
    version: '1.0.0',
    dependencies: ['config', 'logger', 'Storage', 'Errors', 'StateHelpersPure', 'Utils'],
    async: true,  // Requires async initialization
    type: 'service'
  },
  
  factory: (deps) => {
    // Validate dependencies
    const { config, logger, Storage, Errors, StateHelpersPure, Utils } = deps;
    
    if (!config || !logger || !Storage || !Errors || !StateHelpersPure || !Utils) {
      throw new Error('StateManager: Missing required dependencies');
    }
    
    const { StateError, ArtifactError } = Errors;
    
    // Module state
    let globalState = null;
    
    // Private functions
    const validateAndLoadState = async (stateJson) => {
      const parsed = JSON.parse(stateJson);
      const validationError = StateHelpersPure.validateStateStructurePure(parsed);
      
      if (validationError) {
        logger.error(`State validation failed: ${validationError}. Re-initializing.`);
        return createMinimalState();
      }
      
      // Load system config if available
      const sysCfgContent = await Storage.getArtifactContent('/system/config.json');
      if (sysCfgContent) {
        parsed.cfg = JSON.parse(sysCfgContent);
      }
      
      return parsed;
    };
    
    const createMinimalState = () => {
      return {
        totalCycles: -1,
        artifactMetadata: {},
        cfg: {},
        version: "1.0.0",
        currentGoal: null,
        apiKey: config.apiKey || ""
      };
    };
    
    // Async initialization
    const init = async () => {
      logger.info("[StateManager] Initializing state from VFS");
      
      const savedStateJSON = await Storage.getState();
      
      if (savedStateJSON) {
        globalState = await validateAndLoadState(savedStateJSON);
        logger.info(`[StateManager] Loaded state for cycle ${globalState.totalCycles}`);
      } else {
        logger.warn("[StateManager] No saved state found in VFS. Creating minimal state.");
        globalState = createMinimalState();
      }
      
      return true;
    };
    
    // State access
    const getState = () => {
      if (!globalState) {
        throw new StateError("StateManager not initialized. Call init() first.");
      }
      return globalState;
    };
    
    const saveState = async () => {
      if (!globalState) {
        throw new StateError("No state to save");
      }
      
      try {
        await Storage.saveState(JSON.stringify(globalState));
        logger.info("[StateManager] State saved successfully");
      } catch (e) {
        logger.error(`[StateManager] Save state failed: ${e.message}`, e);
        throw new StateError(`Failed to save state: ${e.message}`);
      }
    };
    
    // State mutations
    const updateAndSaveState = async (updaterFn) => {
      const currentState = getState();
      // Deep copy to prevent mutations
      const stateCopy = JSON.parse(JSON.stringify(currentState));
      const newState = await updaterFn(stateCopy);
      globalState = newState;
      await saveState();
      return globalState;
    };
    
    // Artifact management
    const getArtifactMetadata = (path) => {
      const state = getState();
      return state.artifactMetadata?.[path] || null;
    };
    
    const getAllArtifactMetadata = async () => {
      const state = getState();
      return state.artifactMetadata || {};
    };
    
    const getArtifactContent = async (path, version = 'latest') => {
      if (version === 'latest') {
        return await Storage.getArtifactContent(path);
      }
      const versionPath = `${path}#${version}`;
      return await Storage.getArtifactContent(versionPath);
    };
    
    const createArtifact = async (path, type, content, description) => {
      return await updateAndSaveState(async state => {
        // Save content to storage
        await Storage.setArtifactContent(path, content);
        
        // Update metadata
        state.artifactMetadata[path] = {
          id: path,
          type: type,
          description: description,
          versions: [{
            cycle: state.totalCycles,
            timestamp: Date.now(),
            versionId: `c${state.totalCycles}`
          }]
        };
        
        logger.info(`[StateManager] Created artifact: ${path}`);
        return state;
      });
    };
    
    const updateArtifact = async (path, content) => {
      return await updateAndSaveState(async state => {
        const currentMeta = state.artifactMetadata[path];
        
        if (!currentMeta) {
          throw new ArtifactError(`Cannot update non-existent artifact: ${path}`);
        }
        
        const currentVersion = currentMeta.versions[currentMeta.versions.length - 1];
        const oldVersionPath = `${path}#${currentVersion.versionId}`;
        const oldContent = await Storage.getArtifactContent(path);
        
        // Archive old version
        if (oldContent !== null) {
          await Storage.setArtifactContent(oldVersionPath, oldContent);
        }
        
        // Save new content
        await Storage.setArtifactContent(path, content);
        
        // Update metadata with new version
        currentMeta.versions.push({
          cycle: state.totalCycles,
          timestamp: Date.now(),
          versionId: `c${state.totalCycles}`
        });
        
        logger.info(`[StateManager] Updated artifact: ${path} (version ${currentMeta.versions.length})`);
        return state;
      });
    };
    
    const deleteArtifact = async (path) => {
      return await updateAndSaveState(async state => {
        const meta = state.artifactMetadata[path];
        
        if (meta) {
          // Delete all versioned copies
          for (const version of meta.versions) {
            const versionPath = `${path}#${version.versionId}`;
            await Storage.deleteArtifactVersion(versionPath);
          }
        }
        
        // Delete the main artifact
        await Storage.deleteArtifactVersion(path);
        
        // Remove metadata
        delete state.artifactMetadata[path];
        
        logger.warn(`[StateManager] Deleted artifact: ${path}`);
        return state;
      });
    };
    
    // Cycle management
    const incrementCycle = async () => {
      return await updateAndSaveState(async state => {
        state.totalCycles = (state.totalCycles || 0) + 1;
        logger.info(`[StateManager] Incremented cycle to ${state.totalCycles}`);
        return state;
      });
    };
    
    // Goal management
    const updateGoal = async (newGoal) => {
      return await updateAndSaveState(async state => {
        if (!state.currentGoal) {
          state.currentGoal = {
            seed: newGoal,
            cumulative: newGoal,
            stack: [],
            latestType: "System"
          };
        } else {
          state.currentGoal.cumulative = newGoal;
          state.currentGoal.stack.push({
            cycle: state.totalCycles,
            goal: newGoal
          });
        }
        
        logger.info(`[StateManager] Updated goal: ${newGoal.substring(0, 50)}...`);
        return state;
      });
    };
    
    // Public API
    return {
      // Async initializer
      init,
      
      // Main API
      api: {
        // State access
        getState,
        saveState,
        updateAndSaveState,
        
        // Artifact management
        getArtifactMetadata,
        getAllArtifactMetadata,
        getArtifactContent,
        createArtifact,
        updateArtifact,
        deleteArtifact,
        
        // Cycle management
        incrementCycle,
        
        // Goal management
        updateGoal
      }
    };
  }
};

// Legacy compatibility wrapper
const StateManagerModule = (config, logger, Storage, Errors, StateHelpersPure, Utils) => {
  const instance = StateManager.factory({ config, logger, Storage, Errors, StateHelpersPure, Utils });
  // Return object with both init and other methods at same level for legacy compatibility
  return {
    init: instance.init,
    ...instance.api
  };
};

// Export both formats
StateManager;
StateManagerModule;
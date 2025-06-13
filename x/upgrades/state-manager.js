const StateManagerModule = (
  config,
  logger,
  Storage,
  Errors,
  StateHelpersPure,
  Utils
) => {

  const { StateError } = Errors;
  let globalState = null;

  const init = () => {
    const savedStateJSON = Storage.getState();
    if (savedStateJSON) {
      const parsed = JSON.parse(savedStateJSON);
      const validationError = StateHelpersPure.validateStateStructurePure(parsed);
      if (validationError) {
        logger.error(`State validation failed: ${validationError}. Re-initializing.`);
        globalState = {}; // Minimal empty state
      } else {
        globalState = parsed;
        logger.info(`Loaded state for cycle ${globalState.totalCycles}`);
      }
    } else {
      logger.warn("No saved state found in VFS. StateManager is in a minimal state.");
      // The bootloader is responsible for creating the *initial* state.
      // If we are here without state, it's likely an error or post-clear state.
      globalState = {
          totalCycles: -1,
          artifactMetadata: {},
          // other minimal fields
      };
    }
  };

  const getState = () => globalState;

  const saveState = () => {
    if (!globalState) return;
    try {
      Storage.saveState(JSON.stringify(globalState));
    } catch (e) {
      logger.error(`Save state failed: ${e.message}`, e);
    }
  };
  
  const getArtifactMetadata = (path) => {
      return globalState?.artifactMetadata?.[path]?.[0] || null;
  };

  const getAllArtifactMetadata = () => {
      return globalState?.artifactMetadata || {};
  };

  const updateAndSaveState = (updaterFn) => {
    const currentState = getState();
    const newState = updaterFn(JSON.parse(JSON.stringify(currentState))); // Deep copy
    globalState = newState;
    saveState();
    return globalState;
  };
  
  const createArtifact = (path, type, content, description) => {
    return updateAndSaveState(state => {
        Storage.setArtifactContent(path, content);
        state.artifactMetadata[path] = [{
            id: path,
            type: type,
            description: description,
            latestCycle: state.totalCycles,
            timestamp: Date.now()
        }];
        return state;
    });
  };

  const updateArtifact = (path, content) => {
      return updateAndSaveState(state => {
          Storage.setArtifactContent(path, content);
          if (state.artifactMetadata[path]) {
              state.artifactMetadata[path][0].latestCycle = state.totalCycles;
              state.artifactMetadata[path][0].timestamp = Date.now();
          } else {
              // Handle case where metadata doesn't exist? For now, let's log an error.
              logger.error(`Attempted to update non-existent artifact metadata for ${path}`);
          }
          return state;
      });
  };
  
  const deleteArtifact = (path) => {
      return updateAndSaveState(state => {
          Storage.deleteArtifactVersion(path);
          delete state.artifactMetadata[path];
          return state;
      });
  };

  const incrementCycle = () => {
      return updateAndSaveState(state => {
          state.totalCycles = (state.totalCycles || 0) + 1;
          return state;
      });
  };

  return {
    init,
    getState,
    saveState,
    updateAndSaveState,
    getArtifactMetadata,
    getAllArtifactMetadata,
    createArtifact,
    updateArtifact,
    deleteArtifact,
    incrementCycle,
  };
};
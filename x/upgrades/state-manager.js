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

  const init = async () => {
    const savedStateJSON = await Storage.getState();
    if (savedStateJSON) {
      const parsed = JSON.parse(savedStateJSON);
      const validationError = StateHelpersPure.validateStateStructurePure(parsed);
      if (validationError) {
        logger.error(`State validation failed: ${validationError}. Re-initializing.`);
        globalState = {}; // Minimal empty state
      } else {
        globalState = parsed;
        // Load agent config from VFS into state.cfg
        const sysCfgContent = await Storage.getArtifactContent('/system/config.json');
        if (sysCfgContent) {
            globalState.cfg = JSON.parse(sysCfgContent);
        }
        logger.info(`Loaded state for cycle ${globalState.totalCycles}`);
      }
    } else {
      logger.warn("No saved state found in VFS. StateManager is in a minimal state.");
      globalState = {
          totalCycles: -1,
          artifactMetadata: {},
          cfg: {},
      };
    }
  };

  const getState = () => globalState;

  const saveState = async () => {
    if (!globalState) return;
    try {
      await Storage.saveState(JSON.stringify(globalState));
    } catch (e) {
      logger.error(`Save state failed: ${e.message}`, e);
    }
  };
  
  const getArtifactMetadata = (path) => {
      return globalState?.artifactMetadata?.[path] || null;
  };

  const getAllArtifactMetadata = async () => {
      // In a versioned system, this might get more complex.
      // For now, it returns the metadata object.
      return globalState?.artifactMetadata || {};
  };

  const updateAndSaveState = async (updaterFn) => {
    const currentState = getState();
    const newState = await updaterFn(JSON.parse(JSON.stringify(currentState))); // Deep copy
    globalState = newState;
    await saveState();
    return globalState;
  };
  
  const createArtifact = async (path, type, content, description) => {
    return await updateAndSaveState(async state => {
        await Storage.setArtifactContent(path, content);
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
        return state;
    });
  };

  const updateArtifact = async (path, content) => {
      return await updateAndSaveState(async state => {
          const currentMeta = state.artifactMetadata[path];
          if (!currentMeta) {
              throw new Errors.ArtifactError(`Cannot update non-existent artifact: ${path}`);
          }
          const currentVersion = currentMeta.versions[currentMeta.versions.length - 1];
          const oldVersionPath = `${path}#${currentVersion.versionId}`;
          const oldContent = await Storage.getArtifactContent(path);

          // Save old version
          await Storage.setArtifactContent(oldVersionPath, oldContent);

          // Save new version
          await Storage.setArtifactContent(path, content);

          // Update metadata
          currentMeta.versions.push({
              cycle: state.totalCycles,
              timestamp: Date.now(),
              versionId: `c${state.totalCycles}`
          });

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
          // Delete the main artifact and its metadata
          await Storage.deleteArtifactVersion(path);
          delete state.artifactMetadata[path];
          return state;
      });
  };

  const incrementCycle = async () => {
      return await updateAndSaveState(async state => {
          state.totalCycles = (state.totalCycles || 0) + 1;
          return state;
      });
  };

  const getArtifactContent = async (path, version = 'latest') => {
      if (version === 'latest') {
          return await Storage.getArtifactContent(path);
      }
      const versionPath = `${path}#${version}`;
      return await Storage.getArtifactContent(versionPath);
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
    getArtifactContent
  };
};
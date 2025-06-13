const StorageModule = (config, logger, Errors) => {
  if (!config || !logger || !Errors) {
    console.error("StorageModule initialization failed: Missing dependencies.");
    return {
      getArtifactContent: () => null,
      setArtifactContent: () => false,
      deleteArtifactVersion: () => false,
      getState: () => null,
      saveState: () => false,
      removeState: () => false,
    };
  }
  
  const VFS_PREFIX = config.VFS_PREFIX || "_x0_vfs_";
  const STATE_PATH = config.STATE_PATH || "/system/state.json";
  const { StorageError } = Errors;

  const getKey = (path) => VFS_PREFIX + path;

  const getArtifactContent = (path) => {
    try {
      return localStorage.getItem(getKey(path));
    } catch (e) {
      logger.error(`LocalStorage GET Error for path: ${path}`, e);
      return null;
    }
  };

  const setArtifactContent = (path, content) => {
    try {
      localStorage.setItem(getKey(path), content);
      return true;
    } catch (e) {
      logger.error(`LocalStorage SET Error for path: ${path}`, e);
      throw new StorageError(`LocalStorage SET Error: ${e.message}`, { path });
    }
  };

  const deleteArtifactVersion = (path) => {
    try {
      localStorage.removeItem(getKey(path));
      return true;
    } catch (e) {
      logger.error(`LocalStorage REMOVE Error for path: ${path}`, e);
      return false;
    }
  };

  const getState = () => getArtifactContent(STATE_PATH);
  const saveState = (stateString) => setArtifactContent(STATE_PATH, stateString);
  const removeState = () => deleteArtifactVersion(STATE_PATH);

  return {
    getArtifactContent,
    setArtifactContent,
    deleteArtifactVersion,
    getState,
    saveState,
    removeState,
  };
};
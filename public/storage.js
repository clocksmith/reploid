const StorageModule = (config, logger) => {
  if (!config || !logger) {
    console.error("StorageModule requires config and logger to be provided.");
    const log = logger || {
      logEvent: (lvl, msg) =>
        console[lvl === "error" ? "error" : "log"](`[STORAGE FALLBACK] ${msg}`),
    };
    log.logEvent(
      "error",
      "StorageModule initialization failed: Missing config or logger."
    );
    return {
      LS_PREFIX: "_x0_",
      getArtifactKey: () => null,
      getArtifactContent: () => null,
      setArtifactContent: () => {
        throw new Error("Storage not initialized");
      },
      deleteArtifactVersion: () => false,
      getState: () => null,
      saveState: () => {
        throw new Error("Storage not initialized");
      },
      removeState: () => false,
      getSessionState: () => null,
      saveSessionState: () => {
        throw new Error("Storage not initialized");
      },
      removeSessionState: () => {},
      clearAllReploidData: () => {
        log.logEvent("error", "Cannot clear storage, module not initialized.");
      },
      getStorageUsage: () => ({ used: 0, quota: 0, percent: 0 }),
    };
  }

  const LS_PREFIX = config.LS_PREFIX;
  const STATE_KEY_BASE = config.STATE_KEY_BASE;
  const SESSION_STATE_KEY_BASE = config.SESSION_STATE_KEY_BASE;
  const MAX_ART_TKN_SZ = config.MAX_ARTIFACT_SIZE_BYTES || 4 * 1024 * 1024;
  const STATE_VERSION_MAJOR = config.STATE_VERSION.split(".")[0];
  const stateKey = STATE_KEY_BASE + STATE_VERSION_MAJOR;
  const sessionStateKey = SESSION_STATE_KEY_BASE + STATE_VERSION_MAJOR;
  const QUOTA_BYTES = 5 * 1024 * 1024;
  const QUOTA_WARNING_THRESHOLD = 0.9;

  const getStorageUsage = () => {
    let totalBytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if ((key && key.startsWith(LS_PREFIX)) || key === stateKey) {
          const value = localStorage.getItem(key);
          totalBytes += (value?.length || 0) * 2;
        }
      }
      const percent = QUOTA_BYTES > 0 ? (totalBytes / QUOTA_BYTES) * 100 : 0;
      return { used: totalBytes, quota: QUOTA_BYTES, percent: percent };
    } catch (e) {
      logger.logEvent("error", "Failed to calculate storage usage", e);
      return { used: -1, quota: QUOTA_BYTES, percent: -1 };
    }
  };

  const _get = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      logger.logEvent("error", `LocalStorage GET Error: ${key}`, e);
      return null;
    }
  };

  const _set = (key, value) => {
    if (
      value &&
      typeof value === "string" &&
      value.length * 2 > MAX_ART_TKN_SZ
    ) {
      const msg = `Artifact content exceeds size limit (${
        value.length * 2
      } > ${MAX_ART_TKN_SZ} bytes) for key: ${key}`;
      logger.logEvent("error", msg);
      throw new Error(msg);
    }

    const usage = getStorageUsage();
    const estimatedNewSize = (value?.length || 0) * 2;
    const currentItemSize = (_get(key)?.length || 0) * 2;
    const estimatedUsageAfter = usage.used - currentItemSize + estimatedNewSize;

    if (
      usage.used >= 0 &&
      estimatedUsageAfter / QUOTA_BYTES > QUOTA_WARNING_THRESHOLD
    ) {
      logger.logEvent(
        "warn",
        `LocalStorage usage high (${(
          (estimatedUsageAfter / QUOTA_BYTES) *
          100
        ).toFixed(1)}%) after setting key: ${key}`
      );
    }

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      let errorMessage = `LocalStorage SET Error: ${key}`;
      if (
        e.name === "QuotaExceededError" ||
        (e.code && (e.code === 22 || e.code === 1014))
      ) {
        errorMessage = `LocalStorage Quota Exceeded while setting key: ${key}. Usage: ${(
          usage.used /
          1024 /
          1024
        ).toFixed(2)}MB / ${(QUOTA_BYTES / 1024 / 1024).toFixed(2)}MB.`;
        logger.logEvent("error", errorMessage, e);
        throw new Error(errorMessage);
      } else {
        logger.logEvent("error", errorMessage, e);
        throw e;
      }
    }
  };

  const _remove = (key) => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      logger.logEvent("error", `LocalStorage REMOVE Error: ${key}`, e);
      return false;
    }
  };

  const _key = (id, cycle = 0, versionId = null) => {
    let baseKey = `${LS_PREFIX}${id}_${cycle}`;
    if (
      versionId !== null &&
      typeof versionId === "string" &&
      versionId.length > 0
    ) {
      baseKey += `#${versionId}`;
    }
    return baseKey;
  };

  const getArtifactContent = (id, cycle, versionId = null) =>
    _get(_key(id, cycle, versionId));

  const setArtifactContent = (id, cycle, content, versionId = null) =>
    _set(_key(id, cycle, versionId), content);

  const deleteArtifactVersion = (id, cycle, versionId = null) =>
    _remove(_key(id, cycle, versionId));

  const getState = () => {
    const json = _get(stateKey);
    try {
      return json ? JSON.parse(json) : null;
    } catch (e) {
      logger.logEvent(
        "error",
        `Failed to parse state from localStorage: ${e.message}`
      );
      _remove(stateKey);
      return null;
    }
  };

  const saveState = (stateObj) => {
    try {
      return _set(stateKey, JSON.stringify(stateObj));
    } catch (e) {
      logger.logEvent("error", "Failed to save state due to storage error.", e);
      throw e;
    }
  };

  const removeState = () => _remove(stateKey);

  const getSessionState = () => {
    try {
      const json = sessionStorage.getItem(sessionStateKey);
      return json ? JSON.parse(json) : null;
    } catch (e) {
      logger.logEvent("error", `Failed to parse session state: ${e.message}`);
      try {
        sessionStorage.removeItem(sessionStateKey);
      } catch (e) {}
      return null;
    }
  };

  const saveSessionState = (stateObj) => {
    try {
      sessionStorage.setItem(sessionStateKey, JSON.stringify(stateObj));
      return true;
    } catch (e) {
      logger.logEvent("error", `SessionStorage SET Error: ${e.message}`);
      if (e.name === "QuotaExceededError") {
        throw new Error(`SessionStorage Quota Exceeded.`);
      }
      throw e;
    }
  };

  const removeSessionState = () => {
    try {
      sessionStorage.removeItem(sessionStateKey);
    } catch (e) {
      logger.logEvent("warn", `SessionStorage REMOVE Error: ${e.message}`);
    }
  };

  const clearAllReploidData = () => {
    logger.logEvent("warn", "Initiating LocalStorage clear for Reploid data.");
    let keysToRemove = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(LS_PREFIX) || key === stateKey)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => _remove(key));
      removeState();
      logger.logEvent(
        "info",
        `Removed ${keysToRemove.length} artifact/state keys from localStorage.`
      );
      try {
        sessionStorage.clear();
        logger.logEvent("info", "Cleared SessionStorage.");
      } catch (e) {
        logger.logEvent("warn", "Failed to clear SessionStorage.", e.message);
      }
    } catch (e) {
      logger.logEvent(
        "error",
        `Error during key iteration/removal in clearAllReploidData: ${e.message}`
      );
    }
  };

  return {
    LS_PREFIX,
    getArtifactKey: _key,
    getArtifactContent,
    setArtifactContent,
    deleteArtifactVersion,
    getState,
    saveState,
    removeState,
    getSessionState,
    saveSessionState,
    removeSessionState,
    clearAllReploidData,
    getStorageUsage,
  };
};

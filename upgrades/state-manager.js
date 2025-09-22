// Standardized State Manager Module for REPLOID - Git-Aware

const StateManager = {
  metadata: {
    id: 'StateManager',
    version: '2.0.0',
    dependencies: ['config', 'Storage', 'StateHelpersPure', 'Utils'],
    async: true,
    type: 'service'
  },
  
  factory: (deps) => {
    const { config, Storage, StateHelpersPure, Utils } = deps;
    const { logger, Errors } = Utils;
    const { StateError, ArtifactError } = Errors;
    
    let globalState = null;

    const init = async () => {
      logger.info("[StateManager-Git] Initializing state...");
      const savedStateJSON = await Storage.getState();
      if (savedStateJSON) {
        globalState = JSON.parse(savedStateJSON);
        logger.info(`[StateManager-Git] Loaded state for cycle ${globalState.totalCycles}`);
      } else {
        logger.warn("[StateManager-Git] No saved state found. Creating minimal state.");
        globalState = { totalCycles: 0, artifactMetadata: {}, currentGoal: null, apiKey: config.apiKey || "" };
      }
      return true;
    };

    const getState = () => {
        if (!globalState) throw new StateError("StateManager not initialized.");
        return globalState;
    };

    const saveState = async () => {
        if (!globalState) throw new StateError("No state to save");
        await Storage.saveState(JSON.stringify(globalState));
    };

    const updateAndSaveState = async (updaterFn) => {
        const stateCopy = JSON.parse(JSON.stringify(globalState));
        const newState = await updaterFn(stateCopy);
        globalState = newState;
        await saveState();
        return globalState;
    };

    const createArtifact = async (path, type, content, description) => {
        await Storage.setArtifactContent(path, content);
        return await updateAndSaveState(async state => {
            state.artifactMetadata[path] = { id: path, type, description };
            logger.info(`[StateManager-Git] Created artifact: ${path}`);
            return state;
        });
    };

    const updateArtifact = async (path, content) => {
        const existingMeta = globalState.artifactMetadata[path];
        if (!existingMeta) {
            throw new ArtifactError(`Cannot update non-existent artifact: ${path}`);
        }
        await Storage.setArtifactContent(path, content);
        logger.info(`[StateManager-Git] Updated artifact: ${path}`);
    };

    const deleteArtifact = async (path) => {
        await Storage.deleteArtifact(path);
        return await updateAndSaveState(async state => {
            delete state.artifactMetadata[path];
            logger.warn(`[StateManager-Git] Deleted artifact: ${path}`);
            return state;
        });
    };

    const incrementCycle = async () => {
        return await updateAndSaveState(async state => {
            state.totalCycles = (state.totalCycles || 0) + 1;
            return state;
        });
    };

    const updateGoal = async (newGoal) => {
        return await updateAndSaveState(async state => {
            if (!state.currentGoal) {
                state.currentGoal = { seed: newGoal, cumulative: newGoal, stack: [], latestType: "System" };
            } else {
                state.currentGoal.cumulative = newGoal;
                state.currentGoal.stack.push({ cycle: state.totalCycles, goal: newGoal });
            }
            return state;
        });
    };

    // New SessionManager class for PAWS-like workflow
    class SessionManager {
        constructor() {
            this.activeSessionId = null;
        }

        async createSession(goal) {
            const sessionId = `session_${Date.now()}`;
            this.activeSessionId = sessionId;
            const sessionPath = `/sessions/${sessionId}`;
            const manifest = {
                id: sessionId,
                goal,
                status: 'active',
                startTime: new Date().toISOString(),
                turns: []
            };

            // Create session directory and manifest
            await Storage.setArtifactContent(`${sessionPath}/session.json`, JSON.stringify(manifest, null, 2));
            logger.info(`[SessionManager] Created new session: ${sessionId}`);
            return sessionId;
        }

        async createTurn(sessionId) {
            const sessionPath = `/sessions/${sessionId}`;
            const manifestContent = await Storage.getArtifactContent(`${sessionPath}/session.json`);
            const manifest = JSON.parse(manifestContent);
            
            const turnNumber = manifest.turns.length;
            const turn = {
                turn: turnNumber,
                cats_path: `${sessionPath}/turn-${turnNumber}.cats.md`,
                dogs_path: `${sessionPath}/turn-${turnNumber}.dogs.md`,
                status: 'pending_context'
            };
            manifest.turns.push(turn);

            await Storage.setArtifactContent(`${sessionPath}/session.json`, JSON.stringify(manifest, null, 2));
            logger.info(`[SessionManager] Created turn ${turnNumber} for session ${sessionId}`);
            return turn;
        }

        getActiveSessionId() {
            return this.activeSessionId;
        }
    }

    const sessionManager = new SessionManager();

    // Checkpoint management
    const createCheckpoint = async (description) => {
        const checkpointId = `checkpoint_${Date.now()}`;
        const checkpoint = {
            id: checkpointId,
            description,
            timestamp: Date.now(),
            state: JSON.parse(JSON.stringify(globalState)) // Deep clone current state
        };

        // Store checkpoint in VFS
        await Storage.setArtifactContent(
            `/.checkpoints/${checkpointId}.json`,
            JSON.stringify(checkpoint, null, 2)
        );

        logger.info(`[StateManager] Created checkpoint: ${checkpointId} - ${description}`);
        return checkpoint;
    };

    const restoreCheckpoint = async (checkpointId) => {
        const checkpointPath = `/.checkpoints/${checkpointId}.json`;
        const checkpointContent = await Storage.getArtifactContent(checkpointPath);

        if (!checkpointContent) {
            throw new Error(`Checkpoint not found: ${checkpointId}`);
        }

        const checkpoint = JSON.parse(checkpointContent);
        globalState = checkpoint.state;

        // Restore all artifacts from checkpoint state
        for (const [path, metadata] of Object.entries(globalState.artifactMetadata || {})) {
            if (metadata.content) {
                await Storage.setArtifactContent(path, metadata.content);
            }
        }

        await saveState();
        logger.info(`[StateManager] Restored checkpoint: ${checkpointId}`);
        return true;
    };

    return {
      init,
      api: {
        getState,
        saveState,
        updateAndSaveState,
        getArtifactMetadata: (path) => globalState.artifactMetadata?.[path] || null,
        getAllArtifactMetadata: async () => globalState.artifactMetadata || {},
        getArtifactContent: Storage.getArtifactContent,
        createArtifact,
        updateArtifact,
        deleteArtifact,
        incrementCycle,
        updateGoal,
        // Exposing new Git capabilities
        getArtifactHistory: Storage.getArtifactHistory,
        getArtifactDiff: Storage.getArtifactDiff,
        // Exposing new Session capabilities
        createSession: sessionManager.createSession.bind(sessionManager),
        createTurn: sessionManager.createTurn.bind(sessionManager),
        getActiveSessionId: sessionManager.getActiveSessionId.bind(sessionManager),
        // Checkpoint capabilities
        createCheckpoint,
        restoreCheckpoint,
        sessionManager
      }
    };
  }
};

// Export standardized module
StateManager;
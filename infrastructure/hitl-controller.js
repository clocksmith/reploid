/**
 * @fileoverview HITL Controller - Human-in-the-Loop approval system
 * Autonomous by default. Opt-in HITL for users who want approval gates.
 */

const HITLController = {
  metadata: {
    id: 'HITLController',
    version: '1.0.0',
    dependencies: ['Utils', 'EventBus'],
    async: false,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger, generateId } = Utils;

    const STORAGE_KEY = 'REPLOID_HITL_CONFIG';

    /** Approval capability types */
    const CAPABILITIES = {
      APPROVE_CODE_CHANGES: 'approve_code_changes',
      APPROVE_FILE_OPERATIONS: 'approve_file_operations',
      APPROVE_TOOL_EXECUTION: 'approve_tool_execution',
      APPROVE_SELF_MODIFICATION: 'approve_self_modification',
      APPROVE_CORE_WRITES: 'approve_core_writes'
    };

    /** Mode constants */
    const MODES = {
      AUTONOMOUS: 'autonomous',
      HITL: 'hitl',
      INHERIT: 'inherit'
    };

    // Internal state
    const _moduleRegistry = new Map();
    const _approvalQueue = [];
    const _timeouts = new Map();

    let _config = {
      masterMode: MODES.AUTONOMOUS, // Autonomous by default
      moduleOverrides: {}
    };

    const _stats = {
      total: 0,
      approved: 0,
      rejected: 0,
      timedOut: 0,
      autoApproved: 0,
      history: []
    };

    // --- Persistence ---

    const _saveConfig = () => {
      try {
        const toSave = {
          masterMode: _config.masterMode,
          moduleOverrides: _config.moduleOverrides
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        logger.warn('[HITL] Failed to save config:', e.message);
      }
    };

    const _loadConfig = () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          _config.masterMode = parsed.masterMode || MODES.AUTONOMOUS;
          _config.moduleOverrides = parsed.moduleOverrides || {};
          logger.info(`[HITL] Loaded config: ${_config.masterMode} mode`);
        }
      } catch (e) {
        logger.warn('[HITL] Failed to load config, using defaults');
      }
    };

    // --- Module Registration ---

    /**
     * Register a module as HITL-capable
     * @param {string} moduleId - Module identifier
     * @param {string[]} capabilities - Array of CAPABILITIES
     * @param {string} [description] - Optional description
     */
    const registerModule = (moduleId, capabilities = [], description = '') => {
      if (!moduleId) {
        logger.warn('[HITL] registerModule called without moduleId');
        return;
      }

      const existing = _moduleRegistry.get(moduleId);
      const currentMode = _config.moduleOverrides[moduleId] || MODES.INHERIT;

      _moduleRegistry.set(moduleId, {
        id: moduleId,
        description,
        capabilities,
        currentMode,
        registeredAt: existing?.registeredAt || Date.now()
      });

      EventBus.emit('hitl:module-registered', { moduleId });
      logger.debug(`[HITL] Registered module: ${moduleId} with ${capabilities.length} capabilities`);
    };

    // --- Mode Management ---

    /**
     * Get effective mode for a module
     * @param {string} moduleId - Module identifier
     * @returns {string} 'autonomous' or 'hitl'
     */
    const getModuleMode = (moduleId) => {
      const override = _config.moduleOverrides[moduleId];
      if (override && override !== MODES.INHERIT) {
        return override;
      }
      return _config.masterMode;
    };

    /**
     * Set master mode (affects all modules using 'inherit')
     * @param {string} mode - 'autonomous' or 'hitl'
     */
    const setMasterMode = (mode) => {
      if (mode !== MODES.AUTONOMOUS && mode !== MODES.HITL) {
        logger.warn(`[HITL] Invalid mode: ${mode}`);
        return;
      }

      const oldMode = _config.masterMode;
      _config.masterMode = mode;
      _saveConfig();

      const affectedModules = [..._moduleRegistry.keys()].filter(
        id => !_config.moduleOverrides[id] || _config.moduleOverrides[id] === MODES.INHERIT
      );

      EventBus.emit('hitl:master-mode-changed', { oldMode, newMode: mode, affectedModules });
      logger.info(`[HITL] Master mode changed: ${oldMode} -> ${mode}`);
    };

    /**
     * Set mode override for a specific module
     * @param {string} moduleId - Module identifier
     * @param {string} mode - 'autonomous', 'hitl', or 'inherit'
     */
    const setModuleMode = (moduleId, mode) => {
      if (!_moduleRegistry.has(moduleId)) {
        logger.warn(`[HITL] Module not registered: ${moduleId}`);
        return;
      }

      if (![MODES.AUTONOMOUS, MODES.HITL, MODES.INHERIT].includes(mode)) {
        logger.warn(`[HITL] Invalid mode: ${mode}`);
        return;
      }

      const oldMode = _config.moduleOverrides[moduleId] || MODES.INHERIT;
      _config.moduleOverrides[moduleId] = mode;

      const entry = _moduleRegistry.get(moduleId);
      if (entry) {
        entry.currentMode = mode;
      }

      _saveConfig();

      EventBus.emit('hitl:module-mode-changed', {
        moduleId,
        oldMode,
        newMode: mode,
        effectiveMode: getModuleMode(moduleId)
      });
    };

    // --- Approval Logic ---

    /**
     * Check if approval is required for an action
     * @param {string} moduleId - Module identifier
     * @param {string} capability - Capability being checked
     * @returns {boolean} True if approval required
     */
    const requiresApproval = (moduleId, capability) => {
      const effectiveMode = getModuleMode(moduleId);
      if (effectiveMode === MODES.AUTONOMOUS) {
        return false;
      }

      // In HITL mode, check if module has this capability
      const entry = _moduleRegistry.get(moduleId);
      if (!entry) {
        return false; // Unregistered modules don't require approval
      }

      return entry.capabilities.includes(capability);
    };

    /**
     * Request approval for an action
     * @param {Object} request - Approval request
     * @param {string} request.moduleId - Module requesting approval
     * @param {string} request.capability - Capability being used
     * @param {string} request.action - Human-readable action description
     * @param {*} request.data - Data to pass to callback
     * @param {Function} request.onApprove - Called with data on approval
     * @param {Function} request.onReject - Called with reason on rejection
     * @param {number} [request.timeout] - Auto-reject after ms (optional)
     * @returns {string|null} Approval ID if queued, null if auto-approved
     */
    const requestApproval = (request) => {
      const { moduleId, capability, action, data, onApprove, onReject, timeout } = request;

      // Check if approval is actually required
      if (!requiresApproval(moduleId, capability)) {
        // Auto-approve in autonomous mode
        _stats.autoApproved++;
        logger.debug(`[HITL] Auto-approved: ${moduleId}/${capability}`);
        if (onApprove) onApprove(data);
        return null;
      }

      // Queue for approval
      const approvalId = generateId('approval');
      const item = {
        id: approvalId,
        moduleId,
        capability,
        action,
        data,
        onApprove,
        onReject,
        timestamp: Date.now(),
        status: 'pending'
      };

      _approvalQueue.push(item);

      // Set timeout if specified
      if (timeout && timeout > 0) {
        const timeoutId = setTimeout(() => {
          _handleTimeout(approvalId);
        }, timeout);
        _timeouts.set(approvalId, timeoutId);
      }

      EventBus.emit('hitl:approval-pending', item);
      logger.info(`[HITL] Approval required: ${action} (${approvalId})`);

      return approvalId;
    };

    /**
     * Approve a pending request
     * @param {string} approvalId - Approval ID
     * @param {*} [data] - Optional data override
     */
    const approve = (approvalId, data = null) => {
      const index = _approvalQueue.findIndex(item => item.id === approvalId);
      if (index === -1) {
        logger.warn(`[HITL] Approval not found: ${approvalId}`);
        return false;
      }

      const item = _approvalQueue[index];
      _approvalQueue.splice(index, 1);

      // Clear timeout if set
      if (_timeouts.has(approvalId)) {
        clearTimeout(_timeouts.get(approvalId));
        _timeouts.delete(approvalId);
      }

      // Update stats
      _stats.total++;
      _stats.approved++;
      _addHistory('approved', item);

      // Execute callback
      if (item.onApprove) {
        item.onApprove(data !== null ? data : item.data);
      }

      EventBus.emit('hitl:approval-granted', { approvalId, item });
      logger.info(`[HITL] Approved: ${item.action}`);

      return true;
    };

    /**
     * Reject a pending request
     * @param {string} approvalId - Approval ID
     * @param {string} [reason] - Rejection reason
     */
    const reject = (approvalId, reason = 'Rejected by user') => {
      const index = _approvalQueue.findIndex(item => item.id === approvalId);
      if (index === -1) {
        logger.warn(`[HITL] Approval not found: ${approvalId}`);
        return false;
      }

      const item = _approvalQueue[index];
      _approvalQueue.splice(index, 1);

      // Clear timeout if set
      if (_timeouts.has(approvalId)) {
        clearTimeout(_timeouts.get(approvalId));
        _timeouts.delete(approvalId);
      }

      // Update stats
      _stats.total++;
      _stats.rejected++;
      _addHistory('rejected', item, reason);

      // Execute callback
      if (item.onReject) {
        item.onReject(reason);
      }

      EventBus.emit('hitl:approval-rejected', { approvalId, item, reason });
      logger.info(`[HITL] Rejected: ${item.action} - ${reason}`);

      return true;
    };

    const _handleTimeout = (approvalId) => {
      const index = _approvalQueue.findIndex(item => item.id === approvalId);
      if (index === -1) return; // Already processed

      const item = _approvalQueue[index];
      _approvalQueue.splice(index, 1);
      _timeouts.delete(approvalId);

      // Update stats
      _stats.total++;
      _stats.timedOut++;
      _addHistory('timeout', item, 'Timed out');

      // Execute rejection callback
      if (item.onReject) {
        item.onReject('Approval timed out');
      }

      EventBus.emit('hitl:approval-timeout', { approvalId, item });
      logger.warn(`[HITL] Approval timed out: ${item.action}`);
    };

    const _addHistory = (outcome, item, reason = null) => {
      _stats.history.unshift({
        outcome,
        moduleId: item.moduleId,
        action: item.action,
        reason,
        timestamp: Date.now()
      });

      // Keep only last 50 entries
      if (_stats.history.length > 50) {
        _stats.history.pop();
      }
    };

    // --- Query APIs ---

    const getState = () => ({
      config: {
        masterMode: _config.masterMode,
        moduleOverrides: { ..._config.moduleOverrides }
      },
      approvalQueue: [..._approvalQueue],
      approvalStats: { ..._stats, history: [..._stats.history] },
      registeredModules: [..._moduleRegistry.values()].map(m => ({
        ...m,
        effectiveMode: getModuleMode(m.id)
      }))
    });

    const getApprovalQueue = () => [..._approvalQueue];

    const getStats = () => ({ ..._stats, history: [..._stats.history] });

    const isHITLEnabled = () => _config.masterMode === MODES.HITL;

    const resetToDefaults = () => {
      _config.masterMode = MODES.AUTONOMOUS;
      _config.moduleOverrides = {};
      _approvalQueue.length = 0;

      // Clear all timeouts
      for (const timeoutId of _timeouts.values()) {
        clearTimeout(timeoutId);
      }
      _timeouts.clear();

      _saveConfig();
      EventBus.emit('hitl:config-reset', {});
      logger.info('[HITL] Reset to defaults (autonomous mode)');
    };

    // --- EventBus Integration ---

    const init = () => {
      _loadConfig();

      EventBus.on('hitl:set-master-mode', ({ mode }) => setMasterMode(mode), 'HITLController');
      EventBus.on('hitl:set-module-mode', ({ moduleId, mode }) => setModuleMode(moduleId, mode), 'HITLController');
      EventBus.on('hitl:approve', ({ approvalId, data }) => approve(approvalId, data), 'HITLController');
      EventBus.on('hitl:reject', ({ approvalId, reason }) => reject(approvalId, reason), 'HITLController');

      logger.info(`[HITL] Initialized in ${_config.masterMode} mode`);
      return true;
    };

    return {
      init,
      CAPABILITIES,
      MODES,
      registerModule,
      getModuleMode,
      setMasterMode,
      setModuleMode,
      requiresApproval,
      requestApproval,
      approve,
      reject,
      getState,
      getApprovalQueue,
      getStats,
      isHITLEnabled,
      resetToDefaults
    };
  }
};

export default HITLController;

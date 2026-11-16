/**
 * @fileoverview Federated Learning Coordinator
 * Versioned aggregation of explicitly disclosed updates. The coordinator sees every
 * update; this module provides neither secure aggregation nor a differential privacy guarantee.
 */

const FederatedLearning = {
  metadata: {
    id: 'FederatedLearning',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'SwarmTransport?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, SwarmTransport } = deps;
    const { logger, generateId } = Utils;

    const DEFAULTS = {
      roundTimeoutMs: 20000,
      clipNorm: 1.0,
      noiseStdDev: 0,
      secureAggregation: false,
      allowPlaintextUpdates: false,
      minParticipants: 1,
      historyLimit: 10
    };

    let _config = { ...DEFAULTS };
    let _model = { weights: [] };
    let _version = 0;
    let _history = [];
    let _rounds = new Map();
    let _localUpdateProvider = null;

    const getLocalPeerId = () => SwarmTransport?._getPeerId?.() || 'local';

    const isTargetedAtUs = (envelope) => {
      if (!envelope || !envelope.targetPeer) return true;
      return envelope.targetPeer === getLocalPeerId();
    };

    const getConnectedPeers = () => {
      const peers = SwarmTransport?.getConnectedPeers?.() || [];
      return peers.map(peer => peer.id).filter(Boolean);
    };

    const normalizeModel = (model) => {
      if (Array.isArray(model)) {
        return { weights: model.map(Number) };
      }

      if (model && typeof model === 'object') {
        const out = {};
        for (const [key, value] of Object.entries(model)) {
          if (Array.isArray(value)) {
            out[key] = value.map(Number);
          }
        }
        if (Object.keys(out).length > 0) return out;
      }

      return { weights: [] };
    };

    const cloneModel = (model) => {
      const normalized = normalizeModel(model);
      const out = {};
      for (const [key, value] of Object.entries(normalized)) {
        out[key] = value.slice();
      }
      return out;
    };

    const modelKeys = (model) => Object.keys(model).sort();

    const zeroModelLike = (model) => {
      const out = {};
      for (const key of modelKeys(model)) {
        out[key] = new Array(model[key].length).fill(0);
      }
      return out;
    };

    const ensureModelShape = (update) => {
      const keys = modelKeys(_model);
      if (keys.length === 0 || (keys.length === 1 && _model[keys[0]].length === 0)) {
        const normalized = normalizeModel(update);
        _model = zeroModelLike(normalized);
      }
    };

    const alignUpdate = (update) => {
      const normalized = normalizeModel(update);
      ensureModelShape(normalized);

      const aligned = {};
      for (const key of modelKeys(_model)) {
        const base = _model[key] || [];
        const arr = normalized[key] || new Array(base.length).fill(0);
        if (arr.length !== base.length) {
          throw new Error(`Update shape mismatch for ${key}`);
        }
        aligned[key] = arr.map(Number);
      }
      return aligned;
    };

    const addModels = (base, update, scale = 1) => {
      const out = {};
      for (const key of modelKeys(base)) {
        const arr = base[key] || [];
        const delta = update[key] || [];
        out[key] = arr.map((value, idx) => value + (delta[idx] || 0) * scale);
      }
      return out;
    };

    const scaleModel = (model, factor) => {
      const out = {};
      for (const key of modelKeys(model)) {
        out[key] = model[key].map(value => value * factor);
      }
      return out;
    };

    const l2Norm = (model) => {
      let sum = 0;
      for (const key of modelKeys(model)) {
        for (const value of model[key]) {
          sum += value * value;
        }
      }
      return Math.sqrt(sum);
    };

    const clipUpdate = (update, maxNorm) => {
      if (!maxNorm || maxNorm <= 0) return update;
      const norm = l2Norm(update);
      if (norm <= maxNorm) return update;
      const scale = maxNorm / (norm || 1);
      return scaleModel(update, scale);
    };

    const gaussian = () => {
      let u = 0;
      let v = 0;
      const cryptoApi = deps.crypto || globalThis.crypto;
      if (typeof cryptoApi?.getRandomValues !== 'function') throw new Error('Cryptographic randomness is required for update noise');
      const values = new Uint32Array(2);
      cryptoApi.getRandomValues(values);
      u = (values[0] + 1) / 4294967297;
      v = (values[1] + 1) / 4294967297;
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };

    const addNoise = (update, stdDev) => {
      if (!stdDev || stdDev <= 0) return update;
      const out = {};
      for (const key of modelKeys(update)) {
        out[key] = update[key].map(value => value + gaussian() * stdDev);
      }
      return out;
    };

    const validateConfig = config => {
      if (config.secureAggregation !== false) throw new Error('Secure aggregation is not implemented; refusing to disclose updates');
      if (config.allowPlaintextUpdates !== true) throw new Error('Explicit plaintext update disclosure is required');
      if (!Number.isFinite(config.clipNorm) || config.clipNorm <= 0
        || !Number.isFinite(config.noiseStdDev) || config.noiseStdDev < 0
        || !Number.isSafeInteger(config.minParticipants) || config.minParticipants < 1
        || !Number.isSafeInteger(config.roundTimeoutMs) || config.roundTimeoutMs < 1) {
        throw new Error('Invalid federated update limits');
      }
      if (config.epsilon !== undefined || config.delta !== undefined || config.differentialPrivacy) {
        throw new Error('Differential privacy accounting is not implemented');
      }
      return config;
    };

    const prepareUpdate = (update, config) => {
      validateConfig(config);
      return addNoise(clipUpdate(alignUpdate(update), config.clipNorm), config.noiseStdDev);
    };

    const aggregateUpdates = (updates) => {
      if (updates.length === 0) return zeroModelLike(_model);
      const base = modelKeys(_model).length > 0 ? _model : normalizeModel(updates[0]);
      let sum = zeroModelLike(base);
      for (const update of updates) {
        sum = addModels(sum, update, 1);
      }
      return scaleModel(sum, 1 / updates.length);
    };

    const recordSnapshot = (meta = {}) => {
      _history.push({
        version: _version,
        model: cloneModel(_model),
        timestamp: Date.now(),
        source: meta.source || 'local',
        roundId: meta.roundId || null
      });

      if (_history.length > _config.historyLimit) {
        _history.shift();
      }
    };

    const applyAggregatedUpdate = (update, meta = {}) => {
      const aligned = alignUpdate(update);
      _model = addModels(_model, aligned, 1);
      _version = meta.version != null ? meta.version : _version + 1;
      recordSnapshot({ source: meta.source || 'federated', roundId: meta.roundId });

      EventBus?.emit('fl:model-updated', {
        version: _version,
        roundId: meta.roundId,
        source: meta.source || 'federated'
      });

      return { model: cloneModel(_model), version: _version };
    };

    const handleRoundStart = async (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { roundId, coordinatorId, config, modelVersion } = payload || {};
      if (!roundId || !coordinatorId) return;
      const resolvedConfig = validateConfig({ ..._config, ...(config || {}),
        allowPlaintextUpdates: _config.allowPlaintextUpdates });

      EventBus?.emit('fl:round-start', {
        roundId,
        coordinatorId,
        modelVersion
      });

      if (_localUpdateProvider) {
        try {
          const update = await _localUpdateProvider({
            model: cloneModel(_model),
            version: _version,
            roundId,
            config: resolvedConfig
          });
          await submitLocalUpdate(roundId, update, { coordinatorId, config: resolvedConfig });
        } catch (err) {
          logger.warn('[FederatedLearning] Local update provider failed', err?.message || err);
        }
      } else {
        EventBus?.emit('fl:update-requested', { roundId, coordinatorId });
      }
    };

    const handleUpdate = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { roundId, update, coordinatorId } = payload || {};
      if (!roundId || !update) return;
      if (coordinatorId && coordinatorId !== getLocalPeerId()) return;

      const round = _rounds.get(roundId);
      if (!round || round.status !== 'collecting' || !round.peers.includes(peerId)) return;

      round.updates.set(peerId, update);
      EventBus?.emit('fl:round-progress', {
        roundId,
        received: round.updates.size,
        expected: round.peers.length
      });

      if (shouldFinalizeRound(round)) {
        finalizeRound(roundId, { reason: 'quorum' });
      }
    };

    const handleRoundCommit = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { roundId, update, version, coordinatorId, baseVersion } = payload || {};
      if (!roundId || !update) return;

      if (baseVersion != null && baseVersion !== _version) {
        logger.warn('[FederatedLearning] Version drift on commit', {
          local: _version,
          baseVersion,
          roundId
        });
      }

      applyAggregatedUpdate(update, { roundId, version, source: 'federated' });

      EventBus?.emit('fl:round-commit', {
        roundId,
        version: _version,
        coordinatorId
      });
    };

    const handleRoundFailed = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;
      if (!payload?.roundId) return;
      EventBus?.emit('fl:round-failed', payload);
    };

    const registerHandlers = () => {
      if (!SwarmTransport?.onMessage) return;
      SwarmTransport.onMessage('fl:round-start', handleRoundStart);
      SwarmTransport.onMessage('fl:update', handleUpdate);
      SwarmTransport.onMessage('fl:round-commit', handleRoundCommit);
      SwarmTransport.onMessage('fl:round-failed', handleRoundFailed);
    };

    const shouldFinalizeRound = (round) => {
      const expected = round.peers.length;
      const majority = Math.floor(expected / 2) + 1;
      const required = Math.max(round.config.minParticipants, majority);
      return round.updates.size >= required;
    };

    const finalizeRound = (roundId, meta = {}) => {
      const round = _rounds.get(roundId);
      if (!round || round.status !== 'collecting') return;

      clearTimeout(round.timeoutId);
      round.status = 'committing';

      if (!shouldFinalizeRound(round)) {
        round.status = 'failed';
        SwarmTransport?.broadcast?.('fl:round-failed', {
          roundId,
          reason: 'missing_peers'
        });
        EventBus?.emit('fl:round-failed', { roundId, reason: 'missing_peers' });
        return;
      }

      const aggregated = aggregateUpdates(Array.from(round.updates.values()));
      applyAggregatedUpdate(aggregated, {
        roundId,
        source: 'federated'
      });

      SwarmTransport?.broadcast?.('fl:round-commit', {
        roundId,
        update: aggregated,
        version: _version,
        baseVersion: round.baseVersion,
        coordinatorId: getLocalPeerId()
      });

      round.status = 'complete';
      EventBus?.emit('fl:round-commit', {
        roundId,
        version: _version
      });
    };

    const startRound = async (options = {}) => {
      const roundId = generateId('fl_round');
      const localId = getLocalPeerId();
      const peers = Array.from(new Set([localId, ...getConnectedPeers()]));
      const config = validateConfig({ ..._config, ...options, allowPlaintextUpdates: _config.allowPlaintextUpdates });

      const round = {
        id: roundId,
        coordinatorId: localId,
        peers,
        updates: new Map(),
        config,
        status: 'collecting',
        baseVersion: _version,
        startedAt: Date.now(),
        timeoutId: null
      };

      round.timeoutId = setTimeout(() => {
        finalizeRound(roundId, { reason: 'timeout' });
      }, config.roundTimeoutMs);

      _rounds.set(roundId, round);

      SwarmTransport?.broadcast?.('fl:round-start', {
        roundId,
        coordinatorId: localId,
        modelVersion: _version,
        config: {
          clipNorm: config.clipNorm,
          noiseStdDev: config.noiseStdDev,
          secureAggregation: config.secureAggregation,
          minParticipants: config.minParticipants
        }
      });

      EventBus?.emit('fl:round-started', { roundId, peers });

      if (_localUpdateProvider) {
        try {
          const update = await _localUpdateProvider({
            model: cloneModel(_model),
            version: _version,
            roundId,
            config
          });
          await submitLocalUpdate(roundId, update, { coordinatorId: localId, config });
        } catch (err) {
          logger.warn('[FederatedLearning] Local update provider failed', err?.message || err);
        }
      }

      return roundId;
    };

    const submitLocalUpdate = async (roundId, update, options = {}) => {
      const round = _rounds.get(roundId);
      const config = validateConfig({ ..._config, ...(options.config || round?.config || {}),
        allowPlaintextUpdates: _config.allowPlaintextUpdates });
      const coordinatorId = options.coordinatorId || round?.coordinatorId;
      if (!update) return false;

      const prepared = prepareUpdate(update, config, roundId);
      const payload = {
        roundId,
        update: prepared,
        coordinatorId
      };

      if (coordinatorId === getLocalPeerId()) {
        handleUpdate(getLocalPeerId(), payload, {});
      } else {
        SwarmTransport?.sendToPeer?.(coordinatorId, 'fl:update', payload);
      }
      return true;
    };

    const setModel = (model, meta = {}) => {
      _model = normalizeModel(model);
      _version = meta.version != null ? meta.version : _version;
      recordSnapshot({ source: meta.source || 'manual' });
      return { model: cloneModel(_model), version: _version };
    };

    const rollback = (targetVersion) => {
      const snapshot = _history.find(entry => entry.version === targetVersion);
      if (!snapshot) return false;
      _model = cloneModel(snapshot.model);
      _version = snapshot.version;
      recordSnapshot({ source: 'rollback' });
      EventBus?.emit('fl:model-rollback', { version: _version });
      return true;
    };

    const listHistory = () => _history.map(entry => ({
      version: entry.version,
      timestamp: entry.timestamp,
      source: entry.source,
      roundId: entry.roundId
    }));

    const init = async (config = {}) => {
      _config = validateConfig({ ...DEFAULTS, ...config });
      registerHandlers();

      EventBus?.on('swarm:state-change', () => {
        registerHandlers();
        }, 'FederatedLearning');

      return true;
    };

    return {
      init,
      startRound,
      submitLocalUpdate,
      setLocalUpdateProvider: (fn) => { _localUpdateProvider = fn; },
      setModel,
      getModel: () => ({ model: cloneModel(_model), version: _version }),
      rollback,
      listHistory,
      getConfig: () => ({ ..._config })
    };
  }
};

export default FederatedLearning;

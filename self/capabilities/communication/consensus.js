/**
 * @fileoverview Raft-lite Consensus
 * Leader election and log replication for multi-agent VFS mutations.
 */

const Consensus = {
  metadata: {
    id: 'Consensus',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'SwarmTransport', 'VFS?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, SwarmTransport, VFS } = deps;
    const { logger, generateId } = Utils;

    const CONFIG = {
      electionTimeoutMs: [1500, 3000],
      heartbeatMs: 500,
      requestTimeoutMs: 15000,
      maxEntrySize: 48 * 1024
    };

    let _role = 'follower'; // follower | candidate | leader
    let _currentTerm = 0;
    let _votedFor = null;
    let _leaderId = null;

    let _log = []; // { index, term, type, payload, requestId, originId, timestamp }
    let _commitIndex = 0;
    let _lastApplied = 0;

    let _electionTimer = null;
    let _heartbeatTimer = null;
    let _votes = new Set();

    let _nextIndex = new Map(); // peerId -> next log index to send
    let _matchIndex = new Map(); // peerId -> highest replicated log index

    let _pendingRequests = new Map(); // requestId -> { resolve, reject, timeoutId }
    let _queuedLocalRequests = [];

    let _clusterSizeHint = 1;
    let _localPeerId = generateId('peer');

    const getLocalPeerId = () => SwarmTransport?._getPeerId?.() || _localPeerId;

    const getPeerIds = () => {
      const peers = SwarmTransport?.getConnectedPeers?.() || [];
      return peers.map(peer => peer.id).filter(Boolean);
    };

    const updateClusterSizeHint = () => {
      const size = getPeerIds().length + 1;
      if (size > _clusterSizeHint) _clusterSizeHint = size;
    };

    const getClusterSize = () => Math.max(_clusterSizeHint, getPeerIds().length + 1);

    const getQuorumSize = () => Math.floor(getClusterSize() / 2) + 1;

    const randomElectionTimeout = () => {
      const [min, max] = CONFIG.electionTimeoutMs;
      return Math.floor(min + Math.random() * (max - min));
    };

    const resetElectionTimer = () => {
      if (_electionTimer) clearTimeout(_electionTimer);
      if (_role === 'leader') return;
      _electionTimer = setTimeout(() => {
        startElection();
      }, randomElectionTimeout());
    };

    const stopHeartbeat = () => {
      if (_heartbeatTimer) {
        clearInterval(_heartbeatTimer);
        _heartbeatTimer = null;
      }
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      _heartbeatTimer = setInterval(() => {
        broadcastAppendEntries();
      }, CONFIG.heartbeatMs);
      broadcastAppendEntries();
    };

    const isTargetedAtUs = (envelope) => {
      if (!envelope || !envelope.targetPeer) return true;
      return envelope.targetPeer === getLocalPeerId();
    };

    const setRole = (role, leaderId = null) => {
      _role = role;
      _leaderId = leaderId;
      EventBus?.emit('raft:state-change', {
        role: _role,
        term: _currentTerm,
        leaderId: _leaderId
      });
    };

    const becomeFollower = (term, leaderId = null) => {
      if (term > _currentTerm) _currentTerm = term;
      _votedFor = null;
      _votes.clear();
      stopHeartbeat();
      setRole('follower', leaderId);
      resetElectionTimer();
    };

    const initializeLeaderState = () => {
      const next = _log.length + 1;
      _nextIndex = new Map();
      _matchIndex = new Map();
      for (const peerId of getPeerIds()) {
        _nextIndex.set(peerId, next);
        _matchIndex.set(peerId, 0);
      }
    };

    const becomeLeader = () => {
      const localId = getLocalPeerId();
      _votedFor = localId;
      _votes.clear();
      initializeLeaderState();
      setRole('leader', localId);
      EventBus?.emit('raft:leader', { term: _currentTerm, leaderId: localId });
      startHeartbeat();
      flushQueuedRequests();
    };

    const startElection = () => {
      updateClusterSizeHint();
      const localId = getLocalPeerId();
      const peers = getPeerIds();
      const quorum = getQuorumSize();

      _currentTerm += 1;
      _leaderId = null;
      _votedFor = localId;
      _votes = new Set([localId]);
      setRole('candidate');

      if (quorum <= 1) {
        becomeLeader();
        return;
      }

      if (peers.length === 0 || !SwarmTransport?.sendToPeer) {
        resetElectionTimer();
        return;
      }

      const lastLogIndex = _log.length;
      const lastLogTerm = lastLogIndex > 0 ? _log[lastLogIndex - 1].term : 0;

      for (const peerId of peers) {
        SwarmTransport.sendToPeer(peerId, 'raft:request-vote', {
          term: _currentTerm,
          candidateId: localId,
          lastLogIndex,
          lastLogTerm
        });
      }

      resetElectionTimer();
      if (_votes.size >= quorum) {
        becomeLeader();
      }
    };

    const handleRequestVote = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { term, candidateId, lastLogIndex, lastLogTerm } = payload || {};
      if (term === undefined || !candidateId) return;

      if (term < _currentTerm) {
        SwarmTransport?.sendToPeer?.(peerId, 'raft:request-vote-response', {
          term: _currentTerm,
          voteGranted: false
        });
        return;
      }

      if (term > _currentTerm) {
        becomeFollower(term);
      }

      const localLastIndex = _log.length;
      const localLastTerm = localLastIndex > 0 ? _log[localLastIndex - 1].term : 0;
      const upToDate = lastLogTerm > localLastTerm ||
        (lastLogTerm === localLastTerm && lastLogIndex >= localLastIndex);

      const canVote = (_votedFor === null || _votedFor === candidateId) && upToDate;
      if (canVote) {
        _votedFor = candidateId;
        resetElectionTimer();
      }

      SwarmTransport?.sendToPeer?.(peerId, 'raft:request-vote-response', {
        term: _currentTerm,
        voteGranted: canVote
      });
    };

    const handleRequestVoteResponse = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;
      if (_role !== 'candidate') return;

      const { term, voteGranted } = payload || {};
      if (term === undefined) return;

      if (term > _currentTerm) {
        becomeFollower(term);
        return;
      }

      if (term < _currentTerm) return;

      if (voteGranted) {
        _votes.add(peerId);
        if (_votes.size >= getQuorumSize()) {
          becomeLeader();
        }
      }
    };

    const handleAppendEntries = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const {
        term,
        leaderId,
        prevLogIndex,
        prevLogTerm,
        entries = [],
        leaderCommit
      } = payload || {};

      if (term === undefined) return;

      if (term < _currentTerm) {
        SwarmTransport?.sendToPeer?.(peerId, 'raft:append-entries-response', {
          term: _currentTerm,
          success: false,
          matchIndex: _log.length
        });
        return;
      }

      if (term > _currentTerm || _role !== 'follower') {
        becomeFollower(term, leaderId);
      } else {
        _leaderId = leaderId;
        resetElectionTimer();
      }

      if (prevLogIndex > _log.length) {
        SwarmTransport?.sendToPeer?.(peerId, 'raft:append-entries-response', {
          term: _currentTerm,
          success: false,
          matchIndex: _log.length
        });
        return;
      }

      if (prevLogIndex > 0) {
        const localPrev = _log[prevLogIndex - 1];
        if (!localPrev || localPrev.term !== prevLogTerm) {
          _log = _log.slice(0, Math.max(0, prevLogIndex - 1));
          SwarmTransport?.sendToPeer?.(peerId, 'raft:append-entries-response', {
            term: _currentTerm,
            success: false,
            matchIndex: _log.length
          });
          return;
        }
      }

      for (const entry of entries) {
        if (!entry || entry.index == null) continue;
        const existing = _log[entry.index - 1];
        if (!existing) {
          _log.push(entry);
        } else if (existing.term !== entry.term) {
          _log = _log.slice(0, entry.index - 1);
          _log.push(entry);
        }
      }

      if (leaderCommit != null && leaderCommit > _commitIndex) {
        _commitIndex = Math.min(leaderCommit, _log.length);
        applyCommittedEntries();
      }

      SwarmTransport?.sendToPeer?.(peerId, 'raft:append-entries-response', {
        term: _currentTerm,
        success: true,
        matchIndex: _log.length
      });
    };

    const handleAppendEntriesResponse = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;
      if (_role !== 'leader') return;

      const { term, success, matchIndex } = payload || {};
      if (term == null) return;

      if (term > _currentTerm) {
        becomeFollower(term);
        return;
      }

      if (!success) {
        const next = Math.max(1, (_nextIndex.get(peerId) || (_log.length + 1)) - 1);
        _nextIndex.set(peerId, next);
        sendAppendEntries(peerId);
        return;
      }

      _matchIndex.set(peerId, matchIndex || 0);
      _nextIndex.set(peerId, (matchIndex || 0) + 1);
      updateCommitIndex();
    };

    const handleClientRequest = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { requestId, mutation, originId } = payload || {};
      if (!requestId || !mutation) return;

      if (_role !== 'leader') {
        if (_leaderId) {
          SwarmTransport?.sendToPeer?.(_leaderId, 'raft:client-request', payload);
          return;
        }

        SwarmTransport?.sendToPeer?.(peerId, 'raft:client-response', {
          requestId,
          status: 'rejected',
          reason: 'no_leader'
        });
        return;
      }

      try {
        const entry = appendEntry({
          type: 'vfs',
          payload: mutation,
          requestId,
          originId: originId || peerId
        });

        EventBus?.emit('raft:entry-appended', { entry, source: peerId });
      } catch (err) {
        SwarmTransport?.sendToPeer?.(peerId, 'raft:client-response', {
          requestId,
          status: 'rejected',
          reason: err.message
        });
      }
    };

    const handleClientResponse = (peerId, payload, envelope) => {
      if (!isTargetedAtUs(envelope)) return;

      const { requestId, status, reason, index } = payload || {};
      if (!requestId) return;

      const pending = _pendingRequests.get(requestId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      _pendingRequests.delete(requestId);

      if (status === 'committed') {
        pending.resolve({ requestId, index });
      } else {
        pending.reject(new Error(reason || 'Request rejected'));
      }
    };

    const registerHandlers = () => {
      if (!SwarmTransport?.onMessage) return;
      SwarmTransport.onMessage('raft:request-vote', handleRequestVote);
      SwarmTransport.onMessage('raft:request-vote-response', handleRequestVoteResponse);
      SwarmTransport.onMessage('raft:append-entries', handleAppendEntries);
      SwarmTransport.onMessage('raft:append-entries-response', handleAppendEntriesResponse);
      SwarmTransport.onMessage('raft:client-request', handleClientRequest);
      SwarmTransport.onMessage('raft:client-response', handleClientResponse);
    };

    const sendAppendEntries = (peerId, entriesOverride = null) => {
      const nextIndex = _nextIndex.get(peerId) || (_log.length + 1);
      const prevLogIndex = Math.max(0, nextIndex - 1);
      const prevLogTerm = prevLogIndex > 0 ? _log[prevLogIndex - 1].term : 0;
      const entries = entriesOverride || _log.slice(nextIndex - 1);

      SwarmTransport?.sendToPeer?.(peerId, 'raft:append-entries', {
        term: _currentTerm,
        leaderId: getLocalPeerId(),
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: _commitIndex
      });
    };

    const broadcastAppendEntries = () => {
      if (_role !== 'leader') return;
      for (const peerId of getPeerIds()) {
        sendAppendEntries(peerId, []);
      }
    };

    const updateCommitIndex = () => {
      let newCommit = _commitIndex;
      for (let index = _commitIndex + 1; index <= _log.length; index++) {
        let matchCount = 1; // leader counts as replicated
        for (const peerId of getPeerIds()) {
          if ((_matchIndex.get(peerId) || 0) >= index) {
            matchCount += 1;
          }
        }

        if (matchCount >= getQuorumSize() && _log[index - 1]?.term === _currentTerm) {
          newCommit = index;
        }
      }

      if (newCommit > _commitIndex) {
        _commitIndex = newCommit;
        applyCommittedEntries();
      }
    };

    const appendEntry = (entry) => {
      if (_role !== 'leader') {
        throw new Error('Not leader');
      }

      const nextIndex = _log.length + 1;
      const record = {
        index: nextIndex,
        term: _currentTerm,
        timestamp: Date.now(),
        ...entry
      };

      const size = JSON.stringify(record).length;
      if (size > CONFIG.maxEntrySize) {
        throw new Error(`Entry too large (${size} bytes)`);
      }

      _log.push(record);

      for (const peerId of getPeerIds()) {
        sendAppendEntries(peerId);
      }

      updateCommitIndex();
      return record;
    };

    const flushQueuedRequests = () => {
      if (_role !== 'leader' || _queuedLocalRequests.length === 0) return;
      const queued = [..._queuedLocalRequests];
      _queuedLocalRequests = [];
      for (const payload of queued) {
        handleClientRequest(getLocalPeerId(), payload, {});
      }
    };

    const finalizeRequest = (entry) => {
      if (!entry?.requestId) return;
      if (_role !== 'leader') return;

      if (entry.originId && entry.originId !== getLocalPeerId()) {
        SwarmTransport?.sendToPeer?.(entry.originId, 'raft:client-response', {
          requestId: entry.requestId,
          status: 'committed',
          index: entry.index
        });
      } else {
        const pending = _pendingRequests.get(entry.requestId);
        if (pending) {
          clearTimeout(pending.timeoutId);
          _pendingRequests.delete(entry.requestId);
          pending.resolve({ requestId: entry.requestId, index: entry.index });
        }
      }
    };

    const applyCommittedEntries = async () => {
      while (_lastApplied < _commitIndex) {
        _lastApplied += 1;
        const entry = _log[_lastApplied - 1];
        if (!entry) continue;

        if (entry.type === 'vfs') {
          await applyVfsMutation(entry.payload, entry);
        }

        EventBus?.emit('raft:entry-applied', { entry, index: entry.index });
        finalizeRequest(entry);
      }
    };

    const applyVfsMutation = async (mutation, entry) => {
      if (!mutation || !VFS) return;
      const { op, path, content } = mutation;

      try {
        if (op === 'write') {
          await VFS.write(path, content || '');
        } else if (op === 'delete') {
          await VFS.remove(path);
        } else {
          logger.warn('[Consensus] Unknown VFS op', { op, entry });
        }
      } catch (err) {
        logger.error('[Consensus] Failed to apply VFS mutation', err?.message || err);
      }
    };

    const createPendingRequest = (requestId, timeoutMs) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          _pendingRequests.delete(requestId);
          _queuedLocalRequests = _queuedLocalRequests.filter(req => req.requestId !== requestId);
          reject(new Error('Consensus request timed out'));
        }, timeoutMs);
        _pendingRequests.set(requestId, { resolve, reject, timeoutId });
      });
    };

    const replicateVfsMutation = (mutation, options = {}) => {
      if (!mutation || !mutation.op || !mutation.path) {
        return Promise.reject(new Error('Invalid mutation payload'));
      }
      const requestId = generateId('raft');
      const timeoutMs = options.timeoutMs || CONFIG.requestTimeoutMs;
      const localId = getLocalPeerId();

      const pendingPromise = createPendingRequest(requestId, timeoutMs);
      const payload = { requestId, mutation, originId: localId };

      if (_role === 'leader') {
        handleClientRequest(localId, payload, {});
      } else if (_leaderId) {
        SwarmTransport?.sendToPeer?.(_leaderId, 'raft:client-request', payload);
      } else {
        _queuedLocalRequests.push(payload);
        startElection();
      }

      return pendingPromise;
    };

    const getStatus = () => ({
      role: _role,
      term: _currentTerm,
      leaderId: _leaderId,
      commitIndex: _commitIndex,
      lastApplied: _lastApplied,
      logLength: _log.length,
      quorumSize: getQuorumSize(),
      clusterSize: getClusterSize()
    });

    const getLog = () => _log.map(entry => ({
      index: entry.index,
      term: entry.term,
      type: entry.type,
      requestId: entry.requestId,
      originId: entry.originId,
      timestamp: entry.timestamp
    }));

    const init = async () => {
      registerHandlers();
      updateClusterSizeHint();

      EventBus?.on('swarm:peer-joined', () => {
        updateClusterSizeHint();
        if (_role === 'leader') initializeLeaderState();
      }, 'Consensus');

      EventBus?.on('swarm:peer-left', ({ peerId }) => {
        _nextIndex.delete(peerId);
        _matchIndex.delete(peerId);
      }, 'Consensus');

      EventBus?.on('swarm:state-change', () => {
        registerHandlers();
      }, 'Consensus');

      resetElectionTimer();
      return true;
    };

    const destroy = () => {
      if (_electionTimer) clearTimeout(_electionTimer);
      stopHeartbeat();
      EventBus?.unsubscribeModule?.('Consensus');
    };

    return {
      init,
      replicateVfsMutation,
      getStatus,
      getLog,
      startElection,
      destroy,
      setClusterSizeHint: (size) => {
        if (Number.isFinite(size) && size > 0) {
          _clusterSizeHint = Math.max(_clusterSizeHint, size);
        }
      }
    };
  }
};

export default Consensus;

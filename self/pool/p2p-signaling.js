export const SIGNAL_TYPES = Object.freeze({
  OFFER: 'offer',
  ANSWER: 'answer',
  ICE_CANDIDATE: 'ice-candidate',
  CLOSE: 'close',
  PING: 'ping',
});

export function createSignalId(prefix = 'sig') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function createSignalMessage({
  id = createSignalId(),
  sessionId,
  assignmentId = null,
  type,
  fromPeerId,
  toPeerId = null,
  payload = null,
  createdAt = Date.now(),
  expiresAt = null,
} = {}) {
  const message = {
    id,
    sessionId,
    assignmentId,
    type,
    fromPeerId,
    toPeerId,
    payload,
    createdAt,
    expiresAt,
  };

  return normalizeSignalMessage(message);
}

export function normalizeSignalMessage(value) {
  const message = unwrapSignalRecord(value);

  if (!isPlainObject(message)) {
    throw new TypeError('signal message must be an object');
  }

  const normalized = {
    id: requireString(message.id, 'signal message id'),
    sessionId: requireString(message.sessionId, 'signal sessionId'),
    assignmentId: optionalString(message.assignmentId, 'signal assignmentId'),
    type: requireSignalType(message.type),
    fromPeerId: requireString(message.fromPeerId, 'signal fromPeerId'),
    toPeerId: optionalString(message.toPeerId, 'signal toPeerId'),
    payload: message.payload ?? null,
    createdAt: requireFiniteNumber(message.createdAt, 'signal createdAt'),
    expiresAt: optionalFiniteNumber(message.expiresAt, 'signal expiresAt'),
  };

  return Object.freeze(normalized);
}

export function isSignalForPeer(message, {
  sessionId,
  localPeerId,
  remotePeerId = null,
  includeOwnSignals = false,
  now = Date.now(),
} = {}) {
  const normalized = normalizeSignalMessage(message);

  if (sessionId && normalized.sessionId !== sessionId) {
    return false;
  }

  if (normalized.expiresAt !== null && normalized.expiresAt <= now) {
    return false;
  }

  if (!includeOwnSignals && normalized.fromPeerId === localPeerId) {
    return false;
  }

  if (normalized.toPeerId && normalized.toPeerId !== localPeerId) {
    return false;
  }

  if (remotePeerId && normalized.fromPeerId !== remotePeerId) {
    return false;
  }

  return true;
}

export function createCallbackSignalingAdapter({
  publish,
  subscribe,
  close = null,
} = {}) {
  if (typeof publish !== 'function') {
    throw new TypeError('publish must be a function');
  }

  if (typeof subscribe !== 'function') {
    throw new TypeError('subscribe must be a function');
  }

  return Object.freeze({
    publish(message) {
      return publish(normalizeSignalMessage(message));
    },

    subscribe(onMessage) {
      if (typeof onMessage !== 'function') {
        throw new TypeError('onMessage must be a function');
      }

      return normalizeUnsubscribe(subscribe((record) => {
        for (const candidate of extractSignalRecords(record)) {
          onMessage(normalizeSignalMessage(candidate));
        }
      }));
    },

    close,
  });
}

export function createFirestoreLikeSignalingAdapter({
  addSignal,
  listenSignals,
  close = null,
} = {}) {
  if (typeof addSignal !== 'function') {
    throw new TypeError('addSignal must be a function');
  }

  if (typeof listenSignals !== 'function') {
    throw new TypeError('listenSignals must be a function');
  }

  return createCallbackSignalingAdapter({
    publish: addSignal,
    subscribe: listenSignals,
    close,
  });
}

export function createPollingSignalingAdapter({
  publishSignal,
  listSignals,
  pollIntervalMs = 1000,
  peerId = null,
  after = 0,
  close = null,
} = {}) {
  if (typeof publishSignal !== 'function') {
    throw new TypeError('publishSignal must be a function');
  }

  if (typeof listSignals !== 'function') {
    throw new TypeError('listSignals must be a function');
  }

  let cursor = Number(after || 0);
  let timer = null;
  let stopped = false;

  return createCallbackSignalingAdapter({
    publish: publishSignal,
    subscribe(onMessage) {
      const poll = async () => {
        if (stopped) return;
        try {
          const result = await listSignals({ after: cursor, peerId });
          const messages = Array.isArray(result?.messages) ? result.messages : Array.isArray(result) ? result : [];
          for (const message of messages) {
            const normalized = normalizeSignalMessage(message);
            cursor = Math.max(cursor, Number(normalized.createdAt || 0));
            onMessage(normalized);
          }
        } finally {
          if (!stopped) timer = globalThis.setTimeout(poll, pollIntervalMs);
        }
      };
      void poll();
      return () => {
        stopped = true;
        if (timer) globalThis.clearTimeout(timer);
        timer = null;
      };
    },
    close() {
      stopped = true;
      if (timer) globalThis.clearTimeout(timer);
      timer = null;
      if (typeof close === 'function') close();
    },
  });
}

export function createPoolSdkSignalingAdapter({
  sdk,
  sessionId,
  peerId,
  pollIntervalMs = 1000,
  after = 0,
} = {}) {
  if (!sdk || typeof sdk.publishSignal !== 'function' || typeof sdk.listSignals !== 'function') {
    throw new TypeError('sdk must provide publishSignal() and listSignals()');
  }

  const boundSessionId = requireString(sessionId, 'sessionId');
  const boundPeerId = optionalString(peerId, 'peerId');
  return createPollingSignalingAdapter({
    pollIntervalMs,
    peerId: boundPeerId,
    after,
    publishSignal(message) {
      return sdk.publishSignal(boundSessionId, message).then((result) => result?.message || result);
    },
    listSignals(options = {}) {
      return sdk.listSignals(boundSessionId, {
        after: options.after,
        peerId: options.peerId ?? boundPeerId
      });
    },
  });
}

export function createSignalingChannel({
  sessionId,
  assignmentId = null,
  localPeerId,
  remotePeerId = null,
  adapter,
  signalTtlMs = null,
  now = () => Date.now(),
} = {}) {
  if (!adapter || typeof adapter.publish !== 'function' || typeof adapter.subscribe !== 'function') {
    throw new TypeError('adapter must provide publish() and subscribe()');
  }

  const channelSessionId = requireString(sessionId, 'sessionId');
  const channelLocalPeerId = requireString(localPeerId, 'localPeerId');
  const channelRemotePeerId = optionalString(remotePeerId, 'remotePeerId');
  const channelAssignmentId = optionalString(assignmentId, 'assignmentId');
  let unsubscribe = null;
  let closed = false;

  function assertOpen() {
    if (closed) {
      throw new Error('signaling channel is closed');
    }
  }

  async function send(type, payload = null, options = {}) {
    assertOpen();

    const createdAt = now();
    const ttl = options.signalTtlMs ?? signalTtlMs;
    const message = createSignalMessage({
      sessionId: channelSessionId,
      assignmentId: options.assignmentId ?? channelAssignmentId,
      type,
      fromPeerId: channelLocalPeerId,
      toPeerId: options.toPeerId ?? channelRemotePeerId,
      payload,
      createdAt,
      expiresAt: ttl === null ? null : createdAt + ttl,
    });

    await adapter.publish(message);
    return message;
  }

  function subscribe(onMessage, options = {}) {
    assertOpen();

    if (unsubscribe) {
      throw new Error('signaling channel already has a subscriber');
    }

    if (typeof onMessage !== 'function') {
      throw new TypeError('onMessage must be a function');
    }

    unsubscribe = adapter.subscribe((message) => {
      if (!isSignalForPeer(message, {
        sessionId: channelSessionId,
        localPeerId: channelLocalPeerId,
        remotePeerId: options.remotePeerId ?? channelRemotePeerId,
        includeOwnSignals: Boolean(options.includeOwnSignals),
        now: now(),
      })) {
        return;
      }

      onMessage(message);
    });

    return () => {
      if (!unsubscribe) {
        return;
      }

      unsubscribe();
      unsubscribe = null;
    };
  }

  function close() {
    if (closed) {
      return;
    }

    closed = true;

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (typeof adapter.close === 'function') {
      adapter.close();
    }
  }

  return Object.freeze({
    sessionId: channelSessionId,
    assignmentId: channelAssignmentId,
    localPeerId: channelLocalPeerId,
    remotePeerId: channelRemotePeerId,
    send,
    sendOffer: (description, options) => send(SIGNAL_TYPES.OFFER, description, options),
    sendAnswer: (description, options) => send(SIGNAL_TYPES.ANSWER, description, options),
    sendIceCandidate: (candidate, options) => send(SIGNAL_TYPES.ICE_CANDIDATE, candidate, options),
    sendClose: (reason = null, options) => send(SIGNAL_TYPES.CLOSE, { reason }, options),
    sendPing: (payload = null, options) => send(SIGNAL_TYPES.PING, payload, options),
    subscribe,
    close,
  });
}

function extractSignalRecords(record) {
  if (Array.isArray(record)) {
    return record;
  }

  if (Array.isArray(record?.signals)) {
    return record.signals;
  }

  if (Array.isArray(record?.docs)) {
    return record.docs.map((doc) => unwrapSignalRecord(doc));
  }

  if (Array.isArray(record?.docChanges?.())) {
    return record.docChanges().map((change) => unwrapSignalRecord(change.doc));
  }

  return [record];
}

function unwrapSignalRecord(record) {
  if (typeof record?.data === 'function') {
    return record.data();
  }

  if (record?.message) {
    return record.message;
  }

  return record;
}

function normalizeUnsubscribe(value) {
  if (typeof value === 'function') {
    return value;
  }

  if (value && typeof value.unsubscribe === 'function') {
    return () => value.unsubscribe();
  }

  return () => {};
}

function requireSignalType(value) {
  const type = requireString(value, 'signal type');
  const allowed = Object.values(SIGNAL_TYPES);

  if (!allowed.includes(type)) {
    throw new TypeError(`unsupported signal type: ${type}`);
  }

  return type;
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }

  return value;
}

function optionalString(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function requireFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }

  return value;
}

function optionalFiniteNumber(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  return requireFiniteNumber(value, label);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

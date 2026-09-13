export { SIGNAL_TYPES, DEFAULT_SIGNAL_POLL_TIMEOUT_MS, DEFAULT_SIGNAL_FAILURE_THRESHOLD, DEFAULT_SIGNAL_POLL_BACKOFF_BASE_MS, DEFAULT_SIGNAL_POLL_BACKOFF_MAX_MS, createSignalId, createSignalMessage, normalizeSignalMessage, isSignalForPeer, createCallbackSignalingAdapter, createFirestoreLikeSignalingAdapter, createSignalingChannel } from '../vendor/reploid/transport/index.js';
import { createPollingSignalingAdapter as polling, createPoolSdkSignalingAdapter as pool } from '../vendor/reploid/transport/index.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
const config = resolveConfig();
export const createPollingSignalingAdapter = options => polling({ config, ...options });
export const createPoolSdkSignalingAdapter = options => pool({ config, ...options });

/**
 * @fileoverview Polls the server relay's room activity while the room view is open. Local rooms
 * are reported as local; nothing is polled for them.
 */
import { createPoolSdk } from '../../../../shared/pool/sdk.js';
import { getPeerRelayMode, getPeerRoomId, refreshRoomActivityState } from './view.js';
import { errorString } from './control-display-text.js';

const POOL_ROOM_ACTIVITY_POLL_MS = 5000;

export const refreshServerRoomActivity = async (isActive = () => true) => {
  const activity = document.getElementById('pool-room-activity');
  const networkState = document.querySelector('[data-pool-network-state]');
  if (!activity && !networkState) return null;
  if (getPeerRelayMode() === 'local') {
    if (isActive()) refreshRoomActivityState();
    return null;
  }
  try {
    const summary = await createPoolSdk({ authTokenProvider: null }).peerRoomSummary(getPeerRoomId(), { limit: 100 });
    if (isActive()) refreshRoomActivityState(summary);
    return summary;
  } catch (error) {
    if (isActive()) refreshRoomActivityState({ error: errorString(error) });
    return null;
  }
};

export const bindRoomActivityControls = () => {
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP?.();
  if (!document.getElementById('pool-room-activity') && !document.querySelector('[data-pool-network-state]')) return;
  let active = true;
  let refreshing = false;
  const refresh = async () => {
    if (!active || refreshing || document.visibilityState === 'hidden') return;
    refreshing = true;
    try {
      await refreshServerRoomActivity(() => active);
    } finally {
      refreshing = false;
    }
  };
  const intervalId = window.setInterval(() => void refresh(), POOL_ROOM_ACTIVITY_POLL_MS);
  window.REPLOID_POOL_ROOM_ACTIVITY_STOP = () => {
    active = false;
    window.clearInterval(intervalId);
    if (window.REPLOID_POOL_ROOM_ACTIVITY_STOP) window.REPLOID_POOL_ROOM_ACTIVITY_STOP = null;
  };
  void refresh();
};

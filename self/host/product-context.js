import { DEFAULT_PEER_ROOM_ID } from '../pool/peer-room.js';
import { createPeerRoomBusFactory } from '../pool/peer-rendezvous.js';
import { createPoolSdk } from '../pool/sdk.js';
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import { isWorkOrderedModel } from './work-partition-plan.js';
import orderedPolicy from '../config/ordered-participation.json' with { type: 'json' };

/** Ordered mode follows the installed catalog with versioned limits. Only this instance's
 * operator storage may assign a stage or choose `{ modelId, assignment: 'auto' }`; links,
 * invitations and discovery never do. Deliberate Launch 3 boundary change: `auto` authorizes
 * this contributor's own policy to pick a stage from observed ready offers. It is off unless the
 * operator also stores its orchestration policy. Host composition validates both and binds the
 * stage to the authenticated participant. */
export const getOrderedParticipation = (storage, models = LOCAL_DOPPLER_MODELS) => {
  const read = (key, label) => {
    const saved = storage?.getItem(key, { legacyFallback: false }) ?? null;
    if (saved === null) return null;
    let value;
    try { value = JSON.parse(saved); } catch { throw new Error(`Operator ordered ${label} is not valid JSON`); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(label === 'stage assignment' ? 'Operator ordered stage assignment must be one explicit stage object'
        : 'Operator ordered orchestration must be one explicit policy object');
    }
    return value;
  };
  const stage = read(orderedPolicy.stageStorageKey, 'stage assignment');
  if (stage === null && !models.some(isWorkOrderedModel)) return null;
  const orchestration = read(orderedPolicy.orchestrationStorageKey, 'orchestration');
  return { stage, ...orderedPolicy.limits, ...(orchestration ? { orchestration } : {}) };
};

export const getPeerRoomId = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('room') || window.REPLOID_POOL_ROOM_ID || DEFAULT_PEER_ROOM_ID;
};

export const getPeerRelayMode = () => {
  const params = new URLSearchParams(window.location.search || '');
  const configured = params.get('relay') || window.REPLOID_POOL_RELAY || 'server';
  return configured === 'local' ? 'local' : 'server';
};

export const getPeerRelayLabel = () => (
  getPeerRelayMode() === 'local' ? 'local tab' : 'server relay'
);

export const getPeerRoomBusFactory = () => createPeerRoomBusFactory({
  sdk: getPeerRelayMode() === 'local' ? null : createPoolSdk({ authTokenProvider: null }),
  relay: getPeerRelayMode()
});

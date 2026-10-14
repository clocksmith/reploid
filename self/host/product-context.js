import { DEFAULT_PEER_ROOM_ID } from '../pool/peer-room.js';
import { createPeerRoomBusFactory } from '../pool/peer-rendezvous.js';
import { createPoolSdk } from '../pool/sdk.js';
import { LOCAL_DOPPLER_MODELS } from '../config/doppler-local-models.js';
import { isWorkOrderedModel } from './work-partition-plan.js';
import orderedPolicy from '../config/ordered-participation.json' with { type: 'json' };

/** Ordered mode follows the installed catalog with versioned limits. Only this instance's
 * operator storage may assign a stage; links, invitations and discovery never do. Host
 * composition validates the stage and binds it to the authenticated participant. */
export const getOrderedParticipation = (storage, models = LOCAL_DOPPLER_MODELS) => {
  const saved = storage?.getItem(orderedPolicy.stageStorageKey, { legacyFallback: false }) ?? null;
  if (saved === null && !models.some(isWorkOrderedModel)) return null;
  let stage = null;
  if (saved !== null) {
    try { stage = JSON.parse(saved); } catch { throw new Error('Operator ordered stage assignment is not valid JSON'); }
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
      throw new Error('Operator ordered stage assignment must be one explicit stage object');
    }
  }
  return { stage, ...orderedPolicy.limits };
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

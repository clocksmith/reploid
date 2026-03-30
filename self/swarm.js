/**
 * @fileoverview Swarm roles, task envelopes, and transport-agnostic coordination.
 */

import { DEFAULT_REWARD_POLICY, rankProviderPeers } from './reward-policy.js';

export const SWARM_ROLES = Object.freeze({
  SOLO: 'solo',
  PROVIDER: 'provider',
  CONSUMER: 'consumer',
  DEAD: 'dead'
});

export function deriveSwarmRole(options = {}) {
  const hasInference = !!options.hasInference;
  const swarmEnabled = !!options.swarmEnabled;

  if (hasInference && !swarmEnabled) return SWARM_ROLES.SOLO;
  if (hasInference && swarmEnabled) return SWARM_ROLES.PROVIDER;
  if (!hasInference && swarmEnabled) return SWARM_ROLES.CONSUMER;
  return SWARM_ROLES.DEAD;
}

export function createPeerAdvertisement(options = {}) {
  const peerId = String(options.peerId || 'unknown').trim() || 'unknown';
  const capabilities = Array.from(new Set(Array.isArray(options.capabilities) ? options.capabilities.filter(Boolean) : []));
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;

  return {
    kind: 'peer_advertisement',
    peerId,
    role: deriveSwarmRole({ hasInference, swarmEnabled }),
    swarmEnabled,
    hasInference,
    capabilities,
    contribution: options.contribution || null,
    updatedAt: Number(options.updatedAt || Date.now())
  };
}

export function createGenerationRequest(options = {}) {
  const task = String(options.task || '').trim();
  if (!task) {
    throw new Error('Missing task');
  }

  return {
    kind: 'generation_request',
    requestId: String(options.requestId || `req_${Date.now()}`),
    consumer: String(options.consumer || '').trim() || 'unknown',
    provider: options.provider ? String(options.provider) : null,
    model: options.model ? String(options.model) : null,
    task,
    context: options.context || null,
    maxInputTokens: Math.max(0, Number(options.maxInputTokens || 0)),
    maxOutputTokens: Math.max(0, Number(options.maxOutputTokens || 0)),
    createdAt: Number(options.createdAt || Date.now())
  };
}

export function createGenerationResult(options = {}) {
  return {
    kind: 'generation_result',
    requestId: String(options.requestId || ''),
    provider: String(options.provider || '').trim() || 'unknown',
    content: String(options.content || ''),
    usage: options.usage || null,
    error: options.error ? String(options.error) : null,
    completedAt: Number(options.completedAt || Date.now())
  };
}

export function buildSwarmState(options = {}) {
  const peers = Array.isArray(options.peers) ? options.peers : [];
  const role = deriveSwarmRole({
    hasInference: !!options.hasInference,
    swarmEnabled: !!options.swarmEnabled
  });

  return {
    enabled: !!options.swarmEnabled,
    role,
    peerCount: peers.length,
    providerCount: peers.filter((peer) => peer?.role === SWARM_ROLES.PROVIDER).length,
    consumerCount: peers.filter((peer) => peer?.role === SWARM_ROLES.CONSUMER).length,
    soloCount: peers.filter((peer) => peer?.role === SWARM_ROLES.SOLO).length
  };
}

export function chooseProviderPeer(peers = [], options = {}) {
  const ranked = rankProviderPeers(peers, {
    now: options.now || Date.now(),
    policy: options.policy || DEFAULT_REWARD_POLICY
  });
  return ranked[0] || null;
}

export function createSwarmController(options = {}) {
  const peerMap = new Map();
  const policy = options.policy || DEFAULT_REWARD_POLICY;

  const listPeers = () => Array.from(peerMap.values());

  return {
    upsertPeer(peer) {
      if (!peer?.peerId) return null;
      const next = createPeerAdvertisement(peer);
      peerMap.set(next.peerId, next);
      return next;
    },
    removePeer(peerId) {
      return peerMap.delete(String(peerId || ''));
    },
    listPeers,
    chooseProvider(now = Date.now()) {
      return chooseProviderPeer(listPeers(), { now, policy });
    },
    getState(input = {}) {
      return buildSwarmState({
        ...input,
        peers: listPeers()
      });
    },
    createAdvertisement: createPeerAdvertisement,
    createRequest: createGenerationRequest,
    createResult: createGenerationResult
  };
}

export default {
  SWARM_ROLES,
  buildSwarmState,
  chooseProviderPeer,
  createGenerationRequest,
  createGenerationResult,
  createPeerAdvertisement,
  createSwarmController,
  deriveSwarmRole
};

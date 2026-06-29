/**
 * @fileoverview Peer capability registry for Reploid orchestration.
 * Section 1 of TODO_REPLOID.md: Peer Registry and Capability Schema.
 */

export const PEER_REGISTRY_VERSION = 'reploid_peer_registry/v1';

const VALID_BACKENDS = new Set(['webgpu', 'metal', 'vulkan', 'dx12', 'cpu']);
const VALID_GENERATORS = new Set([
  'splitmix64_normal_v1',
  'siren_f16_v1',
  'siren_f32_v1'
]);

const cleanString = (v) => String(v || '').trim() || null;
const cleanNumber = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const cleanArray = (v) => (Array.isArray(v) ? v.map(String) : []);

export function buildCapabilityProfile({
  peerId,
  reploidVersion = 'reploid@0.22.4',
  hardwareCapabilities = {},
  networkPerformance = {},
  reliabilityScore = null
} = {}) {
  const id = cleanString(peerId);
  if (!id) throw new TypeError('peerId is required');
  return Object.freeze({
    registryVersion: PEER_REGISTRY_VERSION,
    peer_id: id,
    reploid_version: cleanString(reploidVersion) || 'reploid@0.0.0',
    hardware_capabilities: Object.freeze({
      available_vram_bytes: cleanNumber(hardwareCapabilities.available_vram_bytes),
      backends: Object.freeze(cleanArray(hardwareCapabilities.backends).filter((b) => VALID_BACKENDS.has(b))),
      supported_generators: Object.freeze(cleanArray(hardwareCapabilities.supported_generators).filter((g) => VALID_GENERATORS.has(g)))
    }),
    network_performance: Object.freeze({
      bandwidth_ingress_bps: cleanNumber(networkPerformance.bandwidth_ingress_bps),
      bandwidth_egress_bps: cleanNumber(networkPerformance.bandwidth_egress_bps),
      latency_rtt_ms: cleanNumber(networkPerformance.latency_rtt_ms)
    }),
    reliability_score: reliabilityScore !== null && reliabilityScore !== undefined
      ? Math.max(0, Math.min(1, Number(reliabilityScore)))
      : 1.0,
    registered_at: new Date().toISOString()
  });
}

export function validateCapabilityProfile(profile = {}) {
  const reasons = [];
  if (!cleanString(profile.peer_id)) reasons.push('peer_id is required');
  if (!cleanString(profile.reploid_version)) reasons.push('reploid_version is required');
  if (!profile.hardware_capabilities || typeof profile.hardware_capabilities !== 'object') {
    reasons.push('hardware_capabilities must be an object');
  } else {
    if (!cleanArray(profile.hardware_capabilities.backends).length) {
      reasons.push('hardware_capabilities.backends must not be empty');
    }
  }
  if (!profile.network_performance || typeof profile.network_performance !== 'object') {
    reasons.push('network_performance must be an object');
  } else {
    if (cleanNumber(profile.network_performance.latency_rtt_ms) < 0) {
      reasons.push('network_performance.latency_rtt_ms must be >= 0');
    }
  }
  if (typeof profile.reliability_score !== 'number' || profile.reliability_score < 0 || profile.reliability_score > 1) {
    reasons.push('reliability_score must be a number in [0, 1]');
  }
  return { ok: reasons.length === 0, reasons };
}

export function createPeerRegistry() {
  const profiles = new Map();
  const quarantined = new Set();
  const blocked = new Set();

  const register = (profile) => {
    const { ok, reasons } = validateCapabilityProfile(profile);
    if (!ok) throw new Error(`invalid capability profile: ${reasons.join('; ')}`);
    profiles.set(profile.peer_id, { ...profile, last_seen: new Date().toISOString() });
    return profile.peer_id;
  };

  const unregister = (peerId) => {
    profiles.delete(peerId);
  };

  const get = (peerId) => profiles.get(peerId) || null;

  const updateReliability = (peerId, delta) => {
    const p = profiles.get(peerId);
    if (!p) return;
    const next = Math.max(0, Math.min(1, p.reliability_score + delta));
    profiles.set(peerId, { ...p, reliability_score: next });
    if (next < 0.5) {
      blocked.add(peerId);
    }
  };

  const quarantine = (peerId, reason = 'output_mismatch') => {
    quarantined.add(peerId);
    updateReliability(peerId, -0.25);
    return { peerId, reason, quarantinedAt: new Date().toISOString() };
  };

  const isEligible = (peerId) => !quarantined.has(peerId) && !blocked.has(peerId);

  const listEligible = ({ minReliability = 0, requireBackend = null } = {}) => {
    const result = [];
    for (const [id, p] of profiles) {
      if (!isEligible(id)) continue;
      if (p.reliability_score < minReliability) continue;
      if (requireBackend && !p.hardware_capabilities.backends.includes(requireBackend)) continue;
      result.push(p);
    }
    return result.sort((a, b) => b.reliability_score - a.reliability_score);
  };

  const clearQuarantine = (peerId) => {
    quarantined.delete(peerId);
  };

  return {
    register,
    unregister,
    get,
    updateReliability,
    quarantine,
    clearQuarantine,
    isEligible,
    listEligible,
    isBlocked: (id) => blocked.has(id),
    isQuarantined: (id) => quarantined.has(id),
    size: () => profiles.size
  };
}

export default {
  PEER_REGISTRY_VERSION,
  buildCapabilityProfile,
  validateCapabilityProfile,
  createPeerRegistry
};

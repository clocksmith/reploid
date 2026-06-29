/**
 * @fileoverview Layer assignment and scheduling for Reploid pipeline-parallel execution.
 * Section 3 of TODO_REPLOID.md: Layer Assignment and Scheduling.
 *
 * Implements:
 *   - Critical path optimization (TTFT: lowest RTT and highest reliability for prefill layers)
 *   - Warm standby policy (active P1 + standby P2 per layer group)
 *   - Structured assignment logging written into the final receipt
 */

export const LAYER_SCHEDULER_VERSION = 'reploid_layer_scheduler/v1';

const PREFILL_LAYER_THRESHOLD = 4;
const TTFT_MAX_RTT_MS = 20;
const TTFT_MIN_RELIABILITY = 0.99;
const TIMEOUT_RELIABILITY_PENALTY = 0.05;

export function buildLayerGroups({ totalLayers, peerCount }) {
  const count = Math.max(1, Math.floor(peerCount));
  const layers = Math.max(1, Math.floor(totalLayers));
  const groupSize = Math.ceil(layers / count);
  const groups = [];
  for (let start = 0; start < layers; start += groupSize) {
    const end = Math.min(start + groupSize - 1, layers - 1);
    groups.push({ layerStart: start, layerEnd: end, layers: Array.from({ length: end - start + 1 }, (_, i) => start + i) });
  }
  return groups;
}

function scorePeerForGroup(peer, groupIndex, { isPrefill = false } = {}) {
  const rtt = Number(peer.network_performance?.latency_rtt_ms ?? 999);
  const reliability = Number(peer.reliability_score ?? 0);
  const hasWebGPU = (peer.hardware_capabilities?.backends || []).includes('webgpu');

  if (isPrefill) {
    if (rtt > TTFT_MAX_RTT_MS || reliability < TTFT_MIN_RELIABILITY) return -Infinity;
  }

  const rttScore = Math.max(0, 1 - rtt / 200);
  const reliabilityScore = reliability;
  const backendBonus = hasWebGPU ? 0.1 : 0;

  return rttScore * 0.4 + reliabilityScore * 0.5 + backendBonus;
}

export function assignLayerGroups({ peers, layerGroups, standbyDepth = 1 }) {
  if (!Array.isArray(peers) || peers.length === 0) throw new Error('peers must be a non-empty array');
  if (!Array.isArray(layerGroups) || layerGroups.length === 0) throw new Error('layerGroups must be a non-empty array');

  const assignments = [];
  const assignedAsActive = new Set();

  for (let gi = 0; gi < layerGroups.length; gi++) {
    const group = layerGroups[gi];
    const isPrefill = group.layerStart <= PREFILL_LAYER_THRESHOLD;

    const scored = peers
      .map((p) => ({ peer: p, score: scorePeerForGroup(p, gi, { isPrefill }) }))
      .filter((e) => Number.isFinite(e.score))
      .sort((a, b) => b.score - a.score);

    if (!scored.length) throw new Error(`no eligible peer for layer group ${gi} (layers ${group.layerStart}..${group.layerEnd})`);

    const active = scored[0].peer;
    assignedAsActive.add(active.peer_id);

    const standbyPool = scored.slice(1).filter((e) => !assignedAsActive.has(e.peer.peer_id));
    const standbys = standbyPool.slice(0, standbyDepth).map((e) => e.peer);

    assignments.push({
      groupIndex: gi,
      layerStart: group.layerStart,
      layerEnd: group.layerEnd,
      layers: group.layers,
      isPrefill,
      activePeer: active,
      standbyPeers: standbys,
      score: scored[0].score,
      assignedAt: new Date().toISOString()
    });
  }

  return assignments;
}

export function buildAssignmentLog({ assignments, sessionId, jobId }) {
  const entries = assignments.map((a) => ({
    groupIndex: a.groupIndex,
    layerStart: a.layerStart,
    layerEnd: a.layerEnd,
    isPrefill: a.isPrefill,
    activePeerId: a.activePeer?.peer_id,
    standbyPeerIds: (a.standbyPeers || []).map((p) => p.peer_id),
    reliabilityAtAssignment: a.activePeer?.reliability_score,
    rttAtAssignment: a.activePeer?.network_performance?.latency_rtt_ms,
    score: a.score,
    assignedAt: a.assignedAt
  }));

  return Object.freeze({
    schedulerVersion: LAYER_SCHEDULER_VERSION,
    sessionId: String(sessionId || ''),
    jobId: String(jobId || ''),
    totalGroups: assignments.length,
    entries: Object.freeze(entries),
    loggedAt: new Date().toISOString()
  });
}

export function createWarmStandbyMonitor({ assignments, onFailover, heartbeatIntervalMs = 3000 }) {
  const active = new Map(assignments.map((a) => [a.groupIndex, a]));
  const failedOver = new Set();
  let intervalId = null;
  const lastSeen = new Map(assignments.map((a) => [a.activePeer?.peer_id, Date.now()]));

  const heartbeat = (peerId) => {
    lastSeen.set(peerId, Date.now());
  };

  const check = () => {
    const now = Date.now();
    for (const [gi, assignment] of active) {
      if (failedOver.has(gi)) continue;
      const pid = assignment.activePeer?.peer_id;
      const seen = lastSeen.get(pid) ?? 0;
      if (now - seen > heartbeatIntervalMs * 2) {
        failedOver.add(gi);
        const standby = assignment.standbyPeers?.[0] ?? null;
        if (typeof onFailover === 'function') {
          onFailover({ groupIndex: gi, failedPeerId: pid, standbyPeer: standby, at: new Date().toISOString() });
        }
      }
    }
  };

  const start = () => {
    if (intervalId) return;
    intervalId = setInterval(check, heartbeatIntervalMs);
  };

  const stop = () => {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  };

  return { start, stop, heartbeat, isFailedOver: (gi) => failedOver.has(gi) };
}

export function computeDeadlineMs({ prefillTimeMs, rttMs }) {
  return Math.max(0, Number(prefillTimeMs || 0)) + 1.5 * Math.max(0, Number(rttMs || 0));
}

export function applyTimeoutPenalty({ registry, peerId }) {
  if (typeof registry?.updateReliability === 'function') {
    registry.updateReliability(peerId, -TIMEOUT_RELIABILITY_PENALTY);
  }
  return { peerId, delta: -TIMEOUT_RELIABILITY_PENALTY };
}

export default {
  LAYER_SCHEDULER_VERSION,
  PREFILL_LAYER_THRESHOLD,
  TTFT_MAX_RTT_MS,
  TTFT_MIN_RELIABILITY,
  buildLayerGroups,
  assignLayerGroups,
  buildAssignmentLog,
  createWarmStandbyMonitor,
  computeDeadlineMs,
  applyTimeoutPenalty
};

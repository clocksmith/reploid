export { createLegacyGenerationMesh } from './legacy-generation.js';
export { projectPlacementBeliefs, resolvePlacementBeliefPolicy } from './placement-beliefs.js';
export * from './swarm-coordination.js';
export * from './contribution.js';
export { default as contributionPolicy } from './contribution.js';
export { default as swarmCoordination } from './swarm-coordination.js';
import routing from '../rules/routing.rules.json' with { type: 'json' };
import { requireResolvedConfig, snapshotJson } from '../config/index.js';

export function createIntelligenceMesh({ config, ports }) {
  const policy = requireResolvedConfig(config);
  if (typeof ports?.authorize !== 'function') throw new TypeError('Mesh host authorization is required');
  const order = routing.rules.find(rule => rule.id === policy.mesh.routing).order;
  let closed = false;
  return Object.freeze({
    async connect() {
      if (closed || !policy.mesh.enabled) throw new Error('Mesh connection is disabled');
      if (await ports.authorize({ action: 'mesh.connect', roomId: policy.mesh.roomId }) !== true) throw new Error('Host denied mesh connection');
      if (!ports.remote?.connect) throw new Error('A configured protocol adapter is required');
      return ports.remote.connect();
    },
    async generate(messages, onUpdate, { signal } = {}) {
      if (closed) throw new Error('Mesh is closed');
      signal?.throwIfAborted();
      for (const placement of order) {
        const provider = ports[placement];
        if (!provider) continue;
        if (placement === 'remote' && (!policy.mesh.enabled || !provider.hasAvailableProvider?.())) continue;
        if (await ports.authorize({ action: 'mesh.place', placement, contract: policy.models.contract }) !== true) continue;
        // Placement is chosen before execution. Execution failure never silently
        // retries private data on another provider.
        return provider.generate(snapshotJson(messages), onUpdate, { signal });
      }
      throw new Error('No authorized compatible execution placement');
    },
    describe() {
      return snapshotJson({ schema: 'reploid.mesh-state/v1', enabled: policy.mesh.enabled,
        permissions: { executeJobs: policy.mesh.executeJobs, supplyArtifacts: policy.mesh.supplyArtifacts, shareCandidates: policy.mesh.shareCandidates },
        local: !!ports.local, remote: ports.remote?.getSwarmSnapshot?.() || null, modelContract: policy.models.contract,
        publicQualification: null });
    },
    async close() { closed = true; }
  });
}

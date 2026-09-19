import type { createPeerPackSupplier, createPeerPackArtifactStore } from '../../contracts/pool/peer-pack-custody.js';
export function createCustodyContracts(ports: Readonly<Record<string, unknown>>): { createPeerPackSupplier: typeof createPeerPackSupplier; createPeerPackArtifactStore: typeof createPeerPackArtifactStore };

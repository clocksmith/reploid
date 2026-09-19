import type { HostContractPorts } from '../../contracts/host-ports.js';
export type CustodyPorts = Pick<HostContractPorts, 'hashDopplerEvidence' | 'validateExecutablePack' | 'executablePacksMatch' | 'sha256Hex' | 'signCanonical' | 'verifyCanonicalSignature'>;
import type { createPeerPackSupplier, createPeerPackArtifactStore } from '../../contracts/pool/peer-pack-custody.js';
export function createCustodyContracts(ports: CustodyPorts): { createPeerPackSupplier: typeof createPeerPackSupplier; createPeerPackArtifactStore: typeof createPeerPackArtifactStore };

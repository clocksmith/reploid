import type { HostContractPorts } from '../../contracts/host-ports.js';
export interface PackJobFactoryPorts {
  readonly resolveOperationAcceptance: typeof import('../../contracts/pool/operation-acceptance.js').resolveOperationAcceptance;
  readonly resolveDopplerExecutionContract: typeof import('../../contracts/config/doppler-execution-contracts.js').resolveDopplerExecutionContract;
  readonly normalizeExecutionAdapterSet: typeof import('../../contracts/pool/adapter-execution.js').normalizeExecutionAdapterSet;
  readonly dopplerExecutionAdapterSet: typeof import('../../contracts/pool/adapter-execution.js').dopplerExecutionAdapterSet;
  readonly PACK_JOB_POLICY: typeof import('../../contracts/pool/peer-pack-job-policy.js').PACK_JOB_POLICY;
  readonly resolvePackJobPolicy: typeof import('../../contracts/pool/peer-pack-job-policy.js').resolvePackJobPolicy;
  readonly assertOperationLimits: HostContractPorts['assertOperationLimits'];
  readonly hashJson: HostContractPorts['hashJson'];
  readonly sha256Hex: HostContractPorts['sha256Hex'];
  readonly createSignedPeerMessage: HostContractPorts['createSignedPeerMessage'];
  readonly verifyPeerMessage: HostContractPorts['verifyPeerMessage'];
  readonly PEER_MESSAGE_TYPES: HostContractPorts['PEER_MESSAGE_TYPES'];
  readonly sealPeerAssignmentIdentity: HostContractPorts['sealPeerAssignmentIdentity'];
  readonly validateOperationModel: HostContractPorts['validateOperationModel'];
  readonly createPackOperationRegistry: typeof import('../../contracts/pool/pack-operation-adapters.js').createPackOperationRegistry;
  readonly assertPackOperationRequest: typeof import('../../contracts/pool/pack-operation.js').assertPackOperationRequest;
  readonly snapshot: typeof import('../../contracts/pool/pack-operation.js').snapshotPackOperationData;
  readonly hashDopplerEvidence: HostContractPorts['hashDopplerEvidence'];
  readonly validateProviderCapabilities: typeof import('../../contracts/pool/peer-capabilities.js').validateProviderCapabilities;
  readonly validateWorkRequirements: typeof import('../../contracts/pool/peer-capabilities.js').validateWorkRequirements;
  readonly planOperationProviders: typeof import('../../contracts/pool/peer-planning.js').planOperationProviders;
}
import type * as Contracts from '../../contracts/pool/peer-pack-job.js';
export function createPackJobContracts(ports: PackJobFactoryPorts): typeof Contracts;

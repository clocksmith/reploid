import type { HostContractPorts } from '../../contracts/host-ports.js';
export interface PackEpisodeFactoryPorts {
  readonly assessPeerOperation: typeof import('../../contracts/pool/operation-acceptance.js').assessPeerOperation;
  readonly PEER_MESSAGE_TYPES: HostContractPorts['PEER_MESSAGE_TYPES'];
  readonly hashDopplerEvidence: HostContractPorts['hashDopplerEvidence'];
  readonly snapshot: typeof import('../../contracts/pool/pack-operation.js').snapshotPackOperationData;
  readonly assertPackOperationEvent: typeof import('../../contracts/pool/pack-operation.js').assertPackOperationEvent;
  readonly createPackOperationStream: typeof import('../../contracts/pool/pack-operation.js').createPackOperationStream;
  readonly createPackOperationRegistry: typeof import('../../contracts/pool/pack-operation-adapters.js').createPackOperationRegistry;
  readonly PACK_JOB_POLICY: typeof import('../../contracts/pool/peer-pack-job-policy.js').PACK_JOB_POLICY;
  readonly resolvePackJobPolicy: typeof import('../../contracts/pool/peer-pack-job-policy.js').resolvePackJobPolicy;
  readonly PACK_UPDATE_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_UPDATE_SCHEMA;
  readonly requirePackJob: typeof import('../../contracts/pool/peer-pack-job.js').requirePackJob;
  readonly verifyPackPeerMessage: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerMessage;
  readonly verifyPackPeerJob: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerJob;
  readonly packJobBytes: typeof import('../../contracts/pool/peer-pack-job.js').packJobBytes;
}
import type { PackOperationRegistry, JsonValue } from '../../contracts/pool/pack-operation-adapters.js';
export function createPackEpisodeVerifier(ports: PackEpisodeFactoryPorts): { verifyPackPeerEpisode(input: { job: import('../../contracts/pool/peer-pack-job.js').SignedPackPeerMessage<import('../../contracts/pool/peer-pack-job.js').PackPeerJobBody>; updates: readonly import('../../contracts/pool/peer-pack-job.js').SignedPackPeerMessage[]; acceptance: import('../../contracts/pool/peer-pack-job.js').SignedPackPeerMessage; reference: JsonValue; models: readonly import('../../contracts/pool/peer-pack-job.js').PackPeerModel[]; registry?: PackOperationRegistry; runtimeService?: import('../../contracts/infrastructure/doppler-runtime-service.js').ReploidDopplerRuntimeService }): Promise<VerifiedPackEpisode> };

export interface VerifiedPackEpisode { readonly accepted: true; readonly acceptedAt: string; readonly acceptanceHash: string; readonly execution: Pick<import('../../contracts/pool/pack-operation.js').PackOperationResult, 'request' | 'output' | 'receipt'>; readonly assessment: Readonly<Record<string, JsonValue>> }

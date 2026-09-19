import type { HostContractPorts } from '../../contracts/host-ports.js';
export interface PackRequesterFactoryPorts {
  readonly assessPeerOperation: typeof import('../../contracts/pool/operation-acceptance.js').assessPeerOperation;
  readonly validateOperationReference: typeof import('../../contracts/pool/operation-acceptance.js').validateOperationReference;
  readonly PACK_JOB_POLICY: typeof import('../../contracts/pool/peer-pack-job-policy.js').PACK_JOB_POLICY;
  readonly resolvePackJobPolicy: typeof import('../../contracts/pool/peer-pack-job-policy.js').resolvePackJobPolicy;
  readonly PEER_MESSAGE_TYPES: HostContractPorts['PEER_MESSAGE_TYPES'];
  readonly createPackOperationRegistry: typeof import('../../contracts/pool/pack-operation-adapters.js').createPackOperationRegistry;
  readonly snapshot: typeof import('../../contracts/pool/pack-operation.js').snapshotPackOperationData;
  readonly assertPackOperationEvent: typeof import('../../contracts/pool/pack-operation.js').assertPackOperationEvent;
  readonly createPackOperationStream: typeof import('../../contracts/pool/pack-operation.js').createPackOperationStream;
  readonly hashDopplerEvidence: HostContractPorts['hashDopplerEvidence'];
  readonly DopplerRuntimeService: typeof import('../../contracts/infrastructure/doppler-runtime-service.js').DopplerRuntimeService;
  readonly PACK_UPDATE_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_UPDATE_SCHEMA;
  readonly PACK_CANCEL_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_CANCEL_SCHEMA;
  readonly requirePackJob: typeof import('../../contracts/pool/peer-pack-job.js').requirePackJob;
  readonly packJobBytes: typeof import('../../contracts/pool/peer-pack-job.js').packJobBytes;
  readonly createPackPeerJob: typeof import('../../contracts/pool/peer-pack-job.js').createPackPeerJob;
  readonly verifyPackPeerJob: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerJob;
  readonly verifyPackPeerMessage: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerMessage;
  readonly signPackPeerMessage: typeof import('../../contracts/pool/peer-pack-job.js').signPackPeerMessage;
}
import type { createPackPeerRequester } from '../../contracts/pool/peer-pack-requester.js';
export function createPackRequesterFactory(ports: PackRequesterFactoryPorts): { createPackPeerRequester: typeof createPackPeerRequester };

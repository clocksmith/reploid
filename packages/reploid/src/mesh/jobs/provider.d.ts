import type { HostContractPorts } from '../../contracts/host-ports.js';
export interface PackProviderFactoryPorts {
  readonly DopplerRuntimeService: typeof import('../../contracts/infrastructure/doppler-runtime-service.js').DopplerRuntimeService;
  readonly PEER_MESSAGE_TYPES: HostContractPorts['PEER_MESSAGE_TYPES'];
  readonly createLocalPackExecutor: typeof import('../../contracts/pool/local-pack-executor.js').createLocalPackExecutor;
  readonly createPackOperationRegistry: typeof import('../../contracts/pool/pack-operation-adapters.js').createPackOperationRegistry;
  readonly snapshot: typeof import('../../contracts/pool/pack-operation.js').snapshotPackOperationData;
  readonly assertPackOperationEvent: typeof import('../../contracts/pool/pack-operation.js').assertPackOperationEvent;
  readonly createPackOperationStream: typeof import('../../contracts/pool/pack-operation.js').createPackOperationStream;
  readonly hashDopplerEvidence: HostContractPorts['hashDopplerEvidence'];
  readonly openPackJobJournal: typeof import('../../contracts/infrastructure/pack-job-storage.js').openPackJobJournal;
  readonly PACK_JOB_POLICY: typeof import('../../contracts/pool/peer-pack-job-policy.js').PACK_JOB_POLICY;
  readonly resolvePackJobPolicy: typeof import('../../contracts/pool/peer-pack-job-policy.js').resolvePackJobPolicy;
  readonly PACK_JOB_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_JOB_SCHEMA;
  readonly PACK_UPDATE_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_UPDATE_SCHEMA;
  readonly PACK_CANCEL_SCHEMA: typeof import('../../contracts/pool/peer-pack-job.js').PACK_CANCEL_SCHEMA;
  readonly packJobBytes: typeof import('../../contracts/pool/peer-pack-job.js').packJobBytes;
  readonly requirePackJob: typeof import('../../contracts/pool/peer-pack-job.js').requirePackJob;
  readonly verifyPackPeerJob: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerJob;
  readonly verifyPackPeerMessage: typeof import('../../contracts/pool/peer-pack-job.js').verifyPackPeerMessage;
  readonly signPackPeerMessage: typeof import('../../contracts/pool/peer-pack-job.js').signPackPeerMessage;
  readonly packPeerModel: typeof import('../../contracts/pool/peer-pack-job.js').packPeerModel;
  readonly createPackProviderAdvert: typeof import('../../contracts/pool/peer-pack-job.js').createPackProviderAdvert;
}
import type { createPackPeerProvider } from '../../contracts/pool/peer-pack-provider.js';
export function createPackProviderFactory(ports: PackProviderFactoryPorts): { createPackPeerProvider: typeof createPackPeerProvider };

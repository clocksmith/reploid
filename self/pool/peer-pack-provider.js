import { DopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { createLocalPackExecutor } from './local-pack-executor.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, createPackOperationStream } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { openPackJobJournal } from '../infrastructure/pack-job-storage.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { PACK_JOB_SCHEMA, PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, packJobBytes,
  requirePackJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage, packPeerModel, createPackProviderAdvert } from './peer-pack-job.js';
import { createPackProviderFactory } from '../vendor/reploid/mesh/jobs/provider.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { createPackPeerProvider } = createPackProviderFactory({ DopplerRuntimeService, PEER_MESSAGE_TYPES, createLocalPackExecutor, createPackOperationRegistry, snapshot, assertPackOperationEvent, createPackOperationStream, hashDopplerEvidence, openPackJobJournal, PACK_JOB_POLICY, resolvePackJobPolicy, PACK_JOB_SCHEMA, PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, packJobBytes, requirePackJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage, packPeerModel, createPackProviderAdvert });

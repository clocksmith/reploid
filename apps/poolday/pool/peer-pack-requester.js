import { assessPeerOperation, validateOperationReference } from './operation-acceptance.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from '../../../shared/pool/peer-pack-job-policy.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { createPackOperationRegistry } from '../../../shared/pool/pack-operation-adapters.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, createPackOperationStream } from './pack-operation.js';
import { hashDopplerEvidence } from '../../../shared/pool/executable-pack.js';
import { DopplerRuntimeService } from '../../../shared/infrastructure/doppler-runtime-service.js';
import { PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, requirePackJob, packJobBytes,
  createPackPeerJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage } from './peer-pack-job.js';
import { createPackRequesterFactory } from '../../../shared/vendor/reploid/mesh/jobs/requester.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { createPackPeerRequester } = createPackRequesterFactory({ assessPeerOperation, validateOperationReference, PACK_JOB_POLICY, resolvePackJobPolicy, PEER_MESSAGE_TYPES, createPackOperationRegistry, snapshot, assertPackOperationEvent, createPackOperationStream, hashDopplerEvidence, DopplerRuntimeService, PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, requirePackJob, packJobBytes, createPackPeerJob, verifyPackPeerJob, verifyPackPeerMessage, signPackPeerMessage });

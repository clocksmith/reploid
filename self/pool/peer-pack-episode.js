import { assessPeerOperation } from './operation-acceptance.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, createPackOperationStream } from './pack-operation.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { PACK_UPDATE_SCHEMA, requirePackJob, verifyPackPeerMessage, verifyPackPeerJob, packJobBytes } from './peer-pack-job.js';
import { createPackEpisodeVerifier } from '../vendor/reploid/mesh/jobs/episode.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { verifyPackPeerEpisode } = createPackEpisodeVerifier({ assessPeerOperation, PEER_MESSAGE_TYPES, hashDopplerEvidence, snapshot, assertPackOperationEvent, createPackOperationStream, createPackOperationRegistry, PACK_JOB_POLICY, resolvePackJobPolicy, PACK_UPDATE_SCHEMA, requirePackJob, verifyPackPeerMessage, verifyPackPeerJob, packJobBytes });

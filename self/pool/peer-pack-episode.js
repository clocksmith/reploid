import { assessPeerOperation } from './operation-acceptance.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { hashDopplerEvidence } from '../../shared/pool/executable-pack.js';
import { snapshotPackOperationData as snapshot, assertPackOperationEvent, createPackOperationStream } from './pack-operation.js';
import { createPackOperationRegistry } from '../../shared/pool/pack-operation-adapters.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from '../../shared/pool/peer-pack-job-policy.js';
import { PACK_UPDATE_SCHEMA, requirePackJob, verifyPackPeerMessage, verifyPackPeerJob, packJobBytes } from './peer-pack-job.js';
import { createPackEpisodeVerifier } from '../../shared/vendor/reploid/mesh/jobs/episode.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { verifyPackPeerEpisode } = createPackEpisodeVerifier({ assessPeerOperation, PEER_MESSAGE_TYPES, hashDopplerEvidence, snapshot, assertPackOperationEvent, createPackOperationStream, createPackOperationRegistry, PACK_JOB_POLICY, resolvePackJobPolicy, PACK_UPDATE_SCHEMA, requirePackJob, verifyPackPeerMessage, verifyPackPeerJob, packJobBytes });

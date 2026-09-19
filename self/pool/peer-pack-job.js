import { resolveOperationAcceptance } from './operation-acceptance.js';
import { resolveDopplerExecutionContract } from '../config/doppler-execution-contracts.js';
import { normalizeExecutionAdapterSet, dopplerExecutionAdapterSet } from './adapter-execution.js';
import { PACK_JOB_POLICY, resolvePackJobPolicy } from './peer-pack-job-policy.js';
import { assertOperationLimits } from './pack-operation-policy.js';
import { hashJson, sha256Hex } from './inference-receipt.js';
import { createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { validateOperationModel } from './operation-model.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { assertPackOperationRequest, snapshotPackOperationData as snapshot } from './pack-operation.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { validateProviderCapabilities, validateWorkRequirements } from './peer-capabilities.js';
import { planOperationProviders } from './peer-planning.js';
import { createPackJobContracts } from '../vendor/reploid/mesh/jobs/contracts.js';

// Host-owned policy and operation contracts; behavior lives in the package.
export const { PACK_JOB_SCHEMA, PACK_UPDATE_SCHEMA, PACK_CANCEL_SCHEMA, PACK_JOB_MAX_WIRE_BYTES, requirePackJob, packJobBytes, packPeerModel, validatePackPeerLimits, signPackPeerMessage, verifyPackPeerMessage, createPackProviderAdvert, planPackPeerProviders, createPackPeerJob, verifyPackPeerJob, createPackPeerConnection } = createPackJobContracts({ resolveOperationAcceptance, resolveDopplerExecutionContract, normalizeExecutionAdapterSet, dopplerExecutionAdapterSet, PACK_JOB_POLICY, resolvePackJobPolicy, assertOperationLimits, hashJson, sha256Hex, createSignedPeerMessage, verifyPeerMessage, PEER_MESSAGE_TYPES, sealPeerAssignmentIdentity, validateOperationModel, createPackOperationRegistry, assertPackOperationRequest, snapshot, hashDopplerEvidence, validateProviderCapabilities, validateWorkRequirements, planOperationProviders });

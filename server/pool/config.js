/**
 * @fileoverview Server adapter for the canonical Poolday configuration.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createPoolConfigContract } from '../../self/pool/config-contract.js';
import { hashJson } from './hash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '..', '..', 'self', 'pool', 'pool-config.json');
const poolConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const contract = createPoolConfigContract(poolConfig, { hashJson });


export const {
  POOL_CONFIG,
  POOL_CONFIG_VERSION,
  POOL_CONFIG_HASH,
  POLICY_IDS,
  LAUNCH_MODEL,
  MODEL_CATALOG,
  DETERMINISTIC_GENERATION_CONFIG,
  BROWSER_RUNTIME_CONFIG,
  POLICIES,
  DETERMINISM_PROFILES,
  RING_PHASE_PROTOCOLS,
  PROVIDER_ADMISSION_POLICIES,
  STATE_MODES,
  getPoolConfig,
  getPolicy,
  listPolicies,
  getTrustTier,
  getActiveTransportMode,
  getDeterminismProfile,
  getRingPhaseProtocol,
  getProviderAdmissionPolicy,
  getStateMode,
  getLedgerReasons,
  effectiveTrustTierForRingSize,
  quorumForRingSize,
  validatePoolConfig
} = contract;

export default {
  POOL_CONFIG,
  POOL_CONFIG_VERSION,
  POOL_CONFIG_HASH,
  POLICY_IDS,
  LAUNCH_MODEL,
  MODEL_CATALOG,
  DETERMINISTIC_GENERATION_CONFIG,
  POLICIES,
  DETERMINISM_PROFILES,
  RING_PHASE_PROTOCOLS,
  PROVIDER_ADMISSION_POLICIES,
  STATE_MODES,
  getPoolConfig,
  getPolicy,
  listPolicies,
  getTrustTier,
  getActiveTransportMode,
  getDeterminismProfile,
  getRingPhaseProtocol,
  getProviderAdmissionPolicy,
  getStateMode,
  getLedgerReasons,
  effectiveTrustTierForRingSize,
  quorumForRingSize,
  validatePoolConfig
};

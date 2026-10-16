/**
 * @fileoverview Browser adapter for the canonical Poolday configuration.
 */

import poolConfig from './pool-config.json' with { type: 'json' };
import { createPoolConfigContract } from './config-contract.js';

const contract = createPoolConfigContract(poolConfig);


export const {
  POOL_CONFIG,
  POOL_CONFIG_VERSION,
  POLICY_IDS,
  FASTEST_RECEIPT_POLICY_ID,
  LAUNCH_MODEL,
  MODEL_CATALOG,
  DETERMINISTIC_GENERATION_CONFIG,
  BROWSER_RUNTIME_CONFIG,
  LAUNCH_POLICIES,
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
  POLICY_IDS,
  FASTEST_RECEIPT_POLICY_ID,
  LAUNCH_MODEL,
  MODEL_CATALOG,
  DETERMINISTIC_GENERATION_CONFIG,
  LAUNCH_POLICIES,
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

/**
 * @fileoverview Browser adapter for the canonical Poolday configuration.
 */

import poolConfig from './pool-config.json' with { type: 'json' };
import { createPoolConfigContract } from './config-contract.js';

const contract = createPoolConfigContract(poolConfig);

export const POOL_CONFIG = contract.POOL_CONFIG;
export const POOL_CONFIG_VERSION = contract.POOL_CONFIG_VERSION;
export const POLICY_IDS = contract.POLICY_IDS;
export const FASTEST_RECEIPT_POLICY_ID = contract.FASTEST_RECEIPT_POLICY_ID;
export const LAUNCH_MODEL = contract.LAUNCH_MODEL;
export const MODEL_CATALOG = contract.MODEL_CATALOG;
export const DETERMINISTIC_GENERATION_CONFIG = contract.DETERMINISTIC_GENERATION_CONFIG;
export const BROWSER_RUNTIME_CONFIG = contract.BROWSER_RUNTIME_CONFIG;
export const LAUNCH_POLICIES = contract.LAUNCH_POLICIES;
export const DETERMINISM_PROFILES = contract.DETERMINISM_PROFILES;
export const RING_PHASE_PROTOCOLS = contract.RING_PHASE_PROTOCOLS;
export const PROVIDER_ADMISSION_POLICIES = contract.PROVIDER_ADMISSION_POLICIES;
export const STATE_MODES = contract.STATE_MODES;
export const getPoolConfig = contract.getPoolConfig;
export const getPolicy = contract.getPolicy;
export const listPolicies = contract.listPolicies;
export const getTrustTier = contract.getTrustTier;
export const getActiveTransportMode = contract.getActiveTransportMode;
export const getDeterminismProfile = contract.getDeterminismProfile;
export const getRingPhaseProtocol = contract.getRingPhaseProtocol;
export const getProviderAdmissionPolicy = contract.getProviderAdmissionPolicy;
export const getStateMode = contract.getStateMode;
export const getLedgerReasons = contract.getLedgerReasons;
export const effectiveTrustTierForRingSize = contract.effectiveTrustTierForRingSize;
export const quorumForRingSize = contract.quorumForRingSize;
export const validatePoolConfig = contract.validatePoolConfig;

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

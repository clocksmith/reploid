/**
 * @fileoverview Shared verification for signed Poolday participation and role claims.
 */

import { verifyRoleDelegation } from './device-identity.js';
import {
  participationAllows,
  verifyParticipationProfile
} from './participation-profile.js';

export async function verifyPoolIdentityClaims({
  participationProfile = null,
  identityProof = null,
  role,
  roleId,
  rolePublicKey,
  requiredCapability,
  allowLegacy = true
} = {}) {
  if (!participationProfile && !identityProof) {
    return {
      ok: allowLegacy,
      reasons: allowLegacy ? [] : ['signed participation profile and device role delegation are required'],
      legacy: true
    };
  }
  const reasons = [];
  if (!participationProfile) reasons.push('signed participation profile is required');
  if (!identityProof) reasons.push('device role delegation is required');
  if (participationProfile) {
    const profileVerification = await verifyParticipationProfile(participationProfile);
    reasons.push(...profileVerification.reasons);
    if (requiredCapability && !participationAllows(participationProfile, requiredCapability)) {
      reasons.push(`participation profile does not allow ${requiredCapability}`);
    }
  }
  if (identityProof) {
    const proofVerification = await verifyRoleDelegation(identityProof, {
      role,
      roleId,
      rolePublicKey,
      requiredCapability,
      participationProfileHash: participationProfile?.profileHash || null
    });
    reasons.push(...proofVerification.reasons);
    if (participationProfile && (
      identityProof.deviceId !== participationProfile.deviceId
      || identityProof.devicePublicKey !== participationProfile.devicePublicKey
    )) {
      reasons.push('role delegation and participation profile have different device roots');
    }
    for (const capability of identityProof.capabilities || []) {
      if (participationProfile && !participationAllows(participationProfile, capability)) {
        reasons.push(`role delegation exceeds participation profile: ${capability}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons, legacy: false };
}

export function verifyAdvertisedLimitsAgainstProfile(availability = {}, profile = null) {
  if (!profile) return { ok: true, reasons: [] };
  const reasons = [];
  for (const [availabilityField, profileField] of [
    ['maxConcurrentJobs', 'maxConcurrentJobs'],
    ['maxTokensPerJob', 'maxTokensPerJob'],
    ['storageBudgetMiB', 'storageBudgetMiB'],
    ['bandwidthBudgetMbps', 'bandwidthBudgetMbps']
  ]) {
    const advertised = Number(availability[availabilityField] || 0);
    const allowed = Number(profile.limits?.[profileField] || 0);
    if (advertised > allowed) reasons.push(`${availabilityField} exceeds signed participation profile`);
  }
  return { ok: reasons.length === 0, reasons };
}

export default {
  verifyPoolIdentityClaims,
  verifyAdvertisedLimitsAgainstProfile
};

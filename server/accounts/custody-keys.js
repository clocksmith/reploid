/**
 * @fileoverview Custody-key verification, participant resolution and
 * provenance.
 *
 * Acceptance checks answer "may this identity act now": the device must be
 * registered and active at the moment of the check, and a custody-key
 * certificate must verify against that registration's key, be issued after
 * the registration and cover the signature time. Provenance queries answer
 * "who held this identity at time t", including registrations revoked since,
 * so past receipts keep their attribution.
 */

import { checkCustodyKeyCertificate } from './custody-certificate.js';
import { fail, indexId, isIsoTime, registrationCovers, toMs } from './domain.js';

const provenance = (registration, extra = {}) => ({
  accountId: registration.accountId,
  deviceId: registration.deviceId,
  participantId: registration.participantId,
  registrationId: registration.registrationId,
  registeredAt: registration.registeredAt,
  revokedAt: registration.revokedAt,
  revocation: registration.revocation,
  status: registration.revokedAt ? 'revoked' : 'active',
  ...extra
});

/**
 * @param {object} ctx store internals: backend, policy and clock
 */
export function createCustodyKeyOperations({ backend, policy, clock }) {
  const limits = (atMs) => ({ atMs, maxLifetimeMs: policy.custodyCertificateMaxLifetimeMs, maxClockSkewMs: policy.maxClockSkewMs });

  const deviceForParticipant = async (participantId) => {
    if (typeof participantId !== 'string' || participantId.length > 256) return null;
    const indexed = await backend.get('participants', indexId('participant', participantId));
    return indexed ? backend.get('devices', indexed.deviceId) : null;
  };

  // The time a check covers: `at` when given, else now; never later than now plus skew.
  const coveredTime = (at, now) => {
    if (at === undefined || at === null) return { atMs: toMs(now) };
    if (!isIsoTime(at)) return { problem: 'invalid_time' };
    const atMs = toMs(at);
    return atMs > toMs(now) + policy.maxClockSkewMs ? { problem: 'time_in_future' } : { atMs };
  };

  const certificateProblems = async (certificate, device, registration, atMs) => {
    const problems = await checkCustodyKeyCertificate(certificate, { publicJwk: device.publicJwk, ...limits(atMs) });
    if (!problems.length && toMs(certificate.issuedAt) < toMs(registration.registeredAt) - policy.maxClockSkewMs) {
      problems.push('certificate_precedes_registration');
    }
    return problems;
  };

  return {
    /**
     * The verifier rewards call: certificate, then device, then account. The
     * certificate must be signed by the active registration's participant key
     * after it registered and cover `at` (the signature time; now when
     * omitted). Returns { ok: true, participantId, custodyPeerId, publicKey,
     * accountId, deviceId, ... } or { ok: false, reason, problems }.
     */
    async verifyCustodyKey({ certificate, at } = {}) {
      const refuse = (reason, problems = [reason]) => ({ ok: false, reason, problems });
      const time = coveredTime(at, clock());
      if (time.problem) return refuse(time.problem);
      const device = await deviceForParticipant(certificate?.participantId);
      if (!device) return refuse('device_not_registered');
      if (device.status !== 'active') return refuse('device_revoked');
      const registration = await backend.get('registrations', device.registrationId);
      if (time.atMs < toMs(registration.registeredAt)) return refuse('signature_precedes_registration');
      const problems = await certificateProblems(certificate, device, registration, time.atMs);
      if (problems.length) return refuse(problems[0], problems);
      return {
        ok: true,
        participantId: device.participantId,
        custodyPeerId: certificate.custodyPeerId,
        publicKey: certificate.custodyPublicKey,
        accountId: device.accountId,
        deviceId: device.deviceId,
        registrationId: device.registrationId,
        certificateId: certificate.certificateId,
        certificateExpiresAt: certificate.expiresAt
      };
    },

    /**
     * The active registration acting as `participantId` now. With `at`, it
     * must also have been registered by that work or signature time.
     */
    async resolveParticipant(participantId, { at } = {}) {
      const time = coveredTime(at, clock());
      if (time.problem) return null;
      const device = await deviceForParticipant(participantId);
      if (device?.status !== 'active' || toMs(device.registeredAt) > time.atMs) return null;
      return {
        accountId: device.accountId, deviceId: device.deviceId, participantId,
        registrationId: device.registrationId, registeredAt: device.registeredAt, host: device.host
      };
    },

    /** Provenance: the registration of `participantId` in force at `at`, even if revoked since. */
    async attributeParticipant({ participantId, at } = {}) {
      if (!isIsoTime(at)) fail('invalid_input', 'at must be an ISO time');
      const indexed = typeof participantId === 'string' ? await backend.get('participants', indexId('participant', participantId)) : null;
      if (!indexed) return null;
      const registrations = await backend.list('registrations', { field: 'deviceId', value: indexed.deviceId });
      const registration = registrations.find((entry) => registrationCovers(entry, toMs(at)));
      return registration ? provenance(registration) : null;
    },

    /**
     * Provenance: the account a certified custody key signed for at `at`, even
     * if the registration was revoked since. The certificate must verify
     * against the device key and cover `at`, and a registration issued before
     * the certificate must have been in force at `at`.
     */
    async attributeCustodyKey({ certificate, at } = {}) {
      if (!isIsoTime(at)) fail('invalid_input', 'at must be an ISO time');
      const device = await deviceForParticipant(certificate?.participantId);
      if (!device) return null;
      const atMs = toMs(at);
      const registration = (await backend.list('registrations', { field: 'deviceId', value: device.deviceId }))
        .find((entry) => registrationCovers(entry, atMs));
      if (!registration || (await certificateProblems(certificate, device, registration, atMs)).length) return null;
      return provenance(registration, {
        certificateId: certificate.certificateId, custodyPeerId: certificate.custodyPeerId, publicKey: certificate.custodyPublicKey
      });
    }
  };
}

export default createCustodyKeyOperations;

/**
 * @fileoverview Placeholder for post-launch canary audit scheduling.
 */

export function createAuditScheduler() {
  return {
    enabled: false,
    reason: 'canary_audited is post-launch; fastest_receipt ships first'
  };
}

export default {
  createAuditScheduler
};

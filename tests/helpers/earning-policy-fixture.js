// A reploid.earning-policy/v1 file for tests. Every value is test-only; none is a
// product price, reward rate, budget, deadline or limit.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EARNING_POLICY_SCHEMA } from '../../server/earning-composition/policy.js';
import { ACCOUNT_POLICY } from './account-fixture.js';
import { ISSUANCE_POLICY, LEDGER_POLICY, MIN, MODEL, REWARD_POLICY } from './reward-fixture.js';

export const ROUTE_LIMITS = Object.freeze({
  jsonBytes: 16 * 1024, evidenceJsonBytes: 256 * 1024, idempotencyLeaseMs: 30_000,
  address: { max: 10_000, windowMs: MIN }, signIn: { max: 100, windowMs: MIN }, account: { max: 1000, windowMs: MIN },
  device: { max: 1000, windowMs: MIN }, operator: { max: 1000, windowMs: MIN }
});
export const QUOTE_REQUEST = Object.freeze({ modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, operation: 'chat.completion' });
export const OFFER_MODEL = Object.freeze({ ...MODEL });

export const earningPolicy = (overrides = {}) => ({
  schema: EARNING_POLICY_SCHEMA,
  policyVersion: 'test-earning-policy/1',
  accounts: { ...ACCOUNT_POLICY },
  ledger: structuredClone(LEDGER_POLICY),
  reversals: { refund: { spentCredit: 'account_deficit' }, chargeback: { spentCredit: 'account_deficit' } },
  // Readiness and storage contracts need probes and obligations this composition does not supply.
  rewards: { ...structuredClone(REWARD_POLICY), enabledCategories: ['demanded_inference', 'verified_delivery'] },
  issuance: structuredClone(ISSUANCE_POLICY),
  routes: structuredClone(ROUTE_LIMITS),
  conversions: {
    authority: { actorId: 'pricing_admin_test', decisionId: 'decision:test-conversion' },
    records: [{ conversionId: 'conv_test_usd_unit', policyVersion: 'test-pricing/1', currency: 'USD', rate: { credits: 1, perMinorUnits: 1 }, rounding: 'floor', effectiveFrom: 'on_publication' }]
  },
  payments: {
    policyVersion: 'test-payments/1',
    topUps: [{ topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } }],
    polling: { minAgeMs: MIN, reversalWatchMs: 30 * 24 * 60 * MIN }
  },
  funding: { authorities: ['funding_admin_test'] },
  services: [{
    request: { ...QUOTE_REQUEST },
    service: {
      serviceRecordId: 'svc_chat_test',
      model: { modelId: MODEL.modelId, checkpoint: 'sha256:checkpoint', deployedRepresentation: 'q4k-test', tokenizer: 'tok_test', adapters: [] },
      runtime: { runtimeId: 'doppler@test' },
      operation: 'chat.completion',
      limits: { context: { max: 4096, unit: 'token', exceedance: 'reject' }, output: { max: 100, unit: 'token', exceedance: 'stop_and_report' } },
      qualityPolicyVersion: 'quality-policy-test/1',
      recipientScope: { policyId: 'remote-permission-test' },
      disclosureScope: { scopeId: 'thread-disclosure-test' },
      queueClass: 'standard'
    },
    deadlines: { completeMs: 3 * MIN },
    pricing: { basis: { kind: 'test_per_output_token' }, maxCharge: 60 },
    terms: {
      validForMs: MIN,
      reservationPeriodMs: 10 * MIN,
      queue: { behavior: 'fifo_bounded', maxWaitMs: 30_000 },
      execution: { maxAttempts: 2, maxDurationMs: 120_000 },
      refund: { policyId: 'refund-terms-test' },
      qualityReview: { procedureId: 'quality-review-test' },
      settlement: {
        full: { kind: 'metered', base: 10, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
        reduced: null,
        partialDelivery: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
        cancellationQueued: { kind: 'fixed', amount: 0 },
        cancellationDispatched: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 1, denominator: 2 }] },
        timeout: { kind: 'fixed', amount: 0 },
        providerFailure: { kind: 'fixed', amount: 0 },
        failedQuality: { kind: 'fixed', amount: 0 }
      }
    }
  }],
  offers: [{
    category: 'demanded_inference',
    model: { ...OFFER_MODEL },
    hosts: ['native'],
    reward: { basis: { kind: 'test_share_of_settled_charge' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'settledCharge', numerator: 1, denominator: 3 }] }, maxReward: 50 },
    resourceBounds: { context: { max: 4096, unit: 'token' }, output: { max: 100, unit: 'token' } },
    durationMs: 60 * MIN,
    validForMs: 5 * MIN,
    paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
    failureCompensation: { kind: 'none' }
  }],
  ...overrides
});

/** Write `policy` to a fresh directory outside the repository; returns the file path. */
export async function writeOutsideRepository(name, value) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-earning-'));
  const file = path.join(directory, name);
  await fs.writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return file;
}

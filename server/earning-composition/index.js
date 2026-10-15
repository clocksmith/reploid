/**
 * @fileoverview The in-repository earning composition an operator selects with
 * REPLOID_EARNING_COMPOSITION=server/earning-composition/index.js. It builds
 * every store and provider the earning routes mount (server/earning-routes)
 * from the environment and the operator's policy file; it holds no price,
 * rate, budget, deadline, limit or credential itself.
 *
 * Environment:
 *   REPLOID_EARNING_POLICY_FILE        required: absolute path, outside the repository, of the
 *                                      reploid.earning-policy/v1 file (policy.js)
 *   REPLOID_EARNING_STORE              required: firestore, or memory outside production
 *   REPLOID_EARNING_FIRESTORE_PREFIX   required with firestore: collection prefix (Firestore from
 *                                      firebase-admin's application default, or FIRESTORE_EMULATOR_HOST
 *                                      for a local emulator)
 *   REPLOID_EARNING_TEST_SIGN_IN       `enabled` outside production: the local test sign-in flow
 *   REPLOID_EARNING_TEST_PROCESSOR     `enabled` outside production: the test payment processor and its
 *                                      checkout page (no money moves)
 *   REPLOID_EARNING_OPERATORS_FILE     optional: absolute path, outside the repository, of
 *                                      { schema: reploid.earning-operators/v1, operators: [{ actorId, roles, tokenSha256 }] }
 *   REPLOID_EARNING_CAPACITY_FILE      optional: absolute path of the admitted-capacity evidence the
 *                                      issuance limits read (reploid.admitted-capacity-evidence/v1); without
 *                                      it reward issuance declines as capacity_evidence_unavailable
 *   REPLOID_EARNING_COMMUNITY_CAPACITY_FILE  optional, with policy.communityAccess: its capacity evidence
 *   Supabase and Stripe variables      see ../providers/env.js; each provider is composed only when set
 *
 * Production (NODE_ENV=production or K_SERVICE) refuses memory stores, the
 * test sign-in flow and the test processor here, and mount.js refuses them
 * again together with any composition lacking a real sign-in provider.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACCOUNT_LEDGER_COLLECTIONS, composeAccountServices } from '../accounts/compose.js';
import { createFirestoreAccountBackend, createMemoryAccountBackend } from '../accounts/stores.js';
import { createTestSignInFlow, createTestSignInProvider } from '../accounts/test-sign-in.js';
import { poolAccountIds } from '../community-access/domain.js';
import { createCommunityAccess, createFundingIssuanceAuthority } from '../community-access/engine.js';
import { createFirestoreCommunityAccessBackend, createMemoryCommunityAccessBackend } from '../community-access/stores.js';
import { EARNING_ROUTES_PREFIX } from '../earning-routes/mount.js';
import { createFirestoreRouteBackend, createMemoryRouteBackend } from '../earning-routes/idempotency.js';
import { buildQuote, hashCanonical } from '../ledger/domain.js';
import { createLedgerStore } from '../ledger/engine.js';
import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend, createMemoryLedgerState } from '../ledger/memory-store.js';
import { createPaymentStore, createPurchaseIssuanceAuthority } from '../payments/engine.js';
import { createFirestorePaymentBackend, createMemoryPaymentBackend } from '../payments/stores.js';
import { createTestPaymentProcessor } from '../payments/test-processor.js';
import { createStripeProcessorFromEnv, createSupabaseSignInFromEnv } from '../providers/env.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend } from '../rewards/stores.js';
import { EarningPolicyError, isInside, readEarningPolicyFile, readOperatorJsonFile } from './policy.js';
import { createOfferTerms, createQuoteTerms } from './terms.js';

export const OPERATORS_SCHEMA = 'reploid.earning-operators/v1';
export const TEST_SIGN_IN_PROVIDER_ID = 'local-test';
export const TEST_PROCESSOR_ID = 'test-processor';
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORES = Object.freeze(['firestore', 'memory']);
const OPERATOR_ROLES = Object.freeze(['funding', 'settlement', 'issuance', 'links', 'audit']);
// The test processor's own signature tolerance and checkout lifetime; test-only, never a product setting.
const TEST_PROCESSOR_TIMING = Object.freeze({ signatureToleranceMs: 5 * 60_000, checkoutTtlMs: 30 * 60_000 });

const refuse = (code, message) => {
  throw new EarningPolicyError(code, message);
};
const read = (env, name) => (typeof env[name] === 'string' && env[name].trim() ? env[name].trim() : null);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const switchOn = (env, name, production) => {
  const value = read(env, name);
  if (value === null || value === 'disabled') return false;
  if (value !== 'enabled') refuse('setting_invalid', `${name} must be "enabled" or "disabled"`);
  if (production) refuse('test_provider_in_production', `${name} is for local runs only and is refused in production`);
  return true;
};

/** Operator credentials by SHA-256 of the bearer token; the file holds no token. */
export function createOperatorAuthority(file) {
  const errors = [];
  if (file?.schema !== OPERATORS_SCHEMA || !Array.isArray(file.operators)) errors.push(`the operators file must be ${OPERATORS_SCHEMA} with an operators list`);
  const operators = (file?.operators ?? []).map((entry, index) => {
    if (typeof entry?.actorId !== 'string' || !entry.actorId || !/^[a-f0-9]{64}$/.test(entry?.tokenSha256 ?? '')
      || !Array.isArray(entry.roles) || entry.roles.some((role) => !OPERATOR_ROLES.includes(role))) {
      errors.push(`operators[${index}] needs actorId, roles from ${OPERATOR_ROLES.join(', ')} and tokenSha256`);
    }
    return { actorId: entry?.actorId, roles: [...(entry?.roles ?? [])], digest: Buffer.from(entry?.tokenSha256 ?? '', 'hex') };
  });
  if (errors.length) throw new EarningPolicyError('operators_invalid', `the operators file is invalid: ${errors.join('; ')}`);
  return Object.freeze({
    async authenticate({ token } = {}) {
      if (typeof token !== 'string' || !token) return null;
      const digest = Buffer.from(sha256(token), 'hex');
      const match = operators.find((entry) => entry.digest.length === digest.length && timingSafeEqual(entry.digest, digest));
      return match ? { actorId: match.actorId, roles: [...match.roles] } : null;
    }
  });
}

/** Evidence re-read on every call, so an operator job can refresh it; unreadable evidence is none. */
const evidenceFile = (file) => (file ? async () => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
} : async () => null);

async function openFirestore() {
  const appModule = await import('firebase-admin/app');
  const firestoreModule = await import('firebase-admin/firestore');
  if (appModule.getApps().length === 0) appModule.initializeApp();
  return firestoreModule.getFirestore();
}

/** One database for every store: accounts, ledger, payments, bindings and Community Access share it, so their reads join transactions. */
function openStores({ kind, firestore, prefix }) {
  if (kind === 'memory') {
    const state = createMemoryLedgerState();
    return {
      account: () => createMemoryAccountBackend({ state }),
      ledger: () => createMemoryLedgerBackend({ state, collections: ACCOUNT_LEDGER_COLLECTIONS }),
      reward: () => createMemoryRewardBackend({ state }),
      payment: () => createMemoryPaymentBackend({ state }),
      binding: () => createMemoryRouteBackend({ state }),
      community: () => createMemoryCommunityAccessBackend({ state })
    };
  }
  const options = { firestore, collectionPrefix: prefix };
  return {
    account: () => createFirestoreAccountBackend(options),
    ledger: () => createFirestoreLedgerBackend({ ...options, collections: ACCOUNT_LEDGER_COLLECTIONS }),
    reward: () => createFirestoreRewardBackend(options),
    payment: () => createFirestorePaymentBackend(options),
    binding: () => createFirestoreRouteBackend(options),
    community: () => createFirestoreCommunityAccessBackend(options)
  };
}

/** The test processor with a checkout page on this service, so a top-up completes the way a hosted checkout would. */
function testCheckoutProcessor({ clock }) {
  const processor = createTestPaymentProcessor({ id: TEST_PROCESSOR_ID, clock, ...TEST_PROCESSOR_TIMING });
  return {
    processor: {
      ...processor,
      async createCheckout(input) {
        const created = await processor.createCheckout(input);
        return { ...created, checkout: { ...created.checkout, kind: 'test_checkout', url: `${EARNING_ROUTES_PREFIX}/payments/test-checkouts/${input.checkoutId}` } };
      }
    },
    bind(payments) {
      const describe = async (checkoutId) => {
        const payment = await payments.getPayment(checkoutId);
        return payment ? { ...payment, issued: Boolean(payment.issuance) } : null;
      };
      return {
        describe,
        /** Pay an open checkout at its price and deliver the processor's signed notification. */
        async complete(checkoutId) {
          const payment = await payments.getPayment(checkoutId);
          if (!payment) return null;
          if (payment.phase === 'open') await payments.receiveNotification(processor.pay(payment.purchaseId));
          return describe(checkoutId);
        }
      };
    }
  };
}

const PUBLICATION_LEAD_MS = 250;

/** Publish the policy's conversion records once; a published id with other terms refuses to start. */
async function publishConversions({ ledger, conversions, clock }) {
  for (const record of conversions.records) {
    const existing = await ledger.getConversion(record.conversionId);
    const onPublication = record.effectiveFrom === 'on_publication';
    if (existing) {
      const same = ['policyVersion', 'currency', 'rounding'].every((field) => existing[field] === record[field])
        && existing.rate?.credits === record.rate?.credits && existing.rate?.perMinorUnits === record.rate?.perMinorUnits
        && (onPublication || existing.effectiveFrom === record.effectiveFrom);
      if (!same) refuse('conversion_conflict', `conversion ${record.conversionId} is already published with other terms; publish a new conversion id`);
      continue;
    }
    const publish = (effectiveFrom) => ledger.publishConversion({ ...record, effectiveFrom, authority: { ...conversions.authority },
      idempotencyKey: `policy:${record.conversionId}` });
    if (!onPublication) {
      await publish(record.effectiveFrom);
      continue;
    }
    // `on_publication` takes effect at publication. A clock that moved on before the ledger stamped it gets a
    // short lead instead (never before publication), and startup waits it out.
    try {
      await publish(clock());
    } catch (error) {
      if (error?.code !== 'invalid_conversion') throw error;
      const effectiveFrom = new Date(Date.parse(clock()) + PUBLICATION_LEAD_MS).toISOString();
      await publish(effectiveFrom);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(effectiveFrom) - Date.parse(clock()))));
    }
  }
}

/**
 * @param {object} options
 * @param {object} options.env environment
 * @param {boolean} options.production production mode, from mount.js
 * @param {object} [options.ports] injected { firestore, fetch, clock, repositoryRoot } for tests and local runs
 */
export async function createEarningComposition({ env = process.env, production = false, ports = {} } = {}) {
  const repositoryRoot = ports.repositoryRoot ?? REPOSITORY_ROOT;
  const clock = ports.clock ?? (() => new Date().toISOString());
  const kind = read(env, 'REPLOID_EARNING_STORE');
  if (!STORES.includes(kind)) refuse('store_required', `REPLOID_EARNING_STORE must be ${STORES.join(' or ')}`);
  if (production && kind === 'memory') refuse('memory_store_in_production', 'production earning routes need the firestore store');
  const prefix = read(env, 'REPLOID_EARNING_FIRESTORE_PREFIX');
  if (kind === 'firestore' && !prefix) refuse('firestore_prefix_required', 'REPLOID_EARNING_FIRESTORE_PREFIX is required with the firestore store');
  const testSignIn = switchOn(env, 'REPLOID_EARNING_TEST_SIGN_IN', production);
  const testProcessor = switchOn(env, 'REPLOID_EARNING_TEST_PROCESSOR', production);
  for (const name of ['REPLOID_EARNING_CAPACITY_FILE', 'REPLOID_EARNING_COMMUNITY_CAPACITY_FILE']) {
    const file = read(env, name);
    if (file && (!path.isAbsolute(file) || isInside(repositoryRoot, file))) refuse('file_path_invalid', `${name} must be an absolute path outside the repository`);
  }
  const policy = await readEarningPolicyFile(read(env, 'REPLOID_EARNING_POLICY_FILE'), { repositoryRoot });
  const operatorsFile = read(env, 'REPLOID_EARNING_OPERATORS_FILE');
  const operatorAuthority = operatorsFile
    ? createOperatorAuthority(await readOperatorJsonFile(operatorsFile, { variable: 'REPLOID_EARNING_OPERATORS_FILE', repositoryRoot }))
    : null;

  // Providers: each real provider only when its environment is set; the test ones only when switched on.
  const supabase = createSupabaseSignInFromEnv(env, { accountPolicy: policy.accounts, clock, ...(ports.fetch ? { fetch: ports.fetch } : {}) });
  const testProvider = testSignIn ? createTestSignInProvider({ providerId: TEST_SIGN_IN_PROVIDER_ID, audience: policy.accounts.audience, clock }) : null;
  const providers = [supabase, testProvider].filter(Boolean);
  if (!providers.length) refuse('sign_in_provider_required', 'configure Supabase sign-in, or REPLOID_EARNING_TEST_SIGN_IN=enabled for a local run');
  const signInFlows = [supabase, testProvider && createTestSignInFlow(testProvider)].filter(Boolean);
  const stripe = createStripeProcessorFromEnv(env, { clock, ...(ports.fetch ? { fetch: ports.fetch } : {}) });
  if (stripe && testProcessor) refuse('processor_ambiguous', 'configure either Stripe or the test processor, not both');
  const local = testProcessor ? testCheckoutProcessor({ clock }) : null;
  const processor = stripe ?? local?.processor ?? null;
  if (processor && !policy.payments) refuse('payment_policy_required', 'a payment processor is configured but the policy has no payments section');

  const firestore = kind === 'firestore' ? (ports.firestore ?? await openFirestore()) : null;
  const stores = openStores({ kind, firestore, prefix });
  const paymentBackend = processor ? stores.payment() : null;
  const communityBackend = policy.communityAccess ? stores.community() : null;
  const purchases = paymentBackend ? createPurchaseIssuanceAuthority({ backend: paymentBackend }) : null;
  const communityFunding = communityBackend ? createFundingIssuanceAuthority({ backend: communityBackend, policy: policy.communityAccess }) : null;
  // Purchased and Community Access lots are decided by their owners; nothing else is issued outside rewards.
  const otherProvenance = async (request) => {
    if (request?.provenance === 'purchased' && purchases) return purchases(request);
    if (request?.provenance === 'community_access' && communityFunding) return communityFunding(request);
    return { allowed: false, reason: 'provenance_not_governed' };
  };
  const fundingAuthority = async ({ authority } = {}) => (policy.funding.authorities.includes(authority?.actorId)
    ? { allowed: true } : { allowed: false, reason: 'not_a_funding_authority' });
  const conversionAuthority = async ({ authority } = {}) => (authority?.actorId === policy.conversions.authority.actorId
    ? { allowed: true } : { allowed: false, reason: 'not_a_conversion_authority' });

  const services = composeAccountServices({
    accountBackend: stores.account(), accountPolicy: policy.accounts, providers, rewardBackend: stores.reward(),
    createLedger: (ledgerPorts) => createLedgerStore({
      backend: stores.ledger(), policy: policy.ledger, clock, conversionAuthority, fundingAuthority, reversalPolicy: policy.reversals ?? null, ...ledgerPorts
    }),
    rewardPolicy: policy.rewards, issuancePolicy: policy.issuance,
    readAdmittedCapacity: evidenceFile(read(env, 'REPLOID_EARNING_CAPACITY_FILE')),
    otherProvenance, fundingAuthority, clock,
    // Community Access pools accept quotes for the requester devices they admit.
    communityPoolAccountIds: policy.communityAccess ? poolAccountIds(policy.communityAccess) : []
  });
  await publishConversions({ ledger: services.ledger, conversions: policy.conversions, clock });
  // Every quote template must build a quote the ledger accepts (formulas within maxCharge, deadlines, evidence terms
  // and their unacknowledged-output bound), so a misconfigured policy refuses to start rather than refuse each quote.
  const quoteTerms = createQuoteTerms({ services: policy.services, clock });
  for (const template of policy.services) {
    const offered = await quoteTerms({ request: template.request });
    try {
      buildQuote({ quoteId: 'policy_check', accountId: 'policy_check', ...offered }, { policy: services.ledger.policy, now: clock() });
    } catch (error) {
      refuse('quote_template_invalid', `the quote template for ${template.request.modelId} is invalid: ${[error.message, ...(error.details?.errors ?? [])].join('; ')}`);
    }
    // Community Access stamps its own evidence terms and refuses others, so the templates it uses must carry the same.
    if (policy.communityAccess && template.terms.evidence !== undefined
      && hashCanonical(template.terms.evidence) !== hashCanonical(policy.communityAccess.evidence)) {
      refuse('evidence_terms_mismatch', `the quote template for ${template.request.modelId} names evidence terms other than policy.communityAccess.evidence`);
    }
  }

  const payments = processor ? createPaymentStore({
    backend: paymentBackend, ledger: services.ledger, processor, clock,
    accounts: { participantAccount: services.identity.participantAccount },
    policy: { ...structuredClone(policy.payments), processorId: processor.id }
  }) : null;
  const communityAccess = communityBackend ? createCommunityAccess({
    backend: communityBackend, ledger: services.ledger, accounts: { participantAccount: services.identity.participantAccount },
    readCommunityCapacity: evidenceFile(read(env, 'REPLOID_EARNING_COMMUNITY_CAPACITY_FILE')), policy: policy.communityAccess, fundingAuthority, clock
  }) : null;

  return {
    ...services,
    signInFlows,
    payments,
    testCheckout: local && payments ? local.bind(payments) : null,
    communityAccess,
    quoteTerms,
    offerTerms: policy.offers.length ? createOfferTerms({ offers: policy.offers, clock }) : null,
    operatorAuthority,
    idempotencyBackend: stores.binding(),
    limits: policy.routes,
    policyVersion: policy.policyVersion,
    ...(ports.clock ? { nowMs: () => Date.parse(clock()) } : {})
  };
}

export default createEarningComposition;

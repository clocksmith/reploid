// Shared account test fixture. Test-only provider, policy and keys; no product
// decisions and no secrets: the provider's HMAC key is generated per instance
// and never stored.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createSigningKeyPair, exportPublicKey } from '../../packages/reploid/src/artifacts/signatures.js';
import { ACCOUNT_LEDGER_COLLECTIONS, composeAccountServices } from '../../server/accounts/compose.js';
import { createDeviceRegistrationProof } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createFirestoreAccountBackend, createMemoryAccountBackend, createMemoryAccountState } from '../../server/accounts/stores.js';
import { canonicalJson } from '../../server/ledger/domain.js';
import { createLedgerStore } from '../../server/ledger/engine.js';
import { createFirestoreLedgerBackend } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerBackend } from '../../server/ledger/memory-store.js';
import { createFirestoreRewardBackend, createMemoryRewardBackend, createMemoryRewardState } from '../../server/rewards/stores.js';
import { createFakeFirestore } from './fake-firestore.js';
import {
  ISSUANCE_POLICY, LEDGER_POLICY, MIN, REWARD_POLICY, START, clock, fx, otherProvenance, random, readAdmittedCapacity, readinessProber
} from './reward-fixture.js';

export const ACCOUNT_POLICY = Object.freeze({
  audience: 'reploid-accounts-test',
  sessionTtlMs: 60 * MIN,
  challengeTtlMs: 5 * MIN,
  recoveryMaxAuthAgeMs: 5 * MIN,
  maxClockSkewMs: 30_000,
  custodyCertificateMaxLifetimeMs: 2 * 60 * MIN
});

/**
 * Test sign-in provider: `<claims>.<hmac>` assertions. It checks its own MAC,
 * issuer and audience; the provider registry enforces expiry.
 */
export function createTestSignInProvider({ providerId = 'test-provider' } = {}) {
  const key = randomBytes(32);
  const mac = (encoded) => createHmac('sha256', key).update(encoded).digest('base64url');
  return {
    providerId,
    issue({ subject, audience = ACCOUNT_POLICY.audience, authenticatedAt = clock(), expiresInMs = 5 * MIN, assertionId = randomUUID() } = {}) {
      const claims = {
        iss: providerId, sub: subject, aud: audience, jti: assertionId, auth_time: authenticatedAt,
        exp: new Date(fx.nowMs + expiresInMs).toISOString()
      };
      const encoded = Buffer.from(canonicalJson(claims)).toString('base64url');
      return `${encoded}.${mac(encoded)}`;
    },
    async verifyAssertion(assertion, { audience }) {
      const [encoded, signature, extra] = String(assertion).split('.');
      if (!encoded || !signature || extra !== undefined) throw new Error('malformed assertion');
      const expected = Buffer.from(mac(encoded));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('assertion signature mismatch');
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (claims.iss !== providerId) throw new Error('wrong issuer');
      if (claims.aud !== audience) throw new Error('wrong audience');
      return { subject: claims.sub, assertionId: claims.jti, authenticatedAt: claims.auth_time, expiresAt: claims.exp };
    }
  };
}

const baseComposition = (provider) => ({
  accountPolicy: ACCOUNT_POLICY, providers: [provider], rewardPolicy: REWARD_POLICY, issuancePolicy: ISSUANCE_POLICY,
  readAdmittedCapacity, otherProvenance, readinessProber, clock, random
});

// Each harness owns durable state; open() models a (re)started process. Accounts and the
// ledger share one database so quote acceptance reads device state in its own transaction.
export const accountHarnesses = {
  memory: () => {
    const provider = createTestSignInProvider();
    const states = { identity: createMemoryAccountState(), rewards: createMemoryRewardState() };
    const ledgerBackend = () => createMemoryLedgerBackend({ state: states.identity, collections: ACCOUNT_LEDGER_COLLECTIONS });
    return {
      provider,
      states,
      ledgerBackend,
      open: (overrides = {}) => composeAccountServices({
        ...baseComposition(provider),
        accountBackend: createMemoryAccountBackend({ state: states.identity }),
        rewardBackend: createMemoryRewardBackend({ state: states.rewards }),
        createLedger: (ports) => createLedgerStore({ backend: ledgerBackend(), policy: LEDGER_POLICY, clock, ...ports }),
        ...overrides
      })
    };
  },
  firestore: () => {
    const provider = createTestSignInProvider();
    const dbs = { identity: createFakeFirestore(), rewards: createFakeFirestore() };
    const ledgerBackend = () => createFirestoreLedgerBackend({ firestore: dbs.identity, collectionPrefix: 'test', collections: ACCOUNT_LEDGER_COLLECTIONS });
    return {
      provider,
      dbs,
      ledgerBackend,
      open: (overrides = {}) => composeAccountServices({
        ...baseComposition(provider),
        accountBackend: createFirestoreAccountBackend({ firestore: dbs.identity, collectionPrefix: 'test' }),
        rewardBackend: createFirestoreRewardBackend({ firestore: dbs.rewards, collectionPrefix: 'test' }),
        createLedger: (ports) => createLedgerStore({ backend: ledgerBackend(), policy: LEDGER_POLICY, clock, ...ports }),
        ...overrides
      })
    };
  }
};

/** Reset the shared clock and capacity evidence, then open a harness of `kind`. */
export function openAccountFixture(kind) {
  Object.assign(fx, { nowMs: START, keySeq: 0, participants: new Map(), certificates: new Map(), links: [], randoms: [] });
  fx.prober = { connect: async () => { throw new Error('no prober installed'); } };
  fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
  const harness = accountHarnesses[kind]();
  return { harness, provider: harness.provider, ...harness.open() };
}

export const signInAs = (accounts, provider, subject, options = {}) => accounts.signIn({
  providerId: provider.providerId, assertion: provider.issue({ subject, ...options })
});

/** A persistent participant identity, as browser (Ed25519, ECDSA fallback) and native hosts keep. */
export const newIdentity = (algorithm = 'Ed25519') => createSigningIdentity({ algorithm });

/** A per-process custody key, as native-model-files.js creates. */
export async function newCustodyKey() {
  const pair = await createSigningKeyPair();
  return { publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey };
}

/** Challenge, device-signed proof and registration through `session`. */
export async function registerDevice(accounts, session, identity, { host = 'browser', bindSession = false, idempotencyKey = `register:${randomUUID()}` } = {}) {
  const challenge = await accounts.createRegistrationChallenge({ sessionToken: session.token });
  const proof = await createDeviceRegistrationProof({ identity, challenge, host });
  const registration = await accounts.registerDevice({ sessionToken: session.token, proof, bindSession, idempotencyKey });
  return { challenge, proof, registration };
}

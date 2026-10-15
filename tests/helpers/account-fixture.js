// Shared account test fixture. Test-only provider, policy and keys; no product
// decisions and no secrets: the provider's HMAC key is generated per instance
// and never stored.
import { randomUUID } from 'node:crypto';

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createSigningKeyPair, exportPublicKey } from '../../packages/reploid/src/artifacts/signatures.js';
import { ACCOUNT_LEDGER_COLLECTIONS, composeAccountServices } from '../../server/accounts/compose.js';
import { createDeviceRegistrationProof, createSessionBinding } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { createFirestoreAccountBackend, createMemoryAccountBackend, createMemoryAccountState } from '../../server/accounts/stores.js';
import { createTestSignInProvider as createProvider } from '../../server/accounts/test-sign-in.js';
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

/** The local-run sign-in provider (server/accounts/test-sign-in.js) on the fixture clock and audience. */
export const createTestSignInProvider = ({ providerId = 'test-provider' } = {}) => createProvider({ providerId, audience: ACCOUNT_POLICY.audience, clock });

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

/** Challenge, device-signed proof (and session binding when binding) and registration through `session`. */
export async function registerDevice(accounts, session, identity, { host = 'browser', bindSession = false, idempotencyKey = `register:${randomUUID()}` } = {}) {
  const challenge = await accounts.createRegistrationChallenge({ sessionToken: session.token });
  const proof = await createDeviceRegistrationProof({ identity, challenge, host });
  const sessionBinding = bindSession ? await createSessionBinding({ identity, challenge }) : null;
  const registration = await accounts.registerDevice({
    sessionToken: session.token, proof, bindSession, ...(sessionBinding ? { sessionBinding } : {}), idempotencyKey
  });
  return { challenge, proof, sessionBinding, registration };
}

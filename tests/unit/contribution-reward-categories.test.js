import { beforeEach, describe, expect, it } from 'vitest';

import { createCustodyContracts } from '../../packages/reploid/src/artifacts/custody/runtime.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex, signCanonical, verifyCanonicalSignature } from '../../packages/reploid/src/artifacts/signatures.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { executablePacksMatch, hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { CHALLENGE_ANSWER_SCHEMA, DELIVERY_ATTESTATION_SCHEMA, deliveryAttestationBody } from '../../server/rewards/custody-evidence.js';
import { validateIssuancePolicy } from '../../server/rewards/domain.js';
import {
  ISSUANCE_POLICY, MIN, MODEL, at, clock, codes, commit, declinedWith, demand, fx, journalShape, openFixture, ownerAuthorization, rejectsWith, throwsWith
} from '../helpers/reward-fixture.js';

// Real REP-5 custody contracts produce the grants, signed requests/responses and receipts used as evidence.
const custody = createCustodyContracts({ hashDopplerEvidence, validateExecutablePack, executablePacksMatch, sha256Hex, signCanonical, verifyCanonicalSignature });
const CHUNK = 64;
const toMs = (iso) => Date.parse(iso);

const pieceBytes = (seed, size = 3 * CHUNK) => Uint8Array.from({ length: size }, (_, index) => (seed * 31 + index * 7) % 251);
const library = new Map();
async function commitPiece(artifactId, seed) {
  const bytes = pieceBytes(seed);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, offset + CHUNK);
    chunks.push({ index: chunks.length, offset, sizeBytes: chunk.byteLength, hash: await sha256Hex(chunk) });
  }
  const piece = { artifactId, hash: await sha256Hex(bytes), sizeBytes: bytes.byteLength, chunks };
  library.set(piece.hash, bytes);
  return piece;
}

/**
 * A per-process custody signing key and the per-process peer id grants name. When certified,
 * the fixture's identity port attributes both to the participant's persistent identity.
 */
async function custodyKey(participantId, { certified = true } = {}) {
  const pair = await createSigningKeyPair();
  const publicKey = await exportPublicKey(pair.publicKey);
  const sequence = (fx.keySeq += 1);
  const custodyPeerId = `custody_${participantId}_${sequence}`;
  const certificateId = `cert_${sequence}`;
  if (certified) fx.certificates.set(certificateId, { participantId, custodyPeerId, publicKey });
  return { participantId, custodyPeerId, publicKey, privateKey: pair.privateKey, certificate: { certificateId } };
}

const attest = async (receipt, key, attestedAt = clock()) => {
  const body = await deliveryAttestationBody({ receipt, attestedAt });
  return { ...body, signature: await signCanonical(body, key.privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) };
};

/** Run one real custody transfer and return the acquirer's attested evidence with both key certificates. */
async function deliver({ supplier, acquirer, piece, cachedChunks = [], corruptChunk = null }) {
  const bytes = library.get(piece.hash);
  const artifact = { artifactId: piece.artifactId, path: piece.artifactId, role: 'weights', sizeBytes: piece.sizeBytes, hash: piece.hash };
  const artifactSet = { schema: 'reploid.pool.artifact-set/v1', identity: await hashDopplerEvidence([artifact]), artifacts: [artifact] };
  const index = {
    schema: 'reploid.pool.pack-custody-index/v2', artifactSetIdentity: artifactSet.identity,
    artifacts: [{ artifactId: piece.artifactId, hash: piece.hash, sizeBytes: piece.sizeBytes, chunks: piece.chunks }]
  };
  const expiresAt = fx.nowMs + 10 * MIN;
  const authorization = {
    schema: 'reploid.pool.pack-custody-authorization/v2', artifactSet, transferId: `transfer_${(fx.keySeq += 1)}`, attempt: 1, expiresAt,
    requester: { peerId: acquirer.custodyPeerId, publicKey: acquirer.publicKey },
    suppliers: [{ peerId: supplier.custodyPeerId, publicKey: supplier.publicKey }],
    indexDigest: await hashDopplerEvidence(index),
    limits: { maxArtifactBytes: 1 << 20, maxChunkBytes: CHUNK, maxTransferBytes: piece.sizeBytes, maxConcurrentChunks: 1, requestTimeoutMs: 5000 }
  };
  const now = () => fx.nowMs;
  const served = await custody.createPeerPackSupplier({
    authorization, index, peerId: supplier.custodyPeerId, privateKey: supplier.privateKey, now,
    inventory: { expiresAt, maxBytes: piece.sizeBytes, artifacts: [{ artifactId: piece.artifactId, chunkIndexes: piece.chunks.map((chunk) => chunk.index) }] },
    readChunk: async (_, chunk) => {
      const out = bytes.slice(chunk.offset, chunk.offset + chunk.sizeBytes);
      if (chunk.index === corruptChunk) out[0] ^= 1;
      return out;
    }
  });
  const checkpoints = {
    getChunk: async (chunk) => (cachedChunks.includes(chunk.index) ? bytes.slice(chunk.offset, chunk.offset + chunk.sizeBytes) : null),
    putChunk: async () => ({}),
    deleteChunk: async () => {}
  };
  const store = await custody.createPeerPackArtifactStore({
    authorization, index, inventories: [served.inventory], requesterPrivateKey: acquirer.privateKey,
    requestChunk: async (_, message) => served.serve(message), now, checkpoints, maxConcurrentChunks: 1
  });
  let failure = null;
  try {
    await store.readArtifact(artifact);
  } catch (error) {
    failure = error.message;
  }
  const receipt = failure ? { ...store.getReceipt(), failure } : store.getReceipt();
  return {
    artifactId: piece.artifactId, authorization, index, receipt, attestation: await attest(receipt, acquirer),
    supplierCertificate: supplier.certificate, acquirerCertificate: acquirer.certificate
  };
}
const serviceEvidence = ({ authorization, index, receipt, attestation, supplierCertificate, acquirerCertificate }) => ({
  authorization, index, receipt, attestation, supplierCertificate, acquirerCertificate
});

// A real ordered resident stage: its reserve/executeStage/closeAttempt are the normal stage ports.
const GENERATION = `sha256:${'c'.repeat(64)}`;
const STAGE_PLAN = {
  schema: 'doppler.layer-partition-contract/v3', modelId: MODEL.modelId, stageCount: 3,
  partitions: [0, 1, 2].map((index) => ({ index, layerRange: [index * 2, index * 2 + 1] }))
};
const ACTIVATION = { schema: 'doppler.activation-tensor/v1', dtype: 'f32', precision: 'f32', components: 1, elementStrideBytes: 4, hiddenSize: 8 };
const routeStage = (index, participantId) => ({
  index, participantId, transportId: `t_${participantId}`, residentId: `r_${participantId}`, executionId: `e_${participantId}`
});
const TRUE_WEIGHTS = 7;
// Stand-in for Doppler stage arithmetic: the output depends on the resident weights.
const stageCompute = (weights, values) => values.map((value, index) => (value * weights + index) % 101);

async function residentStage({ participantId = 'peer_c1', weights = TRUE_WEIGHTS, slots = 2, prepared = true, slowMs = 0 } = {}) {
  const session = {
    getDescriptor: () => ({
      schema: 'doppler.resident-partition/v2', ready: true, modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId,
      index: 1, stageCount: 3, layerRange: STAGE_PLAN.partitions[1].layerRange, residentWeightBytes: 64, generationDigest: GENERATION
    }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: async () => ({ tokenIds: [1] }),
    executeStage: async (request) => {
      fx.nowMs += slowMs;
      return { identity: request.identity, partitionIndex: 1, step: request.step, tokenPosition: request.tokenPosition,
        activationTensor: { values: stageCompute(weights, request.activation.values) } };
    },
    closeAttempt: async () => {},
    close: async () => {}
  };
  const resident = createResidentPartition({
    runtime: { openResidentPartition: async () => session },
    model: { id: MODEL.modelId, identity: MODEL.modelIdentity, generation: { maxTokens: 1 } },
    plan: STAGE_PLAN, planId: MODEL.planId, index: 1, participantId,
    limits: { maxAttempts: 1000, maxConcurrentAttempts: slots },
    ordered: {
      runtime: { hashLayerPartitionPlan: () => MODEL.planId, hashPartitionGeneration: () => GENERATION, getPartitionActivationContract: () => ACTIVATION },
      stage: routeStage(1, participantId)
    }
  });
  if (prepared) await resident.prepare({ approved: true });
  return resident;
}

/** Prober port: reaches the stage, builds bounded probe attempts from the nonce, and checks output against the reference. */
function installProber(stages, { failPrepare = false } = {}) {
  fx.prober = {
    connect: async ({ participantId }) => {
      const device = stages.get(participantId);
      if (!device) throw new Error('stage unreachable');
      return device;
    },
    prepare: async ({ stage, nonce, attemptIds }) => {
      if (failPrepare) throw new Error('probe input source unavailable');
      const route = {
        schema: 'reploid.partition-route/v1', modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId,
        stages: [routeStage(0, 'prober'), { index: 1, ...stage }, routeStage(2, 'probe_tail')], activation: ACTIVATION
      };
      const values = Array.from({ length: 8 }, (_, index) => (nonce.charCodeAt(index % nonce.length) + index) % 101);
      return {
        identities: attemptIds.map((attemptId) => ({
          schema: 'reploid.partition-attempt/v2', threadId: 'readiness-probe', attemptId, requesterId: 'prober', placementGeneration: 0, route
        })),
        request: { inputTokenCount: 1, maxTokens: 1, generationDigest: GENERATION, generation: { maxTokens: 1 }, activation: { values } }
      };
    },
    verify: async ({ request, output }) => ({
      ok: JSON.stringify(output.activationTensor?.values) === JSON.stringify(stageCompute(TRUE_WEIGHTS, request.activation.values)),
      method: 'test-reference-stage', detail: { compared: request.activation.values.length }
    })
  };
}

const common = (offerId, accountId, overrides) => ({
  offerId,
  accountId,
  duration: { startsAt: clock(), endsAt: at(40 * MIN) },
  validUntil: at(5 * MIN),
  paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN },
  failureCompensation: { kind: 'none' },
  ...overrides
});

const deliveryOffer = ({ offerId, pieces, accountId = 'acct_c1', participantId = 'peer_c1', ...overrides }) => common(offerId, accountId, {
  work: { category: 'verified_delivery', participantId, pieces: pieces.map(({ hash, sizeBytes }) => ({ hash, sizeBytes })) },
  reward: { basis: { kind: 'test_per_delivered_byte' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'deliveredBytes', numerator: 1, denominator: CHUNK }] }, maxReward: 50 },
  resourceBounds: { transferBytes: { max: 1024, unit: 'byte' } },
  ...overrides
});

const CONTRACT_REWARD = {
  basis: { kind: 'test_per_verified_interval' },
  formula: { kind: 'metered', base: 0, rates: [{ meter: 'verifiedIntervals', numerator: 2, denominator: 1 }] },
  maxReward: 50
};

const storageOffer = ({ offerId, pieces, contractedBy = 'acct_operator', accountId = 'acct_c1', contractType = 'accessible_delivery', voidWhen = {}, ...overrides }) => common(offerId, accountId, {
  work: { category: 'contracted_storage', participantId: 'peer_c1', contractedBy, contractType, pieces },
  reward: {
    ...CONTRACT_REWARD,
    deductions: { kind: 'metered', base: 0, rates: [{ meter: 'missedChallenges', numerator: 1, denominator: 1 }, { meter: 'failedServiceRequests', numerator: 2, denominator: 1 }] },
    voidWhen: { minVerifiedIntervals: 2, maxOutageIntervals: 1, maxMissedChallenges: 1, maxFailedChallenges: 1, maxFailedServiceRequests: 1, ...voidWhen }
  },
  resourceBounds: { custodyBytes: { max: 1024, unit: 'byte' } },
  obligations: { intervalMs: 10 * MIN, responseWindowMs: MIN, serviceWindowMs: 5 * MIN },
  ...overrides
});

const readinessOffer = ({ offerId, contractedBy = 'acct_operator', accountId = 'acct_c1', slots = 2, voidWhen = {}, ...overrides }) => common(offerId, accountId, {
  work: { category: 'prepared_readiness', participantId: 'peer_c1', contractedBy, stage: { model: { ...MODEL }, stageIndex: 1 } },
  reward: {
    ...CONTRACT_REWARD,
    deductions: { kind: 'metered', base: 0, rates: [{ meter: 'outageIntervals', numerator: 1, denominator: 1 }] },
    voidWhen: { minVerifiedIntervals: 2, maxOutageIntervals: 2, maxMissedChallenges: 0, maxFailedChallenges: 2, ...voidWhen }
  },
  resourceBounds: { attemptSlots: { max: slots, unit: 'attempt' } },
  obligations: { intervalMs: 10 * MIN, responseWindowMs: MIN },
  ...overrides
});

const acceptOffer = async (rewards, input) => {
  const offer = await rewards.createOffer({ ...input, idempotencyKey: `offer:${input.offerId}` });
  await rewards.acceptOffer({ offerId: offer.offerId, accountId: offer.accountId, offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: `accept:${offer.offerId}` });
  return rewards.getOffer(offer.offerId);
};

const signAnswer = async (key, challenge, response) => {
  const body = { schema: CHALLENGE_ANSWER_SCHEMA, challengeId: challenge.challengeId, nonce: challenge.nonce, offerId: challenge.offerId, publicKey: key.publicKey, response };
  return { ...body, signature: await signCanonical(body, key.privateKey, { domain: CHALLENGE_ANSWER_SCHEMA }) };
};

const chunkBytes = ({ target }) => Buffer.from(library.get(target.pieceHash)
  .subarray(target.chunkOffset, target.chunkOffset + target.chunkSizeBytes)).toString('base64');

/** Drive a storage contract interval by interval; answer is correct, wrong, late or none. */
async function runStorage(rewards, offer, steps, { key, acquirer }) {
  const start = toMs(offer.duration.startsAt);
  const challenges = [];
  for (const [interval, entries] of steps.entries()) {
    fx.nowMs = start + interval * offer.obligations.intervalMs + MIN;
    for (const [position, { kind, answer }] of entries.entries()) {
      const challenge = await rewards.issueChallenge({
        offerId: offer.offerId, kind, ...(kind === 'service' ? { acquirerParticipantId: acquirer.participantId } : {}),
        idempotencyKey: `challenge:${offer.offerId}:${interval}:${position}`
      });
      challenges.push(challenge);
      const respond = (input) => rewards.answerChallenge({ challengeId: challenge.challengeId, idempotencyKey: `answer:${challenge.challengeId}`, ...input });
      if (answer === 'none') continue;
      if (kind === 'service') {
        fx.nowMs += MIN;
        const piece = offer.work.pieces.find((entry) => entry.hash === challenge.target.pieceHash);
        challenge.evidence = await deliver({ supplier: key, acquirer, piece });
        await respond({ evidence: serviceEvidence(challenge.evidence) });
        continue;
      }
      fx.nowMs += answer === 'late' ? 2 * MIN : 10_000;
      const bytes = answer === 'wrong' ? Buffer.from(new Uint8Array(CHUNK)).toString('base64') : chunkBytes(challenge);
      await respond({ answer: await signAnswer(key, challenge, { bytes }), certificate: key.certificate });
    }
  }
  return challenges;
}

/** Run one readiness probe per interval; `before(interval)` may swap the stage first. */
async function runProbes(rewards, offer, intervals, before = () => {}) {
  const start = toMs(offer.duration.startsAt);
  const results = [];
  for (let interval = 0; interval < intervals; interval += 1) {
    fx.nowMs = start + interval * offer.obligations.intervalMs + MIN;
    await before(interval);
    results.push(await rewards.probeReadiness({ offerId: offer.offerId, idempotencyKey: `probe:${offer.offerId}:${interval}` }));
  }
  return results;
}

const closeContract = (offer) => { fx.nowMs = toMs(offer.duration.endsAt) + 6 * MIN; };
const repeat = (count, entries) => Array.from({ length: count }, () => entries);

describe.each(['memory', 'firestore'])('contribution reward categories (%s store)', (kind) => {
  let harness;
  let ledger;
  let rewards;
  let pieces;
  let contributor;
  let acquirer;
  let stages;

  beforeEach(async () => {
    ({ harness, ledger, rewards } = await openFixture(kind));
    pieces = [await commitPiece('model/part-a.bin', 1), await commitPiece('model/part-b.bin', 2), await commitPiece('model/part-c.bin', 3)];
    contributor = await custodyKey('peer_c1');
    acquirer = await custodyKey('peer_acq');
    stages = new Map([['peer_c1', await residentStage()]]);
    installProber(stages);
  });

  it('discloses limitations and refuses unsupported terms in every offer', async () => {
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    const storage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    const ready = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready' }));
    for (const offer of [delivery, storage, ready]) {
      expect(offer.validation.limitations).toEqual(expect.arrayContaining([
        expect.stringContaining('not complete collusion prevention; apparently separate accounts are not shown to be independent'),
        expect.stringContaining('none is the only supported term')
      ]));
    }
    expect(storage.validation.limitations).toContainEqual(expect.stringContaining('not that the contributor retained them locally'));
    expect(ready.validation.limitations).toContainEqual(expect.stringContaining('does not show readiness between probes'));
    await expect(rewards.createOffer({ ...storageOffer({ offerId: 'offer_local', pieces: pieces.slice(0, 2), contractType: 'local_retention' }), idempotencyKey: 'offer:local' }))
      .rejects.toMatchObject({ code: 'contract_type_unsupported', message: expect.stringContaining('a successful byte response alone cannot establish local custody') });
    await rejectsWith(rewards.createOffer({ ...readinessOffer({ offerId: 'offer_comp', failureCompensation: { kind: 'formula' } }), idempotencyKey: 'offer:comp' }), 'failure_compensation_unsupported');
  });

  it('verified delivery: issues one lot for a demanded piece the acquirer received, verified and attested', async () => {
    await demand(ledger, { quoteId: 'q_demand' });
    const offer = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces: pieces.slice(0, 2) }));
    const evidence = await deliver({ supplier: contributor, acquirer, piece: pieces[0] });
    const validation = await rewards.validateWork({ offerId: offer.offerId, ...evidence, idempotencyKey: 'validate:delivery' });
    expect(validation).toMatchObject({
      outcome: 'accepted', reasons: [], category: 'verified_delivery', workId: expect.stringMatching(/^dlvr_/),
      reward: { amount: 3, meters: { deliveredBytes: 192, deliveredPieces: 1 } },
      evidence: { acquirerAccountId: 'acct_acq', delivery: { deliveredChunks: 3, totalChunks: 3, artifact: { hash: pieces[0].hash } } }
    });
    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(issued).toMatchObject({ status: 'issued', basis: 'settled_demand', provenance: 'earned' });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'earned', quantity: 3,
      source: {
        category: 'delivery', rewardCategory: 'verified_delivery', basis: 'settled_demand', validationId: validation.validationId,
        authorizationHash: evidence.receipt.authorizationHash, transferId: evidence.authorization.transferId,
        artifactId: pieces[0].artifactId, pieceHash: pieces[0].hash, acquirerAccountId: 'acct_acq', deliveredBytes: 192
      }
    });
    // Chunks the acquirer restored from its own checkpoints earn nothing.
    const second = await custodyKey('peer_acq2');
    const resumed = await deliver({ supplier: contributor, acquirer: second, piece: pieces[0], cachedChunks: [0] });
    expect(await rewards.validateWork({ offerId: offer.offerId, ...resumed, idempotencyKey: 'validate:resumed' }))
      .toMatchObject({ outcome: 'accepted', reward: { amount: 2, meters: { deliveredBytes: 128 } } });
  });

  it('verified delivery: rejects fabricated, uncertified, incomplete, undemanded, duplicate and replayed deliveries', async () => {
    await demand(ledger, { quoteId: 'q_demand' });
    const offer = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces: pieces.slice(0, 2) }));
    const validate = (evidence, key) => rewards.validateWork({ offerId: offer.offerId, ...evidence, idempotencyKey: key });

    expect(codes(await validate(await deliver({ supplier: contributor, acquirer, piece: pieces[0], corruptChunk: 1 }), 'v:incomplete'))).toEqual(['delivery_not_completed']);
    expect(codes(await validate(await deliver({ supplier: contributor, acquirer, piece: pieces[0], cachedChunks: [0, 1, 2] }), 'v:cached'))).toEqual(['nothing_delivered']);
    expect(codes(await validate(await deliver({ supplier: contributor, acquirer, piece: pieces[2] }), 'v:undemanded'))).toEqual(['piece_not_offered']);

    const genuine = await deliver({ supplier: contributor, acquirer, piece: pieces[1] });
    // The supplier holds the signed requests, but only the acquirer's key can attest the receipt.
    expect(codes(await validate({ ...genuine, attestation: await attest(genuine.receipt, contributor) }, 'v:forged-attestation'))).toEqual(['recipient_attestation_invalid']);
    expect(codes(await validate({ ...genuine, receipt: { ...genuine.receipt, cacheBytes: 64 } }, 'v:tampered'))).toEqual(['recipient_attestation_invalid']);
    const altered = structuredClone(genuine.receipt);
    altered.attempts[0].observedBytesHash = `sha256:${'f'.repeat(64)}`;
    expect(codes(await validate({ ...genuine, receipt: altered, attestation: await attest(altered, acquirer) }, 'v:bad-chunk'))).toEqual(['delivery_proof_invalid']);
    // Custody keys count only with a certificate from the participant's persistent identity.
    const phantom = await custodyKey('peer_acq', { certified: false });
    expect(codes(await validate(await deliver({ supplier: contributor, acquirer: phantom, piece: pieces[1] }), 'v:phantom'))).toEqual(['acquirer_identity_unbound']);
    const borrowed = await deliver({ supplier: contributor, acquirer, piece: pieces[1] });
    expect(codes(await validate({ ...borrowed, acquirerCertificate: contributor.certificate }, 'v:borrowed-certificate'))).toEqual(['acquirer_identity_unbound']);
    const unboundSupplier = await custodyKey('peer_c1', { certified: false });
    expect(codes(await validate(await deliver({ supplier: unboundSupplier, acquirer, piece: pieces[1] }), 'v:unbound-supplier'))).toEqual(['contributor_identity_mismatch']);

    const first = await validate(genuine, 'v:genuine');
    expect(first.outcome).toBe('accepted');
    expect(await validate(genuine, 'v:genuine')).toEqual(first);
    expect(await validate(genuine, 'v:replayed')).toMatchObject({
      outcome: 'rejected', reasons: [{ code: 'duplicate_reward', details: { validationId: first.validationId } }]
    });
    // The same acquirer receiving the same piece again is not a new delivered unit.
    expect(codes(await validate(await deliver({ supplier: contributor, acquirer, piece: pieces[1] }), 'v:redelivery'))).toEqual(['duplicate_reward']);
    await rewards.issueReward({ validationId: first.validationId });
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 3]]);
  });

  it('contracted storage: rewards accessible delivery and service kept over the contracted interval', async () => {
    await demand(ledger, { quoteId: 'q_demand' });
    const offer = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    expect(offer).toMatchObject({ work: { contractType: 'accessible_delivery' }, obligations: { intervalMs: 10 * MIN, responseWindowMs: MIN, serviceWindowMs: 5 * MIN } });
    fx.randoms.push(0, 4, 1, 2, 5, 0);
    const challenges = await runStorage(rewards, offer, [
      [{ kind: 'custody', answer: 'correct' }, { kind: 'service', answer: 'correct' }],
      ...repeat(3, [{ kind: 'custody', answer: 'correct' }])
    ], { key: contributor, acquirer });
    expect(new Set(challenges.filter((entry) => entry.kind === 'custody').map((entry) => `${entry.target.pieceHash}:${entry.target.chunkIndex}`)).size).toBeGreaterThan(1);
    expect((await rewards.listChallenges(offer.offerId)).map((entry) => entry.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);

    // The service transfer fulfilled the storage contract; it cannot also earn a delivery reward.
    const served = challenges.find((entry) => entry.kind === 'service').evidence;
    expect(await rewards.validateWork({ offerId: delivery.offerId, ...served, idempotencyKey: 'validate:served' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'duplicate_reward', details: { challengeId: expect.stringMatching(/^chl_/) } }] });

    fx.nowMs = toMs(offer.duration.endsAt);
    expect(codes(await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:early' }))).toEqual(['contract_interval_open']);
    closeContract(offer);
    const validation = await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:storage' });
    expect(validation).toMatchObject({
      outcome: 'accepted', workId: expect.stringMatching(/^stor_/),
      reward: { amount: 8, gross: 8, deduction: 0, voided: false, meters: { verifiedIntervals: 4, passedChallenges: 4, servedRequests: 1, failedServiceRequests: 0, outageIntervals: 0 } }
    });
    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'earned', quantity: 8,
      source: { category: 'storage', rewardCategory: 'contracted_storage', basis: 'settled_demand', contractId: 'offer_storage', contractedBy: 'acct_operator', intervals: 4, verifiedIntervals: 4 }
    });
    expect(codes(await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:storage:again' }))).toEqual(['duplicate_reward']);
  });

  it('contracted storage: missed and failed obligations reduce or void the reward per the accepted terms', async () => {
    const reduced = await acceptOffer(rewards, storageOffer({ offerId: 'offer_reduced', pieces: pieces.slice(0, 2) }));
    await runStorage(rewards, reduced, [
      [{ kind: 'custody', answer: 'correct' }], [{ kind: 'custody', answer: 'none' }], ...repeat(2, [{ kind: 'custody', answer: 'correct' }])
    ], { key: contributor, acquirer });
    closeContract(reduced);
    expect(await rewards.validateWork({ offerId: reduced.offerId, idempotencyKey: 'validate:reduced' })).toMatchObject({
      outcome: 'accepted', reward: { gross: 6, deduction: 1, amount: 5, meters: { verifiedIntervals: 3, outageIntervals: 1, missedChallenges: 1 } }
    });

    fx.nowMs = Date.parse('2026-10-14T03:00:00.000Z');
    const voided = await acceptOffer(rewards, storageOffer({ offerId: 'offer_voided', pieces: pieces.slice(0, 2) }));
    await runStorage(rewards, voided, [
      [{ kind: 'custody', answer: 'late' }], [{ kind: 'custody', answer: 'wrong' }],
      [{ kind: 'custody', answer: 'correct' }, { kind: 'service', answer: 'none' }], [{ kind: 'custody', answer: 'correct' }]
    ], { key: contributor, acquirer });
    expect((await rewards.listChallenges(voided.offerId)).map((entry) => [entry.kind, entry.status]))
      .toEqual([['custody', 'missed'], ['custody', 'failed'], ['custody', 'passed'], ['service', 'open'], ['custody', 'passed']]);
    closeContract(voided);
    const outcome = await rewards.validateWork({ offerId: voided.offerId, idempotencyKey: 'validate:voided' });
    expect(outcome).toMatchObject({
      outcome: 'voided', issuanceStatus: 'voided',
      reward: {
        amount: 0, voided: true,
        meters: { verifiedIntervals: 1, outageIntervals: 3, missedChallenges: 1, failedChallenges: 1, failedServiceRequests: 1 },
        breaches: expect.arrayContaining([{ threshold: 'minVerifiedIntervals', limit: 2, value: 1 }, { threshold: 'maxOutageIntervals', limit: 1, value: 3 }])
      }
    });
    expect(await rewards.issueReward({ validationId: outcome.validationId })).toMatchObject({ status: 'voided', lotId: null });
    expect(codes(await rewards.validateWork({ offerId: voided.offerId, idempotencyKey: 'validate:voided:again' }))).toEqual(['duplicate_reward']);
  });

  it('contracted storage: challenge answers need an identity-certified custody key, a deadline and the right recipient', async () => {
    const offer = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    const challenge = await rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:1' });
    expect(challenge).toMatchObject({ status: 'open', kind: 'custody', respondBy: at(MIN), target: { pieceHash: pieces[0].hash, chunkIndex: 0 } });
    expect(await rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:1' })).toEqual(challenge);

    const answer = await signAnswer(contributor, challenge, { bytes: chunkBytes(challenge) });
    const uncertified = await custodyKey('peer_c1', { certified: false });
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer: await signAnswer(uncertified, challenge, { bytes: chunkBytes(challenge) }), certificate: uncertified.certificate, idempotencyKey: 'a:uncertified' }), 'answer_not_authenticated');
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer, idempotencyKey: 'a:no-certificate' }), 'answer_not_authenticated');
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer: { ...answer, nonce: 'nonce_other' }, certificate: contributor.certificate, idempotencyKey: 'a:forged' }), 'answer_not_authenticated');
    const passed = await rewards.answerChallenge({ challengeId: challenge.challengeId, answer, certificate: contributor.certificate, idempotencyKey: 'a:1' });
    expect(passed).toMatchObject({ status: 'passed', answer: { late: false, reasons: [] } });
    expect(await rewards.answerChallenge({ challengeId: challenge.challengeId, answer, certificate: contributor.certificate, idempotencyKey: 'a:1' })).toEqual(passed);
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer, certificate: contributor.certificate, idempotencyKey: 'a:2' }), 'challenge_already_resolved');

    const service = await rewards.issueChallenge({ offerId: offer.offerId, kind: 'service', acquirerParticipantId: 'peer_acq', idempotencyKey: 'c:service' });
    const other = await custodyKey('peer_acq2');
    await rejectsWith(rewards.answerChallenge({ challengeId: service.challengeId, evidence: serviceEvidence(await deliver({ supplier: contributor, acquirer: other, piece: pieces[0] })), idempotencyKey: 'a:misdirected' }), 'invalid_answer');
    expect((await rewards.listChallenges(offer.offerId)).find((entry) => entry.kind === 'service').status).toBe('open');
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'execution', idempotencyKey: 'c:execution' }), 'invalid_challenge_kind');
    fx.nowMs = toMs(offer.duration.endsAt);
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:after' }), 'challenge_outside_contract');
  });

  it('prepared readiness: real admission, execution and settlement probes prove a prepared stage', async () => {
    await commit(ledger, { commitmentId: 'commitment_operator', funderId: 'acct_operator', amount: 40 });
    await rewards.reserveFunding({
      fundingId: 'funding_operator', commitmentId: 'commitment_operator', amount: 40,
      categories: ['prepared_readiness', 'contracted_storage'], idempotencyKey: 'fund:operator'
    });
    const offer = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready' }));
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:custody' }), 'invalid_challenge_kind');
    const probes = await runProbes(rewards, offer, 4);
    expect(probes.map((probe) => probe.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(probes[0].answer.probe).toMatchObject({
      stage: { participantId: 'peer_c1', transportId: 't_peer_c1', residentId: 'r_peer_c1', executionId: 'e_peer_c1' },
      admission: [{ status: 'reserved' }, { status: 'reserved' }],
      execution: { completed: true },
      verification: { ok: true, method: 'test-reference-stage' },
      settlement: [{ status: 'settled' }, { status: 'settled' }],
      reasons: []
    });
    // Every probe attempt went through the stage's own reservations and settled there.
    const reservations = stages.get('peer_c1').getState().reservations;
    expect(reservations.active).toBe(0);
    expect(reservations.records).toHaveLength(8);
    expect(reservations.records.every((record) => record.phase === 'settled' && record.identity.threadId === 'readiness-probe')).toBe(true);

    closeContract(offer);
    const validation = await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:ready' });
    expect(validation).toMatchObject({ outcome: 'accepted', workId: expect.stringMatching(/^rdy_/), reward: { amount: 8, meters: { verifiedIntervals: 4, passedChallenges: 4 } } });
    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'subsidized', quantity: 8,
      source: { category: 'readiness', rewardCategory: 'prepared_readiness', basis: 'funded_reservation', fundingId: 'funding_operator', funderKind: 'operator', contractId: 'offer_ready', stageIndex: 1 }
    });
  });

  it('prepared readiness: stored state, declared presence, wrong weights, missing slots and slowness are outages', async () => {
    const offer = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready' }));
    const swaps = [
      async () => {},
      async () => stages.set('peer_c1', await residentStage({ prepared: false })),
      async () => stages.set('peer_c1', await residentStage()),
      async () => stages.set('peer_c1', await residentStage({ weights: 3 }))
    ];
    const probes = await runProbes(rewards, offer, 4, (interval) => swaps[interval]());
    expect(probes.map((probe) => probe.status)).toEqual(['passed', 'failed', 'passed', 'failed']);
    expect(probes[1].answer.reasons).toEqual([expect.stringMatching(/^admission: the stage refused promised slot 1 of 2/)]);
    expect(probes[3].answer.reasons).toEqual([expect.stringMatching(/^verification: /)]);
    expect(probes[3].answer.probe.settlement).toEqual([{ attemptId: expect.any(String), status: 'settled' }, { attemptId: expect.any(String), status: 'settled' }]);
    closeContract(offer);
    expect(await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:ready' })).toMatchObject({
      outcome: 'accepted', reward: { gross: 4, deduction: 2, amount: 2, meters: { verifiedIntervals: 2, outageIntervals: 2, failedChallenges: 2 } }
    });

    // Too few admission slots, a probe past its deadline, and the prober's own failures.
    fx.nowMs = Date.parse('2026-10-14T03:00:00.000Z');
    const second = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready_2' }));
    const results = await runProbes(rewards, second, 3, async (interval) => {
      if (interval === 0) stages.set('peer_c1', await residentStage({ slots: 1 }));
      if (interval === 1) stages.set('peer_c1', await residentStage({ slowMs: 2 * MIN }));
      if (interval === 2) installProber(stages, { failPrepare: true });
    });
    expect(results.map((probe) => probe.status)).toEqual(['failed', 'failed', 'withdrawn']);
    expect(results[0].answer.reasons).toEqual([expect.stringMatching(/refused promised slot 2 of 2/)]);
    // The attempt refused at admission is still owned and closed: a lost acknowledgement is not a release.
    expect(results[0].answer.probe.settlement.map((entry) => entry.status)).toEqual(['settled', 'settled']);
    expect(results[1].answer.reasons).toContainEqual(expect.stringMatching(/^deadline:/));
    // A probe left open by a prober crash is withdrawn at validation, never charged to the contributor.
    installProber(stages);
    fx.nowMs = toMs(second.duration.startsAt) + 30 * MIN + MIN;
    harness.faults.reward.afterCommit = () => { harness.faults.reward.beforeCommit = () => { throw new Error('simulated prober crash'); }; };
    await expect(rewards.probeReadiness({ offerId: second.offerId, idempotencyKey: 'probe:crash' })).rejects.toThrow('simulated prober crash');
    closeContract(second);
    expect(await rewards.validateWork({ offerId: second.offerId, idempotencyKey: 'validate:ready_2' })).toMatchObject({
      outcome: 'voided', reward: { meters: { verifiedIntervals: 0, outageIntervals: 2, failedChallenges: 2, withdrawnChallenges: 2, unverifiedIntervals: 2 } }
    });
  });

  it('funds bootstrap rewards from an explicit reservation recorded as subsidy, still bounded by capacity', async () => {
    // No settled demand yet: the settled-demand basis alone would block storage and readiness.
    const storage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    await runStorage(rewards, storage, repeat(4, [{ kind: 'custody', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(storage);
    const stored = await rewards.validateWork({ offerId: storage.offerId, idempotencyKey: 'v:storage' });
    await expect(rewards.issueReward({ validationId: stored.validationId })).rejects.toMatchObject({
      code: 'issuance_not_authorized',
      details: { reason: 'demand_limit', bases: [{ basis: 'settled_demand', reason: 'demand_limit' }, { basis: 'funded_reservation', reason: 'funding_exhausted' }] }
    });

    // The funder comes from a registered commitment, never from the reservation itself.
    await expect(rewards.reserveFunding({ fundingId: 'funding_x', funderKind: 'investor', amount: 5, categories: ['contracted_storage'], idempotencyKey: 'fund:x' }))
      .rejects.toMatchObject({ code: 'invalid_funding', details: { errors: expect.arrayContaining([expect.stringContaining('funderKind'), expect.stringContaining('commitmentId')]) } });
    await commit(ledger, { commitmentId: 'commitment_donor', funderKind: 'donor', amount: 5 });
    await rejectsWith(rewards.reserveFunding({
      fundingId: 'funding_donor', commitmentId: 'commitment_donor', amount: 5, categories: ['contracted_storage'], idempotencyKey: 'fund:donor'
    }), 'funder_kind_not_accepted');
    expect(await rewards.getFunding('funding_donor')).toMatchObject({ status: 'refused', refusal: { code: 'funder_kind_not_accepted' } });
    await commit(ledger, { commitmentId: 'commitment_operator', funderId: 'acct_operator', amount: 10 });
    await rewards.reserveFunding({
      fundingId: 'funding_operator', commitmentId: 'commitment_operator', amount: 10,
      categories: ['contracted_storage', 'prepared_readiness'], idempotencyKey: 'fund:operator'
    });
    // Funding never creates capacity: admitted capacity still bounds subsidized issuance.
    fx.capacity.serviceCredits = (await ledger.getSolvencySnapshot()).outstanding.total + 7;
    await declinedWith(rewards.issueReward({ validationId: stored.validationId }), 'capacity_limit');
    fx.capacity.serviceCredits = 100_000;
    const subsidized = await rewards.issueReward({ validationId: stored.validationId });
    expect(subsidized).toMatchObject({ status: 'issued', amount: 8, basis: 'funded_reservation', provenance: 'subsidized' });
    expect(await ledger.getLot(subsidized.lotId)).toMatchObject({ provenance: 'subsidized', source: { basis: 'funded_reservation', fundingId: 'funding_operator', funderKind: 'operator' } });
    expect(await rewards.getFunding('funding_operator')).toMatchObject({ amount: 10, authorized: 8, allowances: 1 });
    expect(await ledger.getSolvencySnapshot()).toMatchObject({ issued: { byProvenance: { earned: 0, subsidized: 8 } }, outstanding: { byProvenance: { subsidized: 8 } } });
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 8, byBasis: { settled_demand: 0, funded_reservation: 8 } });
    // Subsidized credit cannot be relabeled as earned credit.
    const { source } = await ledger.getLot(subsidized.lotId);
    await declinedWith(ledger.issueCredits({ accountId: 'acct_c1', provenance: 'earned', amount: 8, source, idempotencyKey: 'issue:relabel' }), 'issuance_request_mismatch');

    // The remaining 2 cannot cover readiness; a community reservation can.
    const ready = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready' }));
    await runProbes(rewards, ready, 4);
    closeContract(ready);
    const prepared = await rewards.validateWork({ offerId: ready.offerId, idempotencyKey: 'v:ready' });
    await expect(rewards.issueReward({ validationId: prepared.validationId })).rejects.toMatchObject({
      details: { reason: 'funding_exhausted', bases: [{ basis: 'funded_reservation', reason: 'funding_exhausted' }, { basis: 'settled_demand', reason: 'demand_limit' }] }
    });
    await commit(ledger, { commitmentId: 'commitment_community', funderKind: 'community', funderId: 'community_pool', amount: 20 });
    await rewards.reserveFunding({
      fundingId: 'funding_community', commitmentId: 'commitment_community', amount: 20,
      categories: ['prepared_readiness'], idempotencyKey: 'fund:community'
    });
    expect(await rewards.resumeIssuance()).toEqual([expect.objectContaining({ validationId: prepared.validationId, status: 'issued', basis: 'funded_reservation', provenance: 'subsidized' })]);
    expect(await rewards.getFunding('funding_community')).toMatchObject({ authorized: 8 });
    expect((await ledger.getSolvencySnapshot()).issued.byProvenance).toMatchObject({ earned: 0, subsidized: 16 });

    // Releasing a reservation freezes what it authorized and returns the rest to its commitment.
    expect(await rewards.releaseFunding({ fundingId: 'funding_operator' })).toMatchObject({ status: 'released', consumedCredits: 8, returned: 2 });
    expect(await ledger.getFundingCommitment('commitment_operator')).toMatchObject({ amount: 10, allocated: 8, returned: 2, unallocated: 2 });
    expect(await rewards.releaseFunding({ fundingId: 'funding_operator' })).toMatchObject({ status: 'released', returned: 2 });

    // The policy declares the bases per category; an undeclared basis is refused.
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, bases: { settled_demand: ISSUANCE_POLICY.bases.settled_demand } }), 'invalid_policy');
    throwsWith(() => validateIssuancePolicy({ ...ISSUANCE_POLICY, bases: { ...ISSUANCE_POLICY.bases, settled_demand: { ...ISSUANCE_POLICY.bases.settled_demand, provenance: ['subsidized'] } } }), 'invalid_policy');
  });

  it('rejects self-dealing and linked counterparties in delivery, storage and readiness', async () => {
    await demand(ledger, { quoteId: 'q_demand' });
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    const ownDevice = await custodyKey('peer_c1_phone');
    expect(await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer: ownDevice, piece: pieces[0] }), idempotencyKey: 'v:own' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }] });
    fx.links.push({ a: 'acct_c1', b: 'acct_linked', kind: 'shared_payment_instrument', evidenceId: 'link:payment' });
    const linked = await custodyKey('peer_linked');
    expect(codes(await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer: linked, piece: pieces[1] }), idempotencyKey: 'v:linked' })))
      .toEqual(['collusive_demand']);

    const ownStorage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_own_storage', pieces: pieces.slice(0, 2), contractedBy: 'acct_c1' }));
    await rejectsWith(rewards.issueChallenge({ offerId: ownStorage.offerId, kind: 'service', acquirerParticipantId: 'peer_linked', idempotencyKey: 'c:linked' }), 'collusive_demand');
    await rejectsWith(rewards.issueChallenge({ offerId: ownStorage.offerId, kind: 'service', acquirerParticipantId: 'peer_c1_phone', idempotencyKey: 'c:own' }), 'self_dealing');
    await runStorage(rewards, ownStorage, repeat(4, [{ kind: 'custody', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(ownStorage);
    expect(await rewards.validateWork({ offerId: ownStorage.offerId, idempotencyKey: 'v:own-storage' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }] });
    const sameOwnerReady = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_alt_ready', contractedBy: 'acct_alt' }));
    await runProbes(rewards, sameOwnerReady, 4);
    closeContract(sameOwnerReady);
    expect(await rewards.validateWork({ offerId: sameOwnerReady.offerId, idempotencyKey: 'v:alt-ready' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('share an owner') }] });
    expect((await ledger.getAccount('acct_c1')).byProvenance.earned.issued).toBe(0);
  });

  it('bounds every category and basis with the one issuance counter', async () => {
    // Settled demand of 30 credits with a one-half share admits 15 earned credits across categories.
    await demand(ledger, { quoteId: 'q_demand' });
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    const delivered = await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer, piece: pieces[0] }), idempotencyKey: 'v:delivery' });
    const storage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    await runStorage(rewards, storage, repeat(4, [{ kind: 'custody', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(storage);
    const stored = await rewards.validateWork({ offerId: storage.offerId, idempotencyKey: 'v:storage' });
    const ready = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready' }));
    await runProbes(rewards, ready, 4);
    closeContract(ready);
    const prepared = await rewards.validateWork({ offerId: ready.offerId, idempotencyKey: 'v:ready' });
    expect([delivered.reward.amount, stored.reward.amount, prepared.reward.amount]).toEqual([3, 8, 8]);

    await rewards.issueReward({ validationId: delivered.validationId });
    await rewards.issueReward({ validationId: stored.validationId });
    await declinedWith(rewards.issueReward({ validationId: prepared.validationId }), 'funding_exhausted');
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 11, allowances: 2, byBasis: { settled_demand: 11 } });
    fx.capacity = null;
    await commit(ledger, { commitmentId: 'commitment_operator', funderId: 'acct_operator', amount: 20 });
    await rewards.reserveFunding({
      fundingId: 'funding_operator', commitmentId: 'commitment_operator', amount: 20,
      categories: ['prepared_readiness'], idempotencyKey: 'fund:operator'
    });
    await declinedWith(rewards.issueReward({ validationId: prepared.validationId }), 'capacity_evidence_unavailable');
    fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
    expect(await rewards.resumeIssuance()).toEqual([expect.objectContaining({ validationId: prepared.validationId, status: 'issued', provenance: 'subsidized' })]);
    expect((await ledger.getSolvencySnapshot()).issued.byProvenance).toMatchObject({ earned: 11, subsidized: 8 });
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 3], ['issue', 8], ['issue', 8]]);
  });
});

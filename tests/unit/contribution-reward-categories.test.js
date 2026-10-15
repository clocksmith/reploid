import { beforeEach, describe, expect, it } from 'vitest';

import { createCustodyContracts } from '../../packages/reploid/src/artifacts/custody/runtime.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex, signCanonical, verifyCanonicalSignature } from '../../packages/reploid/src/artifacts/signatures.js';
import { executablePacksMatch, hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { CHALLENGE_ANSWER_SCHEMA, DELIVERY_ATTESTATION_SCHEMA, deliveryAttestationBody } from '../../server/rewards/custody-evidence.js';
import {
  MIN, MODEL, at, clock, codes, declinedWith, demand, fx, journalShape, openFixture, ownerAuthorization, rejectsWith
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

/** A custody signing key, optionally bound to an account through the identity port. */
async function custodyKey(participantId, accountId = null) {
  const pair = await createSigningKeyPair();
  const publicKey = await exportPublicKey(pair.publicKey);
  if (accountId) fx.keys.set(`${participantId}|${publicKey}`, accountId);
  return { participantId, publicKey, privateKey: pair.privateKey };
}

const attest = async (receipt, key, attestedAt = clock()) => {
  const body = await deliveryAttestationBody({ receipt, attestedAt });
  return { ...body, signature: await signCanonical(body, key.privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) };
};

/** Run one real custody transfer and return the acquirer's attested evidence. */
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
    requester: { peerId: acquirer.participantId, publicKey: acquirer.publicKey },
    suppliers: [{ peerId: supplier.participantId, publicKey: supplier.publicKey }],
    indexDigest: await hashDopplerEvidence(index),
    limits: { maxArtifactBytes: 1 << 20, maxChunkBytes: CHUNK, maxTransferBytes: piece.sizeBytes, maxConcurrentChunks: 1, requestTimeoutMs: 5000 }
  };
  const now = () => fx.nowMs;
  const served = await custody.createPeerPackSupplier({
    authorization, index, peerId: supplier.participantId, privateKey: supplier.privateKey, now,
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
  return { artifactId: piece.artifactId, authorization, index, receipt, attestation: await attest(receipt, acquirer) };
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

const storageOffer = ({ offerId, pieces, contractedBy = 'acct_operator', accountId = 'acct_c1', voidWhen = {}, ...overrides }) => common(offerId, accountId, {
  work: { category: 'contracted_storage', participantId: 'peer_c1', contractedBy, pieces },
  reward: {
    ...CONTRACT_REWARD,
    deductions: { kind: 'metered', base: 0, rates: [{ meter: 'missedChallenges', numerator: 1, denominator: 1 }, { meter: 'failedServiceRequests', numerator: 2, denominator: 1 }] },
    voidWhen: { minVerifiedIntervals: 2, maxOutageIntervals: 1, maxMissedChallenges: 1, maxFailedChallenges: 1, maxFailedServiceRequests: 1, ...voidWhen }
  },
  resourceBounds: { custodyBytes: { max: 1024, unit: 'byte' } },
  obligations: { intervalMs: 10 * MIN, responseWindowMs: MIN, serviceWindowMs: 5 * MIN },
  ...overrides
});

const readinessOffer = ({ offerId, pieces, contractedBy = 'acct_operator', accountId = 'acct_c1', voidWhen = {}, ...overrides }) => common(offerId, accountId, {
  work: { category: 'prepared_readiness', participantId: 'peer_c1', contractedBy, stage: { model: { ...MODEL }, stageIndex: 1 }, pieces },
  reward: {
    ...CONTRACT_REWARD,
    deductions: { kind: 'metered', base: 0, rates: [{ meter: 'outageIntervals', numerator: 1, denominator: 1 }] },
    voidWhen: { minVerifiedIntervals: 2, maxOutageIntervals: 2, maxMissedChallenges: 1, maxFailedChallenges: 2, ...voidWhen }
  },
  resourceBounds: { attemptSlots: { max: 2, unit: 'attempt' } },
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
const readyState = (overrides = {}) => ({
  phase: 'ready', modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId, stageIndex: 1, availableSlots: 2, ...overrides
});

/**
 * Drive a contract interval by interval. Each step is { kind, answer } where answer is one of
 * correct, wrong, late, none, loading, slots or heartbeat; service steps answer by delivery.
 */
async function runContract(rewards, offer, steps, { key, acquirer, contractKey = offer.offerId }) {
  const start = toMs(offer.duration.startsAt);
  const challenges = [];
  for (const [interval, entries] of steps.entries()) {
    fx.nowMs = start + interval * offer.obligations.intervalMs + MIN;
    for (const [position, { kind, answer }] of entries.entries()) {
      const challenge = await rewards.issueChallenge({
        offerId: offer.offerId, kind, ...(kind === 'service' ? { acquirerParticipantId: acquirer.participantId } : {}),
        idempotencyKey: `challenge:${contractKey}:${interval}:${position}`
      });
      challenges.push(challenge);
      const respond = (input) => rewards.answerChallenge({ challengeId: challenge.challengeId, idempotencyKey: `answer:${challenge.challengeId}`, ...input });
      if (answer === 'none') continue;
      if (kind === 'service') {
        fx.nowMs += MIN;
        const piece = offer.work.pieces.find((entry) => entry.hash === challenge.target.pieceHash);
        const evidence = await deliver({ supplier: key, acquirer, piece });
        challenge.evidence = evidence;
        await respond({ evidence: { authorization: evidence.authorization, index: evidence.index, receipt: evidence.receipt, attestation: evidence.attestation } });
        continue;
      }
      fx.nowMs += answer === 'late' ? 2 * MIN : 10_000;
      const bytes = answer === 'wrong' ? Buffer.from(new Uint8Array(CHUNK)).toString('base64') : chunkBytes(challenge);
      const response = kind === 'custody' ? { bytes }
        : answer === 'loading' ? { state: readyState({ phase: 'loading' }), bytes }
          : answer === 'slots' ? { state: readyState({ availableSlots: 1 }), bytes }
            : answer === 'heartbeat' ? { state: { phase: 'online' } }
              : { state: readyState(), bytes };
      await respond({ answer: await signAnswer(key, challenge, response) });
    }
  }
  return challenges;
}

const closeContract = (offer) => { fx.nowMs = toMs(offer.duration.endsAt) + 6 * MIN; };
const repeat = (count, entries) => Array.from({ length: count }, () => entries);

describe.each(['memory', 'firestore'])('contribution reward categories (%s store)', (kind) => {
  let ledger;
  let rewards;
  let pieces;
  let contributor;
  let acquirer;

  beforeEach(async () => {
    ({ ledger, rewards } = await openFixture(kind));
    pieces = [await commitPiece('model/part-a.bin', 1), await commitPiece('model/part-b.bin', 2), await commitPiece('model/part-c.bin', 3)];
    contributor = await custodyKey('peer_c1', 'acct_c1');
    acquirer = await custodyKey('peer_acq', 'acct_acq');
    await demand(ledger, { quoteId: 'q_demand' });
  });

  it('verified delivery: issues one lot for a demanded piece the acquirer received, verified and attested', async () => {
    const offer = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces: pieces.slice(0, 2) }));
    expect(offer.validation.conditions).toEqual(expect.arrayContaining([expect.stringMatching(/^recipient_attested/), expect.stringMatching(/^single_reward/)]));
    const evidence = await deliver({ supplier: contributor, acquirer, piece: pieces[0] });
    const validation = await rewards.validateWork({ offerId: offer.offerId, ...evidence, idempotencyKey: 'validate:delivery' });
    expect(validation).toMatchObject({
      outcome: 'accepted', reasons: [], category: 'verified_delivery', workId: expect.stringMatching(/^dlvr_/),
      reward: { amount: 3, meters: { deliveredBytes: 192, deliveredPieces: 1 } },
      evidence: { acquirerAccountId: 'acct_acq', delivery: { deliveredChunks: 3, totalChunks: 3, artifact: { hash: pieces[0].hash } } }
    });
    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      provenance: 'earned', quantity: 3,
      source: {
        category: 'delivery', rewardCategory: 'verified_delivery', validationId: validation.validationId, outcome: 'accepted',
        authorizationHash: evidence.receipt.authorizationHash, transferId: evidence.authorization.transferId,
        artifactId: pieces[0].artifactId, pieceHash: pieces[0].hash, acquirerAccountId: 'acct_acq', deliveredBytes: 192
      }
    });

    // Chunks the acquirer restored from its own checkpoints earn nothing.
    const second = await custodyKey('peer_acq2', 'acct_acq2');
    const resumed = await deliver({ supplier: contributor, acquirer: second, piece: pieces[0], cachedChunks: [0] });
    expect(await rewards.validateWork({ offerId: offer.offerId, ...resumed, idempotencyKey: 'validate:resumed' }))
      .toMatchObject({ outcome: 'accepted', reward: { amount: 2, meters: { deliveredBytes: 128 } } });
  });

  it('verified delivery: rejects fabricated, incomplete, undemanded, duplicate and replayed deliveries', async () => {
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
    // A grant naming a requester key no account registered: a fabricated acquirer.
    const phantom = await custodyKey('peer_acq');
    expect(codes(await validate(await deliver({ supplier: contributor, acquirer: phantom, piece: pieces[1] }), 'v:phantom'))).toEqual(['acquirer_identity_unbound']);
    const unboundSupplier = await custodyKey('peer_c1');
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

  it('contracted storage: rewards custody and service kept over the contracted interval', async () => {
    const offer = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    expect(offer).toMatchObject({ obligations: { intervalMs: 10 * MIN, responseWindowMs: MIN, serviceWindowMs: 5 * MIN }, reward: { voidWhen: { maxOutageIntervals: 1 } } });
    fx.randoms.push(0, 4, 1, 2, 5, 0);
    const challenges = await runContract(rewards, offer, [
      [{ kind: 'custody', answer: 'correct' }, { kind: 'service', answer: 'correct' }],
      ...repeat(3, [{ kind: 'custody', answer: 'correct' }])
    ], { key: contributor, acquirer });
    expect(new Set(challenges.filter((entry) => entry.kind === 'custody').map((entry) => `${entry.target.pieceHash}:${entry.target.chunkIndex}`)).size).toBeGreaterThan(1);
    expect((await rewards.listChallenges(offer.offerId)).map((entry) => entry.status)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);

    // The service transfer fulfilled the storage contract; it cannot also earn a delivery reward.
    const { artifactId, authorization, index, receipt, attestation } = challenges.find((entry) => entry.kind === 'service').evidence;
    expect(await rewards.validateWork({ offerId: delivery.offerId, artifactId, authorization, index, receipt, attestation, idempotencyKey: 'validate:served' }))
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
      quantity: 8, source: { category: 'storage', rewardCategory: 'contracted_storage', contractId: 'offer_storage', contractedBy: 'acct_operator', intervals: 4, verifiedIntervals: 4 }
    });
    expect(codes(await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:storage:again' }))).toEqual(['duplicate_reward']);
  });

  it('contracted storage: missed and failed obligations reduce or void the reward per the accepted terms', async () => {
    // One missed custody challenge: one outage interval and one deducted credit.
    const reduced = await acceptOffer(rewards, storageOffer({ offerId: 'offer_reduced', pieces: pieces.slice(0, 2) }));
    await runContract(rewards, reduced, [
      [{ kind: 'custody', answer: 'correct' }], [{ kind: 'custody', answer: 'none' }], ...repeat(2, [{ kind: 'custody', answer: 'correct' }])
    ], { key: contributor, acquirer });
    closeContract(reduced);
    expect(await rewards.validateWork({ offerId: reduced.offerId, idempotencyKey: 'validate:reduced' })).toMatchObject({
      outcome: 'accepted', reward: { gross: 6, deduction: 1, amount: 5, meters: { verifiedIntervals: 3, outageIntervals: 1, missedChallenges: 1 } }
    });

    // A late answer, a wrong proof and an unanswered service request cross the void thresholds.
    fx.nowMs = Date.parse('2026-10-14T03:00:00.000Z');
    const voided = await acceptOffer(rewards, storageOffer({ offerId: 'offer_voided', pieces: pieces.slice(0, 2) }));
    const challenges = await runContract(rewards, voided, [
      [{ kind: 'custody', answer: 'late' }], [{ kind: 'custody', answer: 'wrong' }],
      [{ kind: 'custody', answer: 'correct' }, { kind: 'service', answer: 'none' }], [{ kind: 'custody', answer: 'correct' }]
    ], { key: contributor, acquirer });
    expect(challenges.length).toBe(5);
    const statuses = (await rewards.listChallenges(voided.offerId)).map((entry) => [entry.kind, entry.status]);
    expect(statuses).toEqual([['custody', 'missed'], ['custody', 'failed'], ['custody', 'passed'], ['service', 'open'], ['custody', 'passed']]);
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

  it('contracted storage: challenges are authenticated, timed and kept apart from readiness', async () => {
    const offer = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'readiness', idempotencyKey: 'c:readiness' }), 'invalid_challenge_kind');
    const challenge = await rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:1' });
    expect(challenge).toMatchObject({ status: 'open', kind: 'custody', respondBy: at(MIN), target: { pieceHash: pieces[0].hash, chunkIndex: 0 } });
    expect(await rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:1' })).toEqual(challenge);

    const stranger = await custodyKey('peer_c1');
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer: await signAnswer(stranger, challenge, { bytes: chunkBytes(challenge) }), idempotencyKey: 'a:stranger' }), 'answer_not_authenticated');
    const forged = { ...(await signAnswer(contributor, challenge, { bytes: chunkBytes(challenge) })), nonce: 'nonce_other' };
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer: forged, idempotencyKey: 'a:forged' }), 'answer_not_authenticated');
    const answer = await signAnswer(contributor, challenge, { bytes: chunkBytes(challenge) });
    const passed = await rewards.answerChallenge({ challengeId: challenge.challengeId, answer, idempotencyKey: 'a:1' });
    expect(passed).toMatchObject({ status: 'passed', answer: { late: false, reasons: [] } });
    expect(await rewards.answerChallenge({ challengeId: challenge.challengeId, answer, idempotencyKey: 'a:1' })).toEqual(passed);
    await rejectsWith(rewards.answerChallenge({ challengeId: challenge.challengeId, answer, idempotencyKey: 'a:2' }), 'challenge_already_resolved');

    // Service evidence must be the requested piece, from the contributor, to the designated acquirer, in the window.
    const service = await rewards.issueChallenge({ offerId: offer.offerId, kind: 'service', acquirerParticipantId: 'peer_acq', idempotencyKey: 'c:service' });
    const other = await custodyKey('peer_acq2', 'acct_acq2');
    const misdirected = await deliver({ supplier: contributor, acquirer: other, piece: pieces[0] });
    await rejectsWith(rewards.answerChallenge({ challengeId: service.challengeId, evidence: misdirected, idempotencyKey: 'a:misdirected' }), 'invalid_answer');
    expect((await rewards.listChallenges(offer.offerId)).find((entry) => entry.kind === 'service').status).toBe('open');

    fx.nowMs = toMs(offer.duration.endsAt);
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:after' }), 'challenge_outside_contract');
  });

  it('prepared readiness: rewards a prepared, admittable stage and accounts for outages', async () => {
    const offer = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready', pieces: [pieces[2]] }));
    await rejectsWith(rewards.issueChallenge({ offerId: offer.offerId, kind: 'custody', idempotencyKey: 'c:custody' }), 'invalid_challenge_kind');
    await runContract(rewards, offer, [
      [{ kind: 'readiness', answer: 'correct' }], [{ kind: 'readiness', answer: 'loading' }],
      [{ kind: 'readiness', answer: 'correct' }], [{ kind: 'readiness', answer: 'none' }]
    ], { key: contributor, acquirer });
    const recorded = await rewards.listChallenges(offer.offerId);
    expect(recorded[1]).toMatchObject({ status: 'failed', answer: { reasons: ['the stage is not in the prepared ready phase'] } });
    closeContract(offer);
    const validation = await rewards.validateWork({ offerId: offer.offerId, idempotencyKey: 'validate:ready' });
    expect(validation).toMatchObject({
      outcome: 'accepted', workId: expect.stringMatching(/^rdy_/),
      reward: { gross: 4, deduction: 2, amount: 2, meters: { verifiedIntervals: 2, outageIntervals: 2, failedChallenges: 1, missedChallenges: 1 } }
    });
    const issued = await rewards.issueReward({ validationId: validation.validationId });
    expect(await ledger.getLot(issued.lotId)).toMatchObject({
      quantity: 2, source: { category: 'readiness', rewardCategory: 'prepared_readiness', contractId: 'offer_ready', stageIndex: 1, outageIntervals: 2 }
    });

    // Online presence, stored bytes alone or too few admission slots never pass a probe.
    fx.nowMs = Date.parse('2026-10-14T03:00:00.000Z');
    const presence = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_presence', pieces: [pieces[2]] }));
    await runContract(rewards, presence, [
      [{ kind: 'readiness', answer: 'heartbeat' }], [{ kind: 'readiness', answer: 'slots' }],
      [{ kind: 'readiness', answer: 'heartbeat' }], [{ kind: 'readiness', answer: 'heartbeat' }]
    ], { key: contributor, acquirer });
    expect((await rewards.listChallenges(presence.offerId)).map((entry) => entry.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect((await rewards.listChallenges(presence.offerId))[0].answer.reasons).toEqual(expect.arrayContaining([
      'the chunk bytes do not match the committed hash', 'the stage is not in the prepared ready phase'
    ]));
    closeContract(presence);
    expect(await rewards.validateWork({ offerId: presence.offerId, idempotencyKey: 'validate:presence' }))
      .toMatchObject({ outcome: 'voided', reward: { amount: 0, meters: { verifiedIntervals: 0, outageIntervals: 4 } } });
  });

  it('rejects self-dealing and linked counterparties in delivery, storage and readiness', async () => {
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    const ownDevice = await custodyKey('peer_c1_phone', 'acct_c1');
    expect(await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer: ownDevice, piece: pieces[0] }), idempotencyKey: 'v:own' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }] });
    fx.links.push({ a: 'acct_c1', b: 'acct_linked', kind: 'shared_payment_instrument', evidenceId: 'link:payment' });
    const linked = await custodyKey('peer_linked', 'acct_linked');
    expect(codes(await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer: linked, piece: pieces[1] }), idempotencyKey: 'v:linked' })))
      .toEqual(['collusive_demand']);

    // A storage contract the contributor contracts with itself, and readiness contracted by its other account.
    const ownStorage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_own_storage', pieces: pieces.slice(0, 2), contractedBy: 'acct_c1' }));
    await rejectsWith(rewards.issueChallenge({ offerId: ownStorage.offerId, kind: 'service', acquirerParticipantId: 'peer_linked', idempotencyKey: 'c:linked' }), 'collusive_demand');
    await rejectsWith(rewards.issueChallenge({ offerId: ownStorage.offerId, kind: 'service', acquirerParticipantId: 'peer_c1_phone', idempotencyKey: 'c:own' }), 'self_dealing');
    await runContract(rewards, ownStorage, repeat(4, [{ kind: 'custody', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(ownStorage);
    expect(await rewards.validateWork({ offerId: ownStorage.offerId, idempotencyKey: 'v:own-storage' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('same account') }] });
    const sameOwnerReady = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_alt_ready', pieces: [pieces[2]], contractedBy: 'acct_alt' }));
    await runContract(rewards, sameOwnerReady, repeat(4, [{ kind: 'readiness', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(sameOwnerReady);
    expect(await rewards.validateWork({ offerId: sameOwnerReady.offerId, idempotencyKey: 'v:alt-ready' }))
      .toMatchObject({ outcome: 'rejected', reasons: [{ code: 'self_dealing', message: expect.stringContaining('share an owner') }] });
    expect((await ledger.getAccount('acct_c1')).byProvenance.earned.issued).toBe(0);
  });

  it('bounds every category with the one earned-issuance cap', async () => {
    // Settled demand of 30 credits with a one-half share admits 15 earned credits across all categories.
    const delivery = await acceptOffer(rewards, deliveryOffer({ offerId: 'offer_delivery', pieces }));
    const delivered = await rewards.validateWork({ offerId: delivery.offerId, ...await deliver({ supplier: contributor, acquirer, piece: pieces[0] }), idempotencyKey: 'v:delivery' });
    const storage = await acceptOffer(rewards, storageOffer({ offerId: 'offer_storage', pieces: pieces.slice(0, 2) }));
    await runContract(rewards, storage, repeat(4, [{ kind: 'custody', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(storage);
    const stored = await rewards.validateWork({ offerId: storage.offerId, idempotencyKey: 'v:storage' });
    const ready = await acceptOffer(rewards, readinessOffer({ offerId: 'offer_ready', pieces: [pieces[2]] }));
    await runContract(rewards, ready, repeat(4, [{ kind: 'readiness', answer: 'correct' }]), { key: contributor, acquirer });
    closeContract(ready);
    const prepared = await rewards.validateWork({ offerId: ready.offerId, idempotencyKey: 'v:ready' });
    expect([delivered.reward.amount, stored.reward.amount, prepared.reward.amount]).toEqual([3, 8, 8]);

    await rewards.issueReward({ validationId: delivered.validationId });
    await rewards.issueReward({ validationId: stored.validationId });
    await declinedWith(rewards.issueReward({ validationId: prepared.validationId }), 'demand_limit');
    expect(await rewards.getIssuanceState()).toMatchObject({ authorizedTotal: 11, allowances: 2 });
    fx.capacity = null;
    await demand(ledger, { quoteId: 'q_more' });
    await declinedWith(rewards.issueReward({ validationId: prepared.validationId }), 'capacity_evidence_unavailable');
    fx.capacity = { evidenceId: 'capacity:test', serviceCredits: 100_000, observedAt: null };
    expect(await rewards.resumeIssuance()).toEqual([expect.objectContaining({ validationId: prepared.validationId, status: 'issued' })]);
    expect((await ledger.getSolvencySnapshot()).issued.byProvenance.earned).toBe(19);
    expect(await journalShape(ledger, 'acct_c1')).toEqual([['issue', 3], ['issue', 8], ['issue', 8]]);
  });
});

import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  encodeBytes, toBase64Url, fromBase64Url } from '../../artifacts/identity.js';
import { assertPartition as assert } from './partition-contract.js';

const evidenceSchema = 'reploid.partition-stage-evidence/v1';
const claimSchema = 'reploid.partition-stage-claim/v1';
const acknowledgmentKeys = ['schema', 'stageId', 'attemptDigest', 'sequence', 'baseCursorId', 'decisionId',
  'successorCursorId', 'participantEpoch', 'deviceEpoch', 'residentId'];
const exact = (value, keys) => assert(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Invalid stage evidence fields');
const digest = (runtime, domain, value) => runtime.metadataDigest(domain, value);
const copy = value => structuredClone(value);
const same = (runtime, domain, a, b) => digest(runtime, domain, a) === digest(runtime, domain, b);
function boundStage(runtime, attempt, stage) {
  const accepted = runtime.validateResidentAttemptIdentity(attempt);
  const found = accepted.stages.find(value => value.stageId === stage.stageId);
  assert(found && same(runtime, claimSchema, found, stage), 'Stage differs from admitted attempt');
  return { attempt: accepted, stage: found, attemptDigest: runtime.residentAttemptDigest(accepted) };
}
function checkClaim(runtime, claim, attempt, stage) {
  exact(claim, ['schema', 'stage', 'acknowledgment']);
  const bound = boundStage(runtime, attempt, stage), ack = claim.acknowledgment;
  exact(ack, acknowledgmentKeys);
  assert(claim.schema === claimSchema && same(runtime, claimSchema, claim.stage, bound.stage)
    && ack.schema === 'doppler.stage-commit/v1' && ack.stageId === stage.stageId
    && ack.attemptDigest === bound.attemptDigest && Number.isSafeInteger(ack.sequence) && ack.sequence >= 0
    && (ack.baseCursorId === null || /^sha256:[a-f0-9]{64}$/.test(ack.baseCursorId))
    && /^sha256:[a-f0-9]{64}$/.test(ack.decisionId) && /^sha256:[a-f0-9]{64}$/.test(ack.successorCursorId)
    && ack.participantEpoch === stage.participantEpoch && ack.deviceEpoch === stage.deviceEpoch
    && ack.residentId === stage.residentId, 'Stage commitment binding mismatch');
  return bound;
}

/** Signs an assertion by the existing contributor identity. The resident calls
 * this only after its actual transition settles; signatures do not attest math.
 * The receiver's bounded phase-result owner retains/replays these exact bytes. */
export function createPartitionStageCommitAuthority({ runtime, identity, stage }) {
  for (const method of ['metadataDigest', 'validateResidentAttemptIdentity', 'residentAttemptDigest', 'residentPublicationDecisionDigest']) {
    assert(typeof runtime?.[method] === 'function', 'Canonical Doppler stage contracts required');
  }
  assert(identity?.privateJwk && identity?.publicJwk && identity.peerId === stage?.participantId,
    'Stage signing identity must equal the bound participant');
  const signer = copy(identity), selectedStage = copy(stage);
  let closed = false;
  return Object.freeze({
    getStage: () => copy(selectedStage),
    async sign({ attempt, sequence, baseCursorId, transition }) {
      assert(!closed, 'Stage commitment authority closed');
      const bound = boundStage(runtime, attempt, selectedStage);
      assert(transition?.successor?.generationId === bound.attempt.generationId,
        'Target transition generation differs from attempt');
      const decision = { attemptDigest: bound.attemptDigest, sequence, baseCursorId,
        acceptedTokenIds: transition.acceptedTokenIds, tokenRange: transition.tokenRange,
        successor: transition.successor, delta: { text: transition.delta, outputDigest: transition.outputDigest },
        stoppingOutcome: transition.successor.stopReason };
      const acknowledgment = { schema: 'doppler.stage-commit/v1', stageId: selectedStage.stageId,
        attemptDigest: bound.attemptDigest, sequence, baseCursorId,
        decisionId: runtime.residentPublicationDecisionDigest(decision), successorCursorId: transition.successor.cursorId,
        participantEpoch: selectedStage.participantEpoch, deviceEpoch: selectedStage.deviceEpoch, residentId: selectedStage.residentId };
      const claim = { schema: claimSchema, stage: selectedStage, acknowledgment };
      checkClaim(runtime, claim, bound.attempt, selectedStage);
      assert(await createPeerIdFromPublicJwk(signer.publicJwk) === selectedStage.participantId, 'Signing key does not identify stage participant');
      const key = await importSigningKey(signer);
      const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(signer), key, encodeBytes(digest(runtime, claimSchema, claim)));
      assert(!closed, 'Stage commitment authority closed');
      const evidence = { schema: evidenceSchema, claim: copy(claim), publicJwk: copy(signer.publicJwk), signature: toBase64Url(signature) };
      return { acknowledgment: { ...acknowledgment, authenticationDigest: digest(runtime, evidenceSchema, evidence) }, evidence };
    },
    close() { closed = true; }
  });
}

/** Validates durable evidence against the exact publication acknowledgment and
 * admitted stage, using existing signing formats. No global trust/key lookup. */
export async function verifyPartitionStageCommit({ runtime, attempt, stage, acknowledgment, evidence,
  transition, sequence, baseCursorId }) {
  try {
    // The runtime's canonical encoding enforces bounded metadata before copying.
    const input = { attempt, stage, acknowledgment, evidence,
      ...(transition === undefined ? {} : { transition, sequence, baseCursorId }) };
    digest(runtime, evidenceSchema, input);
    ({ attempt, stage, acknowledgment, evidence, transition, sequence, baseCursorId } = copy(input));
    exact(evidence, ['schema', 'claim', 'publicJwk', 'signature']);
    exact(acknowledgment, [...acknowledgmentKeys, 'authenticationDigest']);
    if (evidence.schema !== evidenceSchema || typeof evidence.signature !== 'string'
      || !/^[A-Za-z0-9_-]{1,256}$/.test(evidence.signature)
      || acknowledgment.authenticationDigest !== digest(runtime, evidenceSchema, evidence)) return false;
    const { authenticationDigest, ...body } = acknowledgment;
    checkClaim(runtime, evidence.claim, attempt, stage);
    if (transition !== undefined && (acknowledgment.sequence !== sequence || acknowledgment.baseCursorId !== baseCursorId
      || acknowledgment.successorCursorId !== transition.successor.cursorId
      || acknowledgment.decisionId !== runtime.residentPublicationDecisionDigest({
        attemptDigest: runtime.residentAttemptDigest(attempt), sequence, baseCursorId,
        acceptedTokenIds: transition.acceptedTokenIds, tokenRange: transition.tokenRange,
        successor: transition.successor, delta: { text: transition.delta, outputDigest: transition.outputDigest },
        stoppingOutcome: transition.successor.stopReason }))) return false;
    if (!same(runtime, claimSchema, body, evidence.claim.acknowledgment)
      || await createPeerIdFromPublicJwk(evidence.publicJwk) !== stage.participantId) return false;
    const key = await importVerificationKey(evidence.publicJwk);
    return await crypto.subtle.verify(getIdentitySignAlgorithm(evidence.publicJwk), key,
      fromBase64Url(evidence.signature), encodeBytes(digest(runtime, claimSchema, evidence.claim)));
  } catch { return false; }
}

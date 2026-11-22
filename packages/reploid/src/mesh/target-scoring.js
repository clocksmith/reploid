/**
 * Score a target after its answer exists. The requester returns the provider's own countersigned receipt with
 * the exact messages and the target; the provider checks that the receipt is its own, that the requester is the
 * receipt's consumer and that the messages hash to the receipt's input digest, then signs the score bound to that
 * receipt. Generation and its receipt are unchanged, and the target never accompanies a generation request.
 */
import { canonicalize } from '../artifacts/canonical-json.js';
import { createPeerIdFromPublicJwk, encodeBytes, fromBase64Url, getIdentitySignAlgorithm, importSigningKey,
  importVerificationKey, toBase64Url } from '../artifacts/identity.js';
import { verifyReceipt } from '../artifacts/receipt.js';
import { hashJson, sha256Hex } from '../artifacts/signatures.js';

export const TARGET_SCORE_REQUEST = 'reploid:target-score-request';
export const TARGET_SCORE_RESULT = 'reploid:target-score-result';
export const TARGET_SCORE_SCHEMA = 'reploid.target-score/v1';
export const MAX_TARGET_CHARACTERS = 512;
const REQUEST_ID = /^[0-9a-f-]{36}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const replies = new WeakMap();

/** The signed fields. Log-probability is carried as an integer in hundredths, the precision Doppler commits to. */
function scorePayload(record) {
  return { schema: TARGET_SCORE_SCHEMA, receiptId: String(record.receiptId), provider: String(record.provider),
    consumer: String(record.consumer), modelIdentity: String(record.modelIdentity), inputDigest: String(record.inputDigest),
    outputDigest: String(record.outputDigest), targetDigest: String(record.targetDigest),
    tokenCount: Number(record.tokenCount), totalLogProbHundredths: Number(record.totalLogProbHundredths), scoredAt: Number(record.scoredAt) };
}

export async function signTargetScore(fields, bundle, cryptoApi = globalThis.crypto) {
  const payload = scorePayload(fields);
  const key = await importSigningKey(bundle, cryptoApi);
  const signature = await cryptoApi.subtle.sign(getIdentitySignAlgorithm(bundle), key, encodeBytes(canonicalize(payload)));
  return { ...payload, providerSignature: toBase64Url(signature), providerKey: bundle.publicJwk };
}

export async function verifyTargetScore(record, cryptoApi = globalThis.crypto) {
  try {
    if (record?.schema !== TARGET_SCORE_SCHEMA || !record.providerSignature || !record.providerKey) return false;
    if (await createPeerIdFromPublicJwk(record.providerKey, cryptoApi) !== record.provider) return false;
    const payload = scorePayload(record);
    if (!DIGEST.test(payload.targetDigest) || !DIGEST.test(payload.inputDigest) || !Number.isSafeInteger(payload.tokenCount)
      || payload.tokenCount < 1 || !Number.isSafeInteger(payload.totalLogProbHundredths) || payload.totalLogProbHundredths > 0) return false;
    const key = await importVerificationKey(record.providerKey, cryptoApi);
    return await cryptoApi.subtle.verify(getIdentitySignAlgorithm(record.providerKey), key, fromBase64Url(record.providerSignature),
      encodeBytes(canonicalize(payload)));
  } catch { return false; }
}

const validTarget = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_TARGET_CHARACTERS;

/** Provider side. `score({ messages, target, signal })` returns Doppler's target score with `modelIdentity`. */
export function attachTargetScoring({ transport, identity, verifyPeer, currentPeer, score, maxReceiptAgeMs = 10 * 60_000, now = Date.now }) {
  transport.onMessage(TARGET_SCORE_REQUEST, (peer, input) => {
    void (async () => {
      const requestId = input?.requestId;
      if (!REQUEST_ID.test(requestId ?? '') || !transport.getPeerBinding(peer)) return;
      const refuse = error => transport.sendToPeer(peer, TARGET_SCORE_RESULT, { requestId, error });
      try {
        const { receipt, messages, target } = input;
        if (!Array.isArray(messages) || !validTarget(target) || !receipt || typeof receipt !== 'object') return refuse('Invalid scoring request');
        const participantId = await verifyPeer(peer, AbortSignal.timeout(5000));
        if (!participantId || currentPeer(peer) !== participantId) return refuse('Verified requester required');
        const verified = await verifyReceipt(receipt);
        if (!verified.valid || !receipt.consumerSignature || receipt.provider !== identity.peerId || receipt.consumer !== participantId
          || receipt.status !== 'completed' || !DIGEST.test(receipt.inputDigest ?? '') || !DIGEST.test(receipt.modelIdentity ?? '')) {
          return refuse('Scoring needs this provider\'s countersigned receipt for the same requester');
        }
        if (!(now() - Number(receipt.timestamp) <= maxReceiptAgeMs)) return refuse('The answer is too old to score');
        if (await hashJson(messages) !== receipt.inputDigest) return refuse('Messages differ from the scored answer');
        const result = await score({ messages, target, signal: AbortSignal.timeout(30_000) });
        if (result?.modelIdentity !== receipt.modelIdentity) return refuse('Scoring used a different model artifact');
        const record = await signTargetScore({ receiptId: receipt.receiptId, provider: identity.peerId, consumer: participantId,
          modelIdentity: receipt.modelIdentity, inputDigest: receipt.inputDigest, outputDigest: receipt.outputDigest,
          targetDigest: await sha256Hex(target), tokenCount: result.tokenCount,
          totalLogProbHundredths: Math.round(result.roundedTotalLogProb * 100), scoredAt: now() }, identity);
        transport.sendToPeer(peer, TARGET_SCORE_RESULT, { requestId, record });
      } catch (error) { refuse(error?.message || 'Scoring failed'); }
    })().catch(() => {});
  });
}

/** Requester side: returns the provider-signed score bound to `receipt`, or throws. */
export async function requestTargetScore({ transport, verifyPeer, currentPeer, providerPeer, providerParticipantId, receipt, messages, target,
  signal = AbortSignal.timeout(40_000) }) {
  if (!validTarget(target) || receipt?.provider !== providerParticipantId) throw Error('Invalid scoring request');
  if (!transport.getPeerBinding(providerPeer) || await verifyPeer(providerPeer, signal) !== providerParticipantId) throw Error('Could not verify the scoring provider');
  const requestId = crypto.randomUUID();
  let waiting = replies.get(transport);
  if (!waiting) {
    waiting = new Map();
    replies.set(transport, waiting);
    transport.onMessage(TARGET_SCORE_RESULT, (peer, result) => waiting.get(result?.requestId)?.(peer, result));
  }
  const targetDigest = await sha256Hex(target);
  return new Promise((resolve, reject) => {
    const abort = () => finish(signal.reason);
    const finish = (error, record) => {
      waiting.delete(requestId);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(record);
    };
    waiting.set(requestId, (peer, result) => {
      if (peer !== providerPeer) return;
      void (async () => {
        if (currentPeer(providerPeer) !== providerParticipantId) throw Error('Scoring provider connection changed');
        if (result.error) throw Error(result.error);
        const record = result.record;
        if (!await verifyTargetScore(record) || record.provider !== providerParticipantId || record.receiptId !== receipt.receiptId
          || record.consumer !== receipt.consumer || record.inputDigest !== receipt.inputDigest || record.outputDigest !== receipt.outputDigest
          || record.modelIdentity !== receipt.modelIdentity || record.targetDigest !== targetDigest) throw Error('Invalid target score');
        finish(null, record);
      })().catch(finish);
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!transport.sendToPeer(providerPeer, TARGET_SCORE_REQUEST, { requestId, receipt, messages, target })) throw Error('Scoring provider unavailable');
    } catch (error) { finish(error); }
  });
}

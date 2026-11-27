/** Fresh proof of a signing identity bound to the current WebRTC certificates. */
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey,
  getIdentitySignAlgorithm, encodeBytes, fromBase64Url, toBase64Url } from '../artifacts/identity.js';
import { createRemoteGenerationRequests } from './remote-generation-requests.js';
import policy from './computer-identity.policy.json' with { type: 'json' };
import { isParticipantId } from '../contracts/identifiers.js';

const challengeType = 'reploid:identity-challenge', proofType = 'reploid:identity-proof';
const sameBinding = (a, b) => !!a && !!b && a.local === b.local && a.remote === b.remote;
const signedBytes = (challenge, participantId) => encodeBytes(JSON.stringify([
  'reploid.mesh-recipient/v1', challenge.roomId, challenge.nonce,
  challenge.requester, challenge.provider, challenge.local, challenge.remote, participantId
]));

// One computer can join on two connections with two signing keys: its requester and a contributor. The
// requester key signs a statement naming the contributor key, and the contributor carries it. A statement
// groups the two only on a connection already proven (above) to hold the contributor key it names, so a third
// peer cannot use it: it names someone else's key, and no one but the requester key's holder can sign another.
const linkBytes = (roomId, computerId, participantId) => encodeBytes(JSON.stringify(['reploid.same-computer/v1', roomId, computerId, participantId]));

/** The statement `identity` (this computer's requester key) signs that `participantId` is the same computer. */
export async function signComputerLink({ identity, participantId, roomId }) {
  const key = await importSigningKey(identity);
  const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, linkBytes(roomId, identity.peerId, participantId));
  return { computerId: identity.peerId, participantId, publicJwk: identity.publicJwk, signature: toBase64Url(signature) };
}

/** { computerId, participantId } when `link` is a valid statement for this room, else null. */
export async function verifyComputerLink(link, roomId) {
  if (!link || typeof link !== 'object' || !isParticipantId(link.computerId) || !isParticipantId(link.participantId)
    || link.computerId === link.participantId || typeof link.signature !== 'string' || link.signature.length > 2048
    || !link.publicJwk || typeof link.publicJwk !== 'object') return null;
  try {
    if (await createPeerIdFromPublicJwk(link.publicJwk) !== link.computerId) return null;
    const key = await importVerificationKey(link.publicJwk);
    return await crypto.subtle.verify(getIdentitySignAlgorithm(link.publicJwk), key, fromBase64Url(link.signature),
      linkBytes(roomId, link.computerId, link.participantId)) ? { computerId: link.computerId, participantId: link.participantId } : null;
  } catch { return null; }
}

export function createMeshPeerIdentity({ transport, getIdentity, roomId, timeoutMs, maxPending, onVerified = () => {} }) {
  let closed = false;
  const signing = new Set();
  const verified = new Map();
  const requests = createRemoteGenerationRequests({ timeoutMs, maxPending, sendCancel() {} });
  // Label discovery must never consume a foreground generation/recovery proof slot.
  const observations = createRemoteGenerationRequests({ timeoutMs, maxPending: policy.maxBackgroundProofs, sendCancel() {} });
  const binding = peerId => transport.getPeerBinding?.(peerId) || null;
  const attempt = peerId => transport.getPeerStates?.().find(peer => peer.id === peerId)?.attemptId ?? null;
  const getVerified = peerId => {
    const record = verified.get(peerId);
    return !closed && record && sameBinding(record.channel, binding(peerId)) && record.attemptId === attempt(peerId)
      ? record.participantId : null;
  };
  const answer = async (peerId, input) => {
    if (closed || signing.size >= maxPending + policy.maxBackgroundProofs) return;
    const channel = binding(peerId), challenge = structuredClone(input);
    if (!channel || !challenge || challenge.roomId !== roomId || challenge.requester !== peerId
      || challenge.provider !== transport.getPeerId() || typeof challenge.nonce !== 'string'
      || !/^[a-f0-9-]{36}$/.test(challenge.nonce)
      || challenge.local !== channel.remote || challenge.remote !== channel.local) return;
    // Discovery and generation can verify the same connection concurrently.
    // Deduplicate the challenge, not the peer; each fresh nonce needs its proof.
    const requestKey = JSON.stringify([peerId, challenge.nonce]);
    if (signing.has(requestKey)) return;
    signing.add(requestKey);
    try {
      const identity = getIdentity(), key = await importSigningKey(identity);
      const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, signedBytes(challenge, identity.peerId));
      if (!closed && sameBinding(channel, binding(peerId))) transport.sendToPeer(peerId, proofType, {
        nonce: challenge.nonce, participantId: identity.peerId, publicJwk: identity.publicJwk,
        signature: toBase64Url(signature)
      });
    } finally { signing.delete(requestKey); }
  };
  const accept = async (peerId, input) => {
    const owner = requests.get(input?.nonce, peerId) ? requests : observations;
    const pending = owner.get(input?.nonce, peerId);
    if (!pending || pending.processing) return;
    pending.processing = true;
    try {
      const proof = structuredClone(input);
      if (await createPeerIdFromPublicJwk(proof.publicJwk) !== proof.participantId) throw new Error('Recipient signing identity mismatch');
      const key = await importVerificationKey(proof.publicJwk);
      if (!await crypto.subtle.verify(getIdentitySignAlgorithm(proof.publicJwk), key,
        fromBase64Url(proof.signature), signedBytes(pending.challenge, proof.participantId))) throw new Error('Invalid recipient identity proof');
      if (closed || owner.get(proof.nonce, peerId) !== pending) return;
      if (!sameBinding(pending.channel, binding(peerId))) throw new Error('Recipient connection changed during verification');
      if (pending.attemptId !== attempt(peerId)) throw new Error('Recipient connection attempt changed during verification');
      verified.set(peerId, { participantId: proof.participantId, channel: pending.channel, attemptId: pending.attemptId });
      owner.settle(pending, { response: proof.participantId });
      try { onVerified(peerId, proof.participantId); } catch { /* Observers cannot invalidate a proof. */ }
    } catch (error) { owner.settle(pending, { error }); }
  };
  transport.onMessage(challengeType, (peerId, payload) => { answer(peerId, payload).catch(() => {}); });
  transport.onMessage(proofType, (peerId, payload) => { accept(peerId, payload).catch(() => {}); });
  const verify = async (owner, peerId, signal) => {
    const channel = binding(peerId);
    if (!channel) return null;
    const challenge = { roomId, nonce: crypto.randomUUID(), requester: transport.getPeerId(), provider: peerId, ...channel };
    const attemptId = attempt(peerId);
    const participantId = await owner.start({ requestId: challenge.nonce, providerPeerId: peerId, signal, channel, challenge, attemptId },
      () => transport.sendToPeer(peerId, challengeType, challenge));
    if (attemptId && sameBinding(channel, binding(peerId))) transport.observePeerAuthentication?.(peerId, attemptId);
    return participantId;
  };
  return Object.freeze({
    getVerified,
    verify: (peerId, signal) => verify(requests, peerId, signal),
    observe: (peerId, signal) => verify(observations, peerId, signal),
    retirePeer(peerId) { verified.delete(peerId); requests.retirePeer(peerId); observations.retirePeer(peerId); },
    close() { closed = true; verified.clear(); requests.close(); observations.close(); }
  });
}

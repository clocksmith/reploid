/** Fresh proof of a signing identity bound to the current WebRTC certificates. */
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey,
  getIdentitySignAlgorithm, encodeBytes, fromBase64Url, toBase64Url } from '../artifacts/identity.js';
import { createRemoteGenerationRequests } from './remote-generation-requests.js';

const challengeType = 'reploid:identity-challenge', proofType = 'reploid:identity-proof';
const sameBinding = (a, b) => !!a && !!b && a.local === b.local && a.remote === b.remote;
const signedBytes = (challenge, participantId) => encodeBytes(JSON.stringify([
  'reploid.mesh-recipient/v1', challenge.roomId, challenge.nonce,
  challenge.requester, challenge.provider, challenge.local, challenge.remote, participantId
]));

export function createMeshPeerIdentity({ transport, getIdentity, roomId, timeoutMs, maxPending }) {
  let closed = false;
  const signing = new Set();
  const requests = createRemoteGenerationRequests({ timeoutMs, maxPending, sendCancel() {} });
  const binding = peerId => transport.getPeerBinding?.(peerId) || null;
  const answer = async (peerId, input) => {
    if (closed || signing.has(peerId) || signing.size >= maxPending) return;
    const channel = binding(peerId), challenge = structuredClone(input);
    if (!channel || !challenge || challenge.roomId !== roomId || challenge.requester !== peerId
      || challenge.provider !== transport._getPeerId() || typeof challenge.nonce !== 'string'
      || !/^[a-f0-9-]{36}$/.test(challenge.nonce)
      || challenge.local !== channel.remote || challenge.remote !== channel.local) return;
    signing.add(peerId);
    try {
      const identity = getIdentity(), key = await importSigningKey(identity);
      const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(identity), key, signedBytes(challenge, identity.peerId));
      if (!closed && sameBinding(channel, binding(peerId))) transport.sendToPeer(peerId, proofType, {
        nonce: challenge.nonce, participantId: identity.peerId, publicJwk: identity.publicJwk,
        signature: toBase64Url(signature)
      });
    } finally { signing.delete(peerId); }
  };
  const accept = async (peerId, input) => {
    const pending = requests.get(input?.nonce, peerId);
    if (!pending || pending.processing) return;
    pending.processing = true;
    try {
      const proof = structuredClone(input);
      if (await createPeerIdFromPublicJwk(proof.publicJwk) !== proof.participantId) throw new Error('Recipient signing identity mismatch');
      const key = await importVerificationKey(proof.publicJwk);
      if (!await crypto.subtle.verify(getIdentitySignAlgorithm(proof.publicJwk), key,
        fromBase64Url(proof.signature), signedBytes(pending.challenge, proof.participantId))) throw new Error('Invalid recipient identity proof');
      if (!sameBinding(pending.channel, binding(peerId))) throw new Error('Recipient connection changed during verification');
      requests.settle(pending, { response: proof.participantId });
    } catch (error) { requests.settle(pending, { error }); }
  };
  transport.onMessage(challengeType, (peerId, payload) => { answer(peerId, payload).catch(() => {}); });
  transport.onMessage(proofType, (peerId, payload) => { accept(peerId, payload).catch(() => {}); });
  return Object.freeze({
    async verify(peerId, signal) {
      const channel = binding(peerId);
      if (!channel) return null;
      const challenge = { roomId, nonce: crypto.randomUUID(), requester: transport._getPeerId(), provider: peerId, ...channel };
      return requests.start({ requestId: challenge.nonce, providerPeerId: peerId, signal, channel, challenge },
        () => transport.sendToPeer(peerId, challengeType, challenge));
    },
    retirePeer: requests.retirePeer,
    close() { closed = true; requests.close(); }
  });
}

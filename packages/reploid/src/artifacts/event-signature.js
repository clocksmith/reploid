import { createPeerIdFromPublicJwk, importVerificationKey, getIdentitySignAlgorithm, fromBase64Url, encodeBytes } from './identity.js';

export async function verifyEventSignature(event, cryptoApi = globalThis.crypto) {
  if (!event?.signature?.publicJwk || !event?.signature?.value) return false;
  try {
    const signerId = await createPeerIdFromPublicJwk(event.signature.publicJwk, cryptoApi);
    if (signerId !== event.signature.signerId) return false;
    const key = await importVerificationKey(event.signature.publicJwk, cryptoApi);
    return cryptoApi.subtle.verify(
      getIdentitySignAlgorithm(event.signature),
      key,
      fromBase64Url(event.signature.value),
      encodeBytes(event.eventHash)
    );
  } catch {
    return false;
  }
}

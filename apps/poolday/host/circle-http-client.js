const metadataKeys = new Set(['hostPeerId','inviteId','requestId','modelIdentity','maxOutputTokens','conversationId']);

/** Authenticated browser/HTTP guest turn. The caller owns its draft while queued.
 * A signing transport can supply headers({path, method, body}) for each request;
 * body is the exact serialized body to which the request signature applies. */
export async function sendCircleChat({ origin = globalThis.location?.origin, metadata, requesterPeerId, prompt,
  headers = {}, fetchImpl = globalThis.fetch, signal }) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || !Object.keys(metadata).every(key => metadataKeys.has(key)) || !metadata.hostPeerId || !requesterPeerId
    || typeof prompt !== 'string' || !prompt.trim()) throw Error('A local draft and exact circle routing metadata are required');
  const base = new URL(origin);
  if (base.origin !== origin || !(base.protocol === 'https:' || (base.protocol === 'http:'
    && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) throw Error('Use a trusted HTTPS or loopback circle origin');
  // Snapshot the expected identity and scope. Caller edits during a queue wait
  // cannot change the authorized recipient or the budget for this attempt.
  const expected = {...metadata};
  async function post(path, data, grant, requestSignal, expiresAt) {
    const body = JSON.stringify(data);
    const auth = new Headers(typeof headers === 'function' ? await headers({path,method:'POST',body,signal:requestSignal}) : headers);
    auth.set('content-type','application/json');
    if (grant) { auth.set('x-circle-grant',grant); auth.set('x-circle-host',expected.hostPeerId); }
    requestSignal?.throwIfAborted();
    if (expiresAt !== undefined && Date.now() >= expiresAt) throw Error('Circle admission expired before prompt submission');
    return fetchImpl(new URL(path,base).href,{method:'POST',headers:auth,body,signal:requestSignal,redirect:'error',cache:'no-store'});
  }
  const admission = await post('/circle/admit',expected,null,signal);
  if (!admission.ok) return admission;
  const offer = await admission.json();
  const token = offer?.grant;
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw Error('Circle admission omitted its one-use grant');
  try {
    if (!offer.admitted || offer.hostPeerId !== expected.hostPeerId || offer.disclosure?.hostPeerId !== expected.hostPeerId
      || offer.requesterPeerId !== requesterPeerId || offer.requestId !== expected.requestId
      || offer.modelIdentity !== expected.modelIdentity || offer.maxOutputTokens !== expected.maxOutputTokens
      || !Number.isSafeInteger(offer.expiresAt) || Date.now() >= offer.expiresAt) throw Error('Circle admission no longer matches this turn');
    signal?.throwIfAborted();
    return await post('/circle/chat',{prompt},token,signal,offer.expiresAt);
  } catch (error) {
    // This closes only an unused offer; a dispatched request keeps its own settlement.
    await post('/circle/cancel',{},token,AbortSignal.timeout(1500)).catch(() => {});
    throw error;
  }
}

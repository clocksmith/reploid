import { canonicalize } from '../artifacts/canonical-json.js';
import { toBase64Url, fromBase64Url } from '../artifacts/identity.js';

/** Prove the existing private-room capability locally; never disclose the token. */
export function createRoomIntroductionAdmission({ roomId, token }) {
  if (typeof roomId !== 'string' || !roomId || typeof token !== 'string' || token.length < 32) {
    throw new Error('Private introduction room capability required');
  }
  const encoder = new TextEncoder();
  const key = crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const bytes = body => encoder.encode(canonicalize({ domain: 'reploid.room-admission/v1', contact: body }));
  return Object.freeze({
    async create(body) {
      if (body.roomId !== roomId) throw new Error('Private introduction namespace mismatch');
      return { schema: 'reploid.room-admission/v1', proof: toBase64Url(await crypto.subtle.sign('HMAC', await key, bytes(body))) };
    },
    async verify(record) {
      const { admission, ...body } = record?.body || {};
      if (body.roomId !== roomId || admission?.schema !== 'reploid.room-admission/v1' || typeof admission.proof !== 'string') return false;
      try { return await crypto.subtle.verify('HMAC', await key, fromBase64Url(admission.proof), bytes(body)); }
      catch { return false; }
    }
  });
}

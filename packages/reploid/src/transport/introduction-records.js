/** Signed endpoint contacts and end-to-end encrypted introduction records. */
import { canonicalize } from '../artifacts/canonical-json.js';
import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey,
  getIdentitySignAlgorithm, toBase64Url, fromBase64Url } from '../artifacts/identity.js';

const encode = value => new TextEncoder().encode(canonicalize(value));
const assert = (value, message) => { if (!value) throw new Error(message); };
export const CONTACT = 'reploid.contact/v1', SIGNAL = 'reploid.introduction/v1';

export function boundedSnapshot(value, limit) {
  const text = JSON.stringify(value);
  assert(typeof text === 'string' && new TextEncoder().encode(text).length <= limit, 'Introduction record exceeds allocation');
  return JSON.parse(text);
}

async function sign(body, identity) {
  return { body, publicJwk: identity.publicJwk,
    signature: toBase64Url(await crypto.subtle.sign(getIdentitySignAlgorithm(identity),
      await importSigningKey(identity), encode(body))) };
}
async function verify(record, participantId) {
  assert(record?.publicJwk && !record.publicJwk.d && typeof record.signature === 'string', 'Invalid introduction signature shape');
  assert(await createPeerIdFromPublicJwk(record.publicJwk) === participantId, 'Introduction identity mismatch');
  assert(await crypto.subtle.verify(getIdentitySignAlgorithm(record.publicJwk),
    await importVerificationKey(record.publicJwk), fromBase64Url(record.signature), encode(record.body)), 'Invalid introduction signature');
}
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
function lifetime(body, now, ttl, skew) {
  assert(Number.isSafeInteger(body.createdAt) && Number.isSafeInteger(body.expiresAt)
    && body.createdAt <= now + skew && body.expiresAt > now && body.expiresAt - body.createdAt <= ttl
    && body.expiresAt > body.createdAt, 'Expired or invalid introduction lifetime');
}
export async function createContact({ identity, peerId, roomId, sequence, policy, createAdmission, now = Date.now() }) {
  assert(await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId, 'Local introduction identity mismatch');
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const body = { schema: CONTACT, participantId: identity.peerId, peerId, roomId, sequence,
    createdAt: now, expiresAt: now + policy.contactTtlMs,
    encryptionKey: await crypto.subtle.exportKey('jwk', keys.publicKey) };
  if (createAdmission) body.admission = await createAdmission(structuredClone(body));
  return { record: await sign(body, identity), privateKey: keys.privateKey };
}
export async function verifyContact(input, { roomId, policy, now = Date.now() }) {
  const record = boundedSnapshot(input, policy.maxMessageBytes), body = record.body;
  assert(body?.schema === CONTACT && body.roomId === roomId && identifier(body.peerId)
    && identifier(body.participantId) && Number.isSafeInteger(body.sequence) && body.sequence >= 0,
  'Invalid introduction contact');
  lifetime(body, now, policy.contactTtlMs, policy.maxClockSkewMs);
  assert(body.encryptionKey?.kty === 'EC' && body.encryptionKey.crv === 'P-256' && !body.encryptionKey.d,
    'Invalid introduction encryption key');
  await crypto.subtle.importKey('jwk', body.encryptionKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  await verify(record, body.participantId);
  return record;
}
async function sharedKey(privateKey, publicJwk) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: publicKey }, privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function sealIntroduction({ identity, contact, recipient, payload, policy, now = Date.now() }) {
  const header = { schema: SIGNAL, roomId: contact.record.body.roomId, id: crypto.randomUUID(),
    from: contact.record.body.peerId, to: recipient.body.peerId, participantId: identity.peerId,
    recipientId: recipient.body.participantId, recipientSequence: recipient.body.sequence,
    createdAt: now, expiresAt: Math.min(now + policy.messageTtlMs, contact.record.body.expiresAt, recipient.body.expiresAt) };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sharedKey(contact.privateKey, recipient.body.encryptionKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encode(header) }, key, encode(payload));
  const record = await sign({ ...header, iv: toBase64Url(iv), ciphertext: toBase64Url(ciphertext), contact: contact.record }, identity);
  return boundedSnapshot(record, policy.maxMessageBytes);
}
export async function verifyIntroduction(input, { roomId, policy, now = Date.now() }) {
  const record = boundedSnapshot(input, policy.maxMessageBytes), body = record.body;
  assert(body?.schema === SIGNAL && body.roomId === roomId && identifier(body.id) && identifier(body.to)
    && identifier(body.recipientId) && typeof body.ciphertext === 'string'
    && typeof body.iv === 'string' && fromBase64Url(body.iv).length === 12, 'Invalid introduction envelope');
  lifetime(body, now, policy.messageTtlMs, policy.maxClockSkewMs);
  const contact = await verifyContact(body.contact, { roomId, policy, now });
  assert(contact.body.peerId === body.from && contact.body.participantId === body.participantId,
    'Introduction sender does not match contact');
  await verify(record, body.participantId);
  return record;
}
export async function openIntroduction(record, contact) {
  const { iv, ciphertext, contact: sender, ...header } = record.body;
  assert(header.to === contact.record.body.peerId && header.recipientId === contact.record.body.participantId
    && header.recipientSequence === contact.record.body.sequence, 'Introduction recipient changed');
  const key = await sharedKey(contact.privateKey, sender.body.encryptionKey);
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: encode(header) },
    key, fromBase64Url(ciphertext));
  return JSON.parse(new TextDecoder().decode(bytes));
}

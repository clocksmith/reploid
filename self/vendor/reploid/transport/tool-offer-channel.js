import { canonicalize } from '../artifacts/canonical-json.js';

export const TOOL_OFFER_MESSAGE = 'reploid:tool-offer';
export const TOOL_OFFER_ACK = 'reploid:tool-offer-ack';
const copy = value => JSON.parse(JSON.stringify(value));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const bytes = value => new TextEncoder().encode(value);
const digest = async value => 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(canonicalize(value))))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,180}$/.test(value);

/** Bounded, explicitly retried delivery. Acknowledgement means retained preview, never evaluation or adoption.
 * The host supplies a durable store and serialization lock. The connection remains borrowed.
 */
export function createToolOfferChannel({ peerId, roomId, policy, ports }) {
  policy = Object.freeze(copy(policy));
  assert(identifier(peerId) && identifier(roomId), 'Explicit peer and room identities are required');
  for (const key of ['maxBytes', 'maxRecords', 'maxPending', 'ttlMs', 'maxAttempts']) {
    assert(Number.isSafeInteger(policy[key]) && policy[key] > 0, 'Invalid transfer limit: ' + key);
  }
  let closed = false, pending = 0;
  const now = ports.now || Date.now;
  const load = async () => (await ports.load()) || { schema: 'reploid.tool-transfers/v1', inbox: [], outbox: [] };
  const commit = async state => {
    assert(!closed, 'Candidate channel is closed');
    await ports.save(copy(state)); ports.onChange?.(copy(state));
  };
  const transact = operation => {
    assert(!closed, 'Candidate channel is closed');
    assert(pending < policy.maxPending, 'Candidate channel is busy');
    pending++;
    return Promise.resolve().then(() => ports.lock(async () => {
      assert(!closed, 'Candidate channel is closed'); return operation(await load());
    })).finally(() => pending--);
  };
  const validate = async (remote, envelope) => {
    assert(envelope && Object.keys(envelope).sort().join(',') === 'bytes,createdAt,expiresAt,offerHash,recipient,roomId,schema,sender,targetContract,targetId,text,transferId', 'Malformed transfer');
    assert(envelope.schema === 'reploid.tool-transfer/v1' && envelope.roomId === roomId
      && envelope.sender === remote && envelope.recipient === peerId && remote !== peerId
      && identifier(remote) && identifier(envelope.transferId) && identifier(envelope.targetId), 'Transfer identity mismatch');
    assert(Number.isSafeInteger(envelope.createdAt) && Number.isSafeInteger(envelope.expiresAt)
      && envelope.createdAt <= now() && envelope.expiresAt > now()
      && envelope.expiresAt - envelope.createdAt > 0 && envelope.expiresAt - envelope.createdAt <= policy.ttlMs, 'Transfer expired or invalid lifetime');
    assert(typeof envelope.text === 'string' && envelope.bytes === bytes(envelope.text).byteLength
      && envelope.bytes <= policy.maxBytes && hashPattern.test(envelope.targetContract), 'Transfer size or contract is invalid');
    assert(envelope.offerHash === await digest(envelope.text), 'Transfer content hash does not match');
    return digest(envelope);
  };
  const acknowledge = async record => {
    assert(!closed, 'Candidate channel is closed');
    return ports.send(record.sender, TOOL_OFFER_ACK, {
    schema: 'reploid.tool-transfer-ack/v1', roomId, sender: peerId, recipient: record.sender,
    transferId: record.transferId, envelopeHash: record.envelopeHash, status: record.status,
    reason: record.reason || ''
    });
  };
  const dispatch = async (state, record) => {
    assert(record.envelope.sender === peerId && record.envelope.expiresAt > now(), 'Transfer expired or belongs to another sender');
    assert(record.attempts < policy.maxAttempts, 'Transfer retry limit reached');
    assert(await ports.authorize({ action: 'offer.send', envelope: copy(record.envelope) }) === true, 'Host denied candidate sending');
    record.attempts++; record.status = 'sending'; record.error = null;
    await commit(state);
    assert(!closed, 'Candidate channel is closed');
    try { assert(await ports.send(record.envelope.recipient, TOOL_OFFER_MESSAGE, copy(record.envelope)) === true, 'Peer connection is unavailable'); }
    catch (error) { record.status = 'interrupted'; record.error = String(error.message || error); await commit(state); }
    return copy(record);
  };
  return Object.freeze({
    async list() { return copy(await load()); },
    async send({ recipient, targetId, targetContract, text }) {
      assert(identifier(recipient) && recipient !== peerId && identifier(targetId) && hashPattern.test(targetContract), 'Invalid candidate destination or contract');
      assert(typeof text === 'string' && bytes(text).byteLength <= policy.maxBytes, 'Candidate exceeds peer transfer allowance');
      const createdAt = now();
      const envelope = { schema: 'reploid.tool-transfer/v1', transferId: crypto.randomUUID(), sender: peerId, recipient, roomId,
        createdAt, expiresAt: createdAt + policy.ttlMs, bytes: bytes(text).byteLength, targetId, targetContract, text, offerHash: await digest(text) };
      const envelopeHash = await digest(envelope);
      return transact(async state => {
        assert(state.inbox.length + state.outbox.length < policy.maxRecords, 'Candidate transfer history is full');
        const record = { envelope, envelopeHash, attempts: 0, status: 'sending', error: null };
        state.outbox.push(record); return dispatch(state, record);
      });
    },
    retry(transferId) {
      return transact(async state => {
        const record = state.outbox.find(item => item.envelope.transferId === transferId);
        assert(record && ['sending', 'interrupted'].includes(record.status), 'Transfer cannot be retried');
        return dispatch(state, record);
      });
    },
    async receive(remote, type, payload) {
      // Snapshot untrusted data before any await. Do not let transport callbacks mutate an in-flight validation.
      const message = copy(payload);
      return transact(async state => {
        if (type === TOOL_OFFER_ACK) {
          const record = state.outbox.find(item => item.envelope.transferId === message.transferId);
          assert(record && message.schema === 'reploid.tool-transfer-ack/v1' && message.roomId === roomId
            && remote === record.envelope.recipient && message.sender === remote && message.recipient === peerId
            && message.envelopeHash === record.envelopeHash && ['received', 'refused'].includes(message.status)
            && typeof message.reason === 'string' && message.reason.length <= 256, 'Invalid candidate acknowledgement');
          if (['received', 'refused'].includes(record.status)) {
            assert(record.status === message.status, 'Conflicting candidate acknowledgement'); return;
          }
          record.status = message.status; record.reason = message.reason; record.acknowledgedAt = now();
          await commit(state); return;
        }
        assert(type === TOOL_OFFER_MESSAGE, 'Unsupported candidate message');
        const envelopeHash = await validate(remote, message);
        const existing = state.inbox.find(item => item.sender === remote && item.transferId === message.transferId);
        if (existing) {
          assert(existing.envelopeHash === envelopeHash, 'Conflicting candidate redelivery');
          await acknowledge(existing); return;
        }
        const record = { transferId: message.transferId, sender: remote, recipient: peerId, roomId, envelopeHash,
          receivedAt: now(), status: 'refused', reason: '', envelope: null };
        if (state.inbox.length + state.outbox.length >= policy.maxRecords) {
          record.reason = 'Candidate transfer history is full'; await acknowledge(record); return;
        }
        try {
          assert(await ports.authorize({ action: 'offer.receive', envelope: copy(message) }) === true, 'Recipient is not accepting candidates');
          await ports.validateOffer(copy(message));
          assert(await ports.authorize({ action: 'offer.receive', envelope: copy(message) }) === true, 'Recipient is not accepting candidates');
          record.status = 'received'; record.envelope = message;
        } catch (error) { record.reason = String(error.message || error).slice(0, 256); }
        state.inbox.push(record); await commit(state);
        await acknowledge(record);
      });
    },
    dismiss(transferId) {
      return transact(async state => {
        const record = state.inbox.find(item => item.transferId === transferId);
        assert(record && record.status === 'received', 'Received candidate not found');
        record.dismissed = true; await commit(state);
      });
    },
    close() { closed = true; }
  });
}

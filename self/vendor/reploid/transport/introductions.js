import defaults from './introduction-policy.json' with { type: 'json' };
import { freezeJson } from '../config/index.js';
import { boundedSnapshot, createContact, verifyContact, sealIntroduction,
  verifyIntroduction, openIntroduction } from './introduction-records.js';

export const INTRODUCTION_CONTACT = 'reploid:introduction-contact';
export const INTRODUCTION_SIGNAL = 'reploid:introduction-signal';
const assert = (value, message) => { if (!value) throw new Error(message); };
const fingerprint = description => {
  const values = [...new Set((description?.sdp || '').split(/\r?\n/)
    .filter(line => /^a=fingerprint:sha-256 /i.test(line)).map(line => line.slice(14).trim().toLowerCase()))];
  return values.length === 1 && /^sha-256 (?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/.test(values[0]) ? values[0] : null;
};

/** One-hop introductions. The host grants admission/forwarding independently of compute. */
export async function createPeerIntroductions({ transport, identity, roomId, authorize, createAdmission, policy = defaults,
  now = Date.now, onError = () => {} }) {
  policy = freezeJson(structuredClone(policy));
  assert(policy.schema === defaults.schema && Object.keys(defaults).every(key => key === 'schema'
    || Number.isSafeInteger(policy[key]) && policy[key] > 0), 'Invalid introduction policy');
  assert(typeof authorize === 'function', 'Introduction authorization is required');
  identity = structuredClone(identity);
  const peerId = transport._getPeerId();
  const contacts = new Map(), attempts = new Map(), seen = new Map();
  let closed = false, contact = await createContact({ identity, peerId, roomId, sequence: now(), policy, createAdmission, now: now() });
  let inFlight = 0, windowStart = now(), windowCount = 0;
  const alive = () => assert(!closed, 'Introductions are closed');
  const permitted = async (action, details) => {
    alive();
    assert(await authorize(freezeJson({ action, roomId, ...structuredClone(details) })) === true,
      `Introduction ${action} denied`);
    alive();
  };
  const prune = () => {
    for (const [key, value] of seen) if (value <= now()) seen.delete(key);
    for (const [key, value] of contacts) if (value.record.body.expiresAt <= now()) contacts.delete(key);
    for (const [key, value] of attempts) if (value.expiresAt <= now()) {
      attempts.delete(key); if (!value.established) transport.cancelIntroduction?.(key, value.id);
    }
  };
  async function bounded(operation) {
    alive(); prune();
    if (now() - windowStart >= policy.windowMs) { windowStart = now(); windowCount = 0; }
    assert(inFlight < policy.maxPending && windowCount < policy.maxMessagesPerWindow, 'Introduction rate limit');
    inFlight++; windowCount++;
    try { return await operation(); } finally { inFlight--; }
  }
  async function retain(input, route) {
    const record = await verifyContact(input, { roomId, policy, now: now() });
    alive();
    assert(record.body.peerId !== peerId, 'Self introduction');
    await permitted('admit', { contact: record });
    const previous = contacts.get(record.body.peerId);
    if (previous) {
      assert(previous.record.body.participantId === record.body.participantId, 'Contact identity collision');
      assert(record.body.sequence >= previous.record.body.sequence, 'Stale contact sequence');
      if (record.body.sequence === previous.record.body.sequence) {
        assert(JSON.stringify(record.body) === JSON.stringify(previous.record.body), 'Contact sequence collision');
      }
    }
    assert(previous || contacts.size < policy.maxContacts, 'Contact allocation exhausted');
    contacts.set(record.body.peerId, { record, route });
    return record;
  }
  const directRoute = via => envelope => transport.sendToPeer(via, INTRODUCTION_SIGNAL, envelope);
  async function publish(remote, payload, route) {
    alive();
    const recipient = contacts.get(remote)?.record;
    assert(recipient && recipient.body.expiresAt > now() && contact.record.body.expiresAt > now(), 'Contact expired');
    await permitted('connect', { contact: recipient });
    const record = await sealIntroduction({ identity, contact, recipient, payload, policy, now: now() });
    await permitted('connect', { contact: recipient });
    assert(await route({ record, forwarded: false }) !== false, 'Introduction route unavailable');
    alive();
  }
  function exchange(remote, attempt) {
    return { attemptId: attempt.id, isActive: () => !closed && attempts.get(remote) === attempt, publish(message) {
      const payload = { ...boundedSnapshot(message, policy.maxMessageBytes), attemptId: attempt.id };
      // Preserve offer/answer/candidate order even when signing completes asynchronously.
      attempt.sending = attempt.sending.then(async () => {
        alive(); assert(attempts.get(remote) === attempt, 'Introduction attempt superseded');
        await publish(remote, payload, attempt.route);
      });
      attempt.sending.catch(error => { if (!closed) onError(error); });
      return attempt.sending;
    } };
  }
  function allocate(remote, id, route) {
    assert(attempts.has(remote) || attempts.size < policy.maxPending, 'Introduction attempt allocation exhausted');
    const attempt = { id, route, expiresAt: now() + policy.messageTtlMs, sending: Promise.resolve() };
    attempts.set(remote, attempt);
    return attempt;
  }
  async function connectRecord(record, route, signal) {
    signal?.throwIfAborted();
    if (transport.getConnectedPeers().some(peer => peer.id === record.body.peerId) || attempts.has(record.body.peerId)) return;
    assert(transport.getConnectedPeers().length < policy.maxContacts, 'Connected peer allocation exhausted');
    await permitted('connect', { contact: record });
    signal?.throwIfAborted();
    if (attempts.has(record.body.peerId)) return;
    const remote = record.body.peerId, attempt = allocate(remote, crypto.randomUUID(), route);
    const aborted = () => {
      if (attempts.get(remote) !== attempt) return;
      attempts.delete(remote); transport.cancelIntroduction?.(remote, attempt.id);
    };
    signal?.addEventListener('abort', aborted, { once: true });
    try { await transport.connectIntroducedPeer(remote, exchange(remote, attempt)); signal?.throwIfAborted(); }
    catch (error) { if (attempts.get(remote) === attempt) attempts.delete(remote); throw error; }
    finally { signal?.removeEventListener('abort', aborted); }
  }
  async function receiveSignal(via, input, replyRoute) {
    assert(input?.forwarded === false || input?.forwarded === true, 'Invalid introduction route');
    const record = await verifyIntroduction(input.record, { roomId, policy, now: now() });
    alive();
    const { body } = record;
    assert(!seen.has(body.id), 'Replayed introduction');
    assert(seen.size < policy.maxMessagesPerWindow, 'Introduction replay allocation exhausted');
    seen.set(body.id, body.expiresAt);
    if (body.to !== peerId) {
      assert(!input.forwarded && via === body.from && body.to !== via, 'Introduction forwarding limit');
      assert(transport.getConnectedPeers().some(peer => peer.id === body.to), 'Introduction recipient unavailable');
      await permitted('forward', { from: body.contact, to: body.to });
      alive();
      assert(transport.sendToPeer(body.to, INTRODUCTION_SIGNAL, { record, forwarded: true }), 'Introduction forwarding failed');
      return;
    }
    const remote = body.from, route = replyRoute || directRoute(via);
    await retain(body.contact, route);
    const payload = await openIntroduction(record, contact);
    alive();
    assert(typeof payload.attemptId === 'string' && /^[a-f0-9-]{36}$/.test(payload.attemptId)
      && ['offer', 'answer', 'ice-candidate'].includes(payload.type), 'Invalid introduction negotiation');
    if (payload.type !== 'ice-candidate') assert(fingerprint(payload[payload.type]), 'Missing unique WebRTC certificate fingerprint');
    // Admission of a contact does not preserve a revoked connection grant.
    await permitted('connect', { contact: body.contact });
    let attempt = attempts.get(remote);
    if (attempt && attempt.id !== payload.attemptId) {
      // One deterministic initiator survives simultaneous introductions.
      assert(payload.type === 'offer' && peerId > remote, 'Introduction attempt collision');
      transport.cancelIntroduction?.(remote, attempt.id); attempts.delete(remote); attempt = null;
    }
    if (!attempt) {
      assert(payload.type === 'offer' || payload.type === 'ice-candidate', 'Unsolicited introduction answer');
      assert(transport.getConnectedPeers().length < policy.maxContacts, 'Connected peer allocation exhausted');
      attempt = allocate(remote, payload.attemptId, route);
    }
    assert(attempt.expiresAt > now(), 'Introduction attempt expired');
    await transport.acceptIntroductionSignal(remote, payload, exchange(remote, attempt));
  }
  async function receiveContact(via, input) {
    assert(typeof input?.forwarded === 'boolean', 'Invalid contact route');
    assert(input.forwarded || input.contact?.body?.peerId === via, 'Contact source mismatch');
    const record = await retain(input.contact, directRoute(via));
    if (!input.forwarded) {
      for (const peer of transport.getConnectedPeers()) {
        if (peer.id === via) continue;
        try {
          await permitted('forward', { from: record, to: peer.id });
          transport.sendToPeer(peer.id, INTRODUCTION_CONTACT, { contact: record, forwarded: true });
          const other = contacts.get(peer.id)?.record;
          if (other) {
            await permitted('forward', { from: other, to: via });
            transport.sendToPeer(via, INTRODUCTION_CONTACT, { contact: other, forwarded: true });
          }
        } catch (error) { onError(error); }
      }
    } else if (peerId < record.body.peerId) await connectRecord(record, directRoute(via));
  }
  const receive = (via, type, value, replyRoute) => {
    // Snapshot before the first asynchronous authority check.
    const input = boundedSnapshot(value, policy.maxMessageBytes);
    return bounded(() => type === INTRODUCTION_CONTACT ? receiveContact(via, input)
      : type === INTRODUCTION_SIGNAL ? receiveSignal(via, input, replyRoute) : Promise.reject(new Error('Unknown introduction message')));
  };
  transport.onMessage(INTRODUCTION_CONTACT, (via, value) => { receive(via, INTRODUCTION_CONTACT, value).catch(onError); });
  transport.onMessage(INTRODUCTION_SIGNAL, (via, value) => { receive(via, INTRODUCTION_SIGNAL, value).catch(onError); });
  return Object.freeze({
    exportContact() { alive(); return structuredClone(contact.record); },
    async announce(remote) {
      alive(); prune();
      await permitted('announce', { to: remote });
      if (contact.record.body.expiresAt <= now() + policy.messageTtlMs) {
        assert(attempts.size === 0, 'Cannot rotate contact during negotiation');
        const next = await createContact({ identity, peerId, roomId, sequence: Math.max(now(), contact.record.body.sequence + 1), policy, createAdmission, now: now() });
        alive(); contact = next;
      }
      transport.sendToPeer(remote, INTRODUCTION_CONTACT, { contact: contact.record, forwarded: false });
    },
    async connect(input, route, signal) {
      signal?.throwIfAborted();
      assert(typeof route === 'function', 'Reachable introduction route required');
      return bounded(async () => { const record = await retain(input, route); await connectRecord(record, route, signal); });
    },
    receive,
    cancelPending(remote) {
      const attempt = attempts.get(remote);
      if (attempt && !attempt.established) { transport.cancelIntroduction?.(remote, attempt.id); attempts.delete(remote); }
    },
    retirePeer(remote, attemptId) {
      const attempt = attempts.get(remote);
      if (!attempt || !attemptId || attempt.id === attemptId) { contacts.delete(remote); attempts.delete(remote); }
    },
    settled(remote) { const attempt = attempts.get(remote); if (attempt) attempt.established = true; },
    getState: () => ({ contacts: contacts.size, pending: attempts.size, closed }),
    close() {
      closed = true;
      for (const [remote, attempt] of attempts) {
        if (!attempt.established) transport.cancelIntroduction?.(remote, attempt.id);
      }
      contacts.clear(); attempts.clear(); seen.clear();
    }
  });
}

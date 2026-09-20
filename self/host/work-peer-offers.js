import { createToolOfferChannel, TOOL_OFFER_MESSAGE, TOOL_OFFER_ACK } from '../vendor/reploid/transport/index.js';
import policy from '../config/work-evolution.json' with { type: 'json' };

/** Application custody and consent; transport never gets an evaluation or adoption port. */
export function createWorkPeerOffers({ storage, evolution, roomId, getTransport, onChange, locks = navigator.locks }) {
  const key = policy.peerOffers.storageKey + ':' + roomId;
  let channel = null, snapshot = { inbox: [], outbox: [] }, accepting = false, permission = null;
  let peerId = null, releaseIdentity = null, error = '', sending = false;
  const notify = () => onChange?.();
  const requireChannel = () => { if (!channel) throw new Error('Connect peers before exchanging candidates'); return channel; };
  const getState = () => ({ ...JSON.parse(JSON.stringify(snapshot)), accepting, error, peerId,
    peers: (getTransport()?.getConnectedPeers() || []).filter(peer => peer.metadata?.transport !== 'signaling-relay'),
    maxBytes: policy.peerOffers.maxBytes, maxAttempts: policy.peerOffers.maxAttempts });
  const isConnected = remote => getTransport()?.getConnectedPeers().some(peer => peer.id === remote && peer.metadata?.transport !== 'signaling-relay');
  return Object.freeze({ getState,
    async acquire() {
      peerId = storage.getItem(key + ':identity');
      if (!peerId) { peerId = crypto.randomUUID(); storage.setItem(key + ':identity', peerId); }
      await new Promise((resolve, reject) => {
        locks.request('reploid:tool-peer:' + peerId, { ifAvailable: true }, async lock => {
          if (!lock) { reject(new Error('Another tab owns this peer connection')); return; }
          await new Promise(release => { releaseIdentity = release; resolve(); });
        }).catch(reject);
      });
      return peerId;
    },
    async attach() {
      const transport = getTransport();
      channel = createToolOfferChannel({ peerId, roomId, policy: policy.peerOffers, ports: {
        load: async () => { const text = storage.getItem(key); return text ? JSON.parse(text) : null; },
        save: async value => {
          const text = JSON.stringify(value);
          if (new TextEncoder().encode(text).byteLength > policy.peerOffers.maxStoredBytes) throw new Error('Candidate transfer history is full');
          storage.setItem(key, text);
        },
        lock: operation => locks.request(key, operation),
        onChange: state => { snapshot = state; notify(); },
        authorize: async ({ action, envelope }) => action === 'offer.receive' ? accepting && isConnected(envelope.sender)
          : permission?.recipient === envelope.recipient && permission?.text === envelope.text && isConnected(envelope.recipient),
        validateOffer: async envelope => {
          const offer = await evolution.inspectOffer(envelope.text);
          if (offer.targetId !== envelope.targetId || await evolution.describeContract(offer.targetId) !== envelope.targetContract) {
            throw new Error('Target contract does not match this device');
          }
        },
        send: (remote, type, payload) => transport.sendToPeer(remote, type, payload)
      } });
      snapshot = await channel.list();
      for (const type of [TOOL_OFFER_MESSAGE, TOOL_OFFER_ACK]) transport.onMessage(type, (remote, payload) => {
        if (!channel) return;
        channel.receive(remote, type, payload).catch(cause => { error = cause.message; notify(); });
      });
      notify();
    },
    allowReceiving(allowed) { if (allowed === true) requireChannel(); accepting = allowed === true; notify(); },
    async send(candidateId, recipient) {
      const endpoint = requireChannel();
      if (sending) throw new Error('A candidate transfer is already being sent');
      sending = true;
      try {
        const offer = await evolution.exportOffer(candidateId), text = JSON.stringify(offer);
        permission = { recipient, text };
        return await endpoint.send({ recipient, targetId: offer.targetId, targetContract: await evolution.describeContract(offer.targetId), text });
      } finally { permission = null; sending = false; }
    },
    async retry(transferId) {
      const endpoint = requireChannel();
      if (sending) throw new Error('A candidate transfer is already being sent');
      const record = snapshot.outbox.find(item => item.envelope.transferId === transferId);
      if (!record) throw new Error('Candidate transfer not found');
      sending = true;
      permission = { recipient: record.envelope.recipient, text: record.envelope.text };
      try { return await endpoint.retry(transferId); } finally { permission = null; sending = false; }
    },
    async preview(transferId) {
      const record = snapshot.inbox.find(item => item.transferId === transferId);
      if (!record?.envelope || record.dismissed) throw new Error('Candidate preview not found');
      const { envelope } = record;
      if (await evolution.describeContract(envelope.targetId) !== envelope.targetContract) throw new Error('Target contract changed');
      const offer = await evolution.inspectOffer(envelope.text);
      return { text: envelope.text, offer, provenance: { transferId, sender: record.sender, recipient: record.recipient,
        roomId, envelopeHash: record.envelopeHash, receivedAt: record.receivedAt, targetContract: envelope.targetContract } };
    },
    dismiss(transferId) { return requireChannel().dismiss(transferId); },
    close() { channel?.close(); channel = null; accepting = false; permission = null; releaseIdentity?.(); releaseIdentity = null; notify(); }
  });
}

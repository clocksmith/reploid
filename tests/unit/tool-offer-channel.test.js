import { describe, it, expect } from 'vitest';
import { createToolOfferChannel, TOOL_OFFER_MESSAGE, TOOL_OFFER_ACK } from '../../packages/reploid/src/transport/tool-offer-channel.js';
const contract = 'sha256:' + 'a'.repeat(64);
const policy = { maxBytes: 1024, maxRecords: 8, maxPending: 4, ttlMs: 5000, maxAttempts: 3 };

function fixture({ validation = async () => {} } = {}) {
  const stores = {}, nodes = {}, messages = [];
  let time = 1000, online = true, accepting = true, failSave = false, denied = false;
  function node(id) {
    let queue = Promise.resolve();
    nodes[id] = createToolOfferChannel({ peerId: id, roomId: 'room', policy, ports: {
      load: async () => stores[id] ? structuredClone(stores[id]) : null,
      save: async value => { if (failSave && id === 'b') throw new Error('Storage full'); stores[id] = structuredClone(value); },
      lock: operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; },
      now: () => time,
      authorize: async ({ action }) => action === 'offer.receive' ? accepting : !denied,
      validateOffer: async envelope => { if (envelope.targetContract !== contract) throw new Error('Wrong target contract'); await validation(); },
      send: (remote, type, payload) => { if (!online) return false; messages.push({ sender: id, remote, type, payload: structuredClone(payload) }); return true; }
    } });
    return nodes[id];
  }
  const flush = async () => { while (messages.length) { const message = messages.shift(); await nodes[message.remote].receive(message.sender, message.type, message.payload); } };
  const a = node('a'), b = node('b');
  const send = () => a.send({ recipient: 'b', targetId: 'FormatJson', targetContract: contract, text: '{"untrusted":"candidate"}' });
  return { a, b, node, nodes, stores, messages, flush, send, time: value => { time = value; }, online: value => { online = value; },
    accepting: value => { accepting = value; }, failSave: value => { failSave = value; }, deny: () => { denied = true; } };
}

describe('durable candidate preview delivery', () => {
  it('does not retain an offer after consent withdrawal or acknowledge after closing during validation', async () => {
    for (const close of [false, true]) {
      let enter, release;
      const entered = new Promise(resolve => { enter = resolve; });
      const pending = new Promise(resolve => { release = resolve; });
      const f = fixture({ validation: async () => { enter(); await pending; } });
      await f.send(); const message = f.messages.shift();
      const received = f.b.receive('a', message.type, message.payload);
      await entered;
      if (close) f.b.close(); else f.accepting(false);
      release();
      if (close) {
        await expect(received).rejects.toThrow('closed');
        expect(f.messages).toHaveLength(0);
        expect((await f.b.list()).inbox).toHaveLength(0);
      } else {
        await received;
        expect((await f.b.list()).inbox[0]).toMatchObject({ status: 'refused', envelope: null });
      }
    }
  });
  it('retains one preview across duplicate delivery and restart, with a receipt that grants no approval', async () => {
    const f = fixture(), record = await f.send(), first = structuredClone(f.messages[0]);
    await f.flush();
    expect((await f.a.list()).outbox[0].status).toBe('received');
    expect((await f.b.list()).inbox[0]).toMatchObject({ status: 'received', envelopeHash: record.envelopeHash });
    f.b.close(); const restarted = f.node('b');
    await restarted.receive(first.sender, first.type, first.payload); await f.flush();
    expect((await restarted.list()).inbox).toHaveLength(1);
    expect((await restarted.list()).inbox[0]).not.toHaveProperty('adopted');
    await restarted.dismiss(record.envelope.transferId);
    expect((await restarted.list()).inbox[0].dismissed).toBe(true);
  });
  it('retries interrupted delivery and lost acknowledgement using the original identity', async () => {
    const f = fixture(); f.online(false); const record = await f.send();
    expect(record.status).toBe('interrupted');
    f.online(true); await f.a.retry(record.envelope.transferId);
    const message = f.messages.shift(); await f.b.receive(message.sender, message.type, message.payload);
    f.messages.length = 0; // receipt lost after the recipient committed
    f.a.close(); const restarted = f.node('a'); await restarted.retry(record.envelope.transferId); await f.flush();
    expect((await restarted.list()).outbox[0]).toMatchObject({ status: 'received', attempts: 3 });
    expect((await f.b.list()).inbox).toHaveLength(1);
  });
  it('refuses recipients that did not opt in and incompatible contracts without retaining code', async () => {
    const f = fixture(); f.accepting(false); await f.send(); await f.flush();
    expect((await f.b.list()).inbox[0]).toMatchObject({ status: 'refused', envelope: null });
    expect((await f.a.list()).outbox[0].status).toBe('refused');
    f.accepting(true);
    await f.a.send({ recipient: 'b', targetId: 'FormatJson', targetContract: 'sha256:' + 'b'.repeat(64), text: '{}' });
    await f.flush(); expect((await f.b.list()).inbox[1].reason).toBe('Wrong target contract');
  });
  it('rejects changed bytes, destinations, rooms, senders and conflicting redelivery', async () => {
    const f = fixture(); await f.send(); const message = f.messages.shift();
    for (const patch of [{ text: 'tampered' }, { recipient: 'c' }, { roomId: 'other' }, { sender: 'c' }, { expiresAt: 999 }]) {
      await expect(f.b.receive('a', TOOL_OFFER_MESSAGE, { ...message.payload, ...patch })).rejects.toThrow();
    }
    expect((await f.b.list()).inbox).toHaveLength(0);
    await f.b.receive('a', TOOL_OFFER_MESSAGE, message.payload);
    await expect(f.b.receive('a', TOOL_OFFER_MESSAGE, { ...message.payload, targetId: 'Other' })).rejects.toThrow('Conflicting');
    expect((await f.b.list()).inbox).toHaveLength(1);
  });
  it('does not acknowledge failed persistence or accept a wrong-recipient acknowledgement', async () => {
    const f = fixture(), record = await f.send(), message = f.messages.shift();
    f.failSave(true); await expect(f.b.receive('a', message.type, message.payload)).rejects.toThrow('Storage full');
    expect(f.messages).toHaveLength(0); expect((await f.b.list()).inbox).toHaveLength(0);
    f.failSave(false); await f.a.retry(record.envelope.transferId);
    const retry = f.messages.shift(); await f.b.receive('a', retry.type, retry.payload);
    const ack = f.messages.shift();
    await expect(f.a.receive('c', TOOL_OFFER_ACK, ack.payload)).rejects.toThrow('Invalid');
    await expect(f.a.receive('b', TOOL_OFFER_ACK, { ...ack.payload, envelopeHash: contract })).rejects.toThrow('Invalid');
    await f.a.receive('b', TOOL_OFFER_ACK, ack.payload);
    expect((await f.a.list()).outbox[0].status).toBe('received');
  });
  it('enforces authorization, expiration, bounded retries, payload size and close', async () => {
    const f = fixture(); f.online(false); const record = await f.send();
    await f.a.retry(record.envelope.transferId); await f.a.retry(record.envelope.transferId);
    await expect(f.a.retry(record.envelope.transferId)).rejects.toThrow('retry limit');
    f.time(7000); await expect(f.a.retry(record.envelope.transferId)).rejects.toThrow('expired');
    await expect(f.a.send({ recipient: 'b', targetId: 'FormatJson', targetContract: contract, text: 'x'.repeat(1025) })).rejects.toThrow('allowance');
    f.deny(); await expect(f.send()).rejects.toThrow('Host denied');
    f.a.close(); await expect(f.send()).rejects.toThrow('closed');
  });
});

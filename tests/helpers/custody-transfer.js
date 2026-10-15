// A real custody transfer between two library exchanges over a fake transport and data
// channel, on the reward fixture clock. Test-only sizes and limits.
import { expect, vi } from 'vitest';

import { createCustodyKeyCertifier } from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { createCustodyContracts } from '../../packages/reploid/src/artifacts/custody/runtime.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex, signCanonical, verifyCanonicalSignature } from '../../packages/reploid/src/artifacts/signatures.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { executablePacksMatch, hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { MIN, fx } from './reward-fixture.js';

const contracts = createCustodyContracts({ hashDopplerEvidence, validateExecutablePack, executablePacksMatch, sha256Hex, signCanonical, verifyCanonicalSignature });
export const PIECE_BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function channelPair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [i, channel] of channels.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  return channels;
}

/**
 * Exchange 0 acquires PIECE_BYTES from exchange 1. `identities[i]` certifies that exchange's
 * custody key; null leaves it uncertified. Returns the requester's delivery record, the
 * supplier's record and the acquirer's custody key.
 */
export async function transferPiece(identities) {
  const file = { path: 'piece.bin', role: 'model-weights', sizeBytes: PIECE_BYTES.length, hash: (await sha256Hex(PIECE_BYTES)).slice(7), hashAlgorithm: 'sha256' };
  const policy = { maxTransfers: 2, maxPeers: 4, maxAcquisitionAttempts: 2, maxSupplyBytes: 100, maxArtifactBytes: 20, maxInventoryFiles: 8, grantMs: 5 * MIN,
    channel: { maxFrameBytes: 128, maxControlBytes: 4096, maxChunkBytes: 2, maxBufferedBytes: 8192, maxPendingRequests: 2, maxTransferBytes: 1 << 20, timeoutMs: 1000 } };
  const handlers = [new Map(), new Map()], callbacks = [], keys = [], deliveries = [], owners = [];
  for (const i of [0, 1]) {
    const pair = await createSigningKeyPair();
    keys[i] = { peerId: `transport-${i}`, publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey };
    const certifier = identities[i] && createCustodyKeyCertifier({ identity: identities[i], now: () => fx.nowMs });
    let reserved = 0;
    const transport = {
      _getPeerId: () => keys[i].peerId,
      getConnectedPeers: () => [{ id: `transport-${1 - i}` }],
      onMessage: (type, handler) => handlers[i].set(type, handler),
      sendToPeer: (peer, type, payload) => { queueMicrotask(() => handlers[1 - i].get(type)?.(keys[i].peerId, structuredClone(payload))); return true; },
      broadcast(type, payload) { this.sendToPeer(`transport-${1 - i}`, type, payload); },
      onDataChannel: (_, callback) => { callbacks[i] = callback; return () => {}; },
      openDataChannel() { const [left, right] = channelPair(); callbacks[1 - i](keys[i].peerId, right); return left; }
    };
    owners.push(createCustodyExchange({ transport, identity: keys[i], policy, ports: {
      now: () => fx.nowMs,
      supplyBudget: { getState: () => ({ reservedBytes: reserved, maxBytes: 100 }), async reserve(bytes) { reserved += bytes; return this.getState(); } },
      createSupplier: contracts.createPeerPackSupplier, createStore: contracts.createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
      readArtifact: async () => PIECE_BYTES.slice(),
      async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== 'sha256:' + descriptor.hash) throw new Error('integrity'); },
      hash: hashDopplerEvidence, hashBytes: sha256Hex,
      observeDelivery: (record) => deliveries.push(record),
      ...(certifier ? { certificate: () => certifier.certify({ custodyPeerId: keys[i].peerId, custodyPublicKey: keys[i].publicKey }) } : {})
    } }));
  }
  try {
    owners[1].offer([file]);
    await vi.waitFor(() => expect(owners[0].has(file)).toBe(true));
    await owners[0].acquire(file, { signal: new AbortController().signal });
  } finally { await Promise.all(owners.map((owner) => owner.close())); }
  return { record: deliveries.find((row) => row.role === 'requester'), supplierRecord: deliveries.find((row) => row.role === 'supplier'), acquirerKey: keys[0] };
}

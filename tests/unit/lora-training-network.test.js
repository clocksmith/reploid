import { afterEach, expect, it, vi } from 'vitest';
import { createTrainingNetwork } from '../../packages/reploid/src/training/network.js';
import { createTrainingSession } from '../../packages/reploid/src/training/session.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import policy from '../../self/config/lora-training.json';
const closers = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });
function fixture({ allowed = () => true, receive = async input => ({ data: input.body, participant: input.remoteParticipantId }) } = {}) {
  const ids = ['peer:' + 'a'.repeat(24), 'peer:' + 'b'.repeat(24)], listeners = [new Map(), new Map()];
  const networks = ids.map((id, side) => createTrainingNetwork({ policy, localParticipantId: id,
    allowed: peer => allowed(peer, side), receive: input => receive(input, side),
    openNetwork: options => createPartitionNetwork({ ...options, verifyPeer: async () => ids[1 - side],
      transport: {
        getPeerBinding: () => ({ local: 'local-certificate', remote: 'remote-certificate' }),
        onDataChannel(label, listener) { listeners[side].set(label, listener); return () => listeners[side].delete(label); },
        openDataChannel(_peer, label) {
          const pair = [new EventTarget(), new EventTarget()];
          pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
            maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
            send(data) { queueMicrotask(() => {
              if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }));
            }); },
            close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); }
          }));
          listeners[1 - side].get(label)('remote-transport', pair[1]); return pair[0];
        }
      }
    }) }));
  closers.push(...networks.map(network => () => network.close()));
  return { networks, ids };
}
it('transfers a fragmented checkpoint and gradient reply on the authenticated training label', async () => {
  const f = fixture();
  const peer = await f.networks[0].connect('wire', new AbortController().signal);
  const body = { checkpoint: 'x'.repeat(100000) };
  const result = await peer.request('contribute', 'round-job', body, new AbortController().signal);
  expect(result).toEqual({ data: body, participant: f.ids[0] });
  expect(peer.participantId).toBe(f.ids[1]);
});
it('coordinates an opted-in round across two complete sessions through production channel framing', async () => {
  const ports = [], applied = [];
  const f = fixture({ allowed: (peer, side) => ports[side].allowed(peer), receive: (input, side) => ports[side].receive(input) });
  const weights = new Uint8Array([1, 2]).buffer;
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', weights))].map(b => b.toString(16).padStart(2, '0')).join('');
  const sessions = f.ids.map((id, side) => createTrainingSession({ policy, participantId: async () => id,
    openNetwork: options => { ports[side] = options; return f.networks[side]; },
    connectPeer: (network, peer, signal) => network.connect(peer, signal),
    openExecutor: async () => ({ close: async () => {}, request: async (action, input) => {
      if (action === 'prepare') return { baseManifestHash: policy.baseManifestHash,
        assignment: { participantId: id, sampleHash: `sample-${side}`, supervisedTokenCount: 1 } };
      if (action === 'round') return { ...input, baseManifestHash: policy.baseManifestHash, roundHash: 'frozen', checkpoint: 'x'.repeat(100000) };
      if (action === 'contribute') return { participantId: id, roundHash: input.round.roundHash, gradient: side + 1 };
      if (action === 'apply') { applied.push(input); return { stepCount: 1 }; }
      if (action === 'export') return { weights, weightsSha256: checksum, manifest: { id: 'candidate', version: '0.0.1', checksum }, json: '{}' };
      throw Error(action);
    } }) }));
  closers.unshift(...sessions.map(session => () => session.close()));
  await Promise.all(sessions.map(session => session.connect()));
  const sample = { inputIds: [1], targetIds: [2], supervisedTokenCount: 1 };
  await sessions[1].contribute({ sample, coordinator: 'remote-transport', consent: true });
  const result = await sessions[0].run({ samples: [sample], consent: true, peers: ['remote-transport'],
    adapter: { id: 'candidate', name: 'Candidate', version: '0.0.1' } });
  expect(applied).toHaveLength(1);
  expect(applied[0].contributions.map(row => row.gradient)).toEqual([1, 2]);
  expect(sessions[1].getState().phase).toBe('contributed');
  expect(result).toMatchObject({ evaluated: false, activated: false, weightsSha256: checksum });
});
it('rejects an inference-only peer before executing training', async () => {
  const receive = vi.fn(), f = fixture({ allowed: () => false, receive });
  const peer = await f.networks[0].connect('wire', new AbortController().signal);
  await expect(peer.request('describe', 'job', {}, new AbortController().signal)).rejects.toThrow();
  expect(receive).not.toHaveBeenCalled();
});
it('revocation while computing prevents disclosure of a completed gradient', async () => {
  const entered = Promise.withResolvers(), settled = Promise.withResolvers(); let approved = true;
  const f = fixture({ allowed: () => approved, receive: async () => { entered.resolve(); await settled.promise; return { gradient: 'private' }; } });
  const peer = await f.networks[0].connect('wire', new AbortController().signal);
  const request = peer.request('contribute', 'job', {}, new AbortController().signal);
  const rejected = expect(request).rejects.toThrow();
  await entered.promise; approved = false; settled.resolve(); await rejected;
});

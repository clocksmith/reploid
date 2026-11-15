// @vitest-environment node
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

it.skipIf(process.env.REPLOID_PRIVACY_NATIVE_RTC !== '1')('enforces both profiles, revocation and no downgrade over native WebRTC processes', async () => {
  const room = 'privacy-qualification:' + randomUUID(), peers = new Map(), children = [], pending = new Map();
  const path = fileURLToPath(new URL('../helpers/privacy-native-webrtc-peer.js', import.meta.url));
  let signalingApplicationFrames = 0;
  const errors = [];
  function start(role, model = null) {
    const child = spawn(process.execPath, [path, role, room, ...(model ? [JSON.stringify(model)] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
    const node = { child, ready: Promise.withResolvers() }; children.push(node);
    child.stderr.on('data', chunk => { if (!process.env.REPLOID_PRIVACY_LIVE_MODEL_DIR) errors.push(String(chunk)); });
    child.on('error', error => node.ready.reject(error));
    createInterface({ input: child.stdout }).on('line', line => {
      const prefix = 'REPLOID_PRIVACY_QUALIFICATION ';
      if (!line.startsWith(prefix)) return;
      let item; try { item = JSON.parse(line.slice(prefix.length)); } catch { errors.push('Invalid qualification frame'); return; }
      if (item.event === 'signal') {
        const message = item.message;
        if (message.type === 'join') {
          const prior = [...peers.keys()]; peers.set(message.peerId, node);
          child.stdin.write(JSON.stringify({ signal: { type: 'joined', peerId: message.peerId, roomId: room, peers: prior } }) + '\n');
          for (const id of prior) peers.get(id).child.stdin.write(JSON.stringify({ signal: { type: 'peer-joined', peerId: message.peerId } }) + '\n');
        } else if (['offer', 'answer', 'ice-candidate'].includes(message.type)) {
          const target = peers.get(message.targetPeer);
          if (!target) { errors.push('Unknown negotiation target'); return; }
          target.child.stdin.write(JSON.stringify({ signal: message }) + '\n');
        } else if (!['heartbeat', 'leave'].includes(message.type)) signalingApplicationFrames++;
      } else if (item.event === 'ready') node.ready.resolve(item);
      else if (item.event === 'failure') pending.get(item.id)?.reject(Error(item.error));
      else pending.get(item.id)?.resolve(item);
    });
    return node;
  }
  function command(node, value) {
    const id = randomUUID(), reply = Promise.withResolvers(); pending.set(id, reply);
    node.child.stdin.write(JSON.stringify({ id, ...value }) + '\n');
    return reply.promise.finally(() => pending.delete(id));
  }
  try {
    const provider = start('provider'), ready = await provider.ready.promise;
    const requester = start('requester', ready.model); await requester.ready.promise;
    for (const mode of ['visible', 'restricted', 'revoked', 'denied', 'unsupported']) {
      const result = await command(requester, { command: 'run', mode });
      expect(result.succeeded, result.error).toBe(['visible', 'restricted'].includes(mode));
      expect(result.deltaRequests).toBe(['visible', 'restricted'].includes(mode) ? 1 : 0);
      expect(result.stats.relayMessagesSent).toBe(0);
      expect(result.stats.peers).toEqual([expect.objectContaining({ transport: 'webrtc', fingerprintBound: true })]);
    }
    await command(provider, { command: 'offering', value: false });
    await new Promise(resolve => setTimeout(resolve, 30));
    const disappeared = await command(requester, { command: 'run', mode: 'disappeared' });
    expect(disappeared.succeeded).toBe(false); expect(disappeared.deltaRequests).toBe(0);
    expect((await command(provider, { command: 'state' })).stats.executions).toBe(2);
    expect(signalingApplicationFrames).toBe(0); expect(errors).toEqual([]);
    await Promise.all([command(requester, { command: 'close' }), command(provider, { command: 'close' })]);
  } finally { for (const { child } of children) if (child.exitCode === null) child.kill(); }
}, 30000);

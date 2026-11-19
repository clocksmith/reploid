// @vitest-environment node
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

it.skipIf(process.env.REPLOID_PRIVACY_NATIVE_RTC !== '1')('enforces both profiles, revocation and no downgrade over native WebRTC processes', async () => {
  const room = 'privacy-qualification:' + randomUUID(), peers = new Map(), children = [], pending = new Map();
  const path = fileURLToPath(new URL('../helpers/privacy-native-webrtc-peer.js', import.meta.url));
  // Optional: the provider process runs on another machine. A JSON array naming the command that starts this
  // repository's peer helper there, for example ["ssh", "<host>", "node", "<checkout>/tests/helpers/privacy-native-webrtc-peer.js"].
  // Its standard streams carry negotiation and control only; requests travel on the WebRTC channel between the machines.
  const remoteProvider = process.env.REPLOID_PRIVACY_REMOTE_PROVIDER ? JSON.parse(process.env.REPLOID_PRIVACY_REMOTE_PROVIDER) : null;
  let signalingApplicationFrames = 0;
  const errors = [];
  function start(role, model = null) {
    const [program, ...leading] = role === 'provider' && remoteProvider ? remoteProvider : [process.execPath, path];
    const child = spawn(program, [...leading, role, room, ...(model ? [JSON.stringify(model)] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    // A request that names its recipient asked for admission first; the provider-visible one did not.
    const served = (await command(provider, { command: 'state' })).stats;
    expect(served.received).toMatchObject({ 'reploid:generation-admit': 1, 'reploid:generation-request': 2 });
    expect(served.promptFrames.received).toBe(2);

    // The named recipient's host declines. It decides from the request's details, and the prompt stays with the requester.
    await command(provider, { command: 'declining', value: true });
    const sentBefore = (await command(requester, { command: 'state' })).stats;
    const declined = await command(requester, { command: 'run', mode: 'restricted' });
    expect(declined.succeeded).toBe(false);
    expect(declined.error).toBe('The provider declined this request. The prompt was not sent.');
    expect(declined.deltaRequests).toBe(0);
    expect(declined.stats.promptFrames.sent).toBe(sentBefore.promptFrames.sent);
    expect(declined.stats.sent['reploid:generation-admit']).toBe(sentBefore.sent['reploid:generation-admit'] + 1);
    const refused = (await command(provider, { command: 'state' })).stats;
    expect(refused.received).toMatchObject({ 'reploid:generation-admit': 2, 'reploid:generation-request': 2 });
    expect(refused.promptFrames.received).toBe(2);
    expect(refused.executions).toBe(2);
    // The same provider serves the same request again once its host allows it.
    await command(provider, { command: 'declining', value: false });
    const restored = await command(requester, { command: 'run', mode: 'restricted' });
    expect(restored.succeeded, restored.error).toBe(true);
    expect(restored.deltaRequests).toBe(1);

    await command(provider, { command: 'offering', value: false });
    await new Promise(resolve => setTimeout(resolve, 30));
    const disappeared = await command(requester, { command: 'run', mode: 'disappeared' });
    expect(disappeared.succeeded).toBe(false); expect(disappeared.deltaRequests).toBe(0);
    expect((await command(provider, { command: 'state' })).stats.executions).toBe(3);
    expect(signalingApplicationFrames).toBe(0); expect(errors).toEqual([]);
    await Promise.all([command(requester, { command: 'close' }), command(provider, { command: 'close' })]);
  } finally { for (const { child } of children) if (child.exitCode === null) child.kill(); }
}, 30000);

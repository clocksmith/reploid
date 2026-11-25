// @vitest-environment node
// Fresh-path recovery of a stalled connection to the same approved provider, on real node WebRTC and the
// real discovery server. See tests/helpers/stalled-webrtc-mesh.js for what a stall is in this fixture.
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { createStalledWebrtcMesh } from '../helpers/stalled-webrtc-mesh.js';

const ACK_MS = 1500;
const open = [];
afterEach(async () => { for (const mesh of open.splice(0)) await mesh.close(); });
const fixture = async options => { const mesh = await createStalledWebrtcMesh(options); open.push(mesh); return mesh; };
const events = result => result.delivery.timeline.map(row => [row.event, row.stage, row.attempt, row.path ?? null].join(':'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// After the stall ends, every frame it held has arrived: the provider has seen the late originals too.
async function settledOnce(f, result) {
  await expect.poll(() => f.stall.released !== null, { timeout: 15000 }).toBe(true);
  await wait(300);
  expect(f.executions).toHaveLength(1);
  expect(f.executions[0].requestId).toBe(result.executionReceipt.jobHash.slice('request:'.length));
  expect(f.authorizations.filter(row => row.action === 'mesh.admit')).toHaveLength(1);
  expect(f.authorizations.filter(row => row.action === 'mesh.execute')).toHaveLength(1);
  expect(f.authorizations.filter(row => row.action === 'mesh.dispatch')).toHaveLength(1);
  // Charged once: one countersigned receipt reached the provider, and it is the one the requester holds.
  await expect.poll(() => f.receipts.length).toBe(1);
  expect(f.receipts[0].receipt.jobHash).toBe(result.executionReceipt.jobHash);
  expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
}

describe('a stalled stream on the same connection', () => {
  it('recovers on a fresh channel to the same provider within about twice the acknowledgement bound', async () => {
    const f = await fixture({ providers: ['provider-a', 'provider-b'] });
    const bindings = Object.fromEntries(['provider-a', 'provider-b'].map(name => [name, f.requester.transport.getPeerBinding(f.peerIdOf(name))]));
    f.armStall('stream', 6000);
    const { result, error, firstTokenMs } = await f.ask();
    expect(error).toBeUndefined();
    expect(result.content).toBe('actual answer');
    expect(firstTokenMs).toBeGreaterThan(ACK_MS);
    expect(firstTokenMs).toBeLessThan(2 * ACK_MS);
    // The first frame and its fresh-channel re-send went to one computer; the other heard nothing of it.
    const chosen = f.executions[0].node, other = chosen === 'provider-a' ? 'provider-b' : 'provider-a';
    expect(f.authorizations.filter(row => row.node === other && row.action !== 'mesh.connect')).toEqual([]);
    expect(f.executions.map(row => row.node)).toEqual([chosen]);
    expect(f.requester.transport.getPeerBinding(f.peerIdOf(chosen))).toEqual(bindings[chosen]);
    expect(events(result)).toEqual(['sent:admit:1:', 'path-opened:admit:2:1', 'resent:admit:2:1', 'received:admit:2:',
      'sent:request:1:', 'received:request:1:']);
    expect(f.labels.filter(row => row.label.startsWith('reploid-path-'))).toEqual([{ label: 'reploid-path-1', side: 'local' }]);
    expect(f.renegotiations()).toEqual([]);
    await settledOnce(f, result);
  }, 40000);
});

describe('a stalled network path', () => {
  it('restarts ICE on the same connection when the fresh channel stalls too, and answers once', async () => {
    const f = await fixture();
    const peer = f.peerIdOf('provider');
    const before = { binding: f.requester.transport.getPeerBinding(peer), attempt: f.requester.transport.getPeerStates().find(row => row.id === peer).attemptId };
    f.armStall('path', 12000);
    const { result, error, firstTokenMs } = await f.ask();
    expect(error).toBeUndefined();
    expect(result.content).toBe('actual answer');
    expect(f.stall.curedBy).toBe('ice-restart');
    // Attempt 2 on a fresh channel at one bound, the ICE restart at two, then the answer.
    expect(firstTokenMs).toBeGreaterThan(2 * ACK_MS);
    expect(firstTokenMs).toBeLessThan(3 * ACK_MS);
    expect(events(result).slice(0, 6)).toEqual(['sent:admit:1:', 'path-opened:admit:2:1', 'resent:admit:2:1',
      'ice-restart:admit:3:', 'ice-restarted:admit:3:1', 'resent:admit:3:1']);
    // One renegotiation over discovery, from the requester to that provider, on the connection it already had.
    expect(f.renegotiations().map(frame => frame.targetPeer)).toEqual([peer]);
    expect(f.requester.transport.getPeerBinding(peer)).toEqual(before.binding);
    expect(f.requester.transport.getPeerStates().find(row => row.id === peer).attemptId).toBe(before.attempt);
    await settledOnce(f, result);
  }, 40000);

  it('restarts ICE with the first re-send when ICE already reports the connection disconnected', async () => {
    const f = await fixture({ reportIce: 'disconnected' });
    f.armStall('path', 12000);
    const { result, error, firstTokenMs } = await f.ask();
    expect(error).toBeUndefined();
    expect(f.stall.curedBy).toBe('ice-restart');
    expect(firstTokenMs).toBeLessThan(2 * ACK_MS);
    expect(events(result)).toContain('ice-restart:admit:2:');
    expect(events(result)).toContain('ice-restarted:admit:2:1');
    expect(f.renegotiations()).toHaveLength(1);
    await settledOnce(f, result);
  }, 40000);
});

describe('mixed versions', () => {
  it('leaves a provider that does not advertise protocol 2 on same-channel re-sends, with no fresh channel or renegotiation', async () => {
    const f = await fixture({ legacy: ['provider'] });
    const advertised = f.requester.mesh.getSwarmSnapshot().peers[0];
    expect(advertised.deliveryProtocol).toBe(1);
    expect(advertised.deliveryProtocols).toBeNull();
    f.armStall('stream', 6000);
    const { result, error, firstTokenMs } = await f.ask();
    expect(error).toBeUndefined();
    expect(result.delivery.protocol).toBe(1);
    expect(firstTokenMs).toBeGreaterThan(5500);
    expect(events(result).slice(0, 3)).toEqual(['sent:admit:1:', 'resent:admit:2:', 'resent:admit:3:']);
    expect(f.labels.filter(row => row.label.startsWith('reploid-path-'))).toEqual([]);
    expect(f.renegotiations()).toEqual([]);
    await settledOnce(f, result);
  }, 40000);
});

it('time to first token in the stalled-stream fixture, before and after', async () => {
  const rows = [];
  for (const [label, legacy] of [['before (protocol 1, same channel)', ['provider']], ['after (protocol 2, fresh channel)', []]]) {
    const f = await fixture({ legacy });
    f.armStall('stream', 6000);
    const { firstTokenMs, error } = await f.ask();
    expect(error).toBeUndefined();
    rows.push(`${label}: ${Math.round(firstTokenMs)} ms`);
    await f.close(); open.splice(open.indexOf(f), 1);
  }
  console.info(`[stalled-stream TTFT, 6 s stall, ack bound ${ACK_MS} ms] ${rows.join('; ')}`);
}, 60000);

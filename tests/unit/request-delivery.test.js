// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { createRequestDelivery, readDelivery } from '../../packages/reploid/src/mesh/request-delivery.js';
import { createLossyMesh } from '../helpers/lossy-mesh.js';

const open = [];
afterEach(async () => { for (const mesh of open.splice(0)) await mesh.close(); });
const lossy = async options => { const mesh = await createLossyMesh(options); open.push(mesh); return mesh; };
// Drops the first frame of `type` from the requester; delivers everything else.
const dropFirst = type => { let dropped = false; return frame => {
  if (!dropped && frame.from === 'requester' && frame.type === type) { dropped = true; return 'drop'; }
  return 'deliver';
}; };
const attempts = frames => frames.map(frame => frame.payload.delivery?.attempt ?? null);
const events = result => result.delivery.timeline.map(({ event, stage, attempt }) => `${event}:${stage}:${attempt}`);

describe('a lossy link that drops the first request frame', () => {
  it('answers after one re-send to the same provider, executed once and charged once', async () => {
    const f = await lossy({ link: dropFirst('reploid:generation-request'), mesh: { requestAckTimeoutMs: 150 } });
    const { result, error } = await f.ask();
    expect(error).toBeUndefined();
    expect(result.content).toBe('actual answer');
    // The provider received the request once, ran it once, and recorded one countersigned receipt.
    expect(attempts(f.frames('reploid:generation-request'))).toEqual([1, 2]);
    expect(f.frames('reploid:generation-request').map(frame => frame.action)).toEqual(['drop', 'deliver']);
    expect(f.executions).toHaveLength(1);
    expect(f.authorizations.filter(row => row.action === 'mesh.execute')).toHaveLength(1);
    expect(f.authorizations.filter(row => row.action === 'mesh.dispatch')).toHaveLength(1);
    await expect.poll(() => f.receipts.length).toBe(1);
    expect(f.receipts[0].receipt.jobHash).toBe(`request:${f.executions[0].requestId}`);
    expect(await verifyReceipt(result.executionReceipt)).toEqual({ valid: true, providerValid: true, consumerValid: true });
    // The requester's record shows the re-send and which attempt the provider acknowledged.
    expect(events(result)).toEqual(['sent:admit:1', 'received:admit:1', 'sent:request:1', 'resent:request:2', 'received:request:2']);
    expect(f.errors).toEqual([]);
  });

  it('answers after one re-send of a dropped admission question, decided once', async () => {
    const f = await lossy({ link: dropFirst('reploid:generation-admit'), mesh: { requestAckTimeoutMs: 150 } });
    const { result } = await f.ask();
    expect(result.content).toBe('actual answer');
    expect(attempts(f.frames('reploid:generation-admit'))).toEqual([1, 2]);
    expect(f.authorizations.filter(row => row.action === 'mesh.admit')).toHaveLength(1);
    expect(f.executions).toHaveLength(1);
    expect(events(result).slice(0, 3)).toEqual(['sent:admit:1', 'resent:admit:2', 'received:admit:2']);
  });

  it('gets its first token sooner than without the acknowledgement', async () => {
    // Default bound (1.5 s). Without the delivery protocol nothing re-sends, so the request waits to its limit.
    const limit = 4000;
    const before = await lossy({ link: dropFirst('reploid:generation-request'), legacy: node => node === 'provider',
      mesh: { generationTimeoutMs: limit } });
    const old = await before.ask();
    const after = await lossy({ link: dropFirst('reploid:generation-request'), mesh: { generationTimeoutMs: limit } });
    const now = await after.ask();
    console.info(`[lossy-link TTFT] before: no first token, failed after ${Math.round(old.totalMs)} ms (${old.error?.message}); `
      + `after: first token ${Math.round(now.firstTokenMs)} ms, answer ${Math.round(now.totalMs)} ms`);
    expect(old.firstTokenMs).toBeNull();
    expect(old.error.message).toMatch('Timed out');
    expect(attempts(before.frames('reploid:generation-request'))).toEqual([null]);
    expect(now.firstTokenMs).toBeGreaterThan(1500);
    expect(now.firstTokenMs).toBeLessThan(2500);
    expect(after.executions).toHaveLength(1);
  }, 20000);
});

it('executes a duplicated delivery once, and answers a repeated admission question from its first decision', async () => {
  const f = await lossy({ link: frame => frame.from === 'requester' && ['reploid:generation-admit', 'reploid:generation-request'].includes(frame.type)
    ? 'duplicate' : 'deliver' });
  const { result, error } = await f.ask();
  expect(error).toBeUndefined();
  expect(result.content).toBe('actual answer');
  expect(f.executions).toHaveLength(1);
  expect(f.authorizations.filter(row => row.action === 'mesh.admit')).toHaveLength(1);
  expect(f.authorizations.filter(row => row.action === 'mesh.execute')).toHaveLength(1);
  // Each copy is acknowledged; no copy is refused, and only one result is sent.
  expect(f.frames('reploid:request-received', { from: 'provider' }).map(frame => frame.payload.stage)).toEqual(['admit', 'admit', 'request', 'request']);
  expect(f.frames('reploid:generation-error')).toEqual([]);
  expect(f.frames('reploid:generation-result')).toHaveLength(1);
  await expect.poll(() => f.receipts.length).toBe(1);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(f.receipts).toHaveLength(1);
});

it('never re-sends to another provider: a silent recipient ends the attempt with the other untouched', async () => {
  let chosen = null;
  const f = await lossy({ providers: ['provider-a', 'provider-b'], mesh: { requestAckTimeoutMs: 100, maxRequestResends: 2, generationTimeoutMs: 1500 },
    link: frame => {
      if (frame.from === 'requester' && frame.type === 'reploid:generation-admit') chosen ??= frame.to;
      return frame.from === 'requester' && frame.to === chosen && frame.type.startsWith('reploid:generation-') ? 'drop' : 'deliver';
    } });
  const { error } = await f.ask();
  expect(error.message).toMatch('Timed out');
  const other = chosen === 'provider-a' ? 'provider-b' : 'provider-a';
  // The first question and its two bounded re-sends, all to the computer that was approved.
  expect(f.frames('reploid:generation-admit').map(frame => [frame.to, frame.payload.delivery.attempt])).toEqual([[chosen, 1], [chosen, 2], [chosen, 3]]);
  expect(f.wire.filter(frame => frame.from === 'requester' && frame.to === other && /generation-(admit|request)$/.test(frame.type))).toEqual([]);
  expect(f.frames('reploid:generation-request')).toEqual([]);
  expect(f.executions).toEqual([]);
});

describe('mixed versions', () => {
  it('sends a provider that does not advertise the delivery protocol each frame once, with no delivery fields', async () => {
    const f = await lossy({ legacy: node => node === 'provider', mesh: { requestAckTimeoutMs: 50 } });
    expect(f.meshes.requester.getSwarmSnapshot().peers[0].deliveryProtocol).toBeNull();
    const { result } = await f.ask();
    expect(result.content).toBe('actual answer');
    expect(result).not.toHaveProperty('delivery');
    expect(f.frames('reploid:generation-admit').map(frame => Object.hasOwn(frame.payload, 'delivery'))).toEqual([false]);
    expect(f.frames('reploid:generation-request').map(frame => Object.hasOwn(frame.payload, 'delivery'))).toEqual([false]);
    expect(f.frames('reploid:request-received')).toEqual([]);
  });

  it('sends a requester whose frames carry no delivery fields no acknowledgement it would not understand', async () => {
    const f = await lossy({ legacy: node => node === 'requester' });
    const { result } = await f.ask();
    expect(result.content).toBe('actual answer');
    expect(f.frames('reploid:request-received')).toEqual([]);
    expect(f.executions).toHaveLength(1);
  });
});

describe('createRequestDelivery', () => {
  it('re-sends at most its bound, stops on acknowledgement, and keeps its record after stopping', async () => {
    const sent = [];
    const delivery = createRequestDelivery({ ackTimeoutMs: 20, maxResends: 2, resend: (stage, attempt) => { sent.push([stage, attempt]); return true; } });
    delivery.sent('admit');
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(sent).toEqual([['admit', 2], ['admit', 3]]);
    delivery.sent('request'); delivery.acknowledge('request', 1);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(sent).toHaveLength(2);
    delivery.stop();
    expect(delivery.snapshot().timeline.map(row => `${row.event}:${row.stage}:${row.attempt}`))
      .toEqual(['sent:admit:1', 'resent:admit:2', 'resent:admit:3', 'sent:request:1', 'received:request:1']);
  });

  it('does not count a frame the connection would not take, and reads only valid delivery fields', async () => {
    const delivery = createRequestDelivery({ ackTimeoutMs: 10, maxResends: 3, resend: () => false });
    delivery.sent('request');
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(delivery.attempt('request')).toBe(1);
    delivery.stop();
    expect(readDelivery({ delivery: { protocol: 1, attempt: 2 } })).toEqual({ protocol: 1, attempt: 2 });
    expect(readDelivery({ delivery: { protocol: 2, attempt: 1 } })).toEqual({ protocol: 2, attempt: 1 });
    for (const delivery of [undefined, { protocol: 3, attempt: 1 }, { protocol: 1, attempt: 0 }, { protocol: 1, attempt: 1.5 }, { protocol: 1, attempt: 99 }]) {
      expect(readDelivery({ delivery })).toBeNull();
    }
  });
});

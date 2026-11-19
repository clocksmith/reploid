// @vitest-environment node
import { expect, it } from 'vitest';
import { createChangeOnlyLog, statusContentKey } from '../../server/native-change-log.js';
import policy from '../../apps/poolday/config/partition-policy.json' with { type: 'json' };

it('writes a status kind only when its content changes, plus a heartbeat when idle', () => {
  let clock = 0;
  const lines = [];
  const log = createChangeOnlyLog({ heartbeatMs: 1000, write: line => lines.push(JSON.parse(line)), now: () => clock });
  const state = (phase, at) => ({ event: 'partition-state', at, phase, reservations: { active: 0, records: [{ reservedAt: at }] } });
  expect(log('partition-state', state('ready', 't0'))).toBe(true);
  clock = 400;
  // Only time-like fields differ: not written.
  expect(log('partition-state', state('ready', 't1'))).toBe(false);
  expect(log('network', { event: 'network', at: 't1', peers: 5, lastSeenAt: 1 })).toBe(true);
  clock = 900;
  expect(log('network', { event: 'network', at: 't2', peers: 5, lastSeenAt: 2 })).toBe(false);
  expect(log('partition-state', state('executing', 't2'))).toBe(true);
  clock = 2000;
  // Unchanged for longer than the heartbeat: written once, marked.
  expect(log('network', { event: 'network', at: 't3', peers: 5, lastSeenAt: 3 })).toBe(true);
  expect(log('network', { event: 'network', at: 't4', peers: 5, lastSeenAt: 4 })).toBe(false);
  expect(log('network', { event: 'network', at: 't5', peers: 6 })).toBe(true);
  expect(lines.map(line => [line.event, line.phase ?? line.peers, line.heartbeat === true])).toEqual([
    ['partition-state', 'ready', false], ['network', 5, false], ['partition-state', 'executing', false],
    ['network', 5, true], ['network', 6, false]]);
});

it('ignores only time-like keys when comparing content, at any depth', () => {
  expect(statusContentKey({ at: 1, b: { updatedAt: 2, elapsedMs: 3, n: 1 }, list: [{ timestamp: 4, x: 1 }] }))
    .toBe(statusContentKey({ at: 9, b: { n: 1, updatedAt: 8, elapsedMs: 7 }, list: [{ x: 1, timestamp: 6 }] }));
  expect(statusContentKey({ b: { n: 1 } })).not.toBe(statusContentKey({ b: { n: 2 } }));
});

it('a connected but idle host writes only heartbeats: advertisement counters and CPU time are not changes', () => {
  // Two consecutive polls of a live provider differed only in these fields, so every poll was written.
  const poll = n => ({ event: 'network', at: `t${n}`, peers: [{ peerId: 'a', readiness: 'ready', updatedAt: 1000 + n, observationSequence: 500 + n }],
    owner: { decision: { allowed: true, at: n }, measurements: { cpuUserMicros: 9000 + 13 * n, cpuSystemMicros: 400 + n, elapsedMs: 2000 } } });
  expect(statusContentKey(poll(1))).toBe(statusContentKey(poll(2)));
  let clock = 0;
  const lines = [];
  const log = createChangeOnlyLog({ heartbeatMs: 300000, write: line => lines.push(JSON.parse(line)), now: () => clock });
  for (let n = 0; n < 150; n++) { clock = n * 2000; log('network', poll(n)); }   // five minutes of two-second polls
  expect(lines).toHaveLength(1);
  clock = 300000; log('network', poll(150));
  expect(lines.map(line => line.heartbeat === true)).toEqual([false, true]);
  // A real change is still written at once: a peer's readiness, or a new peer.
  const changed = poll(151); changed.peers[0].readiness = 'executing';
  clock = 302000; expect(log('network', changed)).toBe(true);
  const joined = poll(152); joined.peers[0].readiness = 'executing'; joined.peers.push({ peerId: 'b', readiness: 'ready', observationSequence: 1 });
  clock = 304000; expect(log('network', joined)).toBe(true);
});

it('requires the heartbeat interval from the partition policy', () => {
  expect(Number.isSafeInteger(policy.statusHeartbeatMs) && policy.statusHeartbeatMs > 0).toBe(true);
  expect(() => createChangeOnlyLog({ heartbeatMs: undefined, write: () => {} })).toThrow('statusHeartbeatMs');
});

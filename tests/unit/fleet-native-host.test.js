// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { runFleetNativeCommands, includeRequesterPresence, activeProviderRequests, openComputerIdentity, openFleetNativeHost, createFairLaneScheduler } from '../../server/fleet/native-host.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService } from '../../server/fleet/service.js';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

it('retains a signing identity across process launches and refuses linked secret files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-native-')); roots.push(root);
  const file = path.join(root, 'identity.json'), first = await openComputerIdentity(file);
  expect((await openComputerIdentity(file)).peerId).toBe(first.peerId);
  await fs.symlink(file, path.join(root, 'linked.json'));
  await expect(openComputerIdentity(path.join(root, 'linked.json'))).rejects.toThrow('symbolic link');
});

it('keeps queued or unsettled stage work on its host and permits settled histories to stay idle', () => {
  expect(activeProviderRequests({ phase: 'executing' })).toBe(1);
  expect(activeProviderRequests({ reservations: { active: 1, records: [{ settledAt: null }] } })).toBe(1);
  expect(activeProviderRequests({ queue: { queued: 2 } })).toBe(2);
  expect(activeProviderRequests({ attempts: [{ phase: 'failed', cleanupSettledAt: null }] })).toBe(1);
  expect(activeProviderRequests({ unknownAttempts: [{}] })).toBe(1);
  expect(activeProviderRequests({ phase: 'ready', reservations: { active: 0, records: [{ settledAt: 123 }] },
    attempts: [{ phase: 'completed', cleanupSettledAt: 123 }] })).toBe(0);
});

it('refuses operator model configurations in the public pool before loading native modules', async () => {
  await expect(openFleetNativeHost({ configuration: { schema: 'reploid.fleet-native/v1', computerId: 'machine', name: 'Machine',
    models: [{ mode: 'whole-model' }], roomId: 'reploid-swarm-public' }, loadRtc: () => { throw Error('should not load'); } }))
    .rejects.toThrow('explicit private room');
});

it('reports a live requester without inventing local GPU capacity or another computer’s presence', () => {
  const rows = includeRequesterPresence([{ id: 'mac', online: false }, { id: 'miles', online: false }],
    { computerId: 'mac', activeRequests: 1, preparing: false, hardware: { freeHostBytes: 123 } }, 456);
  expect(rows[0]).toMatchObject({ online: true, requester: true, resident: null, activeRequests: 1, observedAt: 456 });
  expect(rows[0].freeGpuBytes).toBeUndefined(); expect(rows[1].online).toBe(false);
});

it('drains a daemon after stdin reaches EOF during asynchronous startup', async () => {
  const input = new PassThrough(), signals = new EventEmitter(); let closed = false;
  const host = { async select() { input.end(); await delay(10); }, async close() { closed = true; } };
  const running = runFleetNativeCommands({ host, input, signals, config: { initialModel: 0, daemon: true } });
  await delay(30); signals.emit('SIGTERM');
  await running; expect(closed).toBe(true); expect(signals.listenerCount('SIGTERM')).toBe(0);
});

it('closes and rejects immediately when daemon startup fails instead of hanging on the stop signal', async () => {
  const input = new PassThrough(), signals = new EventEmitter(); let closed = false;
  const host = { async select() { throw Error('startup failed'); }, async close() { closed = true; } };
  await expect(runFleetNativeCommands({ host, input, signals, config: { initialModel: 0, daemon: true } }))
    .rejects.toThrow('startup failed');
  expect(closed).toBe(true); expect(signals.listenerCount('SIGTERM')).toBe(0);
});

it('admits two independent conversations within capacity and cancels a third before dispatch', async () => {
  // Scheduler diagnostic only: capacity is supplied by its host; this does not qualify a two-slot GPU provider.
  const route = { id: 'fixture', identity: 'sha256:fixture', availability: 'ready' };
  const scheduler = createFairLaneScheduler({ findRoute: () => route,
    freeSlots: (_chosen, active, starting) => Math.max(0, 2 - active.size - starting) });
  const firstController = new AbortController(), secondController = new AbortController(), queuedController = new AbortController();
  let first, second, replacement;
  try {
    first = await scheduler.acquire({ attemptId: 'first', threadId: 'one', requestedModel: route, signal: firstController.signal });
    second = await scheduler.acquire({ attemptId: 'second', threadId: 'two', requestedModel: route, signal: secondController.signal });
    expect(scheduler.queuedCount()).toBe(0);
    const queued = scheduler.acquire({ attemptId: 'third', threadId: 'three', requestedModel: route, signal: queuedController.signal });
    const cancelled = expect(queued).rejects.toThrow('Cancelled before disclosure');
    expect(scheduler.queuedCount()).toBe(1);
    first.markDisclosed('supplier-a'); second.markDisclosed('supplier-b');
    expect(scheduler.queuedCount()).toBe(1);
    queuedController.abort(Error('Cancelled before disclosure'));
    await cancelled;
    expect(scheduler.queuedCount()).toBe(0);
    first.release(); first = null;
    replacement = await scheduler.acquire({ attemptId: 'next-turn', threadId: 'one', requestedModel: route, signal: new AbortController().signal });
    replacement.markDisclosed('supplier-a');
    expect(scheduler.queuedCount()).toBe(0);
  } finally {
    queuedController.abort(); first?.release(); second?.release(); replacement?.release(); scheduler.close();
  }
});

it('serves other conversations before a second turn from a fast-path conversation and updates queue positions', async () => {
  const route = { id: 'qwen-3-5-2b-q4k-ehaf16', identity: 'sha256:test', availability: 'ready' };
  const scheduler = createFairLaneScheduler({
    enabled: true,
    capacityWaitMs: 5000,
    findRoute: () => route,
    freeSlots: (_chosen, active, starting) => Math.max(0, 1 - active.size - starting)
  });
  try {
    const dispatched = [], positions = {};
    const record = id => row => {
      if (row.status === 'queued') positions[id] = row.queuePosition;
      if (row.status === 'admitted') dispatched.push(id);
    };

    const slot1a = await scheduler.acquire({
      attemptId: '1a', threadId: 'thread-alpha', requestedModel: route, signal: new AbortController().signal
    });
    dispatched.push('1a');
    slot1a.markDisclosed('peer-1');

    const p1b = scheduler.acquire({
      attemptId: '1b', threadId: 'thread-alpha', requestedModel: route, signal: new AbortController().signal, onAdmission: record('1b')
    });
    await delay(5);
    const p2a = scheduler.acquire({
      attemptId: '2a', threadId: 'thread-beta', requestedModel: route, signal: new AbortController().signal, onAdmission: record('2a')
    });
    await delay(5);
    const p3a = scheduler.acquire({
      attemptId: '3a', threadId: 'thread-gamma', requestedModel: route, signal: new AbortController().signal, onAdmission: record('3a')
    });

    expect(scheduler.queuedCount()).toBe(3);
    expect(positions).toEqual({ '2a': 1, '3a': 2, '1b': 3 });

    slot1a.release();
    const slot2a = await p2a;
    slot2a.markDisclosed('peer-1');
    slot2a.release();

    const slot3a = await p3a;
    slot3a.markDisclosed('peer-1');
    slot3a.release();

    const slot1b = await p1b;
    slot1b.markDisclosed('peer-1');
    slot1b.release();

    expect(dispatched).toEqual(['1a', '2a', '3a', '1b']);
    expect(scheduler.queuedCount()).toBe(0);
  } finally {
    scheduler.close();
  }
});

it('signs failed terminal cleanup on provider startup for orphaned whole-model admissions from a crashed process', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-provider-restart-')); roots.push(root);
  const reqDir = path.join(root, 'requester'), provDir = path.join(root, 'provider');
  await fs.mkdir(reqDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(provDir, { recursive: true, mode: 0o700 });
  const reqIdentity = await openComputerIdentity(path.join(reqDir, 'identity.json'));
  const provIdentity = await openComputerIdentity(path.join(provDir, 'identity.json'));
  const tokenFile = path.join(root, 'room.secret');
  await fs.writeFile(tokenFile, '0123456789abcdef0123456789abcdef', { mode: 0o600 });
  const modelIdentity = 'sha256:' + 'c'.repeat(64);
  const inputDigest = 'sha256:' + 'd'.repeat(64);
  const models = [{ id: 'qwen-test', identity: modelIdentity }];
  const computers = [
    { id: 'requester', name: 'Requester', ownerId: 'owner-1', providers: [{ participantId: reqIdentity.peerId, publicJwk: reqIdentity.publicJwk }] },
    { id: 'provider', name: 'Provider', ownerId: 'owner-1', providers: [{ participantId: provIdentity.peerId, publicJwk: provIdentity.publicJwk }] }
  ];
  const policy = {
    schema: 'reploid.service-credit-policy/v1', version: 'test/restart-1', unit: 'noncash-service-credit',
    creditsPerOutputToken: 1, maxDebt: 256, maxOutputTokens: 128, maxPendingPerComputer: 4,
    maxClockSkewMs: 30000, maxRequestMs: 120000, allowSameOwner: true, wholeModelTerminalCharge: 0
  };
  const credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), computers, policy });
  const service = await startFleetService({
    credits,
    models,
    placementPolicy: { maxObservationAgeMs: 30000, minSwitchHoldMs: 1000, maxGpuUtilization: 0.9, minHostHeadroomBytes: 0 }
  });
  let host = null;
  try {
    const reservationId = `service:${reqIdentity.peerId}:crashed-exec-1`;
    credits.reserve({
      id: reservationId,
      executionId: 'crashed-exec-1',
      mode: 'whole-model',
      consumer: reqIdentity.peerId,
      providers: [{ participantId: provIdentity.peerId, weight: 1 }],
      model: { id: 'qwen-test', identity: modelIdentity, adapterIdentities: [] },
      inputDigest,
      maxOutputTokens: 64
    });
    credits.dispatch(reservationId, reqIdentity.peerId);
    credits.admit(reservationId, 0);
    expect(credits.snapshot().accounts.find(a => a.id === 'requester')?.held).toBe(64);

    host = await openFleetNativeHost({
      configuration: {
        schema: 'reploid.fleet-native/v1',
        computerId: 'provider',
        name: 'Provider',
        identityFile: path.join(provDir, 'identity.json'),
        roomId: 'fleet-private-test',
        roomTokenFile: tokenFile,
        serviceUrl: service.url,
        models: [{ mode: 'whole-model', model: { id: 'qwen-test', identity: modelIdentity } }]
      },
      loadRtc: async () => ({ RTCPeerConnection: class {}, RTCSessionDescription: class {}, RTCIceCandidate: class {} }),
      loadSocket: async () => ({ WebSocket: class {} }),
      loadGpu: async () => ({ globals: {}, create: () => ({}) })
    });

    const settled = credits.request(reservationId);
    expect(settled?.state).toBe('settled');
    expect(settled?.outcome).toMatchObject({ status: 'failed', charge: 0, outputTokens: null });
    expect(credits.snapshot().accounts.every(a => a.held === 0 && a.balance === 0)).toBe(true);
  } finally {
    await host?.close();
    await service.close();
    credits.close();
  }
});

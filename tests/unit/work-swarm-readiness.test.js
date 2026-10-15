// The browser work swarm records the readiness of stages its partition owner offers into bounded local storage whose
// stored value the utilization CLI reads as is; disconnecting closes them. The partition owner and transport are injected.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';
import { summarizeCapacityUtilization } from '../../packages/reploid/src/measurement/index.js';
import { loadUtilizationInput } from '../../scripts/capacity-utilization.js';

const ports = vi.hoisted(() => ({ ensure: vi.fn(), createTransport: vi.fn() }));
vi.mock('../../self/identity.js', () => ({ ensureIdentityBundle: ports.ensure, saveIdentityBundle: vi.fn(), rotateIdentityBundle: vi.fn() }));
vi.mock('../../self/vendor/reploid/transport/index.js', () => ({
  createSwarmTransport: ports.createTransport, createToolOfferChannel: vi.fn(), TOOL_OFFER_MESSAGE: 'offer', TOOL_OFFER_ACK: 'ack'
}));
import { createWorkSwarm, READINESS_RECORDS_KEY } from '../../self/host/work-swarm.js';

const S = 1000, T0 = Date.UTC(2026, 9, 15, 22, 0, 0), M = 'sha256:' + 'a'.repeat(64), PLAN = 'sha256:' + 'b'.repeat(64);
let values, owner;
beforeEach(() => { vi.clearAllMocks(); values = new Map(); owner = null; });
afterEach(() => { vi.useRealTimers(); });
const state = overrides => ({ phase: 'ready', offering: true, descriptor: { ready: true, modelIdentity: M, planId: PLAN, index: 0 },
  reservations: { active: 0, availableSlots: 2, closed: false, records: [] }, attempts: [], ...overrides });

it('stores readiness spans for the CLI and closes them when the swarm disconnects', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T0);
  ports.ensure.mockResolvedValue({ peerId: 'browser-participant', contribution: {} });
  ports.createTransport.mockReturnValue({ init: async () => true, disconnect: vi.fn(), onMessage: vi.fn(), broadcast: vi.fn() });
  const swarm = createWorkSwarm({ service: {}, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    createPartitions: options => { owner = { options, state: { phase: 'idle', offering: false } };
      return { getModels: () => [], getState: () => owner.state, stop: async () => {}, close: async () => {} }; },
    createModelFiles: () => ({ attach: async () => {}, close: async () => {}, announce() {}, getState: () => ({}) }),
    networkOptions: () => ({ autoConnect: true, discoveryScope: 'public', getInviteUrl: () => 'https://replo.id/?swarm=public',
      config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'reploid-swarm-public' } } }) }) });
  try {
    await swarm.connect();
    const observe = (seconds, next) => { vi.setSystemTime(T0 + seconds * S); owner.state = next; owner.options.onChange(next); };
    observe(10, { phase: 'waiting', offering: true });
    observe(100, state());
    observe(130, state({ reservations: { active: 1, availableSlots: 1, closed: false, records: [] } }));
    observe(160, state({ phase: 'stopping', offering: false }));
    vi.setSystemTime(T0 + 200 * S);
    await swarm.disconnect();
    const stored = values.get(READINESS_RECORDS_KEY);
    expect(swarm.exportReadiness()).toEqual(JSON.parse(stored));
    const spans = JSON.parse(stored).readinessRecords.map(row => [row.host, row.participantId, row.state, row.from / S - T0 / S, row.to / S - T0 / S, row.end]);
    expect(spans).toEqual([['browser', 'browser-participant', 'unready', 0, 100, 'ready'], ['browser', 'browser-participant', 'ready', 100, 160, 'stopped'],
      ['browser', 'browser-participant', 'unready', 160, 200, 'disconnected']]);
    const directory = await mkdtemp(path.join(tmpdir(), 'browser-readiness-'));
    try {
      const file = path.join(directory, 'browser-readiness.json');
      await writeFile(file, stored);
      const input = await loadUtilizationInput([file], { from: String(T0), to: String(T0 + 200 * S) });
      expect(summarizeCapacityUtilization(input).contributors[0].stages[0].maintained)
        .toMatchObject({ capacitySeconds: 120, readyMs: 60 * S, unreadyMs: 140 * S, unknownMs: 0 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  } finally { await swarm.close(); }
});

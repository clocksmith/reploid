import { afterEach, expect, it, vi } from 'vitest';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };
import { createChatSession } from '../../self/host/chat-session.js';
import { isWorkOrderedModel } from '../../self/host/work-partition-plan.js';
const ports = vi.hoisted(() => ({ create: vi.fn(), models: null, actual: null }));
vi.mock('../../self/host/product-session.js', () => ({ createProductSession: ports.create }));
vi.mock('../../self/config/doppler-local-models.js', async original => {
  const actual = await original(); ports.actual = actual.LOCAL_DOPPLER_MODELS;
  return { ...actual, get LOCAL_DOPPLER_MODELS() { return ports.models ?? actual.LOCAL_DOPPLER_MODELS; } };
});
import { initPoolHome } from '../../self/ui/pool-home/index.js';
const ordered = { id: 'ordered', identity: 'sha256:' + 'a'.repeat(64), partitionPlan: { schema: 'doppler.layer-partition-contract/v3', stageCount: 3 } };
const stage = { modelId: 'ordered', index: 0, residentId: 'resident', executionId: 'execution' };
const owners = [];
afterEach(async () => {
  for (const close of owners.splice(0)) await close();
  ports.create.mockReset(); ports.models = null; localStorage.clear(); window.history.replaceState(null, '', '/');
});
function open(options) {
  const mount = document.createElement('div'); document.body.append(mount);
  const chat = createChatSession({ storage: null, models: [] });
  const host = { chat, swarm: { getInviteUrl: () => null }, evolution: { list: async () => [] },
    close: vi.fn(() => chat.close()), connectOperations() {}, pause() {}, resume() {} };
  ports.create.mockReturnValue(host);
  const dispose = options === undefined ? initPoolHome(mount) : initPoolHome(mount, options);
  owners.push(async () => { dispose?.(); await host.close(); mount.remove(); });
  return ports.create.mock.calls.at(-1)[0];
}

it('installed entry path makes a weightless ordered requester with versioned limits', () => {
  expect(orderedPolicy.schema).toBe('reploid.ordered-participation/v1');
  for (const value of Object.values(orderedPolicy.limits)) expect(Number.isSafeInteger(value) && value > 0).toBe(true);
  ports.models = [ordered];
  const session = open();
  expect(session.ordered).toEqual({ stage: null, ...orderedPolicy.limits });
  expect(session.canonical).toBeNull();
});

it('non-ordered catalogs keep ordinary participation and an explicit host option still wins', () => {
  ports.models = ports.actual.filter(model => !isWorkOrderedModel(model));
  expect(ports.models.length).toBeGreaterThan(0);
  expect(open().ordered).toBeNull();
  ports.models = [ordered];
  expect(open({ ordered: null }).ordered).toBeNull();
});

it('only this instance operator storage assigns a stage; links neither supply nor inherit one', () => {
  ports.models = [ordered];
  localStorage.setItem(orderedPolicy.stageStorageKey, JSON.stringify(stage));
  expect(open().ordered).toEqual({ stage, ...orderedPolicy.limits });
  const linked = new URLSearchParams({ instance: 'linked', stage: JSON.stringify(stage), [orderedPolicy.stageStorageKey]: JSON.stringify(stage) });
  window.history.replaceState(null, '', '/?' + linked);
  expect(open().ordered).toEqual({ stage: null, ...orderedPolicy.limits });
});

it('rejects a malformed operator stage before binding the application', () => {
  for (const [saved, message] of [['{"modelId":', 'not valid JSON'], ['null', 'one explicit stage object'], ['[1]', 'one explicit stage object']]) {
    localStorage.setItem(orderedPolicy.stageStorageKey, saved);
    const mount = document.createElement('div');
    expect(() => initPoolHome(mount)).toThrow(message);
    expect(mount.querySelector('[data-composer-form]')).toBeNull();
  }
  expect(ports.create).not.toHaveBeenCalled();
});

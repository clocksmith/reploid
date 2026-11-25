/**
 * The chat's explicit `execution.route` and the charge each browser route declares to the inference API.
 */
import { describe, it, expect } from 'vitest';
import { executionRouteFor, locationForRoute } from '../../apps/poolday/host/execution-route.js';
import { deferredEarning } from '../../apps/poolday/host/credits/browser.js';
import { createChatExecution } from '../../apps/poolday/host/chat-execution.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';

const hash = c => 'sha256:' + c.repeat(64);
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const whole = { id: 'm', identity: hash('a'), provider: 'doppler' };
const staged = { ...whole, partition: { participantA: 'peer:a', participantB: 'peer:b', planId: hash('p') } };
const pin = model => ({ id: model.id, identity: model.identity, adapterIdentities: [] });

describe('the route a conversation request sends', () => {
  it('follows the thread policy, model and execution location, and maps back to a location', () => {
    expect(executionRouteFor({ privacy: createExecutionPolicy(), model: whole })).toBe('local');
    expect(executionRouteFor({ privacy: open, model: staged, executionLocation: 'network' })).toBe('split');
    expect(executionRouteFor({ privacy: open, model: whole, executionLocation: 'network' })).toBe('remote');
    expect(executionRouteFor({ privacy: open, model: whole, executionLocation: 'auto' })).toBe('auto');
    expect(executionRouteFor({ privacy: open, model: { ...whole, fleet: {} }, executionLocation: 'network' })).toBe('auto');
    expect(['local', 'remote', 'split', 'auto'].map(locationForRoute)).toEqual(['local', 'network', 'network', 'auto']);
  });
});

describe('every browser route declares its charge', () => {
  const resolve = (earning, model, privacy = open, location = 'network') => createChatExecution({ earning, models: [model] })
    .resolveRoute({ model, permissions: { executionLocation: location, sharingScope: 'mesh' } }, { model: pin(model), policy: privacy });

  it('whole-model mesh answers are free; a staged model is free without earning and capped by the account with it', async () => {
    expect((await resolve(null, whole)).maxCharge).toEqual({ kind: 'free' });
    expect((await resolve(null, staged)).maxCharge).toEqual({ kind: 'free' });
    const ceiling = { kind: 'capped', maximum: 40, unit: 'credit' };
    expect((await resolve({ chargeCeiling: async () => ceiling }, staged)).maxCharge).toEqual(ceiling);
    // An earning port that cannot state its ceiling leaves the charge uncapped, which the inference API refuses.
    expect((await resolve({ run: async () => ({}) }, staged)).maxCharge).toBeUndefined();
  });

  it('the deferred earning port is free when the page has no earning service, and the account ceiling when it has one', async () => {
    expect(await deferredEarning(Promise.resolve(null)).chargeCeiling()).toEqual({ kind: 'free' });
    expect(await deferredEarning(Promise.reject(Error('no service'))).chargeCeiling()).toEqual({ kind: 'free' });
    const opened = { earning: { chargeCeiling: () => ({ kind: 'capped', maximum: 0, unit: 'credit' }) } };
    expect(await deferredEarning(Promise.resolve(opened)).chargeCeiling()).toEqual({ kind: 'capped', maximum: 0, unit: 'credit' });
  });
});

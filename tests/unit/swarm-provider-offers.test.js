// @vitest-environment node
/**
 * Provider availability comes only from active, unexpired offers (contracts/computer-records.js), never a role flag.
 * The `role` and `hasInference` fields stay on the wire for older peers, and an older peer that advertises only them
 * is read through the old-wire reader; a remote peer's own `offers` field is never trusted.
 */
import { describe, expect, it } from 'vitest';
import { inferenceOffer } from '../../packages/reploid/src/contracts/computer-records.js';
import { buildSwarmState, createPeerAdvertisement, createSwarmController, deriveSwarmRole } from '../../packages/reploid/src/mesh/swarm-coordination.js';

const ready = inferenceOffer({ readiness: 'ready', availableSlots: 1 });

describe('swarm roles follow offers', () => {
  it('derives this computer\'s role from an active inference offer', () => {
    expect(deriveSwarmRole({ swarmEnabled: true, offers: [ready], now: 0 })).toBe('provider');
    expect(deriveSwarmRole({ swarmEnabled: true, offers: [inferenceOffer({ readiness: 'ready', paused: true })], now: 0 })).toBe('consumer');
    expect(deriveSwarmRole({ swarmEnabled: true, offers: [inferenceOffer({ readiness: 'ready', expiresAt: 5 })], now: 5 })).toBe('consumer');
    expect(deriveSwarmRole({ swarmEnabled: true, offers: [inferenceOffer({ readiness: 'busy' })], now: 0 })).toBe('provider');
    expect(deriveSwarmRole({ swarmEnabled: false, offers: [ready], now: 0 })).toBe('solo');
    // Offers decide over a stale flag; without offers the flag is the caller's own configuration.
    expect(deriveSwarmRole({ swarmEnabled: true, hasInference: true, offers: [], now: 0 })).toBe('consumer');
    expect(deriveSwarmRole({ swarmEnabled: true, hasInference: true })).toBe('provider');
  });

  it('keeps role and hasInference on the wire, both following the offers', () => {
    expect(createPeerAdvertisement({ peerId: 'self', swarmEnabled: true, offers: [ready], now: 0 })).toMatchObject({ role: 'provider', hasInference: true });
    expect(createPeerAdvertisement({ peerId: 'self', swarmEnabled: true, hasInference: true, offers: [] })).toMatchObject({ role: 'consumer', hasInference: false });
    expect(createPeerAdvertisement({ peerId: 'self', swarmEnabled: true, offers: [ready] })).not.toHaveProperty('offers');
  });

  it('reads a remote peer\'s offers from its advertised fields, never its own offers field or role', () => {
    const swarm = createSwarmController();
    const forged = swarm.upsertPeer({ peerId: 'forged', role: 'provider', swarmEnabled: true, hasInference: false, readiness: 'idle', offers: [ready] });
    expect(forged.offers).toEqual([]);
    // An older peer that advertises only role and hasInference keeps its offer through the old-wire reader.
    const older = swarm.upsertPeer({ peerId: 'older', role: 'provider', swarmEnabled: true, hasInference: true, model: 'gpt', updatedAt: 1 });
    expect(older.offers).toEqual([inferenceOffer({ connectionId: 'older', readiness: 'ready', modelId: 'gpt' })]);
    const busy = swarm.upsertPeer({ peerId: 'busy', swarmEnabled: true, hasInference: true, readiness: 'ready', availableSlots: 0,
      modelIdentity: `sha256:${'1'.repeat(64)}` });
    expect(busy.offers.map(offer => offer.readiness)).toEqual(['busy']);
    expect(swarm.getState({ swarmEnabled: true }).providerCount).toBe(2);
    // Busy still provides (it is counted), but it is never chosen for new work.
    expect(swarm.chooseProvider()?.peerId).toBe('older');
    swarm.removePeer('older');
    expect(swarm.chooseProvider()).toBeNull();
  });

  it('counts providers only from active, unexpired offers', () => {
    const peers = [{ peerId: 'flag', role: 'provider', offers: [] },
      { peerId: 'expired', role: 'provider', offers: [inferenceOffer({ readiness: 'ready', expiresAt: 10 })] },
      { peerId: 'live', role: 'consumer', offers: [inferenceOffer({ readiness: 'ready', expiresAt: 11 })] }];
    expect(buildSwarmState({ peers, now: 10 }).providerCount).toBe(1);
  });
});

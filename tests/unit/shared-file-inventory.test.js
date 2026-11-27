// @vitest-environment node
/**
 * One shared-file inventory over the custody exchange's single offer list (artifacts/custody/shared-inventory.js):
 * the cached-model path and weight supply each set only their own files, the exchange offers their union, a file
 * both hold stays offered while either holds it, and pausing stops all serving from this device.
 */
import { describe, expect, it } from 'vitest';
import { SHARED_FILE_SOURCES, createSharedFileInventory } from '../../packages/reploid/src/artifacts/custody/shared-inventory.js';

const file = n => ({ path: `piece-${String(n).padStart(64, '0')}.bin`, role: 'model-weights', sizeBytes: 4096,
  hash: String(n).padStart(64, '0'), hashAlgorithm: 'sha256' });

function fakeExchange() {
  const calls = [];
  let sharing = false, offered = [];
  return { calls, get offered() { return offered; },
    getState: () => ({ sharing, offers: [], demand: [] }),
    offer(files, options) { calls.push(['offer', files.map(row => row.hash), options]); offered = files; sharing = true; },
    stopSupply() { calls.push(['stop']); sharing = false; offered = []; return Promise.resolve([]); },
    has: () => false, acquire: async () => { throw new Error('unused'); }, announceDemand() {} };
}

describe('createSharedFileInventory', () => {
  it('offers the union of both sources, each file with its sources, and neither source drops the other\'s files', () => {
    const exchange = fakeExchange();
    const inventory = createSharedFileInventory({ exchange, maxFiles: 16 });
    expect(SHARED_FILE_SOURCES).toEqual(['cached-model', 'weight-supply']);
    inventory.set('cached-model', [file(1), file(2)]);
    inventory.source('weight-supply').offer([file(2), file(3)], { revoke: false });
    expect(exchange.offered.map(row => row.hash)).toEqual([file(2), file(3), file(1)].map(row => row.hash));
    expect(inventory.getState().files.map(row => [row.hash.slice(-1), row.sources])).toEqual([
      ['2', ['cached-model', 'weight-supply']], ['3', ['weight-supply']], ['1', ['cached-model']]]);
    // The cached-model path stops: the weight-supply pieces (the shared one included) stay offered.
    inventory.set('cached-model', []);
    expect(exchange.offered.map(row => row.hash.slice(-1))).toEqual(['2', '3']);
    expect(inventory.getState().files.every(row => row.sources.join() === 'weight-supply')).toBe(true);
    // Weight supply drops its pieces: the cached path's files come back untouched when it shares again.
    inventory.set('cached-model', [file(1)]);
    inventory.source('weight-supply').offer([], { revoke: false });
    expect(exchange.offered.map(row => row.hash.slice(-1))).toEqual(['1']);
    inventory.set('cached-model', []);
    expect(exchange.calls.at(-1)).toEqual(['stop']);
    expect(inventory.getState()).toMatchObject({ paused: false, sharing: false, files: [] });
  });

  it('pausing (weight supply\'s stopSupply) stops all serving and offers nothing until resumed', () => {
    const exchange = fakeExchange();
    const inventory = createSharedFileInventory({ exchange, maxFiles: 16 });
    inventory.set('cached-model', [file(1)]);
    inventory.source('weight-supply').offer([file(2)]);
    inventory.source('weight-supply').stopSupply();
    expect(exchange.getState().sharing).toBe(false);
    expect(inventory.isServing(file(1))).toBe(false);
    // Changes while paused are kept, never offered.
    inventory.set('cached-model', [file(1), file(4)]);
    expect(exchange.getState().sharing).toBe(false);
    expect(inventory.getState()).toMatchObject({ paused: true, sharing: false });
    inventory.resume();
    expect(exchange.offered.map(row => row.hash.slice(-1)).sort()).toEqual(['1', '2', '4']);
    expect(inventory.isServing(file(4))).toBe(true);
    expect(inventory.isServing(file(9))).toBe(false);
  });

  it('bounds the offered list to the exchange limit, weight-supply pieces first', () => {
    const exchange = fakeExchange();
    const inventory = createSharedFileInventory({ exchange, maxFiles: 2 });
    inventory.set('cached-model', [file(1), file(2)]);
    inventory.set('weight-supply', [file(3)]);
    expect(exchange.offered.map(row => row.hash.slice(-1))).toEqual(['3', '1']);
    expect(inventory.getState().files.map(row => row.offered)).toEqual([true, true, false]);
    expect(() => inventory.set('other', [])).toThrow(/source/);
  });
});

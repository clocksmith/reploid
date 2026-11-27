// @vitest-environment node
/**
 * One contract, every surface: the same fixtures run through the parser each surface imports, so a surface that
 * restates a record, or a stale vendored copy, fails here. Surfaces: the published library, the browser host
 * (apps/poolday/host), the native hosts and CLI (server/computer-records.js) and the fleet HTTP service contract
 * (server/fleet/contract.js, which writes the ledger's computer directory).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as library from '../../packages/reploid/src/contracts/computer-records.js';
import * as browser from '../../apps/poolday/host/computer-records.js';
import * as native from '../../server/computer-records.js';
import * as http from '../../server/fleet/contract.js';

const { records } = JSON.parse(readFileSync(new URL('../fixtures/contracts/records.json', import.meta.url), 'utf8'));
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/contracts/wire.json', import.meta.url), 'utf8'));
const surfaces = Object.entries({ library, browser, native, http: http.computerRecords });

const outcome = (surface, run) => {
  try { return { value: run(surface) }; } catch (error) { return { error: error.code || error.message }; }
};

describe('computer, offer and operation-role records across surfaces', () => {
  it('every surface exposes the same contract', () => {
    for (const [, surface] of surfaces) {
      expect(surface.COMPUTER_SCHEMA).toBe('reploid.computer/1');
      expect(surface.OFFER_SCHEMA).toBe('reploid.offer/1');
      expect(surface.CONNECTION_ASSISTANCE_SCHEMA).toBe('reploid.connection-assistance/1');
      expect(surface.OPERATION_ROLES_SCHEMA).toBe('reploid.operation-roles/1');
      expect(Object.keys(surface).sort()).toEqual(Object.keys(library).sort());
    }
  });

  it.each(records.map(row => [row.name, row]))('%s', (name, row) => {
    for (const [surfaceName, surface] of surfaces) {
      expect(surface.recordProblems(row.schema, row.value).length === 0, `${surfaceName}: ${surface.recordProblems(row.schema, row.value)}`).toBe(row.valid);
      const parsed = outcome(surface, s => s.parseRecord(row.value));
      if (row.valid) expect(parsed, surfaceName).toEqual({ value: row.value });
      else expect(parsed, surfaceName).toEqual({ error: 'CONTRACT_INVALID' });
    }
  });

  it.each(cases.map(row => [row.name, row]))('old wire: %s', (name, row) => {
    for (const [surfaceName, surface] of surfaces) {
      const result = surface[row.reader](row.input, row.options);
      expect(result, surfaceName).toEqual(row.expected);
      if (result) expect(surface.parseRecord(result), surfaceName).toEqual(result);
    }
  });

  it('provider availability derives from an active, unexpired offer', () => {
    const computer = library.parseComputer(records.find(row => row.name.startsWith('browser computer')).value);
    expect(library.providesNow(computer, 'inference', 0)).toBe(true);
    expect(library.providesNow(computer, 'weight-supply', 0)).toBe(true);
    const paused = { ...computer, offers: computer.offers.map(offer => offer.kind === 'inference' ? { ...offer, paused: true } : offer) };
    expect(library.providesNow(paused, 'inference', 0)).toBe(false);
    expect(library.providesNow(paused, 'weight-supply', 0)).toBe(true);
    const expiring = library.inferenceOffer({ readiness: 'ready', expiresAt: 100 });
    expect(library.isOfferActive(expiring, 99)).toBe(true);
    expect(library.isOfferActive(expiring, 100)).toBe(false);
    expect(library.isOfferActive(library.inferenceOffer({ readiness: 'preparing' }), 0)).toBe(false);
  });

  it('shared predicates', () => {
    expect(library.isParticipantId('peer:0123456789abcdef01234567')).toBe(true);
    expect(library.isParticipantId('peer:0123456789ABCDEF01234567')).toBe(false);
    expect(library.isParticipantId('peer:0123456789abcdef0123456789')).toBe(false);
    expect(library.isDigest(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(library.isDigest('a'.repeat(64))).toBe(false);
    expect(library.digestHex(`sha256:${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    expect(library.toDigest('a'.repeat(64))).toBe(`sha256:${'a'.repeat(64)}`);
    expect(library.toDigest('xyz')).toBe(null);
    expect(library.isComputerId('mac', 'ledger-enrollment')).toBe(true);
    expect(library.isComputerId('mac', 'signing-key')).toBe(false);
    expect(library.isConnectionId('own-compute')).toBe(true);
    expect(library.isConnectionId('peer:0123456789abcdef01234567')).toBe(false);
  });
});

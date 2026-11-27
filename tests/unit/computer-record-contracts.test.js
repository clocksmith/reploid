// @vitest-environment node
/**
 * One contract, every surface: the same fixtures run through the parser each surface imports, so a surface that
 * restates a record, or a stale vendored copy, fails here. Surfaces: the published library, the browser host
 * (apps/poolday/host), the native hosts and CLI (server/computer-records.js) and the fleet HTTP service contract
 * (server/fleet/contract.js, which writes the ledger's computer directory). The same fixtures also run through the
 * surfaces' routing (provider choice, catalog admission, the CLI roster), the request outcome's operation roles and
 * the device pane's reading of this device's offers.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as library from '../../packages/reploid/src/contracts/computer-records.js';
import * as browser from '../../apps/poolday/host/computer-records.js';
import * as native from '../../server/computer-records.js';
import * as http from '../../server/fleet/contract.js';
import { buildSwarmState, chooseProviderPeer } from '../../packages/reploid/src/mesh/swarm-coordination.js';
import { rankProviderPeers } from '../../packages/reploid/src/mesh/contribution.js';
import { projectChatCatalog, projectProviderEligibility } from '../../apps/poolday/host/chat-view.js';
import { meshRoster } from '../../server/native-node-peers.js';
import { buildFleetRequestOutcome } from '../../server/fleet/requester.js';
import { projectComputers } from '../../apps/poolday/host/decisions/computers.js';

const { records } = JSON.parse(readFileSync(new URL('../fixtures/contracts/records.json', import.meta.url), 'utf8'));
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/contracts/wire.json', import.meta.url), 'utf8'));
const projections = JSON.parse(readFileSync(new URL('../fixtures/contracts/projections.json', import.meta.url), 'utf8')).cases;
const routing = JSON.parse(readFileSync(new URL('../fixtures/contracts/routing.json', import.meta.url), 'utf8'));
const operations = JSON.parse(readFileSync(new URL('../fixtures/contracts/operations.json', import.meta.url), 'utf8'));
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

  it.each(projections.map(row => [row.name, row]))('projection: %s', (name, row) => {
    for (const [surfaceName, surface] of surfaces) expect(surface[row.reader](...row.args), surfaceName).toEqual(row.expected);
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

  describe('routing: a current offer can have zero capacity', () => {
    const { model, now, peers, connections, expected } = routing;
    const ids = rows => rows.map(row => row.peerId);
    const withoutReady = peers.filter(peer => peer.peerId !== 'ready');

    it('every surface reads the same offers: offering compute and having capacity are separate facts', () => {
      for (const [surfaceName, surface] of surfaces) {
        const availability = peer => surface.offerAvailability({ offers: surface.offersOfPeer(peer) }, 'inference', now);
        expect(ids(peers.filter(peer => availability(peer).offered)), surfaceName).toEqual(expected.offering);
        expect(ids(peers.filter(peer => surface.providesNow({ offers: surface.offersOfPeer(peer) }, 'inference', now))), surfaceName).toEqual(expected.providers);
        expect(ids(peers.filter(peer => availability(peer).available)), surfaceName).toEqual(expected.selectable);
      }
    });

    it('library: providers are counted from active offers and only one with capacity is chosen', () => {
      expect(buildSwarmState({ peers, now }).providerCount).toBe(expected.providers.length);
      expect(ids(rankProviderPeers(peers, { now })).sort()).toEqual([...expected.providers].sort());
      expect(chooseProviderPeer(peers, { now })?.peerId).toBe('ready');
      expect(chooseProviderPeer(withoutReady, { now })).toBeNull();
    });

    it('browser host: catalog admission lists a busy provider without sending to it and never a paused or expired one', () => {
      const decisions = projectProviderEligibility({ model, peers, connections, now });
      expect(ids(decisions)).toEqual(expected.listed);
      expect(ids(decisions.filter(row => row.stage === null))).toEqual(expected.selectable);
      expect(Object.fromEntries(decisions.map(row => [row.peerId, row.reason]))).toMatchObject({ busy: 'busy', failed: 'not-loaded', paused: 'no-inference', expired: 'no-inference' });
      const [route] = projectChatCatalog({ models: [model], peers, connections, now });
      expect(route).toMatchObject({ availability: 'ready', providerIds: ['ready', 'busy'], reachableProviderIds: expected.selectable });
      const [rest] = projectChatCatalog({ models: [model], peers: withoutReady, connections, now });
      expect(rest).toMatchObject({ availability: 'busy', providerIds: ['busy'], reachableProviderIds: expected.withoutReady.selectable });
    });

    it('native hosts and CLI: the roster lists every provider and marks only one with capacity ready', () => {
      const roster = meshRoster({ peers, connections }, { catalog: [model], now });
      expect(ids(roster.rows).sort()).toEqual([...expected.listed].sort());
      expect(ids(roster.rows.filter(row => row.state === 'ready'))).toEqual(expected.selectable);
      expect(Object.fromEntries(roster.rows.map(row => [row.peerId, row.state]))).toMatchObject({ busy: 'busy', failed: 'not-serving', paused: 'not-usable', expired: 'not-usable' });
      expect(meshRoster({ peers: withoutReady, connections }, { catalog: [model], now }).summary.ready).toBe(0);
    });
  });

  it.each(operations.outcomes.map(row => [row.name, row]))('request outcome: %s', (name, row) => {
    const outcome = buildFleetRequestOutcome(row.input);
    expect(outcome.schema).toBe('reploid.request-outcome/v1');
    expect(outcome.operationRoles).toEqual(row.expected);
    // The roles sit beside the provider fields they restate, and parse as the same record on every surface.
    if (row.expected) for (const [surfaceName, surface] of surfaces) expect(surface.parseOperationRoles(outcome.operationRoles), surfaceName).toEqual(row.expected);
  });

  it.each(operations.devices.map(row => [row.name, row]))('device state: %s', (name, row) => {
    const device = projectComputers({ models: [], network: { consumer: { connectionState: 'connected', peers: [] }, ...row.network } }).device;
    expect(device).toMatchObject(row.expected);
    for (const [surfaceName, surface] of surfaces) {
      for (const offer of row.network.localOffers) expect(surface.parseOffer(offer), surfaceName).toEqual(offer);
      // A switch is on exactly while its offer stands unpaused, on every surface's reading of the record.
      const stands = kind => surface.isOfferCurrent(row.network.localOffers.find(offer => offer.kind === kind) ?? null, 0);
      expect([stands('inference'), stands('weight-supply')], surfaceName).toEqual([row.expected.computeOn, row.expected.filesOn]);
      expect(surface.parseConnectionAssistance(row.network.connectionAssistance).enabled, surfaceName).toBe(row.expected.introductions);
    }
  });
});

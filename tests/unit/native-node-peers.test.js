// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askableRoute } from '../../server/native-node-ask.js';
import { nativeCommand } from '../../server/native-node-commands.js';
import { meshRoster, observePeers, peersText } from '../../server/native-node-peers.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';

const approvals = vi.hoisted(() => []);
vi.mock('../../apps/poolday/config/partition-releases.json', () => ({ default: { approvals } }));
afterEach(() => { approvals.length = 0; });

const NOW = 1_800_000_000_000;
const hash = letter => 'sha256:' + letter.repeat(64);
const identity = digit => 'peer:' + digit.repeat(24);
const catalog = [
  { id: 'small-model', name: 'Small', identity: hash('a'), adapters: [], supersedes: [{ id: 'small-model-old', identity: hash('b') }] },
  { id: 'large-model', name: 'Large', identity: hash('c'), adapters: [] },
];
const shortNames = { 'small-model': 'small' };
// One advertisement as a requester's network state lists it: a computer that offers nothing.
const advert = (peerId, digit, fields = {}) => ({ peerId, attemptId: 'attempt-' + peerId, role: 'consumer', readiness: 'idle',
  activity: { phase: 'idle' }, hasInference: false, capabilities: ['generation'], model: null, modelIdentity: null, executionOffers: [],
  availableSlots: 0, queuedJobs: 0, hardware: null, preparation: null, identityProtocol: 1, admissionProtocol: 2,
  participantId: identity(digit), identityVerified: true, updatedAt: NOW - 3000, ...fields });
const offer = modelIdentity => ({ schema: 'reploid.execution-offer/v1', id: 'ordinary-generation', backend: 'doppler-plaintext/v1',
  kind: 'plaintext', modelIdentities: [modelIdentity] });
const provider = (peerId, digit, fields = {}) => advert(peerId, digit, { role: 'provider', readiness: 'ready', hasInference: true,
  model: 'small-model', modelIdentity: hash('a'), executionOffers: [offer(hash('a'))], availableSlots: 1,
  hardware: { vendor: 'example', architecture: 'arch-1', device: 'Example GPU 1', description: 'Example driver 1.0' }, ...fields });
const large = { model: 'large-model', modelIdentity: hash('c'), executionOffers: [offer(hash('c'))] };
// This node's open connection to the computer that sent an advertisement.
const link = peerId => ({ id: peerId, attemptId: 'attempt-' + peerId, phase: 'connected', channelState: 'open', iceState: 'connected' });
// A stage description as partition discovery keeps it.
const described = (peerId, digit, description) => ({ transportId: peerId, participantId: identity(digit), observedAt: NOW - 1000,
  expiresAt: NOW + 9000, available: true, reason: 'observed',
  description: { schema: 'reploid.partition-capability/v2', participantId: identity(digit), ...description } });
const roster = (peers, extra = {}, options = {}) => meshRoster({ peers, connections: peers.map(peer => link(peer.peerId)), ...extra },
  { now: NOW, catalog, shortNames, ...options });
const row = (result, peerId) => result.rows.find(entry => entry.peerId === peerId);
// What ask itself finds when this is the only computer in the room: the requester its participant reads.
const askFinds = (peer, connection) => createWholeModelRequester({ mesh: { getSwarmSnapshot: () => ({ peers: [peer], connections: [connection] }) },
  models: catalog }).getModels().some(route => askableRoute(route, 'public-pool'));

describe('reploid peers: the roster', () => {
  it('counts a provider ready by the rule ask routes with, not by its own word', () => {
    const peers = [provider('c-ready', '1'), provider('c-full', '2', { availableSlots: 0 }),
      provider('c-old', '3', { model: 'small-model-old', modelIdentity: hash('b'), executionOffers: [offer(hash('b'))] }),
      provider('c-closed', '4')];
    const connections = peers.map(peer => ({ ...link(peer.peerId), ...(peer.peerId === 'c-closed' ? { channelState: 'closed' } : {}) }));
    const result = meshRoster({ peers, connections }, { now: NOW, catalog, shortNames });
    expect(Object.fromEntries(result.rows.map(entry => [entry.peerId, [entry.model, entry.state, entry.detail]]))).toEqual({
      'c-ready': ['small-model', 'ready', null], 'c-full': ['small-model', 'busy', 'no free slot'],
      'c-old': ['small-model', 'not-usable', 'earlier release of the model'], 'c-closed': ['small-model', 'not-usable', 'no open channel'] });
    expect(row(result, 'c-old').earlierRelease).toBe(true);
    peers.forEach((peer, index) => expect(row(result, peer.peerId).state === 'ready', peer.peerId).toBe(askFinds(peer, connections[index])));
    expect(result.summary).toEqual({ computers: 4, visible: 4, ready: 1, pending: 0,
      models: [{ model: 'small-model', short: 'small', computers: 4, ready: 1 }] });
  });

  it('names a model given only as an execution offer hash, and counts it ready only with the id ask matches', () => {
    const hashOnly = provider('c-hash', '5', { model: null, modelIdentity: null, executionOffers: [offer(hash('c'))] });
    const result = roster([hashOnly]);
    expect(row(result, 'c-hash')).toMatchObject({ role: 'provider', serves: 'whole', model: 'large-model', short: null, modelIdentity: hash('c'),
      inCatalog: true, freeSlots: 1, state: 'not-usable', detail: 'no model id advertised' });
    expect(askFinds(hashOnly, link('c-hash'))).toBe(false);
    expect(result.summary.models).toEqual([{ model: 'large-model', short: null, computers: 1, ready: 0 }]);
    const named = provider('c-hash', '5', large);
    expect(row(roster([named]), 'c-hash').state).toBe('ready');
    expect(askFinds(named, link('c-hash'))).toBe(true);
  });

  it('separates loading, connected only, sharing files only and a split stage', () => {
    const peers = [advert('c-loading', '1', { readiness: 'loading', model: 'large-model', preparation: { kind: 'downloading', receivedBytes: 25, totalBytes: 100 } }),
      advert('c-requester', '2'), advert('c-files', '3'), advert('c-stage', '4')];
    const stages = [
      described('c-stage', '4', { offer: { id: 'large-model', identity: hash('c') }, index: 1, phase: 'ready',
        models: [{ id: 'large-model', identity: hash('c'), availability: 'ready' }], capacity: { active: 0, availableSlots: 2, closed: false } }),
      // A requester answers the same question and offers no stage.
      described('c-requester', '2', { offer: null, index: null, phase: 'idle', models: [], capacity: { active: 0, availableSlots: 0, closed: true } })];
    const result = roster(peers, { stages, fileSuppliers: ['c-files'] });
    expect(Object.fromEntries(result.rows.map(entry => [entry.peerId, [entry.role, entry.model, entry.serves, entry.stage, entry.state, entry.detail]]))).toEqual({
      'c-loading': ['provider', 'large-model', 'whole', null, 'loading', 'downloading 25%'],
      'c-stage': ['provider', 'large-model', 'stage', 1, 'stage-ready', null],
      'c-files': ['consumer', null, null, null, 'files-only', null],
      'c-requester': ['consumer', null, null, null, 'connected', null] });
    expect(row(result, 'c-stage').freeSlots).toBe(2);
    expect(result.summary).toMatchObject({ computers: 4, ready: 0 });
    // Without an observation of who offers files, nobody is called a file sharer.
    expect(row(roster(peers, { stages }), 'c-files')).toMatchObject({ state: 'connected', sharesFiles: null });
  });

  it('counts a split stage ready only where ask could use its whole route', () => {
    const peers = [advert('c-first', '6'), advert('c-last', '4')];
    const stage = (peerId, digit, index) => described(peerId, digit, { offer: { id: 'large-model', identity: hash('c') }, index, phase: 'ready',
      models: [], capacity: { active: 0, availableSlots: 1, closed: false } });
    const route = { id: 'large-model', identity: hash('c'), availability: 'ready',
      partition: { planId: 'plan', participantA: identity('6'), participantB: identity('4') } };
    const observed = { stages: [stage('c-first', '6', 0), stage('c-last', '4', 1)], routes: [route] };
    const states = result => result.rows.map(entry => [entry.stage, entry.state]);
    expect(states(roster(peers, observed))).toEqual([[0, 'stage-ready'], [1, 'stage-ready']]);
    expect(states(roster(peers, observed, { executionClass: 'private-pool' }))).toEqual([[0, 'ready'], [1, 'ready']]);
    approvals.push({ modelId: route.id, modelIdentity: route.identity, adapterIdentities: [], partition: route.partition, evidence: 'fixture://operator-review' });
    expect(roster(peers, observed).summary).toMatchObject({ ready: 2, models: [{ model: 'large-model', computers: 2, ready: 2 }] });
  });

  it('summarises computers, ready computers and ready computers per model, and counts connections that have not answered', () => {
    const peers = [provider('c-small', '1'), provider('c-small-full', '2', { availableSlots: 0 }), provider('c-large', '3', large),
      advert('c-large-loading', '4', { readiness: 'loading', model: 'large-model' }), advert('c-requester', '5')];
    const connections = [...peers.map(peer => link(peer.peerId)), link('c-silent'), { ...link('c-gone'), phase: 'disconnected' }];
    expect(meshRoster({ peers, connections }, { now: NOW, catalog, shortNames }).summary).toEqual({ computers: 5, visible: 5, ready: 2, pending: 1,
      models: [{ model: 'small-model', short: 'small', computers: 2, ready: 1 }, { model: 'large-model', short: null, computers: 2, ready: 1 }] });
  });

  it('keeps one model by any name ask accepts and still says how many computers are visible', () => {
    const asked = name => nativeCommand(['ask', name, 'hello']).args[0];
    for (const name of ['2b', '0.8b', '27b', 'qwen-3-5-2b-q4k-ehaf16']) {
      expect(nativeCommand(['peers', name])).toMatchObject({ args: [asked(name), '--connect-only'], peers: { model: asked(name), json: false } });
    }
    expect(nativeCommand(['peers', '--model', '2b', '--json', '--wait-ms', '1500']).peers).toEqual({ model: asked('2b'), json: true, waitMs: 1500 });
    expect(nativeCommand(['peers'])).toMatchObject({ args: ['--connect-only'], peers: { model: null, json: false } });
    expect(() => nativeCommand(['peers', 'typo'])).toThrow('reploid models');
    expect(() => nativeCommand(['peers', '2b', '27b'])).toThrow('one model');

    const peers = [provider('c-small', '1'), provider('c-large', '2', large), advert('c-requester', '3')];
    const small = roster(peers, {}, { model: 'small-model' });
    expect(small.rows.map(entry => entry.peerId)).toEqual(['c-small']);
    expect(small.summary).toEqual({ computers: 1, visible: 3, ready: 1, pending: 0, models: [{ model: 'small-model', short: 'small', computers: 1, ready: 1 }] });
    expect(peersText(small).split('\n')[0]).toBe('1 computer for small (3 visible), 1 ready to serve: small 1.');
    // A model nobody serves is still counted, as zero.
    expect(roster([advert('c-requester', '3')], {}, { model: 'large-model' }).summary).toEqual({ computers: 0, visible: 1, ready: 0, pending: 0,
      models: [{ model: 'large-model', short: null, computers: 0, ready: 0 }] });
  });

  it('joins as connect does, bounds the wait and keeps a separate identity\'s state beside it', () => {
    expect(nativeCommand(['peers', '--room', 'reploid-swarm-lab', '--identity-file', '/state/identity.json']).args)
      .toEqual(['--connect-only', '--room', 'reploid-swarm-lab', '--identity-file', '/state/identity.json', '--model-directory', '/state/weights']);
    for (const value of ['0', '999', '600000', '2s', '1e4']) expect(() => nativeCommand(['peers', '--wait-ms', value]), value).toThrow('--wait-ms');
    expect(() => nativeCommand(['peers', '--contribute'])).toThrow('Unknown option');
    expect(nativeCommand(['help', 'peers']).text).toContain('--wait-ms');
    expect(nativeCommand(['--help']).text).toMatch(/^ {2}peers\s+\S/m);
  });

  it('is one reploid.peers/v1 object with the capture time, the summary and the rows', () => {
    const result = JSON.parse(JSON.stringify(roster([provider('c-ready', '1')])));
    expect(Object.keys(result)).toEqual(['schema', 'capturedAt', 'model', 'summary', 'rows']);
    expect(result).toMatchObject({ schema: 'reploid.peers/v1', capturedAt: new Date(NOW).toISOString(), model: null });
    expect(result.rows).toEqual([{ participantId: identity('1'), shortId: '11111111', identityVerified: true, sameIdentity: false, peerId: 'c-ready',
      role: 'provider', advertisedRole: 'provider', model: 'small-model', short: 'small', modelIdentity: hash('a'), inCatalog: true,
      earlierRelease: false, serves: 'whole', stage: null, state: 'ready', detail: null, freeSlots: 1, queuedJobs: 0, sharesFiles: null,
      hardware: { vendor: 'example', architecture: 'arch-1', device: 'Example GPU 1', description: 'Example driver 1.0' },
      updatedAt: NOW - 3000, lastSeenMs: 3000 }]);
  });

  it('leaves out this command\'s own connection and keeps another process that proves the same identity', () => {
    const peers = [provider('c-self', '9'), provider('c-other', '9'), advert('c-requester', '2')];
    const stages = [described('c-self', '9', { offer: { id: 'large-model', identity: hash('c') }, index: 0, phase: 'ready', models: [] })];
    const result = roster(peers, { stages }, { self: { peerId: 'c-self', participantId: identity('9') } });
    expect(result.rows.map(entry => entry.peerId)).toEqual(['c-other', 'c-requester']);
    expect(result.rows.map(entry => entry.sameIdentity)).toEqual([true, false]);
    expect(result.summary).toMatchObject({ computers: 2, visible: 2, ready: 1, pending: 0 });
    expect(peersText(result)).toContain('99999999 (yours)');
  });

  it('prints the summary line first, one row per computer, and only printable text from other computers', () => {
    const text = peersText(roster([provider('c-ready', '1'),
      provider('c-odd', '2', { model: '\u001b[31mred\u0007', modelIdentity: hash('d'), executionOffers: [], hardware: { description: 'GPU\u001b]0;title\u0007' } }),
      advert('c-requester', '3', { participantId: null, identityVerified: false })]));
    const lines = text.split('\n');
    expect(lines[0]).toBe('3 computers, 1 ready to serve: small 1, ?[31mred? 0.');
    expect(lines[2]).toMatch(/^ROLE\s+SHORT\s+MODEL\s+SERVES\s+STATE\s+FREE\s+HARDWARE\s+LAST SEEN\s+ID$/);
    expect(lines[3]).toMatch(/^provider\s+small\s+small-model\s+whole\s+ready to serve\s+1\s+Example GPU 1\s+3s ago\s+11111111$/);
    expect(lines[4]).toMatch(/^provider\s+-\s+\?\[31mred\?\s+whole\s+reports ready, not usable: model not in this catalog\s+1\s+GPU\?\]0;title\?\s+3s ago\s+22222222$/);
    expect(lines[5]).toMatch(/^consumer\s+-\s+-\s+-\s+connected only\s+-\s+-\s+3s ago\s+\(unproven\)$/);
    expect(text).toContain('only shares files is listed as connected only');
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    // The device name is the hardware; without one the vendor and architecture are, and the driver text is not.
    const unnamed = { vendor: 'example', architecture: 'arch-2', device: 'unknown', description: 'Example driver 2.0' };
    expect(peersText(roster([provider('c-unnamed', '4', { hardware: unnamed })]))).toMatch(/\s1\s+example arch-2\s+3s ago/);
    expect(peersText(roster([]))).toBe('0 computers, 0 ready to serve.');
  });
});

describe('reploid peers: the bounded wait', () => {
  const participant = network => ({ identity: identity('9'), roomId: 'reploid-swarm-test', executionClass: 'public-pool',
    getNetworkState: network, getState: () => ({ capabilities: [], models: [] }), getCustodyCertificate: async () => ({ custodyPeerId: 'c-self' }) });
  const quick = { pollMs: 5, quietMs: 20, catalog, shortNames };

  it('fails plainly when signaling was not joined within the wait', async () => {
    await expect(observePeers(participant(() => ({ connectionState: 'retrying', peers: [], connections: [] })), { ...quick, waitMs: 40 }))
      .rejects.toThrow('Could not reach signaling for room reploid-swarm-test');
  });

  it('returns an empty roster for an empty room once it has been quiet', async () => {
    const result = await observePeers(participant(() => ({ connectionState: 'connected', peers: [], connections: [] })), { ...quick, waitMs: 4000 });
    expect(result).toMatchObject({ schema: 'reploid.peers/v1', room: 'reploid-swarm-test', summary: { computers: 0, ready: 0, pending: 0 }, rows: [] });
    expect(result.waitedMs).toBeLessThan(4000);
  });

  it('waits for a connected computer to advertise, and leaves out its own connection', async () => {
    let polls = 0;
    const network = () => ({ connectionState: 'connected', connections: [link('c-late'), link('c-self')],
      peers: ++polls > 3 ? [provider('c-late', '1'), provider('c-self', '9')] : [] });
    const result = await observePeers(participant(network), { ...quick, waitMs: 4000 });
    expect(result.rows.map(entry => [entry.peerId, entry.state])).toEqual([['c-late', 'ready']]);
    expect(result.summary.pending).toBe(0);
  });

  it('stops at the bound when a computer never answers, and says so', async () => {
    const result = await observePeers(participant(() => ({ connectionState: 'connected', peers: [], connections: [link('c-silent')] })), { ...quick, waitMs: 60 });
    expect(result.summary).toMatchObject({ computers: 0, pending: 1 });
    expect(peersText(result)).toContain('1 more computer had not answered');
    const stopped = new AbortController();
    stopped.abort(new Error('Request cancelled'));
    await expect(observePeers(participant(() => ({ connectionState: 'connected', peers: [], connections: [] })), { ...quick, signal: stopped.signal }))
      .rejects.toThrow('Request cancelled');
  });
});

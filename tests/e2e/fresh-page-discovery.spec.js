import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import rtcModule from '@roamhq/wrtc';
import { WebSocket } from 'ws';
import { CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createRoomIntroductionAdmission, createSwarmTransport } from '../../packages/reploid/src/transport/index.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { privateRoom } from '../fixtures/current-contribution.js';

// The replo.id shape of 2026-11-25: computers in the room, one long-lived browser already connected to all of
// them (it forwards introductions), then fresh pages. Each computer answers offers slowly and takes no
// introductions, so a page that trades its opening direct negotiation for an introduction never lists it.
// The computers are local Node peers with a stub generator; nothing here claims inference.
const rtc = rtcModule.default ?? rtcModule;
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODELS = CANONICAL_CHAT_MODELS.slice(0, 3);
const LOADS = Number(process.env.REPLOID_FRESH_LOADS || 5);

async function startComputer({ model, baseURL, roomId, token }) {
  const url = new URL(bootstrap.path, baseURL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('scope', 'private');
  url.searchParams.set('roomId', roomId);
  class OriginWebSocket extends WebSocket {
    constructor(target, protocols) { super(target, protocols, { headers: { origin: new URL(baseURL).origin } }); }
  }
  const config = resolveConfig({ overrides: {
    mesh: { enabled: true, executeJobs: true, roomId, maxInboundJobs: 1 },
    webrtc: { signalingUrl: url.href, broadcastRoomId: roomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } } } });
  const hub = new EventEmitter();
  const events = { emit: hub.emit.bind(hub), on(name, fn) { hub.on(name, fn); return () => hub.off(name, fn); } };
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const admission = createRoomIntroductionAdmission({ roomId, token });
  // Sorts above any fresh page's ID, so the page is the side that would introduce this computer.
  const peerId = 'ffffffff' + randomUUID().slice(8);
  const mesh = createPeerGenerationMesh({ config, ports: {
    instanceId: `computer-${randomUUID()}`, modelConfig: { id: model.id }, admitsBeforeDisclosure: true,
    getExecutionState: () => ({ phase: 'ready', modelIdentity: model.identity, adapterIdentities: [] }),
    identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
    events, eventBus: events, utils: { logger, generateId: prefix => `${prefix}:${randomUUID()}` },
    authorize: async () => true,
    generate: async () => ({ model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'stub',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 1, generatedTokenCount: 1, stopReason: 'eos-token' } }),
    createTransport: () => createSwarmTransport({ Utils: { logger, generateId: () => peerId }, EventBus: events, config, ...rtc, peerId,
      WebSocket: OriginWebSocket, getSessionId: () => peerId,
      // A loaded computer prepares each answer late, so the long-lived browser's channel opens first.
      getRtcConfig: async () => { await sleep(1500); return { iceServers: [] }; },
      getRoomCredentials: () => ({ roomId, token }),
      introductions: { getIdentity: () => identity, createAdmission: admission.create,
        authorize: async request => request.roomId === roomId && !['forward', 'connect'].includes(request.action) } })
  } });
  await mesh.connect();
  return mesh;
}

async function sharedModels(page) {
  await page.locator('[data-open-model]').first().click();
  await page.locator('[data-execution-choice=network]').click();
  return page.locator('[data-model-picker] [data-choice-group=shared] [data-model-choice]');
}

async function readyModels(rows) {
  return (await rows.evaluateAll(nodes => nodes.filter(node => /Ready/.test(node.textContent))
    .map(node => node.getAttribute('data-model-choice')))).sort();
}

test('every fresh page lists every computer in the room while another browser introduces them', async ({ browser, baseURL }) => {
  test.setTimeout(240000);
  const room = privateRoom('fresh-discovery');
  const params = new URL(room, baseURL).searchParams;
  // The page joins its invitation's room under the private-room prefix (swarm-join-policy.js).
  const roomId = `reploid-swarm-${params.get('swarm')}`, token = params.get('swarmToken');
  const computers = [];
  try {
    for (const model of MODELS) computers.push(await startComputer({ model, baseURL, roomId, token }));
    const expected = MODELS.map(model => model.id).sort();

    // The long-lived browser joins after the computers; its own connections are direct.
    const resident = await browser.newContext();
    const residentPage = await resident.newPage();
    await residentPage.goto(room);
    const residentRows = await sharedModels(residentPage);
    await expect.poll(() => readyModels(residentRows), { timeout: 60000 }).toEqual(expected);

    const loads = [];
    for (let load = 0; load < LOADS; load++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const cannotSend = [];
      page.on('console', message => { if (message.text().includes('Cannot send')) cannotSend.push(message.text()); });
      const started = Date.now();
      await page.goto(room);
      const rows = await sharedModels(page);
      let listed = [];
      while (Date.now() - started < 25000) {
        listed = await readyModels(rows);
        if (listed.length === expected.length) break;
        await sleep(250);
      }
      loads.push({ load, listed, ms: Date.now() - started, cannotSend: cannotSend.length });
      await context.close();
    }
    console.log(JSON.stringify(loads));
    expect(loads.map(({ listed }) => listed)).toEqual(loads.map(() => expected));
    expect(loads.map(({ cannotSend }) => cannotSend)).toEqual(loads.map(() => 0));
    await resident.close();
  } finally {
    for (const mesh of computers) await mesh.close().catch(() => {});
  }
});

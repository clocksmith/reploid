// @vitest-environment node
// Fresh pages joining a public room on the real signaling server, over real WebRTC, while another
// browser that forwards introductions is already connected to every computer (the replo.id shape of
// 2026-11-25: three of five computers stayed hidden from most fresh pages). Each computer answers offers
// slowly and takes no introductions, so a page that trades its opening direct negotiation for an
// introduction never reaches it.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import rtcModule from '@roamhq/wrtc';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

const rtc = rtcModule.default ?? rtcModule;
class OriginWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers: { origin: 'http://localhost:8000' } }); }
}
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Peer IDs ordered so the page is the side that would introduce the computers (it sorts below them).
const idWith = prefix => prefix + randomUUID().slice(prefix.length);

let httpServer, signalingServer, signalingUrl;
const running = [];

beforeAll(async () => {
  signalingServer = new PublicSwarmServer({ logger, bootstrap: { ...bootstrap, allowLoopbackOrigins: true } });
  httpServer = http.createServer();
  httpServer.on('upgrade', (req, socket, head) => signalingServer.handleUpgrade(req, socket, head));
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const url = new URL(`ws://127.0.0.1:${httpServer.address().port}${bootstrap.path}`);
  url.searchParams.set('scope', 'public');
  url.searchParams.set('roomId', bootstrap.publicRoomId);
  signalingUrl = url.href;
});
afterAll(async () => {
  for (const swarm of running.splice(0)) swarm.disconnect();
  signalingServer?.close?.();
  await new Promise(resolve => httpServer ? httpServer.close(resolve) : resolve());
});

async function peer({ peerId, answerDelayMs = 0, forwards = false, takesIntroductions = true }) {
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: bootstrap.publicRoomId },
    webrtc: { signalingUrl, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } } } });
  const swarm = createWebRTCSwarm({ config, peerId, ...rtc, WebSocket: OriginWebSocket, getSessionId: () => peerId,
    // A computer under load prepares its answer late, so the other browser's channel opens first.
    getRtcConfig: async () => { if (answerDelayMs) await sleep(answerDelayMs); return { iceServers: [] }; },
    getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }),
    introductions: { getIdentity: () => identity,
      authorize: async request => {
        if (request.action === 'forward') return forwards;
        if (request.action === 'connect') return takesIntroductions;
        return true;
      } },
    Utils: { logger, generateId: () => peerId }, EventBus: { emit() {} } });
  running.push(swarm);
  expect(await swarm.init()).toBe(true);
  return swarm;
}

const connectedIds = swarm => swarm.getConnectedPeers().map(item => item.id);

it('every fresh page reaches every computer while another browser introduces them', async () => {
  const computers = [];
  for (const prefix of ['a', 'b', 'c']) {
    const peerId = idWith(prefix);
    computers.push({ peerId, swarm: await peer({ peerId, answerDelayMs: 1200, takesIntroductions: false }) });
  }
  // The long-lived browser joins after the computers, so its own connections are direct and open.
  const browser = await peer({ peerId: idWith('0'), forwards: true });
  await expect.poll(() => connectedIds(browser).length, { timeout: 15000 }).toBe(computers.length);

  const loads = [];
  for (let load = 0; load < 4; load++) {
    const started = Date.now();
    const page = await peer({ peerId: idWith('1') });
    let reached = [];
    while (Date.now() - started < 12000) {
      reached = computers.filter(({ peerId }) => connectedIds(page).includes(peerId)).map(({ peerId }) => peerId[0]);
      if (reached.length === computers.length) break;
      await sleep(100);
    }
    loads.push({ load, reached: reached.join(''), ms: Date.now() - started });
    page.disconnect();
    running.splice(running.indexOf(page), 1);
    await sleep(300);
  }
  expect(loads.map(({ reached }) => reached)).toEqual(loads.map(() => 'abc'));
}, 120000);

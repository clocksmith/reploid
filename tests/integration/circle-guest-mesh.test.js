// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import rtcModule from '@roamhq/wrtc';
import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';
import { CANONICAL_CHAT_MODELS, createChatSession } from '../../apps/poolday/host/chat-session.js';
import { parseCircleInviteUrl } from '../../apps/poolday/host/circle-invites.js';
import { createWorkSwarm } from '../../apps/poolday/host/work-swarm.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createRoomIntroductionAdmission, createSwarmTransport, ownerPairingRoomMarker } from '../../packages/reploid/src/transport/index.js';
import { createGuestAccess, createHostRequesterRule } from '../../server/circles/guest-access.js';
import { openCircleInvites } from '../../server/circles/invites.js';
import { guestInviteLink } from '../../server/circles/owner-pairing-terminal.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

const rtc = rtcModule.default ?? rtcModule;
class OriginWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers: { origin: 'http://localhost:8000' } }); }
}
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
const ROOM = 'reploid-swarm-guest-mesh-185';
const MODEL = CANONICAL_CHAT_MODELS[0];
const PROMPT = 'Guest question about tide tables';

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key), dump: () => Object.fromEntries(data.entries()) };
}

describe('guest invites over the mesh (#185)', () => {
  it('joins one device, answers within the invite, and a revoked waiting guest sends zero prompt bytes to any host', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-guest-mesh-'));
    const signalingServer = new PublicSwarmServer({ logger, bootstrap: { ...bootstrap, allowLoopbackOrigins: true } });
    const httpServer = http.createServer();
    httpServer.on('upgrade', (req, socket, head) => signalingServer.handleUpgrade(req, socket, head));
    const signalingFrames = [];
    signalingServer.wss.on('connection', ws => {
      ws.on('message', data => signalingFrames.push(Buffer.from(data).toString('utf8')));
      const send = ws.send.bind(ws);
      ws.send = (data, ...args) => { signalingFrames.push(Buffer.from(data).toString('utf8')); return send(data, ...args); };
    });
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const baseSignalingUrl = `ws://127.0.0.1:${httpServer.address().port}${bootstrap.path}`;
    const [hostIdentity, decoyIdentity] = await Promise.all([createSigningIdentity({ algorithm: 'Ed25519' }), createSigningIdentity({ algorithm: 'Ed25519' })]);
    const cleanups = [];
    let busy = false;
    const hostPrompts = [], decoyPrompts = [];

    async function startHost({ label, identity, roomId, token, authorize, attach = () => {}, onPrompt }) {
      const url = new URL(baseSignalingUrl);
      url.searchParams.set('scope', roomId === bootstrap.publicRoomId ? 'public' : 'private');
      url.searchParams.set('roomId', roomId);
      const config = resolveConfig({ overrides: {
        mesh: { enabled: true, executeJobs: true, roomId, maxInboundJobs: 1 },
        webrtc: { signalingUrl: url.href, broadcastRoomId: roomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } } } });
      const hub = new EventEmitter();
      const events = { emit: hub.emit.bind(hub), on(name, fn) { hub.on(name, fn); return () => hub.off(name, fn); } };
      const instanceId = `${label}-${randomUUID()}`;
      const admission = roomId === bootstrap.publicRoomId ? null : createRoomIntroductionAdmission({ roomId, token });
      let transport = null, mesh = null;
      mesh = createPeerGenerationMesh({ config, ports: {
        instanceId, modelConfig: { id: MODEL.id }, admitsBeforeDisclosure: true,
        getExecutionState: () => ({ phase: busy ? 'executing' : 'ready', modelIdentity: MODEL.identity, adapterIdentities: [] }),
        identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
        events, eventBus: events, utils: { logger, generateId: prefix => `${prefix}:${randomUUID()}` },
        authorize: request => authorize(request, mesh),
        generate: async messages => {
          onPrompt(messages);
          return { model: MODEL.id, modelIdentity: MODEL.identity, adapterIdentities: [], content: `reply-from-${label}`,
            completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: 3, stopReason: 'eos-token' } };
        },
        createTransport: () => (transport = createSwarmTransport({ Utils: { logger, generateId: () => randomUUID() }, EventBus: events, config, ...rtc,
          WebSocket: OriginWebSocket, getSessionId: () => instanceId, getRtcConfig: async () => ({ iceServers: [] }),
          getRoomCredentials: () => ({ roomId, token }),
          introductions: { getIdentity: () => identity, ...(admission ? { createAdmission: admission.create } : {}), authorize: async req => req.roomId === roomId } }))
      } });
      await mesh.connect();
      attach({ transport, verifyPeer: (peer, signal) => mesh.verifyPeerIdentity(peer, signal), currentPeer: peer => mesh.getVerifiedPeerIdentity(peer) });
      cleanups.push(() => mesh.close());
      return mesh;
    }

    function openGuestBrowser() {
      const storage = memoryStorage();
      const defaultUrl = new URL(baseSignalingUrl);
      defaultUrl.searchParams.set('scope', 'public');
      defaultUrl.searchParams.set('roomId', bootstrap.publicRoomId);
      const sessionId = `guest-${randomUUID()}`;
      const swarm = createWorkSwarm({ storage, service: { getState: () => ({ phase: 'idle' }), subscribe: () => () => {} },
        createModelFiles: () => ({ attach: async () => {}, announce() {}, stop: async () => {}, close: async () => {}, getState: () => ({ sharing: false, preparing: false }) }),
        networkOptions: deps => ({ ...deps, ...rtc, WebSocket: OriginWebSocket, getSessionId: () => sessionId,
          config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: bootstrap.publicRoomId },
            webrtc: { signalingUrl: defaultUrl.href, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } } } }),
          getRtcConfig: async () => ({ iceServers: [] }), autoConnect: false, discoveryScope: 'public',
          getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }), getInviteUrl: () => 'https://replo.id/' }) });
      const session = createChatSession({ storage, service: { getState: () => ({ phase: 'idle' }), subscribe: () => () => {} }, swarm });
      cleanups.push(async () => { await session.close(); await swarm.close(); });
      return { storage, swarm, session };
    }

    let invites;
    try {
      invites = await openCircleInvites({ file: path.join(directory, 'invites.sqlite'), hostPeerId: hostIdentity.peerId, hostLabel: 'Desk' });
      const guestAccess = createGuestAccess({ invites, hostParticipantId: hostIdentity.peerId });
      const rule = mesh => createHostRequesterRule({ ownerPairing: { isOwner: () => false }, guestAccess,
        verifyPeer: peer => mesh.verifyPeerIdentity(peer), isIdle: () => !busy });
      const marker = ownerPairingRoomMarker(ROOM);
      await startHost({ label: 'decoy', identity: decoyIdentity, roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker,
        authorize: async () => true, onPrompt: messages => decoyPrompts.push(messages) });
      await startHost({ label: 'desk', identity: hostIdentity, roomId: ROOM, token: marker,
        authorize: async (request, mesh) => request.action === 'mesh.connect' || (request.action === 'mesh.admit' || request.action === 'mesh.execute')
          && await rule(mesh)(request, request.action === 'mesh.execute' ? 'execute' : 'admit'),
        attach: channel => guestAccess.attach(channel), onPrompt: messages => hostPrompts.push(messages) });

      // The desktop terminal's guest link: fragment-only, routing room, no room credential.
      const issued = invites.issue({ expiresAt: Date.now() + 3_600_000, maxRequests: 3, maxOutputTokens: 256 });
      const link = guestInviteLink({ token: issued.token, hostParticipantId: hostIdentity.peerId, room: ROOM });
      expect(new URL(link).search).toBe('');
      expect(link).not.toContain(marker);
      const parsed = parseCircleInviteUrl(link);
      expect(parsed).toEqual({ token: issued.token, hostPeerId: hostIdentity.peerId, roomId: ROOM });

      // Join from a fresh browser that starts in the public room.
      const guest = openGuestBrowser();
      await guest.swarm.connect({ automatic: false });
      const joined = await guest.session.guestJoin.join({ ...parsed, signal: AbortSignal.timeout(10000) });
      expect(joined).toMatchObject({ hostParticipantId: hostIdentity.peerId, hostLabel: 'Desk', roomId: ROOM, remainingRequests: 3 });
      expect(guest.swarm.getNetworkId()).toBe(ROOM);
      expect(signalingFrames.some(frame => frame.includes(issued.token))).toBe(false);
      expect(JSON.stringify(guest.storage.dump())).not.toContain(issued.token);
      await expect.poll(() => guest.session.guestJoin.state().status, { timeout: 8000 }).toBe('online');

      // The invite works on no second device.
      const thief = openGuestBrowser();
      await expect(thief.session.guestJoin.join({ ...parsed, signal: AbortSignal.timeout(8000) })).rejects.toThrow(/invalid, expired, revoked or already used/);

      // One answer within the invite, from the invited host only, settled against the invite.
      const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [hostIdentity.peerId] }, computation: 'plaintext' });
      await expect.poll(() => guest.session.getState().models?.find(model => model.id === MODEL.id)?.networkAvailability, { timeout: 8000 }).toBe('ready');
      const model = guest.session.getState().models.find(item => item.id === MODEL.id);
      const thread = guest.session.createThread({ model, privacy: policy, executionLocation: 'network' });
      await guest.session.send(thread, PROMPT);
      expect(hostPrompts.map(messages => JSON.stringify(messages).includes(PROMPT))).toEqual([true]);
      await expect.poll(() => invites.list()[0].usedRequests, { timeout: 5000 }).toBe(1);

      // Revoked while waiting for a busy host: nothing is reserved, no prompt reaches any computer.
      busy = true;
      const waiting = guest.session.send(thread, `${PROMPT} (second)`).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 400));
      invites.revoke(issued.inviteId);
      busy = false;
      await waiting;
      await new Promise(resolve => setTimeout(resolve, 400));
      expect(hostPrompts).toHaveLength(1);
      expect(decoyPrompts).toEqual([]);
      expect(invites.list()[0]).toMatchObject({ status: 'revoked', usedRequests: 1 });
    } finally {
      for (const close of cleanups.reverse()) { try { await close(); } catch { /* best effort */ } }
      invites?.close();
      await signalingServer.close();
      httpServer.closeAllConnections?.();
      await new Promise(resolve => httpServer.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  }, 40000);
});

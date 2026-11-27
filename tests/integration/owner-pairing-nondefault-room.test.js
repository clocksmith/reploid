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
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createOwnerPairingUrl, parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';
import { createWorkSwarm } from '../../apps/poolday/host/work-swarm.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import {
  OWNER_PAIRING_REQUEST,
  createRoomIntroductionAdmission,
  createSwarmTransport,
  ownerPairingRoomMarker
} from '../../packages/reploid/src/transport/index.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

const rtc = rtcModule.default ?? rtcModule;
class OriginWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, protocols, { headers: { origin: 'http://localhost:8000' } });
  }
}
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
const ISOLATED_ROOM = 'reploid-swarm-alex-isolated-200';
const MODEL = Object.freeze({ id: 'qwen-3-5-0-8b-q4k-ehaf16', identity: `sha256:${'8'.repeat(64)}` });

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    dump: () => Object.fromEntries(data.entries())
  };
}

describe('QR owner pairing into a nondefault room (#200)', () => {
  it('routes a fresh browser with no prejoined room or stored credentials to only the intended desktop in an isolated room and enforces failure boundaries', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'reploid-qr-room-200-'));
    const pairingFile = path.join(directory, 'owner-pairing.sqlite');
    const signalingServer = new PublicSwarmServer({
      logger,
      bootstrap: { ...bootstrap, allowLoopbackOrigins: true }
    });
    const httpServer = http.createServer();
    httpServer.on('upgrade', (req, socket, head) => signalingServer.handleUpgrade(req, socket, head));

    const signalingFrames = [];
    signalingServer.wss.on('connection', ws => {
      ws.on('message', data => signalingFrames.push(Buffer.from(data).toString('utf8')));
      const origSend = ws.send.bind(ws);
      ws.send = (data, ...args) => {
        signalingFrames.push(Buffer.from(data).toString('utf8'));
        return origSend(data, ...args);
      };
    });

    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;
    const baseSignalingUrl = `ws://127.0.0.1:${port}${bootstrap.path}`;

    const [desktopId, decoyPublicId, impostorIsolatedId] = await Promise.all([
      createSigningIdentity({ algorithm: 'Ed25519' }),
      createSigningIdentity({ algorithm: 'Ed25519' }),
      createSigningIdentity({ algorithm: 'Ed25519' })
    ]);

    const cleanups = [];
    const decoyPairingMessages = [];
    const impostorPairingMessages = [];
    const decoyPrompts = [];
    const impostorPrompts = [];

    async function startDesktopHost({ label, identity, roomId, token, onPairingMsg = null, onPrompt = null }) {
      const url = new URL(baseSignalingUrl);
      const isPublic = roomId === bootstrap.publicRoomId;
      url.searchParams.set('scope', isPublic ? 'public' : 'private');
      url.searchParams.set('roomId', roomId);
      const config = resolveConfig({
        overrides: {
          mesh: { enabled: true, executeJobs: true, roomId, maxInboundJobs: 1 },
          webrtc: { signalingUrl: url.href, broadcastRoomId: roomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } }
        }
      });
      const hub = new EventEmitter();
      const events = { emit: hub.emit.bind(hub), on(name, fn) { hub.on(name, fn); return () => hub.off(name, fn); } };
      const instanceId = `${label}-${randomUUID()}`;
      const admission = isPublic ? null : createRoomIntroductionAdmission({ roomId, token });
      let transport = null;
      const mesh = createPeerGenerationMesh({
        config,
        ports: {
          instanceId,
          modelConfig: { id: MODEL.id },
          admitsBeforeDisclosure: true,
          getExecutionState: () => ({ phase: 'ready', modelIdentity: MODEL.identity, adapterIdentities: [] }),
          identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
          events,
          eventBus: events,
          utils: { logger, generateId: prefix => `${prefix}:${randomUUID()}` },
          authorize: async () => true,
          generate: async messages => {
            onPrompt?.(messages);
            return {
              model: MODEL.id,
              modelIdentity: MODEL.identity,
              adapterIdentities: [],
              content: `reply-from-${label}`,
              completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: 3, stopReason: 'eos-token' }
            };
          },
          createTransport: () => {
            transport = createSwarmTransport({
              Utils: { logger, generateId: () => randomUUID() },
              EventBus: events,
              config,
              ...rtc,
              WebSocket: OriginWebSocket,
              getSessionId: () => instanceId,
              getRtcConfig: async () => ({ iceServers: [] }),
              getRoomCredentials: () => ({ roomId, token }),
              introductions: {
                getIdentity: () => identity,
                ...(admission ? { createAdmission: admission.create } : {}),
                authorize: async req => req.roomId === roomId
              }
            });
            if (onPairingMsg) {
              transport.onMessage(OWNER_PAIRING_REQUEST, (peer, payload) => onPairingMsg({ peer, payload }));
            }
            return transport;
          }
        }
      });
      await mesh.connect();
      const endpoint = {
        id: instanceId,
        mesh,
        get transport() { return transport; },
        verifyPeer: (peer, signal) => mesh.verifyPeerIdentity(peer, signal),
        currentPeer: peer => mesh.getVerifiedPeerIdentity(peer),
        async close() { await mesh.close(); }
      };
      cleanups.push(() => endpoint.close());
      return endpoint;
    }

    function openFreshBrowserProductSession() {
      const storage = memoryStorage();
      const defaultUrl = new URL(baseSignalingUrl);
      defaultUrl.searchParams.set('scope', 'public');
      defaultUrl.searchParams.set('roomId', bootstrap.publicRoomId);
      const browserSessionId = `browser-${randomUUID()}`;
      const swarm = createWorkSwarm({
        storage,
        service: { getState: () => ({ phase: 'idle' }), subscribe: () => () => {} },
        createModelFiles: () => ({ attach: async () => {}, announce() {}, stop: async () => {}, close: async () => {}, getState: () => ({ sharing: false, preparing: false }) }),
        networkOptions: deps => ({
          ...deps,
          ...rtc,
          WebSocket: OriginWebSocket,
          getSessionId: () => browserSessionId,
          config: resolveConfig({
            overrides: {
              mesh: { enabled: true, roomId: bootstrap.publicRoomId },
              webrtc: { signalingUrl: defaultUrl.href, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } }
            }
          }),
          getRtcConfig: async () => ({ iceServers: [] }),
          autoConnect: false,
          discoveryScope: 'public',
          getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }),
          getInviteUrl: () => 'https://replo.id/'
        })
      });
      const session = createChatSession({
        storage,
        service: { getState: () => ({ phase: 'idle' }), subscribe: () => () => {} },
        swarm
      });
      cleanups.push(async () => {
        await session.close();
        await swarm.close();
      });
      return { storage, swarm, session };
    }

    let pairing = null;
    try {
      let currentTime = Date.now();
      let pendingApproval = Promise.withResolvers();
      pairing = await openOwnerPairing({
        file: pairingFile,
        hostParticipantId: desktopId.peerId,
        now: () => currentTime,
        onRequest: req => pendingApproval.resolve(req)
      });
      cleanups.push(() => pairing.close());

      // Start decoy desktop in default public room, impostor in isolated room, and intended desktop in isolated room.
      const isolatedMarker = ownerPairingRoomMarker(ISOLATED_ROOM);
      await startDesktopHost({
        label: 'decoy-public',
        identity: decoyPublicId,
        roomId: bootstrap.publicRoomId,
        token: bootstrap.publicJoinMarker,
        onPairingMsg: msg => decoyPairingMessages.push(msg),
        onPrompt: msg => decoyPrompts.push(msg)
      });
      await startDesktopHost({
        label: 'impostor-isolated',
        identity: impostorIsolatedId,
        roomId: ISOLATED_ROOM,
        token: isolatedMarker,
        onPairingMsg: msg => impostorPairingMessages.push(msg),
        onPrompt: msg => impostorPrompts.push(msg)
      });
      const desktop = await startDesktopHost({
        label: 'alex-desktop',
        identity: desktopId,
        roomId: ISOLATED_ROOM,
        token: isolatedMarker
      });
      pairing.attach(desktop);

      // Desktop emits fragment-only QR link with routing room hint and zero reusable room credentials.
      const offer = pairing.issue();
      const qrLink = createOwnerPairingUrl({
        hostParticipantId: offer.hostParticipantId,
        code: offer.code,
        roomId: ISOLATED_ROOM
      }, 'https://replo.id/');
      expect(new URL(qrLink).search).toBe('');
      expect(qrLink).not.toContain('swarmToken');
      expect(qrLink).not.toContain(isolatedMarker);
      const parsed = parseOwnerPairingUrl(qrLink);
      expect(parsed).toEqual({
        hostParticipantId: desktopId.peerId,
        code: offer.code,
        roomId: ISOLATED_ROOM
      });

      // Fresh browser (empty storage, no prejoined room, initially on default public room) opens QR link.
      const browser = openFreshBrowserProductSession();
      expect(browser.swarm.getNetworkId()).toBe(bootstrap.publicRoomId);
      // Even if auto-connect first joined the default public room, pairing switches cleanly to the desktop's room.
      await browser.swarm.connect({ automatic: false });
      expect(browser.swarm.getNetworkId()).toBe(bootstrap.publicRoomId);

      const pairPromise = browser.session.ownerPairing.pair({
        ...parsed,
        signal: AbortSignal.timeout(8000)
      });
      const observed = await pendingApproval.promise;
      expect(pairing.isOwner(observed.participantId)).toBe(false);
      expect(pairing.decide(observed.requestId, true)).toBe(true);

      const paired = await pairPromise;
      expect(paired).toMatchObject({
        hostParticipantId: desktopId.peerId,
        hostLabel: desktopId.peerId,
        roomId: ISOLATED_ROOM
      });
      expect(browser.swarm.getNetworkId()).toBe(ISOLATED_ROOM);
      expect(browser.session.ownerPairing.state()).toMatchObject({
        status: 'online',
        paired: true,
        canSend: true,
        hostParticipantId: desktopId.peerId,
        roomId: ISOLATED_ROOM
      });

      // Zero secret leakage: no pairing code in signaling, no code sent to decoy or impostor, no reusable room token saved.
      expect(signalingFrames.some(frame => frame.includes(offer.code))).toBe(false);
      expect(decoyPairingMessages).toEqual([]);
      expect(impostorPairingMessages).toEqual([]);
      const savedDump = JSON.stringify(browser.storage.dump());
      expect(savedDump).not.toContain(offer.code);
      expect(savedDump).not.toContain(isolatedMarker);
      expect(savedDump).not.toContain('REPLOID_SWARM_TOKEN');

      // Reused link cannot pair from a second fresh browser.
      const secondBrowser = openFreshBrowserProductSession();
      await expect(secondBrowser.session.ownerPairing.pair({
        ...parsed,
        signal: AbortSignal.timeout(1200)
      })).rejects.toThrow();
      expect(secondBrowser.session.ownerPairing.state().paired).toBe(false);

      // Wrong code cannot pair.
      const freshOffer = pairing.issue();
      await expect(secondBrowser.session.ownerPairing.pair({
        hostParticipantId: desktopId.peerId,
        code: 'Z'.repeat(24),
        roomId: ISOLATED_ROOM,
        signal: AbortSignal.timeout(1200)
      })).rejects.toThrow();
      expect(secondBrowser.session.ownerPairing.state().paired).toBe(false);

      // Expired link cannot pair.
      currentTime = freshOffer.expiresAt + 1000;
      await expect(secondBrowser.session.ownerPairing.pair({
        hostParticipantId: desktopId.peerId,
        code: freshOffer.code,
        roomId: ISOLATED_ROOM,
        signal: AbortSignal.timeout(1200)
      })).rejects.toThrow();
      expect(secondBrowser.session.ownerPairing.state().paired).toBe(false);

      // Unavailable desktop: stop intended desktop while decoy (public) and impostor (isolated) stay online.
      // Paired browser MUST report offline and a fresh browser MUST fail without falling back to another host.
      await desktop.close();
      await expect.poll(() => browser.session.ownerPairing.state().status, { timeout: 5000 }).toBe('offline');
      expect(browser.session.ownerPairing.state().canSend).toBe(false);

      currentTime = Date.now();
      const offlineOffer = pairing.issue();
      const thirdBrowser = openFreshBrowserProductSession();
      await expect(thirdBrowser.session.ownerPairing.pair({
        hostParticipantId: desktopId.peerId,
        code: offlineOffer.code,
        roomId: ISOLATED_ROOM,
        peerWaitMs: 600,
        signal: AbortSignal.timeout(2500)
      })).rejects.toThrow(/Could not find the verified desktop/);
      expect(thirdBrowser.session.ownerPairing.state().paired).toBe(false);
      expect(decoyPairingMessages).toEqual([]);
      expect(impostorPairingMessages).toEqual([]);
      expect(decoyPrompts).toEqual([]);
      expect(impostorPrompts).toEqual([]);
    } finally {
      for (const close of cleanups.reverse()) {
        try { await close(); } catch { /* Best-effort teardown */ }
      }
      await signalingServer.close();
      httpServer.closeAllConnections?.();
      await new Promise(resolve => httpServer.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  }, 25000);
});

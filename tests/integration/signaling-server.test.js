import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import SignalingServer from '../../server/signaling-server.js';
import { createStandaloneSignalingServer } from '../../server/reploid-signaling.js';

const waitForMessage = (socket, predicate, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for message'));
    }, timeoutMs);

    const onMessage = (raw) => {
      const parsed = JSON.parse(raw.toString());
      if (!predicate(parsed)) return;
      cleanup();
      resolve(parsed);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    };

    socket.on('message', onMessage);
    socket.on('error', onError);
  });

const waitForCollectedMessage = (messages, predicate, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const timer = setInterval(() => {
      const matched = messages.find((message) => predicate(message));
      if (matched) {
        clearInterval(timer);
        resolve(matched);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for collected message'));
      }
    }, 10);
  });

describe('SignalingServer', () => {
  let server;
  let signalingServer;
  let port;

  afterEach(async () => {
    signalingServer?.close();
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function bootServer(options = {}) {
    server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });

    signalingServer = new SignalingServer({
      path: '/signaling',
      heartbeatInterval: 1000,
      peerTimeout: 3000,
      ...options
    });

    server.on('upgrade', (req, socket, head) => {
      if (signalingServer.shouldHandle(req)) {
        signalingServer.handleUpgrade(req, socket, head);
        return;
      }

      socket.destroy();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  }

  it('forwards strict WebRTC signaling messages between peers in the same room', async () => {
    await bootServer();

    const roomId = 'reploid-swarm-openclaw';
    const token = 'openclaw';
    const peerA = new WebSocket(`ws://127.0.0.1:${port}/signaling`, { perMessageDeflate: false });
    const peerB = new WebSocket(`ws://127.0.0.1:${port}/signaling`, { perMessageDeflate: false });

    await Promise.all([
      new Promise((resolve) => peerA.once('open', resolve)),
      new Promise((resolve) => peerB.once('open', resolve))
    ]);

    peerA.send(JSON.stringify({ type: 'join', peerId: 'peer_alpha', roomId, token }));
    peerB.send(JSON.stringify({ type: 'join', peerId: 'peer_beta', roomId, token }));

    await waitForMessage(peerA, (message) => message.type === 'joined');
    const joinedB = await waitForMessage(peerB, (message) => message.type === 'joined');

    expect(joinedB.peers).toContain('peer_alpha');

    peerA.send(JSON.stringify({
      type: 'offer',
      peerId: 'peer_alpha',
      roomId,
      targetPeer: 'peer_beta',
      offer: { type: 'offer', sdp: 'fake-sdp' }
    }));

    const forwarded = await waitForMessage(peerB, (message) => message.type === 'offer');
    expect(forwarded.peerId).toBe('peer_alpha');
    expect(forwarded.targetPeer).toBe('peer_beta');
    expect(forwarded.offer).toEqual({ type: 'offer', sdp: 'fake-sdp' });

    peerA.close();
    peerB.close();
  });

  it('rejects unsupported message types after join', async () => {
    await bootServer();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/signaling`, { perMessageDeflate: false });
    await new Promise((resolve) => socket.once('open', resolve));

    socket.send(JSON.stringify({
      type: 'join',
      peerId: 'peer_alpha',
      roomId: 'reploid-swarm-openclaw',
      token: 'openclaw'
    }));
    await waitForMessage(socket, (message) => message.type === 'joined');

    socket.send(JSON.stringify({
      type: 'broadcast',
      peerId: 'peer_alpha',
      roomId: 'reploid-swarm-openclaw',
      data: { nope: true }
    }));

    const error = await waitForMessage(socket, (message) => message.type === 'error');
    expect(error.error).toContain('Unsupported message type');

    socket.close();
  });

  it('rejects non-loopback origins when localOnly mode is enabled', async () => {
    await bootServer({ localOnly: true });

    await expect(new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/signaling`, {
        origin: 'https://evil.example',
        perMessageDeflate: false
      });
      socket.once('open', resolve);
      socket.once('unexpected-response', (_req, res) => {
        if (res.statusCode === 403) {
          resolve(res.statusCode);
          return;
        }
        reject(new Error(`Unexpected status: ${res.statusCode}`));
      });
      socket.once('error', () => {
        // unexpected-response carries the assertion.
      });
    })).resolves.toBe(403);
  });

  it('syncs a server-backed inference peer and relays generation results', async () => {
    const providerPeerId = 'peer_signal_provider';
    const virtualPeer = {
      peerId: providerPeerId,
      metadata: {
        transport: 'signaling-relay',
        capabilities: ['generation']
      },
      matchesRoom: () => true,
      async onPeerJoined({ targetPeerId, sendEnvelope }) {
        sendEnvelope(targetPeerId, {
          protocolVersion: 1,
          type: 'reploid:peer-advertisement',
          peerId: providerPeerId,
          timestamp: Date.now(),
          payload: {
            kind: 'peer_advertisement',
            peerId: providerPeerId,
            swarmEnabled: true,
            hasInference: true,
            capabilities: ['generation'],
            updatedAt: Date.now()
          },
          payloadSize: 0
        });
      },
      async onMessage({ sourcePeerId, envelope, sendEnvelope }) {
        if (envelope.type !== 'reploid:generation-request') {
          return;
        }

        sendEnvelope(sourcePeerId, {
          protocolVersion: 1,
          type: 'reploid:generation-result',
          peerId: providerPeerId,
          timestamp: Date.now(),
          payload: {
            requestId: envelope.payload.requestId,
            response: {
              content: 'server inference response',
              raw: 'server inference response',
              provider: 'openai',
              model: 'gpt-test',
              timestamp: Date.now()
            }
          },
          payloadSize: 0
        });
      }
    };

    await bootServer({ virtualPeers: [virtualPeer] });

    const roomId = 'reploid-swarm-openclaw';
    const token = 'openclaw';
    const socket = new WebSocket(`ws://127.0.0.1:${port}/signaling`, { perMessageDeflate: false });
    const messages = [];
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });
    await new Promise((resolve) => socket.once('open', resolve));

    socket.send(JSON.stringify({ type: 'join', peerId: 'peer_alpha', roomId, token }));

    await waitForCollectedMessage(messages, (message) => message.type === 'joined');
    const virtualJoined = await waitForCollectedMessage(
      messages,
      (message) => message.type === 'peer-joined' && message.peerId === providerPeerId
    );
    expect(virtualJoined.metadata.transport).toBe('signaling-relay');

    const advertisement = await waitForCollectedMessage(
      messages,
      (message) => message.type === 'relay-message' && message.peerId === providerPeerId
    );
    expect(advertisement.envelope.type).toBe('reploid:peer-advertisement');

    socket.send(JSON.stringify({
      type: 'relay-message',
      peerId: 'peer_alpha',
      roomId,
      targetPeer: providerPeerId,
      envelope: {
        protocolVersion: 1,
        type: 'reploid:generation-request',
        peerId: 'peer_alpha',
        timestamp: Date.now(),
        payload: {
          requestId: 'req-1',
          messages: [{ role: 'user', content: 'Hello from test' }]
        },
        payloadSize: 0
      }
    }));

    const result = await waitForCollectedMessage(
      messages,
      (message) => message.type === 'relay-message' && message.envelope?.type === 'reploid:generation-result'
    );

    expect(result.peerId).toBe(providerPeerId);
    expect(result.envelope.payload.requestId).toBe('req-1');
    expect(result.envelope.payload.response.content).toBe('server inference response');

    socket.close();
  });

  it('serves env-backed chat and proxy status from the standalone server', async () => {
    const inferenceService = {
      getConfig: () => ({
        provider: 'openai',
        model: 'gpt-test'
      }),
      getProxyStatus: () => ({
        proxyAvailable: true,
        hasApiKey: true,
        providers: {
          gemini: false,
          openai: true,
          anthropic: false,
          groq: false,
          ollama: true,
          vllm: true
        },
        primaryProvider: 'openai',
        primaryModel: 'gpt-test',
        peerAvailable: true,
        localEndpoint: 'http://localhost:11434',
        vllmEndpoint: 'http://localhost:8000'
      }),
      isPeerAvailable: () => true,
      generate: async ({ provider, model, messages }) => ({
        content: `${provider}:${model}:${messages[0].content}`,
        raw: `${provider}:${model}:${messages[0].content}`,
        provider,
        model,
        timestamp: Date.now()
      })
    };

    const instance = createStandaloneSignalingServer({
      host: '127.0.0.1',
      port: 0,
      inferenceService
    });

    server = instance.server;
    signalingServer = instance.signalingServer;

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;

    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/proxy-status`);
    expect(statusResponse.ok).toBe(true);
    const status = await statusResponse.json();
    expect(status.primaryProvider).toBe('openai');
    expect(status.peerAvailable).toBe(true);

    const chatResponse = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        provider: 'openai',
        model: 'gpt-test',
        messages: [{ role: 'user', content: 'hello-http' }]
      })
    });

    expect(chatResponse.ok).toBe(true);
    const chat = await chatResponse.json();
    expect(chat.content).toBe('openai:gpt-test:hello-http');
  });
});

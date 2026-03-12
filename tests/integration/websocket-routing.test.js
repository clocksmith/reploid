import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import SignalingServer from '../../server/signaling-server.js';
import AgentBridge from '../../server/agent-bridge.js';

const waitForEvent = (target, eventName) =>
  new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      cleanup();
      resolve(args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      target.off?.(eventName, onEvent);
      target.off?.('error', onError);
      target.removeEventListener?.(eventName, onEvent);
    };

    if (target.on) {
      target.on(eventName, onEvent);
      target.on('error', onError);
      return;
    }

    target.addEventListener(eventName, onEvent, { once: true });
  });

describe('WebSocket routing', () => {
  let server;
  let signalingServer;
  let agentBridge;
  let port;

  afterEach(async () => {
    agentBridge?.close();
    signalingServer?.close();
    if (server?.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  async function bootServer() {
    server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });

    signalingServer = new SignalingServer({
      path: '/signaling',
      heartbeatInterval: 1000,
      peerTimeout: 2000
    });
    agentBridge = new AgentBridge({
      path: '/agent-bridge',
      heartbeatInterval: 1000,
      agentTimeout: 2000
    });

    server.on('upgrade', (req, socket, head) => {
      if (signalingServer.shouldHandle(req)) {
        signalingServer.handleUpgrade(req, socket, head);
        return;
      }

      if (agentBridge.shouldHandle(req)) {
        agentBridge.handleUpgrade(req, socket, head);
        return;
      }

      socket.destroy();
    });

    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  }

  it('routes signaling and agent bridge upgrades to the correct service', async () => {
    await bootServer();

    const signalingClient = new WebSocket(`ws://127.0.0.1:${port}/signaling`, {
      perMessageDeflate: false
    });
    const signalingMessages = [];
    signalingClient.on('message', (message) => {
      signalingMessages.push(JSON.parse(message.toString()));
    });
    await waitForEvent(signalingClient, 'open');
    signalingClient.send(JSON.stringify({
      type: 'join',
      peerId: 'probe-peer',
      roomId: 'reploid-swarm-openclaw',
      token: 'openclaw',
      metadata: { alias: 'probe' }
    }));

    await new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (signalingMessages.some((message) => message.type === 'joined')) {
          clearInterval(timer);
          resolve();
          return;
        }

        if (Date.now() - started > 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });

    expect(signalingMessages.map((message) => message.type)).toContain('welcome');
    expect(signalingMessages.map((message) => message.type)).toContain('joined');

    const bridgeClient = new WebSocket(`ws://127.0.0.1:${port}/agent-bridge`, {
      perMessageDeflate: false
    });
    const bridgeMessages = [];
    bridgeClient.on('message', (message) => {
      bridgeMessages.push(JSON.parse(message.toString()));
    });
    await waitForEvent(bridgeClient, 'open');
    bridgeClient.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'register',
      params: {
        name: 'probe-agent',
        capabilities: ['audit']
      }
    }));

    await new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (bridgeMessages.length > 0) {
          clearInterval(timer);
          resolve();
          return;
        }

        if (Date.now() - started > 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });

    expect(bridgeMessages[0]?.result?.agentId).toMatch(/^claude-/);

    signalingClient.close();
    bridgeClient.close();
  });

  it('closes active agent bridge clients during shutdown and clears heartbeat timers', async () => {
    await bootServer();

    const bridgeClient = new WebSocket(`ws://127.0.0.1:${port}/agent-bridge`, {
      perMessageDeflate: false
    });
    await waitForEvent(bridgeClient, 'open');
    bridgeClient.send(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'register',
      params: {
        name: 'probe-agent',
        capabilities: ['audit']
      }
    }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    agentBridge.close();

    await waitForEvent(bridgeClient, 'close');

    expect(agentBridge.heartbeatMonitor).toBeNull();
    signalingServer.close();
    expect(signalingServer.heartbeatMonitor).toBeNull();
  });
});

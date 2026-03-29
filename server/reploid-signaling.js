#!/usr/bin/env node

/**
 * @fileoverview Standalone Reploid signaling server for local WebRTC coordination.
 */

import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import SignalingServer from './signaling-server.js';
import { createInferenceService } from './inference-service.js';
import { createSwarmInferencePeer } from './swarm-inference-peer.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/signaling';
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

dotenv.config();

const parseIntOption = (value, fallback, { allowZero = false } = {}) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed === 0 && allowZero) return 0;
  return parsed > 0 ? parsed : fallback;
};

const readArg = (argv, name) => {
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) return 'true';
  return next;
};

const readBooleanArg = (argv, name, fallback) => {
  const value = readArg(argv, name);
  if (value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return true;
};

export function parseStandaloneSignalingOptions(argv = process.argv.slice(2), env = process.env) {
  const envLocalOnly = String(env.REPLOID_SIGNALING_LOCAL_ONLY || 'true').trim().toLowerCase();

  const host = String(
    readArg(argv, 'host')
    || env.REPLOID_SIGNALING_HOST
    || DEFAULT_HOST
  ).trim() || DEFAULT_HOST;

  const port = parseIntOption(
    readArg(argv, 'port')
    || env.REPLOID_SIGNALING_PORT
    || env.PORT,
    DEFAULT_PORT
  );

  const pathValue = String(
    readArg(argv, 'path')
    || env.REPLOID_SIGNALING_PATH
    || DEFAULT_PATH
  ).trim() || DEFAULT_PATH;

  return {
    host,
    port,
    path: pathValue.startsWith('/') ? pathValue : `/${pathValue}`,
    provider: readArg(argv, 'provider') || env.REPLOID_SIGNALING_PROVIDER || null,
    model: readArg(argv, 'model') || env.REPLOID_SIGNALING_MODEL || null,
    providerPeerId: readArg(argv, 'peer-id') || env.REPLOID_SIGNALING_PEER_ID || null,
    localOnly: readBooleanArg(
      argv,
      'local-only',
      !(envLocalOnly === 'false' || envLocalOnly === '0' || envLocalOnly === 'no')
    ),
    heartbeatInterval: parseIntOption(env.REPLOID_SIGNALING_HEARTBEAT_MS, 30000),
    peerTimeout: parseIntOption(env.REPLOID_SIGNALING_PEER_TIMEOUT_MS, 60000),
    maxMessageBytes: parseIntOption(env.REPLOID_SIGNALING_MAX_MESSAGE_BYTES, 64 * 1024),
    maxPeersPerRoom: parseIntOption(env.REPLOID_SIGNALING_MAX_PEERS_PER_ROOM, 256),
    maxPeersTotal: parseIntOption(env.REPLOID_SIGNALING_MAX_PEERS_TOTAL, 8192),
    maxRooms: parseIntOption(env.REPLOID_SIGNALING_MAX_ROOMS, 4096),
    maxMessagesPerWindow: parseIntOption(env.REPLOID_SIGNALING_MAX_MESSAGES_PER_WINDOW, 512),
    rateLimitWindowMs: parseIntOption(env.REPLOID_SIGNALING_RATE_LIMIT_WINDOW_MS, 1000),
    maxBodyBytes: parseIntOption(env.REPLOID_SIGNALING_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES)
  };
}

const setCorsHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Reploid-Client-Id');
};

const writeJson = (res, statusCode, payload) => {
  setCorsHeaders(res);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;

  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      reject(new Error(`Request body exceeds limit (${maxBytes} bytes)`));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf-8');
      resolve(raw ? JSON.parse(raw) : {});
    } catch (error) {
      reject(error);
    }
  });

  req.on('error', reject);
});

const streamBufferedText = (res, text = '') => {
  setCorsHeaders(res);
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  const chunkSize = 256;
  if (!text) {
    res.write('data: {"response":""}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  for (let index = 0; index < text.length; index += chunkSize) {
    const chunk = text.slice(index, index + chunkSize);
    res.write(`data: ${JSON.stringify({ response: chunk })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
};

export function createStandaloneSignalingServer(options = {}) {
  const resolvedOptions = {
    host: options.host || DEFAULT_HOST,
    port: parseIntOption(options.port, DEFAULT_PORT, { allowZero: true }),
    path: options.path || DEFAULT_PATH,
    provider: options.provider || null,
    model: options.model || null,
    providerPeerId: options.providerPeerId || null,
    localOnly: options.localOnly !== false,
    heartbeatInterval: parseIntOption(options.heartbeatInterval, 30000),
    peerTimeout: parseIntOption(options.peerTimeout, 60000),
    maxMessageBytes: parseIntOption(options.maxMessageBytes, 64 * 1024),
    maxPeersPerRoom: parseIntOption(options.maxPeersPerRoom, 256),
    maxPeersTotal: parseIntOption(options.maxPeersTotal, 8192),
    maxRooms: parseIntOption(options.maxRooms, 4096),
    maxMessagesPerWindow: parseIntOption(options.maxMessagesPerWindow, 512),
    rateLimitWindowMs: parseIntOption(options.rateLimitWindowMs, 1000),
    maxBodyBytes: parseIntOption(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES)
  };

  const inferenceService = options.inferenceService || createInferenceService({
    env: options.env || process.env,
    fetchImpl: options.fetchImpl,
    provider: resolvedOptions.provider,
    model: resolvedOptions.model
  });
  const swarmInferencePeer = Object.prototype.hasOwnProperty.call(options, 'swarmInferencePeer')
    ? options.swarmInferencePeer
    : (
        inferenceService.isPeerAvailable()
          ? createSwarmInferencePeer({
              inferenceService,
              peerId: resolvedOptions.providerPeerId || 'peer_signal_provider'
            })
          : null
      );

  const signalingServer = new SignalingServer({
    path: resolvedOptions.path,
    localOnly: resolvedOptions.localOnly,
    heartbeatInterval: resolvedOptions.heartbeatInterval,
    peerTimeout: resolvedOptions.peerTimeout,
    maxMessageBytes: resolvedOptions.maxMessageBytes,
    maxPeersPerRoom: resolvedOptions.maxPeersPerRoom,
    maxPeersTotal: resolvedOptions.maxPeersTotal,
    maxRooms: resolvedOptions.maxRooms,
    maxMessagesPerWindow: resolvedOptions.maxMessagesPerWindow,
    rateLimitWindowMs: resolvedOptions.rateLimitWindowMs,
    virtualPeers: swarmInferencePeer ? [swarmInferencePeer] : []
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${resolvedOptions.host}:${resolvedOptions.port}`}`);
    const proxyStatus = inferenceService.getProxyStatus();

    if (req.method === 'OPTIONS') {
      setCorsHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      const stats = signalingServer.getStats();
      writeJson(res, 200, {
        ok: true,
        service: 'reploid-signaling',
        localOnly: stats.localOnly,
        peers: stats.totalPeers,
        rooms: stats.totalRooms,
        inference: {
          provider: proxyStatus.primaryProvider,
          model: proxyStatus.primaryModel,
          peerAvailable: proxyStatus.peerAvailable
        }
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/signaling/stats') {
      writeJson(res, 200, {
        ...signalingServer.getStats(),
        inference: proxyStatus
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/proxy-status') {
      writeJson(res, 200, proxyStatus);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      try {
        const body = await readJsonBody(req, resolvedOptions.maxBodyBytes);
        const result = await inferenceService.generate({
          provider: body.provider,
          model: body.model,
          messages: body.messages
        });

        if (body.stream) {
          streamBufferedText(res, result.raw || result.content || '');
          return;
        }

        writeJson(res, 200, result);
      } catch (error) {
        writeJson(res, 500, {
          error: error?.message || 'Failed to process chat request'
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      writeJson(res, 200, {
        service: 'reploid-signaling',
        signalingPath: resolvedOptions.path,
        health: '/healthz',
        stats: '/api/signaling/stats',
        proxyStatus: '/api/proxy-status',
        chatEndpoint: '/api/chat'
      });
      return;
    }

    setCorsHeaders(res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 0;

  server.on('upgrade', (req, socket, head) => {
    if (signalingServer.shouldHandle(req)) {
      signalingServer.handleUpgrade(req, socket, head);
      return;
    }

    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });

  const close = async () => {
    signalingServer.close();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  return {
    server,
    signalingServer,
    inferenceService,
    close,
    options: resolvedOptions
  };
}

export async function startStandaloneSignalingServer(options = parseStandaloneSignalingOptions()) {
  const {
    server,
    signalingServer,
    close,
    options: resolvedOptions,
    inferenceService
  } = createStandaloneSignalingServer(options);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(resolvedOptions.port, resolvedOptions.host, resolve);
  });

  const signalingUrl = `ws://${resolvedOptions.host}:${resolvedOptions.port}${resolvedOptions.path}`;

  console.log('★ Reploid signaling server ready');
  console.log(`☛ HTTP: http://${resolvedOptions.host}:${resolvedOptions.port}`);
  console.log(`☛ WebSocket: ${signalingUrl}`);
  console.log(`☛ Health: http://${resolvedOptions.host}:${resolvedOptions.port}/healthz`);
  console.log(`☛ Stats: http://${resolvedOptions.host}:${resolvedOptions.port}/api/signaling/stats`);
  console.log(`☛ Proxy status: http://${resolvedOptions.host}:${resolvedOptions.port}/api/proxy-status`);
  console.log(`☛ Chat endpoint: http://${resolvedOptions.host}:${resolvedOptions.port}/api/chat`);
  console.log(`☛ Browser config: localStorage.setItem('REPLOID_SIGNALING_URL', '${signalingUrl}')`);

  const inferenceConfig = inferenceService.getConfig();
  if (inferenceService.isPeerAvailable()) {
    console.log(`☛ Inference peer: ${inferenceConfig.provider}:${inferenceConfig.model}`);
  } else {
    console.log('☛ Inference peer: disabled (set REPLOID_SIGNALING_PROVIDER and REPLOID_SIGNALING_MODEL, or provider-specific model vars)');
  }

  const shutdown = async (signal) => {
    console.log(`☛ ${signal} received, shutting down signaling server`);
    await close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT').catch((error) => {
      console.error('☒ Failed to shut down signaling server cleanly', error);
      process.exit(1);
    });
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch((error) => {
      console.error('☒ Failed to shut down signaling server cleanly', error);
      process.exit(1);
    });
  });

  return { server, signalingServer, close, inferenceService };
}

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  startStandaloneSignalingServer().catch((error) => {
    console.error('☒ Failed to start Reploid signaling server', error);
    process.exit(1);
  });
}

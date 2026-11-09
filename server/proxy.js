#!/usr/bin/env node
import { tokensEqual } from './token-auth.js';
import { createProxyRuntimeServices } from './proxy-runtime-services.js';
import { mountProviderProxyRoutes } from './proxy-providers.js';
import { mountProxyStorageRoutes } from './proxy-storage.js';
import { mountProxyStaticRoutes } from './proxy-static.js';

import express from 'express';
import { resolveServedFile, serveBrowserTree } from './browser-tree.js';
import http from 'http';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import SignalingServer, { isLoopbackAddress } from './signaling-server.js';
import { PublicSwarmServer } from './public-swarm-server.js';
import AgentBridge from './agent-bridge.js';
import fetch from 'node-fetch';
import createPoolRouter from './pool/routes.js';
import { installJsonBodyMiddleware } from './json-body-middleware.js';
import { createExternalBrainRouter } from './external-brain.js';
import { mountEarningRoutes } from './earning-routes/mount.js';
import { mountTextApi } from './text-api-mount.js';
import { mountSearchRoutes } from './search/mount.js';
import { createFirebaseStore } from './pool/firebase-store.js';
import { createGcsAdapterOriginSigner } from './pool/adapter-origin-signer.js';
import { createChangeControlAuthenticator, parseChangeControlTokenConfig } from './change-control/auth.js';
import { createFileChangeControlStore } from './change-control/file-store.js';
import { createFirestoreChangeControlStore } from './change-control/firestore-store.js';
import { createGitHubChangeControlAdapters } from './change-control/effects.js';
import { createGitHubAppClient } from './change-control/github.js';
import createChangeControlRouter from './change-control/routes.js';
import { createChangeControlService } from './change-control/service.js';
import { createMemoryChangeControlStore } from './change-control/store.js';
import {
  createPublicInferenceConfig,
  createPublicInferenceGuard,
  createPublicInferenceMiddleware
} from './public-inference-guard.js';

// Crash protection - keep server alive on uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[CRASH PROTECTION] Uncaught exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH PROTECTION] Unhandled rejection at:', promise);
  console.error('Reason:', reason);
});

// Simple rate limiter for API stability
const rateLimiter = {
  requests: new Map(),
  windowMs: 1000,  // 1 second window
  maxRequests: 5,  // max 5 requests per second per client bucket
  check(key) {
    const now = Date.now();
    const bucketKey = key || 'unknown';
    const data = this.requests.get(bucketKey) || { count: 0, resetAt: now + this.windowMs };

    if (now > data.resetAt) {
      data.count = 0;
      data.resetAt = now + this.windowMs;
    }

    data.count++;
    this.requests.set(bucketKey, data);

    return data.count <= this.maxRequests;
  }
};

const getRateLimitKey = (req) => {
  const clientId = req.headers['x-reploid-client-id'];
  if (typeof clientId === 'string' && clientId.trim()) {
    return `client:${clientId.trim()}`;
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return `ip:${forwarded.split(',')[0].trim()}`;
  }

  if (req.ip) {
    return `ip:${req.ip}`;
  }

  if (req.headers.origin) {
    return `origin:${req.headers.origin}`;
  }

  return 'unknown';
};

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const candidateDopplerDirs = [
  path.join(__dirname, '..', '..', 'doppler'),
  path.join(__dirname, '..', 'node_modules', 'doppler-gpu'),
  path.join(__dirname, '..', 'doppler')
];
const dopplerRootDir = candidateDopplerDirs.find((dir) => fs.existsSync(dir)) || candidateDopplerDirs[0];
const protoRootDir = path.join(__dirname, '..', '..', 'proto');
const dopplerDemoDir = path.join(dopplerRootDir, 'demo');
const dopplerKernelDir = path.join(dopplerRootDir, 'src', 'gpu', 'kernels');

// Load environment variables
dotenv.config();

// Physical acceptance may serve an owned snapshot of the ordinary Hosting
// payload. All browser entry points and assets must use that same directory.
// Otherwise the composed browser tree is served from its source roots.
const staticRootDir = process.env.REPLOID_STATIC_ROOT ? path.resolve(process.env.REPLOID_STATIC_ROOT) : null;
const browserFile = (servedPath) => (staticRootDir ? path.join(staticRootDir, servedPath) : resolveServedFile(servedPath));

// Load unified configuration
let appConfig = null;
try {
  const { getConfig } = await import('../utils/config-loader.js');
  const configLoader = getConfig();
  configLoader.load();
  appConfig = configLoader.getAll();
  console.log('[Proxy] Loaded configuration from:', configLoader.getConfigPath() || 'defaults');
} catch (err) {
  console.warn('[Proxy] Config loader not available, using environment variables');
}

const app = express();
const TRUST_PROXY_HOPS = Number(process.env.REPLOID_TRUST_PROXY_HOPS || 0);
if (Number.isInteger(TRUST_PROXY_HOPS) && TRUST_PROXY_HOPS > 0) {
  app.set('trust proxy', TRUST_PROXY_HOPS);
}
const PORT = appConfig?.server?.port || process.env.PORT || 8000;
const DECO_VISUAL_FEEDBACK = process.env.DECO_VISUAL_FEEDBACK === '1';
const decoFeedback = DECO_VISUAL_FEEDBACK
  ? await import('../../ouroboros/deco/packages/visual-feedback-bridge/dist/node/dev-server.js')
  : null;
const decoFeedbackOptions = decoFeedback
  ? {
      projectRoot: path.join(__dirname, '..'),
      devServerId: 'reploid-proxy',
      allowedOrigins: [`http://localhost:${PORT}`],
      browserModuleSpecifier: decoFeedback.feedbackBrowserModuleSpecifier,
      reloadMode: 'reload'
    }
  : null;
const GEMINI_API_KEY = appConfig?.api?.geminiKey || process.env.GEMINI_API_KEY;
const GEMINI_REFERER = appConfig?.api?.geminiReferer || process.env.GEMINI_REFERER || 'https://replo.id';
const LOCAL_MODEL_ENDPOINT = appConfig?.api?.localEndpoint || process.env.LOCAL_MODEL_ENDPOINT || 'http://localhost:11434';
const OPENAI_API_KEY = appConfig?.api?.openaiKey || process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = appConfig?.api?.anthropicKey || process.env.ANTHROPIC_API_KEY;
const HUGGINGFACE_API_KEY = appConfig?.api?.huggingfaceKey || process.env.HUGGINGFACE_API_KEY;
const GROQ_API_KEY = appConfig?.api?.groqKey || process.env.GROQ_API_KEY;
const VLLM_ENDPOINT = appConfig?.api?.vllmEndpoint || process.env.VLLM_ENDPOINT || 'http://localhost:8000';
const DEFAULT_CORS_ORIGINS = ['http://localhost:8080', 'https://replo.id'];
const ENV_CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : null;
const CORS_ORIGINS = appConfig?.server?.corsOrigins || ENV_CORS_ORIGINS || DEFAULT_CORS_ORIGINS;
const AUTO_START_OLLAMA = appConfig?.ollama?.autoStart || process.env.AUTO_START_OLLAMA === 'true';
const POOL_BACKEND_ONLY = process.env.POOL_BACKEND_ONLY === 'true';
const SERVER_ACCESS_TOKEN = process.env.REPLOID_SERVER_ACCESS_TOKEN || null;
const ALLOW_UNAUTHENTICATED_LOOPBACK = process.env.REPLOID_ALLOW_UNAUTHENTICATED_LOOPBACK !== 'false';
const getGeminiHeaders = () => ({
  'Content-Type': 'application/json',
  Referer: GEMINI_REFERER
});

const createConfiguredPoolStore = async () => {
  if (process.env.POOL_STORE !== 'firestore') return null;
  try {
    const appModule = await import('firebase-admin/app');
    const firestoreModule = await import('firebase-admin/firestore');
    if (appModule.getApps().length === 0) {
      appModule.initializeApp();
    }
    return createFirebaseStore({
      firestore: firestoreModule.getFirestore(),
      collectionPrefix: process.env.POOL_FIRESTORE_PREFIX || ''
    });
  } catch (error) {
    throw new Error(`[Pool] Firestore store requested but unavailable: ${error.message}`);
  }
};

const createConfiguredPoolAuth = async () => {
  const requireAuth = process.env.POOL_REQUIRE_FIREBASE_AUTH === 'true';
  const verifyAuth = requireAuth || process.env.POOL_VERIFY_FIREBASE_AUTH === 'true';
  if (!verifyAuth) return { requireAuth: false, verifyAuthToken: null };
  try {
    const appModule = await import('firebase-admin/app');
    const authModule = await import('firebase-admin/auth');
    if (appModule.getApps().length === 0) {
      appModule.initializeApp();
    }
    const auth = authModule.getAuth();
    return {
      requireAuth,
      verifyAuthToken: (token) => auth.verifyIdToken(token)
    };
  } catch (error) {
    console.warn('[Pool] Firebase auth verifier unavailable:', error.message);
    return { requireAuth, verifyAuthToken: null };
  }
};

const createConfiguredAdapterOriginSigner = async () => {
  if (process.env.REPLOID_ADAPTER_GCS_SIGNED_URLS !== 'true') return null;
  try {
    const appModule = await import('firebase-admin/app');
    const storageModule = await import('firebase-admin/storage');
    if (appModule.getApps().length === 0) appModule.initializeApp();
    return createGcsAdapterOriginSigner({
      storage: storageModule.getStorage(),
      expiresMs: Number(process.env.REPLOID_ADAPTER_SIGNED_URL_TTL_MS || 300000)
    });
  } catch (error) {
    throw new Error(`[Pool] GCS adapter delivery requested but unavailable: ${error.message}`);
  }
};

const createConfiguredChangeControl = async () => {
  if (process.env.REPLOID_CHANGE_CONTROL_ENABLED === 'false') return null;
  const defaultStoreMode = process.env.K_SERVICE ? 'firestore' : 'memory';
  const storeMode = String(process.env.REPLOID_CHANGE_CONTROL_STORE || defaultStoreMode).trim();
  let store;
  if (storeMode === 'firestore') {
    try {
      const appModule = await import('firebase-admin/app');
      const firestoreModule = await import('firebase-admin/firestore');
      if (appModule.getApps().length === 0) appModule.initializeApp();
      store = createFirestoreChangeControlStore({
        firestore: firestoreModule.getFirestore(),
        collectionPrefix: process.env.REPLOID_CHANGE_CONTROL_FIRESTORE_PREFIX || 'reploid'
      });
    } catch (error) {
      throw new Error(`[Change Control] Firestore store requested but unavailable: ${error.message}`);
    }
  } else if (storeMode === 'file') {
    store = createFileChangeControlStore({
      rootDir: process.env.REPLOID_CHANGE_CONTROL_STORE_DIR
        || path.join(__dirname, '..', '.change-control-data')
    });
  } else if (storeMode === 'memory') {
    store = createMemoryChangeControlStore();
  } else {
    throw new Error(`[Change Control] Unsupported store mode: ${storeMode}`);
  }
  const tokenEntries = parseChangeControlTokenConfig(process.env.REPLOID_CHANGE_CONTROL_TOKENS || null);
  const authenticate = createChangeControlAuthenticator({
    tokenEntries,
    allowUnauthenticatedLoopback: process.env.REPLOID_CHANGE_CONTROL_ALLOW_LOCAL === 'true',
    localOrganizationId: process.env.REPLOID_CHANGE_CONTROL_LOCAL_ORG || 'org:local'
  });
  const githubPrivateKey = String(process.env.REPLOID_GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const githubClient = process.env.REPLOID_GITHUB_APP_ID && githubPrivateKey
    ? createGitHubAppClient({
        appId: process.env.REPLOID_GITHUB_APP_ID,
        privateKey: githubPrivateKey,
        apiBase: process.env.REPLOID_GITHUB_API_BASE || undefined
      })
    : null;
  const service = createChangeControlService({
    store,
    githubClient,
    effectRegistry: createGitHubChangeControlAdapters(githubClient),
    detailsBaseUrl: process.env.REPLOID_CHANGE_CONTROL_PUBLIC_URL || null
  });
  return {
    store,
    router: createChangeControlRouter({
      service,
      store,
      authenticate,
      githubWebhookSecret: process.env.REPLOID_GITHUB_WEBHOOK_SECRET || null,
      githubWebhookHandler: service.handleGitHubWebhook
    })
  };
};

const configuredPoolStore = await createConfiguredPoolStore();
const configuredPoolAuth = await createConfiguredPoolAuth();
const configuredAdapterOriginSigner = await createConfiguredAdapterOriginSigner();
const configuredChangeControl = await createConfiguredChangeControl();
let publicInferenceGuard = null;
let publicInferenceConfigError = null;
try {
  publicInferenceGuard = createPublicInferenceGuard({
    config: createPublicInferenceConfig(process.env),
    getClientKey: (req) => String(req.ip || req.socket?.remoteAddress || 'unknown')
  });
} catch (error) {
  publicInferenceConfigError = error.message;
  console.error(`[Public inference] Disabled: ${publicInferenceConfigError}`);
}
const admitAnonymousInference = createPublicInferenceMiddleware({
  guard: publicInferenceGuard,
  configurationError: publicInferenceConfigError
});

const extractAuthorizationToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

const requireServerAccess = async (req, res, next) => {
  if (!rateLimiter.check(getRateLimitKey(req))) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }

  if (ALLOW_UNAUTHENTICATED_LOOPBACK && isLoopbackAddress(req.socket?.remoteAddress)) {
    req.reploidAccessSubject = 'loopback-development';
    return next();
  }

  const token = extractAuthorizationToken(req);
  if (SERVER_ACCESS_TOKEN && tokensEqual(token, SERVER_ACCESS_TOKEN)) {
    req.reploidAccessSubject = 'server-access-token';
    return next();
  }

  if (token && typeof configuredPoolAuth.verifyAuthToken === 'function') {
    try {
      const decoded = await configuredPoolAuth.verifyAuthToken(token);
      req.reploidAccessSubject = `firebase:${decoded?.uid || 'unknown'}`;
      return next();
    } catch {
      return res.status(401).json({ error: 'Server access token is invalid' });
    }
  }

  if (!SERVER_ACCESS_TOKEN && typeof configuredPoolAuth.verifyAuthToken !== 'function') {
    return res.status(503).json({ error: 'Protected server endpoints are not configured' });
  }

  return res.status(401).json({ error: 'Server access token is required' });
};

if (!GEMINI_API_KEY) {
  console.error('☡  WARNING: GEMINI_API_KEY not found in .env file');
  console.error('   The Gemini proxy endpoint will not work without it.');
}

console.log('⎈ Available API providers:');
if (GEMINI_API_KEY) console.log('   ★ Google Gemini');
if (OPENAI_API_KEY) console.log('   ★ OpenAI');
if (ANTHROPIC_API_KEY) console.log('   ★ Anthropic');
if (HUGGINGFACE_API_KEY) console.log('   ★ HuggingFace');
if (GROQ_API_KEY) console.log('   ★ Groq');
console.log(`   ☖  Ollama at: ${LOCAL_MODEL_ENDPOINT}`);
console.log(`   ☖  vLLM at: ${VLLM_ENDPOINT}`);

// Ollama process management
const runtimeServices = createProxyRuntimeServices({ localEndpoint: LOCAL_MODEL_ENDPOINT,
  autoStartOllama: AUTO_START_OLLAMA, logDirectory: path.join(__dirname, 'logs') });

if (!POOL_BACKEND_ONLY) void runtimeServices.start().catch(error => console.error('Runtime services failed:', error));

// Earning-loop routes (/v1) stay unmounted unless REPLOID_EARNING_ROUTES=enabled. They parse
// their own bounded bodies, so they mount before the general JSON parser, and no loopback or
// local-development bypass applies to them. An invalid or unsafe configuration stops startup.
const textApi = await mountTextApi(app, { env: process.env });
try {
  const earningRoutes = await mountEarningRoutes(app, { env: process.env });
  if (earningRoutes.mounted) {
    console.log(`[Earning routes] Mounted at ${earningRoutes.prefix} (production: ${earningRoutes.production})`);
  }
} catch (error) {
  console.error(`[Earning routes] Refusing to start: ${error.message}`);
  process.exit(1);
}

// This opt-in mailbox owns its small body parser and must precede generic CORS.
// Enabling it also binds this process to loopback; it is not a remote inference API.
const externalBrain = process.env.REPLOID_EXTERNAL_BRAIN === 'true'
  ? createExternalBrainRouter()
  : null;
if (externalBrain) app.use('/api/external-brain', externalBrain.router);

// Middleware to parse JSON bodies
installJsonBodyMiddleware(app, {
  poolBackendOnly: POOL_BACKEND_ONLY,
  poolJsonLimit: process.env.POOL_JSON_LIMIT,
  poolResearchJsonLimit: process.env.POOL_RESEARCH_JSON_LIMIT
});

if (decoFeedback) {
  app.use(decoFeedback.createFeedbackAssetMiddleware());
}

// CORS headers for API endpoints
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/pool/') || req.path.startsWith('/change-control/')) {
    const origin = req.headers.origin;
    if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
    } else {
      res.header('Access-Control-Allow-Origin', CORS_ORIGINS[0]);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control, X-Reploid-Client-Id, Idempotency-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
  }
  next();
});

// Server-side search and cited-page extraction (/api/retrieval). Off unless a provider, its key or
// base URL, and a daily query budget are configured (server/search/config.js); keys never reach browsers.
const searchRoutes = mountSearchRoutes(app, { env: process.env, authorize: requireServerAccess });
console.log(searchRoutes.mounted ? `[Search] Serving ${searchRoutes.provider} search` : `[Search] Off: ${searchRoutes.reason}`);

app.use('/pool', staticRootDir
  ? express.static(path.join(staticRootDir, 'pool'), { index: false, fallthrough: true })
  : serveBrowserTree({ prefix: 'pool', index: false }));

app.use('/pool', createPoolRouter({
  ...(configuredPoolStore ? { store: configuredPoolStore } : {}),
  ...configuredPoolAuth,
  allowUnauthenticatedLocal: process.env.POOL_ALLOW_UNAUTHENTICATED_LOCAL === 'true',
  allowCanaryCreation: process.env.POOL_ALLOW_BROWSER_CANARY_CREATE === 'true',
  createAdapterDownloadUrl: configuredAdapterOriginSigner
}));

if (configuredChangeControl) {
  app.use('/change-control', configuredChangeControl.router);
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const providers = [];
  if (GEMINI_API_KEY) providers.push('gemini');
  if (OPENAI_API_KEY) providers.push('openai');
  if (ANTHROPIC_API_KEY) providers.push('anthropic');
  if (HUGGINGFACE_API_KEY) providers.push('huggingface');
  if (GROQ_API_KEY) providers.push('groq');
  providers.push('ollama');
  providers.push('vllm');

  res.json({
    status: 'ok',
    providers: providers,
    primaryProvider: providers.includes('gemini') ? 'gemini' : providers[0],
    ollama: {
      status: runtimeServices.ollamaStatus,
      endpoint: LOCAL_MODEL_ENDPOINT
    },
    ollamaStatus: runtimeServices.ollamaStatus,
    timestamp: new Date().toISOString()
  });
});

// Proxy endpoint for Gemini API
mountProviderProxyRoutes(app, { ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, HUGGINGFACE_API_KEY, LOCAL_MODEL_ENDPOINT, OPENAI_API_KEY, VLLM_ENDPOINT, admitAnonymousInference, getGeminiHeaders, requireServerAccess });

// Endpoint to check if proxy is available (for client detection)
app.get('/api/proxy-status', (req, res) => {
  res.json({
    proxyAvailable: true,
    hasApiKey: !!GEMINI_API_KEY, // For backwards compatibility with ApiClient
    providers: {
      gemini: !!GEMINI_API_KEY,
      openai: !!OPENAI_API_KEY,
      anthropic: !!ANTHROPIC_API_KEY,
      huggingface: !!HUGGINGFACE_API_KEY,
      groq: !!GROQ_API_KEY,
      ollama: true,
      vllm: true
    },
    vllmEndpoint: VLLM_ENDPOINT,
    localEndpoint: LOCAL_MODEL_ENDPOINT
  });
});

// Endpoint to get available Ollama models
app.get('/api/ollama/models', async (req, res) => {
  try {
    const response = await fetch(`${LOCAL_MODEL_ENDPOINT}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return res.status(503).json({
        error: 'Ollama not available',
        models: []
      });
    }

    const data = await response.json();
    const models = data.models.map(model => ({
      name: model.name,
      size: model.size,
      modified: model.modified_at,
      digest: model.digest
    }));

    res.json({ models });
  } catch (error) {
    console.error('Failed to fetch Ollama models:', error.message);
    res.status(503).json({
      error: 'Failed to connect to Ollama',
      models: []
    });
  }
});

// GPU monitoring endpoint
app.get('/api/gpu/status', async (req, res) => {
  try {
    const gpuInfo = await runtimeServices.getGPUInfo();
    gpuInfo.monitoring = runtimeServices.monitoring;
    res.json(gpuInfo);
  } catch (error) {
    console.error('Failed to fetch GPU status:', error.message);
    res.status(500).json({
      error: 'Failed to fetch GPU status',
      details: error.message
    });
  }
});

// GPU monitoring logs endpoint
app.get('/api/gpu/logs', (req, res) => {
  try {
    if (!fs.existsSync(runtimeServices.monitoring.logDirectory)) {
      return res.json({ logs: [] });
    }

    const logFiles = fs.readdirSync(runtimeServices.monitoring.logDirectory)
      .filter(f => f.startsWith('gpu-monitor-'))
      .sort()
      .reverse()
      .slice(0, 10); // Last 10 log files

    const logs = logFiles.map(filename => {
      const content = fs.readFileSync(path.join(runtimeServices.monitoring.logDirectory, filename), 'utf8');
      return {
        filename,
        content,
        timestamp: filename.replace('gpu-monitor-', '').replace('.log', '')
      };
    });

    res.json({ logs });
  } catch (error) {
    console.error('Failed to read GPU logs:', error.message);
    res.status(500).json({
      error: 'Failed to read GPU logs',
      details: error.message
    });
  }
});

// --- VFS Persistence Endpoints ---
mountProxyStorageRoutes(app, { rootDirectory: path.join(__dirname, '..'), requireServerAccess });
// --- End Console Logging Endpoint ---

// --- WebRTC Signaling Endpoints ---
let signalingServer = null;

// Get signaling server stats
app.get('/api/signaling/stats', (req, res) => {
  if (!signalingServer) {
    return res.status(503).json({ error: 'Signaling server not initialized' });
  }

  res.json(signalingServer.getStats());
});
// --- End WebRTC Signaling Endpoints ---

// --- Agent Bridge Endpoints ---
let agentBridge = null;

// Get Agent Bridge stats
app.get('/api/agent-bridge/stats', (req, res) => {
  if (!agentBridge) {
    return res.status(503).json({ error: 'Agent Bridge not initialized' });
  }

  res.json(agentBridge.getStats());
});
// --- End Agent Bridge Endpoints ---

// Serve static files from the project root with WGSL MIME type support
mountProxyStaticRoutes(app, { serverDirectory: __dirname, browserFile, decoFeedback, decoFeedbackOptions, dopplerDemoDir, dopplerKernelDir, dopplerRootDir, protoRootDir, staticRootDir });

// Create HTTP server (needed for WebSocket)
const server = http.createServer(app);
const publicSwarmServer = new PublicSwarmServer({ localPort: PORT });

if (!POOL_BACKEND_ONLY) {
  // Initialize WebRTC Signaling Server
  try {
    signalingServer = new SignalingServer({
      path: '/signaling',
      heartbeatInterval: 30000,
      peerTimeout: 60000,
      localOnly: process.env.REPLOID_SIGNALING_LOCAL_ONLY !== 'false',
      allowedOrigins: CORS_ORIGINS,
      accessToken: process.env.REPLOID_SIGNALING_ACCESS_TOKEN || null
    });

    signalingServer.on('peer-joined', ({ peerId, roomId }) => {
      console.log(`[Proxy] Peer ${peerId} joined room ${roomId}`);
    });

    signalingServer.on('peer-left', ({ peerId, roomId }) => {
      console.log(`[Proxy] Peer ${peerId} left room ${roomId}`);
    });

    console.log('★ WebRTC signaling server initialized');
  } catch (error) {
    console.error('☡  Failed to initialize signaling server:', error.message);
  }

  // Initialize Agent Bridge
  try {
    agentBridge = new AgentBridge({
      path: '/agent-bridge',
      heartbeatInterval: 30000,
      agentTimeout: 120000,
      localOnly: process.env.REPLOID_AGENT_BRIDGE_LOCAL_ONLY !== 'false',
      allowedOrigins: CORS_ORIGINS,
      accessToken: process.env.REPLOID_AGENT_BRIDGE_ACCESS_TOKEN || null
    });

    agentBridge.on('agent-joined', ({ agentId, name }) => {
      console.log(`[Proxy] Agent joined: ${name} (${agentId})`);
    });

    agentBridge.on('agent-left', ({ agentId }) => {
      console.log(`[Proxy] Agent left: ${agentId}`);
    });

    console.log('★ Agent Bridge initialized');
  } catch (error) {
    console.error('☡  Failed to initialize Agent Bridge:', error.message);
  }
}

// Register upgrade handler after both servers are initialized
server.on('upgrade', (req, socket, head) => {
  if (publicSwarmServer.shouldHandle(req)) {
    publicSwarmServer.handleUpgrade(req, socket, head);
    return;
  }
  if (signalingServer?.shouldHandle(req)) {
    signalingServer.handleUpgrade(req, socket, head);
    return;
  }

  if (agentBridge?.shouldHandle(req)) {
    agentBridge.handleUpgrade(req, socket, head);
    return;
  }

  socket.destroy();
});

// Start server
server.listen({ port: PORT, ...(externalBrain ? { host: '127.0.0.1' } : {}) }, () => {
  const providers = [];
  if (GEMINI_API_KEY) providers.push('Gemini');
  if (OPENAI_API_KEY) providers.push('OpenAI');
  if (ANTHROPIC_API_KEY) providers.push('Anthropic');
  if (HUGGINGFACE_API_KEY) providers.push('HuggingFace');
  providers.push('Local');

  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   REPLOID Multi-Provider Proxy Server                 ║
║                                                        ║
║   HTTP API: http://localhost:${PORT}                      ║
║   WebRTC Signaling: ws://localhost:${PORT}/signaling      ║
║   Providers: ${providers.join(', ').padEnd(25)}    ║
║   Local endpoint: ${LOCAL_MODEL_ENDPOINT.padEnd(21)}║
║                                                        ║
║   Press Ctrl+C to stop                                ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});

const gracefulShutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully...`);

  await runtimeServices.close();
  try { await textApi.close(); } catch (error) { console.error('Text API cleanup remains unsettled:', error); }
  externalBrain?.close();
  publicSwarmServer.close();

  if (signalingServer) {
    signalingServer.close();
  }

  if (agentBridge) {
    agentBridge.close();
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * @fileoverview The hosted backend routes that Cloud Run serves today (server/proxy-app.js with
 * POOL_BACKEND_ONLY), composed from the same modules for the Cloudflare coordinator.
 *
 * Mounted, in proxy-app's order: landing attribution, the JSON body limits, CORS-free API routes
 * (the Worker entry owns CORS), /api/retrieval/status (search stays off, as in production), the Pool
 * router, Change Control, /api/health and /zero/gemini. Not mounted: the provider key proxies,
 * Ollama/vLLM/GPU, VFS storage, signaling and agent-bridge routes, which production either leaves
 * unconfigured (no provider keys) or binds to loopback; and the /v1 earning and fleet routes, which
 * production leaves off.
 */
import express from 'express';
import createPoolRouter from '../../pool/routes.js';
import { createFirestorePoolStore } from '../../pool/firebase-store.js';
import { installJsonBodyMiddleware } from '../../json-body-middleware.js';
import { mountLandingAttribution } from '../../landing-attribution.js';
import { mountSearchRoutes } from '../../search/mount.js';
import { createChangeControlAuthenticator, parseChangeControlTokenConfig } from '../../change-control/auth.js';
import { createFirestoreChangeControlStore } from '../../change-control/firestore-store.js';
import { createGitHubChangeControlAdapters } from '../../change-control/effects.js';
import { createGitHubAppClient } from '../../change-control/github.js';
import createChangeControlRouter from '../../change-control/routes.js';
import { createChangeControlService } from '../../change-control/service.js';
import { createZeroGeminiHandler } from '../../../packages/functions/zero-gemini-handler.js';
import { createFirebaseIdTokenVerifier, verifyAppCheckToken } from './firebase-tokens.js';

const bearer = (req) => {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

/**
 * `firestore` is the coordinator's document store (sqlite-firestore.js); `env` holds the Worker vars
 * and secrets. `rtcConfig(req)` answers /pool/rtc-config from the one TURN issuer (reploid-swarm).
 */
export function createCoordinatorApp({ firestore, env, runtimeBundleIdentity, rtcConfig = null, verifyIdToken = null, verifyAppCheck = null }) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const verifyAuthToken = verifyIdToken || createFirebaseIdTokenVerifier(projectId);
  const app = express();
  // The Worker entry replaces X-Forwarded-For with the connecting address, so one hop is trusted.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  mountLandingAttribution(app, { crossOrigin: true });
  installJsonBodyMiddleware(app, { poolBackendOnly: true, poolJsonLimit: env.POOL_JSON_LIMIT || '512kb', poolResearchJsonLimit: env.POOL_RESEARCH_JSON_LIMIT || '1mb' });

  const requireFirebaseAccess = async (req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Server access token is required' });
    try {
      const decoded = await verifyAuthToken(token);
      req.reploidAccessSubject = `firebase:${decoded.uid}`;
      return next();
    } catch {
      return res.status(401).json({ error: 'Server access token is invalid' });
    }
  };
  mountSearchRoutes(app, { env, authorize: requireFirebaseAccess, repoRoot: null });

  if (rtcConfig) app.get('/pool/rtc-config', (req, res, next) => rtcConfig(req, res).catch(next));
  app.use('/pool', createPoolRouter({
    store: createFirestorePoolStore({ firestore, collectionPrefix: env.POOL_FIRESTORE_PREFIX || '', kind: 'durable-object-sqlite' }),
    verifyAuthToken,
    requireAuth: true,
    allowUnauthenticatedLocal: false,
    allowCanaryCreation: env.POOL_ALLOW_BROWSER_CANARY_CREATE === 'true',
    allowPlaintextJobPrompts: env.POOL_ALLOW_PLAINTEXT_JOB_PROMPTS === 'true',
    createAdapterDownloadUrl: null,
    turnEnv: env,
    releaseEnv: env,
    runtimeBundleIdentity
  }));

  if (env.REPLOID_CHANGE_CONTROL_ENABLED !== 'false') {
    const store = createFirestoreChangeControlStore({ firestore, collectionPrefix: env.REPLOID_CHANGE_CONTROL_FIRESTORE_PREFIX || 'reploid' });
    const githubPrivateKey = String(env.REPLOID_GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const githubClient = env.REPLOID_GITHUB_APP_ID && githubPrivateKey
      ? createGitHubAppClient({ appId: env.REPLOID_GITHUB_APP_ID, privateKey: githubPrivateKey, apiBase: env.REPLOID_GITHUB_API_BASE || undefined })
      : null;
    const service = createChangeControlService({ store, githubClient, effectRegistry: createGitHubChangeControlAdapters(githubClient),
      detailsBaseUrl: env.REPLOID_CHANGE_CONTROL_PUBLIC_URL || null });
    app.use('/change-control', createChangeControlRouter({
      service, store,
      authenticate: createChangeControlAuthenticator({ tokenEntries: parseChangeControlTokenConfig(env.REPLOID_CHANGE_CONTROL_TOKENS || null) }),
      githubWebhookSecret: env.REPLOID_GITHUB_WEBHOOK_SECRET || null,
      githubWebhookHandler: service.handleGitHubWebhook
    }));
  }

  // Production's answer: no provider keys, so only the local providers are listed.
  app.get('/api/health', (req, res) => res.json({ status: 'ok', providers: ['ollama', 'vllm'], primaryProvider: 'ollama',
    ollama: { status: 'unknown', endpoint: 'http://localhost:11434' }, ollamaStatus: 'unknown', timestamp: new Date().toISOString() }));

  const zeroGemini = createZeroGeminiHandler({
    getApiKey: () => env.GEMINI_API_KEY || '',
    verifyZeroAccess: async (req, { bearerToken, appCheckToken }) => {
      if (!bearerToken || !appCheckToken) throw new Error('Firebase Auth and App Check credentials are required.');
      const [identity] = await Promise.all([
        verifyAuthToken(bearerToken),
        (verifyAppCheck || ((token) => verifyAppCheckToken(token, { projectNumber: env.FIREBASE_PROJECT_NUMBER, projectId })))(appCheckToken)
      ]);
      if (!identity?.uid) throw new Error('Firebase Auth identity is missing a uid.');
      return Object.freeze({ uid: identity.uid });
    }
  });
  app.all(['/zero/gemini', '/zero/gemini/*'], (req, res, next) => Promise.resolve(zeroGemini(req, res)).catch(next));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // Same shape as Express's default, without a stack trace.
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error?.status || error?.statusCode) || 500;
    console.error(JSON.stringify({ event: 'coordinator-route-failed', path: req.path, status }));
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: status < 500 ? String(error.message || 'Bad request') : 'Internal error' });
  });
  return app;
}

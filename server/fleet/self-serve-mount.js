/**
 * Off-by-default mount of the hosted self-serve fleet at `/v1/fleet` on the application server.
 *
 * REPLOID_FLEET_SELF_SERVE=enabled turns it on; REPLOID_FLEET_SELF_SERVE_CONFIG names an absolute
 * `reploid.fleet-self-serve-config/v1` file (policy, models, database paths, network); the room token
 * comes only from REPLOID_FLEET_ROOM_TOKEN (a secret, never a file in this repository). Sessions use the
 * existing Firebase sign-in. In production (NODE_ENV=production or a Cloud Run K_SERVICE) the test sign-in
 * is refused. Mount before any general body parser: these routes parse their own bounded bodies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { openFleetCredits } from './credits.js';
import { createFleetServiceHandler } from './service.js';
import { openSelfServeFleet } from './self-serve.js';
import { createSelfServeHttpHandler, firebaseSessionAuthenticator, testSessionAuthenticator } from './self-serve-http.js';

export const SELF_SERVE_SWITCH = 'REPLOID_FLEET_SELF_SERVE';
export const SELF_SERVE_CONFIG = 'REPLOID_FLEET_SELF_SERVE_CONFIG';
export const SELF_SERVE_ROOM_TOKEN = 'REPLOID_FLEET_ROOM_TOKEN';
export const SELF_SERVE_TEST_SIGN_IN = 'REPLOID_FLEET_TEST_SIGN_IN';
export const SELF_SERVE_CONFIG_SCHEMA = 'reploid.fleet-self-serve-config/v1';

const refuse = message => { throw Error(`Self-serve fleet: ${message}`); };
const isProduction = env => env.NODE_ENV === 'production' || Boolean(env.K_SERVICE);

async function firebaseVerifier() {
  const appModule = await import('firebase-admin/app');
  const authModule = await import('firebase-admin/auth');
  if (appModule.getApps().length === 0) appModule.initializeApp();
  const auth = authModule.getAuth();
  return token => auth.verifyIdToken(token, true);
}

/** Open the ledger, accounts and handler from a configuration value. Exported for tests and other hosts. */
export async function openHostedSelfServe(configuration, { roomToken, authenticate, now = Date.now, clientKey } = {}) {
  if (configuration?.schema !== SELF_SERVE_CONFIG_SCHEMA) refuse(`configuration must use schema ${SELF_SERVE_CONFIG_SCHEMA}`);
  for (const name of ['databaseFile', 'accountsFile']) if (!path.isAbsolute(configuration[name] || '')) refuse(`${name} must be an absolute path`);
  const credits = await openFleetCredits({ file: configuration.databaseFile, computers: [], policy: configuration.creditPolicy, now, openEnrollment: true });
  try {
    const selfServe = await openSelfServeFleet({ credits, file: configuration.accountsFile, models: configuration.models,
      network: { ...configuration.network, roomToken }, starterDebt: configuration.starterDebt, limits: configuration.limits, now });
    const fleet = createFleetServiceHandler({ credits, models: configuration.models, placementPolicy: configuration.placementPolicy, now, directory: 'own' });
    const handle = createSelfServeHttpHandler({ selfServe, fleet, authenticate, ...(clientKey ? { clientKey } : {}) });
    return { credits, selfServe, fleet, handle, close() { selfServe.close(); credits.close(); } };
  } catch (error) { credits.close(); throw error; }
}

export async function mountSelfServeFleet(app, { env = process.env, readFile = fs.readFile, verifier = firebaseVerifier } = {}) {
  const value = env[SELF_SERVE_SWITCH];
  if (value === undefined || value === '' || value === 'disabled') return { mounted: false, close() {} };
  if (value !== 'enabled') refuse(`${SELF_SERVE_SWITCH} must be "enabled" or "disabled"`);
  const production = isProduction(env);
  const file = env[SELF_SERVE_CONFIG];
  if (!file || !path.isAbsolute(file)) refuse(`${SELF_SERVE_CONFIG} must name an absolute configuration file`);
  const roomToken = env[SELF_SERVE_ROOM_TOKEN];
  if (typeof roomToken !== 'string' || roomToken.length < 32) refuse(`${SELF_SERVE_ROOM_TOKEN} must hold at least 32 characters`);
  let authenticate;
  if (env[SELF_SERVE_TEST_SIGN_IN] === 'enabled') {
    if (production) refuse('the test sign-in is not permitted in production');
    authenticate = testSessionAuthenticator;
  } else authenticate = firebaseSessionAuthenticator(await verifier());
  const configuration = JSON.parse(await readFile(file, 'utf8'));
  // Behind Firebase Hosting and Cloud Run the client address arrives in X-Forwarded-For; locally it is the socket's.
  const clientKey = request => production
    ? String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || request.socket?.remoteAddress || 'unknown'
    : request.socket?.remoteAddress || 'unknown';
  const hosted = await openHostedSelfServe(configuration, { roomToken, authenticate, clientKey });
  app.use((request, response, next) => {
    const pathname = request.path;
    if (pathname === '/v1/fleet' || pathname.startsWith('/v1/fleet/')) return void hosted.handle(request, response);
    next();
  });
  return { mounted: true, production, prefix: '/v1/fleet', close: () => hosted.close() };
}

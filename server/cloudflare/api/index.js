/**
 * @fileoverview reploid-api: the hosted backend on Cloudflare (what Cloud Run `reploid-pool` and the
 * `zeroGemini` Function serve today), at its own hostname. Firebase Hosting keeps serving the page.
 *
 * The Worker owns CORS for exactly the hosted origins in shared/config/hosted-api.json; CORS lets the
 * page read responses and is not access control, so every route keeps its own checks. Requests go to
 * one coordinator Durable Object, which runs the same Express routes over one SQLite store (single
 * writer, like Cloud Run's one instance), so the store's transactions and the in-process rate limits
 * keep the meaning they have on Cloud Run.
 */
import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import hostedApi from '../../../shared/config/hosted-api.json';
import { allowsSwarmOrigin as allowsHostedOrigin } from '../../swarm-protocol.js';
import { createSqliteFirestore } from './sqlite-firestore.js';
import { createCoordinatorApp } from './app.js';
import { handleMigration } from './migration.js';

const PORT = 8787;
const ROUTE_PREFIXES = ['/pool/', '/api/', '/change-control/', '/zero/gemini'];
const ALLOW_HEADERS = 'Authorization, Content-Type, Cache-Control, Idempotency-Key, X-Firebase-AppCheck, X-Reploid-Client-Id';
// Ephemeral collections the coordinator expires itself; Firestore kept them forever.
const PRUNE = [['rate_limits', 'expiresAt'], ['peer_room_messages', 'expiresAt']];
const PRUNE_EVERY_MS = 60 * 60 * 1000;

const routed = (pathname) => ROUTE_PREFIXES.some((prefix) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix));

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Expose-Headers': 'Retry-After', 'Access-Control-Max-Age': '600' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ service: 'reploid-api', release: env.REPLOID_RELEASE_SOURCE_REVISION || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const origin = request.headers.get('Origin');
    // Browsers send Origin on cross-origin requests; scripts, native hosts and webhooks usually do not.
    if (origin && !allowsHostedOrigin(origin, hostedApi)) return new Response('Origin not allowed', { status: 403 });
    const cors = origin ? corsHeaders(origin) : {};
    if (url.pathname.startsWith('/admin/')) return handleMigration(request, env);
    if (!routed(url.pathname)) return Response.json({ error: 'Not found' }, { status: 404, headers: cors });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '0.0.0.0');
    const forwarded = new Request(request, { headers });
    try {
      const response = await env.COORDINATOR.getByName('coordinator').fetch(forwarded);
      const out = new Response(response.body, response);
      // Route handlers may set their own CORS values (Zero Gemini does); the Worker's are authoritative.
      for (const name of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Credentials', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers']) out.headers.delete(name);
      for (const [name, value] of Object.entries(cors)) out.headers.set(name, value);
      return out;
    } catch {
      console.error(JSON.stringify({ event: 'coordinator-unavailable', path: url.pathname }));
      return Response.json({ error: 'Service unavailable' }, { status: 503, headers: { ...cors, 'Retry-After': '5' } });
    }
  }
};

let listening = null;

/** The single coordinator: Express routes over one SQLite document store. */
export class ReploidCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.firestore = createSqliteFirestore({ sql: ctx.storage.sql, atomically: (fn) => ctx.storage.transactionSync(fn) });
    ctx.blockConcurrencyWhile(async () => {
      if (!await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Date.now() + PRUNE_EVERY_MS);
    });
  }

  handler() {
    if (!listening) {
      const app = createCoordinatorApp({
        firestore: this.firestore, env: this.env,
        runtimeBundleIdentity: { schema: 'poolday.coordinator_runtime_bundle/v1', runtimeBundleHash: this.env.REPLOID_RUNTIME_BUNDLE_HASH || null, files: [] },
        rtcConfig: (req, res) => this.rtcConfig(req, res)
      });
      app.listen(PORT);
      listening = httpServerHandler({ port: PORT });
    }
    return listening;
  }

  // One TURN issuer: /pool/rtc-config answers from reploid-swarm's /rtc-config, with the caller's token.
  async rtcConfig(req, res) {
    if (!this.env.SWARM?.fetch) return res.status(503).json({ error: 'TURN relay is not configured', code: 'turn_not_configured' });
    const headers = { Origin: hostedApi.allowedOrigins[0] };
    if (req.headers.authorization) headers.Authorization = req.headers.authorization;
    if (req.headers['x-reploid-client-id']) headers['X-Reploid-Client-Id'] = req.headers['x-reploid-client-id'];
    const upstream = await this.env.SWARM.fetch('https://reploid-swarm/rtc-config', { headers, redirect: 'manual' });
    const retryAfter = upstream.headers.get('Retry-After');
    if (retryAfter) res.set('Retry-After', retryAfter);
    res.set('Cache-Control', 'no-store');
    return res.status(upstream.status).type('application/json').send(await upstream.text());
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin/')) return handleMigration(request, this.env, this.firestore);
    return this.handler().fetch(request, this.env, this.ctx);
  }

  async alarm() {
    const now = new Date().toISOString();
    const pruned = {};
    for (const [collection, field] of PRUNE) pruned[collection] = await this.firestore.pruneBefore(collection, field, now);
    console.log(JSON.stringify({ event: 'coordinator-pruned', ...pruned }));
    await this.ctx.storage.setAlarm(Date.now() + PRUNE_EVERY_MS);
  }
}

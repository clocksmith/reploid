/**
 * @fileoverview Provider routes mounted beside the earning routes, under the
 * same switch and prefix:
 *
 *   GET  /sign-in/:providerId                   public settings of a browser sign-in flow
 *   POST /sign-in/:providerId/states            a single-use sign-in state; no body is read
 *   POST /payments/notifications/:processorId   a payment processor's notification
 *
 * None takes a session. Every request is counted per client address; the
 * sign-in routes also count under the sign-in limit. A notification's raw
 * bytes are read under the evidence bound and handed to the payment store
 * unparsed; the processor parses them only after their signature verifies,
 * so these routes, like the earning routes, mount before any general body
 * parser, and a body parsed upstream is refused. Unknown providers and
 * processors fall through to the earning router's 404.
 */

import express from 'express';

import { consumeRate, createMemoryRateLimiter, earningErrorHandler, refuse, validateRouteLimits } from './http.js';

/**
 * @param {object} options
 * @param {object} options.accounts account store; flows must be its configured providers
 * @param {Array<object>} [options.signInFlows] providers with clientConfig() and issueState()
 * @param {object} [options.payments] payment store (server/payments) whose processor verifies notifications
 * @param {object} options.limits explicit route limits (http.js)
 * @param {object} [options.rateLimiter]
 */
export function createProviderRouter({ accounts, signInFlows = [], payments = null, limits, rateLimiter = null, nowMs = () => Date.now(), log = console } = {}) {
  const bounds = validateRouteLimits(limits);
  const limiter = rateLimiter ?? createMemoryRateLimiter({ nowMs });
  if (typeof limiter.consume !== 'function') throw new TypeError('rateLimiter must provide consume({ key, max, windowMs })');
  const configured = new Set((accounts?.signInProviders ?? []).map(({ providerId }) => providerId));
  const flows = new Map();
  for (const flow of signInFlows) {
    if (typeof flow?.clientConfig !== 'function' || typeof flow.issueState !== 'function') throw new TypeError('each sign-in flow needs clientConfig() and issueState()');
    if (!configured.has(flow.providerId)) throw new TypeError(`sign-in flow ${flow.providerId} is not a configured sign-in provider`);
    flows.set(flow.providerId, flow);
  }
  if (payments && (typeof payments.receiveNotification !== 'function' || typeof payments.processor?.id !== 'string')) {
    throw new TypeError('payments must be a payment store naming its processor');
  }
  const count = (res, key, limit) => consumeRate(limiter, res, { key, ...limit, nowMs });
  const readRaw = express.raw({ type: () => true, limit: bounds.evidenceJsonBytes });
  const router = express.Router();

  /** Run `handler` for a known target; anything else continues to the earning router. */
  const route = (known, handler) => (req, res, next) => {
    if (!known(req)) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    (async () => {
      await count(res, `address:${req.ip ?? 'unknown'}`, bounds.address);
      const { status = 200, body } = await handler(req, res);
      res.status(status).json(body);
    })().catch(next);
  };

  const knownFlow = (req) => flows.has(req.params.providerId);
  router.get('/sign-in/:providerId', route(knownFlow, async (req, res) => {
    await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
    return { body: flows.get(req.params.providerId).clientConfig() };
  }));
  router.post('/sign-in/:providerId/states', route(knownFlow, async (req, res) => {
    await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
    return { status: 201, body: flows.get(req.params.providerId).issueState() };
  }));

  if (payments) {
    router.post('/payments/notifications/:processorId', route((req) => req.params.processorId === payments.processor.id, async (req, res) => {
      if (req._body) refuse(500, 'ingress_misconfigured', 'processor notifications must arrive unparsed; mount these routes before any general body parser');
      await new Promise((resolve, reject) => readRaw(req, res, (error) => (error ? reject(error) : resolve())));
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) refuse(400, 'notification_body_required', 'the notification has no body');
      const received = await payments.receiveNotification({ headers: req.headers, rawBody: req.body });
      return { body: { received: true, eventId: received.eventId, duplicate: received.duplicate, matched: received.matched } };
    }));
  }

  router.use(earningErrorHandler(log));
  return router;
}

export default createProviderRouter;

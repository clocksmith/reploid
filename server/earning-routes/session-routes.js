/**
 * @fileoverview Device-session routes where the service authors the terms a
 * device asks for, mounted beside the earning router under the same switch
 * and prefix:
 *
 *   POST /payments/checkouts              start a one-time top-up checkout (body: { topUpId })
 *   GET  /payments/checkouts/:checkoutId  the account's checkout and its reconciliation phase
 *   POST /offers                          a contribution offer for this device (body: { category, model })
 *   POST /community-access/requests       ask for funded Community Access for one answer (body: { request })
 *   GET  /community-access/requests/:requestId  that request's state (read only; the scheduler admits queued requests)
 *
 * Each needs a session acting as an active registered device; the account,
 * device and participant come from that session, never from the body. A
 * checkout's price comes from the payment policy and its credits from the
 * conversion record in effect; an offer's reward, bounds and duration come
 * from the operator's offer policy; a Community Access request's quote comes
 * from the same service and price policy as paid quotes, and the pool stamps
 * its own evidence terms. Mutations bind their Idempotency-Key to
 * the route, the caller and the canonical request exactly as the earning
 * router does (idempotency.js): a definite no-effect refusal frees the key;
 * anything else keeps it, and the retry reconciles through the component's
 * own idempotency under the same derived key. Bodies are parsed only after
 * authentication, under the route limits. Unconfigured payments or offers
 * answer 503; other paths continue to the earning router.
 */

import express from 'express';

import { sha256Hex } from '../ledger/domain.js';

import {
  RouteError,
  bearerToken,
  bodyOf,
  consumeRate,
  createMemoryRateLimiter,
  earningErrorHandler,
  idempotencyKeyOf,
  isComponentRefusal,
  refuse,
  validateRouteLimits
} from './http.js';
import { createRouteIdempotency } from './idempotency.js';

const hasBody = (req) => req.headers['transfer-encoding'] !== undefined
  || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');

/** What a device sees of its checkout: the hand-off to complete, never processor internals. */
export const checkoutView = (payment) => ({
  checkoutId: payment.checkoutId,
  phase: payment.phase,
  topUp: payment.topUp,
  credits: payment.credits,
  checkout: payment.checkout
    ? Object.fromEntries(['kind', 'url', 'expiresAt', 'mode'].filter((key) => payment.checkout[key] !== undefined).map((key) => [key, payment.checkout[key]]))
    : null,
  issued: Boolean(payment.issuance),
  reversed: Boolean(payment.reversal?.applied),
  updatedAt: payment.updatedAt
});

/**
 * @param {object} options
 * @param {object} options.accounts account store
 * @param {object} [options.payments] payment store (server/payments)
 * @param {object} [options.rewards] contribution reward store
 * @param {Function} [options.offerTerms] ({ accountId, deviceId, participantId, host, request }) -> offer input | null
 * @param {object} options.limits explicit route limits (http.js)
 * @param {object} options.idempotencyBackend the earning router's binding backend
 */
export function createSessionRouter({
  accounts, payments = null, rewards = null, offerTerms = null, communityAccess = null, quoteTerms = null, ledger = null, limits, idempotencyBackend,
  rateLimiter = null, nowMs = () => Date.now(), log = console
} = {}) {
  if (!accounts || typeof accounts.authorizeDevice !== 'function') throw new TypeError('session routes need the account store');
  if (payments && (typeof payments.startCheckout !== 'function' || typeof payments.getPayment !== 'function')) {
    throw new TypeError('payments must be a payment store');
  }
  if (offerTerms !== null && (typeof offerTerms !== 'function' || typeof rewards?.createOffer !== 'function')) {
    throw new TypeError('offers need the offer-terms port and the reward store');
  }
  if (communityAccess !== null && (typeof communityAccess.requestAccess !== 'function' || typeof communityAccess.getRequest !== 'function'
    || typeof ledger?.getQuote !== 'function')) {
    throw new TypeError('Community Access routes need the Community Access store and the ledger');
  }
  const bounds = validateRouteLimits(limits);
  const idempotency = createRouteIdempotency({ backend: idempotencyBackend, leaseMs: bounds.idempotencyLeaseMs, nowMs });
  const limiter = rateLimiter ?? createMemoryRateLimiter({ nowMs });
  const parseJson = express.json({ limit: bounds.jsonBytes, strict: true });
  const count = (res, key, limit) => consumeRate(limiter, res, { key, ...limit, nowMs });
  const router = express.Router();

  /** Count, authenticate as an active device, then parse: unauthenticated callers never reach the parser. */
  const authenticate = async (req, res, { device }) => {
    await count(res, `address:${req.ip ?? 'unknown'}`, bounds.address);
    const token = bearerToken(req);
    if (!token) refuse(401, 'session_required', 'a session bearer token is required');
    const session = device ? await accounts.authorizeDevice(token) : await accounts.authenticate(token);
    await count(res, `account:${session.accountId}`, bounds.account);
    if (device) await count(res, `device:${session.deviceId}`, bounds.device);
    return { token, accountId: session.accountId, deviceId: session.deviceId,
      caller: device ? { accountId: session.accountId, deviceId: session.deviceId } : { accountId: session.accountId } };
  };
  const parse = (req, res) => new Promise((resolve, reject) => {
    if (req._body) {
      reject(new RouteError(500, 'ingress_misconfigured', 'earning routes must parse their own bounded bodies; mount them before any general body parser'));
      return;
    }
    if (hasBody(req) && !req.is('application/json')) {
      reject(new RouteError(415, 'json_required', 'this route accepts an application/json body'));
      return;
    }
    parseJson(req, res, (error) => (error ? reject(error) : resolve()));
  });

  const define = (method, path, spec, handler) => {
    router[method](path, (req, res, next) => {
      (async () => {
        res.setHeader('Cache-Control', 'no-store');
        if (spec.unavailable?.()) refuse(503, spec.unavailableCode, spec.unavailableMessage);
        const ctx = await authenticate(req, res, spec);
        if (spec.body) await parse(req, res);
        const { status = 200, body, replayed = false } = await handler(req, { ...ctx, routeId: `${method.toUpperCase()} ${path}` });
        if (replayed) res.setHeader('Idempotent-Replayed', 'true');
        res.status(status).json(body);
      })().catch(next);
    });
  };

  // The same binding discipline as the earning router's keyed().
  const keyed = async (req, ctx, body, run, { atomic }) => {
    const binding = await idempotency.begin({ routeId: ctx.routeId, caller: ctx.caller, key: idempotencyKeyOf(req), request: { params: { ...req.params }, body } });
    if (binding.replay) return { ...binding.replay, replayed: true };
    let response;
    try {
      response = await run(binding.componentKey);
      await binding.complete(response);
    } catch (error) {
      const definite = error instanceof RouteError || (atomic && isComponentRefusal(error));
      try {
        await (definite ? binding.release() : binding.markUnknown());
      } catch (cause) {
        log.error?.('[Earning routes] idempotency binding not updated:', cause);
      }
      throw error;
    }
    return response;
  };

  const activeDevice = async (ctx) => {
    const device = await accounts.getDevice(ctx.deviceId);
    if (device?.status !== 'active' || device.accountId !== ctx.accountId) refuse(401, 'session_device_revoked', 'the session device is not active');
    return device;
  };

  const noPayments = { unavailable: () => !payments, unavailableCode: 'payments_unconfigured', unavailableMessage: 'top-ups are not offered by this service' };
  /**
   * A checkout record commits before the processor is called, so even a coded
   * refusal may follow an effect: the key stays for a retry, which resumes
   * the same checkout through the payment store's own key.
   */
  define('post', '/payments/checkouts', { device: true, body: true, ...noPayments }, async (req, ctx) => {
    const body = bodyOf(req, ['topUpId']);
    if (typeof body.topUpId !== 'string' || body.topUpId.length === 0) refuse(400, 'invalid_body', 'topUpId must name a top-up the service offers');
    return keyed(req, ctx, body, async (idempotencyKey) => {
      const device = await activeDevice(ctx);
      const payment = await payments.startCheckout({ participantId: device.participantId, topUpId: body.topUpId, idempotencyKey });
      if (payment.accountId !== ctx.accountId) refuse(409, 'checkout_account_mismatch', 'the checkout belongs to another account');
      return { status: 201, body: checkoutView(payment) };
    }, { atomic: false });
  });
  define('get', '/payments/checkouts/:checkoutId', { device: false, ...noPayments }, async (req, ctx) => {
    const payment = /^chk_[a-f0-9]{32}$/.test(req.params.checkoutId) ? await payments.getPayment(req.params.checkoutId) : null;
    if (!payment || payment.accountId !== ctx.accountId) refuse(404, 'checkout_not_found', 'no checkout with this id belongs to the account');
    return { body: checkoutView(payment) };
  });

  /**
   * The offer id derives from the request's component key, so every attempt
   * of the same request reaches the same offer and no other caller or request
   * can reach it; terms are stamped at call time, so the reward store cannot
   * compare retries itself.
   */
  define('post', '/offers', {
    device: true, body: true, unavailable: () => !offerTerms, unavailableCode: 'offers_unconfigured', unavailableMessage: 'contribution offers are not composed'
  }, async (req, ctx) => {
    const body = bodyOf(req, ['category', 'model']);
    return keyed(req, ctx, body, async (idempotencyKey) => {
      const offerId = `offer_${sha256Hex(idempotencyKey).slice(0, 32)}`;
      const existing = await rewards.getOffer(offerId);
      if (existing) {
        if (existing.accountId !== ctx.accountId) refuse(409, 'offer_conflict', 'the offer id is in use');
        return { body: existing };
      }
      const device = await activeDevice(ctx);
      const terms = await offerTerms({ accountId: ctx.accountId, deviceId: ctx.deviceId, participantId: device.participantId, host: device.host,
        request: { category: body.category, model: body.model } });
      if (!terms) refuse(422, 'offer_not_available', 'no contribution offer covers this device, category and model');
      try {
        return { status: 201, body: await rewards.createOffer({ ...terms, offerId, idempotencyKey }) };
      } catch (error) {
        const raced = ['offer_exists', 'idempotency_conflict'].includes(error?.code) ? await rewards.getOffer(offerId) : null;
        if (raced?.accountId === ctx.accountId) return { body: raced };
        throw error;
      }
    }, { atomic: true });
  });

  /**
   * Community Access for one answer from an active device: the service's own quote for the named model,
   * admitted under funded, admitted capacity or queued. An available request names the pool reservation
   * this device then binds and reports on, with the pool's quote, so the device can keep its deadlines.
   */
  const noAccess = { unavailable: () => !communityAccess, unavailableCode: 'community_access_unconfigured', unavailableMessage: 'Community Access is not offered by this service' };
  const withQuote = async (view) => (view?.state === 'available' && view.quoteId ? { ...view, quote: await ledger.getQuote(view.quoteId) } : view);
  define('post', '/community-access/requests', { device: true, body: true, ...noAccess }, async (req, ctx) => {
    const body = bodyOf(req, ['request']);
    if (typeof quoteTerms !== 'function') refuse(503, 'quote_terms_unconfigured', 'Community Access needs the service and price policy port');
    // Recording, then an admission pass: even a coded refusal may follow a record, so the key stays for the retry.
    return keyed(req, ctx, body, async (idempotencyKey) => {
      const device = await activeDevice(ctx);
      const offered = await quoteTerms({ accountId: ctx.accountId, deviceId: ctx.deviceId, request: body.request ?? null });
      if (!offered) refuse(422, 'quote_not_offered', 'no service is offered for this request');
      const { service, pricing, terms } = offered;
      const requestId = `car_${sha256Hex(idempotencyKey).slice(0, 32)}`;
      const view = await communityAccess.requestAccess({ requestId, participantId: device.participantId, deviceId: ctx.deviceId, quote: { service, pricing, terms } });
      return { status: 201, body: await withQuote({ requestId, ...view }) };
    }, { atomic: false });
  });
  define('get', '/community-access/requests/:requestId', { device: true, ...noAccess }, async (req, ctx) => {
    // A read only: queued requests advance through the scheduler's admission sweep, never through this route.
    const known = /^car_[a-f0-9]{32}$/.test(req.params.requestId) ? await communityAccess.getRequest(req.params.requestId) : null;
    if (!known || known.accountId !== ctx.accountId) refuse(404, 'community_access_request_not_found', 'no Community Access request with this id belongs to the account');
    return { body: await withQuote(known) };
  });

  router.use(earningErrorHandler(log));
  return router;
}

export default createSessionRouter;

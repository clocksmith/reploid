/**
 * @fileoverview Provider routes mounted beside the earning routes, under the
 * same switch and prefix:
 *
 *   GET  /client                                the service's public settings: sign-in flows, top-ups, Community Access
 *   GET  /sign-in/:providerId                   public settings of a browser sign-in flow
 *   POST /sign-in/:providerId/states            a single-use sign-in state; no body is read
 *   POST /sign-in/:providerId/assertions        local test flows only: an assertion for a typed subject
 *   POST /payments/notifications/:processorId   a payment processor's notification
 *   GET  /payments/test-checkouts/:checkoutId          test processor only: its checkout page
 *   POST /payments/test-checkouts/:checkoutId/complete test processor only: pay that checkout
 *
 * None takes a session. Every request is counted per client address; the
 * sign-in routes also count under the sign-in limit. A notification's raw
 * bytes are read under the evidence bound and handed to the payment store
 * unparsed; the processor parses them only after their signature verifies,
 * so these routes, like the earning routes, mount before any general body
 * parser, and a body parsed upstream is refused. Unknown providers and
 * processors fall through to the earning router's 404. The local test flow
 * and test checkout exist only with test-only providers, which production
 * compositions refuse.
 */

import express from 'express';

import { consumeRate, createMemoryRateLimiter, earningErrorHandler, refuse, validateRouteLimits } from './http.js';

export const EARNING_SERVICE_SCHEMA = 'reploid.earning-service/v1';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const money = ({ amountMinor, currency }) => `${(amountMinor / 100).toFixed(2)} ${currency}`;

/** The test processor's checkout page: no money moves; completing it pays the checkout through the test processor. */
const testCheckoutPage = ({ checkout, action, done }) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Test checkout</title></head>
<body><main><h1>Test checkout</h1>
<p>No money moves. This page completes a top-up through the local test processor.</p>
<p data-test-checkout-summary>${escapeHtml(money(checkout.topUp.price))} for ${escapeHtml(checkout.credits)} credits</p>
${done ? `<p role="status" data-test-checkout-status>${escapeHtml(done)}</p><p><a href="/">Return to Reploid</a></p>`
    : `<form method="post" action="${escapeHtml(action)}"><button type="submit" data-test-checkout-complete>Complete test payment</button></form>
<p><a href="/">Cancel</a></p>`}
</main></body></html>`;

/**
 * @param {object} options
 * @param {object} options.accounts account store; flows must be its configured providers
 * @param {Array<object>} [options.signInFlows] providers with clientConfig() and issueState(), or test-only flows with issueAssertion()
 * @param {object} [options.payments] payment store (server/payments) whose processor verifies notifications
 * @param {object} [options.testCheckout] test processor only: { describe(checkoutId), complete(checkoutId) }
 * @param {object} options.limits explicit route limits (http.js)
 * @param {object} [options.rateLimiter]
 */
export function createProviderRouter({ accounts, signInFlows = [], payments = null, testCheckout = null, communityAccess = false, limits, rateLimiter = null,
  nowMs = () => Date.now(), log = console } = {}) {
  const bounds = validateRouteLimits(limits);
  const limiter = rateLimiter ?? createMemoryRateLimiter({ nowMs });
  if (typeof limiter.consume !== 'function') throw new TypeError('rateLimiter must provide consume({ key, max, windowMs })');
  const configured = new Set((accounts?.signInProviders ?? []).map(({ providerId }) => providerId));
  const flows = new Map();
  for (const flow of signInFlows) {
    const local = flow?.testOnly === true && typeof flow.issueAssertion === 'function';
    if (typeof flow?.clientConfig !== 'function' || (typeof flow.issueState !== 'function' && !local)) {
      throw new TypeError('each sign-in flow needs clientConfig() and issueState(), or is a test-only flow with issueAssertion()');
    }
    if (!configured.has(flow.providerId)) throw new TypeError(`sign-in flow ${flow.providerId} is not a configured sign-in provider`);
    flows.set(flow.providerId, flow);
  }
  if (payments && (typeof payments.receiveNotification !== 'function' || typeof payments.processor?.id !== 'string')) {
    throw new TypeError('payments must be a payment store naming its processor');
  }
  if (testCheckout && (payments?.processor?.testOnly !== true || typeof testCheckout.complete !== 'function' || typeof testCheckout.describe !== 'function')) {
    throw new TypeError('a test checkout needs the test-only processor and describe/complete');
  }
  const count = (res, key, limit) => consumeRate(limiter, res, { key, ...limit, nowMs });
  const readRaw = express.raw({ type: () => true, limit: bounds.evidenceJsonBytes });
  const readJson = express.json({ limit: bounds.jsonBytes, strict: true });
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
      const { status = 200, body, html } = await handler(req, res);
      if (html !== undefined) res.status(status).type('html').send(html);
      else res.status(status).json(body);
    })().catch(next);
  };

  // What a host needs to compose its client: which sign-in flows and top-ups this service offers. No secret travels.
  router.get('/client', route(() => true, async () => ({
    body: {
      schema: EARNING_SERVICE_SCHEMA,
      signIn: [...flows.values()].map((flow) => {
        const { providerId, flow: kind } = flow.clientConfig();
        return { providerId, flow: kind, testOnly: flow.testOnly === true };
      }),
      topUps: payments ? payments.policy.topUps.map(({ topUpId, price }) => ({ topUpId, price: { ...price } })) : [],
      communityAccess: communityAccess === true
    }
  })));

  const knownFlow = (req) => flows.has(req.params.providerId);
  router.get('/sign-in/:providerId', route(knownFlow, async (req, res) => {
    await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
    return { body: flows.get(req.params.providerId).clientConfig() };
  }));
  router.post('/sign-in/:providerId/states', route((req) => typeof flows.get(req.params.providerId)?.issueState === 'function', async (req, res) => {
    await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
    return { status: 201, body: flows.get(req.params.providerId).issueState() };
  }));
  router.post('/sign-in/:providerId/assertions', route((req) => flows.get(req.params.providerId)?.testOnly === true
    && typeof flows.get(req.params.providerId).issueAssertion === 'function', async (req, res) => {
    await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
    if (req._body) refuse(500, 'ingress_misconfigured', 'sign-in routes must parse their own bounded bodies; mount them before any general body parser');
    if (!req.is('application/json')) refuse(415, 'json_required', 'this route accepts an application/json body');
    await new Promise((resolve, reject) => readJson(req, res, (error) => (error ? reject(error) : resolve())));
    const subject = req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 1 ? req.body.subject : undefined;
    const issued = flows.get(req.params.providerId).issueAssertion({ subject });
    if (!issued) refuse(400, 'invalid_body', 'the body must be { subject } with a short lowercase name');
    return { status: 201, body: issued };
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

  if (testCheckout) {
    const knownCheckout = (req) => /^chk_[a-f0-9]{32}$/.test(req.params.checkoutId);
    const recorded = (checkout) => (checkout.issued ? 'Payment recorded.' : `Payment ${checkout.phase}.`);
    router.get('/payments/test-checkouts/:checkoutId', route(knownCheckout, async (req) => {
      const checkout = await testCheckout.describe(req.params.checkoutId);
      if (!checkout) refuse(404, 'checkout_not_found', 'no test checkout has this id');
      const open = checkout.phase === 'open';
      return { html: testCheckoutPage({ checkout, action: `${req.baseUrl}/payments/test-checkouts/${req.params.checkoutId}/complete`, done: open ? null : recorded(checkout) }) };
    }));
    router.post('/payments/test-checkouts/:checkoutId/complete', route(knownCheckout, async (req) => {
      const checkout = await testCheckout.complete(req.params.checkoutId);
      if (!checkout) refuse(404, 'checkout_not_found', 'no test checkout has this id');
      return { html: testCheckoutPage({ checkout, action: '', done: recorded(checkout) }) };
    }));
  }

  router.use(earningErrorHandler(log));
  return router;
}

export default createProviderRouter;

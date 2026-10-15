// A fake Stripe account for the Checkout processor adapter: Checkout Sessions, payment intents,
// charges, refunds and disputes behind the REST calls the adapter makes, and webhook events
// signed as Stripe documents (HMAC-SHA256 over `${t}.${body}` per endpoint secret). Test-only;
// it moves no money and reaches no network.
import { createHmac } from 'node:crypto';

export const TEST_SECRET_KEY = 'sk_test_fakeKeyForTests';
export const LIVE_SECRET_KEY = 'sk_live_fakeKeyForTests';
export const WEBHOOK_SECRET = 'whsec_endpoint_for_tests';
export const NEXT_WEBHOOK_SECRET = 'whsec_rolled_endpoint_test';

const seconds = (ms) => Math.floor(ms / 1000);

/** Stripe's signature header for `rawBody` at `timestampMs` under each secret. */
export function stripeSignature(rawBody, secrets, timestampMs) {
  const t = String(seconds(timestampMs));
  return [`t=${t}`, ...secrets.map((secret) => `v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`)].join(',');
}

/**
 * @param {object} options
 * @param {'test'|'live'} [options.mode]
 * @param {Function} options.nowMs () => epoch ms
 * @param {number} [options.pageSize] list page size, to exercise pagination
 */
export function createStripeFake({ mode = 'test', nowMs, pageSize = 100 } = {}) {
  const livemode = mode === 'live';
  const sessions = new Map();
  const intents = new Map();
  const charges = new Map();
  const refunds = [];
  const disputes = [];
  const idempotent = new Map();
  const requests = [];
  const failures = [];
  let sequence = 0;
  const id = (prefix) => `${prefix}${String(++sequence).padStart(6, '0')}`;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const error = (status, type, message) => json(status, { error: { type, message } });
  const list = (items, query) => {
    const after = query.get('starting_after');
    const start = after ? items.findIndex((item) => item.id === after) + 1 : 0;
    const limit = Math.min(Number(query.get('limit') || 10), pageSize);
    const data = items.slice(start, start + limit);
    return { object: 'list', data, has_more: start + limit < items.length, url: '/v1/list' };
  };
  const intentView = (intent, expandCharge) => ({ ...intent, latest_charge: expandCharge && intent.latest_charge ? { ...charges.get(intent.latest_charge) } : intent.latest_charge });
  const sessionView = (session, expand) => {
    const intent = session.payment_intent ? intents.get(session.payment_intent) : null;
    if (!expand.some((path) => path.startsWith('payment_intent'))) return { ...session };
    return { ...session, payment_intent: intent ? intentView(intent, expand.includes('payment_intent.latest_charge')) : null };
  };
  const session = (sessionId) => {
    const found = sessions.get(sessionId);
    if (!found) throw new Error(`fake Stripe has no session ${sessionId}`);
    return found;
  };

  const handle = (method, path, query, form) => {
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const created = {
        id: `cs_${mode}_${id('fake')}`, object: 'checkout.session', livemode, mode: form.get('mode'), status: 'open', payment_status: 'unpaid',
        amount_total: Number(form.get('line_items[0][price_data][unit_amount]')), currency: form.get('line_items[0][price_data][currency]'),
        client_reference_id: form.get('client_reference_id'), url: null, expires_at: seconds(nowMs()) + 24 * 3600, payment_intent: null,
        metadata: Object.fromEntries([...form.entries()].filter(([key]) => key.startsWith('metadata[')).map(([key, value]) => [key.slice(9, -1), value]))
      };
      created.url = `https://checkout.stripe.com/c/pay/${created.id}`;
      sessions.set(created.id, created);
      return json(200, { ...created });
    }
    const sessionMatch = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/);
    if (method === 'GET' && sessionMatch) {
      const found = sessions.get(decodeURIComponent(sessionMatch[1]));
      return found ? json(200, sessionView(found, query.getAll('expand[0]'))) : error(404, 'invalid_request_error', 'No such checkout.session');
    }
    if (method === 'GET' && path === '/v1/checkout/sessions') {
      return json(200, list([...sessions.values()].filter((item) => item.payment_intent === query.get('payment_intent')), query));
    }
    if (method === 'GET' && path === '/v1/refunds') return json(200, list(refunds.filter((item) => item.payment_intent === query.get('payment_intent')), query));
    if (method === 'GET' && path === '/v1/disputes') {
      // Stripe matches the filter through the disputed charge's payment intent.
      return json(200, list(disputes.filter((item) => charges.get(item.charge)?.payment_intent === query.get('payment_intent')), query));
    }
    const chargeMatch = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (method === 'GET' && chargeMatch && charges.has(chargeMatch[1])) return json(200, { ...charges.get(chargeMatch[1]) });
    const expireMatch = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (method === 'POST' && expireMatch) {
      const found = session(expireMatch[1]);
      found.status = 'expired';
      return json(200, { ...found });
    }
    return error(404, 'invalid_request_error', `Unrecognized request URL (${method}: ${path})`);
  };

  const fake = {
    requests,
    sessions,
    /**
     * The next `count` requests fail with `status` (a network error for 0). With
     * `afterEffect`, Stripe acts on the request and only its response is lost.
     */
    failNext(count = 1, status = 500, { afterEffect = false } = {}) {
      for (let index = 0; index < count; index += 1) failures.push({ status, afterEffect });
    },
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      const method = init.method ?? 'GET';
      const form = new URLSearchParams(init.body ?? '');
      requests.push({ method, url: String(url), path: parsed.pathname, query: parsed.searchParams, headers: { ...init.headers }, form: [...form.entries()] });
      const failure = failures.shift() ?? null;
      const failed = () => {
        if (failure.status === 0) throw new TypeError('fetch failed');
        return error(failure.status, 'api_error', 'simulated failure');
      };
      if (failure && !failure.afterEffect) return failed();
      if (init.headers?.Authorization !== `Bearer ${mode === 'live' ? LIVE_SECRET_KEY : TEST_SECRET_KEY}`) return error(401, 'invalid_request_error', 'Invalid API Key');
      const key = init.headers?.['Idempotency-Key'];
      let response;
      if (key) {
        const prior = idempotent.get(key);
        if (prior && prior.body !== (init.body ?? '')) return error(400, 'idempotency_error', 'Keys for idempotent requests can only be used with the same parameters');
        if (prior) return json(200, JSON.parse(prior.response));
        response = handle(method, parsed.pathname, parsed.searchParams, form);
        idempotent.set(key, { body: init.body ?? '', response: await response.clone().text() });
      } else {
        response = handle(method, parsed.pathname, parsed.searchParams, form);
      }
      return failure ? failed() : response;
    },

    /** The payer completes Checkout; `processing` models a delayed payment method. */
    complete(sessionId, { amountReceived, processing = false } = {}) {
      const found = session(sessionId);
      const intent = {
        id: id('pi_fake'), object: 'payment_intent', livemode, amount: found.amount_total, currency: found.currency,
        amount_received: processing ? 0 : (amountReceived ?? found.amount_total), status: processing ? 'processing' : 'succeeded', latest_charge: null,
        created: seconds(nowMs())
      };
      const charge = {
        id: id('ch_fake'), object: 'charge', livemode, payment_intent: intent.id, amount: found.amount_total, currency: found.currency,
        status: processing ? 'pending' : 'succeeded', created: seconds(nowMs())
      };
      intent.latest_charge = charge.id;
      intents.set(intent.id, intent);
      charges.set(charge.id, charge);
      Object.assign(found, { status: 'complete', payment_status: processing ? 'unpaid' : 'paid', payment_intent: intent.id });
      return { session: { ...found }, intent: { ...intent }, charge: { ...charge } };
    },
    settleDelayed(sessionId, { succeeded }) {
      const found = session(sessionId);
      const intent = intents.get(found.payment_intent);
      const charge = charges.get(intent.latest_charge);
      Object.assign(intent, succeeded ? { status: 'succeeded', amount_received: intent.amount } : { status: 'requires_payment_method' });
      charge.status = succeeded ? 'succeeded' : 'failed';
      found.payment_status = succeeded ? 'paid' : 'unpaid';
      return { session: { ...found }, intent: { ...intent } };
    },
    expire(sessionId) {
      session(sessionId).status = 'expired';
      return { ...session(sessionId) };
    },
    refund(sessionId, { amount, status = 'succeeded' } = {}) {
      const intent = intents.get(session(sessionId).payment_intent);
      const created = { id: id('re_fake'), object: 'refund', amount: amount ?? intent.amount_received, currency: intent.currency, payment_intent: intent.id, charge: intent.latest_charge, status, created: seconds(nowMs()) };
      refunds.push(created);
      return { ...created };
    },
    dispute(sessionId, { amount, status = 'needs_response', linkIntent = true } = {}) {
      const intent = intents.get(session(sessionId).payment_intent);
      const created = { id: id('dp_fake'), object: 'dispute', livemode, amount: amount ?? intent.amount_received, currency: intent.currency, payment_intent: linkIntent ? intent.id : null, charge: intent.latest_charge, status, created: seconds(nowMs()) };
      disputes.push(created);
      return { ...created };
    },
    update(object, change) {
      const target = [...refunds, ...disputes].find((item) => item.id === object.id);
      Object.assign(target, change);
      return { ...target };
    },
    charge: (chargeId) => ({ ...charges.get(chargeId) }),

    /** A webhook delivery of `type` about `object`, as Stripe signs it; `eventId` repeats a delivery. */
    event(type, object, { eventId = id('evt_fake'), secrets = [WEBHOOK_SECRET], signedAtMs = nowMs(), eventLivemode = livemode } = {}) {
      const rawBody = JSON.stringify({ id: eventId, object: 'event', api_version: '2025-03-31.basil', created: seconds(nowMs()), livemode: eventLivemode, type, data: { object }, pending_webhooks: 1 });
      return { eventId, headers: { 'stripe-signature': stripeSignature(rawBody, secrets, signedAtMs), 'content-type': 'application/json' }, rawBody };
    }
  };
  return fake;
}

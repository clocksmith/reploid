/**
 * @fileoverview Minimal Stripe REST client and webhook signature check.
 *
 * Requests are form-encoded under a pinned API version with the configured
 * secret key; the key never appears in errors or results. Network failures,
 * timeouts, rate limits and server errors are `processor_unavailable`
 * (retryable); other refusals are `processor_request_refused` with Stripe's
 * error type and code only.
 *
 * Webhook signatures follow Stripe's documented scheme: the
 * `Stripe-Signature` header carries `t=<unix seconds>` and one or more
 * `v1=<hex HMAC-SHA256>` over `${t}.${rawBody}` under an endpoint secret.
 * During a secret roll Stripe signs with both secrets, so any configured
 * secret matching any `v1` value verifies. The timestamp must fall within the
 * tolerance either side of now.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { fail } from '../payments/domain.js';

export const STRIPE_API_BASE = 'https://api.stripe.com';
/** Pinned so response shapes do not follow the account's default version. */
export const STRIPE_API_VERSION = '2025-03-31.basil';
const MAX_LIST_PAGES = 20;

/** Stripe's bracketed form encoding: nested objects as a[b][c], arrays as a[0][b]. */
export function encodeForm(params, prefix = '', pairs = []) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => (item && typeof item === 'object'
        ? encodeForm(item, `${name}[${index}]`, pairs)
        : pairs.push([`${name}[${index}]`, String(item)])));
    } else if (typeof value === 'object') {
      encodeForm(value, name, pairs);
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs;
}

const formBody = (params) => new URLSearchParams(encodeForm(params)).toString();

/**
 * @param {object} options
 * @param {string} options.secretKey secret or restricted key
 * @param {string} [options.apiVersion]
 * @param {Function} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.baseUrl]
 */
export function createStripeApi({ secretKey, apiVersion = STRIPE_API_VERSION, fetch = globalThis.fetch, timeoutMs = 15_000, baseUrl = STRIPE_API_BASE } = {}) {
  if (typeof secretKey !== 'string' || !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) throw new TypeError('a Stripe secret or restricted key is required');
  if (typeof fetch !== 'function') throw new TypeError('the Stripe client needs fetch');
  const authorization = `Bearer ${secretKey}`;

  const send = async (method, path, { query = null, body = null, idempotencyKey = null } = {}) => {
    const url = `${baseUrl}${path}${query ? `?${formBody(query)}` : ''}`;
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: authorization,
          'Stripe-Version': apiVersion,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        },
        body: body ? formBody(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      fail('processor_unavailable', 'Stripe could not be reached', { reason: error?.name ?? 'network_error' });
    }
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (response.ok && json && typeof json === 'object') return json;
    const details = { status: response.status, type: json?.error?.type ?? null, stripeCode: json?.error?.code ?? null };
    // An unreadable success, a rate limit or a server error may succeed on retry.
    if (response.ok || response.status === 429 || response.status >= 500) fail('processor_unavailable', 'Stripe is unavailable; retry later', details);
    fail('processor_request_refused', `Stripe refused the request (${details.type ?? response.status})`, details);
  };

  return Object.freeze({
    get: (path, query) => send('GET', path, { query }),
    post: (path, body, { idempotencyKey } = {}) => send('POST', path, { body, idempotencyKey }),
    /** Every item of a list endpoint, following `has_more` up to a bound. */
    async list(path, query = {}) {
      const items = [];
      let startingAfter = null;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await send('GET', path, { query: { ...query, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) } });
        if (result.object !== 'list' || !Array.isArray(result.data)) fail('invalid_processor_response', `Stripe ${path} did not return a list`);
        items.push(...result.data);
        if (!result.has_more || result.data.length === 0) return items;
        startingAfter = result.data.at(-1).id;
      }
      fail('invalid_processor_response', `Stripe ${path} returned more than ${MAX_LIST_PAGES} pages`);
      return items;
    }
  });
}

/**
 * Verify a Stripe-Signature header over the exact raw body; throws when it
 * is missing, malformed, signed by no configured secret or outside tolerance.
 */
export function verifyStripeSignature({ header, rawBody, secrets, toleranceMs, nowMs }) {
  if (typeof header !== 'string' || header.length > 4096) throw new Error('missing Stripe-Signature header');
  if (!(typeof rawBody === 'string' || Buffer.isBuffer(rawBody))) throw new Error('the raw request body is required');
  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    const [key, value] = separator > 0 ? [part.slice(0, separator).trim(), part.slice(separator + 1).trim()] : [part.trim(), ''];
    if (key === 't') {
      if (timestamp !== null || !/^\d{1,12}$/.test(value)) throw new Error('malformed Stripe-Signature timestamp');
      timestamp = value;
    } else if (key === 'v1' && /^[a-f0-9]{64}$/.test(value)) {
      signatures.push(Buffer.from(value, 'hex'));
    }
  }
  if (timestamp === null || signatures.length === 0) throw new Error('Stripe-Signature carries no timestamp or v1 signature');
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const matched = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest();
    return signatures.some((signature) => timingSafeEqual(expected, signature));
  });
  if (!matched) throw new Error('no Stripe-Signature matches a configured webhook secret');
  if (Math.abs(nowMs - Number(timestamp) * 1000) > toleranceMs) throw new Error('Stripe-Signature timestamp is outside the tolerance');
}

export default createStripeApi;

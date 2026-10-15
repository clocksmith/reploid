/**
 * @fileoverview Provider configuration from the environment or a secret store
 * mounted as environment variables. Nothing here has a key; the repository
 * ships none.
 *
 * Supabase sign-in (absent unless REPLOID_SUPABASE_URL is set):
 *   REPLOID_SUPABASE_URL                     project API origin, https://<ref>.supabase.co
 *   REPLOID_SUPABASE_PUBLISHABLE_KEY         public anon or publishable key, served to the browser flow
 *   REPLOID_SUPABASE_SIGN_IN_STATE_SECRET    state MAC secrets, comma-separated, current first, each >= 32 bytes
 *   REPLOID_SUPABASE_JWKS_URL                optional; defaults to <url>/auth/v1/.well-known/jwks.json
 *   REPLOID_SUPABASE_JWT_ISSUER              optional; defaults to <url>/auth/v1
 *   REPLOID_SUPABASE_JWT_AUDIENCE            optional; defaults to authenticated
 *   REPLOID_SUPABASE_JWT_ALGORITHMS          optional; subset of ES256,RS256,EdDSA; defaults to ES256,RS256
 *   REPLOID_SUPABASE_SIGN_IN_STATE_TTL_SECONDS optional; 30 to 3600, defaults to 300
 *
 * Stripe Checkout (absent unless a Stripe key is set). Test mode is the
 * default; live mode needs REPLOID_STRIPE_MODE=live and its own variables, and
 * neither mode accepts the other's keys:
 *   REPLOID_STRIPE_MODE                      test (default) or live
 *   REPLOID_STRIPE_SECRET_KEY                test mode: sk_test_ or rk_test_ key
 *   REPLOID_STRIPE_WEBHOOK_SECRET            test mode: whsec_ secrets, comma-separated, current first
 *   REPLOID_STRIPE_LIVE_SECRET_KEY           live mode: sk_live_ or rk_live_ key
 *   REPLOID_STRIPE_LIVE_WEBHOOK_SECRET       live mode: whsec_ secrets, comma-separated, current first
 *   REPLOID_STRIPE_SUCCESS_URL               page Checkout returns to after payment
 *   REPLOID_STRIPE_CANCEL_URL                page Checkout returns to when abandoned
 *   REPLOID_STRIPE_WEBHOOK_TOLERANCE_SECONDS optional; 1 to 3600, defaults to 300 (Stripe's default)
 *   REPLOID_STRIPE_PRODUCT_NAME              optional; the line item name the payer sees
 *   REPLOID_STRIPE_API_VERSION               optional; defaults to the pinned version
 */

import { createStripePaymentProcessor, STRIPE_MODES } from './stripe-processor.js';
import { createSupabaseSignInProvider, DEFAULT_ALGORITHMS, SUPPORTED_ALGORITHMS } from './supabase-sign-in.js';

export class ProviderConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderConfigError';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new ProviderConfigError(code, message);
};

const read = (env, name) => (typeof env[name] === 'string' && env[name].trim() ? env[name].trim() : null);
const list = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
const seconds = (env, name, fallback, min, max) => {
  const value = read(env, name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) refuse('invalid_setting', `${name} must be an integer from ${min} to ${max}`);
  return Number(value);
};
const required = (env, name, code = 'setting_required') => read(env, name) ?? refuse(code, `${name} is required`);

/** Supabase sign-in settings, or null when REPLOID_SUPABASE_URL is unset. */
export function readSupabaseSignInConfig(env = {}) {
  const projectUrl = read(env, 'REPLOID_SUPABASE_URL');
  if (projectUrl === null) return null;
  const stateSecrets = list(required(env, 'REPLOID_SUPABASE_SIGN_IN_STATE_SECRET'));
  if (stateSecrets.some((secret) => Buffer.byteLength(secret) < 32)) refuse('invalid_setting', 'each REPLOID_SUPABASE_SIGN_IN_STATE_SECRET value needs at least 32 bytes');
  const algorithms = read(env, 'REPLOID_SUPABASE_JWT_ALGORITHMS');
  const allowlist = algorithms === null ? [...DEFAULT_ALGORITHMS] : list(algorithms);
  if (allowlist.length === 0 || allowlist.some((alg) => !SUPPORTED_ALGORITHMS.includes(alg))) {
    refuse('invalid_setting', `REPLOID_SUPABASE_JWT_ALGORITHMS must list only ${SUPPORTED_ALGORITHMS.join(', ')}`);
  }
  return {
    projectUrl,
    publishableKey: required(env, 'REPLOID_SUPABASE_PUBLISHABLE_KEY'),
    stateSecrets,
    stateTtlMs: seconds(env, 'REPLOID_SUPABASE_SIGN_IN_STATE_TTL_SECONDS', 300, 30, 3600) * 1000,
    algorithms: allowlist,
    ...(read(env, 'REPLOID_SUPABASE_JWKS_URL') ? { jwksUrl: read(env, 'REPLOID_SUPABASE_JWKS_URL') } : {}),
    ...(read(env, 'REPLOID_SUPABASE_JWT_ISSUER') ? { issuer: read(env, 'REPLOID_SUPABASE_JWT_ISSUER') } : {}),
    ...(read(env, 'REPLOID_SUPABASE_JWT_AUDIENCE') ? { jwtAudience: read(env, 'REPLOID_SUPABASE_JWT_AUDIENCE') } : {})
  };
}

/**
 * The Supabase sign-in provider for an account policy, or null when not
 * configured. The policy supplies the audience and tolerated clock skew.
 */
export function createSupabaseSignInFromEnv(env = {}, { accountPolicy, fetch, clock } = {}) {
  const settings = readSupabaseSignInConfig(env);
  if (!settings) return null;
  if (!accountPolicy?.audience || !Number.isSafeInteger(accountPolicy.maxClockSkewMs)) throw new TypeError('the Supabase provider needs the account policy');
  try {
    return createSupabaseSignInProvider({
      ...settings, accountAudience: accountPolicy.audience, clockSkewMs: accountPolicy.maxClockSkewMs,
      ...(fetch ? { fetch } : {}), ...(clock ? { clock } : {})
    });
  } catch (error) {
    refuse('invalid_setting', `Supabase sign-in configuration: ${error.message}`);
  }
  return null;
}

/** Stripe settings, or null when no Stripe key is set. */
export function readStripeConfig(env = {}) {
  const modeSetting = read(env, 'REPLOID_STRIPE_MODE');
  const testKey = read(env, 'REPLOID_STRIPE_SECRET_KEY');
  const liveKey = read(env, 'REPLOID_STRIPE_LIVE_SECRET_KEY');
  if (modeSetting === null && testKey === null && liveKey === null) return null;
  const mode = modeSetting ?? 'test';
  if (!STRIPE_MODES.includes(mode)) refuse('invalid_setting', 'REPLOID_STRIPE_MODE must be test or live');
  // A live key never sits in the test variable, and live mode is never implied by a key alone.
  if (testKey !== null && !/^(sk|rk)_test_/.test(testKey)) refuse('stripe_mode_mismatch', 'REPLOID_STRIPE_SECRET_KEY must be a test-mode key');
  if (liveKey !== null && !/^(sk|rk)_live_/.test(liveKey)) refuse('stripe_mode_mismatch', 'REPLOID_STRIPE_LIVE_SECRET_KEY must be a live-mode key');
  if (mode === 'test' && liveKey !== null) refuse('stripe_mode_mismatch', 'live keys are set without REPLOID_STRIPE_MODE=live');
  const [keyName, secretName] = mode === 'live'
    ? ['REPLOID_STRIPE_LIVE_SECRET_KEY', 'REPLOID_STRIPE_LIVE_WEBHOOK_SECRET']
    : ['REPLOID_STRIPE_SECRET_KEY', 'REPLOID_STRIPE_WEBHOOK_SECRET'];
  return {
    mode,
    secretKey: required(env, keyName),
    webhookSecrets: list(required(env, secretName)),
    toleranceMs: seconds(env, 'REPLOID_STRIPE_WEBHOOK_TOLERANCE_SECONDS', 300, 1, 3600) * 1000,
    successUrl: required(env, 'REPLOID_STRIPE_SUCCESS_URL'),
    cancelUrl: required(env, 'REPLOID_STRIPE_CANCEL_URL'),
    ...(read(env, 'REPLOID_STRIPE_PRODUCT_NAME') ? { productName: read(env, 'REPLOID_STRIPE_PRODUCT_NAME') } : {}),
    ...(read(env, 'REPLOID_STRIPE_API_VERSION') ? { apiVersion: read(env, 'REPLOID_STRIPE_API_VERSION') } : {})
  };
}

/** The Stripe processor (`stripe-test` or `stripe-live`), or null when not configured. */
export function createStripeProcessorFromEnv(env = {}, { fetch, clock } = {}) {
  const settings = readStripeConfig(env);
  if (!settings) return null;
  try {
    return createStripePaymentProcessor({ ...settings, ...(fetch ? { fetch } : {}), ...(clock ? { clock } : {}) });
  } catch (error) {
    refuse('invalid_setting', `Stripe configuration: ${error.message}`);
  }
  return null;
}

export default { readSupabaseSignInConfig, createSupabaseSignInFromEnv, readStripeConfig, createStripeProcessorFromEnv };

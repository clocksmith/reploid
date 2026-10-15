// @vitest-environment node
// Live checks against the owner's Stripe test mode and Supabase project. Each block is skipped
// unless its test-mode credentials are in the environment (never in the repository), so ordinary
// runs make no network call. The Stripe check creates one Checkout Session and expires it; it
// moves no money.
import { describe, expect, it } from 'vitest';

import { createStripeApi } from '../../server/providers/stripe-api.js';
import { createStripePaymentProcessor } from '../../server/providers/stripe-processor.js';
import { DEFAULT_ALGORITHMS, createSupabaseSignInProvider } from '../../server/providers/supabase-sign-in.js';

const env = process.env;
const stripeTestKey = /^(sk|rk)_test_/.test(env.REPLOID_STRIPE_SECRET_KEY ?? '') ? env.REPLOID_STRIPE_SECRET_KEY : null;
const supabaseUrl = env.REPLOID_SUPABASE_URL ?? null;

describe.skipIf(!stripeTestKey)('Stripe test mode (live)', () => {
  it('creates, reads and expires a one-time Checkout Session at the requested price', async () => {
    const processor = createStripePaymentProcessor({
      mode: 'test', secretKey: stripeTestKey,
      webhookSecrets: (env.REPLOID_STRIPE_WEBHOOK_SECRET || 'whsec_unused_by_smoke_check').split(',').map((secret) => secret.trim()),
      toleranceMs: 300_000,
      successUrl: env.REPLOID_STRIPE_SUCCESS_URL || 'https://example.com/top-up/done',
      cancelUrl: env.REPLOID_STRIPE_CANCEL_URL || 'https://example.com/top-up'
    });
    const checkoutId = `chk_smoke_${Date.now()}`;
    const created = await processor.createCheckout({
      checkoutId, accountId: 'acct_smoke', credits: 1, amount: { amountMinor: 100, currency: 'USD' }, idempotencyKey: checkoutId,
      topUpId: 'smoke', paymentPolicyVersion: 'smoke/1', conversion: null
    });
    expect(created).toMatchObject({ purchaseId: expect.stringMatching(/^cs_test_/), checkout: { kind: 'stripe_checkout', livemode: false, url: expect.stringMatching(/^https:\/\//) } });
    expect(await processor.fetchPayment(created.purchaseId)).toMatchObject({ status: 'open', amount: { amountMinor: 100, currency: 'USD' }, reversals: [] });
    await createStripeApi({ secretKey: stripeTestKey }).post(`/v1/checkout/sessions/${created.purchaseId}/expire`, {});
    expect(await processor.fetchPayment(created.purchaseId)).toMatchObject({ status: 'expired' });
  }, 30_000);
});

describe.skipIf(!supabaseUrl)('Supabase project (live)', () => {
  const allowed = (env.REPLOID_SUPABASE_JWT_ALGORITHMS || DEFAULT_ALGORITHMS.join(',')).split(',').map((alg) => alg.trim());

  it('publishes an asymmetric signing key under an allowlisted algorithm', async () => {
    const response = await fetch(env.REPLOID_SUPABASE_JWKS_URL || `${new URL(supabaseUrl).origin}/auth/v1/.well-known/jwks.json`);
    expect(response.status).toBe(200);
    const { keys } = await response.json();
    expect(keys.some((key) => typeof key.kid === 'string' && allowed.includes(key.alg))).toBe(true);
  }, 30_000);

  it.skipIf(!env.REPLOID_SUPABASE_SMOKE_ACCESS_TOKEN)('verifies a magic-link access token and reads its user id, not its email', async () => {
    const provider = createSupabaseSignInProvider({
      projectUrl: supabaseUrl, publishableKey: env.REPLOID_SUPABASE_PUBLISHABLE_KEY || 'unused-by-smoke-check', accountAudience: 'smoke',
      stateSecrets: ['unused-by-smoke-check-0123456789abcdef'], stateTtlMs: 300_000, clockSkewMs: 30_000, algorithms: allowed,
      ...(env.REPLOID_SUPABASE_JWKS_URL ? { jwksUrl: env.REPLOID_SUPABASE_JWKS_URL } : {}),
      ...(env.REPLOID_SUPABASE_JWT_ISSUER ? { issuer: env.REPLOID_SUPABASE_JWT_ISSUER } : {})
    });
    const verified = await provider.verifyAccessToken(env.REPLOID_SUPABASE_SMOKE_ACCESS_TOKEN);
    expect(verified.subject).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(verified)).not.toContain('@');
  }, 30_000);
});

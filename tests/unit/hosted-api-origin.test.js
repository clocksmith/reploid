import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import hostedApi from '../../shared/config/hosted-api.json';
import swarmBootstrap from '../../shared/config/swarm-bootstrap.json';
import { DEFAULT_ALLOWED_ORIGINS as ZERO_GEMINI_ALLOWED_ORIGINS } from '../../packages/functions/zero-gemini-policy.js';
import { HOSTED_API_ORIGIN, hostedApiUrl } from '../../shared/config/hosted-api.js';
import { attributionCall, checkApiOrigin } from '../../scripts/cloudflare/set-api-origin.js';

describe('one hosted API origin', () => {
  it('is what the page, the SDK and the inline landing call use', () => {
    expect(checkApiOrigin()).toBe(hostedApi.apiOrigin);
    expect(hostedApiUrl('/pool')).toBe(`${HOSTED_API_ORIGIN}/pool`);
    for (const file of ['shared/pool/sdk.js', 'shared/infrastructure/scoped-model-provider.js', 'self/config/zero-inference.js', 'apps/poolday/host/product-session.js']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/hosted-api\.js/);
    }
  });

  it('switches the inline landing call to a cross-origin request for the Worker', () => {
    const page = readFileSync('apps/poolday/index.html', 'utf8');
    const switched = page.replace(attributionCall(''), attributionCall(hostedApi.cloudflareApiOrigin));
    expect(switched).not.toBe(page);
    expect(() => checkApiOrigin({ config: { ...hostedApi, apiOrigin: hostedApi.cloudflareApiOrigin }, page: switched })).not.toThrow();
    expect(() => checkApiOrigin({ config: { ...hostedApi, apiOrigin: hostedApi.cloudflareApiOrigin }, page })).toThrow(/does not use apiOrigin/);
    expect(switched).toContain("mode: 'cors'");
  });

  it('allows only exact hosted origins for CORS and keeps discovery and Zero aligned', () => {
    expect(hostedApi.allowedOrigins).toContain('https://replo.id');
    for (const origin of hostedApi.allowedOrigins) expect(new URL(origin).origin).toBe(origin);
    expect(swarmBootstrap.allowedOrigins).toEqual(hostedApi.allowedOrigins);
    expect(swarmBootstrap.allowLoopbackOrigins).toBe(hostedApi.allowLoopbackOrigins);
    expect([...ZERO_GEMINI_ALLOWED_ORIGINS]).toEqual(hostedApi.allowedOrigins);
  });
});

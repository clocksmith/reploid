import { beforeEach, describe, expect, it } from 'vitest';

import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import { LAUNCH_MODEL } from '../../server/pool/model-contract.js';

const dispatchJson = async (router, path, { method = 'GET', body = null, headers = {} } = {}) => {
  const url = new URL(path, 'http://reploid.test');
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: `${url.pathname}${url.search}`,
      originalUrl: `${url.pathname}${url.search}`,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body,
      ip: '127.0.0.1'
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[name.toLowerCase()];
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload || null });
        return this;
      }
    };
    router.handle(req, res, (error) => {
      if (error) reject(error);
      else resolve({ status: 404, body: {} });
    });
  });
};

describe('pool coordinator routes', () => {
  let store;
  let router;

  beforeEach(() => {
    store = createPoolStore();
    store.kind = 'firestore';
    router = createPoolRouter({ store });
  });

  it('keeps safe discovery routes public when persistent storage requires auth', async () => {
    const status = await dispatchJson(router, '/status');
    expect(status.status).toBe(200);
    expect(status.body.product).toBe('reploid_browser_inference_pool');

    const policies = await dispatchJson(router, '/policies');
    expect(policies.status).toBe(200);
    expect(policies.body.policies.map((policy) => policy.policyId)).toContain('fastest_receipt');
    const ringPolicy = policies.body.policies.find((policy) => policy.policyId === 'ring_quorum_receipt');
    expect(ringPolicy.adaptiveRing).toBe(true);
    expect(ringPolicy.maxRingSize).toBe(4);

    const jobs = await dispatchJson(router, '/jobs', {
      method: 'POST',
      body: {}
    });
    expect(jobs.status).toBe(401);
    expect(jobs.body.error).toBe('Firebase auth token required');
  });

  it('rejects providers that do not advertise the exact launch model identity', async () => {
    store.kind = 'memory';
    const response = await dispatchJson(router, '/providers/register', {
      method: 'POST',
      body: {
        providerId: 'provider_local',
        publicKey: 'public-key',
        models: [{
          modelId: LAUNCH_MODEL.modelId,
          modelHash: 'sha256:wrong',
          manifestHash: LAUNCH_MODEL.manifestHash,
          runtime: LAUNCH_MODEL.runtime,
          backend: LAUNCH_MODEL.backend
        }]
      }
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('provider must advertise the exact launch model identity');
  });
});

import express from 'express';
import nodeFetch from 'node-fetch';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPublicInferenceConfig,
  createPublicInferenceGuard,
  createPublicInferenceMiddleware
} from '../../server/public-inference-guard.js';

const servers = [];

const policyConfig = () => createPublicInferenceConfig({
  REPLOID_PUBLIC_INFERENCE_ENABLED: 'true',
  REPLOID_PUBLIC_INFERENCE_MODEL_POLICIES: JSON.stringify({
    gemini: {
      'gemini-safe': {
        maxInputTokens: 100,
        maxOutputTokens: 20,
        maxEstimatedCostUsd: 0.01,
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
        maxDailyCostUsd: 0.02
      }
    }
  })
});

const createServer = async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/chat', createPublicInferenceMiddleware({
    guard: createPublicInferenceGuard({ config: policyConfig() })
  }), (req, res) => {
    res.json({
      provider: req.publicInferenceAdmission.policy.provider,
      model: req.publicInferenceAdmission.policy.model,
      maxOutputTokens: req.publicInferenceAdmission.outputTokens
    });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('anonymous chat route admission', () => {
  it('forwards only an allowlisted model with the admitted output cap', async () => {
    const baseUrl = await createServer();
    const response = await nodeFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'gemini',
        model: 'gemini-safe',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 20
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: 'gemini',
      model: 'gemini-safe',
      maxOutputTokens: 20
    });
  });

  it('rejects an unallowlisted model before the provider handler runs', async () => {
    const baseUrl = await createServer();
    const response = await nodeFetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        model: 'arbitrary-model',
        messages: [{ role: 'user', content: 'hello' }]
      })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Provider or model is not available for anonymous inference'
    });
  });
});

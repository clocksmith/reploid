import { describe, expect, it } from 'vitest';

import { buildReploidCloudModelConfig } from '../../src/self/cloud-access.js';
import { ensureIdentityBundle, buildIdentityDocument } from '../../src/self/identity.js';
import { sealString, unsealString } from '../../src/self/key-unsealer.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } from '../../src/self/receipt.js';
import { applyReceiptToContribution, createContributionSummary } from '../../src/self/reward-policy.js';
import { deriveSwarmRole } from '../../src/self/swarm.js';

const createMemoryStorage = () => {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    }
  };
};

describe('Self Collaboration Modules', () => {
  it('derives swarm roles from inference and sharing state', () => {
    expect(deriveSwarmRole({ hasInference: true, swarmEnabled: false })).toBe('solo');
    expect(deriveSwarmRole({ hasInference: true, swarmEnabled: true })).toBe('provider');
    expect(deriveSwarmRole({ hasInference: false, swarmEnabled: true })).toBe('consumer');
    expect(deriveSwarmRole({ hasInference: false, swarmEnabled: false })).toBe('dead');
  });

  it('seals and unseals access-code protected strings', async () => {
    const blob = await sealString({
      accessCode: 'day-code-2026-03-27',
      plaintext: 'secret-gemini-key'
    });

    const value = await unsealString({
      blob,
      accessCode: 'day-code-2026-03-27'
    });

    expect(value).toBe('secret-gemini-key');
  });

  it('builds browser-cloud model configs from provisioned access windows', async () => {
    const blob = await sealString({
      accessCode: 'day-code-2026-03-27',
      plaintext: JSON.stringify({
        apiKey: 'secret-gemini-key',
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite-preview'
      })
    });

    const previous = globalThis.window?.__REPLOID_CLOUD_ACCESS__;
    globalThis.window = globalThis.window || {};
    globalThis.window.__REPLOID_CLOUD_ACCESS__ = {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite-preview',
      windows: [
        {
          label: '2026-03-27',
          blob
        }
      ]
    };

    try {
      const config = await buildReploidCloudModelConfig({
        accessCode: 'day-code-2026-03-27',
        date: new Date('2026-03-27T12:00:00Z')
      });

      expect(config.provider).toBe('gemini');
      expect(config.id).toBe('gemini-3.1-flash-lite-preview');
      expect(config.keySource).toBe('access-code');
      await expect(config.getApiKey()).resolves.toBe('secret-gemini-key');
    } finally {
      if (previous === undefined) {
        delete globalThis.window.__REPLOID_CLOUD_ACCESS__;
      } else {
        globalThis.window.__REPLOID_CLOUD_ACCESS__ = previous;
      }
    }
  });

  it('builds identity documents, signs receipts, and applies reward scoring', async () => {
    const providerBundle = await ensureIdentityBundle({ storage: createMemoryStorage() });
    const consumerBundle = await ensureIdentityBundle({ storage: createMemoryStorage() });

    const providerIdentity = buildIdentityDocument(providerBundle, {
      swarmEnabled: true,
      hasInference: true
    });
    expect(providerIdentity.role).toBe('provider');

    const draft = await createReceiptDraft({
      provider: providerBundle.peerId,
      consumer: consumerBundle.peerId,
      jobHash: 'sha256:test-job',
      model: 'gemini-3.1-flash-lite-preview',
      inputTokens: 1600,
      outputTokens: 800
    });

    const signed = await signReceiptDraft(draft, providerBundle);
    const receipt = await countersignReceipt(signed, consumerBundle);
    const verification = await verifyReceipt(receipt);

    expect(verification.valid).toBe(true);

    const updatedContribution = applyReceiptToContribution(
      createContributionSummary(),
      receipt,
      []
    );

    expect(updatedContribution.receiptsServed).toBe(1);
    expect(updatedContribution.providedInputTokens).toBe(1600);
    expect(updatedContribution.providedOutputTokens).toBe(800);
    expect(updatedContribution.score).toBeGreaterThan(0);
    expect(updatedContribution.uniquePeers).toContain(consumerBundle.peerId);
  });
});

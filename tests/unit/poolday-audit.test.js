import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { SELF_BOOT_SPEC } from '../../self/boot-spec.js';
import { PRODUCT_ROUTES } from '../../self/ui/pool-home/constants.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import {
  SIGNATURE_DOMAINS,
  buildPoolReceipt,
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  receiptSigningPayload,
  sha256Hex,
  signProviderReceipt,
  verifyCanonicalSignature
} from '../../self/pool/inference-receipt.js';
import { verifyReceipt } from '../../self/pool/sdk.js';
import {
  DETERMINISTIC_GENERATION_CONFIG,
  validatePolicyRequest
} from '../../self/pool/policy-router.js';
import { validateJobRequest } from '../../server/pool/policy-router.js';
import { createPoolStore } from '../../server/pool/store.js';
import {
  CHALLENGE_AUDIT_KIND,
  applyCanaryReputation
} from '../../server/pool/audits.js';
import {
  PEER_CONTROL_NETWORK,
  createPeerControlPlane,
  createSignedPeerMessage,
  verifyPeerMessage
} from '../../self/pool/peer-control-plane.js';
import { verifyModelArtifactPackage } from '../../self/pool/model-artifacts.js';
import {
  REPUTATION_EVENT_TYPES,
  reduceReputationEvents
} from '../../self/pool/reputation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const launchModelRequirement = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend
});

const assignmentFixture = async () => ({
  assignmentId: 'assignment_audit',
  jobId: 'job_audit',
  requesterId: 'requester_audit',
  providerId: 'provider_audit',
  policyId: 'fastest_receipt',
  inputHash: await sha256Hex('audit prompt'),
  generationConfigHash: await hashJson(DETERMINISTIC_GENERATION_CONFIG),
  generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG },
  model: {
    id: LAUNCH_MODEL.modelId,
    hash: LAUNCH_MODEL.modelHash,
    manifestHash: LAUNCH_MODEL.manifestHash,
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend
  }
});

describe('Poolday audit boundaries', () => {
  it('keeps Poolday, Zero, and X route profiles separate', () => {
    expect(PRODUCT_ROUTES['/']).toBe('home');
    expect(PRODUCT_ROUTES['/ask']).toBe('ask');
    expect(PRODUCT_ROUTES['/compute']).toBe('compute');
    expect(PRODUCT_ROUTES['/records']).toBe('records');
    expect(PRODUCT_ROUTES['/history']).toBe('records');
    expect(PRODUCT_ROUTES['/network']).toBe('records');
    expect(PRODUCT_ROUTES['/run']).toBeUndefined();
    expect(PRODUCT_ROUTES['/mesh']).toBeUndefined();
    expect(PRODUCT_ROUTES['/record']).toBeUndefined();
    expect(PRODUCT_ROUTES['/agents']).toBeUndefined();
    expect(PRODUCT_ROUTES['/contribute']).toBeUndefined();
    expect(PRODUCT_ROUTES['/receipts']).toBeUndefined();
    expect(PRODUCT_ROUTES['/reputation']).toBeUndefined();
    expect(SELF_BOOT_SPEC.routes['/zero']).toMatchObject({
      mode: 'zero',
      genesisLevel: 'spark',
      surface: 'zero',
      productFacing: false
    });
    expect(SELF_BOOT_SPEC.routes['/x']).toMatchObject({
      mode: 'x',
      genesisLevel: 'full',
      surface: 'x',
      productFacing: false
    });
    expect(PRODUCT_ROUTES['/zero']).toBeUndefined();
    expect(PRODUCT_ROUTES['/x']).toBeUndefined();
  });

  it('keeps forbidden trust claims out of public Poolday UI copy', () => {
    const publicFiles = [
      'self/ui/pool-home/constants.js',
      'self/ui/pool-home/view.js',
      'self/ui/pool-home/index.js',
      'self/index.html',
      'README.md'
    ];
    const forbidden = /\b(trustless|hardware-attested|guaranteed honest GPU execution|verified GPU execution|tamper-proof|proof of execution|hardware proof)\b/i;
    const offenders = publicFiles
      .map((file) => ({
        file,
        text: fs.readFileSync(path.join(repoRoot, file), 'utf8')
      }))
      .filter(({ text }) => forbidden.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe('Poolday signatures and receipts', () => {
  it('uses domain-separated provider receipt signatures', async () => {
    const keyPair = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const assignment = await assignmentFixture();
    const receipt = await buildPoolReceipt({
      assignment,
      provider: {
        device: {},
        runtimeProfileHash: 'sha256:runtime_profile'
      },
      model: assignment.model,
      runtime: {
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend
      },
      execution: {
        outputText: 'audit output',
        tokenIds: [1, 2, 3],
        transcript: {
          outputText: 'audit output',
          tokenIds: [1, 2, 3]
        },
        tokenCounts: {
          input: 2,
          output: 3
        }
      }
    });
    const signed = await signProviderReceipt(receipt, keyPair.privateKey);

    expect(signed.signatureDomain).toBe(SIGNATURE_DOMAINS.providerReceipt);
    await expect(verifyCanonicalSignature(
      receiptSigningPayload(signed),
      publicKey,
      signed.providerSignature,
      { domain: SIGNATURE_DOMAINS.providerReceipt }
    )).resolves.toBe(true);
    await expect(verifyCanonicalSignature(
      receiptSigningPayload(signed),
      publicKey,
      signed.providerSignature,
      { domain: SIGNATURE_DOMAINS.requesterAcceptance }
    )).resolves.toBe(false);

    await expect(verifyReceipt(signed, publicKey, {
      outputText: 'audit output',
      tokenIds: [1, 2, 3],
      transcript: {
        outputText: 'audit output',
        tokenIds: [1, 2, 3]
      }
    })).resolves.toMatchObject({ ok: true });

    await expect(verifyReceipt({
      ...signed,
      signatureDomain: SIGNATURE_DOMAINS.requesterAcceptance
    }, publicKey, {
      outputText: 'audit output',
      tokenIds: [1, 2, 3],
      transcript: {
        outputText: 'audit output',
        tokenIds: [1, 2, 3]
      }
    })).resolves.toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['provider receipt signature domain mismatch'])
    });
  });

  it('changes canonical receipt hash when assignment, model, prompt, runtime, or token output changes', async () => {
    const assignment = await assignmentFixture();
    const base = await buildPoolReceipt({
      assignment,
      provider: { device: {}, runtimeProfileHash: 'sha256:runtime_a' },
      model: assignment.model,
      runtime: { runtime: LAUNCH_MODEL.runtime, backend: LAUNCH_MODEL.backend },
      execution: {
        outputText: 'same',
        tokenIds: [1],
        transcript: { outputText: 'same', tokenIds: [1] }
      }
    });
    const variants = [
      { ...base, assignmentId: 'assignment_other' },
      { ...base, model: { ...base.model, hash: 'sha256:other_model' } },
      { ...base, inputHash: 'sha256:other_prompt' },
      { ...base, verification: { ...base.verification, runtimeProfileHash: 'sha256:runtime_b' } },
      { ...base, tokenIdsHash: 'sha256:other_tokens' }
    ];
    const baseHash = await hashJson(base);
    for (const variant of variants) {
      await expect(hashJson(variant)).resolves.not.toBe(baseHash);
    }
  });
});

describe('Poolday policy and peer envelopes', () => {
  it('blocks obvious secrets before public browser-provider assignment', async () => {
    const request = {
      requesterId: 'requester_policy',
      requesterPublicKey: 'public-key',
      prompt: 'api_key: sk-1234567890abcdef',
      modelRequirements: launchModelRequirement(),
      generationConfig: { ...DETERMINISTIC_GENERATION_CONFIG }
    };

    expect(validatePolicyRequest(request)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'prompt policy classes are not allowed for public browser providers: secrets'
      ])
    });
    expect(validateJobRequest(request)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'prompt policy classes are not allowed for public browser providers: secrets'
      ])
    });
  });

  it('rejects cross-network peer-message replay and nonce reuse with different payloads', async () => {
    const keyPair = await createSigningKeyPair();
    const publicKey = await exportPublicKey(keyPair.publicKey);
    const valid = await createSignedPeerMessage({
      type: 'heartbeat',
      fromPeerId: 'peer_audit',
      publicKey,
      privateKey: keyPair.privateKey,
      nonce: 'nonce_audit',
      body: { ok: true }
    });

    expect(valid.network).toBe(PEER_CONTROL_NETWORK);
    await expect(verifyPeerMessage(valid)).resolves.toMatchObject({ ok: true });
    await expect(verifyPeerMessage({ ...valid, network: 'x' })).resolves.toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['peer control network mismatch'])
    });

    const plane = createPeerControlPlane({
      peerId: 'peer_audit',
      publicKey,
      privateKey: keyPair.privateKey
    });
    await expect(plane.ingest(valid)).resolves.toMatchObject({ ok: true });
    await expect(plane.ingest(valid)).resolves.toMatchObject({ ok: true, duplicate: true });
    const reusedNonce = await createSignedPeerMessage({
      type: 'heartbeat',
      fromPeerId: 'peer_audit',
      publicKey,
      privateKey: keyPair.privateKey,
      nonce: 'nonce_audit',
      body: { ok: false }
    });
    await expect(plane.ingest(reusedNonce)).resolves.toMatchObject({
      ok: false,
      reason: 'peer_message_nonce_reuse'
    });
  });
});

describe('Poolday artifacts and reputation', () => {
  it('verifies content-addressed tokenizer and shard hashes', async () => {
    const encoder = new TextEncoder();
    const tokenizerBytes = encoder.encode('{"tokens":["a"]}');
    const shardBytes = encoder.encode('weights');
    const manifest = {
      modelId: 'model-package',
      modelHash: 'sha256:model-package',
      tokenizerHash: await sha256Hex(tokenizerBytes),
      shards: [
        {
          path: 'shard-0.bin',
          hash: await sha256Hex(shardBytes)
        }
      ]
    };
    const manifestText = JSON.stringify(manifest);
    const manifestHash = await hashJson(manifest);
    const fetchImpl = async (url) => {
      const isManifest = url.endsWith('/manifest.json');
      const body = isManifest
        ? encoder.encode(manifestText)
        : (url.endsWith('/tokenizer.json') ? tokenizerBytes : shardBytes);
      return {
        ok: true,
        text: async () => (isManifest ? manifestText : new TextDecoder().decode(body)),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
      };
    };

    await expect(verifyModelArtifactPackage({
      model: {
        modelId: 'model-package',
        modelHash: 'sha256:model-package',
        manifestHash
      },
      baseUrl: 'https://models.example',
      fetchImpl
    })).resolves.toMatchObject({
      ok: true,
      packageIdentity: {
        modelId: 'model-package',
        modelHash: 'sha256:model-package',
        manifestHash,
        tokenizerHash: await sha256Hex(tokenizerBytes),
        shardHashes: [await sha256Hex(shardBytes)]
      }
    });
  });

  it('replays reputation from events idempotently', () => {
    const events = [
      {
        eventId: 'event_1',
        type: REPUTATION_EVENT_TYPES.receiptValidated,
        providerId: 'provider_rep',
        points: 5,
        createdAt: '2026-06-01T00:00:00.000Z'
      },
      {
        eventId: 'event_2',
        type: REPUTATION_EVENT_TYPES.canaryPassed,
        providerId: 'provider_rep',
        createdAt: '2026-06-01T00:01:00.000Z'
      },
      {
        eventId: 'event_3',
        type: REPUTATION_EVENT_TYPES.timeout,
        providerId: 'provider_rep',
        createdAt: '2026-06-01T00:02:00.000Z'
      }
    ];
    const first = reduceReputationEvents([...events, events[0]]);
    const second = reduceReputationEvents([...events].reverse());

    expect(first).toEqual(second);
    expect(first.providers.provider_rep).toMatchObject({
      acceptedReceipts: 1,
      canaryPasses: 1,
      timeouts: 1,
      points: 5,
      totalEvidence: 3
    });
  });

  it('migrates legacy reputation into an event seed and deduplicates retried events', async () => {
    const store = createPoolStore();
    const providerId = 'provider_legacy_rep';
    store.updateReputation(providerId, {
      acceptedReceipts: 2,
      passedCanaries: 1,
      points: 7
    });
    const acceptedEvent = {
      type: REPUTATION_EVENT_TYPES.requesterAccepted,
      providerId,
      receiptHash: 'sha256:accepted-once',
      points: 3,
      createdAt: '2026-07-10T00:00:00.000Z'
    };

    await store.appendReputationEvent(acceptedEvent);
    const projection = await store.appendReputationEvent(acceptedEvent);
    const events = await store.listPoolEventsForProvider(providerId);

    expect(events.some((event) => event.type === REPUTATION_EVENT_TYPES.seed)).toBe(true);
    expect(projection).toMatchObject({
      providerId,
      acceptedReceipts: 3,
      canaryPasses: 1,
      passedCanaries: 1,
      points: 10
    });

    store.updateReputation(providerId, { acceptedReceipts: 999, points: 999 });
    expect(await store.getReputation(providerId)).toMatchObject({
      acceptedReceipts: 3,
      points: 10
    });
  });

  it('records challenge outcomes separately and clears challenge quarantine after a pass', async () => {
    const store = createPoolStore();
    const providerId = 'provider_challenge_rep';
    const failed = await applyCanaryReputation({
      store,
      providerId,
      accepted: false,
      reasons: ['challenge output hash mismatch'],
      kind: CHALLENGE_AUDIT_KIND,
      auditId: 'audit_failed'
    });
    const passed = await applyCanaryReputation({
      store,
      providerId,
      accepted: true,
      kind: CHALLENGE_AUDIT_KIND,
      auditId: 'audit_passed'
    });
    const eventTypes = (await store.listPoolEventsForProvider(providerId)).map((event) => event.type);

    expect(failed).toMatchObject({
      challengeFailures: 1,
      routingBlocked: true,
      quarantineReason: 'challenge_failed'
    });
    expect(passed).toMatchObject({
      challengeFailures: 1,
      challengePasses: 1,
      routingBlocked: false,
      quarantineReason: null
    });
    expect(eventTypes).toEqual([
      REPUTATION_EVENT_TYPES.challengeFailed,
      REPUTATION_EVENT_TYPES.challengePassed
    ]);
  });
});

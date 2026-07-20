#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

import { verifyAdapterCanaryPublication } from '../self/pool/adapter-canary-publication.js';
import { LAUNCH_MODEL } from '../self/pool/model-contract.js';

const baseUrl = String(process.argv[2] || process.env.REPLOID_POOL_DEPLOYMENT_URL || 'https://replo.id').replace(/\/+$/, '');
const receiptPath = path.resolve(
  process.env.REPLOID_ADAPTER_CANARY_RECEIPT
    || 'docs/status/qwen35-ner-lora-runtime-canary-2026-07-19.json'
);
const outputPath = path.resolve(
  process.env.REPLOID_ADAPTER_CANARY_PUBLICATION
    || 'docs/status/qwen35-ner-lora-canary-publication-2026-07-19.json'
);
const custodyPath = path.resolve('docs/artifact-custody/network-canaries-v1.json');
const channel = String(process.env.REPLOID_ADAPTER_CANARY_BROWSER_CHANNEL || '').trim();

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const receiptBytes = await fs.readFile(receiptPath);
const receipt = JSON.parse(receiptBytes.toString('utf8'));
if (receipt.outcome !== 'pass') throw new Error('adapter runtime canary receipt is not passing');
const runtimeSourceRevision = String(receipt.source?.revision || '').trim();
if (!/^[a-f0-9]{40}$/.test(runtimeSourceRevision)) {
  throw new Error('adapter runtime canary receipt does not bind a committed source revision');
}
const custodyBytes = await fs.readFile(custodyPath);
const custody = JSON.parse(custodyBytes.toString('utf8'));
const artifact = custody.artifacts?.find((entry) => entry.id === 'qwen35-0.8b-ner-json-lora');
if (!artifact) throw new Error('NER adapter custody entry is missing');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const input = {
  canaryId: artifact.id,
  custody: {
    registrySchema: custody.schema,
    registryPath: 'docs/artifact-custody/network-canaries-v1.json',
    registryHash: sha256(custodyBytes),
    artifactId: artifact.id
  },
  artifact: {
    repoId: artifact.repository,
    revision: artifact.revision,
    path: artifact.path,
    sizeBytes: artifact.sizeBytes,
    sha256: `sha256:${artifact.sha256}`
  },
  baseModel: {
    modelId: LAUNCH_MODEL.modelId,
    modelHash: LAUNCH_MODEL.modelHash,
    manifestHash: LAUNCH_MODEL.manifestHash,
    tokenizerHash: LAUNCH_MODEL.tokenizerHash,
    artifactIdentity: {
      sourceRepo: LAUNCH_MODEL.artifactIdentity.sourceRepo,
      sourceRevision: LAUNCH_MODEL.artifactIdentity.sourceRevision,
      weightPackId: LAUNCH_MODEL.artifactIdentity.weightPackId,
      weightPackHash: LAUNCH_MODEL.artifactIdentity.weightPackHash,
      manifestVariantId: LAUNCH_MODEL.artifactIdentity.manifestVariantId,
      conversionConfigDigest: LAUNCH_MODEL.artifactIdentity.conversionConfigDigest
    }
  },
  runtime: {
    packageName: receipt.runtime.packageName,
    packageVersion: receipt.runtime.packageVersion,
    packageIntegrity: receipt.runtime.packageIntegrity,
    moduleUrl: receipt.runtime.moduleUrl,
    kernelBaseUrl: receipt.runtime.kernelBaseUrl
  },
  runtimeProof: {
    schema: receipt.schema,
    receiptPath: path.relative(process.cwd(), receiptPath),
    receiptHash: sha256(receiptBytes),
    sourceRevision: runtimeSourceRevision,
    surface: 'chromium-webgpu'
  },
  claimBoundary: 'External PEFT transport and Qwen 0.8B Chromium/WebGPU runtime interoperability only. This is not model-quality, task-quality, promotion, or routed Poolday execution evidence.'
};

const launchOptions = { args: ['--enable-unsafe-webgpu'] };
if (channel) launchOptions.channel = channel;
const browser = await chromium.launch(launchOptions);
let saved;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  saved = await page.evaluate(async (publicationInput) => {
    const [publicationModule, identityModule, receiptModule, sdkModule] = await Promise.all([
      import('/pool/adapter-canary-publication.js'),
      import('/pool/identity.js'),
      import('/pool/inference-receipt.js'),
      import('/pool/sdk.js')
    ]);
    const identity = identityModule.createPoolIdentity('publisher');
    const publisherId = await identity.getRoleId();
    const keyPair = await identity.getSigningKeyPair();
    const publisherPublicKey = await receiptModule.exportPublicKey(keyPair.publicKey);
    const publication = await publicationModule.createSignedAdapterCanaryPublication({
      ...publicationInput,
      publisherId,
      publisherPublicKey,
      privateKey: keyPair.privateKey
    });
    const sdk = sdkModule.createPoolSdk();
    const response = await sdk.publishAdapterCanary(publication);
    return response.publication;
  }, input);
  await context.close();
} finally {
  await browser.close().catch(() => null);
}

const verification = await verifyAdapterCanaryPublication(saved);
if (!verification.ok) throw new Error(`live adapter canary publication failed local verification: ${verification.reasons.join('; ')}`);
const liveResponse = await fetch(`${baseUrl}/pool/adapter-canaries/${encodeURIComponent(saved.publicationHash)}`);
const livePayload = await liveResponse.json().catch(() => null);
if (!liveResponse.ok || livePayload?.publication?.publicationHash !== saved.publicationHash) {
  throw new Error(`live adapter canary discovery failed: ${liveResponse.status}`);
}

const record = {
  schema: 'reploid.pool.adapter-canary-live-publication-record/v1',
  recordedAt: new Date().toISOString(),
  deploymentUrl: baseUrl,
  sourceRevision,
  publication: saved,
  verification,
  discoveryUrl: `${baseUrl}/pool/adapter-canaries/${encodeURIComponent(saved.publicationHash)}`
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
await fs.writeFile(outputPath, bytes);
process.stdout.write(`published ${saved.publicationHash} ${outputPath} ${sha256(bytes)}\n`);

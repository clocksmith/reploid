#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

import { LAUNCH_MODEL } from '../self/pool/model-contract.js';
import { ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA } from '../self/pool/adapter-canary-publication.js';

const DOPPLER_VERSION = '0.4.14';
const DOPPLER_INTEGRITY = 'sha512-Tbs8cOnOg+z+B8swuY29ydu11nmbaBajHc7zlYakpX57OSginazi3pOKGGtDfjDa2chxSWaPQopjZXr7CpLHaw==';
const MODEL_REVISION = '80d7716270b6371d541de979eff3370edaf34e13';
const ADAPTER_REVISION = 'a618a2ccab25928a98694930376ebb3c3db241cb';
const MODULE_URL = `https://esm.sh/doppler-gpu@${DOPPLER_VERSION}/src/client/doppler-api.js?bundle`;
const KERNEL_BASE_URL = `https://esm.sh/doppler-gpu@${DOPPLER_VERSION}/src/gpu/kernels`;
const MODEL_URL = `https://huggingface.co/clocksmith/rdrr/resolve/${MODEL_REVISION}/models/${LAUNCH_MODEL.modelId}`;
const ADAPTER_URL = `https://huggingface.co/clocksmith/lora/resolve/${ADAPTER_REVISION}/adapters/network-canaries/qwen35-0.8b-ner-json-lora/adapter_model.safetensors`;
const OUTPUT_PATH = path.resolve(
  process.env.REPLOID_ADAPTER_CANARY_RECEIPT
    || 'docs/status/qwen35-ner-lora-runtime-canary-2026-07-19.json'
);
const CHANNEL = String(process.env.REPLOID_ADAPTER_CANARY_BROWSER_CHANNEL || '').trim();

const messages = Object.freeze([
  {
    role: 'system',
    content: 'Extract named entities from the sentence. Return strict JSON only with keys people, places, dates. Each value must be an array of strings. Use [] when empty.'
  },
  {
    role: 'user',
    content: 'Sentence: Alice Johnson met Bob Smith in Paris on July 4, 2025.'
  }
]);

const adapterManifest = Object.freeze({
  id: 'qwen35-0-8b-ner-json-lora',
  name: 'Qwen 3.5 0.8B NER JSON LoRA',
  version: '1.0.0',
  baseModel: LAUNCH_MODEL.modelId,
  rank: 16,
  alpha: 32,
  targetModules: [
    'down_proj',
    'o_proj',
    'in_proj_a',
    'up_proj',
    'in_proj_z',
    'gate_proj',
    'q_proj',
    'out_proj',
    'v_proj',
    'k_proj',
    'in_proj_b',
    'in_proj_qkv'
  ],
  weightsFormat: 'safetensors',
  weightsPath: ADAPTER_URL,
  weightsSize: 43346432,
  checksum: 'dfed3509fdd54c04e80e362b6b14f98d9c326a8e732f539996a137086dc4f636',
  checksumAlgorithm: 'sha256'
});

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const runArtifactPreflight = async () => {
  const [registryResponse, manifestResponse] = await Promise.all([
    fetch(`https://registry.npmjs.org/doppler-gpu/${DOPPLER_VERSION}`),
    fetch(`${MODEL_URL}/manifest.json`)
  ]);
  if (!registryResponse.ok) throw new Error(`npm package metadata returned ${registryResponse.status}`);
  if (!manifestResponse.ok) throw new Error(`model manifest returned ${manifestResponse.status}`);
  const npmMetadata = await registryResponse.json();
  const manifestBytes = Buffer.from(await manifestResponse.arrayBuffer());
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const manifestHash = sha256(manifestBytes);
  if (npmMetadata?.dist?.integrity !== DOPPLER_INTEGRITY) {
    throw new Error(`doppler-gpu@${DOPPLER_VERSION} npm integrity mismatch`);
  }
  if (manifestHash !== LAUNCH_MODEL.manifestHash) {
    throw new Error(`hosted Qwen manifest hash mismatch: ${manifestHash}`);
  }
  if (manifest.modelId !== LAUNCH_MODEL.modelId) {
    throw new Error(`hosted Qwen modelId mismatch: ${manifest.modelId}`);
  }

  const custodyPath = path.resolve('docs/artifact-custody/network-canaries-v1.json');
  const custodyBytes = await fs.readFile(custodyPath);
  const custody = JSON.parse(custodyBytes.toString('utf8'));
  const custodyEntry = custody.artifacts?.find((artifact) => artifact.id === 'qwen35-0.8b-ner-json-lora');
  if (!custodyEntry) throw new Error('NER adapter custody entry is missing');
  if (custodyEntry.revision !== ADAPTER_REVISION
    || custodyEntry.path !== 'adapters/network-canaries/qwen35-0.8b-ner-json-lora/adapter_model.safetensors'
    || custodyEntry.sizeBytes !== adapterManifest.weightsSize
    || custodyEntry.sha256 !== adapterManifest.checksum) {
    throw new Error('NER adapter custody entry differs from the runtime canary');
  }
  return {
    npm: {
      version: npmMetadata.version,
      integrity: npmMetadata.dist.integrity,
      shasum: npmMetadata.dist.shasum
    },
    modelManifest: {
      url: `${MODEL_URL}/manifest.json`,
      sha256: manifestHash,
      bytes: manifestBytes.byteLength,
      modelId: manifest.modelId
    },
    custody: {
      schema: custody.schema,
      path: 'docs/artifact-custody/network-canaries-v1.json',
      sha256: sha256(custodyBytes),
      artifactId: custodyEntry.id
    }
  };
};

const startPageServer = async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>Poolday adapter runtime canary</title></head><body></body></html>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`
  };
};

const runBrowserCanary = async (page) => page.evaluate(async (config) => {
  const bytesToHex = (bytes) => Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const hashBytes = async (bytes) => {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  };
  const hashText = (text) => hashBytes(new TextEncoder().encode(text));
  const topLogits = (logits, count = 10) => {
    const top = [];
    for (let tokenId = 0; tokenId < logits.length; tokenId += 1) {
      const value = logits[tokenId];
      if (!Number.isFinite(value)) continue;
      if (top.length < count || value > top[top.length - 1].value) {
        top.push({ tokenId, value });
        top.sort((left, right) => right.value - left.value || left.tokenId - right.tokenId);
        if (top.length > count) top.length = count;
      }
    }
    return top;
  };
  const summarizeLogits = async (values) => {
    const logits = values instanceof Float32Array ? values : Float32Array.from(values || []);
    const bytes = logits.buffer.slice(logits.byteOffset, logits.byteOffset + logits.byteLength);
    let finite = 0;
    for (const value of logits) if (Number.isFinite(value)) finite += 1;
    return {
      count: logits.length,
      finite,
      sha256: await hashBytes(bytes),
      top10: topLogits(logits)
    };
  };
  const parseEntityJson = (text) => {
    const match = String(text || '').trim().match(/\{[\s\S]*\}/);
    if (!match) return { valid: false, value: null };
    try {
      const value = JSON.parse(match[0]);
      const valid = ['people', 'places', 'dates'].every((key) => Array.isArray(value?.[key]));
      return { valid, value: valid ? value : null };
    } catch {
      return { valid: false, value: null };
    }
  };
  const destroySnapshot = (result) => result?.cache?.destroy?.();

  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.kernelBaseUrl;
  const progress = [];
  const module = await import(config.moduleUrl);
  const handle = await module.load({ url: config.modelUrl }, {
    cache: 'opfs',
    onProgress(event) {
      const item = {
        stage: event?.stage || null,
        message: event?.message || null,
        loaded: Number.isFinite(event?.loaded) ? event.loaded : null,
        total: Number.isFinite(event?.total) ? event.total : null
      };
      progress.push(item);
      if (progress.length > 200) progress.shift();
    }
  });

  const basePrefill = await handle.advanced.prefillWithLogits(config.messages, { useChatTemplate: true });
  const baseLogits = basePrefill.logits instanceof Float32Array
    ? basePrefill.logits
    : Float32Array.from(basePrefill.logits || []);
  const baseLogitSummary = await summarizeLogits(baseLogits);
  destroySnapshot(basePrefill);
  await handle.resetGenerationState();
  const generationOptions = { maxTokens: 64, temperature: 0, topK: 1, topP: 1 };
  const baseResponse = await handle.chatText(config.messages, generationOptions);
  await handle.resetGenerationState();

  await handle.loadLoRA(config.adapterManifest);
  const activeAdapter = handle.activeLoRA;
  const adaptedPrefill = await handle.advanced.prefillWithLogits(config.messages, { useChatTemplate: true });
  const adaptedLogits = adaptedPrefill.logits instanceof Float32Array
    ? adaptedPrefill.logits
    : Float32Array.from(adaptedPrefill.logits || []);
  const adaptedLogitSummary = await summarizeLogits(adaptedLogits);
  let changed = 0;
  let maxAbsDifference = 0;
  for (let index = 0; index < Math.min(baseLogits.length, adaptedLogits.length); index += 1) {
    const difference = Math.abs(baseLogits[index] - adaptedLogits[index]);
    if (difference > 0) changed += 1;
    if (difference > maxAbsDifference) maxAbsDifference = difference;
  }
  destroySnapshot(adaptedPrefill);
  await handle.resetGenerationState();
  const adaptedResponse = await handle.chatText(config.messages, generationOptions);
  const entityJson = parseEntityJson(adaptedResponse.content);
  const top10Overlap = baseLogitSummary.top10.filter((entry) => (
    adaptedLogitSummary.top10.some((candidate) => candidate.tokenId === entry.tokenId)
  )).length;

  await handle.unloadLoRA();
  const activeAfterUnload = handle.activeLoRA;
  await handle.unload();

  return {
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      webGpuAvailable: Boolean(navigator.gpu)
    },
    device: handle.deviceInfo || null,
    model: {
      modelId: handle.modelId,
      manifestHash: handle.manifestHash,
      manifestModelId: handle.manifest?.modelId || null,
      loadedAfterUnload: handle.loaded
    },
    progress,
    activation: {
      activeAdapter,
      activeAfterUnload
    },
    logits: {
      base: baseLogitSummary,
      adapted: adaptedLogitSummary,
      changed,
      maxAbsDifference,
      top10Overlap
    },
    outputs: {
      base: baseResponse.content,
      baseHash: await hashText(baseResponse.content),
      adapted: adaptedResponse.content,
      adaptedHash: await hashText(adaptedResponse.content),
      entityJson
    },
    cleanup: {
      adapterCleared: activeAfterUnload == null,
      modelUnloaded: handle.loaded === false
    }
  };
}, {
  moduleUrl: MODULE_URL,
  kernelBaseUrl: KERNEL_BASE_URL,
  modelUrl: MODEL_URL,
  adapterManifest,
  messages
});

const launchOptions = {
  args: ['--enable-unsafe-webgpu']
};
if (CHANNEL) launchOptions.channel = CHANNEL;

const artifactPreflight = await runArtifactPreflight();
const { server, url } = await startPageServer();
const browser = await chromium.launch(launchOptions);
const browserVersion = browser.version();
let result;
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(1200000);
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type())) {
      process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`);
    }
  });
  await page.goto(url);
  result = await runBrowserCanary(page);
  await context.close();
} finally {
  await browser.close().catch(() => null);
  await new Promise((resolve) => server.close(resolve));
}

const failures = [];
if (!result.browser.webGpuAvailable) failures.push('WebGPU unavailable');
if (result.model.modelId !== LAUNCH_MODEL.modelId || result.model.manifestModelId !== LAUNCH_MODEL.modelId) failures.push('loaded modelId mismatch');
if (result.activation.activeAdapter !== adapterManifest.name) failures.push('adapter did not become active');
if (result.logits.base.count === 0 || result.logits.base.finite !== result.logits.base.count) failures.push('base logits are invalid');
if (result.logits.adapted.count !== result.logits.base.count || result.logits.adapted.finite !== result.logits.adapted.count) failures.push('adapted logits are invalid');
if (result.logits.changed === 0 || result.logits.base.sha256 === result.logits.adapted.sha256) failures.push('adapter did not change logits');
if (!result.outputs.entityJson.valid) failures.push('adapted output is not valid entity JSON');
if (!result.cleanup.adapterCleared) failures.push('adapter did not unload');
if (!result.cleanup.modelUnloaded) failures.push('model did not unload');

const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const receipt = {
  schema: ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA,
  recordedAt: new Date().toISOString(),
  outcome: failures.length === 0 ? 'pass' : 'fail',
  claimBoundary: 'External PEFT transport and Qwen 0.8B Chromium/WebGPU runtime interoperability only. This is not model-quality, task-quality, promotion, or routed Poolday execution evidence.',
  source: {
    repository: 'clocksmith/reploid',
    revision: sourceRevision,
    runner: 'scripts/run-adapter-runtime-canary.js'
  },
  artifactPreflight,
  runtime: {
    packageName: 'doppler-gpu',
    packageVersion: DOPPLER_VERSION,
    packageIntegrity: DOPPLER_INTEGRITY,
    moduleUrl: MODULE_URL,
    kernelBaseUrl: KERNEL_BASE_URL
  },
  baseModel: {
    ...LAUNCH_MODEL,
    artifactRevision: MODEL_REVISION,
    artifactUrl: MODEL_URL
  },
  adapter: {
    repoId: 'clocksmith/lora',
    revision: ADAPTER_REVISION,
    path: 'adapters/network-canaries/qwen35-0.8b-ner-json-lora/adapter_model.safetensors',
    sizeBytes: adapterManifest.weightsSize,
    sha256: `sha256:${adapterManifest.checksum}`,
    runtimeManifest: adapterManifest,
    declaredLayerCount: 24
  },
  input: {
    messages,
    messagesHash: sha256(JSON.stringify(messages)),
    generation: { maxTokens: 64, temperature: 0, topK: 1, topP: 1 }
  },
  browser: {
    engine: 'chromium',
    version: browserVersion,
    channel: CHANNEL || 'playwright-chromium',
    ...result.browser
  },
  result,
  gates: {
    adapterManifestAcceptedAcrossDeclaredLayers: result.activation.activeAdapter === adapterManifest.name,
    logitsChanged: result.logits.changed > 0 && result.logits.base.sha256 !== result.logits.adapted.sha256,
    entityJsonValid: result.outputs.entityJson.valid,
    adapterUnloaded: result.cleanup.adapterCleared,
    modelUnloaded: result.cleanup.modelUnloaded
  },
  failures
};

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
await fs.writeFile(OUTPUT_PATH, receiptBytes);
process.stdout.write(`${receipt.outcome} ${OUTPUT_PATH} ${sha256(receiptBytes)}\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
}

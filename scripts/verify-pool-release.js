#!/usr/bin/env node

import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { POOL_CONFIG_HASH, POOL_CONFIG_VERSION } from '../server/pool/config.js';
import { buildCoordinatorRuntimeBundle } from '../server/pool/release-identity.js';
import {
  BROWSER_BUNDLE_DESCRIPTOR_PATH,
  buildSourceReleaseIdentity,
  validateBrowserBundleManifest
} from '../self/pool/browser-release-identity.js';
import {
  capturePoolReleaseLane,
  writePoolReleaseEvidenceIndex
} from './pool-release-evidence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const valueArg = (name) => {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = String(
  valueArg('--url')
  || positionalUrl
  || process.env.REPLOID_POOL_RELEASE_URL
  || process.env.REPLOID_POOL_DEPLOYMENT_URL
  || ''
).replace(/\/+$/, '');
const allowLocal = args.includes('--allow-local');
const allowPlaceholders = args.includes('--allow-placeholders');
const channel = valueArg('--channel') || process.env.REPLOID_POOL_ACTUAL_BROWSER_CHANNEL || '';
let persistReleaseEvidence = null;

if (!baseUrl) {
  console.error('A release URL is required through --url, REPLOID_POOL_RELEASE_URL, or REPLOID_POOL_DEPLOYMENT_URL');
  process.exit(1);
}

const parsedUrl = new URL(baseUrl);
const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
if (isLocal && !allowLocal) {
  console.error('Local release verification requires --allow-local');
  process.exit(1);
}

const runCommand = (label, command, commandArgs = [], env = {}) => new Promise((resolve, reject) => {
  console.log(`[pool-release] ${label}`);
  const child = spawn(command, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
  });
});

const run = (label, script, scriptArgs = [], env = {}) => runCommand(
  label,
  process.execPath,
  [path.join(__dirname, script), ...scriptArgs],
  env
);

const git = (gitArgs, { encoding = 'utf8' } = {}) => new Promise((resolve, reject) => {
  execFile('git', gitArgs, {
    cwd: repoRoot,
    encoding,
    maxBuffer: 32 * 1024 * 1024
  }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(`git ${gitArgs.join(' ')} failed: ${String(stderr || error.message).trim()}`));
      return;
    }
    resolve(stdout);
  });
});

const deriveCleanSourceReleaseIdentity = async () => {
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
  if (status.length > 0) {
    const changed = status.trim().split('\n').slice(0, 12).join(', ');
    throw new Error(`release qualification requires a clean Git tree; changed paths: ${changed}`);
  }
  const sourceRevision = String(await git(['rev-parse', 'HEAD'])).trim();
  const sourceTreeBytes = await git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], { encoding: null });
  const trackedFileCount = [...sourceTreeBytes].filter((byte) => byte === 0).length;
  return buildSourceReleaseIdentity({
    sourceRevision,
    sourceTreeBytes: new Uint8Array(sourceTreeBytes),
    sourceDirty: false,
    trackedFileCount
  });
};

const readBrowserBundleManifest = async () => {
  const manifestPath = path.join(repoRoot, 'self', BROWSER_BUNDLE_DESCRIPTOR_PATH);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const validation = await validateBrowserBundleManifest(manifest);
  if (!validation.ok) {
    throw new Error(`browser bundle manifest is invalid: ${validation.reasons.join('; ')}`);
  }
  return manifest;
};

const verifyDeployedPoolContract = async (sourceReleaseIdentity, runtimeBundleIdentity) => {
  const endpoint = new URL('/pool/deployment/check', `${baseUrl}/`);
  let response;
  try {
    response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(`could not read deployed Pool contract: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`deployed Pool contract returned ${response.status}`);
  }
  let deployed;
  try {
    deployed = await response.json();
  } catch (error) {
    throw new Error(`deployed Pool contract was not valid JSON: ${error.message}`);
  }
  const deployedVersion = deployed.configVersion || deployed.config?.version || null;
  const deployedHash = deployed.configHash || deployed.config?.hash || null;
  if (deployedVersion !== POOL_CONFIG_VERSION || deployedHash !== POOL_CONFIG_HASH) {
    throw new Error(
      `deployed Pool contract does not match local governed config: expected ${POOL_CONFIG_VERSION} ${POOL_CONFIG_HASH}, received ${deployedVersion || 'missing'} ${deployedHash || 'missing'}`
    );
  }
  if (deployed.release?.sourceRevision !== sourceReleaseIdentity.sourceRevision
    || deployed.release?.sourceRevisionValid !== true
    || deployed.release?.imageBoundToSourceRevision !== true
    || deployed.release?.runtimeBundleHash !== runtimeBundleIdentity.runtimeBundleHash
    || !deployed.release?.platformRevision) {
    throw new Error(
      `deployed Pool backend is not bound to local source ${sourceReleaseIdentity.sourceRevision}: `
      + `received ${deployed.release?.sourceRevision || 'missing'} at ${deployed.release?.platformRevision || 'missing-platform-revision'}`
    );
  }
  return deployed;
};

try {
  const sourceReleaseIdentity = await deriveCleanSourceReleaseIdentity();
  const runtimeBundleIdentity = await buildCoordinatorRuntimeBundle();
  await run('local browser-bundle identity gate', 'build-browser-bundle-manifest.js', ['--check']);
  const browserBundleManifest = await readBrowserBundleManifest();
  await run('deployed browser-bundle byte gate', 'verify-browser-bundle.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);
  console.log(
    `[pool-release] source ${sourceReleaseIdentity.sourceRevision} ${sourceReleaseIdentity.sourceTreeHash}; `
    + `browser bundle ${browserBundleManifest.bundleHash}`
  );

  const deployedPoolContract = await verifyDeployedPoolContract(sourceReleaseIdentity, runtimeBundleIdentity);

  await run('deploy-surface drift gate', 'verify-deploy-surface.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);

  const productionArgs = ['--verify-artifact'];
  if (!isLocal) productionArgs.push('--url', baseUrl);
  if (allowPlaceholders) productionArgs.push('--allow-placeholders');
  await run('production contract and deployment readiness', 'verify-pool-production.js', productionArgs);

  await run('synthetic browser route and peer-flow smoke', 'pool-browser-smoke.js', [
    baseUrl,
    ...(isLocal ? ['--allow-local'] : [])
  ]);

  const actualInferenceEnv = {
    REPLOID_E2E_ACTUAL_INFERENCE: '1',
    REPLOID_E2E_ACTUAL_MULTI_PROVIDER: '1',
    REPLOID_E2E_STRICT_ARTIFACT_PREFLIGHT: '1',
    REPLOID_E2E_RELAY_MODE: 'server',
    REPLOID_E2E_FORCE_TURN: '1',
    REPLOID_E2E_BASE_URL: baseUrl,
    REPLOID_BROWSER_QUALIFICATION_SOURCE_REVISION: sourceReleaseIdentity.sourceRevision,
    REPLOID_BROWSER_QUALIFICATION_SOURCE_TREE_HASH: sourceReleaseIdentity.sourceTreeHash,
    REPLOID_BROWSER_QUALIFICATION_BUNDLE_HASH: browserBundleManifest.bundleHash,
    REPLOID_BROWSER_QUALIFICATION_SOURCE_DIRTY: 'false',
    ...(channel ? { REPLOID_E2E_CHROMIUM_CHANNEL: channel } : {})
  };
  const actualInferenceLanes = [
    {
      id: 'primary-inference',
      label: 'deployed relay-only ESM-2 protein inference and receipt acceptance',
      grep: 'loads ESM-2, embeds',
      requiredAttachments: [
        'poolday-server-protein-receipt.json',
        'poolday-browser-qualification-observation.incomplete.json'
      ],
      qualificationChecks: [
        'immutableArtifactDelivery',
        'completeHashVerification',
        'webGpuExecution',
        'opfsPersistence',
        'opfsRestoration',
        'receiptIntegrity'
      ]
    },
    {
      id: 'interruption-discard',
      label: 'deployed relay-only requester interruption recovery',
      grep: 'preserves an actual ESM-2 request',
      requiredAttachments: ['poolday-actual-interruption-recovery-observation.json'],
      qualificationChecks: ['interruptionRecovery']
    },
    {
      id: 'interruption-retry',
      label: 'deployed relay-only explicit interruption retry',
      grep: 'creates a new actual ESM-2 request',
      requiredAttachments: ['poolday-actual-interruption-retry-observation.json'],
      qualificationChecks: ['interruptionRecovery']
    },
    {
      id: 'after-start-cancellation',
      label: 'deployed relay-only after-start ESM-2 cancellation',
      grep: 'cancels actual ESM-2 work',
      requiredAttachments: ['poolday-actual-cancellation-observation.json'],
      qualificationChecks: ['cancellation']
    },
    {
      id: 'stale-result-rejection',
      label: 'deployed ESM-2 stale-result rejection',
      grep: 'rejects a superseded actual ESM-2 result',
      requiredAttachments: ['poolday-actual-stale-result-rejection-observation.json'],
      qualificationChecks: ['staleResultRejection']
    },
    {
      id: 'manifest-corruption-rejection',
      label: 'deployed ESM-2 manifest corruption rejection',
      grep: 'rejects a corrupted ESM-2 manifest',
      requiredAttachments: ['poolday-actual-corruption-rejection-observation.json'],
      qualificationChecks: ['corruptionRejection']
    },
    {
      id: 'cached-shard-recovery',
      label: 'deployed ESM-2 cached-shard corruption recovery',
      grep: 'recovers a corrupted cached ESM-2 shard',
      requiredAttachments: ['poolday-actual-cached-shard-recovery-observation.json'],
      qualificationChecks: ['corruptionRejection']
    },
    {
      id: 'queued-provider-continuity',
      label: 'deployed relay-only queued-provider continuity and receipt acceptance',
      grep: 'queues two public protein sequences',
      requiredAttachments: ['poolday-actual-queue-continuity-observation.json'],
      qualificationChecks: [],
      supportingClaim: 'one loaded provider serializes queued assignments under bounded queue and execution phases'
    },
    {
      id: 'same-operator-provider-quorum',
      label: 'deployed relay-only two-provider quorum inference and receipt acceptance',
      grep: 'loads two independent',
      requiredAttachments: ['poolday-server-protein-ring-2-receipt.json'],
      qualificationChecks: [],
      supportingClaim: 'two provider tabs produce provider-bound quorum receipts; this is not independently operated reproduction'
    }
  ];
  const evidenceCreatedAt = new Date().toISOString();
  const evidenceDirectory = path.join(
    repoRoot,
    'test-results',
    'pool-release',
    `${sourceReleaseIdentity.sourceRevision.slice(0, 12)}-${browserBundleManifest.bundleHash.slice(7, 19)}-${Date.now()}`
  );
  const capturedLanes = [];
  const expectedLaneRelease = {
    sourceRevision: sourceReleaseIdentity.sourceRevision,
    sourceTreeHash: sourceReleaseIdentity.sourceTreeHash,
    browserBundleHash: browserBundleManifest.bundleHash,
    sourceDirty: false
  };
  persistReleaseEvidence = async (status, failure = null) => writePoolReleaseEvidenceIndex(evidenceDirectory, {
    status,
    createdAt: evidenceCreatedAt,
    release: {
      ...sourceReleaseIdentity,
      browserBundleHash: browserBundleManifest.bundleHash
    },
    deployment: {
      baseUrl,
      local: isLocal,
      backendSourceRevision: deployedPoolContract.release.sourceRevision,
      backendImage: deployedPoolContract.release.image,
      backendRuntimeBundleHash: deployedPoolContract.release.runtimeBundleHash,
      platformRevision: deployedPoolContract.release.platformRevision,
      platformConfiguration: deployedPoolContract.release.platformConfiguration || null,
      platformService: deployedPoolContract.release.platformService || null
    },
    config: { version: POOL_CONFIG_VERSION, hash: POOL_CONFIG_HASH },
    requiredLaneIds: actualInferenceLanes.map((lane) => lane.id),
    lanes: capturedLanes,
    failure: failure ? { message: String(failure) } : null
  });
  await persistReleaseEvidence('running');

  const sharedReportPath = path.join(repoRoot, 'test-results', 'e2e-results.json');
  for (const lane of actualInferenceLanes) {
    let laneError = null;
    try {
      await runCommand(
        lane.label,
        process.execPath,
        [
          path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
          'test',
          'tests/e2e/p2p-actual-inference.spec.js',
          '--project=chromium',
          '--grep',
          lane.grep
        ],
        actualInferenceEnv
      );
    } catch (error) {
      laneError = error;
    }
    try {
      capturedLanes.push(await capturePoolReleaseLane({
        lane,
        reportPath: sharedReportPath,
        outputDirectory: evidenceDirectory,
        expectedRelease: expectedLaneRelease,
        requirePassed: laneError === null
      }));
    } catch (error) {
      laneError = laneError
        ? new Error(`${laneError.message}; lane report preservation failed: ${error.message}`)
        : error;
    }
    await persistReleaseEvidence(laneError ? 'failed' : 'running', laneError?.message || null);
    if (laneError) throw laneError;
  }
  const { outputPath: releaseEvidencePath } = await persistReleaseEvidence('passed');
  console.log(`[pool-release] evidence ${releaseEvidencePath}`);
  console.log(`[pool-release] passed ${baseUrl}`);
} catch (error) {
  if (persistReleaseEvidence) {
    try {
      await persistReleaseEvidence('failed', error.message);
    } catch (evidenceError) {
      console.error(`[pool-release] failed to preserve release evidence: ${evidenceError.message}`);
    }
  }
  console.error(`[pool-release] failed: ${error.message}`);
  process.exit(1);
}

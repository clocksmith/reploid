/** CDP endpoints and private signaling routes belong in the operator's uncommitted configuration. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { openWorkoutPage, openTrainingDiscovery, bindCounterpart, workoutClient } from './lora-workout-client.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const roleNames = ['coordinator', 'contributor'];

async function browserEvidence(browser) {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    return { browserVersion: browser.version(), devices: gpu.devices.map(({ vendorId, deviceId, vendorString, deviceString, driverVersion }) =>
      ({ vendorId, deviceId, vendorString, deviceString, driverVersion })) };
  } finally { await cdp.detach(); }
}

async function servedTrainingBuild(page) {
  return page.evaluate(async () => {
    const read = async pathname => {
      const response = await fetch(pathname);
      if (!response.ok) throw new Error('The training build is missing ' + pathname);
      return response.arrayBuffer();
    };
    const policyFile = '/config/lora-training.json';
    const policy = JSON.parse(new TextDecoder().decode(await read(policyFile)));
    const paths = [policyFile, policy.modelPath + 'manifest.json', '/config/doppler-package.json', '/ui/react/app.js',
      '/host/lora-training.js', '/host/lora-training-worker.js', '/host/lora-training-executor.js',
      '/vendor/reploid/training/session.js', '/vendor/reploid/training/network.js'];
    const sha256 = Object.fromEntries(await Promise.all(paths.map(async pathname => {
      const digest = await crypto.subtle.digest('SHA-256', await read(pathname));
      return [pathname, Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')];
    })));
    return { modelId: policy.modelId, baseManifestHash: policy.baseManifestHash, sha256 };
  });
}

async function discover(pages, room) {
  const identities = await Promise.all(pages.map(openTrainingDiscovery));
  identities.forEach(row => assert.equal(row.roomId, room, 'Both participants must use the private invitation'));
  assert.notEqual(identities[0].participantId, identities[1].participantId);
  assert.notEqual(identities[0].transportId, identities[1].transportId);
  const bindings = await Promise.all(pages.map((page, index) => bindCounterpart(page, identities[1 - index])));
  assert.equal(bindings[0].certificates.remote, bindings[1].certificates.local);
  assert.equal(bindings[1].certificates.remote, bindings[0].certificates.local);
  const receipt = Object.fromEntries(roleNames.map((role, i) => [role, { participantId: identities[i].participantId,
    counterpartVerified: bindings[i].verifiedParticipantId, localCertificateSha256: digest(bindings[i].certificates.local),
    remoteCertificateSha256: digest(bindings[i].certificates.remote) }]));
  return { identities, receipt };
}

export async function withTrainingPair(config, use) {
  assert(config.coordinator?.endpoint && config.contributor?.endpoint);
  assert.notEqual(config.coordinator.endpoint, config.contributor.endpoint, 'Separate browser endpoints are required');
  const browsers = [], contexts = [], pages = [];
  const room = 'reploid-swarm-workout-' + randomUUID();
  const token = randomBytes(32).toString('base64url');
  let primary;
  try {
    // Sequentially acquire ownership so a partial failure can release every context it created.
    for (const role of roleNames) {
      const options = config[role];
      const browser = await chromium.connectOverCDP(options.endpoint);
      browsers.push(browser);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      contexts.push(context);
      pages.push(await openWorkoutPage(context, options, { room, token }));
    }
    const runtime = await Promise.all(browsers.map(browserEvidence));
    const physical = config.discoveryOnly ? [] : await Promise.all(pages.map(page => page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter for this browser');
      const info = adapter.info || await adapter.requestAdapterInfo();
      if (adapter.isFallbackAdapter || info.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test(
        [info.vendor, info.architecture, info.device, info.description].join(' '))) throw new Error('Physical WebGPU adapter required');
      return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
    })));
    const builds = await Promise.all(pages.map(servedTrainingBuild));
    assert.deepEqual(builds[0], builds[1], 'Both browsers must use the same served model manifest, training policy and application modules');
    const first = await discover(pages, room);
    const discovery = { scope: 'private Poolday invitation, signed discovery and matched DTLS bindings',
      servedTrainingBuild: builds[0],
      consentAtDiscovery: 'Both Improve panels displayed the training disclosure and started with consent off',
      connectionPaths: Object.fromEntries(await Promise.all(pages.map(async (page, i) => [roleNames[i], await page.evaluate(() => globalThis.loraChannelObservation.paths())]))),
      measurement: 'RTCDataChannel application bytes, including training control and framing, in both directions',
      binding: first.receipt, browsers: Object.fromEntries(roleNames.map((name, i) => [name, { ...runtime[i], adapter: physical[i] || null }])) };
    const clients = pages.map((page, i) => workoutClient(page, first.identities[i], first.identities[1 - i]));
    const measure = async () => Object.fromEntries(await Promise.all(pages.map(async (page, i) =>
      [roleNames[i], await page.evaluate(() => globalThis.loraChannelObservation.measure())])));
    const refreshPeers = async () => {
      await Promise.all(pages.map(page => page.evaluate(async () => {
        const { host } = globalThis.loraQualification;
        await host.training.disconnect();
        await host.swarm.disconnect({ automatic: true });
      })));
      const fresh = await discover(pages, room);
      fresh.identities.forEach((id, i) => {
        assert.equal(id.participantId, first.identities[i].participantId, 'Participant signing identity changed on reconnection');
        Object.assign(first.identities[i], id);
      });
      return fresh.receipt;
    };
    const interrupt = () => pages[1].evaluate(() => globalThis.loraChannelObservation.interrupt());
    return await use({ coordinator: clients[0], contributor: clients[1], refreshPeers, measure, interrupt, discovery });
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    const shutdown = await Promise.allSettled(pages.map(page => page.evaluate(async () => {
      const app = globalThis.loraQualification;
      if (app) {
        app.dispose();
        const results = await app.host.close();
        const failure = results?.find?.(result => result?.status === 'rejected');
        if (failure) throw failure.reason;
      }
    })));
    const closedContexts = await Promise.allSettled(contexts.map(context => context.close()));
    // For connectOverCDP, Playwright disconnects this client after closing its owned contexts.
    const disconnected = await Promise.allSettled(browsers.map(browser => browser.close()));
    const failures = [...shutdown, ...closedContexts, ...disconnected].filter(result => result.status === 'rejected');
    if (!primary && failures.length) throw new AggregateError(failures.map(result => result.reason), 'Training browser cleanup failed');
  }
}

async function main(configPath) {
  assert(configPath, 'Pass the private two-host configuration JSON');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert(config.outputDirectory);
  await mkdir(config.outputDirectory, { recursive: true });
  const output = path.join(config.outputDirectory, config.discoveryOnly ? 'training-discovery.json' : 'training-workout.json');
  const result = { schema: 'reploid.two-host-training-workout/v1', startedAt: new Date().toISOString() };
  try {
    await withTrainingPair(config, async pair => {
      result.discovery = pair.discovery;
      if (!config.discoveryOnly) {
        const { runTrainingWorkout } = await import('./lora-workout.js');
        result.workout = await runTrainingWorkout(pair, config);
        assert.equal(result.workout.status, 'passed', 'Training outcome failed its workout gates');
      }
      result.transport = await pair.measure();
    });
    result.passed = true;
  } catch (error) {
    // CDP setup errors may include the operator's endpoint or the room capability.
    result.passed = false;
    result.error = String(error.message).replaceAll(/(?:https?|wss?):\/\/[^\s'"<>]+/g, '[endpoint]')
      .replaceAll(/swarmToken=[^&\s]+/g, 'swarmToken=[private]');
    process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ passed: result.passed, output, error: result.error }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main(process.argv[2]);

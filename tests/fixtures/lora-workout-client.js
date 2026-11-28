import assert from 'node:assert/strict';
import { observeTrainingChannels } from './lora-channel-observation.js';

const discoveryTimeout = 45_000;
const trainingTimeout = 330_000;

/** Mount the shipped Improve screen on the Poolday host that executes the workout. */
export async function openWorkoutPage(context, options, invitation) {
  const page = await context.newPage();
  const origin = new URL(options.origin).origin;
  const signaling = new URL(options.signalingUrl);
  assert(['ws:', 'wss:'].includes(signaling.protocol));
  const diagnostics = [];
  const log = text => diagnostics.push(String(text).replaceAll(/(?:https?|wss?):\/\/[^\s'"<>]+/g, '[endpoint]').slice(0, 240));
  page.on('pageerror', error => log(error.message));
  page.on('console', message => {
    if (/swarm|signaling|certificate|webrtc|refused/i.test(message.text()) && ['warning', 'error'].includes(message.type())) log(message.text());
  });
  page.on('websocket', socket => {
    socket.on('socketerror', error => log(error));
    socket.on('framereceived', ({ payload }) => {
      try {
        const msg = JSON.parse(payload);
        if (['error', 'joined', 'peer-joined', 'peer-left', 'offer', 'answer'].includes(msg.type)) log('Signaling ' + msg.type + (msg.error ? ' ' + msg.error : ''));
      } catch { /* Non-JSON traffic has no discovery evidence. */ }
    });
  });
  page.discoveryDiagnostics = diagnostics;
  await page.addInitScript(observeTrainingChannels);
  const url = new URL('/improve', origin);
  url.searchParams.set('qualification', 'lora');
  url.searchParams.set('swarm', invitation.room);
  url.searchParams.set('swarmToken', invitation.token);
  url.searchParams.set('signaling', signaling.href);
  const response = await page.goto(url.href);
  assert(response?.ok() && await page.locator('#lora-workout').count() === 1,
    'Serve tests/fixtures/lora-workout.html at /improve?qualification=lora on the private test origin');
  await page.evaluate(async ({ signalingUrl, rtcConfig }) => {
    const csp = document.createElement('meta');
    csp.httpEquiv = 'Content-Security-Policy';
    csp.content = `default-src 'self' blob: data:; connect-src 'self' ${new URL(signalingUrl).origin}; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:`;
    document.head.append(csp);
    const stylesheet = await (await fetch('/styles/poolday/layers.json')).json();
    for (const file of [stylesheet.tokens, ...stylesheet.primitives]) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/styles/poolday/' + file;
      document.head.append(link);
    }
    globalThis.REPLOID_POOL_RTC_CONFIG = rtcConfig;
    const [{ openProductHost }, { mountPoolday }] = await Promise.all([import('/host/open-product-host.js'), import('/ui/react/app.js')]);
    const { host: opening, earningOpening } = openProductHost();
    const host = await opening;
    const dispose = mountPoolday(document.getElementById('lora-workout'), { host, earning: earningOpening });
    globalThis.loraQualification = { host, dispose };
  }, { signalingUrl: signaling.href, rtcConfig: options.rtcConfig || { iceServers: [] } });
  await page.locator('[data-lora-panel] > summary').click();
  await page.locator('[data-lora-panel] details > summary').click();
  await page.getByText(/gradients can reveal information about training data/i).waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-lora-consent]').getAttribute('aria-checked'), 'false', 'A fresh context must start without training consent');
  return page;
}

export async function openTrainingDiscovery(page) {
  return page.evaluate(async () => {
    const { host } = globalThis.loraQualification;
    await host.swarm.connect();
    return { transportId: host.swarm.getOwnerPairingChannel().transport.getPeerId(),
      participantId: host.swarm.partitions.requesterIdentity(), roomId: host.swarm.getNetworkId() };
  });
}

export async function bindCounterpart(page, remote) {
  try {
    await page.waitForFunction(peer => globalThis.loraQualification.host.training.peers().some(row => row.id === peer),
      remote.transportId, { timeout: discoveryTimeout });
  } catch (error) {
    throw new Error('Poolday did not discover the other browser. ' + page.discoveryDiagnostics.slice(-12).join(' | '), { cause: error });
  }
  const binding = await page.evaluate(async peer => {
    const { host } = globalThis.loraQualification;
    const peers = host.training.peers().map(row => row.id);
    if (peers.length !== 1 || peers[0] !== peer) throw new Error('The private training room contains an unexpected peer');
    const verifiedParticipantId = await host.swarm.verifyPeerIdentity(peer, AbortSignal.timeout(30_000));
    const certificates = host.swarm.getOwnerPairingChannel().transport.getPeerBinding(peer);
    return { verifiedParticipantId, certificates };
  }, remote.transportId);
  assert.equal(binding.verifiedParticipantId, remote.participantId, 'Discovery signature differs from the counterpart’s own identity');
  assert(binding.certificates?.local && binding.certificates.remote, 'Missing WebRTC certificate binding');
  await page.locator('[data-lora-connect]').click();
  await page.getByRole('radio', { name: remote.transportId, exact: true }).waitFor();
  return binding;
}

async function authorizeSamples(page, samples) {
  const consent = page.locator('[data-lora-consent]');
  if (await consent.getAttribute('aria-checked') === 'true') await consent.click();
  await page.locator('[data-lora-file]').setInputFiles({ name: 'training-samples.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(samples)) });
  await page.locator('[data-lora-status]').filter({ hasText: `${samples.length} training samples selected` }).waitFor();
  await consent.click();
  assert.equal(await consent.getAttribute('aria-checked'), 'true');
}

async function candidateFromPage(page) {
  const value = await page.evaluate(async () => {
    const candidate = globalThis.loraQualification.host.training.getCandidate();
    if (!candidate) return null;
    const reader = new FileReader();
    const encoded = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([candidate.weights]));
    });
    return { ...candidate, weights: encoded };
  });
  if (value) value.weights = Uint8Array.from(Buffer.from(value.weights, 'base64')).buffer;
  return value;
}

export function workoutClient(page, self, remote) {
  return {
    get peer() { return remote.transportId; },
    participantId: self.participantId,
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    getState: () => page.evaluate(() => globalThis.loraQualification.host.training.getState()),
    getCandidate: () => candidateFromPage(page),
    getCheckpoint: () => page.evaluate(() => globalThis.loraQualification.host.training.getCheckpoint()),
    async stop() {
      await page.locator('[data-lora-stop]').click();
      await page.waitForFunction(() => {
        const state = globalThis.loraQualification.host.training.getState();
        return state.phase === 'idle' && !state.busy;
      }, null, { timeout: trainingTimeout });
    },
    async contribute(input) {
      const peer = remote.transportId;
      assert.equal(input.coordinator, peer);
      assert.equal(input.consent, true);
      await authorizeSamples(page, [input.sample]);
      await page.getByRole('radio', { name: peer, exact: true }).check();
      await page.locator('[data-lora-share]').click();
      await page.waitForFunction(() => {
        const state = globalThis.loraQualification.host.training.getState();
        return ['ready', 'failed', 'cancelled'].includes(state.phase) || !!document.querySelector('[data-lora-error]')?.textContent.trim();
      }, null, { timeout: trainingTimeout });
      const state = await this.getState();
      assert.equal(state.phase, 'ready', (await page.locator('[data-lora-error]').allTextContents()).join(' ') || state.message);
    },
    async run(input) {
      const peer = remote.transportId;
      assert.equal(input.consent, true);
      assert.deepEqual(input.peers ?? [], input.peers?.length ? [peer] : []);
      await authorizeSamples(page, input.samples);
      if (input.peers?.length) await page.getByRole('checkbox', { name: peer, exact: true }).check();
      else for (const selected of await page.locator('[data-lora-peer]:checked').all()) await selected.uncheck();
      await page.locator('[data-lora-id]').fill(input.adapter.id);
      await page.locator('[data-lora-version]').fill(input.adapter.version);
      const resume = page.locator('[data-lora-resume]');
      if (input.resume === true || await resume.isVisible()) {
        if ((await resume.getAttribute('aria-checked') === 'true') !== (input.resume === true)) await resume.click();
      }
      // A retained candidate remains visible across failures. Wait for this button press to reach its own terminal state.
      await page.evaluate(() => {
        const app = globalThis.loraQualification;
        const attempt = { started: false, finished: false };
        app.attempt = attempt;
        attempt.unsubscribe = app.host.training.subscribe(state => {
          if (state.phase === 'preparing') attempt.started = true;
          if (attempt.started && !state.busy && ['completed', 'failed', 'cancelled'].includes(state.phase)) attempt.finished = true;
        });
      });
      try {
        await page.locator(input.peers?.length ? '[data-lora-pool]' : '[data-lora-local]').click();
        await page.waitForFunction(() => globalThis.loraQualification.attempt.finished
          || !!document.querySelector('[data-lora-error]')?.textContent.trim(), null, { timeout: trainingTimeout });
        const state = await this.getState();
        const error = (await page.locator('[data-lora-error]').allTextContents()).join(' ').trim();
        if (error || state.phase !== 'completed') throw new Error(error || state.message);
      } finally {
        await page.evaluate(() => globalThis.loraQualification.attempt.unsubscribe());
      }
      return candidateFromPage(page);
    }
  };
}

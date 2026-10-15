#!/usr/bin/env node
// Native contributor process for the local earning UI demonstration (not production code).
//
// Two native contributor devices of one account, each with its own persistent identity, sign in through
// the service's local test flow, register, record their owner policy and accept stage-share offers through
// server/native-earning.js, exactly as the native participant's earning port does. They host the two
// resident stages of the in-repo fixture route (tests/helpers/resident-route.js: real resident partitions,
// admission records and the ordered route runner; deterministic values stand in for Doppler arithmetic, and
// the requester-to-coordinator hop is this loopback WebSocket bridge). A requester page sends each attempt
// over the bridge; its approval, state, deltas and activity travel back, so the page's earning client
// quotes, binds and reports exactly as for a mesh route. Every few seconds both devices claim their settled
// stage shares from their own admission records. Proves orchestration, accounting and claims, not GPU
// execution or answer quality.
//
// Usage: node contributor.mjs --repo <checkout> --work <state directory> --service <http://127.0.0.1:port/v1>
//          --bridge-port <port> --subject <name> --log <jsonl file>
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: Object.fromEntries(['repo', 'work', 'service', 'bridge-port', 'subject', 'log'].map((key) => [key, { type: 'string' }])) });
for (const name of ['repo', 'work', 'service', 'bridge-port', 'subject', 'log']) if (!values[name]) throw new Error(`--${name} is required`);
const load = (relative) => import(pathToFileURL(path.join(values.repo, relative)).href);
const [{ residentRoute }, { createNativeEarningStorage, openNativeEarning, readNativeEarningFile }, owner, identityModule, custody, { WebSocketServer },
  { createAttemptEvidenceSigner }] = await Promise.all([
  load('tests/helpers/resident-route.js'), load('server/native-earning.js'), load('server/native-owner/policy.js'),
  load('packages/reploid/src/artifacts/identity.js'), fs.readFile(path.join(values.repo, 'self/config/chat-files.json'), 'utf8').then(JSON.parse),
  import(pathToFileURL(path.join(values.repo, 'node_modules/ws/wrapper.mjs')).href), load('packages/reploid/src/mesh/partitions/partition-attempt-evidence.js')
]);

const log = async (event) => fs.appendFile(values.log, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
await fs.mkdir(values.work, { recursive: true, mode: 0o700 });

// The owner's grants for this demonstration host: personal equipment and network, no further limits.
const grant = { granted: true, ownership: 'personal', grantedBy: 'owner_demo' };
const policy = owner.validateNativeOwnerPolicy({ schema: owner.NATIVE_OWNER_POLICY_SCHEMA, authorization: { equipment: grant, network: grant }, sampleIntervalMs: 5000 }, { custody });
const ownerAuthorization = { policy, digest: owner.nativeOwnerPolicyDigest(policy) };

/** One native device: persistent identity and durable earning state in the work directory, as the CLI keeps them beside --identity-file. */
async function device(name) {
  const identityFile = path.join(values.work, `${name}-identity.json`);
  let identity;
  try { identity = JSON.parse(await fs.readFile(identityFile, 'utf8')); }
  catch { identity = await identityModule.createSigningIdentity({ algorithm: 'Ed25519' }); await fs.writeFile(identityFile, JSON.stringify(identity), { mode: 0o600 }); }
  const configFile = path.join(values.work, `${name}-earning.json`);
  await fs.writeFile(configFile, JSON.stringify({ schema: 'reploid.native-earning/v1',
    client: { schema: 'reploid.earning-client/v1', enabled: true, baseUrl: values.service, providerId: 'local-test' }, signIn: { subject: values.subject } }), { mode: 0o600 });
  const earning = await openNativeEarning({ settings: await readNativeEarningFile(configFile), identity, ownerAuthorization,
    storage: createNativeEarningStorage(path.join(values.work, `${name}-earning-state.json`)) });
  await log({ event: 'native-device-ready', device: name, participantId: identity.peerId, accountId: earning.session.accountId, deviceId: earning.session.deviceId });
  // Each stage signs its receipts for charged attempts with this device's registered identity.
  return { earning, signer: createAttemptEvidenceSigner({ identity }), participantId: identity.peerId };
}

const hosts = [await device('native-0'), await device('native-1')];
const devices = hosts.map((host) => Object.assign(Object.create(null), { participantId: host.participantId, observe: host.earning.observe, offers: host.earning.offers }));
const routes = new Map();
async function routeFor(requesterId) {
  if (!routes.has(requesterId)) {
    routes.set(requesterId, residentRoute({ participants: hosts.map((row) => row.participantId), requesterId, signers: hosts.map((row) => row.signer) }));
    const route = await routes.get(requesterId);
    // Offers are requested and accepted for the model and plan these stages serve, before any route admits them.
    const served = { modelId: route.route.modelId, modelIdentity: route.route.modelIdentity, planId: route.route.planId };
    for (const [index, earning] of devices.entries()) {
      await earning.observe({ descriptor: served });
      await log({ event: 'offers', device: `native-${index}`, offers: await earning.offers() });
    }
  }
  return routes.get(requesterId);
}

/** Claim every settled stage share this device's residents recorded, across every requester's route. */
let claiming = Promise.resolve();
const reported = new Set();
const claim = () => (claiming = claiming.then(async () => {
  const all = await Promise.all([...routes.values()]);
  for (const [index, earning] of devices.entries()) {
    const admissions = all.flatMap((route) => route.admissions(index));
    if (!admissions.length) continue;
    const observed = await earning.observe({ admissions }).catch((error) => ({ error: error.code || error.message }));
    // Each unit's state is logged when it changes.
    const changed = (observed.stages ?? []).filter((row) => !reported.has(JSON.stringify(row)) && reported.add(JSON.stringify(row)));
    if (observed.error || changed.length) await log({ event: 'claims', device: `native-${index}`, error: observed.error ?? null, stages: changed });
  }
}).catch((error) => log({ event: 'claims-failed', message: error.message })));
const timer = setInterval(claim, 2000);

const server = new WebSocketServer({ host: '127.0.0.1', port: Number(values['bridge-port']), path: '/route' });
server.on('connection', (socket) => {
  const controller = new AbortController();
  let approve = null;
  const acknowledging = new Map();
  const send = (message) => { if (socket.readyState === 1) socket.send(JSON.stringify(message)); };
  socket.on('close', () => { controller.abort(new Error('Requester disconnected')); approve?.(false); });
  socket.on('message', async (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === 'model') { send({ type: 'model', model: (await routeFor(message.requesterId)).model }); return; }
    if (message.type === 'approval') { approve?.(message); approve = null; return; }
    if (message.type === 'acknowledged') { acknowledging.get(message.id)?.(message.value ?? undefined); acknowledging.delete(message.id); return; }
    if (message.type === 'abort') { controller.abort(Object.assign(new Error('The requester stopped the answer'), { code: 'CANCELLED' })); return; }
    if (message.type !== 'generate') return;
    const route = await routeFor(message.requesterId);
    await log({ event: 'attempt', requesterId: message.requesterId, threadId: message.request.threadId, attemptId: message.request.attemptId });
    try {
      const controls = {
        signal: controller.signal,
        // The requester's answer carries its signed charge binding when the quote settles from evidence; its
        // acknowledgments of each final-stage output travel back over the same bridge.
        requestApproval: (preview) => new Promise((resolve) => {
          approve = (answer) => {
            if (answer.charge) {
              controls.charge = answer.charge;
              controls.onOutput = (record) => new Promise((done) => { const id = crypto.randomUUID(); acknowledging.set(id, done); send({ type: 'output', id, record }); });
            }
            resolve(answer.value === true);
          };
          send({ type: 'approval', preview });
        }),
        onState: (envelope) => send({ type: 'state', envelope }),
        onDelta: (envelope) => send({ type: 'delta', envelope }),
        onActivity: (envelope) => send({ type: 'activity', envelope })
      };
      const result = await route.requester.generate(message.request, controls);
      send({ type: 'result', result });
      await log({ event: 'attempt-completed', attemptId: message.request.attemptId, content: result.content });
    } catch (error) {
      send({ type: 'error', message: error.message, code: error.code ?? null });
      await log({ event: 'attempt-failed', attemptId: message.request.attemptId, message: error.message });
    }
  });
});
await new Promise((resolve) => server.on('listening', resolve));
await log({ event: 'bridge-listening', port: Number(values['bridge-port']) });
console.log(JSON.stringify({ event: 'contributor-ready', devices: devices.map((row) => row.participantId) }));

const stop = async () => {
  clearInterval(timer);
  void devices;
  await claim();
  server.close();
  await Promise.allSettled([...routes.values()].map(async (route) => (await route).close()));
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

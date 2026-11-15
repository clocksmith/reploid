import { parseArgs } from 'node:util';
import path from 'node:path';
import models from '../shared/config/chat-models.json' with { type: 'json' };
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { readNativeModelConfiguration } from './native-model-config.js';
import { openNativeOwnerControls, nativeOwnerStatus, NO_OWNER_POLICY } from './native-owner/controls.js';
import custodyPolicy from '../apps/poolday/config/chat-files.json' with { type: 'json' };
import fs from 'node:fs/promises';
import { snapshotWorkOrderedParticipation } from '../apps/poolday/host/work-partition-plan.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installedPackageDirectory, nativeShaderCacheIdentity, openNativeShaderCache } from './native-shader-cache.js';
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { openNativeReadinessLog } from './native-readiness-log.js';
import { createReadinessRecorder } from '../packages/reploid/src/measurement/index.js';
import { createChangeOnlyLog } from './native-change-log.js';
import { createPublicWebWorker } from './public-web-worker.js';
import { sha256Hex } from './hashing.js';
import { requireValue } from './native-host-utils.js';
import { summarizeNativePartitionState } from './native-participant-state.js';
import { createNativeRtcAdapter } from './native-rtc-adapter.js';
import { createNativeGpuHost } from './native-gpu-host.js';
import { createNativeParticipant } from './native-participant-runtime.js';
import { createNativeShutdown } from './native-shutdown.js';
import { resolveNativeRoomToken } from './native-room-token.js';

export async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['model', 'model-directory', 'identity-file', 'rtc-module',
    'ws-module', 'gpu-module', 'adapter', 'execution-mode', 'partition-index', 'ordered-config', 'model-config', 'signaling-url', 'room', 'room-token', 'room-token-file', 'origin', 'cache-directory',
    'owner-policy', 'shader-cache-root', 'earning-config', 'readiness-log', 'browser-search-profile'].map(key => [key, { type: 'string' }]).concat([
      ['web-search', { type: 'boolean', default: false }], ['help', { type: 'boolean', default: false }], ['canonical', { type: 'boolean', default: false }], ['share-files', { type: 'boolean', default: false }], ['contribute', { type: 'boolean', default: false }], ['connect-only', { type: 'boolean', default: false }]])) });
  if (values.help) {
    console.log(`Reploid native participant (Node 22.13 or newer)
Usage: reploid-participant --connect-only|--share-files|--contribute
  --model <catalog id> --model-directory <read-only weights directory>
  --identity-file <private state/identity.json>
  --web-search (opt in to public Bing search and page extraction; no browser sign-ins)
  --browser-search-profile <dedicated absolute directory> (Google in owned Chrome; human checks stay manual)
  --rtc-module @roamhq/wrtc --ws-module ws [--gpu-module webgpu]
  [--cache-directory <verified piece cache>] [--signaling-url <ws(s) URL>]
  [--room <namespace>] [--room-token-file <absolute path>] [--origin <allowed origin>]
  [--adapter <catalog adapter id>] (prepare this exact adapter with its base model)
  [--execution-mode partition|whole-model] (default: partition; never falls back;
     whole-model fills an incomplete --model-directory from verified peer pieces)
  [--partition-index 0|1] (explicit eligible stage for a two-stage route)
  [--ordered-config <absolute JSON path>] (explicit stage assignment and ordered limits)
  [--model-config <absolute JSON path>] (pinned operator model and partition request; private rooms only)
  [--canonical] (requires explicit catalog generation and a capable installed runtime)
  [--owner-policy <absolute JSON path>] (owner schedule, memory, rate, power, temperature and foreground limits)
  [--earning-config <absolute JSON path>] (reploid.native-earning/v1: earning service, sign-in and contribution offers; needs --owner-policy)
  [--shader-cache-root <absolute directory>] (sealed Mesa shader cache; default: shader-cache beside the identity file)
  [--readiness-log <absolute JSONL path>] (appends readiness spans and stage admissions for scripts/capacity-utilization.js; needs --contribute)

--room-token-file reads the private room token once at startup from a regular
file owned by this user with mode 0600; one trailing newline is removed.
--room-token <join marker> still works but exposes the token in process
arguments and prints a warning; it cannot be combined with --room-token-file.

File sharing and compute are separate explicit choices; both may be enabled.
Compute requires --gpu-module. Missing assigned pieces use authenticated peers.
SIGINT/SIGTERM stop admission, settle work and release owned resources.
On Linux, --contribute compiles GPU pipelines into a private Mesa shader cache that is
sealed only after a complete stage preparation and reused only for the same runtime,
provider, driver and program; MESA_SHADER_CACHE_DIR must not be set by the caller.
Native GPU uses Metal on macOS and Vulkan elsewhere. Model and route qualification
is separate from backend selection; --help opens no provider.`);
    return;
  }
  requireValue(values.contribute || values['share-files'] || values['connect-only'], 'Choose --contribute, --share-files or --connect-only explicitly');
  requireValue(!values['web-search'] || !values['browser-search-profile'], 'Choose one search service');
  if (values.contribute) requireValue(values['gpu-module'], '--gpu-module is required for compute');
  requireValue(values['readiness-log'] === undefined || values.contribute && path.isAbsolute(values['readiness-log']),
    '--readiness-log requires --contribute and an absolute file path');
  for (const name of ['model', 'model-directory', 'identity-file', 'rtc-module', 'ws-module']) requireValue(values[name], '--' + name + ' is required');
  requireValue(values['execution-mode'] === undefined || ['partition', 'whole-model'].includes(values['execution-mode']), 'Unknown native execution mode');
  requireValue(values['execution-mode'] !== 'whole-model' || !values.canonical && !values['ordered-config'] && !values['readiness-log'],
    'Whole-model execution cannot inherit ordered, canonical or stage-readiness configuration');
  let configuredModels = models;
  if (values['model-config'] !== undefined) {
    requireValue(values.room && values.room !== bootstrap.publicRoomId,
      'Operator model configuration requires an explicit private room; public routes require reviewed catalog/release approval');
    configuredModels = [await readNativeModelConfiguration(values['model-config'], {
      modelId: values.model, modelDirectory: values['model-directory'], models,
    })];
  }
  // Before identity, module or connection side effects; read once.
  const roomToken = await resolveNativeRoomToken(values);
  let logNetwork = () => {}, observeReadiness = () => {};
  const owner = values['owner-policy'] === undefined ? null : await openNativeOwnerControls({ file: values['owner-policy'],
    // An owner decision changes admitted capacity without a partition notification.
    custody: custodyPolicy, onChange: () => { logNetwork(); observeReadiness(); },
    // Doppler's application GPU buffer accounting; null until compute opens a device.
    readGpuBuffers: values.contribute ? async () => (await import('doppler-gpu/partitions')).inspectDeviceMemory() : null });
  let ordered = null;
  if (values['ordered-config']) {
    requireValue(!values.canonical && path.isAbsolute(values['ordered-config']), 'Ordered config requires an absolute file path and ordinary execution');
    ordered = JSON.parse(await fs.readFile(values['ordered-config'], 'utf8'));
    requireValue(ordered && typeof ordered === 'object', 'Ordered config requires an explicit configuration object');
    snapshotWorkOrderedParticipation(ordered, null, configuredModels);
  }
  requireValue(values['partition-index'] === undefined || ['0', '1'].includes(values['partition-index'])
    && !values['ordered-config'] && values['execution-mode'] !== 'whole-model', 'Partition index requires a two-stage partition contributor');
  const identityFile = path.resolve(values['identity-file']);
  let model = configuredModels.find(row => row.id === values.model); requireValue(model, 'Model is absent from the application catalog');
  if (values.adapter) {
    const adapter = model.availableAdapters?.find(entry => entry.id === values.adapter);
    requireValue(adapter && adapter.baseModelIdentity === model.identity, 'Adapter is not authorized for this exact base artifact');
    model = { ...model, adapters: [structuredClone(adapter)] };
  }
  if (values['partition-index'] !== undefined) model = { ...model, partitionContributionIndexes: [Number(values['partition-index'])] };
  const moduleSpecifier = value => {
    requireValue(path.isAbsolute(value) || ['@roamhq/wrtc', 'ws', 'webgpu'].includes(value),
      'Native modules require an operator-selected absolute local path or supported package name');
    return path.isAbsolute(value) ? pathToFileURL(value).href : value;
  };
  requireValue(values['shader-cache-root'] === undefined || values.contribute, '--shader-cache-root requires --contribute');
  // Bound before any native module loads, so MESA_SHADER_CACHE_DIR is set before the Vulkan driver initializes.
  let shaderCache = null;
  if (values.contribute && (process.platform === 'linux' || values['shader-cache-root'] !== undefined)) {
    const gpuModule = values['gpu-module'];
    const { key, identity: cacheIdentity } = await nativeShaderCacheIdentity({
      runtime: { directory: await installedPackageDirectory(fileURLToPath(import.meta.resolve('doppler-gpu/partitions')), 'doppler-gpu'),
        archiveIntegrity: dopplerPin.integrity },
      provider: { module: gpuModule, directory: await installedPackageDirectory(fileURLToPath(import.meta.resolve(moduleSpecifier(gpuModule))),
        path.isAbsolute(gpuModule) ? null : gpuModule) },
      program: { model, policy, stage: Number.isSafeInteger(ordered?.stage?.index) ? ordered.stage.index : null, canonical: values.canonical } });
    shaderCache = await openNativeShaderCache({ root: values['shader-cache-root'] ?? path.join(path.dirname(identityFile), 'shader-cache'),
      key, identity: cacheIdentity, onEvent: event => console.log(JSON.stringify({ event: 'shader-cache', ...event })) });
  }
  let identity;
  try { identity = JSON.parse(await fs.readFile(identityFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error;
    identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    await fs.mkdir(path.dirname(identityFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(identityFile, JSON.stringify(identity), { flag: 'wx', mode: 0o600 }); }
  const importModule = value => { moduleSpecifier(value); return import(path.isAbsolute(value) ? pathToFileURL(value).href : value); };
  const [rtcModule, wsModule] = await Promise.all([importModule(values['rtc-module']), importModule(values['ws-module'])]);
  const rtc = createNativeRtcAdapter(rtcModule.default || rtcModule);
  const Socket = wsModule.default || wsModule.WebSocket;
  class HostWebSocket extends Socket { constructor(url) { super(url, { origin: values.origin || 'http://localhost:8000' }); } }
  const gpuHost = createNativeGpuHost(() => importModule(values['gpu-module']));
  // Optional readiness records (reploid.readiness-span/v1, reploid.stage-admission/v1) for the utilization CLI;
  // identities, times and slot counts only. The session starts here, before any stage is prepared.
  const readinessLog = values['readiness-log'] === undefined ? null : await openNativeReadinessLog({ file: values['readiness-log'],
    onError: error => console.error('Readiness record not written:', error.code || error.message) });
  const readiness = readinessLog && createReadinessRecorder({ participantId: identity.peerId, host: 'node', write: readinessLog.write });
  const closeReadiness = async reason => { readiness?.close(reason); await readinessLog?.close(); };
  // Optional earning: signs this host in, registers its identity as a native device, records the owner policy
  // and claims settled work under service-authored offers (native-earning.js); state lives beside the identity.
  if (values['earning-config']) requireValue(owner, '--earning-config requires --owner-policy');
  const earning = values['earning-config'] ? await import('./native-earning.js').then(async native => native.openNativeEarning({
    settings: await native.readNativeEarningFile(values['earning-config']), identity, ownerAuthorization: { policy: owner.policy, digest: owner.digest },
    storage: native.createNativeEarningStorage(path.join(path.dirname(identityFile), 'earning-state.json')) }))
    .catch(async error => { owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); throw error; }) : null;
  // Status lines only when their content changes, plus a periodic heartbeat (policy.statusHeartbeatMs).
  const statusLog = createChangeOnlyLog({ heartbeatMs: policy.statusHeartbeatMs, write: line => console.log(line) });
  let webWorker = null;
  if (values['browser-search-profile']) webWorker =
    await import('./browser-web-worker.js').then(module => module.openBrowserWebWorker({ profileDirectory: values['browser-search-profile'] }))
      .catch(async error => { owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); throw error; });
  else if (values['web-search']) webWorker = createPublicWebWorker();
  const participant = await createNativeParticipant({ model, modelDirectory: values['model-directory'], identity, rtc,
    WebSocket: HostWebSocket, signalingUrl: values['signaling-url'] || bootstrap.signalingUrl,
    roomId: values.room || bootstrap.publicRoomId, roomToken: roomToken || bootstrap.publicJoinMarker,
    cacheDirectory: values['cache-directory'] || path.join(path.dirname(identityFile), 'model-cache'),
    executionMode: values['execution-mode'] || 'partition',
    onModelFill: (() => {
      // Piece lines at most every 5 s; every other fill event is logged.
      let last = 0;
      return event => {
        if (event.phase === 'piece' && Date.now() - last < 5000) return;
        last = Date.now(); console.log(JSON.stringify({ event: 'model-fill', at: new Date(last).toISOString(), ...event }));
      };
    })(),
    generationJournalFile: path.join(path.dirname(identityFile), 'generation-journal.sqlite'),
    webWorker,
    ordered, canonical: values.canonical ? { epochDirectory: path.join(path.dirname(identityFile), 'canonical-epochs',
      sha256Hex(values.room || bootstrap.publicRoomId)) } : null,
    nativeGpu: () => gpuHost.open(), owner, shaderCache, earning, readiness,
    onCustodyCertificate: certificate => console.log(JSON.stringify({ event: 'custody-certificate', certificate })),
    onChange: state => {
      statusLog('partition-state', { ...summarizeNativePartitionState(state), owner: nativeOwnerStatus(owner) });
      // A prepared stage is offered for before any route admits it.
      if (earning && state.descriptor?.planId) earning.ensureOffer(state.descriptor).catch(error => console.error('Earning offer deferred:', error.code || error.message));
    } })
    .catch(async error => { owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); await webWorker?.close?.(); throw error; });
  logNetwork = () => statusLog('network', { event: 'network', at: new Date().toISOString(), ...participant.getNetworkState(),
    files: participant.getFileState({ includeReceipts: false }), owner: participant.getOwnerState() });
  if (readiness) observeReadiness = () => readiness.observe(participant.getState());
  // Polling also renews the custody certificate before it expires, and observes readiness even while a partition tick waits.
  const timer = setInterval(() => { participant.announceFiles(); logNetwork(); observeReadiness();
    participant.getCustodyCertificate().catch(error => console.error('Custody certificate renewal failed:', error.message)); }, policy.pollMs);
  const shutdown = createNativeShutdown(participant, gpuHost);
  // Readiness ends when shutdown begins and admission closes; admissions settled by shutdown are still recorded.
  const stop = () => { clearInterval(timer); logNetwork = () => {}; observeReadiness = () => {}; readiness?.end('shutdown');
    return shutdown().finally(async () => { owner?.close(); await shaderCache?.close(); await closeReadiness('shutdown'); await webWorker?.close?.(); }); };
  const completion = new Promise((resolve, reject) => {
    const signalStop = () => stop().then(resolve, reject);
    process.once('SIGINT', signalStop); process.once('SIGTERM', signalStop);
  });
  const defaultCacheStatus = values.contribute ? { status: 'not-applicable', platform: process.platform } : null;
  console.log(JSON.stringify({ event: 'native-initialized', participantId: identity.peerId, modelId: model.id,
    owner: owner ? owner.declaration() : NO_OWNER_POLICY,
    shaderCache: shaderCache ? shaderCache.status() : defaultCacheStatus }));
  try {
    await Promise.all([completion, (async () => {
      if (values['share-files']) await participant.shareFiles(true);
      if (values.contribute) await participant.contribute(true);
    })()]);
  } catch (error) {
    try { await stop(); }
    catch (cleanup) { if (cleanup !== error) throw new AggregateError([error, cleanup], 'Native preparation and cleanup failed'); }
    throw error;
  }
}

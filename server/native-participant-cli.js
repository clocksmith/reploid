import { participantOptions, participantHelp } from './native-participant-options.js';
import { createNativeRtcConfigReader } from './native-rtc-config.js';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import path from 'node:path';
import models from '../shared/config/chat-models.json' with { type: 'json' };
import { findCatalogModel } from './native-model-names.js';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { readNativeModelConfiguration, catalogWholeRuntime } from './native-model-config.js';
import { openNativeOwnerControls, nativeOwnerStatus, NO_OWNER_POLICY } from './native-owner/controls.js';
import custodyPolicy from '../apps/poolday/config/chat-files.json' with { type: 'json' };
import fs from 'node:fs/promises';
import { snapshotWorkOrderedParticipation } from '../apps/poolday/host/work-partition-plan.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installedPackageDirectory, nativeShaderCacheIdentity, openNativeShaderCache } from './native-shader-cache.js';
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { createSigningIdentity } from '../shared/vendor/reploid/artifacts/identity.js';
import { openNativeReadinessLog } from './native-readiness-log.js';
import { createReadinessRecorder } from '../shared/vendor/reploid/measurement/index.js';
import { createChangeOnlyLog } from './native-change-log.js';
import { createPublicWebWorker } from './public-web-worker.js';
import { sha256Hex } from './hashing.js';
import { requireValue } from './native-host-utils.js';
import { summarizeNativePartitionState } from './native-participant-state.js';
import { createNativeRtcAdapter } from './native-rtc-adapter.js';
import { createNativeGpuHost } from './native-gpu-host.js';
import { shortcutOrderedParticipation } from './native-ordered-shortcut.js';
import { createNativeParticipant } from './native-participant-runtime.js';
import { createNativeShutdown } from './native-shutdown.js';
import { resolveNativeRoomToken } from './native-room-token.js';
import { openNativeRuntimeSource, assertNativeRuntimeSourceMode } from './native-runtime-source.js';
import { openOwnerPairing } from './circles/owner-pairing.js';
import { openCircleInvites } from './circles/invites.js';
import { createGuestAccess } from './circles/guest-access.js';
import { createOwnerPairingTerminal, ownerPairingDisplayName, ownerPairingPrompt } from './circles/owner-pairing-terminal.js';
import { ownerPairingRoomId, ownerPairingRoomMarker } from '../shared/vendor/reploid/transport/index.js';

/** `quiet` is for a one-shot caller that reports the outcome itself: transport warnings are dropped, errors still print. */
export async function main({ argv, runOnce, quiet = false } = {}) {
  const { values } = parseArgs({ ...(argv === undefined ? {} : { args: argv }), options: participantOptions });
  if (values.help) {
    console.log(participantHelp);
    return;
  }
  requireValue(values.contribute || values['share-files'] || values['connect-only'], 'Choose --contribute, --share-files or --connect-only explicitly');
  requireValue(!values['web-search'] || !values['browser-search-profile'], 'Choose one search service');
  if (values.contribute) requireValue(values['gpu-module'], '--gpu-module is required for compute');
  requireValue(values['readiness-log'] === undefined || values.contribute && path.isAbsolute(values['readiness-log']),
    '--readiness-log requires --contribute and an absolute file path');
  const supplyTo = values['supply-to'];
  if (supplyTo !== undefined) requireValue(values['share-files'], '--supply-to requires file sharing');
  let maxSupplyBytes;
  if (values['supply-limit-gib'] !== undefined) {
    const value = values['supply-limit-gib'];
    maxSupplyBytes = Number(value) * 2 ** 30;
    requireValue(values['share-files'] && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(maxSupplyBytes),
      '--supply-limit-gib requires --share-files and a positive whole GiB allowance');
  }
  for (const name of ['model', 'model-directory', 'identity-file', 'rtc-module', 'ws-module']) requireValue(values[name], '--' + name + ' is required');
  // Signaling refuses any other name with a bare 400, which the client would retry forever.
  requireValue(values.room === undefined || values.room === bootstrap.publicRoomId || ownerPairingRoomId(values.room),
    '--room must start with reploid-swarm- followed by letters, digits, hyphens or underscores, for example reploid-swarm-lab');
  // A model reissued under a new name is still selected by the name it replaced.
  values.model = findCatalogModel(models, values.model)?.id ?? values.model;
  requireValue(values['execution-mode'] === undefined || ['partition', 'whole-model'].includes(values['execution-mode']), 'Unknown native execution mode');
  requireValue(values['execution-mode'] !== 'whole-model' || !values.canonical && !values['ordered-config'] && !values['readiness-log'],
    'Whole-model execution cannot inherit ordered, canonical or stage-readiness configuration');
  if (values['owner-pairing']) requireValue(!runOnce && process.stdin.isTTY && process.stderr.isTTY
    && values.contribute && values['execution-mode'] === 'whole-model' && values.room && values.room !== bootstrap.publicRoomId,
  'Owner pairing requires an interactive terminal and a private whole-model host');
  // Before source-runtime, identity, provider or connection side effects; read once.
  const roomToken = await resolveNativeRoomToken(values);
  const getRtcConfig = values['rtc-config-file'] === undefined ? null : createNativeRtcConfigReader(values['rtc-config-file']);
  if (getRtcConfig) await getRtcConfig();
  let sourceRuntime = null;
  if (values['runtime-source-config'] !== undefined) {
    assertNativeRuntimeSourceMode({ roomId: values.room, publicRoomId: bootstrap.publicRoomId,
      executionMode: values['execution-mode'], canonical: values.canonical, earning: values['earning-config'], model: {} });
    requireValue(values.contribute && !values['share-files'] && !values['cache-directory'] && !values.adapter,
      'Runtime source config requires compute without file sharing, cache directory or adapter selection');
    sourceRuntime = await openNativeRuntimeSource(values['runtime-source-config']);
  }
  let configuredModels = models;
  if (values['model-config'] !== undefined) {
    requireValue(values.room && values.room !== bootstrap.publicRoomId,
      'Operator model configuration requires an explicit private room; public routes require reviewed catalog/release approval');
    configuredModels = [await readNativeModelConfiguration(values['model-config'], {
      modelId: values.model, modelDirectory: values['model-directory'], models,
      ...(sourceRuntime ? { loadRuntime: async () => sourceRuntime.runtime } : {}),
    })];
  }
  if (sourceRuntime) assertNativeRuntimeSourceMode({ roomId: values.room, publicRoomId: bootstrap.publicRoomId,
    model: configuredModels.find(row => row.id === values.model) });
  let logNetwork = () => {}, observeReadiness = () => {};
  const owner = values['owner-policy'] === undefined ? null : await openNativeOwnerControls({ file: values['owner-policy'],
    // An owner decision changes admitted capacity without a partition notification.
    custody: custodyPolicy, onChange: () => { logNetwork(); observeReadiness(); },
    // Doppler's application GPU buffer accounting; null until compute opens a device.
    readGpuBuffers: values.contribute ? async () => (sourceRuntime === null
      ? await import('dopplerx/partitions') : sourceRuntime.runtime).inspectDeviceMemory() : null });
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
  // An ordered plan needs a full host configuration; the stage shortcut and the weightless requester supply the documented one.
  const shortcut = ordered === null && !values.canonical && values['execution-mode'] !== 'whole-model'
    && (values['partition-index'] !== undefined || values['connect-only'])
    ? shortcutOrderedParticipation({ model, models: configuredModels,
      stageIndex: values['partition-index'] === undefined ? null : Number(values['partition-index']) }) : null;
  if (shortcut) ordered = shortcut;
  else if (values['partition-index'] !== undefined) model = { ...model, partitionContributionIndexes: [Number(values['partition-index'])] };
  // A catalog entry's whole-model gather policy remembers verified pieces beside this provider's identity.
  if (values['model-config'] === undefined && model.wholeRuntime !== undefined) {
    model = { ...model, wholeRuntime: catalogWholeRuntime(model, path.dirname(identityFile)) };
  }
  if (sourceRuntime) assertNativeRuntimeSourceMode({ roomId: values.room, publicRoomId: bootstrap.publicRoomId, model });
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
      runtime: sourceRuntime ? { directory: sourceRuntime.directory, sourceIdentity: sourceRuntime.receipt }
        : { directory: await installedPackageDirectory(fileURLToPath(import.meta.resolve('dopplerx/partitions')), 'dopplerx'),
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
  const gpuHost = createNativeGpuHost(() => importModule(values['gpu-module']),
    sourceRuntime ? { loadTooling: async () => sourceRuntime.tooling } : {});
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
  const statusLog = createChangeOnlyLog({ heartbeatMs: policy.statusHeartbeatMs, write: line => { if (!runOnce) console.log(line); } });
  let webWorker = null;
  if (values['browser-search-profile']) webWorker =
    await import('./browser-web-worker.js').then(module => module.openBrowserWebWorker({ profileDirectory: values['browser-search-profile'] }))
      .catch(async error => { owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); throw error; });
  else if (values['web-search']) webWorker = createPublicWebWorker();
  let ownerPairing, guestInvites, guestAccess;
  const displayName = ownerPairingDisplayName(hostname());
  try {
    if (values['owner-pairing']) {
      ownerPairing = await openOwnerPairing({ file: path.join(path.dirname(identityFile), 'owner-pairing.sqlite'),
        hostParticipantId: identity.peerId, onRequest: request => console.error(ownerPairingPrompt(request)) });
      // A paired host can also invite guests; each invite admits one device within its limits.
      guestInvites = await openCircleInvites({ file: path.join(path.dirname(identityFile), 'circle-invites.sqlite'),
        hostPeerId: identity.peerId, hostLabel: displayName || identity.peerId });
      guestAccess = createGuestAccess({ invites: guestInvites, hostParticipantId: identity.peerId,
        onJoin: () => console.error('A guest opened your link.') });
    }
  } catch (error) {
    ownerPairing?.close(); guestInvites?.close();
    owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); await webWorker?.close?.(); throw error;
  }
  const participant = await createNativeParticipant({ model, modelDirectory: values['model-directory'], identity, rtc,
    WebSocket: HostWebSocket, signalingUrl: values['signaling-url'] || bootstrap.signalingUrl,
    roomId: values.room || bootstrap.publicRoomId,
    // Only a nondefault pairing room gets the routing marker; any other room keeps the public marker as before.
    roomToken: roomToken || (values['owner-pairing'] && values.room && values.room !== bootstrap.publicRoomId && ownerPairingRoomId(values.room)
      ? ownerPairingRoomMarker(values.room) : bootstrap.publicJoinMarker),
    maxSupplyBytes, supplyTo, cacheDirectory: sourceRuntime ? null : values['cache-directory'] || path.join(path.dirname(identityFile), 'model-cache'),
    sourceRuntime, getRtcConfig,
    ...(runOnce ? { logger: { log() {}, debug() {}, info() {}, warn: quiet ? () => {} : console.warn, error: console.error } } : {}),
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
    webWorker, ownerPairing, guestAccess,
    ordered, canonical: values.canonical ? { epochDirectory: path.join(path.dirname(identityFile), 'canonical-epochs',
      sha256Hex(values.room || bootstrap.publicRoomId)) } : null,
    nativeGpu: () => gpuHost.open(), owner, shaderCache, earning, readiness,
    onCustodyCertificate: certificate => { if (!runOnce) console.log(JSON.stringify({ event: 'custody-certificate', certificate })); },
    onChange: state => {
      statusLog('partition-state', { ...summarizeNativePartitionState(state), owner: nativeOwnerStatus(owner) });
      // A prepared stage is offered for before any route admits it.
      if (earning && state.descriptor?.planId) earning.ensureOffer(state.descriptor).catch(error => console.error('Earning offer deferred:', error.code || error.message));
    } })
    .catch(async error => { ownerPairing?.close(); guestAccess?.close(); guestInvites?.close(); owner?.close(); await shaderCache?.close(); await closeReadiness('startup-failed'); await webWorker?.close?.(); throw error; });
  const pairingTerminal = ownerPairing && createInterface({ input: process.stdin, terminal: false });
  if (pairingTerminal) {
    const commands = createOwnerPairingTerminal({ pairing: ownerPairing, invites: guestInvites, room: values.room, name: displayName });
    console.error('Type pair to connect your phone, or invite to share this computer with one guest.');
    pairingTerminal.on('line', line => commands.handleLine(line));
  }
  logNetwork = () => statusLog('network', { event: 'network', at: new Date().toISOString(), ...participant.getNetworkState(),
    files: participant.getFileState({ includeReceipts: false }), owner: participant.getOwnerState() });
  if (readiness) observeReadiness = () => readiness.observe(participant.getState());
  // Polling also renews the custody certificate before it expires, and observes readiness even while a partition tick waits.
  const timer = setInterval(() => { participant.announceFiles(); logNetwork(); observeReadiness();
    participant.getCustodyCertificate().catch(error => console.error('Custody certificate renewal failed:', error.message)); }, policy.pollMs);
  const shutdown = createNativeShutdown(participant, gpuHost);
  // Readiness ends when shutdown begins and admission closes; admissions settled by shutdown are still recorded.
  const stop = () => { clearInterval(timer); logNetwork = () => {}; observeReadiness = () => {}; readiness?.end('shutdown');
    pairingTerminal?.close(); ownerPairing?.close(); guestAccess?.close(); guestInvites?.close();
    return shutdown().finally(async () => { owner?.close(); await shaderCache?.close(); await closeReadiness('shutdown'); await webWorker?.close?.(); }); };
  if (runOnce) {
    const controller = new AbortController();
    const cancel = () => controller.abort(new Error('Request cancelled'));
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try { return await runOnce(participant, model, controller.signal); }
    finally {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
      await stop();
    }
  }
  const completion = new Promise((resolve, reject) => {
    const signalStop = () => stop().then(resolve, reject);
    process.once('SIGINT', signalStop); process.once('SIGTERM', signalStop);
  });
  const defaultCacheStatus = values.contribute ? { status: 'not-applicable', platform: process.platform } : null;
  console.log(JSON.stringify({ event: 'native-initialized', participantId: identity.peerId, modelId: model.id,
    ...(sourceRuntime ? { runtimeSource: sourceRuntime.receipt, workerGather: sourceRuntime.gather } : {}),
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

import { bindFleetStageAdmission } from './fleet/execution-admission.js';
import { createHostRequesterRule } from './circles/guest-access.js';
import { randomUUID } from 'node:crypto';
import { createNativeWholeModel } from './native-whole-model.js';
import { snapshotWorkOrderedParticipation, bindWorkOrderedParticipation } from '../apps/poolday/host/work-partition-plan.js';
import { shortcutOrderedParticipation } from './native-ordered-shortcut.js';
import { createPeerIdFromPublicJwk } from '../shared/vendor/reploid/artifacts/identity.js';
import { createAttemptEvidenceSigner } from '../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { resolveConfig, requireResolvedConfig } from '../shared/vendor/reploid/config/index.js';
import profile from '../shared/config/reploid-library.json' with { type: 'json' };
import { createSwarmTransport, createRoomIntroductionAdmission } from '../shared/vendor/reploid/transport/index.js';
import { openNativeGenerationJournal } from './native-generation-journal.js';
import { createModelAdapterResolver } from '../shared/vendor/reploid/adapters/model-adapter.js';
import { attachTargetScoring, createAutomaticPartitions, createPeerGenerationMesh, createPartitionNetwork, requestTargetScore } from '../shared/vendor/reploid/mesh/index.js';
import { attachMeshOperations, dispatchMeshOperation, requestMeshOperation } from '../shared/vendor/reploid/mesh/operation-envelope.js';
import { createWholeModelRequester } from './whole-model-requester.js';
import { signGenerationTerminal } from '../shared/vendor/reploid/artifacts/generation-terminal.js';
import { openNativeCanonicalEpochs } from './native-canonical-epochs.js';
import { createWebAccessNetwork } from '../shared/vendor/reploid/mesh/web-access-network.js';
import { createNativeModelFiles } from './native-model-files.js';
import { snapshotNativeSourceFiles } from './native-source-files.js';
import { createCustodyKeyCertifier } from '../shared/vendor/reploid/artifacts/custody-certificate.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import path from 'node:path';
import { NO_OWNER_POLICY } from './native-owner/controls.js';
import { requireValue, events } from './native-host-utils.js';
import { acceptToolResult, expectedConstraintIdentity } from '../shared/infrastructure/tool-call-constraint.js';
import { openNativePartition } from './native-partition.js';
import { assertNativeRuntimeSourceMode } from './native-runtime-source.js';

/** `owner` is the optional owner gate from openNativeOwnerControls. It defers or reduces
 * new contribution, stage attempts and piece supply; it never cancels admitted work.
 * The persistent identity certifies the per-process custody key at startup and on
 * renewal; `onCustodyCertificate` observes each certificate (public, no secrets).
 * `earning` (self/host/earning/contribution.js over an explicitly configured client)
 * claims this host's settled stage shares and supplied deliveries and submits the
 * evidence of deliveries it acquired; it needs the owner policy and is off by default.
 * Claim failures are reported to the logger and never stop contribution.
 * `readiness` (createReadinessRecorder from reploid/measurement, off by default) observes every
 * partition state and each prepared resident's admissions; the caller owns and ends it. */
export async function createNativeParticipant({ model, modelDirectory, identity, rtc, WebSocket,
  signalingUrl, roomId, roomToken, nativeGpu, cacheDirectory, maxCacheBytes, maxSupplyBytes, supplyTo = undefined, sourceFilePaths = undefined, canonical = null, ordered = null, onFileChange = () => {}, onChange = () => {}, logger = console,
  owner: ownerGate = null, onCustodyCertificate = () => {}, earning = null, shaderCache = null, readiness = null, executionMode = 'partition', webWorker = null,
  generationJournalFile = null, executionAdmission = null, ownerPairing = null, guestAccess = null, onModelFill = () => {}, createWholeModel = createNativeWholeModel,
  onPartitionReceiveTiming, onSettlementRecords = null, localStageWitness = null, privateCustodyPrefill = null, resolvePartitionSource = null, sourceRuntime = null, rankProviders = null, getRtcConfig = null,
  requesterModels = null }) {
  requireValue(getRtcConfig === null || typeof getRtcConfig === 'function', 'RTC configuration provider must be a function');
  if (localStageWitness) requireValue(roomId && roomId !== bootstrap.publicRoomId && roomToken && ordered && !canonical && typeof localStageWitness.wrap === 'function',
    'Token parity witnesses require a private ordered stage');
  if (privateCustodyPrefill) requireValue(roomId && roomId !== bootstrap.publicRoomId && roomToken && cacheDirectory
    && typeof privateCustodyPrefill.supplierId === 'string' && privateCustodyPrefill.supplierId.length > 0
    && typeof privateCustodyPrefill.authorizeSupplier === 'function' && typeof privateCustodyPrefill.reserveDownload === 'function',
  'Stage prefill requires a private room, cache and explicit supplier and download policies');
  if (sourceRuntime !== null) assertNativeRuntimeSourceMode({ roomId, publicRoomId: bootstrap.publicRoomId,
    executionMode, canonical, earning, cacheDirectory, resolvePartitionSource, model });
  requireValue(['partition', 'whole-model'].includes(executionMode), 'Unknown native execution mode');
  const wholeMode = executionMode === 'whole-model';
  requireValue(!guestAccess || ownerPairing, 'Guest invites require owner pairing on this host');
  requireValue(!ownerPairing || wholeMode && roomId && roomId !== bootstrap.publicRoomId && ownerPairing.hostParticipantId === identity?.peerId,
    'Owner pairing requires a private whole-model host bound to this desktop identity');
  requireValue(supplyTo === undefined || Array.isArray(supplyTo) && supplyTo.length > 0
    && supplyTo.every(id => typeof id === 'string' && /^peer:[a-f0-9]{24}$/.test(id)),
  'File supply recipients must be signing identities (peer: followed by 24 lowercase hex digits)');
  const supplyRecipients = supplyTo && new Set(supplyTo);
  requireValue(executionAdmission === null || ['whole', 'partition', 'partitionReceipt', 'receipt'].every(key => typeof executionAdmission[key] === 'function'),
    'Execution admission requires whole-model, partition and receipt ports');
  requireValue(!wholeMode || canonical === null && ordered === null && readiness === null,
    'Whole-model execution cannot inherit ordered, canonical or stage-readiness configuration');
  requireValue(earning === null || ownerGate && typeof earning.observe === 'function', 'Native earning requires the owner policy and an earning contribution port');
  requireValue(!wholeMode || !earning || typeof earning.prepareWholeModel === 'function' && typeof earning.recordWholeModelReceipt === 'function',
    'Whole-model earning requires admission and receipt persistence');
  requireValue(readiness === null || typeof readiness.observe === 'function' && typeof readiness.watchResident === 'function',
    'Native readiness recording requires a readiness recorder');
  if (ordered === null && !wholeMode && !canonical && model) {
    ordered = shortcutOrderedParticipation({ model, models: [model], stageIndex: null });
  }
  if (ordered !== null) model = structuredClone(model);
  ordered = snapshotWorkOrderedParticipation(ordered, canonical, [model]);
  requireValue(identity?.privateJwk && await createPeerIdFromPublicJwk(identity.publicJwk) === identity.peerId,
    'Native participant requires its own valid signing identity');
  const evidenceSigner = createAttemptEvidenceSigner({ identity });
  requireValue(typeof rtc?.RTCPeerConnection === 'function' && typeof WebSocket === 'function', 'Native WebRTC and WebSocket required');
  const approvedSourceFilePaths = snapshotNativeSourceFiles(sourceFilePaths);
  requireValue(model && modelDirectory && typeof nativeGpu === 'function', 'Explicit native model, directory and GPU provider required');
  let canonicalRuntime = null, epochs = null;
  if (canonical !== null) {
    requireValue(canonical && typeof canonical.epochDirectory === 'string' && model.canonicalGeneration,
      'Canonical native participation requires explicit durable epochs and declared model generation');
    canonicalRuntime = await import('dopplerx/partitions');
    for (const name of ['canonicalGenerationIdentity', 'metadataDigest', 'tokenDigest', 'validateResidentAttemptIdentity',
      'residentAttemptDigest', 'residentPublicationDecisionDigest', 'validateExecutionPublication', 'validateAdmissionPublication']) {
      requireValue(typeof canonicalRuntime[name] === 'function', 'Installed Doppler lacks canonical capability: ' + name);
    }
  }
  const endpoint = new URL(signalingUrl);
  endpoint.searchParams.set('scope', roomId === bootstrap.publicRoomId ? 'public' : 'private');
  endpoint.searchParams.set('roomId', roomId);
  const config = resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: true, executeJobs: wholeMode, maxInboundJobs: 1, roomId },
    webrtc: { signalingUrl: endpoint.href, broadcastRoomId: roomId, transportOrder: ['webrtc'] }
  } });
  const resolvedConfig = requireResolvedConfig(config);
  const eventBus = events(), bridge = events(), utils = { logger, generateId: () => randomUUID() };
  const admission = roomId === bootstrap.publicRoomId ? null : createRoomIntroductionAdmission({ roomId, token: roomToken });
  const generationJournal = wholeMode && generationJournalFile ? await openNativeGenerationJournal({ file: generationJournalFile,
    maxResults: resolvedConfig.mesh.maxRetainedJobs, maxResultBytes: resolvedConfig.webrtc.maxMessageBytes }) : null;
  let transport, partitions, files, webNetwork, wholeRequester, closePromise, closed = false, gpuPromise;
  const networks = new Set();
  const earningWrites = new Set();
  let wholeEarningReady = !earning;
  const wholeVariants = () => [[], ...(whole?.getState().adapterIdentities || []).map(value => [value])]
    .map(adapterIdentities => ({ modelId: model.id, modelIdentity: model.identity, executionMode: 'whole-model', adapterIdentities }));
  // A whole-model contributor completes its model directory from authorized peers before loading.
  const whole = wholeMode ? createWholeModel({ model, modelDirectory, nativeGpu, owner: ownerGate,
    fill: cacheDirectory ? ({ signal }) => files.fillWholeModel(model, { signal, onProgress: onModelFill }) : null,
    resolveAdapter: createModelAdapterResolver({ models: [model], ...(cacheDirectory ? { acquire: (artifact, controls) => files.acquireAdapter(artifact, controls) } : {}) }),
    onChange: state => { onChange(state); mesh.refreshAdvertisement(); } }) : null;
  // The requester's identity as proven on this exact connection (getVerified is empty once its certificates or
  // attempt change). The mesh proved it before handing over the request; a fresh proof at every admission
  // step would only add round trips between dispatch and the first token.
  const provenPeer = async peer => mesh.getVerifiedPeerIdentity(peer) ?? await mesh.verifyPeerIdentity(peer);
  // With owner pairing, this host serves its paired owner and guests holding a live invite (see guest-access.js).
  const allowedOwner = createHostRequesterRule({ ownerPairing, guestAccess, verifyPeer: provenPeer,
    isIdle: () => whole?.getExecutionState?.().phase === 'idle' });

  const mesh = createPeerGenerationMesh({ config, ports: {
    generationJournal,
    settleGeneration: whole ? async () => {
      // The resident returns ready only after generation-state reset succeeds.
      if (!whole.getState().ready) await whole.stop();
      return true;
    } : undefined,
    instanceId: 'node:' + identity.peerId, modelConfig: wholeMode ? model : null, utils, eventBus, events: bridge,
    ...(typeof rankProviders === 'function' ? { rankProviders } : {}),
    getExecutionState: () => whole ? { ...whole.getExecutionState(), ...(!wholeEarningReady ? { phase: 'idle' } : {}) } : { phase: 'idle' },
    // The earning path settles version 2 receipts only, so an earning host advertises no settings.
    getGenerationSettingsCapability: () => earning ? null : whole?.getGenerationSettingsCapability?.() ?? null,
    // As a requester: the constraint a provider must sign for these settings, from the same engine it compiles with.
    expectedConstraintIdentity: settings => expectedConstraintIdentity(settings),
    // ...and its answer must be one that constraint admits, checked before the receipt is countersigned.
    acceptGenerationResult: (response, settings) => acceptToolResult(response, settings),
    identity: { ensure: async () => identity, save: async () => {}, sync: async () => {},
      rotate: async () => { throw new Error('Stop the native participant before rotating its identity'); } },
    // `mesh.admit` asks about a request before its prompt is sent: this host answers from its own
    // readiness and, with a credit ledger, from the reservation's commitment. Credit admission proper
    // binds the prompt's digest, so it still runs on `mesh.execute`.
    admitsBeforeDisclosure: true,
    // With a credit ledger this provider signs the settlement records of a charged request (mesh/operation-envelope.js),
    // naming the account it is paid into.
    ...(typeof executionAdmission?.settlementAccount === 'function' ? { settlementAccount: () => executionAdmission.settlementAccount() } : {}),
    // This provider's own copy of a charged request's signed records, each time it signs or receives one (its host keeps them).
    ...(typeof onSettlementRecords === 'function' ? { onSettlementRecords } : {}),
    authorize: async request => !closed && (request.action === 'mesh.connect'
      || request.action === 'mesh.admit' && whole?.getState().ready === true && wholeEarningReady
        && await allowedOwner(request)
        // With a credit ledger, the reservation is checked here too, against the request's commitment.
        && (!executionAdmission || typeof executionAdmission.preadmit === 'function' && await executionAdmission.preadmit({ request: request.request,
          consumer: await provenPeer(request.peerId) }) === true)
      || request.action === 'mesh.execute' && whole?.getState().ready === true && wholeEarningReady
        && await allowedOwner(request, 'execute')
        && (!executionAdmission || await executionAdmission.whole({ request: request.request,
          consumer: await provenPeer(request.peerId) }))
      || request.action === 'mesh.dispatch' && await wholeRequester?.authorize(request) === true),
    generate: async (messages, onUpdate, controls) => {
      requireValue(!closed && whole, 'Native whole-model execution was not enabled');
      if (earning) await earning.prepareWholeModel({ requestId: controls.requestId, consumer: controls.consumer,
        model: { modelId: model.id, modelIdentity: model.identity, executionMode: 'whole-model', adapterIdentities: controls.adapterIdentities || [] },
        ...(controls.settings === undefined ? {} : { settings: controls.settings }) });
      controls.signal.throwIfAborted();
      return whole.generate(messages, onUpdate, controls);
    },
    onGenerationTerminal: async terminal => {
      if (!executionAdmission) return;
      const write = executionAdmission.terminal(terminal); earningWrites.add(write);
      try { await write; }
      catch (error) { logger.warn('Fleet terminal evidence deferred', error?.code || error?.message); }
      finally { earningWrites.delete(write); }
    },
    onReceipt: async receipt => {
      try { guestAccess?.settle({ participantId: receipt?.consumer, requestId: receipt?.requestId, outputTokens: Number.isSafeInteger(receipt?.outputTokens) ? receipt.outputTokens : 0 }); }
      catch (error) { logger.warn('Guest settlement deferred', error?.message); }
      if (!earning?.recordWholeModelReceipt && !executionAdmission) return;
      const write = Promise.all([earning?.recordWholeModelReceipt(receipt), executionAdmission?.receipt(receipt)]); earningWrites.add(write);
      try { await write; observeEarning(); }
      catch (error) { logger.warn('Earning receipt deferred', error?.code || error?.message); }
      finally { earningWrites.delete(write); }
    },
    createTransport: () => transport = createSwarmTransport({ config, Utils: utils, EventBus: eventBus,
      WebSocket, RTCPeerConnection: rtc.RTCPeerConnection, RTCSessionDescription: rtc.RTCSessionDescription,
      RTCIceCandidate: rtc.RTCIceCandidate, ...(getRtcConfig ? { getRtcConfig } : {}),
      getSessionId: () => identity.peerId, getRoomCredentials: () => ({ roomId, token: roomToken }),
      introductions: { getIdentity: () => identity, ...(admission ? { createAdmission: admission.create } : {}),
        authorize: async request => !closed && request.roomId === roomId && request.action !== 'forward'
          && (!admission || (!request.contact && !request.from) || await admission.verify(request.contact || request.from)) }
    })
  } });
  // A requester asked for no particular model watches every catalog model, so it can use whichever is served.
  if (!wholeMode && !canonical) wholeRequester = createWholeModelRequester({ mesh, models: requesterModels ?? [model] });
  // Claims read this host's own records only; they never change admission or settlement.
  const observeEarning = () => {
    if (!earning) return;
    earning.observe({ admissions: partitions?.getState().reservations?.records ?? [], deliveries: files?.getDeliveryEvidence() ?? [],
      ...(whole ? { wholeModels: wholeVariants() } : {}) })
      .catch(error => logger.warn('Earning claims deferred', error?.code || error?.message));
  };
  const settledOwners = new Set();
  const closeOwner = async owner => {
    if (!owner || settledOwners.has(owner)) return;
    await owner.close(); settledOwners.add(owner);
  };
  // Contribution or file supply waiting for owner admission owns nothing yet; stopping only ends the wait.
  const ownerWaits = { contribute: null, share: null };
  // Resolves false when stop or close ended the wait, like stopping an unfinished preparation.
  const ownerAdmission = async kind => {
    const controller = new AbortController(); ownerWaits[kind]?.abort(new Error('Superseded owner admission wait'));
    ownerWaits[kind] = controller;
    try { await ownerGate.waitForAdmission({ kind: kind === 'share' ? 'file supply' : 'contribution', signal: controller.signal }); }
    catch (error) { if (controller.signal.aborted) return false; throw error; }
    finally { if (ownerWaits[kind] === controller) ownerWaits[kind] = null; }
    return !closed;
  };
  const endOwnerWait = (kind, reason) => ownerWaits[kind]?.abort(new Error(reason));
  const close = () => closePromise ||= (async () => {
    closed = true;
    endOwnerWait('contribute', 'Native participant closed'); endOwnerWait('share', 'Native participant closed');
    const results = await Promise.allSettled([webNetwork, whole, partitions, ...networks]
      .map(owner => Promise.resolve().then(() => closeOwner(owner))));
    // Sources and the mesh outlive resident cancellation/opening settlement.
    for (const owner of [files, mesh]) {
      results.push(...await Promise.allSettled([Promise.resolve().then(() => closeOwner(owner))]));
    }
    results.push(...await Promise.allSettled([...earningWrites]));
    if (settledOwners.has(mesh)) results.push(...await Promise.allSettled([Promise.resolve().then(() => generationJournal?.close())]));
    // Resident cleanup still needs its epoch journal on explicit retry. A failed
    // transport close does not revoke that ownership or clear its durable debt.
    if (!partitions || settledOwners.has(partitions)) {
      results.push(...await Promise.allSettled([Promise.resolve().then(() => closeOwner(epochs))]));
    }
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Native contribution did not settle cleanly');
  })().catch(error => { closePromise = null; throw error; });
  try {
    if (generationJournal) {
      for (const priorBinding of await generationJournal.unfinished()) {
        if (priorBinding?.provider !== identity.peerId) continue;
        const terminal = await signGenerationTerminal(priorBinding, 'failed', identity);
        await generationJournal.finish(priorBinding, {
          type: 'reploid:generation-error',
          payload: { requestId: priorBinding.requestId, error: 'Provider restarted after unfinished execution', terminal }
        });
        if (executionAdmission) {
          await executionAdmission.terminal(terminal).catch(error => logger.warn('Fleet terminal recovery deferred', error?.code || error?.message));
        }
      }
    }
    if (canonical) epochs = await openNativeCanonicalEpochs({ directory: canonical.epochDirectory, participantId: identity.peerId, meshId: roomId });
    await mesh.connect();
    ownerPairing?.attach({ transport, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity });
    guestAccess?.attach({ transport, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity });
    // Only the consumer of an answer this host produced can ask it to score a target against that answer.
    if (whole) attachTargetScoring({ transport, identity, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity,
      score: request => whole.scoreTarget(request) });
    // Mesh operations besides generation (mesh/operation-envelope.js) on the resident whole model: authorized against
    // this provider's own offer, credit-admitted like generation, then run on the same device lane.
    if (whole) attachMeshOperations({ transport, identity, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity,
      offer: () => ({ participantId: identity.peerId, protection: 'plaintext', route: 'remote', modelIdentity: whole.getState().ready ? whole.getState().modelIdentity : null,
        supportedOperations: whole.supportedOperations() }),
      ...(executionAdmission ? { admit: input => executionAdmission.operation(input) } : {}),
      dispatch: (envelope, signal) => dispatchMeshOperation(whole, envelope, { signal }) });
    webNetwork = createWebAccessNetwork({ transport, worker: webWorker, enabled: () => !closed && webWorker !== null,
      verifyPeer: (peer, signal) => mesh.verifyPeerIdentity(peer, signal) });
    if (cacheDirectory) {
      files = await createNativeModelFiles({ transport, modelDirectory, cacheDirectory, maxCacheBytes, maxSupplyBytes, sourceFilePaths: approvedSourceFilePaths, onChange: onFileChange, owner: ownerGate,
        authorizeRequester: supplyRecipients ? async (peer, signal) => {
          const participantId = mesh.getVerifiedPeerIdentity(peer) ?? await mesh.verifyPeerIdentity(peer, signal);
          return supplyRecipients.has(participantId);
        } : undefined,
        ...(privateCustodyPrefill ? { authorizePeer: async (peer, signal) => (await mesh.verifyPeerIdentity(peer, signal)) === privateCustodyPrefill.supplierId,
          authorizeSupplier: privateCustodyPrefill.authorizeSupplier,
          reserveDownload: privateCustodyPrefill.reserveDownload, modelOrigins: { schema: 'reploid.native-model-origins/v1', origins: {} },
          originFetch: async () => { throw new Error('External origin disabled for private stage prefill'); } } : {}),
        certifyCustodyKey: createCustodyKeyCertifier({ identity, onIssue: onCustodyCertificate }).certify });
      await files.custodyCertificate();
    }
    if (!wholeMode) partitions = createAutomaticPartitions({ onReceiveTiming: onPartitionReceiveTiming, identity, meshId: roomId, models: [model], ...bindWorkOrderedParticipation(ordered, identity.peerId, ordered ? transport.getPeerId() : null, policy),
      canonical: epochs ? { runtime: canonicalRuntime, participantEpoch: epochs.participantEpoch, coordinatorEpoch: epochs.coordinatorEpoch } : null,
      peers: () => transport.getConnectedPeers().map(peer => ({ ...peer, localTransportId: transport.getPeerId() })),
      createNetwork(options) {
        const network = createPartitionNetwork({ ...options, transport,
          verifyPeer: async (peerId, signal) => {
            try { return await mesh.verifyPeerIdentity(peerId, signal); }
            catch (error) { logger.warn('Native participant identity verification failed', peerId, error.message); throw error; }
          } });
        networks.add(network); return network;
      },
      loadProgram: async (selected, index, controls) => {
        const program = await openNativePartition({ model: selected, index, modelDirectory, resolveSource: resolvePartitionSource, sourceRuntime,
          releaseDirectory: cacheDirectory && path.join(path.dirname(cacheDirectory), 'release-checkpoints'),
          nativeGpu: request => gpuPromise ||= nativeGpu(request).catch(error => { gpuPromise = null; throw error; }), files, ...controls, evidenceSigner, shaderCache,
          onEvidence: executionAdmission ? bundle => executionAdmission.partitionReceipt(bundle) : null,
          ...(epochs ? { canonical: { ...controls.canonical, epochs } } : {}),
          ...(ownerGate ? { gpuBufferBytes: ownerGate.gpuBufferBytes(selected.partitionRuntime?.maxGpuBufferBytes?.[index] ?? policy.maxGpuBufferBytes) } : {}) });
        let prepared = localStageWitness ? { ...program, resident: localStageWitness.wrap(program.resident) } : program;
        if (ownerGate) prepared = { ...prepared, resident: ownerGate.gateResident(prepared.resident) };
        if (executionAdmission) {
          prepared = { ...prepared, resident: bindFleetStageAdmission(prepared.resident, executionAdmission, index) };
        }
        readiness?.watchResident(prepared.resident);
        return prepared;
      }, onChange: earning || readiness ? state => { onChange(state); readiness?.observe(state); if (earning) observeEarning(); } : onChange
    });
    return Object.freeze({ identity: identity.peerId, roomId, executionClass: roomId === bootstrap.publicRoomId ? 'public-pool' : 'private-pool',
      getState: () => {
        if (whole) { const state = whole.getState(); return { ...state, ready: state.ready && wholeEarningReady }; }
        const state = partitions.getState();
        return wholeRequester ? { ...state, models: [...wholeRequester.getModels(), ...(state.models || [])] } : state;
      },
      generate(request, controls) {
        requireValue(!closed && !canonical && partitions, 'Native ordinary requester is unavailable');
        requireValue(typeof controls?.requestApproval === 'function', 'Explicit requester disclosure authorization required');
        return request.model.partition ? partitions.generate(request, controls) : wholeRequester.generate(request, controls);
      },
      /** Ask the provider that produced `receipt` to sign the target's score against that exact answer. */
      async scoreTarget({ providerParticipantId, receipt, messages, target, signal }) {
        requireValue(!closed && transport, 'Native requester is unavailable');
        const providerPeer = (transport.getConnectedPeers?.() || []).map(peer => peer.id)
          .find(peerId => mesh.getVerifiedPeerIdentity(peerId) === providerParticipantId);
        requireValue(providerPeer, 'The scoring provider is not connected');
        return requestTargetScore({ transport, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity,
          providerPeer, providerParticipantId, receipt, messages, target, ...(signal ? { signal } : {}) });
      },
      /** Send an authorized mesh operation envelope to its granted recipient; returns its output and signed receipt. */
      async sendMeshOperation(envelope, { signal } = {}) {
        requireValue(!closed && transport, 'Native requester is unavailable');
        const recipient = envelope.recipientGrant.recipient;
        const providerPeer = (transport.getConnectedPeers?.() || []).map(peer => peer.id)
          .find(peerId => mesh.getVerifiedPeerIdentity(peerId) === recipient);
        requireValue(providerPeer, 'The granted recipient is not connected');
        return requestMeshOperation({ transport, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity,
          providerPeer, envelope, ...(signal ? { signal } : {}) });
      },
      recoverGeneration(request, reference, controls) {
        requireValue(!closed && wholeRequester, 'Native whole-model recovery unavailable');
        return wholeRequester.recover(request, reference, controls);
      },
      /** Proves the identity of each ready provider of this model, so a ranking by identity can apply to it.
       * A provider that fails the proof is skipped here and keeps the default order. */
      async verifyProviders(signal) {
        requireValue(!closed && wholeRequester, 'Native whole-model requester unavailable');
        const proven = [];
        for (const peer of mesh.getSwarmSnapshot().peers || []) {
          if (peer.role !== 'provider' || peer.readiness !== 'ready' || peer.modelIdentity !== model.identity) continue;
          try { const proof = await mesh.verifyPeerIdentity(peer.peerId, signal); if (proof) proven.push(proof); }
          catch { signal?.throwIfAborted(); }
        }
        return proven;
      },
      contribute: ownerGate ? async approved => {
        if (approved === true && !await ownerAdmission('contribute')) return;
        if (!whole) return partitions.contribute(model.id, approved);
        if (earning && approved === true) {
          wholeEarningReady = false;
          await earning.ensureOffer(wholeVariants()[0]);
          await whole.contribute(approved);
          for (const variant of wholeVariants()) await earning.ensureOffer(variant);
          requireValue(!closed, 'Native contribution closed during offer acceptance');
          wholeEarningReady = true; mesh.refreshAdvertisement();
          return whole.getState();
        }
        return whole.contribute(approved);
      } : approved => whole ? whole.contribute(approved) : partitions.contribute(model.id, approved),
      stop: ownerGate ? () => { endOwnerWait('contribute', 'Native contribution stopped'); return whole ? whole.stop() : partitions.stop(); } : () => whole ? whole.stop() : partitions.stop(), close,
      ...(privateCustodyPrefill ? { preparePrivateStageSource: controls => files.preparePartitionSource(model, controls) } : {}),
      getNetworkState: () => mesh.getSwarmSnapshot(), getFileState: options => files?.getState(options) || null,
      shareFiles: ownerGate ? async approved => {
        requireValue(files, 'Native cache directory required');
        if (approved === true && !await ownerAdmission('share')) return null;
        return files.share(model, approved);
      } : approved => { requireValue(files, 'Native cache directory required'); return files.share(model, approved); },
      stopSharing: ownerGate ? () => { endOwnerWait('share', 'Native file contribution stopped'); return files?.stopSupply(); } : () => files?.stopSupply(),
      announceFiles: () => { files?.announce(); if (whole) mesh.refreshAdvertisement(); observeEarning(); }, getOwnerState: () => ownerGate ? ownerGate.summary() : NO_OWNER_POLICY,
      getCustodyCertificate: async () => files ? files.custodyCertificate() : null });
  } catch (error) { try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Native startup and cleanup failed'); } throw error; }
}

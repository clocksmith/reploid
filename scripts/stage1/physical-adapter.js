/**
 * Stage 1 host adapter for real machines. Every remote action goes through the injected command transport to the
 * harness-owned host agent. A solo control uses the host's full copy, which stays on the host. For the split each stage
 * process opens only its stage directory and reads pieces through the stage loader, which serves its assigned ranges
 * and nothing else; while stage processes run, each full copy's directory is locked (mode 000) and restored afterwards.
 * An optional earning machine serves whole-model answers so the requester's account earns before it spends. This code
 * has been exercised only against mocked hosts.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createPeerIdFromPublicJwk, createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { openAgentSession, parseControlReply } from './command-transport.js';
import { describeMemoryPressure, withinMemoryLimit } from './host-control.js';
import { harnessDigest } from './host-agent.js';
import { stage1Decoding } from './expectations.js';
import { startPhysicalCoordinator } from './physical-coordinator.js';
import { collectAcceptances, collectSettlementReplay, dropRecord, ledgerTrace, openReservationCount, reservationsOnThread, runGatedCancel,
  runGatedDrop, until, verifySplitTokens } from './split-evidence.js';

/** The earn phase stops once the account holds enough for the split, the stopped answer and the drop, or after this many. */
const EARN_MAX_REQUESTS = 8;

const stopWith = (code, detail = '') => Object.assign(Error(detail ? `${code}: ${detail}` : code), { code });
const matchesStage = (inventory, stage) => inventory.outsideStageRanges === 0 && inventory.outsideStageBytes === 0
  && inventory.rangeCount === stage.rangeCount && inventory.bytes === stage.bytes && inventory.rangesDigest === stage.rangesDigest;

export function createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture, fixtureBytes,
  transport, redactor = null, startCoordinator = startPhysicalCoordinator, localDigest = harnessDigest, verifyStageDirectories = false }) {
  if (typeof transport?.run !== 'function' || typeof transport?.open !== 'function') throw Error('A command transport is required');
  const { limits } = config, requesterTarget = { ...config.requester, label: 'requester' }, hosts = config.hosts;
  const earnerTarget = config.earner ? { ...config.earner, label: 'earner' } : null;
  const earnModel = earnerTarget ? catalog.find(row => row.id === earnerTarget.modelId) : null;
  const allRanges = stageRanges.flat();
  const splitThread = 'stage1-split-' + randomUUID(), cancelThread = 'stage1-cancel-' + randomUUID(), dropThread = 'stage1-drop-' + randomUUID();
  const locks = new Map();
  let buyer = null;
  const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const sessions = new Map(), soloSessions = new Set(), peers = {};
  const serviceRows = new Map(), restoring = new Map(), restoreFailed = new Set();
  let coordinator = null, expectedDigest = null;

  const agentCommand = (target, mode) => [target.node, `${target.releaseRoot}/scripts/stage1/host-agent.js`, mode];
  async function control(target, op, body = {}, { timeoutMs = limits.phaseMs, signal } = {}) {
    const { code, stdout } = await transport.run(target, agentCommand(target, '--control'),
      { input: JSON.stringify({ op, body }), timeoutMs, signal });
    const answer = parseControlReply(stdout);
    if (!answer) throw stopWith('host-agent-no-reply', `${target.label} ${op} exit ${code}`);
    if (answer.error) throw Object.assign(Error(answer.error), { code: answer.code });
    return answer.result;
  }
  async function openSession(target) {
    const session = openAgentSession(transport.open(target, agentCommand(target, '--session')), { defaultTimeoutMs: limits.phaseMs });
    session.target = target;
    await session.hello;
    expectedDigest ??= await localDigest();
    if (session.harnessDigest !== expectedDigest) {
      await stopSession(session);
      throw stopWith('host-code-mismatch', target.label);
    }
    return session;
  }
  /** Ends one agent and confirms it is gone. Only this exact PID and start time is ever signaled. */
  async function stopSession(session, { force = false } = {}) {
    const { target } = session;
    // A hard stop has a fixed budget that must still leave room to restore a service.
    const timeoutMs = force ? Math.max(1000, Math.floor((limits.hardStopMs - 2 * limits.serviceRestoreMs) / 3)) : 20000;
    if (!force && !session.exited) await session.call('close', {}, { timeoutMs: 20000 }).catch(() => {});
    session.end();
    if (!force && !session.exited) await Promise.race([new Promise(resolve => session.child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (session.pid === null) { session.child.kill?.('SIGKILL'); return session.exited; }
    let running = true;
    try { ({ running } = await control(target, 'process-state', { pid: session.pid, startId: session.startId }, { timeoutMs })); }
    catch { running = true; }
    if (running) {
      try {
        await control(target, 'kill', { pid: session.pid, startId: session.startId }, { timeoutMs });
        ({ running } = await control(target, 'process-state', { pid: session.pid, startId: session.startId }, { timeoutMs }));
      } catch { running = true; }
    }
    session.child.kill?.('SIGKILL');
    return !running;
  }

  const hostRoots = host => [...new Set([host.stageDirectory, ...(host.fullCopyDirectory ? [host.fullCopyDirectory] : []),
    ...host.weightRoots.model, ...host.weightRoots.cache, ...host.weightRoots.temporary])];
  const locked = host => locks.get(host.label)?.locked === true && locks.get(host.label).restored !== true;
  const scan = (host, index, scope, signal) => control(host, 'scan-weights', { roots: scope === 'stage-directory' ? [host.stageDirectory] : hostRoots(host),
    allRanges, stageRanges: stageRanges[index], fullCopyDirectory: host.fullCopyDirectory, scope,
    skipDirectories: locked(host) ? [host.fullCopyDirectory] : [] }, { signal });

  /**
   * Builds a host's stage directory from its full copy (`build`, never over an existing one), or checks an existing
   * one's build record against the pin (`verify`; `hash` also re-reads every range). Building reads the whole stage,
   * so it runs before a run, outside the window. Counts and digests come back, never a path.
   */
  async function stageDirectory(label, { action, hash = false, timeoutMs = limits.phaseMs, signal } = {}) {
    const index = hosts.findIndex(row => row.label === label), host = hosts[index];
    if (!host) throw stopWith('stage-directory-refused', 'unknown host');
    if (action === 'build' && !host.fullCopyDirectory) throw stopWith('stage-directory-refused', `${label} has no full copy to build from`);
    return control(host, 'stage-directory', { action, hash, source: action === 'build' ? host.fullCopyDirectory : null, directory: host.stageDirectory,
      stageIndex: index, stageRanges: stageRanges[index], otherRanges: stageRanges.filter((_, other) => other !== index).flat(),
      rangesDigest: expectations.stages[index].rangesDigest, inventorySha256: expectations.inventorySha256 }, { timeoutMs, signal });
  }

  /** Each stage directory holds exactly its stage. Read by the same search as preflight, before and after the split. */
  async function stageDirectories(signal) {
    const scans = await Promise.all(hosts.map((host, index) => scan(host, index, 'stage-directory', signal)));
    scans.forEach((row, index) => {
      if (!matchesStage(row.inventory, expectations.stages[index])) throw stopWith('host-stage-check-refused', `${hosts[index].label} stage directory does not hold exactly its stage`);
    });
    return Object.fromEntries(hosts.map((host, index) => [host.label, scans[index].inventory]));
  }
  /**
   * Everywhere each host keeps weights. The declared full copy is allowed and recorded; another stage's range anywhere
   * else stops the split. A locked full copy is not entered and is recorded as such.
   */
  async function hostWeights(signal) {
    const scans = await Promise.all(hosts.map((host, index) => scan(host, index, 'host-weight-directories', signal)));
    scans.forEach((row, index) => {
      if (row.outsideElsewhere > 0) throw stopWith('host-stage-check-refused', `${hosts[index].label} holds ${row.outsideElsewhere} other-stage ranges outside its full copy`);
    });
    return Object.fromEntries(hosts.map((host, index) => [host.label, { scope: scans[index].inventory.scope, scannedRanges: scans[index].inventory.scannedRanges,
      heldRanges: scans[index].inventory.rangeCount, outsideStageRanges: scans[index].inventory.outsideStageRanges,
      outsideInFullCopy: scans[index].outsideInFullCopy, outsideElsewhere: scans[index].outsideElsewhere,
      fullCopy: !host.fullCopyDirectory ? 'none' : locked(host) ? 'locked-not-entered' : 'searched' }]));
  }

  /** Recorded before the lock is applied, so a half-applied lock is still restored. */
  async function lockFullCopies(signal) {
    for (const host of hosts) {
      if (!host.fullCopyDirectory) continue;
      const { mode } = await control(host, 'lock-directory', { directory: host.fullCopyDirectory, action: 'mode' }, { signal });
      locks.set(host.label, { host: host.label, locked: true, restored: false, mode });
      await control(host, 'lock-directory', { directory: host.fullCopyDirectory, action: 'lock' }, { signal });
    }
  }
  async function unlockFullCopies() {
    for (const host of hosts) {
      const row = locks.get(host.label);
      if (!row?.locked || row.restored) continue;
      try {
        await control(host, 'lock-directory', { directory: host.fullCopyDirectory, action: 'unlock', mode: row.mode }, { timeoutMs: limits.serviceRestoreMs });
        row.restored = true;
      } catch { row.restored = false; }
    }
    return [...locks.values()].map(({ mode: _mode, ...row }) => ({ ...row }));
  }

  /** Idempotent: a solo control's finally and a hard stop may both ask for the same restore. */
  function restoreService(host) {
    const row = serviceRows.get(host.label);
    if (!row?.stopped || row.restored) return Promise.resolve();
    if (restoring.has(host.label)) return restoring.get(host.label);
    const { manager, unit } = host.standingService;
    const task = (async () => {
      try {
        await control(host, 'service', { manager, unit, action: 'start' }, { timeoutMs: limits.serviceRestoreMs });
        const deadline = Date.now() + limits.serviceRestoreMs;
        await until(async () => (await control(host, 'service', { manager, unit, action: 'is-active' },
          { timeoutMs: Math.max(1000, deadline - Date.now()) })).state === 'active',
        { timeoutMs: limits.serviceRestoreMs, label: 'the service to become active', pollMs: 100 });
        Object.assign(row, { restored: true, verifiedActive: true });
        restoreFailed.delete(host.label);
      } catch {
        row.failedAttempts = (row.failedAttempts ?? 0) + 1;
        restoreFailed.add(host.label);
      } finally { restoring.delete(host.label); }
    })();
    restoring.set(host.label, task);
    return task;
  }
  const restoreAll = () => Promise.all(hosts.map(restoreService));

  /** Returns a reason when the service blocks this control; otherwise it is stopped and recorded for restore. */
  async function stopServiceForSolo(host, signal) {
    const service = host.standingService;
    if (!service) return null;
    const { state } = await control(host, 'service', { manager: service.manager, unit: service.unit, action: 'is-active' }, { signal, timeoutMs: limits.serviceRestoreMs });
    if (state !== 'active') return null;
    if (service.approveStopForSolo !== true) return 'standing-service-not-approved';
    // Recorded first: if the stop half-succeeds, the restore still runs.
    serviceRows.set(host.label, { host: host.label, stopped: true, restored: false, verifiedActive: false });
    await control(host, 'service', { manager: service.manager, unit: service.unit, action: 'stop' }, { timeoutMs: limits.serviceRestoreMs });
    const after = await control(host, 'service', { manager: service.manager, unit: service.unit, action: 'is-active' }, { timeoutMs: limits.serviceRestoreMs });
    if (after.state === 'active') throw stopWith('service-did-not-stop', host.label);
    return null;
  }

  const soloSettings = () => ({ modelId: model.id, modelIdentity: model.identity, quantization: model.quantization,
    messagesDigest: expectations.workload.messagesDigest, maxOutputTokens: fixture.maxOutputTokens, decoding: stage1Decoding(model.generation) });
  const session = key => sessions.get(key);
  const finalHost = () => session(hosts.at(-1).label);

  async function openParticipants(signal) {
    const shared = { signalingUrl: coordinator.signalingUrl, roomId: coordinator.roomId, roomToken: coordinator.roomToken,
      serviceUrl: coordinator.serviceUrl, serviceCa: coordinator.serviceCa, maxOutputTokens: fixture.maxOutputTokens, gateHoldMs: limits.phaseMs };
    const assigned = {};
    for (const [index, host] of hosts.entries()) {
      const opened = await session(host.label).call('open', { ...shared, stageIndex: index, modelDirectory: host.stageDirectory, stateDirectory: host.stateDirectory,
        assignedRanges: stageRanges[index],
        fixtureBase64: Buffer.from(fixtureBytes).toString('base64'), fixtureSha256,
        witness: { threadId: splitThread, requesterId: peers.requester.participantId, stageParticipants: hosts.map(row => peers[row.label].participantId) } });
      assigned[host.label] = opened.assignedLayers;
    }
    await session('requester').call('open', { ...shared, stageIndex: null, modelDirectory: requesterTarget.modelDirectory, stateDirectory: requesterTarget.stateDirectory });
    await until(async () => (await session('requester').call('state')).ready, { timeoutMs: limits.phaseMs, label: 'a ready split route', signal, pollMs: 250 });
    return assigned;
  }
  const settled = (id, signal) => until(() => coordinator.credits.request(id)?.state === 'settled',
    { timeoutMs: Math.min(limits.phaseMs, config.credit.maxRequestMs), label: 'settlement', signal, pollMs: 250 });
  const balance = id => coordinator.credits.snapshot().accounts.find(row => row.id === id)?.balance ?? null;
  const computerOf = id => coordinator.credits.enrollment.byPeer.get(id)?.computerId ?? id;
  const stageSessions = () => hosts.map(host => session(host.label));
  const replay = (attemptId, options = {}) => collectSettlementReplay({ requester: session('requester'), stages: stageSessions(), attemptId,
    policy: coordinator.credits.policy, computerOf, ...options });
  /**
   * Pieces of the requested model the requester holds: every pinned range found by hash under its model directory and
   * weight roots, the same search a stage host gets. The claim is zero such pieces. Everything else under those roots,
   * such as an earning model on the same machine, is recorded as `otherModelBytes`. Counts only, never a private path.
   */
  async function requesterWeights(signal) {
    const roots = [...new Set([requesterTarget.modelDirectory, ...requesterTarget.weightRoots.model,
      ...requesterTarget.weightRoots.cache, ...requesterTarget.weightRoots.temporary])];
    const [underRoots, scanned] = await Promise.all([
      control(requesterTarget, 'directory-bytes', { directories: roots }, { signal }),
      control(requesterTarget, 'scan-weights', { roots, allRanges, stageRanges: [], fullCopyDirectory: null, scope: 'requester-weight-directories' }, { signal })]);
    const held = scanned.inventory;
    return { weightBytes: held.bytes, otherModelBytes: Math.max(0, underRoots.weightBytes - held.bytes), fileCount: underRoots.fileCount,
      scope: 'requester-weight-directories', scannedRoots: roots.length,
      heldRanges: { rangeCount: held.rangeCount, bytes: held.bytes, scannedRanges: held.scannedRanges } };
  }

  const adapter = {
    describe: () => ({ runtimeClass: 'physical', adapter: 'physical-hosts' }),
    stageDirectory,
    evidence: () => ({ serviceRestores: [...serviceRows.values()].map(row => ({ ...row })) }),
    processIds: () => [...sessions.values(), ...soloSessions].map(row => row.pid),
    async guard() {
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      for (const host of hosts) {
        if (!host.memoryPressure) continue;
        let reading;
        try { reading = await control(host, 'memory-pressure', {}, { timeoutMs: 20000 }); }
        catch { throw stopWith('memory-pressure-unreadable', host.label); }
        if (!withinMemoryLimit(reading, host.memoryPressure)) throw stopWith('memory-pressure', `${host.label} ${describeMemoryPressure(reading)}`);
      }
    },
    async preflight({ signal }) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      for (const target of [requesterTarget, ...hosts, ...(earnerTarget ? [earnerTarget] : [])]) {
        const opened = await openSession(target);
        sessions.set(target.label, opened);
        const proved = await opened.call('identity', { file: target.identityFile });
        if (proved.participantId !== target.participantId || await createPeerIdFromPublicJwk(proved.publicJwk) !== target.participantId) {
          throw stopWith('host-identity-mismatch', target.label);
        }
        peers[target.label] = proved;
      }
      // The buyer lives on the operator machine: a separate account the earning machine serves.
      buyer = earnerTarget ? await createSigningIdentity({ algorithm: 'Ed25519' }) : null;
      coordinator = await startCoordinator({ config, peers, directory, expectations, model, fixture, onSecret: value => redactor?.add(value),
        ...(buyer ? { buyer: { participantId: buyer.peerId, publicJwk: buyer.publicJwk }, earnModel: { id: earnModel.id, identity: earnModel.identity } } : {}) });
      // Optional: each stage directory's build record names exactly the pinned stage. Nothing is rebuilt here.
      const records = verifyStageDirectories ? await Promise.all(hosts.map(host => stageDirectory(host.label, { action: 'verify', signal })
        .catch(error => { throw stopWith('host-stage-check-refused', `${host.label} stage directory record: ${error.code ?? error.message}`); }))) : null;
      const inventories = await Promise.all(hosts.map((host, index) => scan(host, index, 'stage-directory', signal)));
      inventories.forEach((row, index) => {
        if (!matchesStage(row.inventory, expectations.stages[index])) throw stopWith('host-stage-check-refused', `${hosts[index].label} stage directory does not hold exactly its stage`);
      });
      return { requester: { participantId: requesterTarget.participantId, computerId: 'computer-requester', machine: requesterTarget.machineId,
        preflight: await requesterWeights(signal) },
        hosts: hosts.map((host, index) => ({ label: host.label, stageIndex: index, participantId: host.participantId, machine: host.machineId, computerId: `computer-${host.label}`,
          assignedLayers: null, inventory: { preflight: inventories[index].inventory }, ...(records ? { stageDirectoryRecord: records[index] } : {}) })) };
    },
    async soloControl(label, { signal }) {
      const host = hosts.find(row => row.label === label), settings = soloSettings();
      if (!host.fullCopyDirectory) return { outcome: 'inconclusive', reason: 'no-full-copy-configured', settings };
      let solo = null;
      try {
        const blocked = await stopServiceForSolo(host, signal);
        if (blocked) return { outcome: 'inconclusive', reason: blocked, settings };
        solo = await openSession(host);
        soloSessions.add(solo);
        const running = solo;
        const abort = () => { running.call('abort-solo', {}, { timeoutMs: 5000 }).catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        try {
          return await running.call('solo', { directory: host.fullCopyDirectory, messages: fixture.messages, maxOutputTokens: fixture.maxOutputTokens,
            settings, requiredBytes: expectations.minimumSoloLoadBytes, pressure: host.memoryPressure, timeoutMs: limits.phaseMs });
        } finally { signal.removeEventListener('abort', abort); }
      } finally {
        // The GPU is free before the service that wants it comes back.
        if (solo) { await stopSession(solo, { force: signal.aborted }).catch(() => {}); soloSessions.delete(solo); }
        await restoreService(host);
      }
    },
    async splitAnswer({ signal }) {
      const inventoryBeforeSplit = await stageDirectories(signal), weightsBefore = await hostWeights(signal);
      await lockFullCopies(signal);
      const assignedLayers = await openParticipants(signal);
      const accountBefore = balance('computer-requester');
      const answer = await session('requester').call('generate', { messages: fixture.messages, threadId: splitThread });
      await settled(answer.reservationId, signal);
      const [input, output] = await Promise.all(hosts.map(host => session(host.label).call('witness')));
      const { tokenIds } = await finalHost().call('trace', { attemptId: answer.attemptId });
      const evidence = verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId: coordinator.roomId, threadId: splitThread,
        requesterId: peers.requester.participantId });
      const loaded = Object.fromEntries(await Promise.all(hosts.map(async host => [host.label, await session(host.label).call('loaded')])));
      const inventoryAfterSplit = await stageDirectories(signal), weightsAfter = await hostWeights(signal);
      const binding = coordinator.credits.request(answer.reservationId).binding;
      return { assignedLayers, loaded,
        hostWeights: Object.fromEntries(hosts.map(host => [host.label, { beforeSplit: weightsBefore[host.label], afterSplit: weightsAfter[host.label] }])),
        workload: { modelId: answer.route.modelId, modelIdentity: answer.route.modelIdentity, quantization: answer.route.quantization,
          planIdentity: answer.route.planId, messagesDigest: binding.inputDigest, promptDigest: output.promptDigest,
          promptCount: output.promptCount, maxOutputTokens: output.generation.maxTokens, decoding: stage1Decoding(output.generation) },
        split: { attemptId: answer.attemptId, text: answer.text, ...evidence, settlement: await ledgerTrace(coordinator.credits, answer.reservationId),
          account: { computerId: 'computer-requester', before: accountBefore, after: balance('computer-requester') },
          settlementReplay: await replay(answer.attemptId) },
        requesterAfterSplit: await requesterWeights(signal), inventoryBeforeSplit, inventoryAfterSplit };
    },
    async cancelAnswer({ signal }) {
      const answer = await runGatedCancel({ requester: session('requester'), finalStage: finalHost(), messages: fixture.messages,
        threadId: cancelThread, outputCount: expectations.reference.outputIds.length, signal, timeoutMs: limits.phaseMs });
      if (!answer.reservationId) throw stopWith('cancel-without-reservation');
      await settled(answer.reservationId, signal);
      const activity = await Promise.all(hosts.map(host => until(async () => {
        const state = await session(host.label).call('activity');
        return state.active === 0 && state.unsettledOwners === 0 ? state : null;
      }, { timeoutMs: 30000, label: 'the stage to release the stopped attempt', signal, pollMs: 250 }).catch(() => session(host.label).call('activity'))));
      return { attemptId: answer.attemptId, stoppedBeforeCompletion: answer.completed === false && answer.stopped === true,
        residentsActive: activity.map(state => state.active + state.unsettledOwners),
        settlement: await ledgerTrace(coordinator.credits, answer.reservationId), accountAfter: balance('computer-requester'),
        settlementReplay: await replay(answer.attemptId) };
    },
    /**
     * Forced provider drop: host-a's stage process is killed by its exact PID and start time once the requester holds
     * part of the answer. The ledger's own expiry then releases the hold one release window after the request deadline.
     */
    async dropAnswer({ signal }) {
      const accountBefore = balance('computer-requester'), requester = session('requester'), killedHost = hosts[0], killed = session(killedHost.label);
      const drop = await runGatedDrop({ requester, killedStage: killed, messages: fixture.messages, threadId: dropThread,
        outputCount: expectations.reference.outputIds.length, signal, timeoutMs: limits.phaseMs,
        async beforeKill(attemptId) {
          // Both stages are alive and the attempt identity is known: each signs its acceptance now, and the stage about
          // to be killed hands over the step receipts it holds.
          const { terms } = await requester.call('settlement-records', { attemptId });
          return { acceptances: await collectAcceptances(stageSessions(), terms), killedRecords: await killed.call('settlement-records', { attemptId }) };
        },
        async kill() {
          const exact = { pid: killed.pid, startId: killed.startId };
          const result = await control(killedHost, 'kill', exact, { signal });
          await until(async () => !(await control(killedHost, 'process-state', exact, { signal })).running,
            { timeoutMs: 20000, label: 'the killed stage process to be gone', signal, pollMs: 250 });
          return { host: killedHost.label, how: 'exact-process-kill', signalled: result.killed === true, confirmedGone: true };
        } });
      const own = await requester.call('settlement-records', { attemptId: drop.attemptId });
      const reservationId = own.terms?.reservationId ?? `service:${peers.requester.participantId}:${drop.attemptId}`;
      const { maxRequestMs, partitionUnclaimedReleaseMs } = coordinator.credits.policy;
      // snapshot() runs the ledger's expiry; nothing here releases the hold itself.
      await until(() => { coordinator.credits.snapshot(); return coordinator.credits.request(reservationId)?.state === 'settled'; },
        { timeoutMs: maxRequestMs + partitionUnclaimedReleaseMs + 15000, label: 'the dropped hold to expire on the ledger', signal, pollMs: 250 });
      const settlementReplay = await replay(drop.attemptId, { acceptancesSigned: 'during-attempt',
        prefetched: { acceptances: drop.collected.acceptances, stageRecords: [drop.collected.killedRecords, null] } });
      return dropRecord({ drop, own: await requester.call('settlement-records', { attemptId: drop.attemptId }), settlementReplay,
        accountBefore, accountAfter: balance('computer-requester'), settlement: await ledgerTrace(coordinator.credits, reservationId),
        ledgerReservations: await reservationsOnThread(coordinator.ledgerFile, dropThread) });
    },
    async cleanup() {
      const stopped = await Promise.all([...sessions.values()].map(row => stopSession(row).catch(() => false)));
      const fullCopyLocks = await unlockFullCopies();
      await restoreAll();
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      // A run that failed before the ledger opened has no credits to account for.
      if (!coordinator) return { processesExited: stopped.every(Boolean), heldCredits: 0, openReservations: 0, fullCopyLocks };
      const heldCredits = coordinator.credits.snapshot().accounts.reduce((sum, account) => sum + account.held, 0);
      const result = { processesExited: stopped.every(Boolean), heldCredits, openReservations: await openReservationCount(coordinator.ledgerFile), fullCopyLocks };
      await coordinator.close();
      coordinator = null;
      return result;
    },
    async hardStop() {
      const all = [...sessions.values(), ...soloSessions];
      const stopped = await Promise.all(all.map(row => stopSession(row, { force: true }).catch(() => false)));
      await unlockFullCopies();
      await restoreAll();
      await coordinator?.close();
      coordinator = null;
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      if (!stopped.every(Boolean)) throw stopWith('host-process-not-confirmed-stopped');
      if ([...locks.values()].some(row => row.locked && !row.restored)) throw stopWith('full-copy-lock-not-restored');
    }
  };
  if (earnerTarget) adapter.earnCredits = earnCredits;
  return Object.freeze(adapter);

  /**
   * The earning machine serves whole-model answers to the coordinator-side buyer through the same fleet requester flow
   * as the local adapter: the earner signs each measured receipt, the buyer countersigns it, and the ledger settles it to
   * the requester's account, which the earner is enrolled under. Nothing is seeded.
   */
  async function earnCredits({ signal }) {
    const earner = session('earner');
    const opened = await earner.call('open-whole', { modelId: earnModel.id, modelDirectory: earnerTarget.modelDirectory }, { timeoutMs: limits.phaseMs });
    const accountBefore = balance('computer-requester'), tokens = fixture.maxOutputTokens, settlements = [];
    // Enough for the split and the stopped answer at their ceilings; the drop costs nothing.
    const target = 2 * tokens * expectations.creditsPerOutputToken;
    const buyerClient = createFleetClient({ url: coordinator.serviceUrl, identity: buyer, ...(coordinator.serviceCa ? { ca: coordinator.serviceCa } : {}) });
    const requested = { id: earnModel.id, identity: earnModel.identity };
    for (let index = 0; index < EARN_MAX_REQUESTS && balance('computer-requester') < target; index++) {
      const requestId = `stage1-earn-${index}-${randomUUID()}`;
      const participant = { async generate(request, controls) {
        if (await controls.requestApproval({ requestId, recipientIdentity: peers.earner.participantId, input: { messages: request.messages } }) !== true) {
          throw Error('Earn request was not approved');
        }
        // The earner's generation is cancelled with the phase: a stop or timeout here aborts it there, and the host
        // also stops it on its own after the phase budget, so a lost reply cannot leave it running.
        const stop = () => { earner.call('abort-whole', { requestId }, { timeoutMs: 5000 }).catch(() => {}); };
        controls.signal.addEventListener('abort', stop, { once: true });
        let served;
        try {
          controls.signal.throwIfAborted();
          served = await earner.call('serve-whole', { requestId, consumer: buyer.peerId, messages: request.messages, settings: request.settings,
            timeoutMs: limits.phaseMs }, { timeoutMs: limits.phaseMs + 5000 });
        } catch (error) { stop(); throw error; } finally { controls.signal.removeEventListener('abort', stop); }
        return { content: served.content, execution: { receipt: await countersignReceipt(served.receipt, buyer) } };
      } };
      const requester = createFleetRequester({ participant, identity: buyer, credits: buyerClient, maxOutputTokens: tokens });
      const result = await requester.generate({ model: requested, messages: [{ role: 'user', content: `Earn request ${index}.` }],
        settings: { maxOutputTokens: tokens } }, { signal, requestApproval: async () => true });
      await settled(result.serviceCredit.id, signal);
      settlements.push(await ledgerTrace(coordinator.credits, result.serviceCredit.id));
    }
    return { mode: 'whole-model', modelId: earnModel.id, runtime: opened.runtime,
      earner: { participantId: peers.earner.participantId, computerId: 'computer-requester', machine: earnerTarget.machineId },
      buyerComputerId: 'computer-buyer', accountBefore, settlements, accountBalanceAfter: balance('computer-requester') };
  }
}

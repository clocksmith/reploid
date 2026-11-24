/**
 * Stage 1 host adapter for real machines. Every remote action goes through the injected command transport to the
 * harness-owned host agent. A solo control uses a separate full copy; the split will not start while any host holds
 * more than its own stage. This code has been exercised only against mocked hosts.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createPeerIdFromPublicJwk } from '../../packages/reploid/src/artifacts/identity.js';
import { openAgentSession, parseControlReply } from './command-transport.js';
import { harnessDigest } from './host-agent.js';
import { stage1Decoding } from './expectations.js';
import { startPhysicalCoordinator } from './physical-coordinator.js';
import { ledgerTrace, openReservationCount, runGatedCancel, until, verifySplitTokens } from './split-evidence.js';

const stopWith = (code, detail = '') => Object.assign(Error(detail ? `${code}: ${detail}` : code), { code });
const matchesStage = (inventory, stage) => inventory.outsideStageRanges === 0 && inventory.outsideStageBytes === 0
  && inventory.rangeCount === stage.rangeCount && inventory.bytes === stage.bytes && inventory.rangesDigest === stage.rangesDigest;

export function createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture, fixtureBytes,
  approveDeleteFullCopy = false, transport, redactor = null, startCoordinator = startPhysicalCoordinator, localDigest = harnessDigest }) {
  if (typeof transport?.run !== 'function' || typeof transport?.open !== 'function') throw Error('A command transport is required');
  const { limits } = config, requesterTarget = { ...config.requester, label: 'requester' }, hosts = config.hosts;
  const allRanges = stageRanges.flat();
  const splitThread = 'stage1-split-' + randomUUID(), cancelThread = 'stage1-cancel-' + randomUUID();
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
  const scan = (host, index, scope, signal) => control(host, 'scan-weights', { roots: scope === 'stage-directory' ? [host.stageDirectory] : hostRoots(host),
    allRanges, stageRanges: stageRanges[index], fullCopyDirectory: host.fullCopyDirectory, scope }, { signal });

  /** Every host must hold exactly its stage. A full copy goes only with explicit approval, after every host was checked. */
  async function enforceStageOnly(signal) {
    const scans = await Promise.all(hosts.map((host, index) => scan(host, index, 'host-weight-directories', signal)));
    scans.forEach((row, index) => {
      if (row.outsideElsewhere > 0) throw stopWith('host-stage-check-refused', `${hosts[index].label} holds ${row.outsideElsewhere} other-stage ranges outside its full copy`);
    });
    const copies = hosts.map((_, index) => index).filter(index => scans[index].outsideInFullCopy > 0);
    if (copies.length && !approveDeleteFullCopy) {
      throw stopWith('full-copy-present-delete-not-approved', copies.map(index => hosts[index].label).join(', '));
    }
    for (const index of copies) {
      const host = hosts[index];
      await control(host, 'delete-full-copy', { directory: host.fullCopyDirectory, expectedIdentity: model.identity,
        allowedExtraFiles: model.source.files.map(file => file.path), protectedDirectories: [host.stageDirectory, host.stateDirectory, host.releaseRoot] }, { signal });
      scans[index] = await scan(host, index, 'host-weight-directories', signal);
    }
    scans.forEach((row, index) => {
      if (!matchesStage(row.inventory, expectations.stages[index])) throw stopWith('host-stage-check-refused', `${hosts[index].label} does not hold exactly its stage`);
    });
    return Object.fromEntries(hosts.map((host, index) => [host.label, scans[index].inventory]));
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
  const requesterWeights = () => control(requesterTarget, 'directory-bytes', { directories: [requesterTarget.modelDirectory] });

  return Object.freeze({
    describe: () => ({ runtimeClass: 'physical', adapter: 'physical-hosts' }),
    evidence: () => ({ serviceRestores: [...serviceRows.values()].map(row => ({ ...row })) }),
    processIds: () => [...sessions.values(), ...soloSessions].map(row => row.pid),
    async guard() {
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      for (const host of hosts) {
        if (!host.memoryPressure) continue;
        let reading;
        try { reading = await control(host, 'memory-pressure', {}, { timeoutMs: 20000 }); }
        catch { throw stopWith('memory-pressure-unreadable', host.label); }
        if (!(reading.avg10 <= host.memoryPressure.maxAvg10)) throw stopWith('memory-pressure', `${host.label} avg10 ${reading.avg10}`);
      }
    },
    async preflight({ signal }) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      for (const target of [requesterTarget, ...hosts]) {
        const opened = await openSession(target);
        sessions.set(target.label, opened);
        const proved = await opened.call('identity', { file: target.identityFile });
        if (proved.participantId !== target.participantId || await createPeerIdFromPublicJwk(proved.publicJwk) !== target.participantId) {
          throw stopWith('host-identity-mismatch', target.label);
        }
        peers[target.label] = proved;
      }
      coordinator = await startCoordinator({ config, peers, directory, expectations, model, fixture, onSecret: value => redactor?.add(value) });
      const inventories = await Promise.all(hosts.map((host, index) => scan(host, index, 'stage-directory', signal)));
      inventories.forEach((row, index) => {
        if (!matchesStage(row.inventory, expectations.stages[index])) throw stopWith('host-stage-check-refused', `${hosts[index].label} stage directory does not hold exactly its stage`);
      });
      return { requester: { participantId: requesterTarget.participantId, machine: requesterTarget.machineId, preflight: await requesterWeights() },
        hosts: hosts.map((host, index) => ({ label: host.label, stageIndex: index, participantId: host.participantId, machine: host.machineId, computerId: `computer-${host.label}`,
          assignedLayers: null, inventory: { preflight: inventories[index].inventory } })) };
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
      const inventoryBeforeSplit = await enforceStageOnly(signal);
      const assignedLayers = await openParticipants(signal);
      const answer = await session('requester').call('generate', { messages: fixture.messages, threadId: splitThread });
      await settled(answer.reservationId, signal);
      const [input, output] = await Promise.all(hosts.map(host => session(host.label).call('witness')));
      const { tokenIds } = await finalHost().call('trace', { attemptId: answer.attemptId });
      const evidence = verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId: coordinator.roomId, threadId: splitThread,
        requesterId: peers.requester.participantId });
      const after = await Promise.all(hosts.map((host, index) => scan(host, index, 'host-weight-directories', signal)));
      const binding = coordinator.credits.request(answer.reservationId).binding;
      return { assignedLayers,
        workload: { modelId: answer.route.modelId, modelIdentity: answer.route.modelIdentity, quantization: answer.route.quantization,
          planIdentity: answer.route.planId, messagesDigest: binding.inputDigest, promptDigest: output.promptDigest,
          promptCount: output.promptCount, maxOutputTokens: output.generation.maxTokens, decoding: stage1Decoding(output.generation) },
        split: { attemptId: answer.attemptId, text: answer.text, ...evidence, settlement: await ledgerTrace(coordinator.credits, answer.reservationId) },
        requesterAfterSplit: await requesterWeights(), inventoryBeforeSplit,
        inventoryAfterSplit: Object.fromEntries(hosts.map((host, index) => [host.label, after[index].inventory])) };
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
        settlement: await ledgerTrace(coordinator.credits, answer.reservationId) };
    },
    async cleanup() {
      const stopped = await Promise.all([...sessions.values()].map(row => stopSession(row).catch(() => false)));
      await restoreAll();
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      // A run that failed before the ledger opened has no credits to account for.
      if (!coordinator) return { processesExited: stopped.every(Boolean), heldCredits: 0, openReservations: 0 };
      const heldCredits = coordinator.credits.snapshot().accounts.reduce((sum, account) => sum + account.held, 0);
      const result = { processesExited: stopped.every(Boolean), heldCredits, openReservations: await openReservationCount(coordinator.ledgerFile) };
      await coordinator.close();
      coordinator = null;
      return result;
    },
    async hardStop() {
      const all = [...sessions.values(), ...soloSessions];
      const stopped = await Promise.all(all.map(row => stopSession(row, { force: true }).catch(() => false)));
      await restoreAll();
      await coordinator?.close();
      coordinator = null;
      if (restoreFailed.size) throw stopWith('service-restore-failed', [...restoreFailed].join(', '));
      if (!stopped.every(Boolean)) throw stopWith('host-process-not-confirmed-stopped');
    }
  });
}

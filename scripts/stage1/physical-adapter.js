/**
 * Stage 1 host adapter for real machines. Every remote action goes through the injected command transport to the
 * harness-owned host agent. A solo control uses the host's full copy, which stays on the host. For the split each stage
 * process opens only its stage directory and reads pieces through the stage loader, which serves its assigned ranges
 * and nothing else; while stage processes run, each full copy's directory is locked (mode 000) and restored afterwards.
 * An optional earning machine serves whole-model answers so the requester's account earns before it spends.
 *
 * Inside a window no weight bytes are hashed unless something changed. The window-free preparation
 * (`recordWeightBaselines`, run by `--prepare-stage-directories verify --hash`) hashes every weight directory under each
 * machine's roots and keeps each directory's fingerprint on that machine; in the window each search compares
 * fingerprints and hashes only a directory that is new or changed (host-control.js `scanHostWeights`). Every step is
 * logged with UTC times and durations and is bounded: the bookkeeping before and after the split answer each have
 * `limits.bookkeepingMs`, apart from the generation's `limits.phaseMs`.
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
import { createStepClock } from './steps.js';

/** The earn phase stops once the account holds enough for the split, the stopped answer and the drop, or after this many. */
const EARN_MAX_REQUESTS = 8;
/** Each of the split's two bookkeeping budgets when the host file sets none. */
export const DEFAULT_BOOKKEEPING_MS = 240000;
/** Where a machine keeps the fingerprints of one search scope, in its own state directory. */
export const weightBaselineFile = (target, scope) => `${target.stateDirectory}/weight-baseline-${scope}.json`;
/**
 * The release whose weight searches a window runs: the commit that last changed what they cover (roots, skips, scope,
 * ranges) or how a directory is fingerprinted. A baseline recorded before it predates those searches and the check
 * refuses it. Move this, and record the baselines again, whenever either changes.
 */
export const WEIGHT_SCAN_RELEASE = Object.freeze({ commit: '63075ee06d53b767ba63fe7e6693b4caf69a3efa', committedAt: '2026-11-25T00:15:43.000Z' });

const stopWith = (code, detail = '') => Object.assign(Error(detail ? `${code}: ${detail}` : code), { code });
const matchesStage = (inventory, stage) => inventory.outsideStageRanges === 0 && inventory.outsideStageBytes === 0
  && inventory.rangeCount === stage.rangeCount && inventory.bytes === stage.bytes && inventory.rangesDigest === stage.rangesDigest;

export function createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture, fixtureBytes,
  transport, redactor = null, startCoordinator = startPhysicalCoordinator, localDigest = harnessDigest, verifyStageDirectories = false, log = null, now = Date.now }) {
  if (typeof transport?.run !== 'function' || typeof transport?.open !== 'function') throw Error('A command transport is required');
  const { limits } = config, requesterTarget = { ...config.requester, label: 'requester' }, hosts = config.hosts;
  const bookkeepingMs = limits.bookkeepingMs ?? DEFAULT_BOOKKEEPING_MS;
  const clock = createStepClock({ log, now, redact: text => (redactor ? redactor.text(text) : text) });
  const { step } = clock;
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
  /**
   * The declared full copy is never searched: it may hold every range (the solo controls need it), and it is locked
   * while stage processes run. `baseline` is `compare` in a window and `record` in the window-free preparation.
   */
  const scan = (host, index, scope, { signal, timeoutMs, baseline = 'compare' } = {}) => control(host, 'scan-weights', {
    roots: scope === 'stage-directory' ? [host.stageDirectory] : hostRoots(host).filter(root => root !== host.fullCopyDirectory),
    allRanges, stageRanges: stageRanges[index], fullCopyDirectory: host.fullCopyDirectory, scope,
    skipDirectories: scope !== 'stage-directory' && host.fullCopyDirectory ? [host.fullCopyDirectory] : [],
    baseline: { action: baseline, file: weightBaselineFile(host, scope) } }, { signal, timeoutMs });

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

  /**
   * Each stage directory holds exactly its stage: every range of the model was hashed there in the preparation, and in
   * the window its fingerprint (each file's identity, size and times, and the build record's bytes) is unchanged, or it
   * is hashed again. The same search runs in preflight, before and after the split.
   */
  async function stageDirectories(options) {
    const scans = await Promise.all(hosts.map((host, index) => scan(host, index, 'stage-directory', options)));
    scans.forEach((row, index) => {
      if (!matchesStage(row.inventory, expectations.stages[index])) throw stopWith('host-stage-check-refused', `${hosts[index].label} stage directory does not hold exactly its stage`);
    });
    return Object.fromEntries(hosts.map((host, index) => [host.label, { ...scans[index].inventory, ...(scans[index].baseline ? { baseline: scans[index].baseline } : {}) }]));
  }
  /**
   * Everywhere else each host keeps weights. The declared full copy is allowed and not searched; another stage's range
   * anywhere else stops the split. Unchanged directories rest on the preparation's hash (see `stageDirectories`).
   */
  async function hostWeights(options) {
    const scans = await Promise.all(hosts.map((host, index) => scan(host, index, 'host-weight-directories', options)));
    scans.forEach((row, index) => {
      if (row.outsideElsewhere > 0) throw stopWith('host-stage-check-refused', `${hosts[index].label} holds ${row.outsideElsewhere} other-stage ranges outside its full copy`);
    });
    return Object.fromEntries(hosts.map((host, index) => [host.label, { scope: scans[index].inventory.scope, scannedRanges: scans[index].inventory.scannedRanges,
      heldRanges: scans[index].inventory.rangeCount, outsideStageRanges: scans[index].inventory.outsideStageRanges,
      outsideElsewhere: scans[index].outsideElsewhere, evidence: scans[index].inventory.evidence, hashedAt: scans[index].inventory.hashedAt,
      ...(scans[index].baseline ? { baseline: scans[index].baseline } : {}),
      fullCopy: !host.fullCopyDirectory ? 'none' : locked(host) ? 'locked-not-searched' : 'declared-not-searched' }]));
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

  async function openParticipant(host, index, { timeoutMs }) {
    const shared = { signalingUrl: coordinator.signalingUrl, roomId: coordinator.roomId, roomToken: coordinator.roomToken,
      serviceUrl: coordinator.serviceUrl, serviceCa: coordinator.serviceCa, maxOutputTokens: fixture.maxOutputTokens, gateHoldMs: limits.phaseMs };
    if (index === null) {
      await session('requester').call('open', { ...shared, stageIndex: null, modelDirectory: requesterTarget.modelDirectory, stateDirectory: requesterTarget.stateDirectory },
        { timeoutMs });
      return null;
    }
    const opened = await session(host.label).call('open', { ...shared, stageIndex: index, modelDirectory: host.stageDirectory, stateDirectory: host.stateDirectory,
      assignedRanges: stageRanges[index],
      fixtureBase64: Buffer.from(fixtureBytes).toString('base64'), fixtureSha256,
      witness: { threadId: splitThread, requesterId: peers.requester.participantId, stageParticipants: hosts.map(row => peers[row.label].participantId) } }, { timeoutMs });
    return opened.assignedLayers;
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
  async function requesterWeights({ signal, timeoutMs, baseline = 'compare' } = {}) {
    const roots = [...new Set([requesterTarget.modelDirectory, ...requesterTarget.weightRoots.model,
      ...requesterTarget.weightRoots.cache, ...requesterTarget.weightRoots.temporary])];
    const scope = 'requester-weight-directories';
    const [underRoots, scanned] = await Promise.all([
      control(requesterTarget, 'directory-bytes', { directories: roots }, { signal, timeoutMs }),
      control(requesterTarget, 'scan-weights', { roots, allRanges, stageRanges: [], fullCopyDirectory: null, scope,
        baseline: { action: baseline, file: weightBaselineFile(requesterTarget, scope) } }, { signal, timeoutMs })]);
    const held = scanned.inventory;
    return { weightBytes: held.bytes, otherModelBytes: Math.max(0, underRoots.weightBytes - held.bytes), fileCount: underRoots.fileCount,
      scope, scannedRoots: roots.length, ...(held.evidence ? { evidence: held.evidence, hashedAt: held.hashedAt } : {}),
      ...(scanned.baseline ? { baseline: scanned.baseline } : {}),
      heldRanges: { rangeCount: held.rangeCount, bytes: held.bytes, scannedRanges: held.scannedRanges } };
  }

  /** Window-free: hashes every weight directory each machine searches and keeps its fingerprints there. */
  async function recordWeightBaselines({ labels = null, timeoutMs = limits.phaseMs, signal } = {}) {
    const results = {}, run = async (key, work) => {
      try { results[key] = { ok: true, ...await work() }; }
      catch (error) { results[key] = { ok: false, code: error.code ?? null, error: redactor ? redactor.text(error.message) : error.message }; }
    };
    const span = clock.budget('preparation', timeoutMs, signal);
    for (const [index, host] of hosts.entries()) {
      if (labels && !labels.includes(host.label)) continue;
      for (const scope of ['stage-directory', 'host-weight-directories']) {
        await run(`${host.label}:${scope}`, () => step(`prepare ${host.label} ${scope}`, span, options => scan(host, index, scope, { ...options, baseline: 'record' })
          .then(row => ({ rangeCount: row.inventory.rangeCount, outsideStageRanges: row.inventory.outsideStageRanges, outsideElsewhere: row.outsideElsewhere,
            ...row.baseline }))));
      }
    }
    if (!labels || labels.includes('requester')) {
      await run('requester', () => step('prepare requester weights', span, options => requesterWeights({ ...options, baseline: 'record' })
        .then(row => ({ heldRanges: row.heldRanges.rangeCount, ...row.baseline }))));
    }
    return results;
  }

  /**
   * Window-free and read-only: the window's own searches (`scan` and `requesterWeights` with `baseline: 'compare'`, so
   * the same roots, skips and scope) and the preflight's build-record check, one step at a time so each is timed alone.
   * A directory is hashed only if it is new or changed since the baseline, and no baseline is written. Each machine
   * also reports the release and harness it runs. `release` is this operator's `{ sha, harnessDigest }`.
   */
  async function checkWeightBaselines({ release, timeoutMs = limits.phaseMs, signal, notBefore = WEIGHT_SCAN_RELEASE.committedAt } = {}) {
    const span = clock.budget('check', timeoutMs, signal), iso = ms => new Date(ms).toISOString();
    const text = message => (redactor ? redactor.text(message) : message);
    const timed = async (name, work) => {
      const startedAt = now();
      const times = () => ({ startedAt: iso(startedAt), endedAt: iso(now()), ms: now() - startedAt });
      try {
        const value = await step(name, span, work);
        return { ok: true, ...times(), ...value };
      } catch (error) { return { ok: false, ...times(), code: error.code ?? null, error: text(String(error?.message ?? error)) }; }
    };
    /** What a compare says about the baseline, and why it would not hold in a window. */
    const compared = (baseline, problems) => {
      if (!baseline.matched) problems.push(`baseline-differs: ${baseline.hashedDirectories} directories re-hashed, ${baseline.goneDirectories} gone`);
      if (!(Date.parse(baseline.recordedAt) >= Date.parse(notBefore))) problems.push(`baseline-older-than-release: recorded ${baseline.recordedAt}, before ${notBefore}`);
      return { directories: baseline.directories, unchangedDirectories: baseline.unchangedDirectories, hashedDirectories: baseline.hashedDirectories,
        rehashed: baseline.rehashed, goneDirectories: baseline.goneDirectories, matchedBaseline: baseline.matched, baselineRecordedAt: baseline.recordedAt };
    };
    const machines = {};
    for (const [index, target] of [...hosts.entries(), [null, requesterTarget]]) {
      const label = target.label, problems = [], scans = {};
      const identity = await timed(`check ${label} release`, options => control(target, 'release', {}, options));
      if (!identity.ok) problems.push(`release-unreadable: ${identity.error}`);
      else {
        if (identity.harnessDigest !== release.harnessDigest) problems.push('harness-digest-differs');
        if (!identity.releaseSha || identity.releaseSha !== release.sha) problems.push(`release-sha-differs: ${identity.releaseSha}`);
      }
      let record = null;
      if (index !== null) {
        record = await timed(`check ${label} stage-directory record`, options => stageDirectory(label, { action: 'verify', ...options }));
        if (!record.ok) problems.push(`stage-directory-record: ${record.code ?? record.error}`);
        for (const scope of ['stage-directory', 'host-weight-directories']) {
          scans[scope] = await timed(`check ${label} ${scope}`, async options => {
            const row = await scan(target, index, scope, { ...options, baseline: 'compare' });
            if (scope === 'stage-directory' && !matchesStage(row.inventory, expectations.stages[index])) problems.push('stage-directory does not hold exactly its stage');
            if (scope === 'host-weight-directories' && row.outsideElsewhere > 0) problems.push(`${row.outsideElsewhere} other-stage ranges outside the full copy`);
            return { rangeCount: row.inventory.rangeCount, outsideStageRanges: row.inventory.outsideStageRanges, outsideElsewhere: row.outsideElsewhere,
              evidence: row.inventory.evidence, ...compared(row.baseline, problems) };
          });
        }
      } else {
        scans['requester-weight-directories'] = await timed('check requester weights', async options => {
          const row = await requesterWeights({ ...options, baseline: 'compare' });
          if (row.heldRanges.rangeCount !== 0) problems.push(`the requester holds ${row.heldRanges.rangeCount} pieces of the model`);
          return { heldRanges: row.heldRanges.rangeCount, evidence: row.evidence ?? null, ...compared(row.baseline, problems) };
        });
      }
      for (const [scope, row] of Object.entries(scans)) if (!row.ok) problems.push(`${scope}: ${row.code ?? row.error}`);
      const rows = Object.values(scans), done = rows.filter(row => row.ok);
      machines[label] = { ok: problems.length === 0, problems,
        scanMs: rows.reduce((sum, row) => sum + row.ms, 0),
        directoriesCompared: done.reduce((sum, row) => sum + row.directories, 0),
        rehashedDirectories: done.reduce((sum, row) => sum + row.hashedDirectories, 0),
        rehashed: Object.entries(scans).flatMap(([scope, row]) => (row.rehashed ?? []).map(item => ({ scope, ...item }))),
        matchedBaseline: rows.length > 0 && rows.every(row => row.ok && row.matchedBaseline),
        baselineRecordedAt: Object.fromEntries(Object.entries(scans).map(([scope, row]) => [scope, row.baselineRecordedAt ?? null])),
        release: identity.ok ? { sha: identity.releaseSha, harnessDigest: identity.harnessDigest } : null,
        ...(record ? { stageDirectoryRecord: record } : {}), scans };
    }
    return machines;
  }

  const adapter = {
    describe: () => ({ runtimeClass: 'physical', adapter: 'physical-hosts' }),
    stageDirectory,
    recordWeightBaselines,
    checkWeightBaselines,
    /** The split's bound is its generation's plus both bookkeeping budgets; every other phase has `limits.phaseMs`. */
    phaseBudgetMs: name => (name === 'split' ? limits.phaseMs + 2 * bookkeepingMs : limits.phaseMs),
    evidence: () => ({ serviceRestores: [...serviceRows.values()].map(row => ({ ...row })), steps: clock.records() }),
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
      const span = clock.budget('preflight', limits.phaseMs, signal);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      for (const target of [requesterTarget, ...hosts, ...(earnerTarget ? [earnerTarget] : [])]) {
        await step(`preflight open ${target.label}`, span, async ({ timeoutMs }) => {
          const opened = await openSession(target);
          sessions.set(target.label, opened);
          const proved = await opened.call('identity', { file: target.identityFile }, { timeoutMs });
          if (proved.participantId !== target.participantId || await createPeerIdFromPublicJwk(proved.publicJwk) !== target.participantId) {
            throw stopWith('host-identity-mismatch', target.label);
          }
          peers[target.label] = proved;
        });
      }
      await step('preflight coordinator', span, async () => {
        // The buyer lives on the operator machine: a separate account the earning machine serves.
        buyer = earnerTarget ? await createSigningIdentity({ algorithm: 'Ed25519' }) : null;
        coordinator = await startCoordinator({ config, peers, directory, expectations, model, fixture, onSecret: value => redactor?.add(value),
          ...(buyer ? { buyer: { participantId: buyer.peerId, publicJwk: buyer.publicJwk }, earnModel: { id: earnModel.id, identity: earnModel.identity } } : {}) });
      });
      // Each stage directory's build record names exactly the pinned stage and its metadata files match their pins.
      // Reads the record and the small metadata files, no weight bytes. Nothing is rebuilt here.
      const records = verifyStageDirectories ? await step('preflight stage-directory records', span, options => Promise.all(hosts.map(host =>
        stageDirectory(host.label, { action: 'verify', ...options })
          .catch(error => { throw stopWith('host-stage-check-refused', `${host.label} stage directory record: ${error.code ?? error.message}`); })))) : null;
      const [inventories, requester] = await Promise.all([step('preflight stage directories', span, options => stageDirectories(options)),
        step('preflight requester weights', span, options => requesterWeights(options))]);
      return { requester: { participantId: requesterTarget.participantId, computerId: 'computer-requester', machine: requesterTarget.machineId,
        preflight: requester },
        hosts: hosts.map(host => ({ label: host.label, stageIndex: hosts.indexOf(host), participantId: host.participantId, machine: host.machineId, computerId: `computer-${host.label}`,
          assignedLayers: null, inventory: { preflight: inventories[host.label] }, ...(records ? { stageDirectoryRecord: records[hosts.indexOf(host)] } : {}) })) };
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
    /**
     * Three bounded spans: bookkeeping before the answer (checks, locks, opening the stages and the route), the answer
     * itself (generation and settlement, `limits.phaseMs`), and bookkeeping after it (witnesses, trace, the loader's
     * record, the same checks again, the ledger and the replay). Each bookkeeping span has `bookkeepingMs`.
     */
    async splitAnswer({ signal }) {
      const before = clock.budget('split-before', bookkeepingMs, signal);
      const [inventoryBeforeSplit, weightsBefore] = await Promise.all([step('split stage directories before', before, options => stageDirectories(options)),
        step('split host weights before', before, options => hostWeights(options))]);
      await step('split lock full copies', before, ({ signal: stepSignal }) => lockFullCopies(stepSignal));
      const assignedLayers = {};
      for (const [index, host] of hosts.entries()) {
        assignedLayers[host.label] = await step(`split open ${host.label}`, before, options => openParticipant(host, index, options));
      }
      await step('split open requester', before, options => openParticipant(null, null, options));
      await step('split route ready', before, ({ signal: stepSignal, timeoutMs }) => until(async () => (await session('requester').call('state', {}, { timeoutMs })).ready,
        { timeoutMs, label: 'a ready split route', signal: stepSignal, pollMs: 250 }));

      const answering = clock.budget('split-answer', limits.phaseMs, signal);
      const accountBefore = balance('computer-requester');
      const answer = await step('split generate', answering, ({ timeoutMs }) => session('requester').call('generate', { messages: fixture.messages, threadId: splitThread },
        { timeoutMs }));
      await step('split settlement', answering, ({ signal: stepSignal }) => settled(answer.reservationId, stepSignal));

      const after = clock.budget('split-after', bookkeepingMs, signal);
      const [input, output] = await step('split witnesses', after, ({ timeoutMs }) => Promise.all(hosts.map(host => session(host.label).call('witness', {}, { timeoutMs }))));
      const { tokenIds } = await step('split final-stage trace', after, ({ timeoutMs }) => finalHost().call('trace', { attemptId: answer.attemptId }, { timeoutMs }));
      const evidence = verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId: coordinator.roomId, threadId: splitThread,
        requesterId: peers.requester.participantId });
      const loaded = await step('split loader records', after, async ({ timeoutMs }) => Object.fromEntries(await Promise.all(hosts.map(async host =>
        [host.label, await session(host.label).call('loaded', {}, { timeoutMs })]))));
      const [inventoryAfterSplit, weightsAfter, requesterAfterSplit] = await Promise.all([
        step('split stage directories after', after, options => stageDirectories(options)),
        step('split host weights after', after, options => hostWeights(options)),
        step('split requester weights after', after, options => requesterWeights(options))]);
      const settlement = await step('split ledger trace', after, () => ledgerTrace(coordinator.credits, answer.reservationId));
      const settlementReplay = await step('split settlement replay', after, () => replay(answer.attemptId));
      const binding = coordinator.credits.request(answer.reservationId).binding;
      return { assignedLayers, loaded,
        hostWeights: Object.fromEntries(hosts.map(host => [host.label, { beforeSplit: weightsBefore[host.label], afterSplit: weightsAfter[host.label] }])),
        workload: { modelId: answer.route.modelId, modelIdentity: answer.route.modelIdentity, quantization: answer.route.quantization,
          planIdentity: answer.route.planId, messagesDigest: binding.inputDigest, promptDigest: output.promptDigest,
          promptCount: output.promptCount, maxOutputTokens: output.generation.maxTokens, decoding: stage1Decoding(output.generation) },
        split: { attemptId: answer.attemptId, text: answer.text, ...evidence, settlement,
          account: { computerId: 'computer-requester', before: accountBefore, after: balance('computer-requester') }, settlementReplay },
        requesterAfterSplit, inventoryBeforeSplit, inventoryAfterSplit };
    },
    async cancelAnswer({ signal }) {
      const span = clock.budget('cancel', limits.phaseMs, signal);
      const answer = await step('cancel gated answer', span, ({ signal: stepSignal, timeoutMs }) => runGatedCancel({ requester: session('requester'),
        finalStage: finalHost(), messages: fixture.messages, threadId: cancelThread, outputCount: expectations.reference.outputIds.length, signal: stepSignal, timeoutMs }));
      if (!answer.reservationId) throw stopWith('cancel-without-reservation');
      await step('cancel settlement', span, ({ signal: stepSignal }) => settled(answer.reservationId, stepSignal));
      const activity = await step('cancel stages release', span, ({ signal: stepSignal }) => Promise.all(hosts.map(host => until(async () => {
        const state = await session(host.label).call('activity');
        return state.active === 0 && state.unsettledOwners === 0 ? state : null;
      }, { timeoutMs: 30000, label: 'the stage to release the stopped attempt', signal: stepSignal, pollMs: 250 }).catch(() => session(host.label).call('activity')))));
      const settlement = await step('cancel ledger trace', span, () => ledgerTrace(coordinator.credits, answer.reservationId));
      const accountAfter = balance('computer-requester');
      return { attemptId: answer.attemptId, stoppedBeforeCompletion: answer.completed === false && answer.stopped === true,
        residentsActive: activity.map(state => state.active + state.unsettledOwners), settlement, accountAfter,
        settlementReplay: await step('cancel settlement replay', span, () => replay(answer.attemptId)) };
    },
    /**
     * Forced provider drop: host-a's stage process is killed by its exact PID and start time once the requester holds
     * part of the answer. The ledger's own expiry then releases the hold one release window after the request deadline.
     */
    async dropAnswer({ signal }) {
      const span = clock.budget('drop', limits.phaseMs, signal);
      const accountBefore = balance('computer-requester'), requester = session('requester'), killedHost = hosts[0], killed = session(killedHost.label);
      const drop = await step('drop gated answer and kill', span, ({ timeoutMs }) => runGatedDrop({ requester, killedStage: killed, messages: fixture.messages, threadId: dropThread,
        outputCount: expectations.reference.outputIds.length, signal, timeoutMs,
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
        } }));
      const own = await requester.call('settlement-records', { attemptId: drop.attemptId });
      const reservationId = own.terms?.reservationId ?? `service:${peers.requester.participantId}:${drop.attemptId}`;
      const { maxRequestMs, partitionUnclaimedReleaseMs } = coordinator.credits.policy;
      // snapshot() runs the ledger's expiry; nothing here releases the hold itself.
      await step('drop hold expiry', span, ({ signal: stepSignal }) => until(() => { coordinator.credits.snapshot(); return coordinator.credits.request(reservationId)?.state === 'settled'; },
        { timeoutMs: maxRequestMs + partitionUnclaimedReleaseMs + 15000, label: 'the dropped hold to expire on the ledger', signal: stepSignal, pollMs: 250 }));
      const settlementReplay = await step('drop settlement replay', span, () => replay(drop.attemptId, { acceptancesSigned: 'during-attempt',
        prefetched: { acceptances: drop.collected.acceptances, stageRecords: [drop.collected.killedRecords, null] } }));
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
    const earner = session('earner'), span = clock.budget('earn', limits.phaseMs, signal);
    const opened = await step('earn open whole model', span, ({ timeoutMs }) => earner.call('open-whole', { modelId: earnModel.id, modelDirectory: earnerTarget.modelDirectory },
      { timeoutMs }));
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
      await step(`earn request ${index}`, span, async ({ signal: stepSignal }) => {
        const result = await requester.generate({ model: requested, messages: [{ role: 'user', content: `Earn request ${index}.` }],
          settings: { maxOutputTokens: tokens } }, { signal: stepSignal, requestApproval: async () => true });
        await settled(result.serviceCredit.id, stepSignal);
        settlements.push(await ledgerTrace(coordinator.credits, result.serviceCredit.id));
      });
    }
    return { mode: 'whole-model', modelId: earnModel.id, runtime: opened.runtime,
      earner: { participantId: peers.earner.participantId, computerId: 'computer-requester', machine: earnerTarget.machineId },
      buyerComputerId: 'computer-buyer', accountBefore, settlements, accountBalanceAfter: balance('computer-requester') };
  }
}

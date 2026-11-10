/** Owner admission gate for the native participant. It decides whether new stage
 * work, contribution preparation and piece supply may start; it never cancels,
 * aborts or closes work that was already admitted. With no owner policy the
 * participant never creates it and behaves exactly as before. */
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import { readNativeOwnerPolicy, validateNativeOwnerPolicy, nativeOwnerPolicyDigest, decideNativeOwnerAdmission, custodySupplyTransfers } from './policy.js';
import { detectNativeOwnerSupport, createNativeOwnerMonitor, runNativeTool } from './monitor.js';
import { createByteRateLimiter, createTransferMeter, paceCustodyChannel } from './rate.js';

export const NO_OWNER_POLICY = Object.freeze({ status: 'no owner policy' });

/** Compact admission state for each partition-state status line. */
export function nativeOwnerStatus(owner) {
  if (!owner) return NO_OWNER_POLICY;
  const { action, message } = owner.decide();
  return { status: 'owner policy', digest: owner.digest, action, message };
}

/** `file` (absolute owner policy path) or an already parsed `policy`. `custody` is the
 * application's custody policy (self/config/chat-files.json). */
export async function openNativeOwnerControls({ file, policy: parsed, custody, platform = process.platform, sysfsRoot = '/sys',
  run = runNativeTool, now = Date.now, readGpuBuffers = null, onChange = () => {} }) {
  const loaded = file !== undefined ? await readNativeOwnerPolicy(file, { custody })
    : (policy => ({ policy, digest: nativeOwnerPolicyDigest(policy) }))(validateNativeOwnerPolicy(parsed, { custody }));
  const { policy, digest } = loaded;
  const support = await detectNativeOwnerSupport({ policy, platform, sysfsRoot, run });
  const monitor = createNativeOwnerMonitor({ policy, support, platform, run, now, readGpuBuffers });
  const limiter = key => policy.bandwidth?.[key] === undefined ? null
    : createByteRateLimiter({ bytesPerSecond: policy.bandwidth[key], capacityBytes: custody.channel.maxChunkBytes, now });
  const upload = limiter('uploadBytesPerSecond'), download = limiter('downloadBytesPerSecond'), meter = createTransferMeter();
  // Paced supply admits only as many transfers as the rate can finish within custody deadlines.
  const supplyTransfers = upload ? custodySupplyTransfers(custody, upload.bytesPerSecond) : custody.maxTransfers;
  const startedAt = now(), cpuStart = process.cpuUsage(), waiters = new Map();
  const counts = { stageAdmitted: 0, stageRefused: 0, supplyAdmitted: 0, supplyRefused: 0 };
  const actionMs = { admit: 0, reduce: 0, defer: 0, reject: 0 };
  let readings = null, last = null, closed = false, sampling = null, peakResidentBytes = 0, maxCelsius = null;
  let previousTransfer = { at: startedAt, ...meter.getState() }, measuredRates = { suppliedBytesPerSecond: null, receivedBytesPerSecond: null };
  const decide = () => decideNativeOwnerAdmission({ policy, support, readings, at: now() });
  const stageAllowance = decision => decision.action === 'admit' ? Infinity
    : decision.action === 'reduce' ? decision.limits.maxConcurrentAttempts : 0;
  const supplyAllowance = decision => decision.action === 'admit' ? supplyTransfers
    : decision.action === 'reduce' ? Math.min(supplyTransfers, decision.limits.maxSupplyTransfers) : 0;
  const decisionRecord = decision => ({ action: decision.action, message: decision.message, at: new Date(decision.at).toISOString(),
    reasons: decision.reasons.map(reason => reason.message), ...(decision.limits ? { limits: { ...decision.limits } } : {}) });

  function summary() {
    const decision = decide(), transfer = meter.getState(), cpu = process.cpuUsage(cpuStart);
    return { status: 'owner policy', digest, decision: decisionRecord(decision),
      waiting: [...new Set(waiters.values())],
      readings: readings && { at: new Date(readings.at).toISOString(), processResidentBytes: readings.processResidentBytes,
        gpuBuffers: readings.gpuBuffers, temperatureCelsius: readings.temperature?.maxCelsius ?? null,
        gpuPowerWatts: readings.gpuPower?.watts ?? null, externalPower: readings.externalPower,
        inputIdleSeconds: readings.inputIdleSeconds, foregroundSignal: readings.foregroundSignal },
      transfer: { upload: { limitBytesPerSecond: upload?.bytesPerSecond ?? null, maxSupplyTransfers: supplyAllowance(decision),
        suppliedBytes: transfer.suppliedBytes, measuredBytesPerSecond: measuredRates.suppliedBytesPerSecond, queuedBytes: upload?.getState().queuedBytes ?? 0 },
      download: { limitBytesPerSecond: download?.bytesPerSecond ?? null, receivedBytes: transfer.receivedBytes,
        measuredBytesPerSecond: measuredRates.receivedBytesPerSecond, queuedBytes: download?.getState().queuedBytes ?? 0 } },
      measurements: { since: new Date(startedAt).toISOString(), elapsedMs: now() - startedAt,
        cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, cpuScope: 'whole native process',
        peakProcessResidentBytes: peakResidentBytes, maxTemperatureCelsius: maxCelsius, gpuEnergy: monitor.getEnergy(),
        actionMs: { ...actionMs }, ...counts } };
  }
  function refresh() {
    const decision = decide();
    if (last) actionMs[last.action] += Math.max(0, decision.at - last.at);
    const changed = !last || last.message !== decision.message;
    last = decision;
    for (const wake of [...waiters.keys()]) wake(decision);
    if (changed && !closed) onChange(summary());
    return decision;
  }
  function sample() {
    return sampling ||= (async () => {
      try {
        const next = await monitor.sample();
        readings = next;
        peakResidentBytes = Math.max(peakResidentBytes, next.processResidentBytes);
        const celsius = next.temperature?.maxCelsius;
        if (typeof celsius === 'number') maxCelsius = maxCelsius === null ? celsius : Math.max(maxCelsius, celsius);
        const transfer = meter.getState(), elapsed = (next.at - previousTransfer.at) / 1000;
        if (elapsed > 0) measuredRates = { suppliedBytesPerSecond: (transfer.suppliedBytes - previousTransfer.suppliedBytes) / elapsed,
          receivedBytesPerSecond: (transfer.receivedBytes - previousTransfer.receivedBytes) / elapsed };
        previousTransfer = { at: next.at, ...transfer };
      } catch { /* Previous readings age out and defer admission; they are never assumed safe. */ }
      return refresh();
    })().finally(() => { sampling = null; });
  }
  await sample();
  const timer = setInterval(() => { if (!closed) sample(); }, policy.sampleIntervalMs);
  timer.unref?.();

  function admitStage(active) {
    const allowed = active < stageAllowance(decide());
    counts[allowed ? 'stageAdmitted' : 'stageRefused']++;
    return allowed;
  }
  return Object.freeze({
    policy, digest, support,
    decide, sample, summary,
    declaration: () => ({ status: 'owner policy', digest, policy, platform: support.platform, controls: structuredClone(support.controls) }),
    /** Resolves when new work may start; rejects at once if the policy can never be enforced here. */
    waitForAdmission({ kind, signal } = {}) {
      return new Promise((resolve, reject) => {
        const done = error => {
          if (!waiters.delete(check)) return;
          signal?.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(decide());
        };
        const check = decision => {
          if (closed) done(new Error('Owner controls closed'));
          else if (decision.action === 'reject') done(new Error('Owner policy ' + decision.message));
          else if (decision.action !== 'defer') done(null);
        };
        const abort = () => done(signal.reason);
        waiters.set(check, kind || 'work');
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        check(decide());
      });
    },
    /** Supply port for the custody exchange: `advertise` asks whether any new supply is admissible. */
    admitSupply({ active, advertise = false }) {
      const allowed = active < supplyAllowance(decide());
      if (!advertise) counts[allowed ? 'supplyAdmitted' : 'supplyRefused']++;
      return allowed;
    },
    paceChannel: createChannel => paceCustodyChannel(createChannel, { upload, download, meter }),
    /** A paced download needs time for its bytes on top of the unchanged stall deadline. */
    pieceTimeoutMs: (baseMs, maxBytes) => download ? baseMs + Math.ceil(maxBytes * 1000 / download.bytesPerSecond) : baseMs,
    gpuBufferBytes: maxBytes => policy.memory?.maxGpuBufferBytes === undefined ? maxBytes : Math.min(maxBytes, policy.memory.maxGpuBufferBytes),
    /** Gates only new attempts. An attempt this resident already holds keeps executing and settles normally. */
    gateResident(resident) {
      const ordered = typeof resident.executeStage === 'function' && typeof resident.transportId === 'string';
      const holds = attemptId => typeof attemptId === 'string' && (resident.getState().reservations?.records || [])
        .some(record => record.identity?.attemptId === attemptId && record.settledAt === null);
      const active = () => resident.getState().reservations?.active ?? 0;
      const gated = state => {
        const reservations = state?.reservations;
        if (!reservations) return state;
        const allowed = Math.max(0, stageAllowance(decide()) - reservations.active);
        return allowed >= reservations.availableSlots ? state : { ...state, reservations: { ...reservations, availableSlots: allowed } };
      };
      const admit = identity => {
        if (holds(identity?.attemptId) || admitStage(active())) return;
        // The same coded refusal the resident's own capacity limit produces on each path.
        throw Object.assign(new Error(failureMessages.CAPACITY_UNAVAILABLE), { code: 'CAPACITY_UNAVAILABLE' });
      };
      return Object.freeze({ ...resident,
        getState: () => gated(resident.getState()),
        subscribe: listener => resident.subscribe(state => listener(gated(state))),
        canAccept: identity => resident.canAccept(identity)
          && (holds(identity?.attemptId) || stageAllowance(decide()) - active() > 0),
        reserve: ordered ? async request => { admit(request?.identity); return resident.reserve(request); }
          : identity => { admit(identity); return resident.reserve(identity); } });
    },
    close() {
      if (closed) return;
      closed = true; clearInterval(timer); upload?.close(); download?.close();
      for (const wake of [...waiters.keys()]) wake(decide());
    }
  });
}

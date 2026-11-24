/**
 * Runs the Stage 1 phases on an injected host adapter and assembles one receipt. The runner decides order, bounds
 * and stopping; the adapter does the work and reports what it observed. A phase that did not run is recorded as
 * skipped and can never read as passed.
 *
 * Adapter: describe(), preflight(ctx), soloControl(label, ctx), splitAnswer(ctx), cancelAnswer(ctx), dropAnswer(ctx) (a stage
 * process killed mid-answer), cleanup(ctx),
 * hardStop(reason), optionally earnCredits(ctx) (the whole-model control that earns the credits the split spends; an
 * adapter without it records the phase as skipped, which the checker refuses), and optionally guard(phase), which throws to stop the run before that phase starts, and
 * evidence(), whose service-restore record joins the receipt however the run ended.
 */
import { STAGE1_PHASES, STAGE1_RECEIPT_SCHEMA } from './receipt-check.js';

export const DEFAULT_STAGE1_LIMITS = Object.freeze({ maxRunMs: 30 * 60000, phaseMs: 10 * 60000, abortGraceMs: 15000, hardStopMs: 30000 });
const SOLO_HOSTS = Object.freeze({ 'solo-a': 'host-a', 'solo-b': 'host-b' });

class Stop extends Error {}
const message = error => String(error?.message ?? error);

/** Resolves with the phase's value or `{ timedOut }`; `abandoned` means it ignored its abort and may still be running. */
async function bounded(work, { ms, graceMs, stopSignal }) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, stopSignal]);
  const running = Promise.resolve().then(() => work(signal));
  let timer, grace;
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
  const stopped = new Promise(resolve => {
    if (stopSignal.aborted) resolve('stopped');
    else stopSignal.addEventListener('abort', () => resolve('stopped'), { once: true });
  });
  try {
    const first = await Promise.race([running.then(value => ({ value }), error => ({ error })), expired, stopped]);
    if (typeof first === 'object') return first;
    controller.abort(new Stop(`Phase ${first}`));
    const settled = await Promise.race([running.then(() => true, () => true),
      new Promise(resolve => { grace = setTimeout(() => resolve(false), graceMs); })]);
    return { timedOut: first === 'timeout', stopped: first === 'stopped', abandoned: !settled };
  } finally { clearTimeout(timer); clearTimeout(grace); }
}

export async function runStage1Phases({ adapter, expectations, limits = {}, signal = null, now = Date.now }) {
  for (const method of ['describe', 'preflight', 'soloControl', 'splitAnswer', 'cancelAnswer', 'dropAnswer', 'cleanup', 'hardStop']) {
    if (typeof adapter?.[method] !== 'function') throw Error(`Stage 1 adapter is missing ${method}`);
  }
  const bounds = { ...DEFAULT_STAGE1_LIMITS, ...limits };
  const description = adapter.describe();
  const stop = new AbortController();
  const requestStop = reason => { if (!stop.signal.aborted) stop.abort(new Stop(reason)); };
  const deadline = setTimeout(() => requestStop(`Run exceeded its ${bounds.maxRunMs} ms limit`), bounds.maxRunMs);
  const outside = () => requestStop(message(signal.reason ?? 'Stopped from outside'));
  if (signal?.aborted) outside(); else signal?.addEventListener('abort', outside, { once: true });

  const receipt = { schema: STAGE1_RECEIPT_SCHEMA, runtimeClass: description.runtimeClass, startedAt: new Date(now()).toISOString(),
    finishedAt: null, hardStop: null, phases: Object.fromEntries(STAGE1_PHASES.map(name => [name, { status: 'skipped', reason: 'not reached' }])),
    workload: null, requester: null, hosts: null, soloControls: {}, earn: null, split: null, cancel: null, drop: null, cleanup: null, claim: null };
  const context = phaseSignal => ({ signal: phaseSignal, expectations });
  const apply = {
    preflight: value => { receipt.requester = { ...value.requester }; receipt.hosts = value.hosts; },
    split: value => {
      receipt.workload = value.workload; receipt.split = value.split;
      receipt.requester.afterSplit = value.requesterAfterSplit;
      for (const host of receipt.hosts) {
        host.inventory.beforeSplit = value.inventoryBeforeSplit[host.label];
        host.inventory.afterSplit = value.inventoryAfterSplit[host.label];
        // A real stage loads only after the solo controls, so its layers are first observed here.
        if (value.assignedLayers) host.assignedLayers = value.assignedLayers[host.label];
        // What the stage process's own loader served and refused, and (physical) the host-wide search around the split.
        if (value.loaded) host.loaded = value.loaded[host.label];
        if (value.hostWeights) host.hostWeights = value.hostWeights[host.label];
      }
    },
    earn: value => { receipt.earn = value; },
    cancel: value => { receipt.cancel = value; },
    drop: value => { receipt.drop = value; },
    cleanup: value => { receipt.cleanup = value; }
  };
  const work = {
    preflight: phaseSignal => adapter.preflight(context(phaseSignal)),
    earn: phaseSignal => adapter.earnCredits(context(phaseSignal)),
    split: phaseSignal => adapter.splitAnswer(context(phaseSignal)),
    cancel: phaseSignal => adapter.cancelAnswer(context(phaseSignal)),
    drop: phaseSignal => adapter.dropAnswer(context(phaseSignal)),
    cleanup: phaseSignal => adapter.cleanup(context(phaseSignal))
  };

  /** Returns false when the run cannot continue to the next phase. */
  async function runPhase(name) {
    const host = SOLO_HOSTS[name];
    const outcome = await bounded(host ? phaseSignal => adapter.soloControl(host, context(phaseSignal)) : work[name],
      { ms: bounds.phaseMs, graceMs: bounds.abortGraceMs, stopSignal: stop.signal });
    if (outcome.abandoned) requestStop(`Phase ${name} did not stop within its abort grace`);
    if (outcome.stopped || outcome.abandoned) {
      receipt.phases[name] = { status: 'stopped', reason: message(stop.signal.reason) };
      return false;
    }
    if (host && (outcome.timedOut || outcome.error)) {
      // The control ended without showing anything about memory. The run continues; the label cannot use it.
      receipt.soloControls[host] = { outcome: 'inconclusive', reason: outcome.timedOut ? 'timeout' : message(outcome.error) };
      receipt.phases[name] = { status: 'completed', result: 'inconclusive' };
      return true;
    }
    if (outcome.timedOut) { receipt.phases[name] = { status: 'timed-out', reason: `Exceeded ${bounds.phaseMs} ms` }; return false; }
    if (outcome.error) { receipt.phases[name] = { status: 'failed', reason: message(outcome.error) }; return false; }
    try {
      if (host) receipt.soloControls[host] = outcome.value;
      else apply[name](outcome.value);
    } catch (error) {
      receipt.phases[name] = { status: 'failed', reason: `Adapter result is malformed: ${message(error)}` };
      return false;
    }
    receipt.phases[name] = { status: 'completed' };
    return true;
  }

  const body = STAGE1_PHASES.filter(name => name !== 'cleanup');
  let halted = null;
  try {
    for (const name of body) {
      if (stop.signal.aborted) break;
      try { await adapter.guard?.(name); }
      catch (error) { requestStop(`Guard before ${name}: ${message(error)}`); break; }
      if (stop.signal.aborted) break;
      if (name === 'earn' && typeof adapter.earnCredits !== 'function') {
        receipt.phases.earn = { status: 'skipped', reason: 'this adapter has no earn phase' };
        continue;
      }
      if (!await runPhase(name)) { halted = name; break; }
    }
    if (halted) {
      for (const name of body.slice(body.indexOf(halted) + 1)) receipt.phases[name] = { status: 'skipped', reason: `${halted} did not complete` };
    }
    if (!stop.signal.aborted) {
      await runPhase('cleanup');
      if (receipt.phases.cleanup.status !== 'completed' && !stop.signal.aborted) requestStop(`Cleanup ${receipt.phases.cleanup.status}`);
    }
    if (stop.signal.aborted) {
      const reason = message(stop.signal.reason);
      for (const name of STAGE1_PHASES) {
        if (receipt.phases[name].reason === 'not reached') receipt.phases[name] = { status: 'skipped', reason: `Hard stop: ${reason}` };
      }
      const stopped = await bounded(() => adapter.hardStop(reason), { ms: bounds.hardStopMs, graceMs: 0, stopSignal: new AbortController().signal });
      receipt.hardStop = { reason, at: new Date(now()).toISOString(),
        confirmed: !stopped.error && !stopped.timedOut && !stopped.abandoned,
        ...(stopped.error ? { error: message(stopped.error) } : {}) };
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', outside);
  }
  receipt.serviceRestores = adapter.evidence?.().serviceRestores ?? [];
  receipt.finishedAt = new Date(now()).toISOString();
  return receipt;
}

/**
 * Named, bounded steps inside a Stage 1 phase. Each step logs its start and end with a UTC time and its duration, is
 * recorded for the receipt, and ends by its own deadline with a reason that names it, so a stall is diagnosable from
 * the run log and the receipt alone. A budget is a deadline shared by several steps: the bookkeeping before and after
 * the split answer each have one, apart from the generation's.
 */
const coded = (code, message) => Object.assign(Error(`${code}: ${message}`), { code });

export function createStepClock({ log = null, now = Date.now, redact = text => text } = {}) {
  const records = [];
  const write = line => { try { log?.(`${new Date(now()).toISOString()} ${redact(line)}`); } catch { /* logging never stops a run */ } };

  /** A deadline `ms` from now, shared by the steps given it. `signal` is the phase's own. */
  function budget(label, ms, signal = null) {
    return { label, ms, deadline: now() + ms, signal };
  }

  /**
   * Runs `work({ signal, timeoutMs })` under `of`. `capMs` limits this step below what is left of the budget. The step
   * ends when its work settles or its deadline passes, whichever comes first; work that ignores the signal is left to
   * its own `timeoutMs`, which is never longer than the step's.
   */
  async function step(name, of, work, { capMs = Infinity } = {}) {
    const startedAt = now(), left = Math.min(of.deadline - startedAt, capMs);
    const row = { step: name, budget: of.label, startedAt: new Date(startedAt).toISOString(), ms: null, status: 'running' };
    records.push(row);
    write(`step ${name} start (${of.label} budget, ${Math.max(0, Math.floor(left))} ms left)`);
    const finish = (status, detail) => {
      row.ms = now() - startedAt; row.status = status;
      if (detail) row.detail = redact(detail);
      write(`step ${name} ${status} after ${row.ms} ms${detail ? `: ${redact(detail)}` : ''}`);
    };
    if (left <= 0) {
      const error = coded('step-timed-out', `${name} did not start: the ${of.label} budget of ${of.ms} ms was spent`);
      finish('timed-out', error.message);
      throw error;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(coded('step-timed-out',
      `${name} exceeded ${capMs < of.deadline - startedAt ? `its ${Math.floor(capMs)} ms limit` : `the ${of.label} budget of ${of.ms} ms`}`)), left);
    const signal = of.signal ? AbortSignal.any([of.signal, controller.signal]) : controller.signal;
    let stop;
    const stopped = new Promise((_, reject) => {
      stop = () => reject(signal.reason);
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    });
    stopped.catch(() => {});
    try {
      const value = await Promise.race([Promise.resolve().then(() => work({ signal, timeoutMs: Math.max(1, Math.floor(left)) })), stopped]);
      finish('done');
      return value;
    } catch (error) {
      finish(controller.signal.aborted ? 'timed-out' : of.signal?.aborted ? 'stopped' : 'failed', String(error?.message ?? error));
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
  }

  return { budget, step, log: write, records: () => records.map(row => ({ ...row })) };
}

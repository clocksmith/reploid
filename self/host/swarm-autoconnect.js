/** One host controller; each live transport owns its reconnect loop. */
export function startSwarmAutoconnect({ connect, isConnected, enabled, policy,
  eventTarget = globalThis, setTimer = setTimeout, clearTimer = clearTimeout,
  random = Math.random, onError = () => {} }) {
  let paused = false, closed = false, inFlight = null, timer = null, attempt = 0;
  const schedule = delay => {
    if (closed || paused) return;
    clearTimer(timer);
    timer = setTimer(tick, delay);
  };
  const tick = async () => {
    timer = null;
    if (closed || paused || inFlight) return;
    if (!enabled() || isConnected()) { attempt = 0; schedule(policy.healthCheckMs); return; }
    let failed = false;
    inFlight = Promise.resolve().then(() => connect({ automatic: true }));
    try { await inFlight; attempt = 0; }
    catch (error) { failed = true; onError(error); }
    finally {
      inFlight = null;
      const delay = failed ? policy.retryMs[Math.min(attempt++, policy.retryMs.length - 1)] : policy.healthCheckMs;
      schedule(failed ? Math.round(delay * (0.8 + 0.4 * random())) : delay);
    }
  };
  const online = () => { if (!paused && !closed) schedule(0); };
  eventTarget.addEventListener('online', online);
  schedule(0);
  return Object.freeze({
    pause() { paused = true; clearTimer(timer); timer = null; },
    resume() { if (closed) return; paused = false; schedule(0); },
    close() { closed = true; paused = true; clearTimer(timer); timer = null; eventTarget.removeEventListener('online', online); }
  });
}

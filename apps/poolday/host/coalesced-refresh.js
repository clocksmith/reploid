/**
 * Runs `refresh` at once when it has been idle, and otherwise at most once per interval. The interval grows to
 * twice the last run's own cost, so however slow a run gets, the page keeps at least two thirds of its time for
 * other work, such as answering its peers. Requests made while one is pending fold into that one.
 */
export function createCoalescedRefresh(refresh, { minimumMs = 100, now = () => performance.now(),
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null, finishedAt = -Infinity, costMs = 0, closed = false;
  const run = () => {
    timer = null;
    if (closed) return;
    const started = now();
    try { refresh(); } finally { finishedAt = now(); costMs = finishedAt - started; }
  };
  return Object.freeze({
    request() {
      if (timer !== null || closed) return;
      const wait = finishedAt + Math.max(minimumMs, 2 * costMs) - now();
      if (wait <= 0) run(); else timer = setTimer(run, wait);
    },
    close() { closed = true; if (timer !== null) clearTimer(timer); timer = null; }
  });
}

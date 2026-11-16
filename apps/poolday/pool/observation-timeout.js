/** Bound observation of borrowed work. A timeout does not cancel or settle it:
 * its owner must still stop/close and await any admitted effects. Both handlers
 * stay attached so a late rejection is observed after the deadline. */
export function observeWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), Math.max(1, Number(timeoutMs || 1)));
    Promise.resolve(promise).then(value => {
      globalThis.clearTimeout(timer);
      resolve(value);
    }, error => {
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });
}

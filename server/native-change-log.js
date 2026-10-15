/**
 * Change-only status lines for the native participant. A record is written when its
 * content differs from the last one written for the same kind, or when `heartbeatMs` has
 * passed since that kind was last written (then marked `heartbeat: true`). Time-like fields
 * (`at`, `*At`, `lastSeen*`, `timestamp`, `*elapsedMs`, `*uptimeMs`) are ignored when deciding
 * whether content changed, so an idle host writes only heartbeats.
 */

const VOLATILE_KEY = /^(at|timestamp)$|At$|^lastSeen|elapsedMs$|uptimeMs$/;

/** Stable comparison key: sorted keys, volatile fields removed at every depth. */
export function statusContentKey(value) {
  const strip = item => {
    if (Array.isArray(item)) return item.map(strip);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().filter(key => !VOLATILE_KEY.test(key)).map(key => [key, strip(item[key])]));
  };
  return JSON.stringify(strip(value));
}

/**
 * @param {object} options
 * @param {number} options.heartbeatMs positive interval after which an unchanged kind is written again
 * @param {(line: string) => void} options.write sink for one JSON line
 * @param {() => number} [options.now]
 * @returns {(kind: string, record: object) => boolean} writes when changed or due; returns whether it wrote
 */
export function createChangeOnlyLog({ heartbeatMs, write, now = Date.now }) {
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0) throw new Error('statusHeartbeatMs must be a positive integer in the partition policy');
  if (typeof write !== 'function') throw new Error('A status log sink is required');
  const last = new Map();
  return (kind, record) => {
    const key = statusContentKey(record), previous = last.get(kind), at = now();
    const changed = !previous || previous.key !== key;
    if (!changed && at - previous.writtenAt < heartbeatMs) return false;
    write(JSON.stringify(changed ? record : { ...record, heartbeat: true }));
    last.set(kind, { key, writtenAt: at });
    return true;
  };
}

/**
 * @fileoverview This device's one shared-file inventory over a custody exchange's single offer list.
 *
 * The exchange (exchange.js) offers one list of files. Two paths put files in it: sharing an already-cached model
 * (`cached-model`) and weight supply (`weight-supply`, weight-supply.js). Each path sets only its own files; the
 * exchange offers their union, so neither path can drop the other's files, and a file both hold stays offered while
 * either holds it. Each file lists its sources. Pausing stops all serving from this device until resumed; changes
 * made while paused are kept and offered on resume. The union is bounded by the exchange's inventory limit,
 * weight-supply files first (they are few and the owner approved them for supply).
 */

/** Inventory sources in offer priority order: weight supply, then the cached-model path. */
const PRIORITY = Object.freeze(['weight-supply', 'cached-model']);
/** Sources as listed on each file. */
export const SHARED_FILE_SOURCES = Object.freeze(['cached-model', 'weight-supply']);

const key = file => JSON.stringify([file.path, file.hash, file.hashAlgorithm, file.sizeBytes]);

/**
 * @param {object} options
 * @param {object} options.exchange createCustodyExchange(...) result; this inventory owns its offer list
 * @param {number} options.maxFiles the exchange policy's `maxInventoryFiles`
 * @param {() => void} [options.onChange]
 */
export function createSharedFileInventory({ exchange, maxFiles, onChange = () => {} }) {
  if (!exchange?.offer || !exchange.stopSupply || !exchange.getState) throw new TypeError('Shared inventory requires a custody exchange');
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) throw new TypeError('Shared inventory requires the exchange inventory limit');
  const bySource = new Map(SHARED_FILE_SOURCES.map(source => [source, []]));
  let paused = false, settled = Promise.resolve([]);

  const rows = () => {
    const merged = new Map();
    for (const source of PRIORITY) {
      for (const file of bySource.get(source)) {
        const id = key(file);
        if (!merged.has(id)) merged.set(id, { file, sources: new Set() });
        merged.get(id).sources.add(source);
      }
    }
    return [...merged.values()].map((row, index) => ({ ...row, offered: index < maxFiles }));
  };
  const publish = () => {
    const files = rows().filter(row => row.offered).map(row => row.file);
    if (paused || files.length === 0) {
      if (exchange.getState().sharing) settled = exchange.stopSupply();
    } else exchange.offer(files, { revoke: false });
    onChange();
  };
  const set = (source, files) => {
    if (!bySource.has(source)) throw new TypeError(`Unknown shared-file source ${String(source)}`);
    if (!Array.isArray(files)) throw new TypeError('Shared files must be an array');
    bySource.set(source, structuredClone(files));
    publish();
    return settled;
  };
  const holds = (file, source = null) => rows().some(row => key(row.file) === key(file) && (source === null || row.sources.has(source)));

  const api = Object.freeze({
    /** Replaces `source`'s files only; returns the settlement of any supply this stopped. */
    set,
    /** Whether `file` is in the inventory (held by `source`, when given). */
    holds,
    /** Whether this device serves `file` now: held, within the offered bound, and not paused. */
    isServing: file => !paused && rows().some(row => row.offered && key(row.file) === key(file)),
    pause() {
      paused = true;
      settled = exchange.stopSupply();
      onChange();
      return settled;
    },
    resume() { paused = false; publish(); },
    getState: () => ({ paused, sharing: !paused && exchange.getState().sharing === true,
      files: rows().map(({ file, sources, offered }) => ({ path: file.path, role: file.role, hashAlgorithm: file.hashAlgorithm, hash: file.hash,
        sizeBytes: file.sizeBytes, sources: SHARED_FILE_SOURCES.filter(source => sources.has(source)), offered })) }),
    /**
     * The exchange as one source sees it (the `exchange` port of createWeightSupply): its `offer` sets only that
     * source's files, and its `stopSupply` pauses all serving from this device.
     */
    source(name) {
      if (!bySource.has(name)) throw new TypeError(`Unknown shared-file source ${String(name)}`);
      return Object.freeze({
        getState: () => exchange.getState(),
        has: file => exchange.has(file),
        acquire: (file, options) => exchange.acquire(file, options),
        announceDemand: files => exchange.announceDemand(files),
        offer: files => { set(name, files); },
        stopSupply: () => api.pause()
      });
    }
  });
  return api;
}

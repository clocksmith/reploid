/** Automatic local download when a sent message finds no computer that can answer. The
 * preference is per browser and defaults on; visiting or waiting never downloads. Cancel stops
 * automatic downloads until the page reloads or the setting is turned on again. The host's
 * acquisition owns transfer, verification and the storage limit. */
import policy from '../../config/chat-files.json' with { type: 'json' };

export const AUTO_DOWNLOAD_STORAGE_KEY = 'reploid.auto-download.v1';

export function readAutoDownload(storage = globalThis.localStorage) {
  try { return storage?.getItem(AUTO_DOWNLOAD_STORAGE_KEY) !== 'off'; } catch { return true; }
}

export function writeAutoDownload(enabled, storage = globalThis.localStorage) {
  try { storage?.setItem(AUTO_DOWNLOAD_STORAGE_KEY, enabled ? 'on' : 'off'); } catch { /* applies to this page only */ }
}

const wholeModel = model => !!model?.source?.baseUrl && !model.partition && !model.adapters?.length;
const megabytes = bytes => Math.ceil(bytes / 1e6) + ' MB';

/** An explicit choice is never substituted; without one, every whole base model is a candidate. */
export function autoDownloadCandidates(models, explicit) {
  if (explicit) return wholeModel(explicit) ? [explicit] : [];
  return (models || []).filter(wholeModel);
}

/** The smallest measured candidate within the storage limit, or null. */
export function smallestDownload(sized, maxBytes = policy.maxStoredBytes) {
  return sized.filter(entry => Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes > 0 && entry.sizeBytes <= maxBytes)
    .sort((a, b) => a.sizeBytes - b.sizeBytes)[0] || null;
}

/** Why an automatic download must not start, or null when it may. */
export function autoDownloadBlocker({ saveData = false, model = null, sizeBytes = 0, estimate = null } = {}) {
  if (saveData) return 'Data saver is on, so no model was downloaded automatically.';
  const free = Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage) ? estimate.quota - estimate.usage : null;
  if (model && free !== null && free < sizeBytes) return `Not enough browser storage for ${model.name} (${megabytes(sizeBytes)} needed), so it was not downloaded automatically.`;
  return null;
}

export function createAutoDownload(session, { storage = globalThis.localStorage, onChange = () => {},
  connection = () => globalThis.navigator?.connection, estimate = () => globalThis.navigator?.storage?.estimate?.(),
  maxBytes = policy.maxStoredBytes } = {}) {
  const attempted = new Set();
  let suppressed = false, pending = null, notice = null, started = null, disposed = false;
  const run = async (models, explicit) => {
    if (connection()?.saveData) { notice = autoDownloadBlocker({ saveData: true }); return; }
    const sized = [];
    let failure = null;
    for (const model of autoDownloadCandidates(models, explicit)) {
      try { sized.push({ model, sizeBytes: (await session.getModelDownload(model.id)).sizeBytes }); }
      catch (cause) { failure = cause; }
      if (disposed) return;
    }
    const pick = smallestDownload(sized, maxBytes);
    if (!pick) {
      notice = sized.length ? 'No model fits this device’s storage limit, so none was downloaded automatically.'
        : failure?.message || null;
      return;
    }
    const quota = await Promise.resolve().then(estimate).catch(() => null);
    notice = autoDownloadBlocker({ model: pick.model, sizeBytes: pick.sizeBytes, estimate: quota });
    if (notice || disposed || suppressed) return;
    started = { id: pick.model.id, name: pick.model.name };
    onChange();
    // Failures and cancellation surface through the host's acquisition state.
    await session.downloadLocalModel(pick.model.id, true).catch(() => {});
  };
  return {
    enabled: () => readAutoDownload(storage),
    /** The model this controller downloaded automatically, if any. */
    started: () => started,
    notice: () => notice,
    /** Whether a sent message may start an automatic download for this choice now. */
    available(explicit = null) {
      const key = explicit ? explicit.selectionId || explicit.id : 'default';
      return !disposed && !suppressed && !pending && !attempted.has(key) && readAutoDownload(storage);
    },
    /** Whether the controller is still choosing a model or starting its download. */
    pending: () => !!pending,
    /** Start at most one automatic download per choice while eligible. */
    consider({ eligible, models, explicit = null }) {
      const key = explicit ? explicit.selectionId || explicit.id : 'default';
      if (!eligible || disposed || suppressed || pending || attempted.has(key) || !readAutoDownload(storage)) return;
      attempted.add(key);
      pending = run(models, explicit)
        .catch(cause => { notice = cause?.message || null; })
        .finally(() => { pending = null; if (!disposed) onChange(); });
    },
    cancelled() { suppressed = true; },
    setEnabled(enabled) {
      writeAutoDownload(enabled, storage);
      if (enabled) { suppressed = false; attempted.clear(); }
      notice = null;
      onChange();
    },
    dispose() { disposed = true; }
  };
}

export function renderAutoDownloadSetting() {
  return `<section class="pool-stack pool-gap-xs" data-auto-download-settings aria-labelledby="auto-download-settings-title">
    <div class="pool-row pool-row-between"><h3 class="pool-small" id="auto-download-settings-title">Download models automatically</h3>
      <button class="pool-switch" type="button" role="switch" aria-checked="true" aria-labelledby="auto-download-settings-title" aria-describedby="auto-download-help" data-auto-download-toggle><span aria-hidden="true"></span></button></div>
    <p class="pool-small pool-muted" id="auto-download-help">When no computer can answer a message you send, download the smallest suitable model to this device and send it there. Cancel stops it.</p>
  </section>`;
}

export function updateAutoDownloadSetting(root, enabled) {
  root?.querySelector?.('[data-auto-download-toggle]')?.setAttribute('aria-checked', String(enabled));
}

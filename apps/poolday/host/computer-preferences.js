import { identifyComputer } from '../../../shared/vendor/reploid/mesh/computer-identity.js';
import { captureGpuSignature, compareGpuSignatures } from '../../../shared/vendor/reploid/mesh/gpu-signature.js';
import policy from '../config/computer-preferences.json' with { type: 'json' };

const clone = value => structuredClone(value);
const participant = value => /^peer:[a-f0-9]{24}$/.test(value);

/** Local display preferences and an explicitly requested diagnostic, never peer authentication. */
export function createComputerPreferences({ storage = globalThis.localStorage, verifyPeer, capture = captureGpuSignature } = {}) {
  let saved = { schema: policy.schema, names: {}, baseline: null };
  let latest = null, error = '', operation = null, closed = false, baselineStored = false, baselineFromCurrent = false;
  const listeners = new Set();
  const validateBaseline = value => {
    if (value === null || value === undefined) return;
    if (!value || typeof value !== 'object' || compareGpuSignatures(value, value).distance === null) {
      throw new Error('Saved GPU baseline is invalid');
    }
  };
  try {
    const raw = storage?.getItem(policy.storageKey);
    if (raw) {
      if (new TextEncoder().encode(raw).byteLength > policy.maxStoreBytes) throw new Error('Saved computer preferences exceed the size limit');
      const value = JSON.parse(raw);
      baselineStored = !!value.baseline;
      if (value.schema !== policy.schema || !value.names || typeof value.names !== 'object' || Array.isArray(value.names)
        || Object.keys(value.names).length > policy.maxNames
        || Object.entries(value.names).some(([id, name]) => !participant(id) || typeof name !== 'string'
          || !name.trim() || name.length > policy.maxLabelLength || /[\u0000-\u001f\u007f]/.test(name))) {
        throw new Error('Saved computer names are invalid');
      }
      validateBaseline(value.baseline);
      saved = { schema: policy.schema, names: value.names, baseline: value.baseline ?? null };
    }
  } catch (cause) { error = cause.message; }
  const state = () => ({ names: clone(saved.names), baselineAt: saved.baseline?.collectedAt ?? null, baselineStored, baselineFromCurrent,
    latest: latest ? { status: latest.status, reason: latest.reason ?? null, collectedAt: latest.collectedAt ?? null,
      elapsedMs: latest.elapsedMs ?? null, hardware: clone(latest.hardware ?? null) } : null,
    comparison: compareGpuSignatures(saved.baseline, latest), busy: !!operation, operation: operation?.kind ?? null,
    canSave: latest?.status === 'measured', error });
  const notify = () => { for (const listener of listeners) listener(state()); };
  const persist = next => {
    const raw = JSON.stringify(next);
    if (new TextEncoder().encode(raw).byteLength > policy.maxStoreBytes) throw new Error('Computer preferences exceed the size limit');
    if (!storage?.setItem) throw new Error('Local storage is unavailable; computer preferences were not saved');
    storage.setItem(policy.storageKey, raw);
    saved = next;
    baselineStored = next.baseline !== null;
  };
  const run = (kind, work) => {
    if (closed) return Promise.reject(new Error('Computer preferences are closed'));
    if (operation) return Promise.reject(new Error('Another computer check or rename is still running'));
    const controller = new AbortController(), current = { kind, controller, settled: null };
    operation = current; error = '';
    current.settled = Promise.resolve().then(() => work(controller.signal)).catch(cause => {
      error = controller.signal.aborted ? 'Computer check stopped.' : cause.message;
      throw cause;
    }).finally(() => { operation = null; if (!closed) notify(); });
    notify();
    return current.settled;
  };
  const save = work => {
    if (closed || operation) throw new Error('Computer preferences cannot be changed now');
    try { work(); error = ''; } catch (cause) { error = cause.message; throw cause; }
    finally { notify(); }
  };
  return Object.freeze({
    getState: state,
    subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    rename(connectionId, name, { participantId = null } = {}) {
      return run('rename', async signal => {
        const identity = await identifyComputer(connectionId, { verifyPeer, ownerLabel: name, signal });
        signal.throwIfAborted();
        if (participantId !== null && identity.participantId !== participantId) {
          throw new Error('This connection now belongs to another computer. Check its identity before renaming.');
        }
        const names = { ...saved.names };
        if (name.trim()) names[identity.participantId] = identity.label;
        else delete names[identity.participantId];
        if (Object.keys(names).length > policy.maxNames) throw new Error('Saved computer name limit reached');
        persist({ ...saved, names });
      });
    },
    measure({ consent = false } = {}) {
      if (consent !== true) return Promise.reject(new Error('Approve the local GPU check before running it'));
      return run('gpu', async signal => {
        latest = null;
        baselineFromCurrent = false;
        const measured = await capture(null, { consent: true, signal });
        signal.throwIfAborted();
        if (measured.status === 'measured') validateBaseline(measured);
        latest = measured;
      });
    },
    saveBaseline() { save(() => {
      if (latest?.status !== 'measured') throw new Error('Run a GPU check before saving a baseline');
      persist({ ...saved, baseline: clone(latest) });
      baselineFromCurrent = true;
    }); },
    clearBaseline() { save(() => { persist({ ...saved, baseline: null }); baselineFromCurrent = false; }); },
    cancel() { operation?.controller.abort(new DOMException('Computer check stopped', 'AbortError')); },
    async close() {
      closed = true; listeners.clear();
      const pending = operation;
      pending?.controller.abort(new DOMException('Computer preferences closed', 'AbortError'));
      try { await pending?.settled; } catch (cause) { if (cause.name !== 'AbortError') throw cause; }
    }
  });
}

import { canonicalize } from '../artifacts/canonical-json.js';

const copy = value => structuredClone(value);
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** Trusted registered code only. Capability ports, storage and single-writer ownership belong to the host. */
export async function openPluginSession({ definition, config, sessionId, store, capabilities, now = Date.now }) {
  const manifest = copy(definition.manifest);
  assert(manifest.apiVersion === 1 && typeof manifest.id === 'string' && typeof manifest.version === 'string', 'Unsupported plugin');
  assert(Array.isArray(manifest.capabilities) && manifest.capabilities.every(name => typeof capabilities[name] === 'function'), 'Missing plugin capability');
  assert(Number.isSafeInteger(manifest.limits?.maxEffects) && manifest.limits.maxEffects > 0
    && Number.isSafeInteger(manifest.limits.maxRecordBytes) && manifest.limits.maxRecordBytes > 0
    && Number.isSafeInteger(manifest.limits.effectTimeoutMs) && manifest.limits.effectTimeoutMs > 0, 'Plugin limits required');
  assert(typeof sessionId === 'string' && sessionId.length > 0, 'Session ID required');
  let record = await store.load(sessionId), active = null, closed = false, settlement = Promise.resolve();
  const listeners = new Set();
  const save = async () => {
    const snapshot = copy(record);
    assert(new TextEncoder().encode(JSON.stringify(snapshot)).length <= manifest.limits.maxRecordBytes, 'Plugin record budget exceeded');
    await store.save(sessionId, snapshot);
  };
  if (record) {
    assert(record.schema === 'reploid.plugin-session/v1' && record.id === sessionId
      && canonicalize(record.plugin) === canonicalize(manifest), 'Stored plugin version differs');
    assert(config === undefined || canonicalize(record.config) === canonicalize(config), 'Stored experiment configuration differs');
    if (record.status === 'running') {
      record.status = 'interrupted';
      for (const effect of record.effects) if (effect.status === 'running') effect.status = 'interrupted';
      await save();
    }
  } else {
    const frozen = copy(config);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize({ manifest, config: frozen })));
    const configurationHash = 'sha256:' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    record = { schema: 'reploid.plugin-session/v1', id: sessionId, plugin: manifest, configurationHash,
      config: frozen, createdAt: now(), status: 'ready', state: definition.initialize(copy(frozen)), effects: [], events: [] };
    await save();
  }
  const view = () => ({ sessionId, status: record.status, busy: !!active, usedEffects: record.effects.length,
    maxEffects: manifest.limits.maxEffects, content: copy(definition.project(copy(record.state))) });
  const notify = () => { for (const listener of listeners) { try { listener(view()); } catch {} } };
  const transition = event => {
    const next = definition.transition(copy(record.state), copy(event));
    assert(next && next.state && Array.isArray(next.effects), 'Invalid plugin transition');
    record.state = copy(next.state);
    return copy(next.effects);
  };
  return Object.freeze({
    view,
    export: () => copy(record),
    subscribe(listener) { listeners.add(listener); listener(view()); return () => listeners.delete(listener); },
    async dispatch(event) {
      assert(!closed && !active, 'Plugin is closed or busy');
      assert(record.status === 'ready', 'Interrupted or failed session cannot replay work; start a new session');
      assert(event && typeof event.type === 'string' && !event.type.startsWith('effect.'), 'Reserved plugin event');
      assert(record.events.length < manifest.limits.maxEffects * 4, 'Plugin event budget exceeded');
      const controller = new AbortController();
      let settled;
      settlement = new Promise(resolve => { settled = resolve; });
      active = controller;
      try {
        const queue = transition(event);
        record.events.push({ at: now(), event: copy(event) });
        record.status = 'running';
        await save(); notify();
        while (queue.length) {
          controller.signal.throwIfAborted();
          const effect = queue.shift();
          assert(manifest.capabilities.includes(effect.capability), 'Plugin requested an undeclared capability');
          assert(record.effects.length < manifest.limits.maxEffects, 'Plugin effect budget exhausted');
          const entry = { id: record.effects.length, capability: effect.capability, input: copy(effect.input),
            status: 'running', startedAt: now() };
          record.effects.push(entry);
          await save(); notify();
          const timeout = setTimeout(() => controller.abort(new Error('Plugin effect deadline exceeded')), manifest.limits.effectTimeoutMs);
          try {
            const output = await capabilities[effect.capability](copy(effect.input), { signal: controller.signal, sessionId, effectId: entry.id,
              async observe(value) {
                controller.signal.throwIfAborted();
                entry.observations ??= [];
                assert(entry.observations.length < manifest.limits.maxEffects * 4, 'Plugin observation budget exceeded');
                entry.observations.push({ at: now(), value: copy(value) });
                await save();
              } });
            // Retain a late response for analysis, but never use it to advance a cancelled round.
            entry.output = copy(output);
            controller.signal.throwIfAborted();
            entry.status = 'completed';
            queue.push(...transition({ type: 'effect.completed', input: entry.input, output: entry.output }));
          } catch (error) {
            entry.status = controller.signal.aborted ? 'cancelled' : 'failed';
            entry.error = String(error.message || error).slice(0, 1024);
            throw error;
          } finally { clearTimeout(timeout); entry.completedAt = now(); await save(); }
        }
        record.status = 'ready'; await save();
      } catch (error) {
        record.status = controller.signal.aborted ? 'cancelled' : 'failed';
        record.error = String(error.message || error).slice(0, 1024);
        await save(); throw error;
      } finally { active = null; notify(); settled(); }
      return view();
    },
    cancel() { active?.abort(new Error('Plugin session cancelled')); },
    async close() { closed = true; active?.abort(new Error('Plugin session closed')); listeners.clear(); await settlement; }
  });
}

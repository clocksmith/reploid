import { createExecutionEngine, TURN_RETURN } from '../vendor/reploid/agent/engine.js';
import { freezeJson, snapshotJson } from '../vendor/reploid/config/index.js';

const PATH = '/state/zero.json';
const SCHEMA = 'reploid.zero/v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const textError = error => error instanceof Error ? error.message : String(error);

function toolCall(value, fallbackId) {
  const name = value?.name ?? value?.function?.name;
  const id = value?.id ?? fallbackId;
  let args = value?.args !== undefined ? value.args : value?.function?.arguments ?? {};
  if (typeof args === 'string') args = JSON.parse(args);
  if (!object(value) || value.error || typeof name !== 'string' || !name.trim()
    || typeof id !== 'string' || !id || !object(args)) throw new TypeError('Invalid native tool call');
  return { id, name, args: snapshotJson(args) };
}

function restore(raw) {
  if (raw === null || raw === undefined) return [];
  try {
    const saved = JSON.parse(raw);
    if (!fields(saved, ['schema', 'messages']) || saved.schema !== SCHEMA || !Array.isArray(saved.messages)) throw new Error('Invalid envelope');
    const pending = new Map();
    for (const message of saved.messages) {
      if (!object(message) || typeof message.content !== 'string') throw new Error('Invalid message');
      if (message.role === 'tool') {
        if (!fields(message, ['role', 'content', 'name', 'tool_call_id'])
          || !pending.has(message.tool_call_id) || pending.get(message.tool_call_id) !== message.name) throw new Error('Unmatched tool result');
        pending.delete(message.tool_call_id);
        continue;
      }
      if (pending.size || !['user', 'assistant'].includes(message.role)
        || !fields(message, message.role === 'user' ? ['role', 'content'] : ['role', 'content', 'toolCalls'])) throw new Error('Invalid conversation order');
      if (message.toolCalls !== undefined) {
        if (!Array.isArray(message.toolCalls)) throw new Error('Invalid tool calls');
        for (const call of message.toolCalls) {
          if (!fields(call, ['id', 'name', 'args'])) throw new Error('Invalid tool call fields');
          const normalized = toolCall(call);
          if (pending.has(normalized.id)) throw new Error('Duplicate tool call');
          pending.set(normalized.id, normalized.name);
        }
      }
    }
    if (pending.size) throw new Error('Incomplete tool exchange');
    return snapshotJson(saved.messages);
  } catch (cause) {
    throw new Error(`Invalid saved Zero state at ${PATH}; original data retained`, { cause });
  }
}

/** Small host strategy over the shared engine. Provider and store remain caller-owned.
 * Store writes must honor control.signal at commit if they yield before committing.
 * Cancellation drains borrowed work; it cannot forcibly terminate arbitrary JavaScript.
 */
export async function createZeroAgent({ provider, tools, store, config = {}, onChange } = {}) {
  if (typeof provider?.chat !== 'function' || typeof tools?.execute !== 'function'
    || typeof tools?.schemas !== 'function' || typeof tools?.dispose !== 'function'
    || typeof store?.read !== 'function' || typeof store?.write !== 'function') throw new TypeError('Zero requires provider, tools and store ports');
  let committed = restore(await store.read(PATH));
  const state = { status: 'idle', messages: committed, error: null, iteration: 0 };
  let active = null;
  let closed = false;
  let cancelled = false;
  let disposal = null;
  const snapshot = () => snapshotJson({ ...state, events: engine.getEvents() });
  const emit = () => {
    try { onChange?.(snapshot()); } catch { /* Presentation cannot change execution. */ }
  };
  const engine = createExecutionEngine({ onEvent: emit });
  const update = patch => { Object.assign(state, patch); emit(); };

  function run(prompt) {
    if (closed) return Promise.reject(new Error('Zero is disposed'));
    if (active) return Promise.reject(new Error('Zero is already running or settling'));
    if (typeof prompt !== 'string' || !prompt.trim()) return Promise.reject(new TypeError('A nonempty prompt is required'));
    let settings;
    try {
      settings = freezeJson(snapshotJson(config));
      if (!object(settings) || !Number.isSafeInteger(settings.maxIterations ?? 8)
        || (settings.maxIterations ?? 8) < 1 || (settings.maxIterations ?? 8) > 64
        || (settings.systemPrompt !== undefined && typeof settings.systemPrompt !== 'string')) throw new TypeError('Invalid Zero run configuration');
    } catch (error) {
      update({ status: 'error', error: textError(error) });
      return Promise.reject(error);
    }
    const chat = provider.chat.bind(provider);
    const execute = tools.execute.bind(tools);
    const schemas = tools.schemas.bind(tools);
    const requestId = `zero_${crypto.randomUUID()}`;
    cancelled = false;
    let failure = null;
    const readSchemas = async () => {
      const list = snapshotJson(await schemas());
      if (!Array.isArray(list)) throw new TypeError('Tool schemas must be an array');
      const names = list.map(schema => schema?.function?.name ?? schema?.name);
      if (names.some(name => typeof name !== 'string' || !name.trim()) || new Set(names).size !== names.length) throw new TypeError('Invalid tool schema names');
      return { list, names };
    };
    const attempt = engine.start(async signal => {
      signal.throwIfAborted();
      const save = async messages => {
        signal.throwIfAborted();
        const next = snapshotJson(messages);
        await engine.invoke(() => store.write(PATH, JSON.stringify({ schema: SCHEMA, messages: next }), { signal }));
        signal.throwIfAborted();
        committed = next;
        update({ messages: committed });
      };
      update({ status: 'thinking', error: null, iteration: 0 });
      await save([...committed, { role: 'user', content: prompt }]);
      let finished = false;
      await engine.turns({ canContinue: () => state.iteration < (settings.maxIterations ?? 8), turn: async () => {
        update({ status: 'thinking', iteration: state.iteration + 1 });
        const surface = await engine.invoke(readSchemas);
        const input = settings.systemPrompt ? [{ role: 'system', content: settings.systemPrompt }, ...committed] : committed;
        const response = await engine.provider(() => chat(snapshotJson(input),
          snapshotJson({ ...settings, tools: surface.list }), `${requestId}_${state.iteration}`, { signal }));
        if (!object(response) || (response.content != null && typeof response.content !== 'string')
          || (response.toolCalls != null && !Array.isArray(response.toolCalls))
          || (typeof response.content !== 'string' && !response.toolCalls?.length)) throw new TypeError('Invalid provider response');
        const calls = (response.toolCalls || []).map((call, index) => toolCall(call, `${requestId}_${state.iteration}_${index}`));
        if (calls.length > 64 || new Set(calls.map(call => call.id)).size !== calls.length) throw new TypeError('Invalid native tool call batch');
        const content = response.content || '';
        engine.interpret({ content, toolCalls: calls }, () => []);
        signal.throwIfAborted();
        const messages = [...committed, { role: 'assistant', content, ...(calls.length ? { toolCalls: calls } : {}) }];
        update({ messages });
        for (const call of calls) {
          signal.throwIfAborted();
          update({ status: 'running' });
          const result = await engine.tool({ call, policy: { tools: { allowed: surface.names, allowDynamic: false } },
            authorize: async ({ name }) => (await readSchemas()).names.includes(name), execute });
          signal.throwIfAborted();
          const content = result.status === 'completed'
            ? typeof result.value === 'string' ? result.value : JSON.stringify(snapshotJson(result.value ?? null))
            : `Error: ${textError(result.error)}`;
          messages.push({ role: 'tool', name: call.name, tool_call_id: call.id, content });
          update({ messages, ...(result.status === 'completed' ? {} : { error: textError(result.error) }) });
        }
        await save(messages);
        if (!calls.length) { finished = true; return TURN_RETURN; }
      } });
      signal.throwIfAborted();
      if (!finished) throw new Error('Zero iteration limit reached');
    });
    active = (async () => {
      try { await attempt; }
      catch (error) {
        failure = error;
        if (!cancelled) update({ status: 'error', error: textError(error) });
        throw error;
      } finally {
        await engine.settle();
        active = null;
        update({ messages: committed, ...(!closed ? { status: cancelled ? 'stopped' : failure ? 'error' : 'completed' } : {}) });
      }
      return snapshot();
    })();
    return active;
  }

  async function stop() {
    if (active) {
      if (!cancelled) {
        cancelled = true;
        engine.cancel();
        update({ status: 'stopping' });
      }
      await active.catch(() => {});
    }
    return snapshot();
  }

  function dispose() {
    if (disposal) return disposal;
    closed = true;
    cancelled = true;
    engine.cancel();
    disposal = Promise.resolve().then(async () => {
      await active?.catch(() => {});
      await engine.close();
      await tools.dispose();
      update({ status: 'disposed' });
    }).catch(error => {
      disposal = null;
      update({ status: 'error', error: textError(error) });
      throw error;
    });
    update({ status: 'stopping' });
    return disposal;
  }
  emit();
  return Object.freeze({ run, stop, dispose, snapshot });
}

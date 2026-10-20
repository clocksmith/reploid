import { openPluginSession } from '../vendor/reploid/plugins/index.js';
import { modelImitationPlugin } from '../plugins/model-imitation/plugin.js';
import protocol from '../plugins/model-imitation/protocol.json' with { type: 'json' };

const PREFIX = 'reploid.plugin-session:';
const LAST = 'reploid.plugin-latest:model-imitation';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const modelBinding = model => ({ id: model.id, name: model.name, identity: model.identity });
const randomBelow = limit => {
  const ceiling = Math.floor(0x100000000 / limit) * limit;
  let value;
  do { value = crypto.getRandomValues(new Uint32Array(1))[0]; } while (value >= ceiling);
  return value % limit;
};

/** Exact-model host port, reusing the existing authenticated whole-request transport.
 * No plugin receives a swarm, credential, arbitrary fetch, or storage handle. */
export function createResearchPlugins({ chat, swarm, storage }) {
  const store = {
    async load(id) { const value = storage.getItem(PREFIX + id); return value ? JSON.parse(value) : null; },
    async save(id, value) { storage.setItem(PREFIX + id, JSON.stringify(value)); storage.setItem(LAST, id); }
  };
  const models = () => chat.getState().models.filter(model => !model.partition && !model.adapters?.length && model.provider === 'doppler');
  const recipients = model => (swarm.getState().consumer?.peers || []).filter(peer => peer.model === model.id
    && peer.modelIdentity === model.identity && peer.role === 'provider' && peer.readiness === 'ready'
    && peer.availableSlots > 0 && !peer.adapterIdentities?.length)
    .map(peer => peer.peerId);
  const open = async (sessionId, config) => {
    // The saved consent/configuration, not mutable UI controls, owns each capability invocation.
    const frozen = config || (await store.load(sessionId))?.config;
    assert(frozen, 'Study configuration missing');
    const generate = async (input, { signal, observe }) => {
      assert(frozen.approved === true && frozen.models.some(model => model.id === input.model.id && model.identity === input.model.identity), 'Study model is outside consent');
      assert(input.maxOutputTokens === protocol.maxOutputTokens && input.messages.length <= 4
        && JSON.stringify(input.messages).length <= 48000, 'Study request exceeds its declared bounds');
      const permissions = [];
      const started = performance.now();
      const result = await swarm.generate(input.messages, { signal, modelId: input.model.id, modelIdentity: input.model.identity,
        adapterIdentities: [], onPartial: () => {},
        approve: async preview => frozen.recipients.includes(preview.providerId) && preview.modelId === input.model.id
          && preview.modelIdentity === input.model.identity && preview.adapterIdentities.length === 0,
        record: async value => { permissions.push(structuredClone(value)); await observe(value); }
      });
      assert(result.model === input.model.id && result.modelIdentity === input.model.identity
        && result.provider === 'doppler' && !result.adapterIdentities?.length, 'Study response identity mismatch');
      assert(typeof result.content === 'string' && result.content.length <= protocol.maxAnswerCharacters, 'Study response exceeds text budget');
      return { content: result.content, model: modelBinding(input.model), peerId: result.peerId,
        elapsedMs: performance.now() - started, timing: result.timing ?? null, completion: result.completion ?? null,
        usage: result.usage ?? null, permissions };
    };
    return openPluginSession({ definition: modelImitationPlugin, config, sessionId, store,
      capabilities: { 'model.generate': generate } });
  };
  return {
    models,
    recipients,
    async restore() { const id = storage.getItem(LAST); return id ? open(id) : null; },
    async create({ targetId, imitatorId, approved }) {
      assert(approved === true, 'Approve the study disclosure before starting');
      const target = models().find(model => model.id === targetId), imitator = models().find(model => model.id === imitatorId);
      assert(target && imitator && target.identity !== imitator.identity, 'Choose two different catalog models');
      assert(recipients(target).length && recipients(imitator).length, 'Both models need connected contributors');
      const shuffle = () => {
        const result = [0, 1, 2, 3];
        for (let i = result.length - 1; i > 0; i--) { const j = randomBelow(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
        return result;
      };
      const order = shuffle();
      const config = { target: modelBinding(target), imitator: modelBinding(imitator), models: [target, imitator].map(modelBinding),
        protocol: structuredClone(protocol), order, conditionOrder: shuffle(), sides: order.map(() => randomBelow(2)), approved,
        recipients: [...new Set([...recipients(target), ...recipients(imitator)])], consentAt: Date.now(),
        consent: 'Send the frozen public study prompts, calibration examples and trial follow-ups to these contributors. Keep results on this browser until exported.' };
      return open(crypto.randomUUID(), config);
    }
  };
}

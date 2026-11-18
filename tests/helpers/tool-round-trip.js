// @vitest-environment node
// A tool-call fixture for the HTTP text API: real HTTP, bearer auth, SQLite credits, the fleet
// service and two meshes joined in memory, with the REAL native whole-model provider (resident
// owner, scoped provider, conversation rendering, constraint compilation and token mask) on the
// provider side. Only the Doppler session is a stand-in: a small tokenizer and a scripted model
// that proposes logits each step, lets the mask edit them and emits the best token left. Nothing
// here is a model run or a physical peer.
import { expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { createNativeWholeModel } from '../../server/native-whole-model.js';
import { TOOL_CALL_FORMAT, expectedConstraintIdentity } from '../../shared/infrastructure/tool-call-constraint.js';
import { createRecoveryMesh } from './generation-recovery-mesh.js';

export const token = 'synthetic-fleet-api-bearer-secret-0123456789abcdef';
export const OUTPUT_CEILING = 64;
export const addTool = { name: 'add', description: 'Add two integers.',
  parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false } };
export const question = 'What is 2 + 3?';
export const callText = (name, args) => `<tool_call>\n{"name": "${name}", "arguments": ${args}}\n</tool_call>`;
export const addCall = callText('add', '{"a": 2, "b": 3}');

/** A tokenizer with single characters and a few longer pieces, so a call takes about twenty tokens.
 * Two tokens end generation, as a chat model has: the tokenizer's end of sequence and a stop token. */
export function createFakeTokenizer() {
  const pieces = ['<tool_call>', '</tool_call>', '{"name":', '"arguments":', 'add', 'subtract', 'The', ' sum', ' is', 'two'];
  const texts = ['', '', ...pieces, '\n', ...Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index))];
  return { texts, eos: 0, stop: 1, vocabSize: texts.length,
    decode: ids => ids.map(id => texts[id] ?? '').join('') };
}

/**
 * A Doppler scoped session whose model follows a script. `plan(messages)` returns the outputs the
 * model would write, most preferred first. Each step scores every token that continues one of
 * them (a more preferred output scores higher, and its end scores a stop token), gives the rest
 * a low score, applies `options.logitMaskFn` exactly as Doppler does, and emits the best token.
 * `unmasked` is the same model with the mask left out: a provider that does not enforce.
 */
export function createScriptedSession({ model, plan, tokenizer = createFakeTokenizer(), unmasked = false, seen = [] }) {
  const { texts, eos, stop, vocabSize } = tokenizer;
  const propose = (scripts, generated) => {
    const logits = Float32Array.from({ length: vocabSize }, (_, id) => -20 - id / 1000);
    scripts.forEach((script, rank) => {
      if (!script.startsWith(generated)) return;
      const rest = script.slice(generated.length), weight = (scripts.length - rank) * 10;
      if (rest === '') { logits[stop] = Math.max(logits[stop], weight); logits[eos] = Math.max(logits[eos], weight - 1); return; }
      texts.forEach((text, id) => { if (text && rest.startsWith(text)) logits[id] = Math.max(logits[id], weight + text.length / 100); });
    });
    return logits;
  };
  return { loaded: true, modelId: model.id, manifestHash: model.identity, activeLoRA: null, deviceInfo: null, tokenizer,
    supports: capability => capability === 'advanced', async resetGenerationState() {},
    advanced: { getStopTokenIds: () => [stop], getSpecialTokens: () => ({ eos }), getStats: () => null },
    async *stream(messages, options) {
      // Doppler's chat templates take plain string messages of these three roles and nothing else.
      for (const message of messages) {
        if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string'
          || Object.keys(message).some(key => !['role', 'content'].includes(key))) throw Error('The chat template has no tool support');
      }
      seen.push({ messages: structuredClone(messages), options });
      const scripts = plan(messages), generatedIds = [], limit = options.maxTokens ?? 256;
      let outputText = '', stopReason = 'max-tokens';
      while (generatedIds.length < limit) {
        const logits = propose(scripts, outputText);
        if (options.logitMaskFn && !unmasked) options.logitMaskFn(logits, { generatedIds: [...generatedIds], tokenizer, vocabSize });
        let best = 0;
        for (let id = 1; id < vocabSize; id++) if (logits[id] > logits[best]) best = id;
        if (best === eos || best === stop) { stopReason = best === eos ? 'eos-token' : 'stop-token'; break; }
        generatedIds.push(best);
        outputText += texts[best];
        yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: texts[best] };
      }
      yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText, completion: { schema: 'doppler.generation-completion/v1',
        stopReason, promptTokenCount: messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0),
        generatedTokenCount: generatedIds.length } };
    } };
}

/** The model of the round trip: it answers from a tool result when one is in the conversation,
 * and otherwise would rather answer in prose, with the add call as its second choice. */
export const roundTripPlan = messages => (messages.at(-1).content.includes('<tool_response>')
  ? [`The sum is ${/<tool_response>\n(.*)\n<\/tool_response>/.exec(messages.at(-1).content)[1]}.`] : ['The sum is 5.', addCall]);

/**
 * `open({ plan, unmasked, execute, intercept, toolCallFormat })` starts the whole path and returns
 * `{ url, post(path, body, headers), sent(type), executed, seen, reservations, row(index), amounts(),
 * journal(), keys, model, mesh, close() }`. `execute(provider, messages, update, controls)` may
 * replace the provider call, for a provider that misreports. `seen` holds what reached the session.
 * `ceiling` is the model's prepared output ceiling, which a Messages or Responses limit cannot lower.
 */
export function createToolRoundTrip({ ceiling = OUTPUT_CEILING } = {}) {
  let root, keys, credits, service, requesterCredits, providerCredits, model;
  return {
    async setup() {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-round-trip-'));
      const manifest = JSON.stringify({ modelId: 'tool-model' });
      await fs.mkdir(path.join(root, 'model'));
      await fs.writeFile(path.join(root, 'model', 'manifest.json'), manifest);
      model = { id: 'tool-model', provider: 'doppler', identity: 'sha256:' + createHash('sha256').update(manifest).digest('hex'),
        generation: { maxTokens: ceiling } };
      keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
      credits = await openFleetCredits({
        file: path.join(root, 'credits.sqlite'),
        computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
          providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
        policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
          creditsPerOutputToken: 1, maxDebt: 1000, maxOutputTokens: OUTPUT_CEILING, maxPendingPerComputer: 2,
          maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: true, wholeModelTerminalCharge: 0 }
      });
      service = await startFleetService({ credits, models: [model],
        placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
      requesterCredits = createFleetClient({ url: service.url, identity: keys[0] });
      providerCredits = createFleetClient({ url: service.url, identity: keys[1] });
    },
    async teardown() {
      await service?.close();
      credits?.close();
      await fs.rm(root, { recursive: true, force: true });
    },
    async open({ plan = roundTripPlan, unmasked = false, execute = null, intercept = null, toolCallFormat = TOOL_CALL_FORMAT } = {}) {
      const cleanup = [], executed = [], seen = [], reservations = [], journalStart = credits.snapshot().journal.length;
      const catalogModel = { ...model, ...(toolCallFormat ? { toolCallFormat } : {}) };
      // The real provider chain over the scripted session: native whole model, resident owner, scoped provider.
      const provider = createNativeWholeModel({ model: catalogModel, modelDirectory: path.join(root, 'model'), nativeGpu: async () => {},
        configureMemory: async () => {},
        service: { open: async () => createScriptedSession({ model: catalogModel, plan, unmasked, seen }), close: async () => {} } });
      await provider.contribute(true);
      cleanup.push(() => provider.close());
      const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
      let wholeRequester;
      const mesh = await createRecoveryMesh(cleanup, {
        identities: keys, modelId: model.id, modelIdentity: model.identity, intercept,
        authorize: async input => {
          if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
          if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
          return true;
        },
        execute: async (received, update, controls) => {
          executed.push({ messages: structuredClone(received), settings: controls.settings });
          return execute ? execute(provider, received, update, controls) : provider.generate(received, update, controls);
        },
        onGenerationTerminal: proof => admission.terminal(proof),
        // The provider advertises what the real native provider reports; the requester expects the
        // constraint the shared engine derives from the settings, as the native requester does.
        ports: index => (index ? { getGenerationSettingsCapability: () => provider.getGenerationSettingsCapability() }
          : { expectedConstraintIdentity })
      });
      wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
      const host = {
        identity: keys[0], credits: requesterCredits,
        allowsModel: candidate => candidate?.id === model.id && candidate?.identity === model.identity,
        async enrolledRecipients() {
          const network = await requesterCredits.call('computers', {});
          return new Set((network.computers || []).flatMap(row => row.participantIds || []));
        },
        textParticipant: { roomId: 'reploid-swarm-fleet-fixture', executionClass: 'private-pool',
          getState: () => ({ models: wholeRequester.getModels() }),
          generate: (request, controls) => wholeRequester.generate(request, controls),
          recoverGeneration: (request, reference, controls) => wholeRequester.recover(request, reference, controls) },
        async runAccountedGeneration(request, controls, run) {
          const requester = createFleetRequester({ participant: { generate: run }, identity: keys[0], credits: requesterCredits, maxOutputTokens: OUTPUT_CEILING });
          const result = await requester.generate(request, { ...controls, onReservation(id) { reservations.push(id); controls.onReservation?.(id); } });
          return { ...result, execution: { ...result.execution, serviceCredit: result.serviceCredit } };
        }
      };
      const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[1].peerId] });
      cleanup.push(() => api.close());
      return { url: api.url, mesh, executed, seen, reservations, keys, model, provider,
        post: (route, body, headers = {}) => fetch(`${api.url}${route}`, { method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
        sent: type => mesh.wire.filter(item => item.type === type).map(item => item.payload),
        row: (index = -1) => credits.request(reservations.at(index)),
        amounts: () => credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held })),
        journal: () => credits.snapshot().journal.slice(journalStart),
        /** Every reservation made through this path so far is settled, each with one debit and one credit. */
        async settled(count) {
          await vi.waitFor(() => expect(reservations.map(id => credits.request(id).state)).toEqual(Array(count).fill('settled')));
          expect(credits.snapshot().journal.slice(journalStart)).toHaveLength(2 * count);
        },
        close: async () => { for (const close of cleanup.reverse()) await close(); } };
    }
  };
}

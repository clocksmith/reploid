// @vitest-environment node
import http from 'node:http';
import { bindPreview } from '../helpers/bound-preview.js';
import { createExecutionPolicy, bindExecutionRoute, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatCompletions } from '../../server/chat-completions.js';
import { createMessages } from '../../server/messages.js';
import { deriveStatelessConversationThreadId } from '../../server/text-requester.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { GENERATION_CONTRACT } from '../../shared/config/doppler-generation-contract.js';
import { openScopedModelProvider } from '../../shared/infrastructure/scoped-model-provider.js';
import workProfile from '../../apps/poolday/config/work-profile.json' with { type: 'json' };

const model = {
  id: 'qwen-3-5-2b-q4k-ef16-af32',
  provider: 'doppler',
  identity: 'sha256:' + 'b'.repeat(64),
  generation: { maxTokens: 64 },
};
const owners = [];
afterEach(async () => {
  for (const close of owners.splice(0).reverse()) await close();
});

async function mountRoute(createRoute, path, participant, { subjectForToken, statelessPrefixCache } = {}) {
  const authorize = vi.fn(async () => true);
  const authenticate = vi.fn(async (req) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    return { subject: subjectForToken ? subjectForToken(token) : token };
  });
  const route = createRoute({
    authenticate,
    authorize,
    participant,
    ...(typeof statelessPrefixCache === 'boolean' ? { statelessPrefixCache } : {}),
  });
  const server = http.createServer(route.handle);
  const close = async () => {
    await route.close();
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  owners.push(close);
  const url = `http://127.0.0.1:${server.address().port}${path}`;
  const post = (body, token = 'user-1', extraHeaders = {}) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { url, post, authorize, authenticate };
}

it('derives identical threadId across multi-turn follow-ups and isolates by principal and model', () => {
  const turn1 = [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Hi' }];
  const turn2 = [...turn1, { role: 'assistant', content: 'Hello.' }, { role: 'user', content: 'Next?' }];
  const a1 = deriveStatelessConversationThreadId({ subject: 'alice', modelIdentity: model.identity, messages: turn1 });
  const a2 = deriveStatelessConversationThreadId({ subject: 'alice', modelIdentity: model.identity, messages: turn2 });
  const bob = deriveStatelessConversationThreadId({ subject: 'bob', modelIdentity: model.identity, messages: turn1 });
  const otherModel = deriveStatelessConversationThreadId({ subject: 'alice', modelIdentity: 'sha256:' + 'c'.repeat(64), messages: turn1 });
  expect(a1).toMatch(/^conv_[0-9a-f]{32}$/);
  expect(a1).toBe(a2);
  expect(a1).not.toBe(bob);
  expect(a1).not.toBe(otherModel);
});

it('reuses GenerationContext across stateless multi-turn /v1/chat/completions requests, surfaces real provider reusedPrefixTokens, and handles incompatible prefixes + user isolation', async () => {
  const createdContexts = [];
  const usedContextIds = [];
  let lastStats = null;
  const session = {
    loaded: true,
    modelId: model.id,
    manifestHash: model.identity.slice(7),
    activeLoRA: null,
    supports: (cap) => cap === 'generationContext' || cap === 'advanced',
    advanced: {
      getStats: () => lastStats,
    },
    createGenerationContext({ maxBytes }) {
      const ctx = {
        id: createdContexts.length + 1,
        maxBytes,
        closed: false,
        savedMessages: null,
        savedTokens: 0,
        getStats: () => ({ allocatedBytes: 1024, cachedTokens: ctx.savedTokens }),
        close() { this.closed = true; },
      };
      createdContexts.push(ctx);
      return ctx;
    },
    async resetGenerationState() {},
    async *stream(messages, options) {
      const ctx = options.generationContext;
      usedContextIds.push(ctx?.id ?? null);
      const promptTokens = messages.length * 5;
      const prefixMatches = Boolean(
        ctx?.savedMessages
        && messages.length > ctx.savedMessages.length
        && ctx.savedMessages.every((saved, i) => saved.role === messages[i]?.role && saved.content === messages[i]?.content)
      );
      const reusedPrefixTokens = prefixMatches ? ctx.savedTokens : 0;
      const prefillComputedTokens = promptTokens - reusedPrefixTokens;
      if (ctx) {
        ctx.savedMessages = structuredClone(messages);
        ctx.savedTokens = promptTokens;
      }
      lastStats = {
        totalTimeMs: reusedPrefixTokens > 0 ? 12 : 45,
        prefillTimeMs: reusedPrefixTokens > 0 ? 4 : 37,
        decodeTimeMs: 8,
        ttftMs: reusedPrefixTokens > 0 ? 5 : 38,
        tokensGenerated: 1,
        reusedPrefixTokens,
        prefillComputedTokens,
      };
      yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'ok' };
      yield {
        schema: 'doppler.generation-event/v1',
        type: 'complete',
        outputText: 'ok',
        completion: {
          schema: GENERATION_CONTRACT.completionSchema,
          stopReason: 'eos-token',
          promptTokenCount: promptTokens,
          generatedTokenCount: 1,
        },
      };
    },
  };
  const provider = await openScopedModelProvider({
    model,
    service: { open: async () => session },
    scope: 'test',
    signal: new AbortController().signal,
    generation: model.generation,
    maxOutcomeCharacters: 4096,
    providerPolicy: workProfile,
  });
  owners.push(() => provider.close());

  let requester;
  const mesh = {
    getSwarmSnapshot: () => ({
      peers: [{
        peerId: 'p1',
        model: model.id,
        modelIdentity: model.identity,
        readiness: 'ready',
        hasInference: true,
        availableSlots: 1,
        identityProtocol: 1,
        admissionProtocol: 2,
      }],
    }),
    async generate(messages, onDelta, options) {
      const privacyBinding = await bindExecutionRoute({ model, privacy: options.privacy }, plaintextExecutionRoute({ model }, { recipients: ['p1'] }));
      const allowed = await requester.authorize({
        action: 'mesh.dispatch',
        privacyBinding, recipientIdentity: 'p1', admission: { schema: 'reploid.generation-admission/v2' },
        requestContext: options.requestContext,
        peerId: 'p1',
        modelId: options.modelId,
        modelIdentity: options.modelIdentity,
        adapterIdentities: options.adapterIdentities,
        messages,
      });
      if (!allowed) throw new Error('Disclosure denied');
      return provider.generate(messages, onDelta, {
        signal: options.signal,
        contextOwner: options.contextOwner ?? 'shared-owner',
        contextId: options.requestContext.contextId,
      });
    },
  };
  requester = createWholeModelRequester({ mesh, models: [model] });
  const participant = { getState: () => ({ models: requester.getModels() }),
    // Narrow the request's own compiled policy to the one provider rather than replacing it with a broader default.
    generate: (request, controls) => requester.generate({ ...request, privacy: createExecutionPolicy({
      ...request.privacy, recipients: { kind: 'named', ids: ['p1'] }
    }) }, controls) };
  const route = await mountRoute(createChatCompletions, '/v1/chat/completions', participant);

  const turn1 = [{ role: 'system', content: 'Rules.' }, { role: 'user', content: 'First.' }];
  const turn2 = [...turn1, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'Second.' }];
  // Same root (system + First.) so LRU hits context 1, but mutated assistant turn forces exact-prefix miss.
  const turn3Incompatible = [...turn1, { role: 'assistant', content: 'EDITED' }, { role: 'user', content: 'Third.' }];

  const r1 = await route.post({ model: model.id, messages: turn1 }, 'alice');
  expect(r1.status).toBe(200);
  const b1 = await r1.json();
  expect(r1.headers.get('x-reploid-reused-prefix-tokens')).toBe('0');
  expect(r1.headers.get('x-reploid-prefill-computed-tokens')).toBe('10');
  expect(b1.usage.prompt_tokens_details).toBeUndefined();

  const r2 = await route.post({ model: model.id, messages: turn2 }, 'alice');
  expect(r2.status).toBe(200);
  const b2 = await r2.json();
  expect(r2.headers.get('x-reploid-reused-prefix-tokens')).toBe('10');
  expect(r2.headers.get('x-reploid-prefill-computed-tokens')).toBe('10');
  expect(b2.usage.prompt_tokens_details).toEqual({ cached_tokens: 10 });

  const r3 = await route.post({ model: model.id, messages: turn3Incompatible }, 'alice');
  expect(r3.status).toBe(200);
  const b3 = await r3.json();
  expect(r3.headers.get('x-reploid-reused-prefix-tokens')).toBe('0');
  expect(r3.headers.get('x-reploid-prefill-computed-tokens')).toBe('20');
  expect(b3.usage.prompt_tokens_details).toBeUndefined();

  const rBob = await route.post({ model: model.id, messages: turn1 }, 'bob');
  expect(rBob.status).toBe(200);
  const bBob = await rBob.json();
  expect(rBob.headers.get('x-reploid-reused-prefix-tokens')).toBe('0');
  expect(bBob.usage.prompt_tokens_details).toBeUndefined();

  expect(usedContextIds).toEqual([1, 1, 1, 2]);
  expect(provider.getContextCacheStats()).toMatchObject({ entries: 2, hits: 2, misses: 2 });

  // Explicit cache-off control produces fresh uncached threadIds and zero prefix reuse.
  const routeOff = await mountRoute(createChatCompletions, '/v1/chat/completions', participant, { statelessPrefixCache: false });
  const rOff1 = await routeOff.post({ model: model.id, messages: turn1 }, 'carol');
  const rOff2 = await routeOff.post({ model: model.id, messages: turn2 }, 'carol');
  expect(rOff1.status).toBe(200);
  expect(rOff2.status).toBe(200);
  expect(rOff2.headers.get('x-reploid-reused-prefix-tokens')).toBe('0');
  expect((await rOff2.json()).usage.prompt_tokens_details).toBeUndefined();
  expect(usedContextIds.slice(4)).toEqual([3, 4]);
});

it('falls back to a fresh threadId when two identical stateless requests run concurrently', async () => {
  const firstEntered = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  const seenThreadIds = [];
  let callIndex = 0;

  const participant = {
    getState: () => ({
      models: [{
        id: model.id,
        identity: model.identity,
        availability: 'ready',
        providerIds: ['p1'],
        textGeneration: { schema: 'reploid.text-generation/v1', usage: 'raw-model-tokens/v1' },
        generationSettings: { schema: 'reploid.generation-settings-capability/v1', maxOutputTokens: true, tools: false, outputSchema: false, thinking: false },
      }],
    }),
    async generate(request, controls) {
      const idx = ++callIndex;
      seenThreadIds.push(request.threadId);
      await controls.requestApproval(await bindPreview(request, {
        threadId: request.threadId,
        attemptId: request.attemptId,
        modelId: request.model.id,
        modelIdentity: request.model.identity,
        recipients: ['p1'],
        input: {
          messages: request.messages,
          ...(request.generationRequest ? { generationRequest: request.generationRequest } : {}),
          ...(request.settings ? { settings: request.settings } : {}),
        },
      }));
      if (idx === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
      }
      controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: 0, text: 'ok' });
      return {
        threadId: request.threadId,
        attemptId: request.attemptId,
        modelId: request.model.id,
        modelIdentity: request.model.identity,
        content: 'ok',
        usage: { schema: 'raw-model-tokens/v1', inputTokens: 4, outputTokens: 1 },
        execution: { stopReason: 'stop-token', completion: { promptTokenCount: 4, generatedTokenCount: 1 } },
      };
    },
  };

  const route = await mountRoute(createMessages, '/v1/messages', participant);
  const body = { model: model.id, max_tokens: 16, messages: [{ role: 'user', content: 'same' }] };
  const headers = { 'anthropic-version': '2023-06-01' };
  const p1 = route.post(body, 'alice', headers);
  await firstEntered.promise;
  const p2 = route.post(body, 'alice', headers);
  const r2 = await p2;
  releaseFirst.resolve();
  const r1 = await p1;
  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(seenThreadIds[0]).toMatch(/^conv_[0-9a-f]{32}$/);
  expect(seenThreadIds[1]).not.toBe(seenThreadIds[0]);
});

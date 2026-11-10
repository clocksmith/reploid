// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester, buildFleetRequestOutcome } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import tunnelWorker from '../../server/fleet/cloudflare-tunnel-worker.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const model = { id: 'qwen-3-5-2b-q4k-ehaf16', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', generation: { maxTokens: 16 } };
const token = 'synthetic-fleet-api-bearer-secret-0123456789abcdef';
const roomId = 'reploid-swarm-fleet-fixture';

let root, keys, credits, service, requesterCredits, providerCredits;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet-text-api-'));
  keys = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({
    file: path.join(root, 'credits.sqlite'),
    computers: keys.slice(0, 2).map((key, index) => ({
      id: `machine-${index}`, name: `Machine ${index}`, ownerId: 'owner',
      providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }]
    })),
    policy: {
      schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt: 100, maxOutputTokens: 16, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: true, wholeModelTerminalCharge: 0
    }
  });
  service = await startFleetService({
    credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 }
  });
  requesterCredits = createFleetClient({ url: service.url, identity: keys[0] });
  providerCredits = createFleetClient({ url: service.url, identity: keys[1] });
});

afterEach(async () => {
  await service?.close();
  credits?.close();
  await rm(root, { recursive: true, force: true });
});

function createHostAdapter(wholeRequester, mesh = null) {
  const outcomes = new Map(), allOutcomes = [];
  const recordOutcome = outcome => {
    allOutcomes.push(outcome);
    if (outcome?.attemptId) outcomes.set(outcome.attemptId, outcome);
    if (outcome?.reservationId) outcomes.set(outcome.reservationId, outcome);
    return outcome;
  };
  const lookupOutcome = id => outcomes.get(id) ?? null;
  const resolveProviderId = (_reservationId, binding) => {
    const target = binding?.providers?.[0]?.participantId;
    const peers = mesh?.getSwarmSnapshot().peers || [];
    return peers.find(peer => peer.participantId === target)?.peerId ?? null;
  };
  const textParticipant = {
    roomId,
    executionClass: 'private-pool',
    getState: () => ({ models: wholeRequester.getModels() }),
    generate: (request, controls) => wholeRequester.generate(request, controls),
    recoverGeneration: wholeRequester.recover ? (request, reference, controls) => wholeRequester.recover(request, reference, controls) : undefined
  };
  return {
    identity: keys[0],
    credits: requesterCredits,
    outcomes: allOutcomes,
    outcome: lookupOutcome,
    async inspectOutcome(id) {
      const prior = lookupOutcome(id);
      const reservationId = prior?.reservationId ?? id;
      const row = await requesterCredits.call('request', { id: reservationId });
      const dispatched = row.state !== 'reserved' && row.state !== 'abandoned';
      const settlement = row.state === 'settled' ? row.outcome : { id: reservationId, status: 'pending' };
      return recordOutcome(buildFleetRequestOutcome({
        attemptId: prior?.attemptId ?? null,
        threadId: prior?.threadId ?? null,
        reservationId,
        executionId: row.binding.executionId,
        mode: row.binding.mode,
        model: row.binding.model,
        providerId: prior?.providerId ?? null,
        providerIdentity: row.binding.providers[0]?.participantId ?? null,
        inputDigest: row.binding.inputDigest,
        phase: dispatched ? 'in-flight' : 'queued',
        dispatched,
        acknowledged: prior?.acknowledged ?? { deltaCount: 0, outputCharacters: 0, acknowledgedOutputTokens: 0 },
        settlement,
        maximum: dispatched ? row.binding.maximum : 0
      }));
    },
    allowsModel: candidate => candidate?.id === model.id && candidate?.identity === model.identity,
    async enrolledRecipients() {
      const network = await requesterCredits.call('computers', {});
      return new Set((network.computers || []).flatMap(row => row.participantIds || []));
    },
    textParticipant,
    async runAccountedGeneration(request, controls, execute) {
      if (request.generationRequest && request.generationRequest.maxOutputTokens > 16) {
        throw Object.assign(Error('max_output_tokens exceeds fleet credit policy'), { status: 400, param: 'max_output_tokens' });
      }
      const requester = createFleetRequester({
        participant: { generate: execute, recoverGeneration: textParticipant.recoverGeneration },
        identity: keys[0],
        credits: requesterCredits,
        maxOutputTokens: 16,
        onOutcome: recordOutcome,
        lookupOutcome,
        resolveProviderId
      });
      const result = await requester.generate(request, controls);
      return { ...result, execution: { ...result.execution, serviceCredit: result.serviceCredit } };
    },
    async recoverAccountedGeneration(input, controls, recoverExecution) {
      const requester = createFleetRequester({
        participant: textParticipant,
        identity: keys[0],
        credits: requesterCredits,
        maxOutputTokens: 16,
        onOutcome: recordOutcome,
        lookupOutcome,
        resolveProviderId
      });
      return requester.recover(input, controls, recoverExecution);
    }
  };
}

const parseSse = raw => raw.trim().split('\n\n').map(frame => {
  const [eventLine, dataLine] = frame.split('\n');
  const parsed = JSON.parse(dataLine.slice(6));
  expect(eventLine).toBe(`event: ${parsed.type}`);
  return parsed;
});

it('refuses non-loopback HTTP binding without TLS and unauthenticated requests before execution', async () => {
  const host = createHostAdapter({ getModels: () => [], generate: vi.fn() });
  await expect(startFleetTextApi({ host, token, listenHost: '0.0.0.0' })).rejects.toThrow('TLS');
  const api = await startFleetTextApi({ host, token });
  try {
    expect((await fetch(`${api.url}/models`)).status).toBe(401);
    expect((await fetch(`${api.url}/responses`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ model: model.id, input: 'hi', store: false })
    })).status).toBe(401);
  } finally { await api.close(); }
});

it('streams authenticated /v1/responses over whole-model fleet capacity and settles non-cash credits', async () => {
  const cleanup = [];
  const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys.slice(0, 2), modelId: model.id, modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async (_messages, update) => {
      update('{"ok":'); update('true}');
      return {
        model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: '{"ok":true}',
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 11, generatedTokenCount: 4, stopReason: 'eos-token' }
      };
    },
    onGenerationTerminal: proof => admission.terminal(proof)
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const api = await startFleetTextApi({ host: createHostAdapter(wholeRequester), token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  try {
    const modelsRes = await fetch(`${api.url}/models`, { headers: { authorization: `Bearer ${token}` } });
    expect(modelsRes.status).toBe(200);
    expect(await modelsRes.json()).toMatchObject({ data: [{ id: model.id, model_identity: model.identity, adapter_identities: [] }] });

    const denied = await fetch(`${api.url}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: model.id, store: false, stream: true, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
        max_output_tokens: 16, text: { format: { type: 'json_object' } },
        reploid: { pool_id: roomId, expected_model_identity: model.identity, allowed_recipients: [keys[2].peerId], include_execution: true }
      })
    });
    expect(denied.status).toBe(403);
    expect(mesh.executions).toBe(0);

    const ok = await fetch(`${api.url}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: model.id, store: false, stream: true, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
        max_output_tokens: 16, text: { format: { type: 'json_object' } },
        reploid: {
          pool_id: roomId, expected_model_identity: model.identity,
          expected_adapter_identities: [], expected_plan_identity: null,
          allowed_recipients: [keys[1].peerId], include_execution: true
        }
      })
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-reploid-model-identity')).toBe(model.identity);
    const events = parseSse(await ok.text());
    const final = events.at(-1).response;
    expect(events.at(-1).type).toBe('response.completed');
    expect(final.output[0].content[0].text).toBe('{"ok":true}');
    expect(final.usage).toEqual({ input_tokens: 11, output_tokens: 4, total_tokens: 15 });
    expect(final.reploid).toMatchObject({
      schema: 'reploid.http-execution/v1', poolId: roomId, executionClass: 'private-pool',
      modelIdentity: model.identity, recipients: [keys[1].peerId],
      execution: {
        providerIdentity: keys[1].peerId,
        serviceCredit: { unit: 'noncash-service-credit', charge: 4, outputTokens: 4, settledAt: expect.any(Number) }
      }
    });
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: -4, held: 0 }, { balance: 4, held: 0 }
    ]);
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});

it('propagates HTTP stream cancellation to the whole-model provider and releases credit holds after cleanup', async () => {
  const cleanup = [], entered = Promise.withResolvers(), release = Promise.withResolvers();
  const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys.slice(0, 2), modelId: model.id, modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async (_messages, update, controls) => {
      entered.resolve();
      update('{"partial":');
      await release.promise;
      controls.signal.throwIfAborted();
    },
    onGenerationTerminal: proof => admission.terminal(proof)
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const host = createHostAdapter(wholeRequester, mesh.requesterMesh);
  const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  const controller = new AbortController();
  const promptMessages = [
    { role: 'system', content: 'Return exactly one valid JSON object. No markdown fences or commentary.' },
    { role: 'user', content: 'Return JSON only: {"ok":true}' }
  ];
  try {
    const response = await fetch(`${api.url}/responses`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: model.id, store: false, stream: true, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
        max_output_tokens: 16, text: { format: { type: 'json_object' } },
        reploid: { pool_id: roomId, expected_model_identity: model.identity, allowed_recipients: [keys[1].peerId], include_execution: true }
      })
    });
    const reservationId = response.headers.get('x-reploid-reservation-id');
    expect(reservationId).toMatch(/^service:/);
    const pending = response.text();
    pending.catch(() => {});
    await entered.promise;
    expect(credits.snapshot().accounts[0].held).toBe(16);
    controller.abort();
    await expect(pending).rejects.toThrow();

    // Disconnect never refunds or releases the credit hold while provider cleanup is unresolved.
    await vi.waitFor(() => expect(host.outcome(reservationId)).toBeTruthy());
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: 0, held: 16 }, { balance: 0, held: 0 }
    ]);
    expect(host.outcome(reservationId)).toMatchObject({
      schema: 'reploid.request-outcome/v1',
      reservationId,
      phase: 'in-flight',
      dispatched: true,
      acknowledged: { deltaCount: 1, outputCharacters: 11, acknowledgedOutputTokens: 0 },
      finished: null,
      unknown: { reservationId, providerIdentity: keys[1].peerId, providerExecution: 'unresolved', heldCredits: 16 }
    });
    const unresolvedRecovery = await fetch(`${api.url}/reploid/recover`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reservationId, messages: promptMessages })
    });
    expect(unresolvedRecovery.status).toBe(200);
    expect(await unresolvedRecovery.json()).toMatchObject({
      status: 'unresolved',
      serviceCredit: { id: reservationId, status: 'pending', heldCredits: 16 }
    });
    expect(credits.snapshot().accounts[0].held).toBe(16);

    release.resolve();
    await vi.waitFor(() => expect(credits.snapshot().accounts[0].held).toBe(0));
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: 0, held: 0 }, { balance: 0, held: 0 }
    ]);
    expect(await host.inspectOutcome(reservationId)).toMatchObject({
      phase: 'in-flight',
      dispatched: true,
      acknowledged: { deltaCount: 1, outputCharacters: 11, acknowledgedOutputTokens: 0 },
      finished: { status: 'cancelled', charge: 0, outputTokens: null },
      unknown: { providerExecutionTokensBeforeStop: 'unmetered' }
    });
  } finally {
    release.resolve();
    for (const close of cleanup.reverse()) await close();
  }
});

it('cancels a queued second request before dispatch when its client disconnects while the provider is busy', async () => {
  const cleanup = [], firstEntered = Promise.withResolvers(), releaseFirst = Promise.withResolvers();
  const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys.slice(0, 2), modelId: model.id, modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    execute: async (_messages, update) => {
      firstEntered.resolve();
      update('{"ok":');
      await releaseFirst.promise;
      update('true}');
      return {
        model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: '{"ok":true}',
        completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 11, generatedTokenCount: 4, stopReason: 'eos-token' }
      };
    },
    onGenerationTerminal: proof => admission.terminal(proof)
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const host = createHostAdapter(wholeRequester, mesh.requesterMesh);
  const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  const requestBody = JSON.stringify({
    model: model.id, store: false, stream: true, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
    max_output_tokens: 16, text: { format: { type: 'json_object' } },
    reploid: { pool_id: roomId, expected_model_identity: model.identity, allowed_recipients: [keys[1].peerId], include_execution: true }
  });
  const secondController = new AbortController();
  try {
    const first = fetch(`${api.url}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: requestBody
    });
    await firstEntered.promise;
    expect(credits.snapshot().accounts[0].held).toBe(16);

    // Model listing stays populated while the prepared provider is busy.
    const modelsWhileBusy = await fetch(`${api.url}/models`, { headers: { authorization: `Bearer ${token}` } });
    expect(modelsWhileBusy.status).toBe(200);
    expect((await modelsWhileBusy.json()).data).toHaveLength(1);

    // Second request enters pre-dispatch wait behind the active provider slot.
    const second = fetch(`${api.url}/responses`, {
      method: 'POST', signal: secondController.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: requestBody
    });
    second.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(credits.snapshot().accounts[0].held).toBe(16);
    secondController.abort();
    await expect(second).rejects.toThrow();

    await vi.waitFor(() => expect(host.outcomes.some(row => row.phase === 'queued')).toBe(true));
    const queuedOutcome = host.outcomes.find(row => row.phase === 'queued');
    expect(queuedOutcome).toMatchObject({
      schema: 'reploid.request-outcome/v1',
      phase: 'queued',
      dispatched: false,
      acknowledged: { deltaCount: 0, outputCharacters: 0, acknowledgedOutputTokens: 0 },
      finished: { status: 'cancelled_queued', charge: 0, outputTokens: 0 },
      unknown: null
    });

    releaseFirst.resolve();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    const events = parseSse(await firstRes.text());
    expect(events.at(-1).type).toBe('response.completed');
    expect(mesh.executions).toBe(1);
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: -4, held: 0 }, { balance: 4, held: 0 }
    ]);
  } finally {
    releaseFirst.resolve();
    for (const close of cleanup.reverse()) await close();
  }
});

it('reconciles a completed in-flight request via /v1/reploid/recover when disconnect races with completion', async () => {
  const cleanup = [];
  const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
  let wholeRequester;
  const promptMessages = [
    { role: 'system', content: 'Return exactly one valid JSON object. No markdown fences or commentary.' },
    { role: 'user', content: 'Return JSON only: {"ok":true}' }
  ];
  const mesh = await createRecoveryMesh(cleanup, {
    identities: keys.slice(0, 2), modelId: model.id, modelIdentity: model.identity,
    messages: promptMessages,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[0].peerId });
      return true;
    },
    result: {
      model: model.id, modelIdentity: model.identity, adapterIdentities: [], content: '{"ok":true}',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 11, generatedTokenCount: 4, stopReason: 'eos-token' }
    },
    onGenerationTerminal: proof => admission.terminal(proof)
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const host = createHostAdapter(wholeRequester, mesh.requesterMesh);
  const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  try {
    mesh.drop();
    const controller = new AbortController();
    const pending = fetch(`${api.url}/responses`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: model.id, store: false, stream: false, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
        max_output_tokens: 16, text: { format: { type: 'json_object' } },
        reploid: { pool_id: roomId, expected_model_identity: model.identity, allowed_recipients: [keys[1].peerId], include_execution: true }
      })
    });
    pending.catch(() => {});
    await vi.waitFor(() => expect(mesh.wire.some(item => item.type === 'reploid:generation-result')).toBe(true));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(host.outcomes).toHaveLength(1));
    const reservationId = host.outcomes[0].reservationId;
    expect(credits.snapshot().accounts[0].held).toBe(16);

    await mesh.restartProvider();
    const recoverRes = await fetch(`${api.url}/reploid/recover`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reservationId, messages: promptMessages, providerId: mesh.reference.providerId })
    });
    expect(recoverRes.status).toBe(200);
    const recovered = await recoverRes.json();
    expect(recovered).toMatchObject({
      status: 'completed',
      content: '{"ok":true}',
      serviceCredit: { id: reservationId, charge: 4, outputTokens: 4 },
      outcome: {
        phase: 'in-flight',
        dispatched: true,
        acknowledged: { acknowledgedOutputTokens: 4 },
        finished: { status: 'completed', charge: 4, outputTokens: 4 },
        unknown: null
      }
    });
    expect(mesh.executions).toBe(1);
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: -4, held: 0 }, { balance: 4, held: 0 }
    ]);
  } finally {
    for (const close of cleanup.reverse()) await close();
  }
});

it('rejects unauthenticated or unknown routes at the tunnel Worker before touching the VPC binding', async () => {
  const fetchSpy = vi.fn(req => fetch(req));
  const env = { FLEET_API: { fetch: fetchSpy } };
  expect((await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/other'), env)).status).toBe(404);
  expect((await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/v1/models'), env)).status).toBe(401);
  expect((await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/v1/responses', {
    method: 'GET', headers: { authorization: `Bearer ${token}` }
  }), env)).status).toBe(405);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('propagates client abort and SSE stream cancellation through the tunnel Worker to the upstream VPC fetch', async () => {
  const preHeaderAbort = new AbortController();
  let preHeaderSignal;
  const hangingEnv = {
    FLEET_API: {
      fetch: vi.fn(req => new Promise((_, reject) => {
        preHeaderSignal = req.signal;
        req.signal.addEventListener('abort', () => reject(req.signal.reason), { once: true });
      }))
    }
  };
  const preHeaderPromise = tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/v1/responses', {
    method: 'POST',
    signal: preHeaderAbort.signal,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}'
  }), hangingEnv);
  await vi.waitFor(() => expect(preHeaderSignal).toBeDefined());
  preHeaderAbort.abort();
  const preHeaderRes = await preHeaderPromise;
  expect(preHeaderSignal.aborted).toBe(true);
  expect(preHeaderRes.status).toBe(499);

  let streamSignal, upstreamCancelled = false;
  const streamingEnv = {
    FLEET_API: {
      fetch: vi.fn(req => {
        streamSignal = req.signal;
        const body = new ReadableStream({
          start(streamController) {
            streamController.enqueue(new TextEncoder().encode('event: response.created\ndata: {}\n\n'));
          },
          cancel() { upstreamCancelled = true; }
        });
        return Promise.resolve(new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' }
        }));
      })
    }
  };
  const streamRes = await tunnelWorker.fetch(new Request('https://reploid-fleet-api.reploid.workers.dev/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: '{}'
  }), streamingEnv);
  expect(streamRes.status).toBe(200);
  const reader = streamRes.body.getReader();
  const firstChunk = await reader.read();
  expect(firstChunk.done).toBe(false);
  await reader.cancel('downstream disconnected');
  expect(streamSignal.aborted).toBe(true);
  expect(upstreamCancelled).toBe(true);
});

// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
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

function createHostAdapter(wholeRequester) {
  return {
    identity: keys[0],
    credits: requesterCredits,
    allowsModel: candidate => candidate?.id === model.id && candidate?.identity === model.identity,
    async enrolledRecipients() {
      const network = await requesterCredits.call('computers', {});
      return new Set((network.computers || []).flatMap(row => row.participantIds || []));
    },
    textParticipant: {
      roomId,
      executionClass: 'private-pool',
      getState: () => ({ models: wholeRequester.getModels() }),
      generate: (request, controls) => wholeRequester.generate(request, controls)
    },
    async runAccountedGeneration(request, controls, execute) {
      if (request.generationRequest && request.generationRequest.maxOutputTokens > 16) {
        throw Object.assign(Error('max_output_tokens exceeds fleet credit policy'), { status: 400, param: 'max_output_tokens' });
      }
      const requester = createFleetRequester({
        participant: { generate: execute },
        identity: keys[0],
        credits: requesterCredits,
        maxOutputTokens: 16
      });
      const result = await requester.generate(request, controls);
      return { ...result, execution: { ...result.execution, serviceCredit: result.serviceCredit } };
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
  const api = await startFleetTextApi({ host: createHostAdapter(wholeRequester), token, allowedRecipients: [keys[1].peerId] });
  cleanup.push(() => api.close());
  const controller = new AbortController();
  try {
    const pending = fetch(`${api.url}/responses`, {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: model.id, store: false, stream: true, input: [{ role: 'user', content: 'Return JSON only: {"ok":true}' }],
        max_output_tokens: 16, text: { format: { type: 'json_object' } },
        reploid: { pool_id: roomId, expected_model_identity: model.identity, allowed_recipients: [keys[1].peerId], include_execution: true }
      })
    }).then(res => res.text());
    pending.catch(() => {});
    await entered.promise;
    expect(credits.snapshot().accounts[0].held).toBe(16);
    controller.abort();
    await expect(pending).rejects.toThrow();
    release.resolve();
    await vi.waitFor(() => expect(credits.snapshot().accounts[0].held).toBe(0));
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: 0, held: 0 }, { balance: 0, held: 0 }
    ]);
  } finally {
    release.resolve();
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

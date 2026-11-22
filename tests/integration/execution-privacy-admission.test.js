// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { GENERATION_SETTINGS_CAPABILITY, GENERATION_SETTINGS_SCHEMA } from '../../packages/reploid/src/mesh/generation-settings.js';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

// Real requester and provider meshes with a real journal; the transport and the generator are test-owned.
const PROMPT = 'original prompt';
const modelIdentity = 'sha256:' + 'a'.repeat(64);
const named = f => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [f.identities[1].peerId] } });
const open = () => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const run = (f, privacy, signal) => f.requesterMesh.generate(f.messages, null, { modelId: 'model', modelIdentity, privacy, signal });
const of = (f, type) => f.wire.filter(row => row.type === type);
const carryingPrompt = f => f.wire.filter(row => JSON.stringify(row.payload).includes(PROMPT)).map(row => row.type);

it('a named recipient that declines is told nothing: the prompt never leaves the requester', async () => {
  const asked = [];
  const f = await createRecoveryMesh(cleanup, { authorize: async input => {
    if (input.action === 'mesh.admit' || input.action === 'mesh.execute') { asked.push(input); return false; }
    return true;
  } });
  await expect(run(f, named(f), AbortSignal.timeout(5000))).rejects.toThrow('The provider declined this request. The prompt was not sent.');
  expect(of(f, 'reploid:generation-request')).toEqual([]);
  expect(carryingPrompt(f)).toEqual([]);
  expect(f.executions).toBe(0);
  // The provider's host decided once, from the request's details. It was handed no messages.
  expect(asked.map(input => input.action)).toEqual(['mesh.admit']);
  expect(asked[0].request.messages).toBeUndefined();
  const [admit] = of(f, 'reploid:generation-admit');
  expect(admit.payload.messages).toBeUndefined();
  expect(admit.payload.promptCommitment).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(admit.payload.privacyBinding.route.hops.map(row => row.recipient)).toEqual([f.identities[1].peerId]);
  // The control below serves the same prompt through the same observer, so the empty lists are not a blind spot.
});

it('an admitted request is served, and the prompt is sent only after the admission arrives', async () => {
  const f = await createRecoveryMesh(cleanup);
  const result = await run(f, named(f), AbortSignal.timeout(5000));
  expect(result.content).toBe('actual answer');
  expect(f.executions).toBe(1);
  const order = f.wire.map(row => row.type).filter(type => type.startsWith('reploid:generation-'));
  expect(order.slice(0, 3)).toEqual(['reploid:generation-admit', 'reploid:generation-admitted', 'reploid:generation-request']);
  expect(carryingPrompt(f)).toEqual(['reploid:generation-request']);
  // The commitment opens to exactly the prompt that was sent, and the request is otherwise what was admitted.
  const admit = of(f, 'reploid:generation-admit')[0].payload, request = of(f, 'reploid:generation-request')[0].payload;
  expect(admit.promptCommitment).toBe(await hashJson({ schema: 'reploid.prompt-commitment/v1', salt: request.admission.salt, messages: request.messages, settings: null }));
  const { promptCommitment: _commitment, ...admittedDetails } = admit;
  const { messages: _messages, admission: _admission, ...sentDetails } = request;
  expect(sentDetails).toEqual(admittedDetails);
});

it('the caller\'s settings are withheld with the prompt and bound by the same commitment', async () => {
  const capability = { ...GENERATION_SETTINGS_CAPABILITY, maxOutputTokens: true };
  const settings = { schema: GENERATION_SETTINGS_SCHEMA, maxOutputTokens: 5 };
  const ports = index => index ? { getGenerationSettingsCapability: () => capability } : {};
  const withSettings = (f, signal) => f.requesterMesh.generate(f.messages, null, { modelId: 'model', modelIdentity, privacy: named(f), settings, signal });

  // Declined: neither the prompt nor the settings left the requester.
  const declined = await createRecoveryMesh(cleanup, { ports, authorize: async input => input.action !== 'mesh.admit' });
  await expect(withSettings(declined, AbortSignal.timeout(5000))).rejects.toThrow('The prompt was not sent.');
  expect(of(declined, 'reploid:generation-admit')[0].payload.settings).toBeUndefined();
  expect(of(declined, 'reploid:generation-request')).toEqual([]);

  // Admitted: the request carries the settings the commitment names, and settings swapped afterwards are refused.
  const swapped = await createRecoveryMesh(cleanup, { ports, intercept(type, payload) {
    if (type === 'reploid:generation-request') payload.settings.maxOutputTokens = 4;
  } });
  await expect(withSettings(swapped, AbortSignal.timeout(5000))).rejects.toThrow('Execution admission rejected');
  const sent = of(swapped, 'reploid:generation-request')[0].payload;
  expect(of(swapped, 'reploid:generation-admit')[0].payload.promptCommitment).toBe(await hashJson({
    schema: 'reploid.prompt-commitment/v1', salt: sent.admission.salt, messages: sent.messages, settings: sent.settings }));
  expect(swapped.executions).toBe(0);
});

it('open recipients still require admission; missing or legacy policy sends nothing', async () => {
  const f = await createRecoveryMesh(cleanup);
  await expect(run(f, null, AbortSignal.timeout(5000))).rejects.toThrow();
  await expect(run(f, { schema: 'reploid.execution-policy/v1', profile: 'provider-visible' }, AbortSignal.timeout(5000))).rejects.toThrow();
  expect(of(f, 'reploid:generation-admit')).toEqual([]);
  expect(carryingPrompt(f)).toEqual([]);
  await run(f, open(), AbortSignal.timeout(5000));
  expect(of(f, 'reploid:generation-admit')).toHaveLength(1);
  expect(carryingPrompt(f)).toEqual(['reploid:generation-request']);
  expect(f.executions).toBe(1);
});

it('a provider refuses a prompt other than the one it admitted, and an admission it never gave', async () => {
  // The prompt is swapped on its way to the provider, after the admission.
  const swapped = await createRecoveryMesh(cleanup, { intercept(type, payload) {
    if (type === 'reploid:generation-request') payload.messages = [{ role: 'user', content: 'another prompt' }];
  } });
  await expect(run(swapped, named(swapped), AbortSignal.timeout(5000))).rejects.toThrow('Execution admission rejected');
  expect(swapped.executions).toBe(0);

  // The details are changed after the admission.
  const altered = await createRecoveryMesh(cleanup, { intercept(type, payload) {
    if (type === 'reploid:generation-request') payload.consumer = 'somebody-else';
  } });
  await expect(run(altered, named(altered), AbortSignal.timeout(5000))).rejects.toThrow('Verified requester identity required');
  expect(altered.executions).toBe(0);

  // A request claims an admission that was never asked for, and an admitted request is replayed.
  const f = await createRecoveryMesh(cleanup);
  await run(f, named(f), AbortSignal.timeout(5000));
  expect(f.executions).toBe(1);
  await f.replay({ requestId: 'never-admitted' });
  await vi.waitFor(() => expect(of(f, 'reploid:generation-error').map(row => row.payload))
    .toContainEqual({ requestId: 'never-admitted', error: 'Execution admission rejected' }));
  expect(f.executions).toBe(1);
});

it('a requester keeps the prompt when the provider admits something else or carries a prompt in the admission', async () => {
  // The provider's answer names another commitment.
  const forged = await createRecoveryMesh(cleanup, { intercept(type, payload) {
    if (type === 'reploid:generation-admitted') payload.promptCommitment = 'sha256:' + 'b'.repeat(64);
  } });
  await expect(run(forged, named(forged), AbortSignal.timeout(5000))).rejects.toThrow('The provider admitted a different request. The prompt was not sent.');
  expect(carryingPrompt(forged)).toEqual([]);
  expect(forged.executions).toBe(0);

  // An admission message that carries messages is refused rather than read.
  const leaking = await createRecoveryMesh(cleanup, { intercept(type, payload) {
    if (type === 'reploid:generation-admit') payload.messages = [{ role: 'user', content: 'smuggled' }];
  } });
  await expect(run(leaking, named(leaking), AbortSignal.timeout(5000))).rejects.toThrow('Execution admission rejected');
  expect(of(leaking, 'reploid:generation-request')).toEqual([]);
  expect(leaking.executions).toBe(0);
});

it('must not reveal a prompt to a provider whose negotiated admission version changes after approval', async () => {
  let f;
  f = await createRecoveryMesh(cleanup, {
    intercept(type, payload, sender) {
      if (sender === 1 && type === 'reploid:generation-admitted') payload.admissionProtocol = 1;
    }
  });
  await expect(run(f, open(), AbortSignal.timeout(5000))).rejects.toThrow('The prompt was not sent.');
  expect(of(f, 'reploid:generation-request')).toEqual([]);
  expect(carryingPrompt(f)).toEqual([]);
  expect(f.executions).toBe(0);
});

it('blocks an old admission when the same signing identity reconnects on a fresh channel scope', async () => {
  let f, changed = false;
  const approvedIdentities = [];
  f = await createRecoveryMesh(cleanup, {
    authorize: async input => {
      if (input.action === 'mesh.dispatch') approvedIdentities.push(input.recipientIdentity);
      return true;
    },
    intercept(type, _payload, sender) {
      if (!changed && sender === 1 && type === 'reploid:generation-admitted') {
        changed = true;
        f.changeChannelScope();
      }
    }
  });
  await expect(run(f, named(f), AbortSignal.timeout(5000))).rejects.toThrow(/retry requires new placement/);
  expect(changed).toBe(true);
  expect(of(f, 'reploid:generation-admit')).toHaveLength(1);
  expect(carryingPrompt(f)).toEqual([]);
  expect(f.executions).toBe(0);

  // The same enrolled identity may serve a new attempt, after proof and exact admission in that scope.
  f.readvertise();
  expect((await run(f, named(f), AbortSignal.timeout(5000))).content).toBe('actual answer');
  expect(approvedIdentities).toEqual([f.identities[1].peerId, f.identities[1].peerId]);
  expect(of(f, 'reploid:generation-admit')).toHaveLength(2);
  expect(carryingPrompt(f)).toEqual(['reploid:generation-request']);
  expect(f.executions).toBe(1);
});

it('does not accept remote generation without a current policy and route binding', async () => {
  const f = await createRecoveryMesh(cleanup);
  await run(f, open(), AbortSignal.timeout(5000));
  await f.replay({ requestId: 'absent-policy' }, ['privacy']);
  await f.replay({ requestId: 'legacy-policy', admissionProtocol: 1,
    privacy: { schema: 'reploid.execution-policy/v1', profile: 'provider-visible' } });
  expect(of(f, 'reploid:generation-error').filter(row => ['absent-policy', 'legacy-policy'].includes(row.payload.requestId))
    .every(row => row.payload.error === 'Current execution policy and admission protocol required')).toBe(true);
  expect(of(f, 'reploid:generation-error').map(row => row.payload.requestId)).toEqual(['absent-policy', 'legacy-policy']);
  expect(f.executions).toBe(1);
});

it('cancelling while waiting for admission discloses nothing and withdraws the admission', async () => {
  const cancel = new AbortController(), asked = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await createRecoveryMesh(cleanup, { authorize: async input => {
    if (input.action !== 'mesh.admit') return true;
    asked.resolve(); await release.promise; return true;
  } });
  const attempt = expect(run(f, named(f), cancel.signal)).rejects.toThrow('fixture cancelled');
  await asked.promise;
  cancel.abort(Error('fixture cancelled'));
  await attempt;
  await vi.waitFor(() => expect(of(f, 'reploid:generation-cancel')).toHaveLength(1));
  release.resolve();
  // The provider's host said yes after the cancellation: no admission is given and nothing further is sent.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(of(f, 'reploid:generation-admitted')).toEqual([]);
  expect(of(f, 'reploid:generation-request')).toEqual([]);
  expect(carryingPrompt(f)).toEqual([]);
  expect(f.executions).toBe(0);
});

it('a stale provider can receive neither named nor open plaintext prompts', async () => {
  const legacy = await createRecoveryMesh(cleanup, { admitsBeforeDisclosure: false });
  await expect(run(legacy, named(legacy), AbortSignal.timeout(200))).rejects.toThrow();
  await expect(run(legacy, open(), AbortSignal.timeout(200))).rejects.toThrow();
  expect(of(legacy, 'reploid:generation-admit')).toEqual([]);
  expect(of(legacy, 'reploid:generation-request')).toEqual([]);
  expect(carryingPrompt(legacy)).toEqual([]);
  expect(legacy.executions).toBe(0);
  const current = await createRecoveryMesh(cleanup);
  expect((await run(current, named(current), AbortSignal.timeout(5000))).content).toBe('actual answer');
  expect(of(current, 'reploid:generation-admit')).toHaveLength(1);
});

it('a host that changes its mind after admitting received the prompt but executes nothing', async () => {
  // A host that admits and then declines to execute has the prompt. It runs nothing.
  const late = Promise.withResolvers(), stop = new AbortController();
  const fickle = await createRecoveryMesh(cleanup, { authorize: async input => {
    if (input.action !== 'mesh.execute') return true;
    late.resolve(input.request.messages); return false;
  } });
  const held = expect(run(fickle, named(fickle), stop.signal)).rejects.toThrow('fixture cancelled');
  try {
    expect(await late.promise).toEqual(fickle.messages);
    expect(fickle.executions).toBe(0);
  } finally { stop.abort(Error('fixture cancelled')); await held; }
});

it('withdraws an admitted request whose disclosure is still hashing when its requester times out', async () => {
  const checking = Promise.withResolvers(), release = Promise.withResolvers();
  let firstDisclosure = true, blockNextCommitment = false;
  const f = await createRecoveryMesh(cleanup, {
    meshConfig: i => ({ generationTimeoutMs: i === 0 ? 1000 : 5000 }),
    intercept(type) {
      if (type === 'reploid:generation-request' && firstDisclosure) {
        firstDisclosure = false;
        blockNextCommitment = true;
      }
    }
  });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const delayed = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
    if (blockNextCommitment && new TextDecoder().decode(bytes).includes('reploid.prompt-commitment/v1')) {
      blockNextCommitment = false;
      checking.resolve();
      await release.promise;
    }
    return digest(algorithm, bytes);
  });
  const attempt = () => f.requesterMesh.generate(f.messages, null, {
    modelId: 'model', modelIdentity, privacy: named(f), requestContext: { recoverable: true }
  });
  try {
    const expired = expect(attempt()).rejects.toThrow('Timed out waiting for remote host slot response');
    await checking.promise;
    await expired;
    expect(of(f, 'reploid:generation-cancel')).toHaveLength(1);
    expect(of(f, 'reploid:generation-admitted')).toHaveLength(1);
    release.resolve();
    await attempt();
    expect(f.executions).toBe(1);
    expect(of(f, 'reploid:generation-result').map(row => row.payload.requestId)).toEqual([f.reference.requestId]);
    expect(of(f, 'reploid:receipt')).toHaveLength(1);
  } finally {
    release.resolve();
    delayed.mockRestore();
  }
});

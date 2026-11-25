// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createOwnerInference, runFleetNativeCommands } from '../../server/fleet/native-host.js';
import { bindExecutionRoute, plaintextExecutionRoute } from '../../shared/vendor/reploid/chat/execution-policy.js';

// A controlled native host: the inference contract and the owner command, not physical inference or peer delivery.
const model = { id: 'qwen-test', identity: 'sha256:' + 'a'.repeat(64) };
const peer = 'peer:' + 'b'.repeat(24), other = 'peer:' + 'c'.repeat(24), outsider = 'peer:' + 'd'.repeat(24);
const request = (extra = {}) => ({ threadId: 'thread-1', attemptId: 'attempt-1', model,
  messages: [{ role: 'user', content: 'Hello' }], ...extra });

/** Discloses to `recipient` under the policy the host was given, the way the mesh binds a whole-model request. */
function fixtureHost({ enrolled = [peer, other], recipient = peer, boundModel = null } = {}) {
  const host = { sent: [], calls: [], charged: [],
    enrolledRecipients: async () => new Set(enrolled),
    // The plan's charge ceiling, as the real host quotes it from its credit terms.
    async chargeCeiling(req) { host.charged.push(req.model.id); return { kind: 'capped', maximum: 48, unit: 'noncash-service-credit' }; },
    async generate(req, onDelta, onRoute, _onAdmission, { signal, approve }) {
      host.calls.push(structuredClone(req));
      const bound = boundModel ? { ...req, model: boundModel } : req;
      const privacyBinding = await bindExecutionRoute(bound, plaintextExecutionRoute(bound, { recipients: [recipient] }));
      const disclosure = { privacyBinding, requestId: 'request-1', providerId: 'connection-1', recipientIdentity: recipient,
        input: { messages: req.messages } };
      if (await approve(disclosure) !== true) throw Error('Recipient disclosure was refused; nothing was sent');
      signal.throwIfAborted();
      host.sent.push(recipient); onRoute?.(disclosure);
      onDelta({ threadId: req.threadId, attemptId: req.attemptId, sequence: 0, text: 'Hi' });
      return { threadId: req.threadId, attemptId: req.attemptId, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
        content: 'Hi', usage: { schema: 'raw-model-tokens/v1', inputTokens: 3, outputTokens: 1 },
        execution: { stopReason: 'eos-token', providerIdentity: recipient }, serviceCredit: { status: 'completed', charge: 1 } };
    },
    async close() {}
  };
  return host;
}
const config = extra => ({ models: [{ mode: 'whole-model', model }], ...extra });

afterEach(() => vi.restoreAllMocks());

it('runs the stdin generate command through prepare and run, bound to the enrolled computers, with the receipt', async () => {
  const host = fixtureHost(), input = new PassThrough(), lines = [];
  vi.spyOn(console, 'log').mockImplementation(line => lines.push(JSON.parse(line)));
  const running = runFleetNativeCommands({ host, input, signals: new EventEmitter(), config: config() });
  input.end(JSON.stringify({ id: 'cmd-1', op: 'generate', events: true, request: request() }) + '\n');
  await running;
  expect(lines.map(line => line.event ?? (line.delta ? 'delta' : line.result ? 'result' : 'error'))).toEqual(['route', 'delta', 'result']);
  const { result } = lines.at(-1);
  // The same policy the old direct path built, compiled from the requirements: the enrolled computers, sorted.
  expect(host.calls[0].privacy).toMatchObject({ schema: 'reploid.execution-policy/v2', placement: 'network-allowed',
    recipients: { kind: 'named', ids: [peer, other].sort() }, computation: 'plaintext' });
  expect(result).toMatchObject({ content: 'Hi', serviceCredit: { status: 'completed' } });
  expect(result.executionReceipt).toMatchObject({ schema: 'reploid.execution-receipt/v2', requestId: 'attempt-1', status: 'completed',
    protection: 'plaintext', routeKind: 'remote', issuedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    requested: { execution: { participants: { kind: 'named', ids: [peer, other].sort() }, protection: 'plaintext', route: 'auto' } },
    route: { shape: 'remote', participants: [peer], backend: 'doppler-plaintext/v1' } });
  expect(result.executionReceipt.evidence.privacy.checks).toEqual([{ claim: 'content-recipients', by: 'requester',
    method: 'route-binding-before-release', value: [peer] }]);
  // The charge was capped from the host's credit terms before anything was sent; the receipt keeps the reported credits.
  expect(host.charged.length).toBeGreaterThan(0);
  expect(result.executionReceipt.evidence.credits.record).toEqual({ kind: 'service-credit', status: 'completed', charge: 1 });
});

it.each(['homomorphic', 'attested', 'secret-sharing'])('reports the stable refusal code on stdin and sends nothing for protection %s', async protection => {
  const host = fixtureHost(), input = new PassThrough(), lines = [];
  vi.spyOn(console, 'log').mockImplementation(line => lines.push(JSON.parse(line)));
  const running = runFleetNativeCommands({ host, input, signals: new EventEmitter(), config: config() });
  input.end(JSON.stringify({ id: 'cmd-2', op: 'generate', request: request({ execution: { protection, route: 'auto',
    participants: { kind: 'open' }, allowMetadata: ['model-id', 'timing', 'length'] } }) }) + '\n');
  await running;
  expect(lines).toEqual([expect.objectContaining({ id: 'cmd-2', code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' })]);
  expect(host.calls).toEqual([]);
});

it.each([
  ['a participant the owner has not enrolled', { participants: { kind: 'named', ids: [outsider] } }, 'EXECUTION_ROUTE_UNAVAILABLE'],
  ['route local on a network host', { route: 'local', participants: undefined }, 'EXECUTION_ROUTE_UNAVAILABLE'],
  ['metadata the route exposes but the request forbids', { allowMetadata: ['model-id'] }, 'LEAKAGE_NOT_ALLOWED']
])('refuses %s before anything is sent', async (_name, change, code) => {
  const host = fixtureHost();
  const generate = createOwnerInference({ host, config: config() });
  const execution = Object.fromEntries(Object.entries({ protection: 'plaintext', route: 'auto', participants: { kind: 'open' },
    allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'], ...change }).filter(([, value]) => value !== undefined));
  await expect(generate(request({ execution }))).rejects.toMatchObject({ code });
  expect(host.calls).toEqual([]);
});

it('keeps an open request within the pinned computers and refuses a substituted route at disclosure', async () => {
  const pinned = createOwnerInference({ host: fixtureHost(), config: config({ textApi: { allowedRecipients: [peer] } }) });
  const open = { protection: 'plaintext', route: 'auto', participants: { kind: 'open' }, allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] };
  const answered = await pinned(request({ execution: open }));
  expect(answered.executionReceipt.route.participants).toEqual([peer]);
  // A disclosure bound to another model artifact is not the planned route: refused before the prompt is sent.
  const host = fixtureHost({ boundModel: { id: model.id, identity: 'sha256:' + 'f'.repeat(64) } });
  const generate = createOwnerInference({ host, config: config() });
  await expect(generate(request())).rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
  expect(host.calls).toHaveLength(1); expect(host.sent).toEqual([]);
});

it('refuses a peer policy in place of requirements, and a model outside the owner configuration', async () => {
  const host = fixtureHost(), generate = createOwnerInference({ host, config: config() });
  await expect(generate(request({ privacy: { schema: 'reploid.execution-policy/v2' } }))).rejects.toMatchObject({ code: 'EXECUTION_REQUEST_INVALID' });
  await expect(generate(request({ model: { id: 'other', identity: 'sha256:' + 'e'.repeat(64) } }))).rejects.toThrow('outside owner preferences');
  await expect(createOwnerInference({ host: fixtureHost({ enrolled: [] }), config: config() })(request()))
    .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  expect(host.calls).toEqual([]);
});

/**
 * A hosted self-serve fleet on a loopback port, with the test sign-in, and one helper that settles a real
 * credited whole-model answer between two enrolled keys. The ledger, HTTP, signatures and settlement are the
 * real ones; the generator is a fixture that returns fixed text, so this establishes no real inference.
 */
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { openHostedSelfServe } from '../../server/fleet/self-serve-mount.js';
import { testSessionAuthenticator } from '../../server/fleet/self-serve-http.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';

export const SELF_SERVE_MODEL = Object.freeze({ id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:eb2a48400c975389a4ed8a166228cdc0feeca8c56bc85f36604e26c18e303541' });

export function selfServeConfiguration(root, { maxDebt = 40, maxTotalDebt = 60, verified = 40, unverified = 0, limits = {} } = {}) {
  return {
    schema: 'reploid.fleet-self-serve-config/v1',
    databaseFile: path.join(root, 'credits.sqlite'),
    accountsFile: path.join(root, 'accounts.sqlite'),
    creditPolicy: { schema: 'reploid.service-credit-policy/v1', version: 'self-serve-test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt, maxTotalDebt, maxOutputTokens: 20, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0 },
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 },
    models: [{ ...SELF_SERVE_MODEL }],
    network: { serviceUrl: 'http://127.0.0.1/v1/fleet', signalingUrl: 'wss://signal.example/ws', roomId: 'reploid-swarm-fleet-test' },
    starterDebt: { verified, unverified },
    limits
  };
}

export async function startSelfServeServer(root, options = {}) {
  const hosted = await openHostedSelfServe(selfServeConfiguration(root, options), {
    roomToken: 'room-token-for-the-self-serve-fleet-test-000000', authenticate: testSessionAuthenticator });
  const server = http.createServer((request, response) => void hosted.handle(request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { ...hosted, origin, fleetUrl: `${origin}/v1/fleet`,
    async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); hosted.close(); } };
}

/** A session-authenticated call, as the browser makes it. */
export function sessionApi(origin, token) {
  return async (method, route, body) => {
    const response = await fetch(origin + route, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(Error(value.error), { status: response.status, code: value.code });
    return value;
  };
}

/** One settled answer: `consumer` asks through the hosted ledger, `provider` signs a receipt for `tokens` output tokens. */
export async function settleAnswer({ fleetUrl, consumer, provider, tokens, content = 'A fixed fixture answer.', maxOutputTokens = 20, messages }) {
  const client = createFleetClient({ url: fleetUrl, identity: consumer });
  const participant = {
    async generate(request, controls) {
      const requestId = randomUUID();
      if (await controls.requestApproval({ requestId, recipientIdentity: provider.peerId,
        input: { messages: request.messages } }) !== true) throw Error('Not approved');
      const completion = { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: tokens, stopReason: 'eos' };
      const output = { model: SELF_SERVE_MODEL.id, modelIdentity: SELF_SERVE_MODEL.identity, content, completion, adapterIdentities: [] };
      const measured = await measureWholeModelReceipt(request.messages, output);
      const receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
        provider: provider.peerId, consumer: consumer.peerId, model: SELF_SERVE_MODEL.id, jobHash: `request:${requestId}` }), provider), consumer);
      return { content, execution: { receipt } };
    }
  };
  const requester = createFleetRequester({ participant, identity: consumer, credits: client, maxOutputTokens });
  return requester.generate({ model: { ...SELF_SERVE_MODEL }, messages: messages ?? [{ role: 'user', content: 'Say something.' }] },
    { signal: new AbortController().signal, requestApproval: async () => true });
}

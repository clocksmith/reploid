// @vitest-environment node
/**
 * The paired browser path end to end over the journey network: the browser's private-computers client, the
 * browser bridge, the credited requester, the real peer generation mesh with provider admission, the fleet
 * credit service over HTTP, and a test provider. The hub delays every message by a fixed one-way latency, so the
 * time from Send to the first delta the browser receives counts the network legs on the way. This is not GPU
 * inference or a physical network.
 */
import { it, expect } from 'vitest';
import { createExecutionPolicy, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { startFleetBrowserBridge } from '../../server/fleet/browser-bridge.js';
import { createPrivateComputers } from '../../apps/poolday/host/private-computers.js';
import { createJourneyNetwork, waitFor, JOURNEY_ANSWER } from '../helpers/journey-network.js';

const ORIGIN = 'http://localhost:8000', TOKEN = 'paired-latency-fixture-secret-0123456789';
const plaintext = () => createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' });

/** A paired native host over the journey requester: the bridge's host port, nothing more. */
function pairedHost(network) {
  const { model, requesterIdentity } = network, provider = network.seats[0].identity.peerId, requester = requesterIdentity.peerId;
  const route = plaintextExecutionRoute({ model }, { recipients: [requester, provider],
    route: { schema: 'reploid.paired-whole-route/v1', requester, providerIdentity: provider } });
  const active = new Map();
  return { host: {
    browserState: async () => ({ schema: 'reploid.fleet-browser/v1', privacyProtocol: 'reploid.paired-route/v3',
      poolIdentity: 'sha256:' + 'c'.repeat(64), requester: { id: 'computer-requester', name: 'Requester', participantId: requester },
      models: [{ id: model.id, identity: model.identity, name: 'Journey', provider: 'doppler', availability: 'ready',
        executionRoutes: [{ selection: { id: model.id, identity: model.identity }, route }] }],
      computers: [{ id: 'computer-provider', name: 'Provider', online: true, participantIds: [provider] }], at: Date.now() }),
    cancel: attemptId => active.get(attemptId)?.abort(),
    async generate(request, onDelta, onRoute, _onAdmission, { onReservation = () => {} } = {}) {
      const controller = new AbortController(); active.set(request.attemptId, controller);
      try {
        return await network.requester.generate({ model, messages: request.messages, threadId: request.threadId,
          attemptId: request.attemptId, privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) }, {
          signal: controller.signal,
          requestApproval: async disclosure => { onRoute(disclosure); return true; },
          onReservation,
          onDelta
        });
      } finally { active.delete(request.attemptId); }
    }
  } };
}

async function openPairedPath({ latencyMs, beforeToken }) {
  const network = await createJourneyNetwork({ latencyMs,
    providers: [{ name: 'provider-1', tokensPerSecond: 100, holdsModel: true, ...(beforeToken ? { beforeToken } : {}) }] });
  const paired = pairedHost(network);
  const bridge = await startFleetBrowserBridge({ host: paired.host, token: TOKEN, origins: [ORIGIN] });
  const client = createPrivateComputers({ storage: null,
    fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: ORIGIN } }) });
  await client.connect(bridge.url, TOKEN);
  return { network, paired, client, async close() { client.close(); await bridge.close(); await network.close(); } };
}

function send(client, onDelta, attemptId) {
  return client.execute({ threadId: 'latency-thread', attemptId, model: client.models()[0],
    messages: [{ role: 'user', content: 'Send one answer across the network.' }], permissions: { sharingScope: 'mesh' }, privacy: plaintext() },
  { signal: new AbortController().signal, requestApproval: async () => true, onState() {}, onDelta });
}

it('reaches the first rendered delta within the admission legs of the provider first token', async () => {
  const latencyMs = 60, path = await openPairedPath({ latencyMs });
  try {
    const seat = path.network.seats[0];
    // The warm-up answer leaves both sides with identities proven on this connection, as a live mesh has them.
    const timings = [];
    for (const attempt of ['warm-up', 'measured']) {
      const sentAt = Date.now(); let firstAt = null;
      const result = await send(path.client, () => { firstAt ??= Date.now(); }, attempt);
      expect(result.content).toBe(JOURNEY_ANSWER.join(''));
      const providerFirstTokenMs = seat.firstTokenAt - seat.generateStartedAt;
      timings.push({ attempt, sendToFirstMs: firstAt - sentAt, providerFirstTokenMs, overheadMs: firstAt - sentAt - providerFirstTokenMs,
        steps: result.execution.timeline.map(({ step, at }) => [step, at - sentAt]) });
    }
    const measured = timings[1], context = JSON.stringify(timings);
    // The browser records each step, in order, from its route checks to the first character it received.
    expect(measured.steps.map(([step]) => step)).toEqual(['route-checks', 'sent-to-host', 'host-received', 'route-checked',
      'credit-reserved', 'first-delta', 'first-delta-received']);
    // Send → first delta crosses admit, admitted, request and the first update: four one-way legs. Identity
    // proofs already made on this connection add none; each repeated proof added two (twelve legs in all before).
    expect(measured.overheadMs, context).toBeGreaterThanOrEqual(4 * latencyMs);
    expect(measured.overheadMs, context).toBeLessThan(5 * latencyMs + 100);
  } finally { await path.close(); }
}, 60000);

it('hands each delta to the browser before the provider produces the next one', async () => {
  const received = [];
  let path;
  // The provider emits token i only after the browser client has received token i - 1. A layer that held deltas
  // back to batch them would leave the provider waiting here and the answer would never finish.
  const beforeToken = index => index === 0 ? undefined
    : waitFor(() => received.length >= index, { timeoutMs: 3000, label: `browser received delta ${index}` });
  path = await openPairedPath({ latencyMs: 5, beforeToken });
  try {
    const result = await send(path.client, delta => received.push(delta.text), 'unbatched');
    expect(received).toEqual(JOURNEY_ANSWER);
    expect(result.content).toBe(JOURNEY_ANSWER.join(''));
  } finally { await path.close(); }
}, 60000);

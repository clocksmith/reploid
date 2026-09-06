/** Synthetic computation with real signatures and native IndexedDB. Test keys stay in the harness. */
import { operationFixture, packPeerIdentity } from './peer-pack-operation.js';
import { createPackPeerProvider } from '../../self/pool/peer-pack-provider.js';
import { createPackPeerJob, signPackPeerMessage, PACK_CANCEL_SCHEMA } from '../../self/pool/peer-pack-job.js';
import { PEER_MESSAGE_TYPES } from '../../self/pool/peer-protocol.js';

let provider, fixture, listener, seed, release;
const responses = [], errors = [];
export async function start({ saved = null, mode = 'normal' } = {}) {
  responses.length = 0; errors.length = 0;
  fixture = await operationFixture('embed');
  const identity = saved ? { ...saved.identity, privateKey: await crypto.subtle.importKey('jwk', saved.identity.privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']) } : await packPeerIdentity();
  if (mode === 'pending') fixture.after(() => new Promise(resolve => { release = resolve; }));
  let fail = mode === 'send-failure';
  provider = createPackPeerProvider({ identity, models: [fixture.model], executor: fixture.executor,
    authorize: () => true, onError: error => errors.push(error.message),
    bus: { subscribe(fn) { listener = fn; return () => { listener = null; }; }, async send(message) {
      if (fail && message.body.status === 'completed') { fail = false; throw new Error('injected send failure'); }
      responses.push(message);
    } } });
  if (saved) seed = saved;
  else {
    const requester = await packPeerIdentity();
    const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 180000 };
    const expiresAt = Date.now() + 180000;
    const advert = await provider.createAdvert({ limits, expiresAt });
    const job = await createPackPeerJob({ identity: requester, advert, model: fixture.model, input: fixture.input,
      options: fixture.options, comparisonPolicy: fixture.policy, limits: { ...limits, deadlineAt: expiresAt },
      consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: [identity.keyId] } });
    const cancel = await signPackPeerMessage({ identity: requester, type: PEER_MESSAGE_TYPES.HEARTBEAT, recipient: identity.keyId,
      expiresAt, body: { schema: PACK_CANCEL_SCHEMA, jobHash: job.messageHash,
        jobId: job.body.intent.jobId, attemptId: job.body.intent.attemptId } });
    seed = { identity: { ...identity, privateKey: await crypto.subtle.exportKey('jwk', identity.privateKey) }, job, cancel };
  }
  return seed;
}
export function deliver(kind = 'job') { listener(seed[kind]); }
export function releasePending() { release?.(); }
export async function state() {
  return { ...provider.getState(), calls: fixture.calls(), responses: structuredClone(responses), errors: [...errors],
    journal: await provider.getJournalStats() };
}
export async function close() { release?.(); await provider.close(); }

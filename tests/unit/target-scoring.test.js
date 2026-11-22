// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt, createReceiptDraft, signReceiptDraft } from '../../packages/reploid/src/artifacts/receipt.js';
import { hashJson, sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { attachTargetScoring, requestTargetScore, verifyTargetScore } from '../../packages/reploid/src/mesh/index.js';

const MODEL = `sha256:${'c'.repeat(64)}`;
const messages = [{ role: 'system', content: 'Answer directly.' }, { role: 'user', content: 'Say you agree' }];

function link(identities) {
  const handlers = { provider: new Map(), requester: new Map() };
  const sent = [];
  const endpoint = (self, other) => ({
    getPeerBinding: peer => (peer === other ? { channel: `${self}-${other}` } : null),
    onMessage: (type, handler) => handlers[self].set(type, handler),
    sendToPeer: (peer, type, payload) => {
      sent.push({ from: self, type, payload: structuredClone(payload) });
      queueMicrotask(() => handlers[peer].get(type)?.(self, structuredClone(payload)));
      return true;
    }
  });
  return { sent, provider: endpoint('provider', 'requester'), requester: endpoint('requester', 'provider'),
    verifyPeer: async peer => identities[peer], currentPeer: peer => identities[peer] };
}

async function receiptFor(provider, consumer, { inputMessages = messages, timestamp = Date.now(), model = MODEL } = {}) {
  const draft = await createReceiptDraft({ version: 3, provider: provider.peerId, consumer: consumer.peerId, jobHash: 'request:r1',
    model: 'qwen', inputTokens: 9, outputTokens: 3, status: 'completed', timestamp, modelIdentity: model, adapterIdentities: [],
    inputDigest: await hashJson(inputMessages), outputDigest: await sha256Hex('Fine.'), usage: 'raw-model-tokens/v1',
    stopReason: 'eos-token', cleanup: 'settled', ownerPolicyDigest: null, settingsDigest: `sha256:${'d'.repeat(64)}` });
  return countersignReceipt(await signReceiptDraft(draft, provider), consumer);
}

describe('target scoring after an answer', () => {
  it('signs a score bound to the provider\'s own receipt and refuses anything else', async () => {
    const [provider, requester, stranger] = await Promise.all([1, 2, 3].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    const net = link({ provider: provider.peerId, requester: requester.peerId });
    const scored = [];
    attachTargetScoring({ transport: net.provider, identity: provider, verifyPeer: net.verifyPeer, currentPeer: net.currentPeer,
      score: async request => { scored.push(request.target); return { modelIdentity: MODEL, tokenCount: 3, roundedTotalLogProb: -1.25 }; } });
    const ask = (receipt, overrides = {}) => requestTargetScore({ transport: net.requester, verifyPeer: net.verifyPeer, currentPeer: net.currentPeer,
      providerPeer: 'provider', providerParticipantId: provider.peerId, receipt, messages, target: 'Fine.', ...overrides, signal: AbortSignal.timeout(3000) });

    const receipt = await receiptFor(provider, requester);
    const record = await ask(receipt);
    expect(record).toMatchObject({ receiptId: receipt.receiptId, provider: provider.peerId, consumer: requester.peerId,
      targetDigest: await sha256Hex('Fine.'), tokenCount: 3, totalLogProbHundredths: -125, modelIdentity: MODEL });
    expect(await verifyTargetScore(record)).toBe(true);
    expect(await verifyTargetScore({ ...record, totalLogProbHundredths: -1 })).toBe(false);
    // The target travels only in the scoring request, after the answer.
    expect(net.sent.filter(message => JSON.stringify(message.payload).includes('Fine.') && message.type !== 'reploid:target-score-request')
      .every(message => message.type === 'reploid:target-score-result')).toBe(true);

    await expect(ask(await receiptFor(stranger, requester))).rejects.toThrow(/Invalid scoring request|countersigned receipt/);
    await expect(ask(await receiptFor(provider, stranger))).rejects.toThrow(/countersigned receipt for the same requester/);
    await expect(ask(receipt, { messages: [...messages, { role: 'user', content: 'extra' }] })).rejects.toThrow(/Messages differ/);
    await expect(ask(await receiptFor(provider, requester, { timestamp: Date.now() - 3_600_000 }))).rejects.toThrow(/too old/);
    expect(scored).toEqual(['Fine.']);
  });

  it('refuses a score computed on a different model artifact', async () => {
    const [provider, requester] = await Promise.all([1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    const net = link({ provider: provider.peerId, requester: requester.peerId });
    attachTargetScoring({ transport: net.provider, identity: provider, verifyPeer: net.verifyPeer, currentPeer: net.currentPeer,
      score: async () => ({ modelIdentity: `sha256:${'e'.repeat(64)}`, tokenCount: 3, roundedTotalLogProb: -1 }) });
    await expect(requestTargetScore({ transport: net.requester, verifyPeer: net.verifyPeer, currentPeer: net.currentPeer, providerPeer: 'provider',
      providerParticipantId: provider.peerId, receipt: await receiptFor(provider, requester), messages, target: 'Fine.',
      signal: AbortSignal.timeout(3000) })).rejects.toThrow(/different model artifact/);
  });
});

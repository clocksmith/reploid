import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessReceipt, projectHistory } from './checks.mjs';
const fixture = JSON.parse(fs.readFileSync(new URL('./plain-chat.json', import.meta.url)));
function receipt() {
  const content = 'function doubleEvens(numbers) { return numbers.filter(n => n % 2 === 0).map(n => n * 2); }\n[4, 8]';
  const execution = { stopReason: 'eos-token', placement: 'two-device-layer-partition', participantA: 'a', participantB: 'b',
    settlement: { cleanup: [{ participantId: 'a', status: 'settled' }, { participantId: 'b', status: 'settled' }] } };
  const first = { id: 't', model: { identity: 'm' }, attempts: [{ id: 'a1', responseId: 'r1', status: 'completed', execution }],
    messages: [{ id: 'u1', role: 'user', content: fixture.questions[0] }, { id: 'r1', attemptId: 'a1', role: 'assistant', status: 'completed', content }] };
  const second = structuredClone(first);
  second.attempts.push({ id: 'a2', responseId: 'r2', status: 'completed', execution, request: { messages: [
    { role: 'user', content: fixture.questions[0] }, { role: 'assistant', content }, { role: 'user', content: fixture.questions[1] }] } });
  second.messages.push({ id: 'u2', role: 'user', content: fixture.questions[1] }, { id: 'r2', role: 'assistant', status: 'completed', content: '[-4,12]' });
  const observed = { threads: [second], runningIds: [] }, custody = { state: { receivedBytes: 0, verifiedFiles: [], pending: 0, preparing: false, sharing: false }, receipts: [] };
  return { turns: [first, second], weights: [], custodyBefore: custody, custodyAfter: custody, custodyAfterReload: custody,
    streamSamples: [{ attemptId: 'a1', messageId: 'r1', status: 'executing', content: 'function double', renderedText: 'function double' }],
    copy: { messageId: 'r1', clipboardText: content }, beforeReload: observed, restoredState: structuredClone(observed),
    restoration: { draft: fixture.draft }, returnSamples: [0, 1].map(() => ({ runningIds: [], history: projectHistory(observed) })), returnObservationMs: 3000 };
}
test('coherent synthetic receipt passes interactions only, never coding semantics', () => {
  const result = assessReceipt(receipt(), fixture);
  assert.equal(result.lifecycleAndInteractionPass, true); assert.equal(result.semanticAcceptance, null); assert.equal(result.overallAcceptance, false);
});
for (const [name, mutate] of [
  ['transport cutoff', r => { r.turns[1].attempts.at(-1).status = 'interrupted'; }],
  ['output cap', r => { r.turns[0].attempts[0].execution.stopReason = 'max-tokens'; }],
  ['unknown cleanup', r => { r.turns[0].attempts[0].execution.settlement.cleanup[1].status = 'unknown'; }],
  ['hidden fallback', r => { r.turns[1].attempts.at(-1).execution.placement = 'local-webgpu'; }],
  ['fabricated history', r => { r.turns[1].attempts.at(-1).request.messages[1].content = 'Ideal substitute'; }],
  ['terminal-only output', r => { r.streamSamples[0].status = 'completed'; }],
  ['invisible stream', r => { r.streamSamples[0].renderedText = ''; }],
  ['wrong clipboard', r => { r.copy.clipboardText = 'other text'; }],
  ['missing custody', r => { delete r.custodyAfterReload; }],
  ['reload redispatch', r => { r.returnSamples[1].runningIds = ['t']; }],
  ['changed reload text', r => { r.restoredState.threads[0].messages[1].content += ' changed'; }],
  ['short return observation', r => { r.returnObservationMs = 0; }],
  ['lost draft', r => { r.restoration.draft = ''; }]
]) test(`rejects ${name}`, () => { const r = receipt(); mutate(r); assert.equal(assessReceipt(r, fixture).lifecycleAndInteractionPass, false); });
test('incorrect answer with complete transport never becomes semantic acceptance', () => {
  const r = receipt(); r.turns[1].messages.at(-1).content = '[999]';
  r.beforeReload = { threads: [r.turns[1]], runningIds: [] }; r.restoredState = structuredClone(r.beforeReload);
  r.returnSamples = [0, 1].map(() => ({ runningIds: [], history: projectHistory(r.beforeReload) }));
  const result = assessReceipt(r, fixture); assert.equal(result.lifecycleAndInteractionPass, true); assert.equal(result.semanticAcceptance, null);
});

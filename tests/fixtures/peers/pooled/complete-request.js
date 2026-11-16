// Peer adapter only: preserves the selected SDK's reset, sampler and generation.
import assert from 'node:assert/strict';
import { timeCompleteRequest } from '../../complete-request-timing.js';

export async function runPooledCompleteRequest({ room, promptIds, maxNew, stopIds, makeSampler, timeoutMs, signal, clock }) {
  assert(Array.isArray(promptIds) && promptIds.length > 0 && promptIds.every(id => Number.isSafeInteger(id) && id >= 0)
    && Number.isSafeInteger(maxNew) && maxNew > 0 && Array.isArray(stopIds)
    && stopIds.every(id => Number.isSafeInteger(id) && id >= 0), 'Peer request requires exact input, stop and token limits');
  const ids = [...promptIds], stop = new Set(stopIds), sampledIds = [];
  assert(Number.isSafeInteger(room.ai.engine.maxSeq) && ids.length + maxNew < room.ai.engine.maxSeq - 2,
    'Peer context would silently narrow the frozen request');
  const greedy = makeSampler({ temp: 0, topK: 1 });
  const sample = logits => { const token = greedy(logits); sampledIds.push(token); return token; };
  sample.gpu = greedy.gpu;
  const measured = await timeCompleteRequest({
    reset() { room.ai.fed = null; room.ckptClear(true); },
    generate: (observe, active) => room.locked(() => room.generate(ids, {
      maxNew, sample, signal: active, stop, onToken: observe,
    })),
    decode: result => room.ai.tok.decode(Array.from(result.tokens)),
    timeoutMs, signal, clock,
  });
  const result = measured.result;
  const returnedIds = Array.from(result.tokens);
  assert(result.resumed === 0 && result.reused === 0 && result.prefilled === ids.length
    && result.pinned === 0 && result.from === null && result.count === returnedIds.length,
  'Peer request resumed, reused or changed its frozen input');
  assert(['stop', 'max'].includes(result.reason), 'Peer request aborted or reached its context boundary');
  assert(sampledIds.every(id => Number.isSafeInteger(id) && id >= 0)
    && returnedIds.length <= maxNew && returnedIds.every(id => Number.isSafeInteger(id) && id >= 0),
  'Peer sampler or returned tokens are invalid');
  assert.deepEqual(measured.timing.emissions.map(row => row.token), returnedIds, 'Peer callbacks differ from returned tokens');
  // The SDK may sample terminal or lookahead candidates that it never emits.
  // Preserve that trace; compare public completion IDs under the stop contract.
  return { inputIds: ids, promptIds: ids, rawSampledIds: sampledIds, ids: returnedIds, text: measured.text, ...measured.timing,
    prefillMs: result.tPre, decodeMs: result.tDecode, reused: result.reused, resumed: result.resumed,
    prefilled: result.prefilled, pinned: result.pinned, reason: result.reason,
    scope: 'Reset through public SDK generation and decoded output; post-request validation/telemetry excluded' };
}

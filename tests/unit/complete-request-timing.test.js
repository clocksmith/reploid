// @vitest-environment node
import { expect, it } from 'vitest';
import { timeCompleteRequest, COMPLETE_REQUEST_TIMING_SCOPE } from '../fixtures/complete-request-timing.js';
import { runNativeCompleteRequest } from '../fixtures/native-complete-request.js';
import { runPooledCompleteRequest } from '../fixtures/peers/pooled/complete-request.js';

it('includes reset, generation and decoded output equally, excluding later validation', async () => {
  for (const kind of ['native', 'peer']) {
    let now = 0;
    const clock = () => now;
    let result;
    if (kind === 'native') {
      const receipt = { inputTokenIds: [1], generatedTokenIds: [5, 6],
        get outputText() { now += 4; return 'text'; }, policy: { id: 'demo/always-on', modifiesExecution: false },
        performanceRepresentative: true, wallTimingMs: 0, generationEvidence: {} };
      result = await runNativeCompleteRequest({ prompt: 'prompt', promptIds: [1], generation: { maxTokens: 2 }, timeoutMs: 1000, clock,
        model: { resetGenerationState() { now += 2; }, inspect: { async generate(prompt, options) {
          now += 3; options.onEvent({ type: 'token', tokenId: 5 });
          now += 5; options.onEvent({ type: 'token', tokenId: 6 }); return receipt;
        } } } });
    } else {
      result = await runPooledCompleteRequest({ promptIds: [1], maxNew: 2, stopIds: [], timeoutMs: 1000, clock,
        makeSampler: () => logits => logits[0], room: {
          ai: { engine: { maxSeq: 2048 }, fed: 'old-prefix', tok: { decode() { now += 4; return 'text'; } } },
          ckptClear() { now += 2; }, locked: operation => operation(),
          async generate(ids, options) {
            now += 3; options.sample([5]); options.onToken(5);
            now += 5; options.sample([6]); options.onToken(6);
            return { tokens: [5, 6], reused: 0, resumed: 0, prefilled: 1, pinned: 0, from: null, count: 2, reason: 'max' };
          },
        } });
    }
    expect(result).toMatchObject({ timingScope: COMPLETE_REQUEST_TIMING_SCOPE, requestWallMs: 14, generationWallMs: 12,
      resetMs: 2, ttftMs: 3, decodeCompletionMs: 9, decodeTailMs: 5 });
  }
});

it('cancels decode publication and rejects nonmonotonic clocks', async () => {
  const abort = new AbortController();
  await expect(timeCompleteRequest({ reset() {}, generate: () => ({}), timeoutMs: 1000, signal: abort.signal,
    decode() { abort.abort(new Error('cancel output')); return 'never-published'; } })).rejects.toThrow('cancel output');
  let now = 5;
  await expect(timeCompleteRequest({ reset() { now = 1; }, generate: () => ({}), decode: () => '', timeoutMs: 1000,
    clock: () => now })).rejects.toThrow('clock');
});

it('includes actual peer tokenization in complete requests and rejects a changed input before generation', async () => {
  let now = 0, generated = 0;
  const room = {
    ai: { engine: { maxSeq: 2048 }, tok: { decode() { now += 3; return 'answer'; } } },
    ckptClear() { now += 2; }, locked: operation => operation(),
    async generate(ids, options) {
      generated++; expect(ids).toEqual([1, 2]);
      now += 5; options.sample([7]); options.onToken(7);
      return { tokens: [7], resumed: 0, reused: 0, prefilled: 2, pinned: 0, from: null, count: 1, reason: 'max' };
    },
  };
  const settings = { room, promptIds: [1, 2], maxNew: 1, stopIds: [], makeSampler: () => logits => logits[0],
    timeoutMs: 1000, clock: () => now };
  const result = await runPooledCompleteRequest({ ...settings, tokenizePrompt() { now += 11; return Uint32Array.of(1, 2); } });
  expect(result).toMatchObject({ requestWallMs: 21, resetMs: 13, generationWallMs: 8,
    inputIds: [1, 2], inputScope: 'Actual prompt tokenization included in request/reset time' });
  await expect(runPooledCompleteRequest({ ...settings, tokenizePrompt: () => [1, 9] }))
    .rejects.toThrow('Peer tokenizer differs');
  expect(generated).toBe(1);
});

function sourceFixture() {
  const keys = ['cuts', 'lookups', 'hits', 'misses', 'diskReads', 'diskBytes', 'diskWaitMs',
    't1Copies', 't1Writes', 'regionCuts', 'regionBytes', 'layerLoads', 'layerBytes'];
  const counters = Object.fromEntries(keys.map(key => [key, 10]));
  let reads = 0;
  const settings = { promptIds: [1], maxNew: 2, stopIds: [], timeoutMs: 1000,
    makeSampler: () => logits => logits[0], sourceCounters() { reads++; return counters; },
    room: { ai: { engine: { maxSeq: 2048 }, tok: { decode: () => 'text' } }, ckptClear() {},
      locked: operation => operation(), async generate(ids, options) {
        for (const key of keys) counters[key] += 3;
        options.sample([5]); options.onToken(5);
        for (const key of keys) counters[key] += 7;
        options.sample([6]); options.onToken(6);
        return { tokens: [5, 6], reused: 0, resumed: 0, prefilled: 1, pinned: 0, from: null, count: 2, reason: 'max' };
      } } };
  return { settings, counters, reads: () => reads };
}

it('captures complete source-counter deltas at the public first-token boundary only when opted in', async () => {
  const f = sourceFixture(), result = await runPooledCompleteRequest(f.settings);
  expect(f.reads()).toBe(3);
  expect(result.performanceRepresentative).toBe(false);
  expect(result.sourceObservation).toMatchObject({ schema: 'reploid.peer-source-phases/v1',
    performanceRepresentative: false, prefill: { diskBytes: 3, diskWaitMs: 3 }, decode: { diskBytes: 7, diskWaitMs: 7 } });
  f.counters.diskBytes = 999;
  expect(result.sourceObservation.prefill.diskBytes).toBe(3);
  const ordinary = sourceFixture(); delete ordinary.settings.sourceCounters;
  const output = await runPooledCompleteRequest(ordinary.settings);
  expect(ordinary.reads()).toBe(0);
  expect(output).not.toHaveProperty('sourceObservation');
  expect(output).not.toHaveProperty('performanceRepresentative');
});

it('rejects missing, nonfinite and backwards peer source counters rather than fabricating phases', async () => {
  for (const change of [f => { delete f.counters.diskBytes; }, f => { f.counters.diskWaitMs = NaN; },
    f => { f.settings.sourceCounters = () => null; }]) {
    const f = sourceFixture(); change(f);
    await expect(runPooledCompleteRequest(f.settings)).rejects.toThrow(/source counter/u);
  }
  const backwards = sourceFixture(), generate = backwards.settings.room.generate;
  backwards.settings.room.generate = async (...args) => {
    const result = await generate(...args); backwards.counters.diskBytes = 0; return result;
  };
  await expect(runPooledCompleteRequest(backwards.settings)).rejects.toThrow(/counter reset/u);
});

// One clock contract for peer comparisons; engine-specific metadata stays outside.
import assert from 'node:assert/strict';
export const COMPLETE_REQUEST_TIMING_SCOPE = 'reset-to-decoded-output/v1';

export async function timeCompleteRequest({ reset, generate, decode, timeoutMs, signal, clock = () => performance.now() }) {
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, 'Complete request requires a finite deadline');
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  active.throwIfAborted();
  const started = clock();
  await reset(active);
  active.throwIfAborted();
  const generating = clock(), emissions = [];
  const result = await generate(value => {
    active.throwIfAborted();
    emissions.push({ token: value, ms: clock() - generating });
  }, active);
  active.throwIfAborted();
  const text = await decode(result);
  active.throwIfAborted();
  const finished = clock();
  assert(typeof text === 'string' && Number.isFinite(finished) && started <= generating && generating <= finished
    && emissions.every((row, index) => row.ms >= (emissions[index - 1]?.ms ?? 0) && row.ms <= finished - generating),
  'Invalid complete request output or clock');
  const ttftMs = emissions[0]?.ms ?? null;
  return { result, text, timing: {
    timingScope: COMPLETE_REQUEST_TIMING_SCOPE,
    requestWallMs: finished - started, generationWallMs: finished - generating, resetMs: generating - started,
    ttftMs, decodeCompletionMs: ttftMs === null ? null : finished - generating - ttftMs,
    decodeTailMs: emissions.length ? emissions.at(-1).ms - emissions[0].ms : null, emissions,
  } };
}

import assert from 'node:assert/strict';

const MAX_BYTES = 32 * 1024 * 1024;
const hashIdentity = value => typeof value === 'string' && /^(?:sha256:)?[0-9a-f]{64}$/u.test(value)
  ? 'sha256:' + value.replace(/^sha256:/u, '') : null;
function encode(values, shape) {
  const bytes = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index++) bytes.writeFloatLE(values[index], index * 4);
  return { encoding: 'f32-le-base64', shape, data: bytes.toString('base64') };
}

// Numerical evidence only: instrumentation and logits callbacks change execution.
export async function runNativeNumericalRequest({ model, prompt, promptIds, generation, timeoutMs, signal }) {
  assert(typeof prompt === 'string' && prompt.length > 0 && Array.isArray(promptIds) && promptIds.length === 1
    && Number.isSafeInteger(promptIds[0]) && promptIds[0] >= 0, 'Numerical diagnostic requires exactly one input token');
  assert(generation && typeof generation === 'object' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    'Numerical diagnostic requires settings and a finite deadline');
  const ids = [...promptIds], settings = { ...structuredClone(generation), maxTokens: 2 };
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  active.throwIfAborted(); await model.resetGenerationState(); active.throwIfAborted();
  const inspected = await model.inspect.generate(prompt, {
    policyId: 'demo/activation-grid', inputTokenIds: [...ids], generation: { ...settings, signal: active },
  });
  active.throwIfAborted();
  assert.deepEqual(inspected.inputTokenIds, ids, 'Numerical inspection input IDs changed');
  assert(inspected.policy?.id === 'demo/activation-grid' && inspected.policy.modifiesExecution === true
    && inspected.policy.performanceRepresentative === false && inspected.performanceRepresentative === false,
  'Numerical inspection must use the nonrepresentative activation-grid policy');
  const sampledIds = [...(inspected.generatedTokenIds ?? [])];
  assert(sampledIds.length === 2 && sampledIds.every(id => Number.isSafeInteger(id) && id >= 0)
    && typeof inspected.outputText === 'string', 'Numerical inspection requires exactly two generated tokens');
  const outputText = inspected.outputText;
  assert.equal(inspected.generationEvidence?.stats?.reusedPrefixTokens, 0, 'Numerical inspection reused a prefix');
  const trace = inspected.activationTrace, geometry = trace?.geometry;
  assert(trace?.schema === 'doppler.activation-trace/v1' && trace.status === 'complete' && trace.stoppedReason === null
    && Array.isArray(trace.frames), 'Complete unstopped activation trace is required');
  assert(geometry && Number.isSafeInteger(geometry.layers) && geometry.layers > 0
    && Number.isSafeInteger(geometry.width) && geometry.width > 0
    && Number.isSafeInteger(geometry.layers * geometry.width) && geometry.layers * geometry.width * 8 <= MAX_BYTES,
  'Activation geometry exceeds the bounded numerical diagnostic');
  const identity = { modelId: trace.identity?.modelId, manifestHash: hashIdentity(trace.identity?.manifestHash),
    runtimeVersion: trace.identity?.runtimeVersion };
  assert(typeof identity.modelId === 'string' && identity.modelId.length > 0 && identity.modelId.length <= 512
    && identity.manifestHash && typeof identity.runtimeVersion === 'string' && identity.runtimeVersion.length > 0
    && identity.runtimeVersion.length <= 128, 'Activation trace lacks a bounded model identity');
  const frames = trace.frames.filter(frame => frame.phase === 'decode').sort((a, b) => a.layer - b.layer);
  assert.equal(frames.length, geometry.layers, 'Decode trace has missing or duplicate layers');
  const layerOutputs = frames.map((frame, layer) => {
    assert(frame.layer === layer && frame.role === 'layer-output' && frame.dtype === 'f32' && frame.precision === null
      && frame.status === 'captured' && frame.reason === null, 'Invalid decode layer capture');
    assert.deepEqual(frame.shape, [1, geometry.width], 'Decode layer shape differs from trace geometry');
    assert.deepEqual(frame.tokenIds, [sampledIds[0]], 'Decode layer token differs from the generated prefix');
    assert(Array.isArray(frame.values) && frame.values.length === geometry.width
      && frame.values.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))),
    'Decode layer has missing or nonfinite F32 values');
    return { layer, dtype: 'f32', ...encode(frame.values, [1, geometry.width]) };
  });
  active.throwIfAborted(); await model.resetGenerationState(); active.throwIfAborted();
  const captures = [];
  const raw = await model.generateWithEvidence(prompt, { ...settings, inputIds: [...ids], signal: active,
    onLogits(values) {
      active.throwIfAborted();
      assert(captures.length < 2 && Number.isSafeInteger(values?.length) && values.length > 0
        && values.length * 4 <= MAX_BYTES, 'Unexpected or oversized full-logit capture');
      const copy = Float32Array.from(values);
      assert(copy.every(Number.isFinite), 'Nonfinite full-logit capture');
      assert(captures.length === 0 || copy.length === captures[0].length, 'Full-logit widths differ');
      captures.push(copy);
    } });
  active.throwIfAborted();
  assert.deepEqual(raw.tokenIds, sampledIds, 'Raw numerical tokens differ from activation inspection');
  assert.equal(raw.outputText, outputText, 'Raw numerical text differs from activation inspection');
  assert.equal(raw.stats?.reusedPrefixTokens, 0, 'Raw numerical generation reused a prefix');
  assert.equal(captures.length, 2, 'Exactly two complete full-logit callbacks are required');
  const rawIdentity = raw.runtimeProfile?.model;
  assert(rawIdentity?.modelId === identity.modelId && hashIdentity(rawIdentity.manifestHash) === identity.manifestHash,
    'Raw numerical model identity differs from activation inspection');
  const vocabSize = captures[0].length;
  assert(sampledIds.every(id => id < vocabSize), 'Generated token is outside full-logit width');
  assert(Math.ceil((geometry.layers * geometry.width * 4 + captures.length * vocabSize * 4) / 3) * 4 <= MAX_BYTES,
    'Encoded numerical payload exceeds the explicit bound');
  const logits = captures.map((values, step) => ({ step, dtype: 'f32', ...encode(values, [vocabSize]) }));
  active.throwIfAborted();
  return { scope: 'one-input-two-output-activation-grid-and-full-logits/diagnostic-v1', performanceRepresentative: false,
    geometry: { layers: geometry.layers, width: geometry.width, vocabSize }, identity, inputIds: ids,
    sampledIds, text: outputText, layerOutputs, logits };
}

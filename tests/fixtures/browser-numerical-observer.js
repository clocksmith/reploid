import { readFile } from 'node:fs/promises';

/** Read-only GPU copies at existing probe calls. No diagnostic flags, input
 * substitution, or kernel-selection changes. Copies affect memory and timing. */
export async function observeBrowserNumerics(page, packageRoot, { steps = [0, 1, 25, 50], countEmbeddings = false } = {}) {
  const source = (await readFile(`${packageRoot}/src/inference/pipelines/text/probes.js`, 'utf8')).split('\n');
  await page.evaluate(async ({ steps, countEmbeddings }) => {
    const config = await import('/config/doppler-local-models.js');
    const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
    const { getDevice } = await import(new URL('./gpu/device.js', base));
    const { f16ToF32 } = await import(new URL('./loader/dtype-utils.js', base));
    globalThis.numericalObservation = { enabled: true, prompt: 0, step: -1, steps, countEmbeddings,
      records: [], pending: [], errors: [],
      stages: ['embed_out', 'post_input_norm', 'linear_qkv_proj', 'attn_out', 'post_attn', 'ffn_out', 'layer_out', 'pre_final_norm', 'final_norm', 'logits', 'logits_final'] };
    globalThis.captureNumericalBoundary = (stage, buffer, options) => {
      const observation = globalThis.numericalObservation;
      const { hiddenSize, numTokens, layerIdx, recorder, dtype = 'f32' } = options;
      if (!buffer || !Number.isSafeInteger(hiddenSize) || !Number.isSafeInteger(numTokens)) throw Error('Probe geometry missing');
      const bytesPerElement = dtype === 'f16' ? 2 : 4;
      if (!['f16', 'f32'].includes(dtype)) throw Error('Unsupported diagnostic dtype');
      const offset = (numTokens - 1) * hiddenSize * bytesPerElement;
      const length = hiddenSize * bytesPerElement;
      const record = { prompt: observation.prompt, step: observation.step, stage,
        layer: layerIdx ?? null, dtype, shape: [numTokens, hiddenSize], row: numTokens - 1, data: null };
      observation.records.push(record);
      const encode = values => {
        const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
        let text = '';
        for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        record.data = btoa(text);
      };
      if (buffer instanceof Float32Array) { encode(buffer.slice(offset / 4, (offset + length) / 4)); return; }
      if (offset + length > buffer.size) throw Error('Probe geometry exceeds source buffer');
      const device = getDevice();
      const staging = device.createBuffer({ label: 'browser_numerical_observation', size: length,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const encoder = recorder ? recorder.getEncoder() : device.createCommandEncoder();
      encoder.copyBufferToBuffer(buffer, offset, staging, 0, length);
      const settle = async () => {
        let mapped = false;
        try {
          await staging.mapAsync(GPUMapMode.READ); mapped = true;
          const bytes = staging.getMappedRange().slice(0);
          const values = dtype === 'f32' ? new Float32Array(bytes) : Float32Array.from(new Uint16Array(bytes), f16ToF32);
          encode(values);
        } catch (error) { record.error = error.message; observation.errors.push(error.message); }
        finally { if (mapped) staging.unmap(); staging.destroy(); }
      };
      if (recorder) recorder.enqueueCompletionTask(settle);
      else { device.queue.submit([encoder.finish()]); observation.pending.push(settle()); }
    };
  }, { steps, countEmbeddings });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Debugger.enable');
  const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
    urlRegex: '/inference/pipelines/text/probes\\.js$',
    lineNumber: source.findIndex(line => line.includes('const { layerIdx, numTokens, hiddenSize, probes, recorder')),
    condition: 'globalThis.numericalObservation?.enabled && ((stage === "embed_out" && numericalObservation.countEmbeddings ? ++numericalObservation.step : 0), (numericalObservation.steps.includes(numericalObservation.step) || stage === "logits") && numericalObservation.stages.includes(stage))',
  });
  cdp.on('Debugger.paused', async event => {
    try {
      if (!event.hitBreakpoints.includes(breakpoint.breakpointId)) return;
      const result = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: event.callFrames[0].callFrameId,
        expression: 'captureNumericalBoundary(stage, buffer, options)', returnByValue: true,
      });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    } catch (error) {
      await cdp.send('Runtime.evaluate', { expression: `numericalObservation.errors.push(${JSON.stringify(error.message)})` });
    } finally { await cdp.send('Debugger.resume'); }
  });
  return { async read() {
    return page.evaluate(async () => {
      await Promise.all(numericalObservation.pending);
      return { records: numericalObservation.records, errors: numericalObservation.errors };
    });
  }, close: () => cdp.detach() };
}

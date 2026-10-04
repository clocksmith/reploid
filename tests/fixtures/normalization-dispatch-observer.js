import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { normalizationArgumentLayout } from './normalization-argument-layout.js';

/** Read-only call/registry/cache observations joined to native pipeline binding
 * and dispatch. Never replaces a tensor, shader, option, or pipeline. */
export async function observeNormalizationDispatch(page, sources = []) {
  await page.evaluate(async () => {
    const config = await import('/config/doppler-local-models.js');
    const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
    const { getLayerSteps } = await import(new URL('./config/kernel-path-loader.js', base));
    const pipelineInfo = new WeakMap(), shaderSources = new WeakMap(), groupInfo = new WeakMap();
    const passPipeline = new WeakMap(), passGroups = new WeakMap(), bufferIds = new WeakMap();
    let nextBuffer = 1, active = null, forwarded = null;
    const trace = globalThis.normalizationDispatch = { calls: [], pipelines: [], errors: [] };
    const buffer = value => {
      value = value?.buffer ?? value;
      if (!value) return null;
      if (!bufferIds.has(value)) bufferIds.set(value, nextBuffer++);
      return { id: bufferIds.get(value), label: value.label, bytes: value.size };
    };
    const summarize = call => ({ interception: call.name, optionsArgumentIndex: call.optionsIndex,
      input: buffer(call.input), weight: buffer(call.weight), epsilon: call.epsilon,
      recorderPresent: !!call.recorder, optionKeys: Object.keys(call.options ?? {}),
      options: Object.fromEntries(['batchSize', 'hiddenSize', 'rmsNormWeightOffset', 'outputScale', 'label', 'layerIdx', 'role', 'phase', 'section']
        .filter(key => call.options?.[key] !== undefined).map(key => [key, call.options[key]])),
      optionBuffers: Object.fromEntries(['residual', 'preResidual', 'residualSumOutput', 'outputBuffer']
        .filter(key => call.options?.[key] != null).map(key => [key, buffer(call.options[key])])),
      optionsHaveKernelPath: !!call.options?.kernelPath });
    trace.forward = call => { forwarded = call; };
    trace.begin = (call, resolved, graph) => {
      if (active && !active.dispatch) trace.errors.push('A normalization call was replaced before its dispatch');
      const section = graph.section === 'layer' ? getLayerSteps(graph.kernelPath, graph.layerIdx, graph.phase)
        : graph.kernelPath[graph.section];
      const steps = section.filter(step => step.op === graph.role);
      if (steps.length !== 1) throw Error('Normalization graph operation is missing or ambiguous');
      active = { id: trace.calls.length, prompt: numericalObservation.prompt, step: numericalObservation.step,
        ...summarize(call), resolved,
        graph: { operation: graph.role, section: graph.section, phase: graph.phase, layer: graph.layerIdx,
          pathId: graph.kernelPath.id, activationDtype: graph.kernelPath.activationDtype, declaration: steps[0] },
        forwarder: forwarded?.options === call.options && forwarded?.input === call.input ? summarize(forwarded) : null };
      trace.calls.push(active); forwarded = null;
    };
    trace.cache = cache => { if (!active) throw Error('Cache lookup has no normalization owner'); active.cache = cache; };
    trace.pipeline = (pipeline, selected) => {
      if (!active) throw Error('Pipeline resolution has no normalization owner');
      const info = pipelineInfo.get(pipeline);
      if (!info) throw Error('Dispatched pipeline was not observed at creation');
      active.pipelineId = info.id; active.selected = selected;
    };
    const shader = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      const module = shader.call(this, descriptor); shaderSources.set(module, descriptor.code); return module;
    };
    for (const method of ['createComputePipeline', 'createComputePipelineAsync']) {
      const create = GPUDevice.prototype[method];
      GPUDevice.prototype[method] = function (descriptor) {
        const observe = pipeline => {
          if (descriptor.label?.startsWith('rmsnorm_')) {
            const info = { id: trace.pipelines.length, label: descriptor.label,
              entryPoint: descriptor.compute.entryPoint, constants: descriptor.compute.constants,
              shaderSource: shaderSources.get(descriptor.compute.module) };
            pipelineInfo.set(pipeline, info); trace.pipelines.push(info);
          }
          return pipeline;
        };
        const result = create.call(this, descriptor);
        return method.endsWith('Async') ? result.then(observe) : observe(result);
      };
    }
    const createGroup = GPUDevice.prototype.createBindGroup;
    GPUDevice.prototype.createBindGroup = function (descriptor) {
      const group = createGroup.call(this, descriptor);
      if (descriptor.label === 'rmsnorm_bind_group') groupInfo.set(group, descriptor.entries.map(entry => ({
        binding: entry.binding, buffer: buffer(entry.resource.buffer), offset: entry.resource.offset ?? 0,
        size: entry.resource.size ?? null,
      })));
      return group;
    };
    const setPipeline = GPUComputePassEncoder.prototype.setPipeline;
    GPUComputePassEncoder.prototype.setPipeline = function (pipeline) {
      const result = setPipeline.call(this, pipeline); passPipeline.set(this, pipeline); return result;
    };
    const setGroup = GPUComputePassEncoder.prototype.setBindGroup;
    GPUComputePassEncoder.prototype.setBindGroup = function (...args) {
      const result = setGroup.apply(this, args);
      if (args[0] === 0) passGroups.set(this, args[1]); return result;
    };
    for (const method of ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']) {
      const dispatch = GPUComputePassEncoder.prototype[method];
      GPUComputePassEncoder.prototype[method] = function (...args) {
        const result = dispatch.apply(this, args), pipeline = pipelineInfo.get(passPipeline.get(this));
        if (active && pipeline?.id === active.pipelineId) {
          active.dispatch = { method, pipelineId: pipeline.id, bindings: groupInfo.get(passGroups.get(this)),
            dimensions: method === 'dispatchWorkgroups' ? args : null };
          active = null;
        }
        return result;
      };
    }
  });
  const cdp = await page.context().newCDPSession(page), points = new Map(), errors = [];
  await cdp.send('Debugger.enable');
  const add = async (file, name, marker, action, condition = '') => {
    const source = sources.find(source => source.path === file)?.body ?? await readFile(`node_modules/doppler-gpu/src/${file}`, 'utf8');
    const fn = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .map(node => node.declaration ?? node).find(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
    if (!fn) throw Error(`Missing diagnostic function ${name}`);
    const position = source.indexOf(marker, fn.start);
    if (position < fn.start || position >= fn.end) throw Error(`Missing diagnostic boundary ${name}: ${marker}`);
    const { breakpointId } = await cdp.send('Debugger.setBreakpointByUrl', {
      urlRegex: '/' + file.replaceAll('.', '\\.') + '$',
      lineNumber: source.slice(0, position).split('\n').length - 1, condition,
    });
    points.set(breakpointId, { name, action });
  };
  await add('inference/pipelines/text/ops.js', 'doRMSNorm', 'const result = recorder', 'forward');
  for (const name of ['runRMSNorm', 'recordRMSNorm']) await add('gpu/kernels/rmsnorm.js', name, 'const bytesPerElement', 'begin');
  await add('gpu/kernels/pipeline-cache.js', 'getCachedPipeline', 'return pipelineCache.get(cacheKey)', 'cache', 'operation === "rmsnorm"');
  await add('gpu/kernels/kernel-execution.js', 'unifiedKernelWrapper', 'const bindGroupEntries = []', 'pipeline', 'opName === "rmsnorm"');
  const graphs = [
    ['runLinearAttentionLayer', '({kernelPath, phase, layerIdx, role:"input_norm", section:"layer"})'],
    ['interpretAttentionWithRecorder', '({kernelPath, phase, layerIdx, role:"input_norm", section:"layer"})'],
    ['processFFNStandard', '({kernelPath:context.kernelPath,phase:context.phase,layerIdx,role:"post_attn_norm",section:"layer"})'],
    ...['computeLogits', 'computeLogitsGPU', 'recordLogitsTailGPU'].map(name => [name,
      '({kernelPath:stableKernelPath,phase,layerIdx:0,role:"final_norm",section:"postLayer"})']),
  ];
  const evaluate = async (frame, expression) => {
    const result = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  cdp.on('Debugger.paused', async event => {
    try {
      const point = event.hitBreakpoints.map(id => points.get(id)).find(Boolean);
      if (!point) return;
      const frame = event.callFrames[0];
      if (point.action === 'cache') await evaluate(frame, 'normalizationDispatch.cache({key:cacheKey,hit:pipelineCache.has(cacheKey)})');
      else if (point.action === 'pipeline') await evaluate(frame,
        'normalizationDispatch.pipeline(pipeline,{variant,shaderFile:config.shaderFile,entryPoint:config.entryPoint,constants,uniforms,workgroups})');
      else {
        const slots = normalizationArgumentLayout(point.name);
        const call = `({name:${JSON.stringify(point.name)},optionsIndex:${slots.options},input:arguments[${slots.input}],weight:arguments[${slots.weight}],epsilon:arguments[${slots.epsilon}],options:arguments[${slots.options}],recorder:${slots.recorder === null ? 'null' : `arguments[${slots.recorder}]`}})`;
        if (point.action === 'forward') await evaluate(frame, `normalizationDispatch.forward(${call})`);
        else {
          const parent = event.callFrames.find(frame => graphs.some(([name]) => frame.functionName === name));
          if (!parent) throw Error('Normalization graph caller not found');
          const graph = await evaluate(parent, graphs.find(([name]) => parent.functionName === name)[1]);
          await evaluate(frame, `normalizationDispatch.begin(${call},{variant,inputDtype:input.dtype,weightDtype:normWeightDtype,hiddenSize:inferredHiddenSize},${JSON.stringify(graph)})`);
        }
      }
    } catch (error) { errors.push(error.message); }
    finally { await cdp.send('Debugger.resume'); }
  });
  return {
    async read() {
      const result = await page.evaluate(() => ({ calls: normalizationDispatch.calls, pipelines: normalizationDispatch.pipelines, errors: normalizationDispatch.errors }));
      for (const call of result.calls) {
        const pipeline = result.pipelines.find(pipeline => pipeline.id === call.dispatch?.pipelineId);
        if (!pipeline || call.pipelineId !== call.dispatch.pipelineId || !call.cache
          || pipeline.entryPoint !== call.selected?.entryPoint
          || call.dispatch.bindings?.find(binding => binding.binding === 1)?.buffer?.id !== call.input.id
          || call.dispatch.bindings?.find(binding => binding.binding === 2)?.buffer?.id !== call.weight.id) {
          result.errors.push(`Incomplete or inconsistent normalization dispatch ${call.id}`);
        }
      }
      for (const pipeline of result.pipelines) {
        pipeline.shaderSha256 = createHash('sha256').update(pipeline.shaderSource).digest('hex'); delete pipeline.shaderSource;
      }
      return { records: result.calls.map(data => ({ data })), pipelines: result.pipelines, errors: [...errors, ...result.errors] };
    }, close: () => cdp.detach(),
  };
}

/** Shared physical fixture preparation; runs in browser or owned Node inspector. */
export async function preparePartitionMemory({ model, index, modelSource, pairedBinding, config, policy }) {
      const importModule = globalThis.__nativePartitionFixture
        ? url => globalThis.__nativePartitionFixture.importModule(String(url)) : url => import(url);
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL);
      globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
      const runtime = await importModule(config.DOPPLER_PARTITIONS_MODULE_URL);
      const { getDevice, getKernelCapabilities } = await importModule(new URL('./gpu/device.js', base));
      const { getBufferPool } = await importModule(new URL('./memory/buffer-pool.js', base));
      const { createHttpArtifactStorageContext } = await importModule(new URL('./storage/artifact-storage-context.js', base));
      if (policy.maxGpuBufferBytes !== 1420000000) throw Error('Allocation budget changed');
      const source = modelSource;
      const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
      const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (identity !== model.identity) throw Error('Model identity changed');
      if (pairedBinding && identity !== pairedBinding.manifestIdentity) throw Error('Paired bound model differs');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      const legacyPlan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
        splitLayer: model.partitionSplitLayer,
        activationDtype: manifest.inference.session.compute.defaults.activationDtype });
      const plan = pairedBinding ? runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
        splitLayer: model.partitionSplitLayer, activationDtype: manifest.inference.session.compute.defaults.activationDtype,
        ...pairedBinding.activation }) : legacyPlan;
      const planId = runtime.hashLayerPartitionPlan(plan);
      const legacyPlanId = runtime.hashLayerPartitionPlan(legacyPlan);
      await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
      globalThis.gpuValidationErrors = [];
      globalThis.partitionDeviceEvents = [];
      globalThis.partitionGpuSubmissions = [];
      const preparedDevice = getDevice();
      const pipelineMetadata = new WeakMap(), commandMetadata = new WeakMap(), bindingMetadata = new WeakMap();
      let submissionCount = 0;
      if (typeof preparedDevice.createBindGroup === 'function') {
        const create = preparedDevice.createBindGroup.bind(preparedDevice);
        preparedDevice.createBindGroup = descriptor => {
          const group = create(descriptor);
          bindingMetadata.set(group, descriptor.entries.map(entry => ({ binding: entry.binding,
            bufferLabel: entry.resource.buffer?.label ?? null, bufferBytes: entry.resource.buffer?.size ?? null,
            offset: entry.resource.offset ?? null, size: entry.resource.size ?? null })));
          return group;
        };
      }
      for (const method of ['createComputePipeline', 'createComputePipelineAsync']) {
        if (typeof preparedDevice[method] !== 'function') continue;
        const create = preparedDevice[method].bind(preparedDevice);
        preparedDevice[method] = descriptor => {
          const retain = pipeline => { pipelineMetadata.set(pipeline, { label: descriptor.label ?? null,
            entryPoint: descriptor.compute.entryPoint, constants: { ...descriptor.compute.constants } }); return pipeline; };
          const result = create(descriptor);
          return method.endsWith('Async') ? result.then(retain) : retain(result);
        };
      }
      if (typeof preparedDevice.createCommandEncoder === 'function') {
        const create = preparedDevice.createCommandEncoder.bind(preparedDevice);
        preparedDevice.createCommandEncoder = descriptor => {
          const encoder = create(descriptor), commands = [];
          const begin = encoder.beginComputePass.bind(encoder), finish = encoder.finish.bind(encoder);
          encoder.beginComputePass = options => {
            const pass = begin(options), set = pass.setPipeline.bind(pass), dispatch = pass.dispatchWorkgroups.bind(pass);
            const bindings = {};
            if (typeof pass.setBindGroup === 'function') {
              const bind = pass.setBindGroup.bind(pass);
              pass.setBindGroup = (index, group, ...offsets) => {
                bindings[index] = bindingMetadata.get(group) ?? null; return bind(index, group, ...offsets);
              };
            }
            if (typeof pass.dispatchWorkgroupsIndirect === 'function') {
              const indirect = pass.dispatchWorkgroupsIndirect.bind(pass);
              pass.dispatchWorkgroupsIndirect = (buffer, offset) => {
                commands.push({ pipeline, bindings: { ...bindings }, indirect: { bufferLabel: buffer.label, offset } }); return indirect(buffer, offset);
              };
            }
            let pipeline = null;
            pass.setPipeline = value => { pipeline = pipelineMetadata.get(value) ?? { label: value.label }; return set(value); };
            pass.dispatchWorkgroups = (x, y, z) => {
              commands.push({ pipeline, bindings: { ...bindings }, workgroups: [x, y ?? 1, z ?? 1] }); return dispatch(x, y, z);
            };
            return pass;
          };
          encoder.finish = options => { const buffer = finish(options);
            commandMetadata.set(buffer, { label: descriptor?.label ?? null, commands }); return buffer; };
          return encoder;
        };
      }
      const recordDeviceEvent = event => partitionDeviceEvents.push({ at: new Date().toISOString(), ...event });
      preparedDevice.addEventListener('uncapturederror', event => {
        gpuValidationErrors.push(event.error.message);
        recordDeviceEvent({ type: 'uncaptured-error', message: event.error.message });
      });
      preparedDevice.lost.then(info => recordDeviceEvent({ type: 'device-lost', reason: info.reason, message: info.message }));
      globalThis.memorySnapshot = () => {
        const snapshot = { device: null, pool: null, activeLabels: null,
          gpuValidationErrors: [...gpuValidationErrors], deviceEvents: [...partitionDeviceEvents],
          submissions: [...partitionGpuSubmissions], observationErrors: [] };
        for (const [operation, read] of [
          ['device', () => runtime.inspectDeviceMemory()], ['pool', () => getBufferPool().getStats()],
          ['activeLabels', () => getBufferPool().getLabelStats()]
        ]) {
          try { snapshot[operation] = read(); }
          catch (error) { snapshot.observationErrors.push({ operation, message: error.message }); }
        }
        return snapshot;
      };
      globalThis.settleMemory = async () => {
        try { await preparedDevice.queue.onSubmittedWorkDone(); }
        catch (error) { recordDeviceEvent({ type: 'queue-failed', message: error.message }); throw error; }
        return memorySnapshot();
      };
      globalThis.rejectOversizedAllocation = async () => {
        const before = await settleMemory();
        try {
          const buffer = getDevice().createBuffer({ label: 'diagnostic_budget_guard',
            size: policy.maxGpuBufferBytes + 4, usage: GPUBufferUsage.STORAGE });
          buffer.destroy(); throw Error('Oversized allocation was not rejected');
        } catch (error) {
          if (error.code !== 'RESOURCE_EXHAUSTED') throw error;
          return { scope: 'Direct allocation-guard rejection, not an injected model-operation failure',
            code: error.code, before, after: await settleMemory() };
        }
      };
      const beforePreparation = { device: runtime.inspectDeviceMemory() };
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
        runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: false } } }, inference: { session: {
          ...pairedBinding?.session, kvcache: { maxSeqLen: model.generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers,
          prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
        createStorage: () => createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
      globalThis.resident = await factory.openResidentPartition({ model, plan, planId, index,
        participantId: index ? 'memory-B' : 'memory-A', limits: policy.limits, signal: new AbortController().signal });
      globalThis.chunks = []; globalThis.observePrefill = false; globalThis.abortOnSubmit = null;
      const submit = getDevice().queue.submit.bind(getDevice().queue);
      getDevice().queue.submit = buffers => {
        const submitted = Array.from(buffers);
        partitionGpuSubmissions.push({ index: submissionCount++, at: new Date().toISOString(),
          commandBuffers: submitted.map(buffer => commandMetadata.get(buffer) ?? { label: buffer.label, unobserved: true }) });
        if (partitionGpuSubmissions.length > 32) partitionGpuSubmissions.shift();
        const result = submit(submitted);
        if (observePrefill) chunks.push(memorySnapshot());
        if (abortOnSubmit) {
          abortOnSubmit.abort(new DOMException('diagnostic prefill cancellation', 'AbortError')); abortOnSubmit = null;
        }
        return result; };
      globalThis.encodeBytes = data => {
        const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(text);
      };
      return { descriptor: resident.getDescriptor(), packageVersion: config.DOPPLER_PACKAGE_VERSION,
        beforePreparation, afterPreparation: await settleMemory(), planId, legacyPlanId, plan, legacyPlan,
        observedProvider: { userAgent: navigator.userAgent, platform: navigator.platform,
          adapter: (() => { const info = getKernelCapabilities().adapterInfo; return info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null; })() } };

}

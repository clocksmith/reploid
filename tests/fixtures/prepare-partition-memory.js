/** Shared physical fixture preparation; runs in browser or owned Node inspector. */
export async function preparePartitionMemory({ model, index, modelSource, pairedBinding, config, policy }) {
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL);
      globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
      const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
      const { getDevice, getKernelCapabilities } = await import(new URL('./gpu/device.js', base));
      const { getBufferPool } = await import(new URL('./memory/buffer-pool.js', base));
      const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
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
      getDevice().addEventListener('uncapturederror', event => gpuValidationErrors.push(event.error.message));
      globalThis.memorySnapshot = () => ({ device: runtime.inspectDeviceMemory(),
        pool: getBufferPool().getStats(), activeLabels: getBufferPool().getLabelStats(),
        gpuValidationErrors: [...gpuValidationErrors] });
      globalThis.settleMemory = async () => { await getDevice().queue.onSubmittedWorkDone(); return memorySnapshot(); };
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
      getDevice().queue.submit = buffers => { const result = submit(buffers);
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

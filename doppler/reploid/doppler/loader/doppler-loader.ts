/**
 * DopplerLoader - Core Model Loader
 * Phase 1: Foundation
 *
 * Orchestrates the complete model loading pipeline:
 * - Storage: Load shards from OPFS
 * - Memory: Stage in heap (Memory64 or segmented)
 * - GPU: Transfer to VRAM for compute
 *
 * @module loader/doppler-loader
 */

import { getMemoryCapabilities, type MemoryCapabilities } from '../memory/capability.js';
import { detectUnifiedMemory } from '../memory/unified-detect.js';
import { HeapManager, getHeapManager } from '../memory/heap-manager.js';
import {
  initOPFS,
  openModelDirectory,
  loadShard as loadShardFromOPFS,
  verifyIntegrity,
  loadManifestFromOPFS,
  computeHash,
} from '../storage/shard-manager.js';
import {
  parseManifest,
  getShardInfo,
  getShardCount,
  isMoE,
  type RDRRManifest,
  type ShardInfo,
  type HashAlgorithm,
} from '../storage/rdrr-format.js';
import { initDevice, getDevice, getKernelCapabilities } from '../gpu/device.js';
import { acquireBuffer, releaseBuffer } from '../gpu/buffer-pool.js';
import { dequantize, castF32ToF16 } from '../gpu/kernel-selector.js';
import { getBufferDtype } from '../gpu/buffer-dtypes.js';

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Tensor location in loaded model
 */
export interface TensorLocation {
  shardIndex: number;
  offset: number;
  size: number;
  shape: number[];
  dtype: string;
  spans?: Array<{ shardIndex: number; offset: number; size: number }>;
}

/**
 * Loaded layer weights
 */
export interface LayerWeights {
  inputNorm: GPUBuffer | Float32Array | null;
  qProj: GPUBuffer | Float32Array | null;
  kProj: GPUBuffer | Float32Array | null;
  vProj: GPUBuffer | Float32Array | null;
  oProj: GPUBuffer | Float32Array | null;
  qNorm: GPUBuffer | Float32Array | null;
  kNorm: GPUBuffer | Float32Array | null;
  postAttentionNorm: GPUBuffer | Float32Array | null;
  preFeedforwardNorm: GPUBuffer | Float32Array | null;
  postFeedforwardNorm: GPUBuffer | Float32Array | null;
  postNorm: GPUBuffer | Float32Array | null;
  postAttnNorm: GPUBuffer | Float32Array | null;
  ffnGate: GPUBuffer | Float32Array | null;
  ffnUp: GPUBuffer | Float32Array | null;
  ffnDown: GPUBuffer | Float32Array | null;
  routerWeight?: GPUBuffer | Float32Array | null;
  routerBias?: GPUBuffer | Float32Array | null;
  attentionSinks?: GPUBuffer | Float32Array | null;
}

/**
 * Expert weights
 */
export interface ExpertWeights {
  gate?: GPUBuffer | Float32Array | null;
  up?: GPUBuffer | Float32Array | null;
  down?: GPUBuffer | Float32Array | null;
  isGptOss?: boolean;
  expertIdx?: number;
  numExperts?: number;
  gateUpBlocks?: GPUBuffer | null;
  gateUpScales?: GPUBuffer | null;
  gateUpBias?: GPUBuffer | null;
  downBlocks?: GPUBuffer | null;
  downScales?: GPUBuffer | null;
  downBias?: GPUBuffer | null;
}

/**
 * Loading progress information
 */
export interface LoadProgress {
  stage: 'manifest' | 'layers' | 'complete';
  progress: number;
  layer?: number;
  total?: number;
}

/**
 * Loading options
 */
export interface LoadOptions {
  onProgress?: (progress: LoadProgress) => void;
  verifyHashes?: boolean;
}

/**
 * Custom shard loader options
 */
export interface CustomShardLoaderOptions {
  verify?: boolean;
}

/**
 * Custom shard loader function
 */
export type CustomShardLoader = (shardIndex: number) => Promise<Uint8Array>;

/**
 * Loader statistics
 */
export interface LoaderStats {
  modelId: string | null;
  isLoaded: boolean;
  isMoE: boolean;
  isUnifiedMemory: boolean;
  layersLoaded: number;
  expertsLoaded: number;
  gpuBuffers: number;
}

/**
 * GPU kernel capabilities
 */
interface KernelCapabilities {
  hasF16: boolean;
  hasSubgroups: boolean;
}

/**
 * Model config (flexible structure from manifest)
 */
interface ModelConfig {
  num_hidden_layers?: number;
  blockCount?: number;
  text_config?: { num_hidden_layers?: number };
  n_layer?: number;
  num_local_experts?: number;
  num_experts?: number;
  architectures?: string[];
  model_type?: string;
  [key: string]: unknown;
}

// ============================================================================
// DopplerLoader Class
// ============================================================================

/**
 * DopplerLoader class
 */
export class DopplerLoader {
  // Capabilities
  memoryCapabilities: MemoryCapabilities | null = null;
  gpuCapabilities: KernelCapabilities | null = null;
  isUnifiedMemory = false;

  // Manifest and model info
  manifest: RDRRManifest | null = null;
  modelId: string | null = null;
  isMoE = false;

  // Loaded state
  isLoaded = false;
  embeddings: GPUBuffer | Float32Array | null = null;
  layers = new Map<number, LayerWeights>();
  experts = new Map<string, ExpertWeights>();
  lmHead: GPUBuffer | Float32Array | null = null;
  finalNorm: GPUBuffer | Float32Array | null = null;

  // Memory management
  heapManager: HeapManager | null = null;
  gpuBuffers = new Set<GPUBuffer>();

  // Loading state
  loadedShards = new Set<number>();
  tensorLocations = new Map<string, TensorLocation>();

  // Shard cache (small LRU) to avoid repeated OPFS reads during load
  shardCache = new Map<number, ArrayBuffer>();
  maxShardCacheEntries = 2;

  // Custom shard loader (for Native Bridge support)
  customLoadShard: CustomShardLoader | null = null;
  verifyCustomShards = true;

  // Internal tracking
  private _normOffsetLogged = false;

  constructor() {
    // All properties initialized above
  }

  /**
   * Set custom shard loader (e.g., for Native Bridge)
   */
  setCustomShardLoader(loadShardFn: CustomShardLoader, options: CustomShardLoaderOptions = {}): void {
    this.customLoadShard = loadShardFn;
    this.verifyCustomShards = options.verify !== false;
    console.log('[DopplerLoader] Custom shard loader configured');
  }

  /**
   * Load shard using custom loader or OPFS
   */
  private async _loadShard(shardIndex: number): Promise<ArrayBuffer> {
    if (this.shardCache.has(shardIndex)) {
      const cached = this.shardCache.get(shardIndex)!;
      // Refresh LRU order
      this.shardCache.delete(shardIndex);
      this.shardCache.set(shardIndex, cached);
      return cached;
    }

    if (this.customLoadShard) {
      let data: Uint8Array | ArrayBuffer = await this.customLoadShard(shardIndex);

      // Verify hash if enabled
      if (this.verifyCustomShards && this.manifest) {
        const shardInfo = this.manifest.shards?.[shardIndex];
        const expectedHash = shardInfo?.hash || shardInfo?.blake3;
        if (expectedHash) {
          const algorithm = this.manifest.hashAlgorithm || 'blake3';
          const computedHash = await computeHash(data, algorithm);
          if (computedHash !== expectedHash) {
            throw new Error(
              `Shard ${shardIndex} hash mismatch. Expected: ${expectedHash}, got: ${computedHash}`
            );
          }
        }
      }

      // Normalize to ArrayBuffer for downstream slicing
      let arrayBuffer: ArrayBuffer;
      if (data instanceof Uint8Array) {
        arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      } else {
        arrayBuffer = data;
      }

      this.shardCache.set(shardIndex, arrayBuffer);
      if (this.shardCache.size > this.maxShardCacheEntries) {
        const oldestKey = this.shardCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.shardCache.delete(oldestKey);
        }
      }

      return arrayBuffer;
    }

    const data = await loadShardFromOPFS(shardIndex);
    this.shardCache.set(shardIndex, data);
    if (this.shardCache.size > this.maxShardCacheEntries) {
      const oldestKey = this.shardCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.shardCache.delete(oldestKey);
      }
    }
    return data;
  }

  /**
   * Initialize loader and detect capabilities
   */
  async init(): Promise<void> {
    console.log('[DopplerLoader] Initializing...');

    // Detect memory capabilities
    this.memoryCapabilities = await getMemoryCapabilities();
    const unifiedInfo = await detectUnifiedMemory();
    this.isUnifiedMemory = unifiedInfo.isUnified;

    // Initialize GPU
    const device = await initDevice();
    if (!device) {
      throw new Error('Failed to initialize WebGPU device');
    }
    this.gpuCapabilities = getKernelCapabilities();

    // Initialize heap manager
    this.heapManager = getHeapManager();
    await this.heapManager.init();

    // Initialize OPFS
    await initOPFS();

    console.log('[DopplerLoader] Initialized:', {
      memory64: this.memoryCapabilities.hasMemory64,
      unified: this.isUnifiedMemory,
      f16: this.gpuCapabilities.hasF16,
      subgroups: this.gpuCapabilities.hasSubgroups,
    });
  }

  /**
   * Set manifest directly (for bridge/external loading)
   */
  setManifest(manifest: RDRRManifest): void {
    this.manifest = manifest;
    const config = manifest.config as ModelConfig | undefined;
    this.isMoE = manifest.moeConfig != null || (config?.num_local_experts ?? 0) > 1;
    console.log('[DopplerLoader] Manifest set externally');
  }

  /**
   * Load model from OPFS or external source
   */
  async load(modelId: string, options: LoadOptions = {}): Promise<ModelConfig> {
    const { onProgress = null, verifyHashes = true } = options;

    if (!this.heapManager) {
      await this.init();
    }

    // Avoid cross-model contamination when reusing the global loader instance.
    const hasExistingModelState =
      this.isLoaded ||
      this.modelId !== null ||
      this.tensorLocations.size > 0 ||
      this.shardCache.size > 0 ||
      this.layers.size > 0 ||
      this.experts.size > 0 ||
      this.gpuBuffers.size > 0;

    // Preserve manifest if set externally (for custom shard loader)
    const preservedManifest = this.customLoadShard ? this.manifest : null;

    if (hasExistingModelState) {
      await this.unload();
    }

    // Restore preserved manifest after unload
    if (preservedManifest) {
      this.manifest = preservedManifest;
    }

    console.log(`[DopplerLoader] Loading model: ${modelId}`);
    this.modelId = modelId;

    // If using custom shard loader (bridge), manifest should be set externally
    if (!this.customLoadShard) {
      await openModelDirectory(modelId);
      const manifestJson = await loadManifestFromOPFS();
      this.manifest = parseManifest(manifestJson);
    }

    if (!this.manifest) {
      throw new Error('No manifest available. Set manifest via setManifest() or ensure OPFS has the model.');
    }

    // Check model type
    const config = this.manifest.config as ModelConfig | undefined;
    this.isMoE = this.manifest.moeConfig != null ||
                 (config?.num_local_experts ?? 0) > 1 ||
                 isMoE();

    // Enforce dense/MoE gating based on hardware
    if (!this.isMoE && !this.isUnifiedMemory) {
      console.warn(
        '[DopplerLoader] Dense model on discrete GPU - performance will be severely limited. ' +
        'Consider using an MoE model for better performance.'
      );
    }

    // Verify integrity if requested (only for OPFS path)
    if (verifyHashes && !this.customLoadShard) {
      const integrity = await verifyIntegrity();
      if (!integrity.valid) {
        throw new Error(
          `Model integrity check failed. ` +
          `Missing shards: ${integrity.missingShards.length}, ` +
          `Corrupt shards: ${integrity.corruptShards.length}`
        );
      }
    }

    // Build tensor location map from manifest
    this._buildTensorLocations();

    if (onProgress) {
      onProgress({ stage: 'manifest', progress: 0.05 });
    }

    // Load embeddings (always needed)
    await this._loadEmbeddings(onProgress);

    // Load layers
    const numLayers = config?.num_hidden_layers ||
                      config?.blockCount ||
                      config?.text_config?.num_hidden_layers ||
                      config?.n_layer ||
                      (this.manifest.architecture as { numLayers?: number } | undefined)?.numLayers ||
                      32;
    console.log(`[DopplerLoader] Loading ${numLayers} layers`);

    for (let l = 0; l < numLayers; l++) {
      await this._loadLayer(l, onProgress);

      if (onProgress) {
        const layerProgress = 0.1 + (l / numLayers) * 0.8;
        onProgress({ stage: 'layers', layer: l, total: numLayers, progress: layerProgress });
      }
    }

    // Load final norm and LM head
    await this._loadFinalWeights(onProgress);

    if (onProgress) {
      onProgress({ stage: 'complete', progress: 1.0 });
    }

    this.isLoaded = true;
    console.log(`[DopplerLoader] Model loaded: ${modelId}`);

    return (this.manifest.config as ModelConfig) || {};
  }

  /**
   * Build tensor location map from manifest
   */
  private _buildTensorLocations(): void {
    this.tensorLocations.clear();

    if (!this.manifest?.tensors) {
      console.warn('[DopplerLoader] No tensor locations in manifest');
      return;
    }

    for (const [name, info] of Object.entries(this.manifest.tensors)) {
      const tensorInfo = info as {
        shard: number;
        offset: number;
        size: number;
        shape: number[];
        dtype: string;
        spans?: Array<{ shardIndex: number; offset: number; size: number }>;
      };
      this.tensorLocations.set(name, {
        shardIndex: tensorInfo.shard,
        offset: tensorInfo.offset,
        size: tensorInfo.size,
        shape: tensorInfo.shape,
        dtype: tensorInfo.dtype,
        spans: tensorInfo.spans,
      });
    }
    console.log(`[DopplerLoader] Tensor map: ${this.tensorLocations.size} tensors`);
  }

  /**
   * Load a tensor by name
   */
  private async _loadTensor(
    name: string,
    toGPU = true,
    silent = false
  ): Promise<GPUBuffer | Float32Array | Uint8Array | null> {
    const location = this.tensorLocations.get(name);
    if (!location) {
      const altName = this._findAlternativeTensorName(name);
      if (altName) {
        return this._loadTensor(altName, toGPU, silent);
      }
      if (!silent) {
        console.warn(`[DopplerLoader] Tensor not found: ${name}`);
      }
      return null;
    }

    // Fast path for multi-shard tensors when uploading to GPU
    if (location.spans && toGPU) {
      const device = getDevice();
      if (!device) {
        console.warn('[DopplerLoader] GPU device not available; falling back to CPU assembly');
      } else {
        // Quantized tensors
        if (location.dtype === 'Q4_K_M' || location.dtype === 'Q4_K') {
          const quantBuffer = acquireBuffer(location.size, undefined, `quant_${name}`);
          let tensorOffset = 0;
          for (const span of location.spans) {
            const data = await this._loadShard(span.shardIndex);
            if (span.offset + span.size > data.byteLength) {
              throw new Error(
                `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span.`
              );
            }
            const bytes = new Uint8Array(data, span.offset, span.size);
            device.queue.writeBuffer(quantBuffer, tensorOffset, bytes);
            tensorOffset += span.size;
          }

          const numBlocks = Math.ceil(location.size / 144);
          const caps = this.gpuCapabilities || getKernelCapabilities();
          const outputDtype =
            caps?.hasF16 && this._shouldDequantizeToF16(name) ? 'f16' : 'f32';
          const dequantized = await dequantize(quantBuffer, numBlocks, { outputDtype });

          releaseBuffer(quantBuffer);
          this.gpuBuffers.add(dequantized);
          return dequantized;
        }

        // BF16 tensors
        if (location.dtype === 'BF16') {
          const srcBuffer = acquireBuffer(location.size, undefined, `${name}_bf16`);
          let tensorOffset = 0;
          for (const span of location.spans) {
            const data = await this._loadShard(span.shardIndex);
            if (span.offset + span.size > data.byteLength) {
              throw new Error(
                `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span.`
              );
            }
            const bytes = new Uint8Array(data, span.offset, span.size);
            device.queue.writeBuffer(srcBuffer, tensorOffset, bytes);
            tensorOffset += span.size;
          }

          const numElements = location.size / 2;
          const dstBuffer = await this._convertBF16ToF32GPU(srcBuffer, numElements, name);
          releaseBuffer(srcBuffer);
          if (dstBuffer instanceof GPUBuffer) {
            this.gpuBuffers.add(dstBuffer);
          }
          return dstBuffer;
        }

        // Other dtypes
        const buffer = acquireBuffer(location.size, undefined, name);
        let tensorOffset = 0;
        for (const span of location.spans) {
          const data = await this._loadShard(span.shardIndex);
          if (span.offset + span.size > data.byteLength) {
            throw new Error(
              `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span.`
            );
          }
          const bytes = new Uint8Array(data, span.offset, span.size);
          device.queue.writeBuffer(buffer, tensorOffset, bytes);
          tensorOffset += span.size;
        }
        this.gpuBuffers.add(buffer);
        return buffer;
      }
    }

    // Load shard data into CPU memory (single-shard or CPU path)
    let shardData: ArrayBuffer;
    if (location.spans) {
      const chunks: Uint8Array[] = [];
      for (const span of location.spans) {
        const data = await this._loadShard(span.shardIndex);
        if (span.offset + span.size > data.byteLength) {
          throw new Error(
            `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span.`
          );
        }
        chunks.push(new Uint8Array(data, span.offset, span.size));
      }
      const totalSize = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      shardData = combined.buffer;
    } else {
      const fullShard = await this._loadShard(location.shardIndex);
      shardData = fullShard.slice(location.offset, location.offset + location.size);
    }

    // Handle quantized data
    if (location.dtype === 'Q4_K_M' || location.dtype === 'Q4_K') {
      if (toGPU) {
        const device = getDevice();
        const quantBuffer = acquireBuffer(location.size, undefined, `quant_${name}`);
        device!.queue.writeBuffer(quantBuffer, 0, new Uint8Array(shardData));

        const numBlocks = Math.ceil(location.size / 144);
        const caps = this.gpuCapabilities || getKernelCapabilities();
        const outputDtype =
          caps?.hasF16 && this._shouldDequantizeToF16(name) ? 'f16' : 'f32';
        const dequantized = await dequantize(quantBuffer, numBlocks, { outputDtype });

        releaseBuffer(quantBuffer);
        this.gpuBuffers.add(dequantized);
        return dequantized;
      }
      return new Uint8Array(shardData);
    }

    // Handle BF16 data
    if (location.dtype === 'BF16') {
      if (toGPU) {
        const device = getDevice();
        const bf16Bytes = new Uint8Array(shardData);
        const srcBuffer = acquireBuffer(bf16Bytes.byteLength, undefined, `${name}_bf16`);
        device!.queue.writeBuffer(srcBuffer, 0, bf16Bytes);

        const numElements = bf16Bytes.byteLength / 2;
        const dstBuffer = await this._convertBF16ToF32GPU(srcBuffer, numElements, name);
        releaseBuffer(srcBuffer);
        if (dstBuffer instanceof GPUBuffer) {
          this.gpuBuffers.add(dstBuffer);
        }
        return dstBuffer;
      }

      // CPU path
      const bf16 = new Uint16Array(shardData);
      const f32 = new Float32Array(bf16.length);
      const tmp = new ArrayBuffer(4);
      const u32View = new Uint32Array(tmp);
      const f32View = new Float32Array(tmp);
      for (let i = 0; i < bf16.length; i++) {
        u32View[0] = bf16[i] << 16;
        f32[i] = f32View[0];
      }
      return f32;
    }

    // Handle F32/F16 data
    if (toGPU) {
      const device = getDevice();
      const buffer = acquireBuffer(location.size, undefined, name);
      device!.queue.writeBuffer(buffer, 0, new Uint8Array(shardData));
      this.gpuBuffers.add(buffer);
      return buffer;
    } else {
      if (location.dtype === 'F16') {
        const f16 = new Uint16Array(shardData);
        const f32 = new Float32Array(f16.length);
        for (let i = 0; i < f16.length; i++) {
          f32[i] = this._f16ToF32(f16[i]);
        }
        return f32;
      }
      return new Float32Array(shardData);
    }
  }

  /**
   * Find alternative tensor name (handles different naming conventions)
   */
  private _findAlternativeTensorName(name: string): string | null {
    const prefixes = [
      'language_model.model.',
      'language_model.',
      'model.',
      '',
    ];

    for (const prefix of prefixes) {
      const prefixedName = prefix + name;
      if (prefixedName !== name && this.tensorLocations.has(prefixedName)) {
        return prefixedName;
      }
    }

    const patterns: [RegExp, string][] = [
      [/^layers\.(\d+)\./, 'model.layers.$1.'],
      [/^model\.layers\.(\d+)\./, 'layers.$1.'],
      [/\.weight$/, ''],
      [/$/, '.weight'],
      [/attention/, 'self_attn'],
      [/self_attn/, 'attention'],
      [/ffn/, 'mlp'],
      [/mlp/, 'ffn'],
    ];

    for (const [pattern, replacement] of patterns) {
      const altName = name.replace(pattern, replacement);
      if (altName !== name && this.tensorLocations.has(altName)) {
        return altName;
      }
      for (const prefix of prefixes) {
        const prefixedAlt = prefix + altName;
        if (this.tensorLocations.has(prefixedAlt)) {
          return prefixedAlt;
        }
      }
    }
    return null;
  }

  /**
   * Check if model requires (1 + weight) offset for RMSNorm weights
   */
  private _needsNormWeightOffset(): boolean {
    if (!this.manifest) return false;

    const sourceFormat = (this.manifest as { sourceFormat?: string }).sourceFormat;
    if (sourceFormat === 'gguf') {
      if (!this._normOffsetLogged) {
        this._normOffsetLogged = true;
        console.log('[DopplerLoader] GGUF source: +1 offset already baked in, skipping');
      }
      return false;
    }

    const config = (this.manifest.config || {}) as ModelConfig;
    const arch = config.architectures?.[0] || (this.manifest.architecture as string) || '';
    const isGemma3 = arch.includes('Gemma3') || config.model_type?.includes('gemma3');

    if (isGemma3) {
      if (!this._normOffsetLogged) {
        this._normOffsetLogged = true;
        console.log('[DopplerLoader] Gemma 3 from safetensors: applying +1 norm weight offset');
      }
      return true;
    }

    return false;
  }

  /**
   * Apply +1 offset to norm weights for Gemma 3+ models
   */
  private async _applyNormWeightOffset(
    tensor: GPUBuffer | Float32Array
  ): Promise<GPUBuffer | Float32Array> {
    const device = getDevice();
    if (!device) {
      console.warn('[DopplerLoader] No GPU device for norm offset');
      return tensor;
    }

    if (tensor instanceof GPUBuffer) {
      const size = tensor.size;
      const stagingBuffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(tensor, 0, stagingBuffer, 0, size);
      device.queue.submit([encoder.finish()]);

      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
      stagingBuffer.unmap();
      stagingBuffer.destroy();

      const offsetData = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        offsetData[i] = 1.0 + data[i];
      }

      releaseBuffer(tensor);
      const newBuffer = acquireBuffer(offsetData.byteLength, undefined, 'norm_offset');
      device.queue.writeBuffer(newBuffer, 0, offsetData);
      return newBuffer;
    }

    if (tensor instanceof Float32Array) {
      const offsetData = new Float32Array(tensor.length);
      for (let i = 0; i < tensor.length; i++) {
        offsetData[i] = 1.0 + tensor[i];
      }
      return offsetData;
    }

    console.warn('[DopplerLoader] Unknown tensor type for norm offset');
    return tensor;
  }

  /**
   * Convert F16 to F32
   */
  private _f16ToF32(h: number): number {
    const sign = (h >> 15) & 0x1;
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;

    if (exp === 0) {
      if (mant === 0) return sign ? -0 : 0;
      const f = mant / 1024 * Math.pow(2, -14);
      return sign ? -f : f;
    }
    if (exp === 31) {
      return mant ? NaN : (sign ? -Infinity : Infinity);
    }

    const f = (1 + mant / 1024) * Math.pow(2, exp - 15);
    return sign ? -f : f;
  }

  /**
   * Convert BF16 buffer to F32 on GPU
   */
  private async _convertBF16ToF32GPU(
    srcBuffer: GPUBuffer,
    numElements: number,
    name: string
  ): Promise<GPUBuffer> {
    const { runBF16ToF32 } = await import('../gpu/kernel-selector.js');
    return runBF16ToF32(srcBuffer, numElements, name);
  }

  /**
   * Decide whether a quantized tensor should be dequantized directly to f16
   */
  private _shouldDequantizeToF16(name: string): boolean {
    const lower = name.toLowerCase();
    const matmulSuffixes = [
      'q_proj.weight',
      'k_proj.weight',
      'v_proj.weight',
      'o_proj.weight',
      'attention.wq.weight',
      'attention.wk.weight',
      'attention.wv.weight',
      'attention.wo.weight',
      'gate_proj.weight',
      'up_proj.weight',
      'down_proj.weight',
      'w1.weight',
      'w2.weight',
      'w3.weight',
      'lm_head.weight',
      'output.weight',
    ];

    return matmulSuffixes.some(suffix => lower.endsWith(suffix));
  }

  /**
   * Load embedding weights
   */
  private async _loadEmbeddings(_onProgress: ((progress: LoadProgress) => void) | null): Promise<void> {
    const embeddingNames = [
      'language_model.model.embed_tokens.weight',
      'model.embed_tokens.weight',
      'embed_tokens.weight',
      'token_embd.weight',
      'wte.weight',
      'transformer.wte.weight',
    ];

    for (const name of embeddingNames) {
      const tensor = await this._loadTensor(name, true, true);
      if (tensor && (tensor instanceof GPUBuffer || tensor instanceof Float32Array)) {
        this.embeddings = tensor;
        break;
      }
    }

    if (!this.embeddings) {
      console.warn('[DopplerLoader] Embeddings not found');
    }
  }

  /**
   * Load a single layer's weights
   */
  private async _loadLayer(
    layerIdx: number,
    _onProgress: ((progress: LoadProgress) => void) | null
  ): Promise<void> {
    const prefixes = [
      `language_model.model.layers.${layerIdx}`,
      `model.layers.${layerIdx}`,
      `layers.${layerIdx}`,
      `blk.${layerIdx}`,
    ];

    const weights: LayerWeights = {
      inputNorm: null,
      qProj: null,
      kProj: null,
      vProj: null,
      oProj: null,
      qNorm: null,
      kNorm: null,
      postAttentionNorm: null,
      preFeedforwardNorm: null,
      postFeedforwardNorm: null,
      postNorm: null,
      postAttnNorm: null,
      ffnGate: null,
      ffnUp: null,
      ffnDown: null,
    };

    const tryLoad = async (suffixes: string[]): Promise<GPUBuffer | Float32Array | null> => {
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          const tensor = await this._loadTensor(`${prefix}.${suffix}`, true, true);
          if (tensor && (tensor instanceof GPUBuffer || tensor instanceof Float32Array)) {
            return tensor;
          }
        }
      }
      return null;
    };

    const tryLoadNorm = async (suffixes: string[]): Promise<GPUBuffer | Float32Array | null> => {
      const tensor = await tryLoad(suffixes);
      if (!tensor) return null;

      if (this._needsNormWeightOffset()) {
        return this._applyNormWeightOffset(tensor);
      }
      return tensor;
    };

    weights.inputNorm = await tryLoadNorm(['input_layernorm.weight', 'attn_norm.weight']);
    weights.qProj = await tryLoad(['self_attn.q_proj.weight', 'attention.wq.weight', 'attn_q.weight']);
    weights.kProj = await tryLoad(['self_attn.k_proj.weight', 'attention.wk.weight', 'attn_k.weight']);
    weights.vProj = await tryLoad(['self_attn.v_proj.weight', 'attention.wv.weight', 'attn_v.weight']);
    weights.oProj = await tryLoad(['self_attn.o_proj.weight', 'attention.wo.weight', 'attn_output.weight']);
    weights.qNorm = await tryLoadNorm(['self_attn.q_norm.weight', 'attn_q_norm.weight']);
    weights.kNorm = await tryLoadNorm(['self_attn.k_norm.weight', 'attn_k_norm.weight']);
    weights.postAttentionNorm = await tryLoadNorm(['post_attention_layernorm.weight', 'post_attention_norm.weight']);
    weights.preFeedforwardNorm = await tryLoadNorm(['pre_feedforward_layernorm.weight', 'ffn_norm.weight']);
    weights.postFeedforwardNorm = await tryLoadNorm(['post_feedforward_layernorm.weight', 'post_ffw_norm.weight']);
    weights.postNorm = weights.postAttentionNorm || weights.preFeedforwardNorm;
    weights.postAttnNorm = weights.postNorm;

    if (!this.isMoE || !this._isExpertLayer(layerIdx)) {
      weights.ffnGate = await tryLoad(['mlp.gate_proj.weight', 'feed_forward.w1.weight', 'ffn_gate.weight']);
      weights.ffnUp = await tryLoad(['mlp.up_proj.weight', 'feed_forward.w3.weight', 'ffn_up.weight']);
      weights.ffnDown = await tryLoad(['mlp.down_proj.weight', 'feed_forward.w2.weight', 'ffn_down.weight']);
    }

    if (this.isMoE && this._isExpertLayer(layerIdx)) {
      weights.routerWeight = await tryLoad(['mlp.router.weight', 'block_sparse_moe.gate.weight']);
      weights.routerBias = await tryLoad(['mlp.router.bias']);
    }

    weights.attentionSinks = await tryLoad(['self_attn.sinks']);

    this.layers.set(layerIdx, weights);

    // Downcast matmul weights to f16 when supported
    const caps = getKernelCapabilities();
    if (caps.hasF16) {
      const matmulKeys: (keyof LayerWeights)[] = ['qProj', 'kProj', 'vProj', 'oProj', 'ffnGate', 'ffnUp', 'ffnDown'];
      for (const key of matmulKeys) {
        const buf = weights[key];
        if (buf instanceof GPUBuffer) {
          const dtype = getBufferDtype(buf) || 'f32';
          if (dtype === 'f32') {
            const elems = buf.size / 4;
            try {
              const f16buf = await castF32ToF16(buf, elems);
              releaseBuffer(buf);
              (weights as unknown as Record<string, GPUBuffer | Float32Array | null>)[key] = f16buf;
              this.gpuBuffers.add(f16buf);
            } catch (e) {
              console.warn(`[DopplerLoader] Failed to downcast ${key} to f16:`, (e as Error).message);
            }
          }
        }
      }
    }
  }

  /**
   * Check if layer uses MoE
   */
  private _isExpertLayer(_layerIdx: number): boolean {
    return this.isMoE;
  }

  /**
   * Load expert weights on demand
   */
  async loadExpert(layerIdx: number, expertIdx: number): Promise<ExpertWeights> {
    const key = `layer_${layerIdx}_expert_${expertIdx}`;
    if (this.experts.has(key)) {
      return this.experts.get(key)!;
    }

    console.log(`[DopplerLoader] Loading expert ${expertIdx} for layer ${layerIdx}`);

    const prefix = `layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;
    const altPrefix = `model.layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;

    let weights: ExpertWeights = {
      gate: (await this._loadTensor(`${prefix}.w1.weight`) ||
            await this._loadTensor(`${altPrefix}.w1.weight`)) as GPUBuffer | Float32Array | null,
      up: (await this._loadTensor(`${prefix}.w3.weight`) ||
          await this._loadTensor(`${altPrefix}.w3.weight`)) as GPUBuffer | Float32Array | null,
      down: (await this._loadTensor(`${prefix}.w2.weight`) ||
            await this._loadTensor(`${altPrefix}.w2.weight`)) as GPUBuffer | Float32Array | null,
    };

    // Try GPT-OSS naming if Mixtral naming not found
    if (!weights.gate && !weights.up && !weights.down) {
      const gptOssPrefix = `model.layers.${layerIdx}.mlp.experts`;
      const packedKey = `layer_${layerIdx}_gptoss_packed`;
      let packed = this.experts.get(packedKey);

      if (!packed) {
        const config = this.manifest?.config as ModelConfig | undefined;
        const numExpertsFromConfig = config?.num_local_experts || config?.num_experts || 32;

        packed = {
          isGptOss: true,
          numExperts: numExpertsFromConfig,
          gateUpBlocks: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_blocks`) as GPUBuffer | null,
          gateUpScales: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_scales`) as GPUBuffer | null,
          gateUpBias: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_bias`) as GPUBuffer | null,
          downBlocks: await this._loadTensor(`${gptOssPrefix}.down_proj_blocks`) as GPUBuffer | null,
          downScales: await this._loadTensor(`${gptOssPrefix}.down_proj_scales`) as GPUBuffer | null,
          downBias: await this._loadTensor(`${gptOssPrefix}.down_proj_bias`) as GPUBuffer | null,
        };

        this.experts.set(packedKey, packed);
      }

      weights = {
        isGptOss: true,
        expertIdx,
        numExperts: packed.numExperts,
        gateUpBlocks: packed.gateUpBlocks,
        gateUpScales: packed.gateUpScales,
        gateUpBias: packed.gateUpBias,
        downBlocks: packed.downBlocks,
        downScales: packed.downScales,
        downBias: packed.downBias,
      };
    }

    // Downcast Mixtral-style F32 weights to F16
    if (!weights.isGptOss) {
      const caps = getKernelCapabilities();
      if (caps.hasF16) {
        for (const k of ['gate', 'up', 'down'] as const) {
          const buf = weights[k];
          if (buf instanceof GPUBuffer) {
            const dtype = getBufferDtype(buf) || 'f32';
            if (dtype === 'f32') {
              const elems = buf.size / 4;
              try {
                const f16buf = await castF32ToF16(buf, elems);
                releaseBuffer(buf);
                weights[k] = f16buf;
                this.gpuBuffers.add(f16buf);
              } catch (e) {
                console.warn(`[DopplerLoader] Failed to downcast expert ${k} to f16:`, (e as Error).message);
              }
            }
          }
        }
      }
    }

    this.experts.set(key, weights);
    return weights;
  }

  /**
   * Load final layer norm and LM head
   */
  private async _loadFinalWeights(_onProgress: ((progress: LoadProgress) => void) | null): Promise<void> {
    this.finalNorm = (await this._loadTensor('language_model.model.norm.weight', true, true) ||
                     await this._loadTensor('model.norm.weight', true, true) ||
                     await this._loadTensor('norm.weight', true, true) ||
                     await this._loadTensor('output_norm.weight', true, true) ||
                     await this._loadTensor('transformer.ln_f.weight', true, true)) as GPUBuffer | Float32Array | null;

    if (this.finalNorm && this._needsNormWeightOffset()) {
      this.finalNorm = await this._applyNormWeightOffset(this.finalNorm);
    }

    if (!this.finalNorm) {
      console.warn('[DopplerLoader] Final norm not found');
    }

    this.lmHead = (await this._loadTensor('language_model.lm_head.weight', true, true) ||
                  await this._loadTensor('lm_head.weight', true, true) ||
                  await this._loadTensor('output.weight', true, true)) as GPUBuffer | Float32Array | null;

    if (!this.lmHead && this.embeddings) {
      console.log('[DopplerLoader] Using tied embeddings as LM head');
      this.lmHead = this.embeddings;
    } else if (!this.lmHead) {
      console.warn('[DopplerLoader] LM head not found');
    }

    // Downcast LM head to f16
    const caps = getKernelCapabilities();
    if (caps.hasF16 && this.lmHead instanceof GPUBuffer && this.lmHead !== this.embeddings) {
      const dtype = getBufferDtype(this.lmHead) || 'f32';
      if (dtype === 'f32') {
        try {
          const elems = this.lmHead.size / 4;
          const f16buf = await castF32ToF16(this.lmHead, elems);
          releaseBuffer(this.lmHead);
          this.lmHead = f16buf;
          this.gpuBuffers.add(f16buf);
        } catch (e) {
          console.warn('[DopplerLoader] Failed to downcast lmHead to f16:', (e as Error).message);
        }
      }
    }
  }

  /**
   * Get layer weights
   */
  getLayerWeights(layerIdx: number): LayerWeights | null {
    return this.layers.get(layerIdx) || null;
  }

  /**
   * Get model configuration
   */
  getConfig(): ModelConfig {
    return (this.manifest?.config as ModelConfig) || {};
  }

  /**
   * Check if using unified memory (can run dense models efficiently)
   */
  canRunDense(): boolean {
    return this.isUnifiedMemory;
  }

  /**
   * Get loading statistics
   */
  getStats(): LoaderStats {
    return {
      modelId: this.modelId,
      isLoaded: this.isLoaded,
      isMoE: this.isMoE,
      isUnifiedMemory: this.isUnifiedMemory,
      layersLoaded: this.layers.size,
      expertsLoaded: this.experts.size,
      gpuBuffers: this.gpuBuffers.size,
    };
  }

  /**
   * Unload model and free resources
   */
  async unload(): Promise<void> {
    console.log('[DopplerLoader] Unloading model...');

    for (const buffer of this.gpuBuffers) {
      releaseBuffer(buffer);
    }
    this.gpuBuffers.clear();

    this.embeddings = null;
    this.layers.clear();
    this.experts.clear();
    this.lmHead = null;
    this.finalNorm = null;
    this.manifest = null;
    this.modelId = null;
    this.loadedShards.clear();
    this.isLoaded = false;
    this.tensorLocations.clear();
    this.shardCache.clear();
    this._normOffsetLogged = false;

    console.log('[DopplerLoader] Model unloaded');
  }
}

// Global loader instance
let globalLoader: DopplerLoader | null = null;

/**
 * Get global DopplerLoader instance
 */
export function getDopplerLoader(): DopplerLoader {
  if (!globalLoader) {
    globalLoader = new DopplerLoader();
  }
  return globalLoader;
}

/**
 * Create new DopplerLoader instance
 */
export function createDopplerLoader(): DopplerLoader {
  return new DopplerLoader();
}

export default DopplerLoader;

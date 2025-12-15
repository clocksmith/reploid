/**
 * .rdrr Model Format Writer
 * Writes models with manifest.json + 64MB shards with hash verification.
 */

import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import type { HashAlgorithm, MoEConfig } from '../storage/rdrr-format.js';

const DEFAULT_SHARD_SIZE = 64 * 1024 * 1024;
const ALIGNMENT = 4096;

export interface WriterOptions {
  shardSize?: number;
  hashAlgorithm?: HashAlgorithm;
  modelId?: string;
  modelType?: string;
  architecture?: string;
  quantization?: string;
}

export interface TensorMetadata {
  shape: number[];
  dtype: string;
}

export interface TensorLocation extends TensorMetadata {
  shardIndex: number;
  offset: number;
  size: number;
  spans?: Array<{ shardIndex: number; offset: number; size: number }>;
}

export interface ShardData {
  index: number;
  data: Uint8Array[];
  size: number;
}

export interface ShardRecord {
  index: number;
  fileName: string;
  size: number;
  hash: string;
  hashAlgorithm: HashAlgorithm;
}

export interface WriteResult {
  manifestPath: string;
  shardCount: number;
  totalSize: number;
  tensorCount: number;
}

export interface TokenizerConfig {
  model?: string;
  tokens?: string[];
  merges?: string[];
  scores?: number[];
  tokenTypes?: number[];
  bosTokenId?: number;
  eosTokenId?: number;
  padTokenId?: number;
  unkTokenId?: number;
  sepTokenId?: number;
  clsTokenId?: number;
  maskTokenId?: number;
  addBosToken?: boolean;
  addEosToken?: boolean;
  addSpacePrefix?: boolean;
}

export interface HuggingFaceTokenizer {
  model?: {
    type?: string;
    vocab?: Record<string, number> | Array<[string, number]>;
  };
}

export interface TensorInfo {
  name: string;
  shape: number[];
  dtype: string;
}

export interface ModelInfo {
  modelName?: string;
  architecture?: string;
  quantization?: string;
  config?: Record<string, unknown>;
  tokenizer?: TokenizerConfig;
  tokenizerConfig?: TokenizerConfig;
  tokenizerJson?: HuggingFaceTokenizer;
  tensors: TensorInfo[];
}

export interface ProgressEvent {
  stage: 'writing' | 'complete';
  current?: number;
  total?: number;
  tensorName?: string;
  manifestPath?: string;
  shardCount?: number;
  totalSize?: number;
  tensorCount?: number;
}

async function computeHash(data: Uint8Array): Promise<string> {
  try {
    // blake3 package may not have types, use dynamic import
    // @ts-expect-error - blake3 has no type declarations
    const blake3Module = await import('blake3');
    return blake3Module.blake3(data).toString('hex');
  } catch {
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }
}

function alignOffset(offset: number, alignment = ALIGNMENT): number {
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + (alignment - remainder);
}

function createPadding(size: number): Uint8Array {
  return new Uint8Array(size);
}

export class RDRRWriter {
  private outputDir: string;
  private shardSize: number;
  private hashAlgorithm: HashAlgorithm;
  private shards: ShardRecord[] = [];
  private currentShard: ShardData | null = null;
  private currentShardIndex = 0;
  private currentShardOffset = 0;
  private tensorLocations = new Map<string, TensorLocation>();

  private manifest = {
    version: '1.0' as const,
    modelId: 'unknown',
    modelType: 'transformer',
    architecture: 'llama',
    quantization: 'Q4_K_M',
    hashAlgorithm: 'sha256' as HashAlgorithm,
    config: {} as Record<string, unknown>,
    tokenizer: {} as Record<string, unknown>,
    shards: [] as ShardRecord[],
    tensors: {} as Record<string, TensorLocation>,
    moeConfig: null as MoEConfig | null,
    totalSize: 0,
    tensorCount: 0,
  };

  constructor(outputDir: string, options: WriterOptions = {}) {
    this.outputDir = outputDir;
    this.shardSize = options.shardSize ?? DEFAULT_SHARD_SIZE;
    this.hashAlgorithm = options.hashAlgorithm ?? 'sha256';

    this.manifest.modelId = options.modelId ?? 'unknown';
    this.manifest.modelType = options.modelType ?? 'transformer';
    this.manifest.architecture = options.architecture ?? 'llama';
    this.manifest.quantization = options.quantization ?? 'Q4_K_M';
    this.manifest.hashAlgorithm = this.hashAlgorithm;
  }

  async init(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });
    this.startNewShard();
  }

  private startNewShard(): void {
    if (this.currentShard && this.currentShardOffset > 0) {
      this.finalizeShard();
    }

    this.currentShard = {
      index: this.currentShardIndex,
      data: [],
      size: 0,
    };
  }

  private async finalizeShard(): Promise<void> {
    if (!this.currentShard || this.currentShard.size === 0) {
      return;
    }

    const totalSize = this.currentShard.data.reduce((sum, chunk) => sum + chunk.length, 0);
    const shardData = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of this.currentShard.data) {
      shardData.set(chunk, offset);
      offset += chunk.length;
    }

    const hash = await computeHash(shardData);
    const shardFileName = `shard_${String(this.currentShardIndex).padStart(5, '0')}.bin`;
    const shardPath = join(this.outputDir, shardFileName);
    await writeFile(shardPath, shardData);

    this.shards.push({
      index: this.currentShardIndex,
      fileName: shardFileName,
      size: totalSize,
      hash,
      hashAlgorithm: this.hashAlgorithm,
    });

    this.currentShardIndex++;
    this.currentShardOffset = 0;
    this.currentShard = null;
  }

  async writeTensor(name: string, data: Uint8Array, metadata: TensorMetadata): Promise<TensorLocation> {
    if (!this.currentShard) {
      this.startNewShard();
    }

    const alignedOffset = alignOffset(this.currentShardOffset);
    const spaceNeeded = (alignedOffset - this.currentShardOffset) + data.length;

    if (this.currentShardOffset > 0 && this.currentShardOffset + spaceNeeded > this.shardSize) {
      await this.finalizeShard();
      this.startNewShard();
    }

    const paddingNeeded = alignOffset(this.currentShardOffset) - this.currentShardOffset;
    if (paddingNeeded > 0) {
      this.currentShard!.data.push(createPadding(paddingNeeded));
      this.currentShard!.size += paddingNeeded;
      this.currentShardOffset += paddingNeeded;
    }

    const location: TensorLocation = {
      shardIndex: this.currentShardIndex,
      offset: this.currentShardOffset,
      size: data.length,
      ...metadata,
    };
    this.tensorLocations.set(name, location);

    let remaining = data;
    const tensorShards: Array<{ shardIndex: number; offset: number; size: number }> = [];

    while (remaining.length > 0) {
      const spaceInShard = this.shardSize - this.currentShardOffset;
      const writeSize = Math.min(remaining.length, spaceInShard);

      const chunk = remaining.slice(0, writeSize);
      this.currentShard!.data.push(chunk);
      this.currentShard!.size += writeSize;
      this.currentShardOffset += writeSize;

      tensorShards.push({
        shardIndex: this.currentShardIndex,
        offset: this.currentShardOffset - writeSize,
        size: writeSize,
      });

      remaining = remaining.slice(writeSize);

      if (remaining.length > 0) {
        await this.finalizeShard();
        this.startNewShard();
      }
    }

    if (tensorShards.length > 1) {
      location.spans = tensorShards;
    }

    return location;
  }

  setConfig(config: Record<string, unknown>): void {
    this.manifest.config = config;
  }

  setTokenizer(tokenizer: Record<string, unknown>): void {
    this.manifest.tokenizer = tokenizer;
  }

  setMoEConfig(moeConfig: MoEConfig): void {
    this.manifest.moeConfig = moeConfig;
  }

  setMetadata(meta: Record<string, unknown>): void {
    Object.assign(this.manifest, meta);
  }

  async writeTokenizer(tokenizer: TokenizerConfig): Promise<void> {
    if (!tokenizer.tokens || tokenizer.tokens.length === 0) {
      console.warn('[RDRRWriter] No vocab tokens found, skipping tokenizer bundling');
      this.manifest.tokenizer = {
        model: tokenizer.model,
        bosTokenId: tokenizer.bosTokenId,
        eosTokenId: tokenizer.eosTokenId,
        padTokenId: tokenizer.padTokenId,
        unkTokenId: tokenizer.unkTokenId,
        addBosToken: tokenizer.addBosToken,
        addEosToken: tokenizer.addEosToken,
      };
      return;
    }

    const vocab: Record<string, number> = {};
    for (let i = 0; i < tokenizer.tokens.length; i++) {
      vocab[tokenizer.tokens[i]] = i;
    }

    const hasMerges = tokenizer.merges && tokenizer.merges.length > 0;
    const hasScores = tokenizer.scores && tokenizer.scores.length > 0;
    const type = hasMerges ? 'bpe' : (hasScores ? 'unigram' : 'bpe');

    const tokenizerJson = {
      type,
      model: tokenizer.model,
      vocab,
      vocabSize: tokenizer.tokens.length,
      merges: hasMerges ? tokenizer.merges : null,
      scores: hasScores ? tokenizer.scores : null,
      tokenTypes: tokenizer.tokenTypes ?? null,
      specialTokens: {
        bos: tokenizer.bosTokenId,
        eos: tokenizer.eosTokenId,
        pad: tokenizer.padTokenId,
        unk: tokenizer.unkTokenId,
        sep: tokenizer.sepTokenId,
        cls: tokenizer.clsTokenId,
        mask: tokenizer.maskTokenId,
      },
      addBosToken: tokenizer.addBosToken ?? true,
      addEosToken: tokenizer.addEosToken ?? false,
      addSpacePrefix: tokenizer.addSpacePrefix ?? true,
    };

    const tokenizerPath = join(this.outputDir, 'tokenizer.json');
    await writeFile(tokenizerPath, JSON.stringify(tokenizerJson));

    console.log(`[RDRRWriter] Wrote tokenizer.json (${tokenizer.tokens.length} tokens, type: ${type})`);

    this.manifest.tokenizer = {
      type: 'bundled',
      file: 'tokenizer.json',
      vocabSize: tokenizer.tokens.length,
      tokenizerType: type,
    };
  }

  async writeHuggingFaceTokenizer(tokenizerJson: HuggingFaceTokenizer): Promise<void> {
    if (!tokenizerJson || !tokenizerJson.model) {
      console.warn('[RDRRWriter] Invalid HuggingFace tokenizer.json, skipping');
      return;
    }

    const tokenizerPath = join(this.outputDir, 'tokenizer.json');
    await writeFile(tokenizerPath, JSON.stringify(tokenizerJson));

    const model = tokenizerJson.model;
    let vocabSize: number;
    if (Array.isArray(model.vocab)) {
      vocabSize = model.vocab.length;
    } else {
      vocabSize = Object.keys(model.vocab || {}).length;
    }
    const type = model.type?.toLowerCase() || 'bpe';

    console.log(`[RDRRWriter] Wrote HuggingFace tokenizer.json (${vocabSize} tokens, type: ${type})`);

    this.manifest.tokenizer = {
      type: 'huggingface',
      file: 'tokenizer.json',
      vocabSize,
      tokenizerType: type,
    };
  }

  async finalize(): Promise<WriteResult> {
    await this.finalizeShard();

    const tensors: Record<string, TensorLocation> = {};

    for (const [name, location] of this.tensorLocations) {
      tensors[name] = {
        shardIndex: location.shardIndex,
        offset: location.offset,
        size: location.size,
        shape: location.shape,
        dtype: location.dtype,
      };
      if (location.spans) {
        tensors[name].spans = location.spans;
      }
    }

    this.manifest.shards = this.shards.map(s => ({
      index: s.index,
      fileName: s.fileName,
      size: s.size,
      hash: s.hash,
      hashAlgorithm: s.hashAlgorithm,
    }));
    this.manifest.tensors = tensors;
    this.manifest.totalSize = this.shards.reduce((sum, s) => sum + s.size, 0);
    this.manifest.tensorCount = this.tensorLocations.size;

    const manifestPath = join(this.outputDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));

    return {
      manifestPath,
      shardCount: this.shards.length,
      totalSize: this.manifest.totalSize,
      tensorCount: this.manifest.tensorCount,
    };
  }

  async cleanup(): Promise<void> {
    try {
      await rm(this.outputDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export interface WriteRDRROptions extends WriterOptions {
  onProgress?: (event: ProgressEvent) => void;
}

export async function writeRDRR(
  outputDir: string,
  modelInfo: ModelInfo,
  getTensorData: (tensor: TensorInfo) => Promise<ArrayBuffer>,
  options: WriteRDRROptions = {}
): Promise<WriteResult> {
  const config = modelInfo.config as Record<string, unknown> | undefined;
  const writer = new RDRRWriter(outputDir, {
    modelId: modelInfo.modelName || (config?.modelId as string) || 'model',
    architecture: modelInfo.architecture || (config?.architectures as string[])?.[0] || 'llama',
    quantization: modelInfo.quantization || options.quantization || 'Q4_K_M',
    ...options,
  });

  try {
    await writer.init();

    if (modelInfo.config) {
      writer.setConfig(modelInfo.config);
    }

    const tokenizer = modelInfo.tokenizer || modelInfo.tokenizerConfig;
    const hfTokenizer = modelInfo.tokenizerJson;

    if (hfTokenizer && hfTokenizer.model?.vocab) {
      await writer.writeHuggingFaceTokenizer(hfTokenizer);
    } else if (tokenizer?.tokens && tokenizer.tokens.length > 0) {
      await writer.writeTokenizer(tokenizer);
    } else if (tokenizer) {
      writer.setTokenizer(tokenizer as Record<string, unknown>);
    }

    if (config?.expertCount || config?.num_local_experts) {
      const numExperts = (config.expertCount || config.num_local_experts) as number;
      const numExpertsPerToken = (
        config.expertUsedCount ||
        config.num_experts_per_tok ||
        config.experts_per_token ||
        2
      ) as number;
      writer.setMoEConfig({ numExperts, numExpertsPerToken });
      console.log(`  MoE config: ${numExperts} experts, ${numExpertsPerToken} active per token`);
    }

    const progressCallback = options.onProgress || (() => {});
    const totalTensors = modelInfo.tensors.length;

    for (let i = 0; i < modelInfo.tensors.length; i++) {
      const tensor = modelInfo.tensors[i];
      const data = await getTensorData(tensor);

      await writer.writeTensor(tensor.name, new Uint8Array(data), {
        shape: tensor.shape,
        dtype: tensor.dtype,
      });

      progressCallback({
        stage: 'writing',
        current: i + 1,
        total: totalTensors,
        tensorName: tensor.name,
      });
    }

    const result = await writer.finalize();
    progressCallback({ stage: 'complete', ...result });

    return result;
  } catch (error) {
    await writer.cleanup();
    throw error;
  }
}

export async function createTestModel(outputDir: string): Promise<WriteResult> {
  const writer = new RDRRWriter(outputDir, {
    modelId: 'tiny-test',
    architecture: 'test',
    quantization: 'F32',
  });

  await writer.init();

  writer.setConfig({
    vocabSize: 1000,
    hiddenSize: 64,
    numLayers: 2,
    numHeads: 2,
    contextLength: 128,
  });

  writer.setTokenizer({
    model: 'bpe',
    vocabSize: 1000,
    bosTokenId: 1,
    eosTokenId: 2,
  });

  const hiddenSize = 64;
  const vocabSize = 1000;
  const intermediateSize = 256;

  const embedData = new Float32Array(vocabSize * hiddenSize);
  for (let i = 0; i < embedData.length; i++) {
    embedData[i] = (Math.random() - 0.5) * 0.02;
  }
  await writer.writeTensor('embed_tokens.weight', new Uint8Array(embedData.buffer), {
    shape: [vocabSize, hiddenSize],
    dtype: 'F32',
  });

  for (let layer = 0; layer < 2; layer++) {
    const qkvSize = hiddenSize * hiddenSize * 3;
    const qkvData = new Float32Array(qkvSize);
    for (let i = 0; i < qkvSize; i++) {
      qkvData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.attention.qkv.weight`, new Uint8Array(qkvData.buffer), {
      shape: [hiddenSize * 3, hiddenSize],
      dtype: 'F32',
    });

    const oData = new Float32Array(hiddenSize * hiddenSize);
    for (let i = 0; i < oData.length; i++) {
      oData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.attention.o.weight`, new Uint8Array(oData.buffer), {
      shape: [hiddenSize, hiddenSize],
      dtype: 'F32',
    });

    const upData = new Float32Array(intermediateSize * hiddenSize);
    for (let i = 0; i < upData.length; i++) {
      upData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.ffn.up.weight`, new Uint8Array(upData.buffer), {
      shape: [intermediateSize, hiddenSize],
      dtype: 'F32',
    });

    const downData = new Float32Array(hiddenSize * intermediateSize);
    for (let i = 0; i < downData.length; i++) {
      downData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.ffn.down.weight`, new Uint8Array(downData.buffer), {
      shape: [hiddenSize, intermediateSize],
      dtype: 'F32',
    });

    const normData = new Float32Array(hiddenSize).fill(1.0);
    await writer.writeTensor(`layers.${layer}.input_norm.weight`, new Uint8Array(normData.buffer), {
      shape: [hiddenSize],
      dtype: 'F32',
    });
    await writer.writeTensor(`layers.${layer}.post_norm.weight`, new Uint8Array(normData.buffer), {
      shape: [hiddenSize],
      dtype: 'F32',
    });
  }

  const lmHeadData = new Float32Array(vocabSize * hiddenSize);
  for (let i = 0; i < lmHeadData.length; i++) {
    lmHeadData[i] = (Math.random() - 0.5) * 0.02;
  }
  await writer.writeTensor('lm_head.weight', new Uint8Array(lmHeadData.buffer), {
    shape: [vocabSize, hiddenSize],
    dtype: 'F32',
  });

  const finalNormData = new Float32Array(hiddenSize).fill(1.0);
  await writer.writeTensor('final_norm.weight', new Uint8Array(finalNormData.buffer), {
    shape: [hiddenSize],
    dtype: 'F32',
  });

  return writer.finalize();
}

export { DEFAULT_SHARD_SIZE, ALIGNMENT, computeHash };

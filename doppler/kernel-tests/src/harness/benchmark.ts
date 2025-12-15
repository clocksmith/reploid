/**
 * GPU Benchmark Harness
 */

export interface BenchmarkOptions {
  warmupRuns?: number;
  timedRuns?: number;
  label?: string;
}

export interface BenchmarkStats {
  label: string;
  medianMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  p99Ms: number;
  stdDevMs: number;
  samples: number;
  rawTimes: number[];
}

export interface BenchmarkStatsWithMetrics extends BenchmarkStats {
  flops?: number;
  gflops?: number;
  bytesTransferred?: number;
  throughputGbps?: number;
}

/**
 * Kernel benchmark runner with proper GPU synchronization
 */
export class KernelBenchmark {
  device: GPUDevice;
  hasTimestamp: boolean;

  constructor(device: GPUDevice) {
    this.device = device;
    this.hasTimestamp = device.features?.has('timestamp-query') || false;
  }

  /**
   * Run benchmark with warmup and multiple iterations
   * @param kernelFn Async function that runs the kernel
   * @param options Benchmark options
   * @returns Promise resolving to benchmark statistics
   */
  async runBenchmark(kernelFn: () => Promise<void>, options: BenchmarkOptions = {}): Promise<BenchmarkStats> {
    const { warmupRuns = 5, timedRuns = 20, label = 'kernel' } = options;

    // Warmup (compile shaders, warm caches)
    for (let i = 0; i < warmupRuns; i++) {
      await kernelFn();
      await this.device.queue.onSubmittedWorkDone();
    }

    // Timed runs
    const times: number[] = [];
    for (let i = 0; i < timedRuns; i++) {
      const start = performance.now();
      await kernelFn();
      await this.device.queue.onSubmittedWorkDone();
      const end = performance.now();
      times.push(end - start);
    }

    return this.computeStats(times, label);
  }

  /**
   * Compute statistics from timing samples
   * @param times Array of timing samples in ms
   * @param label Benchmark label
   * @returns Benchmark statistics
   */
  computeStats(times: number[], label: string): BenchmarkStats {
    const sorted = [...times].sort((a, b) => a - b);
    const n = sorted.length;

    const median = sorted[Math.floor(n / 2)];
    const mean = times.reduce((a, b) => a + b, 0) / n;
    const min = sorted[0];
    const max = sorted[n - 1];
    const p95 = sorted[Math.floor(n * 0.95)];
    const p99 = sorted[Math.floor(n * 0.99)];

    // Standard deviation
    const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    return {
      label,
      medianMs: median,
      meanMs: mean,
      minMs: min,
      maxMs: max,
      p95Ms: p95,
      p99Ms: p99,
      stdDevMs: stdDev,
      samples: n,
      rawTimes: times,
    };
  }
}

export type OperationType = 'matmul' | 'attention' | 'softmax' | string;

export interface MatmulWorkload {
  M: number;
  N: number;
  K: number;
  elementSize?: number;
  operation: 'matmul';
}

export interface AttentionWorkload {
  seqLen: number;
  numHeads: number;
  headDim: number;
  kvLen?: number;
  elementSize?: number;
  operation: 'attention';
}

export interface SoftmaxWorkload {
  innerSize: number;
  outerSize: number;
  elementSize?: number;
  operation: 'softmax';
}

export interface GenericWorkload {
  M: number;
  N: number;
  elementSize?: number;
  operation?: string;
}

export type Workload = MatmulWorkload | AttentionWorkload | SoftmaxWorkload | GenericWorkload;

/**
 * Compute theoretical performance metrics
 * @param stats Benchmark statistics
 * @param workload Workload parameters
 * @returns Stats with added metrics
 */
export function computeMetrics(stats: BenchmarkStats, workload: Workload): BenchmarkStatsWithMetrics {
  const { elementSize = 4, operation = 'matmul' } = workload;

  let flops = 0;
  let bytesTransferred = 0;

  switch (operation) {
    case 'matmul': {
      const { M, N, K } = workload as MatmulWorkload;
      // FLOPs for matmul: 2*M*N*K (multiply-add for each output element)
      flops = 2 * M * N * K;
      // Memory: read A + B, write C
      bytesTransferred = (M * K + K * N + M * N) * elementSize;
      break;
    }

    case 'attention': {
      const { seqLen, numHeads, headDim, kvLen = seqLen } = workload as AttentionWorkload;
      // Q @ K^T: 2*seqLen*kvLen*headDim per head
      // Softmax: ~5*seqLen*kvLen per head
      // Scores @ V: 2*seqLen*headDim*kvLen per head
      flops = numHeads * (2 * seqLen * kvLen * headDim + 5 * seqLen * kvLen + 2 * seqLen * headDim * kvLen);
      bytesTransferred = numHeads * (seqLen + kvLen * 2 + seqLen) * headDim * elementSize;
      break;
    }

    case 'softmax': {
      const { innerSize, outerSize } = workload as SoftmaxWorkload;
      // ~5 ops per element (exp, sum, div, max finding)
      flops = 5 * innerSize * outerSize;
      bytesTransferred = 2 * innerSize * outerSize * elementSize;
      break;
    }

    default: {
      const { M, N } = workload as GenericWorkload;
      // Generic: assume 1 flop per element
      flops = M * N;
      bytesTransferred = 2 * M * N * elementSize;
    }
  }

  const seconds = stats.medianMs / 1000;
  const gflops = (flops / 1e9) / seconds;
  const throughputGbps = (bytesTransferred / 1e9) / seconds;

  return {
    ...stats,
    flops,
    gflops,
    bytesTransferred,
    throughputGbps,
  };
}

/**
 * Format benchmark results for display
 * @param stats Benchmark statistics
 * @returns Formatted string
 */
export function formatBenchmarkResult(stats: BenchmarkStatsWithMetrics): string {
  const lines = [
    `${stats.label}:`,
    `  Median: ${stats.medianMs.toFixed(3)} ms`,
    `  Min/Max: ${stats.minMs.toFixed(3)} / ${stats.maxMs.toFixed(3)} ms`,
    `  P95: ${stats.p95Ms.toFixed(3)} ms`,
    `  StdDev: ${stats.stdDevMs.toFixed(3)} ms`,
  ];

  if (stats.gflops) {
    lines.push(`  GFLOPS: ${stats.gflops.toFixed(1)}`);
  }
  if (stats.throughputGbps) {
    lines.push(`  Throughput: ${stats.throughputGbps.toFixed(1)} GB/s`);
  }

  return lines.join('\n');
}

export interface MatmulConfig {
  M: number;
  N: number;
  K: number;
  label: string;
}

export interface AttentionConfig {
  seqLen: number;
  numHeads: number;
  headDim: number;
  kvLen?: number;
  label: string;
}

export interface MoeConfig {
  numTokens: number;
  hiddenSize: number;
  numExperts: number;
  topK: number;
  label: string;
}

export interface SoftmaxConfig {
  innerSize: number;
  outerSize: number;
  label: string;
}

/**
 * Standard benchmark workload configurations
 */
export const BENCHMARK_CONFIGS = {
  matmul: [
    // Decode (single token)
    { M: 1, N: 4096, K: 4096, label: 'decode-qkv' },
    { M: 1, N: 14336, K: 4096, label: 'decode-ffn-up' },
    { M: 1, N: 4096, K: 14336, label: 'decode-ffn-down' },
    // Prefill
    { M: 128, N: 4096, K: 4096, label: 'prefill-128' },
    { M: 512, N: 4096, K: 4096, label: 'prefill-512' },
    { M: 2048, N: 4096, K: 4096, label: 'prefill-2k' },
  ] as MatmulConfig[],

  attention: [
    { seqLen: 128, numHeads: 32, headDim: 128, label: 'prefill-128' },
    { seqLen: 512, numHeads: 32, headDim: 128, label: 'prefill-512' },
    { seqLen: 1, kvLen: 2048, numHeads: 32, headDim: 128, label: 'decode-2k' },
  ] as AttentionConfig[],

  moe: [
    { numTokens: 1, hiddenSize: 4096, numExperts: 8, topK: 2, label: 'decode-8e' },
    { numTokens: 128, hiddenSize: 4096, numExperts: 8, topK: 2, label: 'prefill-128-8e' },
  ] as MoeConfig[],

  softmax: [
    { innerSize: 128, outerSize: 32, label: 'attention-scores' },
    { innerSize: 32000, outerSize: 1, label: 'lm-head-vocab' },
    { innerSize: 128000, outerSize: 1, label: 'lm-head-large' },
  ] as SoftmaxConfig[],
};

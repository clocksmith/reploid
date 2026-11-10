import type { ProviderHardware } from './provider-hardware.js';
export interface GpuSignature {
  schema: 'reploid.gpu-order-signature/v1'; profile: 'atomic-finish-order-v1'; status: 'measured';
  source: 'local-webgpu'; hardware: ProviderHardware | null;
  workgroups: number; trials: number; collectedAt: string; elapsedMs: number; allocationBytes: number;
  samples: { workload: number; seed: number; orders: number[][]; checksums: number[][] }[];
  statistics: { means: number[]; deviations: number[] };
}
export type GpuSignatureResult = GpuSignature | { status: 'unavailable'; reason: string };
export interface GpuSignatureThresholds { calibrationId: string; consistentMax: number; changedMin: number }
// WebGPU types come from @webgpu/types when a consumer installs them; without them
// the core entry still compiles and accepts any device or GPU object.
type WebGpuGlobal<Name extends string, Fallback> = typeof globalThis extends Record<Name, { prototype: infer T }> ? T : Fallback;
export type GpuSignatureDevice = WebGpuGlobal<'GPUDevice', object>;
export type GpuSignatureGpu = WebGpuGlobal<'GPU', { requestAdapter(options?: unknown): Promise<unknown> }>;
export function captureGpuSignature(device?: GpuSignatureDevice | null, options?: {
  consent?: boolean; signal?: AbortSignal; gpu?: GpuSignatureGpu;
}): Promise<GpuSignatureResult>;
export function compareGpuSignatures(baseline: GpuSignatureResult | null, candidate: GpuSignatureResult | null,
  thresholds?: GpuSignatureThresholds | null): {
    status: 'unmeasured' | 'uncertain' | 'consistent' | 'changed'; distance: number | null;
    variability?: number; reason: string; calibrationId?: string; consistentMax?: number; changedMin?: number;
  };

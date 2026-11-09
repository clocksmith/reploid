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
export function captureGpuSignature(device?: GPUDevice | null, options?: {
  consent?: boolean; signal?: AbortSignal; gpu?: GPU;
}): Promise<GpuSignatureResult>;
export function compareGpuSignatures(baseline: GpuSignatureResult | null, candidate: GpuSignatureResult | null,
  thresholds?: GpuSignatureThresholds | null): {
    status: 'unmeasured' | 'uncertain' | 'consistent' | 'changed'; distance: number | null;
    variability?: number; reason: string; calibrationId?: string; consistentMax?: number; changedMin?: number;
  };

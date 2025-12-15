/**
 * Unified Memory Detection
 * Agent-A | Domain: memory/
 *
 * Detects if system has unified memory (CPU/GPU share RAM):
 * - Apple Silicon (M1/M2/M3/M4/M5)
 * - AMD Strix Halo (Ryzen AI Max)
 * - Other APUs with large shared memory
 *
 * @module memory/unified-detect
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Apple Silicon detection result
 */
export interface AppleSiliconInfo {
  isApple: boolean;
  mSeriesGen?: number | null;
  vendor?: string;
  device?: string;
  description?: string;
}

/**
 * AMD unified memory detection result
 */
export interface AMDUnifiedInfo {
  isAMDUnified: boolean;
  isStrix?: boolean;
  vendor?: string;
  device?: string;
  description?: string;
}

/**
 * WebGPU buffer limit indicators
 */
export interface LimitIndicators {
  largeBuffers: boolean;
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}

/**
 * Unified memory detection result
 */
export interface UnifiedMemoryInfo {
  isUnified: boolean;
  apple?: AppleSiliconInfo;
  amd?: AMDUnifiedInfo;
  limits?: LimitIndicators;
  estimatedMemoryGB?: number | null;
  reason: string;
}

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect Apple Silicon via WebGPU adapter info
 */
async function detectAppleSilicon(adapter: GPUAdapter | null): Promise<AppleSiliconInfo> {
  if (!adapter) return { isApple: false };

  const info = await (adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }).requestAdapterInfo?.() || {} as Partial<GPUAdapterInfo>;
  const vendor = (info.vendor || '').toLowerCase();
  const device = (info.device || '').toLowerCase();
  const description = (info.description || '').toLowerCase();

  const isApple =
    vendor.includes('apple') ||
    device.includes('apple') ||
    description.includes('apple');

  // Check for M-series chip names
  const mSeriesMatch = description.match(/m(\d+)/i) || device.match(/m(\d+)/i);
  const mSeriesGen = mSeriesMatch ? parseInt(mSeriesMatch[1], 10) : null;

  return {
    isApple,
    mSeriesGen,
    vendor: info.vendor,
    device: info.device,
    description: info.description,
  };
}

/**
 * Detect AMD APU with unified memory (Strix Halo, etc.)
 */
async function detectAMDUnified(adapter: GPUAdapter | null): Promise<AMDUnifiedInfo> {
  if (!adapter) return { isAMDUnified: false };

  const info = await (adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }).requestAdapterInfo?.() || {} as Partial<GPUAdapterInfo>;
  const vendor = (info.vendor || '').toLowerCase();
  const device = (info.device || '').toLowerCase();
  const description = (info.description || '').toLowerCase();

  const isAMD = vendor.includes('amd') || vendor.includes('advanced micro');

  if (!isAMD) return { isAMDUnified: false };

  // Strix Halo identifiers (may need updates as hardware releases)
  const strixPatterns = [
    'strix',
    'ryzen ai max',
    'radeon 8060',
    'radeon 890m',
    'gfx1151', // RDNA 3.5 GFX ID
  ];

  const isStrix = strixPatterns.some(
    (p) => device.includes(p) || description.includes(p)
  );

  // Check device limits for large shared memory indicators
  // Strix Halo has 128GB max shared memory
  return {
    isAMDUnified: isStrix,
    isStrix,
    vendor: info.vendor,
    device: info.device,
    description: info.description,
  };
}

/**
 * Check WebGPU device limits for unified memory indicators
 */
function checkUnifiedIndicators(
  _adapter: GPUAdapter | null,
  device: GPUDevice | null
): LimitIndicators {
  if (!device) return { largeBuffers: false };

  const limits = device.limits;

  // Unified memory systems typically have very large buffer limits
  // because VRAM = System RAM
  const maxBuffer = limits.maxBufferSize || 0;
  const maxStorage = limits.maxStorageBufferBindingSize || 0;

  // 4GB+ buffer limits suggest unified memory
  const GB = 1024 * 1024 * 1024;
  const largeBuffers = maxBuffer >= 4 * GB || maxStorage >= 2 * GB;

  return {
    largeBuffers,
    maxBufferSize: maxBuffer,
    maxStorageBufferBindingSize: maxStorage,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Main unified memory detection
 */
export async function detectUnifiedMemory(): Promise<UnifiedMemoryInfo> {
  // Need WebGPU for detection
  if (!navigator.gpu) {
    return {
      isUnified: false,
      reason: 'WebGPU not available',
    };
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });

    if (!adapter) {
      return {
        isUnified: false,
        reason: 'No WebGPU adapter',
      };
    }

    const device = await adapter.requestDevice();

    const apple = await detectAppleSilicon(adapter);
    const amd = await detectAMDUnified(adapter);
    const limits = checkUnifiedIndicators(adapter, device);

    // Determine if unified
    const isUnified = apple.isApple || amd.isAMDUnified;

    // Estimate available unified memory
    let estimatedMemoryGB: number | null = null;
    if (apple.isApple) {
      // Apple M-series: estimate based on generation
      // M1: 8-16GB, M1 Pro/Max: 16-64GB, M2/M3/M4 Max: up to 128GB
      estimatedMemoryGB = (apple.mSeriesGen ?? 0) >= 4 ? 128 : 64;
    } else if (amd.isStrix) {
      // Strix Halo: up to 128GB
      estimatedMemoryGB = 128;
    }

    device.destroy();

    return {
      isUnified,
      apple,
      amd,
      limits,
      estimatedMemoryGB,
      reason: isUnified ? 'Unified memory detected' : 'Discrete GPU or unknown',
    };
  } catch (err) {
    return {
      isUnified: false,
      reason: `Detection failed: ${(err as Error).message}`,
    };
  }
}

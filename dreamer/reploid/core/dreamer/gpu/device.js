/**
 * WebGPU Device Initialization and Feature Probing
 * AGENT-C: gpu/device.js
 *
 * Handles WebGPU adapter/device setup with comprehensive feature detection
 * for optimal kernel selection.
 */

// Cached device and capabilities
let gpuDevice = null;
let kernelCapabilities = null;

/**
 * Feature flags detected during initialization
 */
const FEATURES = {
  SHADER_F16: 'shader-f16',
  SUBGROUPS: 'subgroups',
  SUBGROUPS_F16: 'subgroups-f16',
  TIMESTAMP_QUERY: 'timestamp-query',
};

/**
 * Probe for WebGPU availability
 * @returns {boolean}
 */
export function isWebGPUAvailable() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Request WebGPU adapter with fallback options
 * @param {object} options - Adapter request options
 * @returns {Promise<GPUAdapter|null>}
 */
async function requestAdapter(options = {}) {
  if (!isWebGPUAvailable()) {
    return null;
  }

  // Try high-performance first, then fallback
  const adapterOptions = [
    { powerPreference: 'high-performance', ...options },
    { powerPreference: 'low-power', ...options },
    { ...options }, // Default
  ];

  for (const opts of adapterOptions) {
    try {
      const adapter = await navigator.gpu.requestAdapter(opts);
      if (adapter) {
        return adapter;
      }
    } catch (e) {
      // Continue to next option
    }
  }

  return null;
}

/**
 * Detect available features from adapter
 * @param {GPUAdapter} adapter
 * @returns {Set<string>}
 */
function detectFeatures(adapter) {
  const available = new Set();

  for (const feature of adapter.features) {
    available.add(feature);
  }

  return available;
}

/**
 * Build list of features to request based on availability
 * @param {Set<string>} available - Available features
 * @returns {string[]}
 */
function buildFeatureRequests(available) {
  const requested = [];

  // Request shader-f16 for FP16 matmul kernels
  if (available.has(FEATURES.SHADER_F16)) {
    requested.push(FEATURES.SHADER_F16);
  }

  // Request subgroups for efficient dequantization
  if (available.has(FEATURES.SUBGROUPS)) {
    requested.push(FEATURES.SUBGROUPS);
  }

  // Request subgroups-f16 if available (for combined f16 + subgroup ops)
  if (available.has(FEATURES.SUBGROUPS_F16)) {
    requested.push(FEATURES.SUBGROUPS_F16);
  }

  // Request timestamp query for profiling (optional)
  if (available.has(FEATURES.TIMESTAMP_QUERY)) {
    requested.push(FEATURES.TIMESTAMP_QUERY);
  }

  return requested;
}

/**
 * Build device limits based on adapter capabilities
 * @param {GPUAdapter} adapter
 * @returns {object}
 */
function buildLimits(adapter) {
  const adapterLimits = adapter.limits;

  return {
    // Request maximum available storage buffer size (critical for large weight tensors)
    maxStorageBufferBindingSize: adapterLimits.maxStorageBufferBindingSize,
    // Request maximum buffer size
    maxBufferSize: adapterLimits.maxBufferSize,
    // Request maximum compute workgroup sizes
    maxComputeWorkgroupSizeX: adapterLimits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: adapterLimits.maxComputeWorkgroupSizeY,
    maxComputeWorkgroupSizeZ: adapterLimits.maxComputeWorkgroupSizeZ,
    maxComputeInvocationsPerWorkgroup: adapterLimits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupStorageSize: adapterLimits.maxComputeWorkgroupStorageSize,
    // Binding limits
    maxStorageBuffersPerShaderStage: adapterLimits.maxStorageBuffersPerShaderStage,
    maxUniformBufferBindingSize: adapterLimits.maxUniformBufferBindingSize,
  };
}

/**
 * Initialize WebGPU device with optimal features
 * @returns {Promise<GPUDevice>}
 * @throws {Error} If WebGPU is unavailable or device creation fails
 */
export async function initDevice() {
  // Return cached device if available
  if (gpuDevice) {
    return gpuDevice;
  }

  if (!isWebGPUAvailable()) {
    throw new Error('WebGPU is not available in this browser');
  }

  const adapter = await requestAdapter();
  if (!adapter) {
    throw new Error('Failed to get WebGPU adapter');
  }

  // Detect available features
  const availableFeatures = detectFeatures(adapter);
  const requestedFeatures = buildFeatureRequests(availableFeatures);
  const limits = buildLimits(adapter);

  // Log adapter info for debugging
  const adapterInfo = await adapter.requestAdapterInfo?.() || {};
  console.log('[DREAMER GPU] Adapter:', adapterInfo.vendor || 'unknown', adapterInfo.architecture || '');
  console.log('[DREAMER GPU] Available features:', [...availableFeatures].join(', '));
  console.log('[DREAMER GPU] Requesting features:', requestedFeatures.join(', ') || 'none');
  console.log('[DREAMER GPU] Max storage buffer:', (limits.maxStorageBufferBindingSize / (1024 * 1024 * 1024)).toFixed(2), 'GB');

  try {
    gpuDevice = await adapter.requestDevice({
      requiredFeatures: requestedFeatures,
      requiredLimits: limits,
    });
  } catch (e) {
    // Fallback: request device without optional features
    console.warn('[DREAMER GPU] Failed to request device with features, trying minimal config:', e.message);
    gpuDevice = await adapter.requestDevice();
  }

  if (!gpuDevice) {
    throw new Error('Failed to create WebGPU device');
  }

  // Set up device lost handler
  gpuDevice.lost.then((info) => {
    console.error('[DREAMER GPU] Device lost:', info.message, 'Reason:', info.reason);
    gpuDevice = null;
    kernelCapabilities = null;
  });

  // Cache kernel capabilities
  kernelCapabilities = {
    hasSubgroups: gpuDevice.features.has(FEATURES.SUBGROUPS),
    hasSubgroupsF16: gpuDevice.features.has(FEATURES.SUBGROUPS_F16),
    hasF16: gpuDevice.features.has(FEATURES.SHADER_F16),
    hasTimestampQuery: gpuDevice.features.has(FEATURES.TIMESTAMP_QUERY),
    maxBufferSize: gpuDevice.limits.maxStorageBufferBindingSize,
    maxWorkgroupSize: gpuDevice.limits.maxComputeInvocationsPerWorkgroup,
    maxWorkgroupStorageSize: gpuDevice.limits.maxComputeWorkgroupStorageSize,
    adapterInfo: {
      vendor: adapterInfo.vendor || 'unknown',
      architecture: adapterInfo.architecture || 'unknown',
      device: adapterInfo.device || 'unknown',
      description: adapterInfo.description || '',
    },
  };

  console.log('[DREAMER GPU] Device initialized:', {
    f16: kernelCapabilities.hasF16,
    subgroups: kernelCapabilities.hasSubgroups,
    maxBuffer: `${(kernelCapabilities.maxBufferSize / (1024 * 1024 * 1024)).toFixed(2)} GB`,
  });

  return gpuDevice;
}

/**
 * Get kernel capabilities (call after initDevice)
 * @returns {object} Capability flags for kernel selection
 */
export function getKernelCapabilities() {
  if (!kernelCapabilities) {
    throw new Error('Device not initialized. Call initDevice() first.');
  }
  return { ...kernelCapabilities };
}

/**
 * Get the current GPU device (call after initDevice)
 * @returns {GPUDevice|null}
 */
export function getDevice() {
  return gpuDevice;
}

/**
 * Destroy the device and clear cache
 */
export function destroyDevice() {
  if (gpuDevice) {
    gpuDevice.destroy();
    gpuDevice = null;
    kernelCapabilities = null;
  }
}

/**
 * Check if a specific feature is available
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
export function hasFeature(feature) {
  if (!gpuDevice) {
    return false;
  }
  return gpuDevice.features.has(feature);
}

/**
 * Get device limits
 * @returns {object|null}
 */
export function getDeviceLimits() {
  if (!gpuDevice) {
    return null;
  }
  return {
    maxStorageBufferBindingSize: gpuDevice.limits.maxStorageBufferBindingSize,
    maxBufferSize: gpuDevice.limits.maxBufferSize,
    maxComputeWorkgroupSizeX: gpuDevice.limits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: gpuDevice.limits.maxComputeWorkgroupSizeY,
    maxComputeWorkgroupSizeZ: gpuDevice.limits.maxComputeWorkgroupSizeZ,
    maxComputeInvocationsPerWorkgroup: gpuDevice.limits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupStorageSize: gpuDevice.limits.maxComputeWorkgroupStorageSize,
    maxStorageBuffersPerShaderStage: gpuDevice.limits.maxStorageBuffersPerShaderStage,
  };
}

// Feature constants for external use
export { FEATURES };

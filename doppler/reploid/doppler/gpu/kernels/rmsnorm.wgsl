// RMSNorm Kernel with Fused Residual Add
//
// RMSNorm(x) = x / sqrt(mean(x^2) + eps) * weight
//
// Optionally fuses residual addition:
// output = RMSNorm(x + residual) * weight
//
// Uses workgroup reduction for efficient mean calculation.

const WORKGROUP_SIZE: u32 = 256u;

struct RMSNormUniforms {
    size: u32,          // Hidden dimension
    numTokens: u32,     // Number of tokens to process
    eps: f32,           // Epsilon for numerical stability (typically 1e-5 or 1e-6)
    hasResidual: u32,   // 1 if residual input provided, 0 otherwise
}

@group(0) @binding(0) var<uniform> uniforms: RMSNormUniforms;
@group(0) @binding(1) var<storage, read> input: array<f32>;
@group(0) @binding(2) var<storage, read> weight: array<f32>;   // [size]
@group(0) @binding(3) var<storage, read_write> output: array<f32>;
@group(0) @binding(4) var<storage, read> residual: array<f32>; // Optional residual input

// Shared memory for reduction
var<workgroup> shared_sum: array<f32, 256>;

// Main RMSNorm kernel - one workgroup per token
@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>
) {
    let tokenIdx = wg_id.x;
    let threadIdx = local_id.x;
    let size = uniforms.size;

    if (tokenIdx >= uniforms.numTokens) {
        return;
    }

    let baseOffset = tokenIdx * size;

    // Each thread computes partial sum of squares
    var local_sum_sq: f32 = 0.0;
    let elementsPerThread = (size + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;

    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            var x = input[baseOffset + idx];

            // Add residual if present
            if (uniforms.hasResidual == 1u) {
                x = x + residual[baseOffset + idx];
            }

            local_sum_sq = local_sum_sq + x * x;
        }
    }

    // Store local sum for reduction
    shared_sum[threadIdx] = local_sum_sq;
    workgroupBarrier();

    // Parallel reduction to compute total sum of squares
    for (var stride: u32 = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
        if (threadIdx < stride) {
            shared_sum[threadIdx] = shared_sum[threadIdx] + shared_sum[threadIdx + stride];
        }
        workgroupBarrier();
    }

    // Compute RMS
    let mean_sq = shared_sum[0] / f32(size);
    let rms = sqrt(mean_sq + uniforms.eps);
    let inv_rms = 1.0 / rms;

    workgroupBarrier();

    // Apply normalization and weight
    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            var x = input[baseOffset + idx];

            // Add residual if present
            if (uniforms.hasResidual == 1u) {
                x = x + residual[baseOffset + idx];
            }

            // Normalize and scale
            output[baseOffset + idx] = x * inv_rms * weight[idx];
        }
    }
}

// Optimized version for hidden size <= 256 (single pass)
@compute @workgroup_size(256, 1, 1)
fn rmsnorm_small(
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>
) {
    let tokenIdx = wg_id.x;
    let threadIdx = local_id.x;
    let size = uniforms.size;

    if (tokenIdx >= uniforms.numTokens) {
        return;
    }

    let baseOffset = tokenIdx * size;

    // Each thread handles one element (for size <= 256)
    var x: f32 = 0.0;
    if (threadIdx < size) {
        x = input[baseOffset + threadIdx];
        if (uniforms.hasResidual == 1u) {
            x = x + residual[baseOffset + threadIdx];
        }
    }

    // Sum of squares
    shared_sum[threadIdx] = x * x;
    workgroupBarrier();

    // Parallel reduction
    for (var stride: u32 = 128u; stride > 0u; stride = stride >> 1u) {
        if (threadIdx < stride && threadIdx + stride < size) {
            shared_sum[threadIdx] = shared_sum[threadIdx] + shared_sum[threadIdx + stride];
        }
        workgroupBarrier();
    }

    // Compute inverse RMS
    let mean_sq = shared_sum[0] / f32(size);
    let inv_rms = 1.0 / sqrt(mean_sq + uniforms.eps);

    // Apply normalization
    if (threadIdx < size) {
        output[baseOffset + threadIdx] = x * inv_rms * weight[threadIdx];
    }
}

// Version that also outputs the normalized input before weight multiplication
// Useful for some architectures that need both
@compute @workgroup_size(256, 1, 1)
fn rmsnorm_with_prenorm(
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>
) {
    let tokenIdx = wg_id.x;
    let threadIdx = local_id.x;
    let size = uniforms.size;

    if (tokenIdx >= uniforms.numTokens) {
        return;
    }

    let baseOffset = tokenIdx * size;
    let elementsPerThread = (size + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;

    // First pass: compute sum of squares
    var local_sum_sq: f32 = 0.0;
    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            var x = input[baseOffset + idx];
            if (uniforms.hasResidual == 1u) {
                x = x + residual[baseOffset + idx];
            }
            local_sum_sq = local_sum_sq + x * x;
        }
    }

    shared_sum[threadIdx] = local_sum_sq;
    workgroupBarrier();

    // Reduction
    for (var stride: u32 = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
        if (threadIdx < stride) {
            shared_sum[threadIdx] = shared_sum[threadIdx] + shared_sum[threadIdx + stride];
        }
        workgroupBarrier();
    }

    let mean_sq = shared_sum[0] / f32(size);
    let inv_rms = 1.0 / sqrt(mean_sq + uniforms.eps);

    workgroupBarrier();

    // Second pass: write output
    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            var x = input[baseOffset + idx];
            if (uniforms.hasResidual == 1u) {
                x = x + residual[baseOffset + idx];
            }
            let normalized = x * inv_rms;
            output[baseOffset + idx] = normalized * weight[idx];
        }
    }
}

// In-place version that writes normalized (x + residual) back to residual buffer
// Common pattern: residual = x + residual, output = rmsnorm(residual)
@compute @workgroup_size(256, 1, 1)
fn rmsnorm_inplace_residual(
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>
) {
    let tokenIdx = wg_id.x;
    let threadIdx = local_id.x;
    let size = uniforms.size;

    if (tokenIdx >= uniforms.numTokens) {
        return;
    }

    let baseOffset = tokenIdx * size;
    let elementsPerThread = (size + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;

    // First pass: compute sum of squares and update residual
    var local_sum_sq: f32 = 0.0;
    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            // Note: residual buffer must be read-write for this variant
            let x = input[baseOffset + idx] + residual[baseOffset + idx];
            local_sum_sq = local_sum_sq + x * x;
        }
    }

    shared_sum[threadIdx] = local_sum_sq;
    workgroupBarrier();

    for (var stride: u32 = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride >> 1u) {
        if (threadIdx < stride) {
            shared_sum[threadIdx] = shared_sum[threadIdx] + shared_sum[threadIdx + stride];
        }
        workgroupBarrier();
    }

    let mean_sq = shared_sum[0] / f32(size);
    let inv_rms = 1.0 / sqrt(mean_sq + uniforms.eps);

    workgroupBarrier();

    // Second pass: normalize and write
    for (var i: u32 = 0u; i < elementsPerThread; i = i + 1u) {
        let idx = threadIdx * elementsPerThread + i;
        if (idx < size) {
            let x = input[baseOffset + idx] + residual[baseOffset + idx];
            output[baseOffset + idx] = x * inv_rms * weight[idx];
        }
    }
}

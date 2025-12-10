// SiLU (Swish) Activation Kernel
//
// SiLU(x) = x * sigmoid(x) = x * (1 / (1 + exp(-x)))
//
// Also known as Swish activation, used in LLaMA and other modern LLMs.
//
// Includes fused variants:
// - SiLU(gate) * up (LLaMA SwiGLU FFN pattern)
// - SiLU with optional bias add

const WORKGROUP_SIZE: u32 = 256u;

struct SiLUUniforms {
    size: u32,          // Total number of elements
    hasBias: u32,       // 1 if bias should be added before activation
    hasGate: u32,       // 1 if using gated variant (SiLU(gate) * up)
    _pad: u32,
}

@group(0) @binding(0) var<uniform> uniforms: SiLUUniforms;
@group(0) @binding(1) var<storage, read> input: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@group(0) @binding(3) var<storage, read> gate: array<f32>;   // For gated variant
@group(0) @binding(4) var<storage, read> bias: array<f32>;   // Optional bias

// Sigmoid helper
fn sigmoid(x: f32) -> f32 {
    return 1.0 / (1.0 + exp(-x));
}

// SiLU helper
fn silu(x: f32) -> f32 {
    return x * sigmoid(x);
}

// Basic SiLU activation
// output = x * sigmoid(x)
@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let x = input[idx];
    output[idx] = silu(x);
}

// SiLU with bias: output = silu(x + bias)
@compute @workgroup_size(256, 1, 1)
fn silu_bias(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let x = input[idx] + bias[idx];
    output[idx] = silu(x);
}

// Gated SiLU (SwiGLU): output = SiLU(gate) * up
// This is the pattern used in LLaMA FFN:
//   up = input @ W_up
//   gate = input @ W_gate
//   output = SiLU(gate) * up
@compute @workgroup_size(256, 1, 1)
fn silu_gate(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let up = input[idx];
    let g = gate[idx];

    // SiLU(gate) * up
    output[idx] = silu(g) * up;
}

// Fused gated SiLU with interleaved input
// Input format: [gate0, up0, gate1, up1, ...]
// Useful when gate and up are stored interleaved
@compute @workgroup_size(256, 1, 1)
fn silu_gate_interleaved(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;
    let halfSize = uniforms.size / 2u;

    if (idx >= halfSize) {
        return;
    }

    let gateIdx = idx * 2u;
    let upIdx = gateIdx + 1u;

    let g = input[gateIdx];
    let up = input[upIdx];

    output[idx] = silu(g) * up;
}

// Fused gated SiLU with split input
// First half of input is gate, second half is up
// Input format: [gate0, gate1, ..., gateN, up0, up1, ..., upN]
@compute @workgroup_size(256, 1, 1)
fn silu_gate_split(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;
    let halfSize = uniforms.size / 2u;

    if (idx >= halfSize) {
        return;
    }

    let g = input[idx];           // First half: gate
    let up = input[idx + halfSize];  // Second half: up

    output[idx] = silu(g) * up;
}

// Vectorized SiLU (process 4 elements per thread)
@compute @workgroup_size(256, 1, 1)
fn silu_vec4(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let baseIdx = global_id.x * 4u;

    if (baseIdx >= uniforms.size) {
        return;
    }

    // Process up to 4 elements
    let remaining = min(4u, uniforms.size - baseIdx);

    for (var i: u32 = 0u; i < remaining; i = i + 1u) {
        let x = input[baseIdx + i];
        output[baseIdx + i] = silu(x);
    }
}

// Vectorized gated SiLU
@compute @workgroup_size(256, 1, 1)
fn silu_gate_vec4(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let baseIdx = global_id.x * 4u;

    if (baseIdx >= uniforms.size) {
        return;
    }

    let remaining = min(4u, uniforms.size - baseIdx);

    for (var i: u32 = 0u; i < remaining; i = i + 1u) {
        let up = input[baseIdx + i];
        let g = gate[baseIdx + i];
        output[baseIdx + i] = silu(g) * up;
    }
}

// In-place SiLU (modifies input buffer)
@compute @workgroup_size(256, 1, 1)
fn silu_inplace(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let x = output[idx];  // Using output as read-write buffer
    output[idx] = silu(x);
}

// GELU activation for comparison (used in some models)
// GELU(x) ≈ 0.5 * x * (1 + tanh(sqrt(2/π) * (x + 0.044715 * x^3)))
@compute @workgroup_size(256, 1, 1)
fn gelu(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let x = input[idx];

    // Approximate GELU
    let sqrt_2_over_pi: f32 = 0.7978845608;
    let c: f32 = 0.044715;

    let inner = sqrt_2_over_pi * (x + c * x * x * x);
    output[idx] = 0.5 * x * (1.0 + tanh(inner));
}

// Gated GELU (GeGLU) - similar pattern to SwiGLU
@compute @workgroup_size(256, 1, 1)
fn geglu(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let up = input[idx];
    let g = gate[idx];

    // GELU(gate) * up
    let sqrt_2_over_pi: f32 = 0.7978845608;
    let c: f32 = 0.044715;

    let inner = sqrt_2_over_pi * (g + c * g * g * g);
    let gelu_g = 0.5 * g * (1.0 + tanh(inner));

    output[idx] = gelu_g * up;
}

// ReLU for simple comparison/fallback
@compute @workgroup_size(256, 1, 1)
fn relu(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    output[idx] = max(0.0, input[idx]);
}

// Leaky ReLU
@compute @workgroup_size(256, 1, 1)
fn leaky_relu(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let x = input[idx];
    let alpha: f32 = 0.01;

    output[idx] = select(alpha * x, x, x >= 0.0);
}

// Fused SiLU + element-wise multiply (common pattern)
// output = SiLU(a) * b
@compute @workgroup_size(256, 1, 1)
fn silu_mul(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    let a = input[idx];
    let b = gate[idx];  // Using gate binding for second operand

    output[idx] = silu(a) * b;
}

// Batched SiLU with separate batch dimension
// input shape: [batchSize, hiddenSize]
// Each thread handles one element
@compute @workgroup_size(256, 1, 1)
fn silu_batched(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let idx = global_id.x;

    if (idx >= uniforms.size) {
        return;
    }

    // SiLU is element-wise, so batching is automatic
    let x = input[idx];
    output[idx] = silu(x);
}

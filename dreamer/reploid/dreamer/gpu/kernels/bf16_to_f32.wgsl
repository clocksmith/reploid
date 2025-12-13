// BF16 to F32 Conversion Kernel
//
// Converts BF16 (bfloat16) data to F32.
// BF16 is just the upper 16 bits of F32, so conversion is a simple shift.

const WORKGROUP_SIZE: u32 = 256u;

struct Uniforms {
    numElements: u32,
    _pad1: u32,
    _pad2: u32,
    _pad3: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> input: array<u32>;  // BF16 packed as u32 (2 per u32)
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    // Each thread processes 2 BF16 values (one u32 contains 2 bf16)
    let pair_idx = idx;
    let elem_idx = pair_idx * 2u;

    if (elem_idx >= uniforms.numElements) {
        return;
    }

    let packed = input[pair_idx];

    // Extract two BF16 values and convert to F32
    // BF16 is upper 16 bits of F32, so shift left by 16
    let bf16_lo = packed & 0xFFFFu;
    let bf16_hi = (packed >> 16u) & 0xFFFFu;

    // Convert by shifting to F32 position
    output[elem_idx] = bitcast<f32>(bf16_lo << 16u);

    if (elem_idx + 1u < uniforms.numElements) {
        output[elem_idx + 1u] = bitcast<f32>(bf16_hi << 16u);
    }
}

// Single-element version for odd-sized tensors
@compute @workgroup_size(256, 1, 1)
fn main_single(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;

    if (idx >= uniforms.numElements) {
        return;
    }

    // Read as u16 pairs, extract the right one
    let pair_idx = idx / 2u;
    let packed = input[pair_idx];

    let bf16 = select(packed & 0xFFFFu, (packed >> 16u) & 0xFFFFu, (idx & 1u) == 1u);
    output[idx] = bitcast<f32>(bf16 << 16u);
}

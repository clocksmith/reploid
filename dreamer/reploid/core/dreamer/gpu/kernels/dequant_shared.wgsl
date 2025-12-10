// Q4_K_M Dequantization Kernel - Shared Memory Fallback
//
// Dequantizes Q4_K_M quantized weights using workgroup shared memory.
// This is the fallback when subgroup operations are unavailable.
//
// Strategy: Leader threads load scales into shared memory,
// barrier, then all threads read from shared.

// Q4_K_M constants
const QK_K: u32 = 256u;
const SUBBLOCK_SIZE: u32 = 64u;
const NUM_SUBBLOCKS: u32 = 4u;

struct Uniforms {
    num_blocks: u32,
    output_offset: u32,
    _pad0: u32,
    _pad1: u32,
}

struct Q4KBlock {
    d: u32,
    scales: array<u32, 3>,
    qs: array<u32, 32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> quantized: array<Q4KBlock>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

// Shared memory for scales and mins (4 sub-blocks * 2 values each)
var<workgroup> shared_scales: array<f32, 4>;
var<workgroup> shared_mins: array<f32, 4>;
var<workgroup> shared_d: f32;
var<workgroup> shared_dmin: f32;

fn unpack_f16_lo(packed: u32) -> f32 {
    return unpack2x16float(packed).x;
}

fn unpack_f16_hi(packed: u32) -> f32 {
    return unpack2x16float(packed).y;
}

// Extract 6-bit value from packed scale bytes
fn extract_scale(scales: array<u32, 3>, idx: u32) -> u32 {
    // Q4_K_M scale packing (simplified representation)
    // In actual Q4_K_M: scales use 6 bits each, packed tightly
    // scales[0..5] are lower 6 bits of scale/min pairs
    // scales[6..11] are upper 2 bits packed differently

    // For first 4 scale/min pairs (8 x 6-bit values = 48 bits = 6 bytes)
    let bit_offset = idx * 6u;
    let byte_start = bit_offset / 8u;
    let bit_start = bit_offset % 8u;

    // Read from appropriate word
    let word_idx = byte_start / 4u;
    let word_bit = (byte_start % 4u) * 8u + bit_start;

    var value = (scales[word_idx] >> word_bit) & 0x3Fu;

    // Handle crossing word boundary
    if (word_bit + 6u > 32u) {
        let overflow = word_bit + 6u - 32u;
        let next_word = scales[(word_idx + 1u) % 3u];
        value = (value & ((1u << (6u - overflow)) - 1u)) |
                ((next_word & ((1u << overflow) - 1u)) << (6u - overflow));
    }

    return value;
}

fn get_q4(qs: array<u32, 32>, idx: u32) -> u32 {
    let word_idx = idx / 8u;
    let nibble_idx = idx % 8u;
    return (qs[word_idx] >> (nibble_idx * 4u)) & 0xFu;
}

@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) workgroup_id: vec3<u32>
) {
    let block_idx = workgroup_id.x;
    let elem_idx = local_id.x;

    if (block_idx >= uniforms.num_blocks) {
        return;
    }

    let block = quantized[block_idx];

    // First few threads load shared data
    if (elem_idx == 0u) {
        shared_d = unpack_f16_lo(block.d);
        shared_dmin = unpack_f16_hi(block.d);
    }

    // Threads 0-3 load scales, threads 4-7 load mins
    if (elem_idx < 4u) {
        let sc = extract_scale(block.scales, elem_idx * 2u);
        shared_scales[elem_idx] = f32(sc);
    } else if (elem_idx < 8u) {
        let mn = extract_scale(block.scales, (elem_idx - 4u) * 2u + 1u);
        shared_mins[elem_idx - 4u] = f32(mn);
    }

    // Wait for shared memory to be populated
    workgroupBarrier();

    // Now all threads can read scales efficiently
    let d = shared_d;
    let dmin = shared_dmin;
    let subblock_idx = elem_idx / SUBBLOCK_SIZE;
    let scale = d * shared_scales[subblock_idx];
    let min_val = dmin * shared_mins[subblock_idx];

    // Get quantized value and dequantize
    let q = get_q4(block.qs, elem_idx);
    let dequant = scale * f32(q) - min_val;

    // Write output
    let out_idx = uniforms.output_offset + block_idx * QK_K + elem_idx;
    output[out_idx] = dequant;
}

// Vectorized version - each thread handles 4 elements
// Workgroup processes one block with 64 threads
@compute @workgroup_size(64, 1, 1)
fn main_vec4(
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) workgroup_id: vec3<u32>
) {
    let block_idx = workgroup_id.x;
    let thread_idx = local_id.x;

    if (block_idx >= uniforms.num_blocks) {
        return;
    }

    let block = quantized[block_idx];

    // Load shared data
    if (thread_idx == 0u) {
        shared_d = unpack_f16_lo(block.d);
        shared_dmin = unpack_f16_hi(block.d);
    }

    if (thread_idx < 4u) {
        shared_scales[thread_idx] = f32(extract_scale(block.scales, thread_idx * 2u));
        shared_mins[thread_idx] = f32(extract_scale(block.scales, thread_idx * 2u + 1u));
    }

    workgroupBarrier();

    let d = shared_d;
    let dmin = shared_dmin;

    // Each thread processes 4 elements
    let base_elem = thread_idx * 4u;
    let subblock_idx = base_elem / SUBBLOCK_SIZE;
    let scale = d * shared_scales[subblock_idx];
    let min_val = dmin * shared_mins[subblock_idx];

    let out_base = uniforms.output_offset + block_idx * QK_K + base_elem;

    // Unrolled loop for 4 elements
    output[out_base + 0u] = scale * f32(get_q4(block.qs, base_elem + 0u)) - min_val;
    output[out_base + 1u] = scale * f32(get_q4(block.qs, base_elem + 1u)) - min_val;
    output[out_base + 2u] = scale * f32(get_q4(block.qs, base_elem + 2u)) - min_val;
    output[out_base + 3u] = scale * f32(get_q4(block.qs, base_elem + 3u)) - min_val;
}

// FP16 output variant for when downstream consumers want f16
@compute @workgroup_size(256, 1, 1)
fn main_f16_out(
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) workgroup_id: vec3<u32>
) {
    let block_idx = workgroup_id.x;
    let elem_idx = local_id.x;

    if (block_idx >= uniforms.num_blocks) {
        return;
    }

    let block = quantized[block_idx];

    if (elem_idx == 0u) {
        shared_d = unpack_f16_lo(block.d);
        shared_dmin = unpack_f16_hi(block.d);
    }

    if (elem_idx < 4u) {
        shared_scales[elem_idx] = f32(extract_scale(block.scales, elem_idx * 2u));
    } else if (elem_idx < 8u) {
        shared_mins[elem_idx - 4u] = f32(extract_scale(block.scales, (elem_idx - 4u) * 2u + 1u));
    }

    workgroupBarrier();

    let subblock_idx = elem_idx / SUBBLOCK_SIZE;
    let scale = shared_d * shared_scales[subblock_idx];
    let min_val = shared_dmin * shared_mins[subblock_idx];

    let q = get_q4(block.qs, elem_idx);
    let dequant = scale * f32(q) - min_val;

    // Note: This writes f32, but caller can cast if needed
    // A separate buffer typed as array<f16> would be needed for true f16 output
    let out_idx = uniforms.output_offset + block_idx * QK_K + elem_idx;
    output[out_idx] = dequant;
}

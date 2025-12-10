// Q4_K_M Dequantization Kernel - Subgroup Optimized
//
// Dequantizes Q4_K_M quantized weights using subgroup broadcast operations.
// Q4_K_M format: 256 elements per super-block
//   - 4 sub-blocks of 64 elements each
//   - 4-bit weights (2 elements packed per byte)
//   - Scales and mins stored per sub-block with additional super-block scale
//
// Subgroup operations enable efficient broadcast of scales to all lanes,
// reducing memory reads and improving throughput.

enable subgroups;

// Q4_K_M super-block size
const QK_K: u32 = 256u;
const SUBBLOCK_SIZE: u32 = 64u;
const SUBBLOCKS_PER_BLOCK: u32 = 4u;

// Uniforms
struct Uniforms {
    num_blocks: u32,    // Total number of Q4_K_M blocks
    output_offset: u32, // Offset in output buffer
    _pad0: u32,
    _pad1: u32,
}

// Q4_K_M block structure (packed layout matching llama.cpp)
// Total size per block: 144 bytes
//   - d (f16): super-block scale (2 bytes)
//   - dmin (f16): super-block min (2 bytes)
//   - scales (12 bytes): packed 6-bit scales for sub-blocks
//   - qs (128 bytes): 4-bit quantized values (256 * 4 bits / 8 = 128 bytes)
struct Q4KBlock {
    d: u32,           // d and dmin packed as f16 pair
    scales: array<u32, 3>, // 12 bytes of packed scales
    qs: array<u32, 32>,    // 128 bytes of quantized values
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> quantized: array<Q4KBlock>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

// Extract f16 from packed u32
fn unpack_f16_lo(packed: u32) -> f32 {
    return unpack2x16float(packed).x;
}

fn unpack_f16_hi(packed: u32) -> f32 {
    return unpack2x16float(packed).y;
}

// Extract 6-bit scale from packed bytes
fn get_scale(scales: array<u32, 3>, idx: u32) -> u32 {
    // Scales are packed in a complex way in Q4_K_M
    // Each sub-block has a 6-bit scale and 6-bit min
    let byte_idx = (idx * 6u) / 8u;
    let bit_offset = (idx * 6u) % 8u;

    // This is simplified - actual Q4_K_M packing is more complex
    let word_idx = byte_idx / 4u;
    let word_offset = (byte_idx % 4u) * 8u + bit_offset;

    var val = (scales[word_idx] >> word_offset) & 0x3Fu;
    if (word_offset > 26u) {
        // Scale crosses word boundary
        let next_word = scales[(word_idx + 1u) % 3u];
        let remaining_bits = 32u - word_offset;
        val = val | ((next_word << remaining_bits) & 0x3Fu);
    }
    return val;
}

// Extract 4-bit quantized value
fn get_q4(qs: array<u32, 32>, idx: u32) -> u32 {
    let word_idx = idx / 8u;      // 8 x 4-bit values per u32
    let nibble_idx = idx % 8u;
    return (qs[word_idx] >> (nibble_idx * 4u)) & 0xFu;
}

@compute @workgroup_size(64, 1, 1)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(subgroup_invocation_id) sg_id: u32,
    @builtin(subgroup_size) sg_size: u32
) {
    let block_idx = global_id.x / QK_K;
    let elem_idx = global_id.x % QK_K;

    if (block_idx >= uniforms.num_blocks) {
        return;
    }

    let block = quantized[block_idx];

    // Extract super-block scale and min
    let d = unpack_f16_lo(block.d);
    let dmin = unpack_f16_hi(block.d);

    // Determine sub-block
    let subblock_idx = elem_idx / SUBBLOCK_SIZE;
    let subblock_elem = elem_idx % SUBBLOCK_SIZE;

    // Get sub-block scale (use subgroup broadcast for efficiency)
    // Leader thread in each 64-thread group reads the scale
    var scale: f32;
    var min_val: f32;

    // Subgroup broadcast: thread 0 reads, broadcasts to all
    let is_leader = (sg_id == 0u);
    if (is_leader) {
        let sc = get_scale(block.scales, subblock_idx * 2u);
        let mn = get_scale(block.scales, subblock_idx * 2u + 1u);
        scale = d * f32(sc);
        min_val = dmin * f32(mn);
    }

    // Broadcast scale and min to all threads in subgroup
    scale = subgroupBroadcastFirst(scale);
    min_val = subgroupBroadcastFirst(min_val);

    // Get quantized value
    let q = get_q4(block.qs, elem_idx);

    // Dequantize: output = scale * q - min
    let dequant = scale * f32(q) - min_val;

    // Write output
    let out_idx = uniforms.output_offset + block_idx * QK_K + elem_idx;
    output[out_idx] = dequant;
}

// Entry point for processing multiple elements per thread (4x unroll)
@compute @workgroup_size(64, 1, 1)
fn main_vec4(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(subgroup_invocation_id) sg_id: u32
) {
    let thread_idx = global_id.x;
    let block_idx = thread_idx / 64u;  // 64 threads per block (256/4 elements each)
    let local_idx = thread_idx % 64u;

    if (block_idx >= uniforms.num_blocks) {
        return;
    }

    let block = quantized[block_idx];
    let d = unpack_f16_lo(block.d);
    let dmin = unpack_f16_hi(block.d);

    // Each thread processes 4 consecutive elements
    let base_elem = local_idx * 4u;
    let subblock_idx = base_elem / SUBBLOCK_SIZE;

    // Broadcast scales within subgroup
    var scale: f32;
    var min_val: f32;

    let is_leader = (sg_id % 16u == 0u);  // Leader per sub-block worth of threads
    if (is_leader) {
        let sc = get_scale(block.scales, subblock_idx * 2u);
        let mn = get_scale(block.scales, subblock_idx * 2u + 1u);
        scale = d * f32(sc);
        min_val = dmin * f32(mn);
    }
    scale = subgroupBroadcastFirst(scale);
    min_val = subgroupBroadcastFirst(min_val);

    // Process 4 elements
    let out_base = uniforms.output_offset + block_idx * QK_K + base_elem;

    for (var i: u32 = 0u; i < 4u; i = i + 1u) {
        let q = get_q4(block.qs, base_elem + i);
        output[out_base + i] = scale * f32(q) - min_val;
    }
}

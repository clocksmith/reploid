// Fused Q4_K Matmul Kernel - W4A16
// Directly computes C = A * dequant(B_q4k) without separate dequant pass
//
// For M=1 decode (GEMV): C[N] = A[K] * B_q4k^T[N,K]
// B_q4k is stored in Q4_K format: [N * ceil(K/256) * 144 bytes]
//
// Key optimizations:
// 1. Fused dequant + matmul - eliminates memory round-trip (2-3x speedup)
// 2. Subgroup operations for reduction
// 3. On-the-fly dequantization in registers
//
// A is f32 (activations), B_q4k is Q4_K quantized weights, C is f32.

enable f16;
enable subgroups;

// Q4_K constants
const QK_K: u32 = 256u;           // Elements per super-block
const BLOCK_SIZE: u32 = 144u;     // Bytes per Q4_K block
const SUBBLOCK_SIZE: u32 = 32u;   // Elements per sub-block

const WG_SIZE: u32 = 256u;

struct Uniforms {
    M: u32,           // Always 1 for GEMV
    N: u32,           // Output dimension
    K: u32,           // Inner dimension (must be multiple of 256 for Q4_K)
    alpha: f32,
    num_blocks_per_row: u32,  // K / 256
}

// Q4_K block structure (144 bytes)
// Layout: d(2) + dmin(2) + scales(12) + qs(128)
struct Q4KBlock {
    d_dmin: u32,          // d (f16) and dmin (f16) packed
    scales: array<u32, 3>, // 12 bytes of packed 6-bit scales
    qs: array<u32, 32>,   // 128 bytes of 4-bit quantized values
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B_q4k: array<Q4KBlock>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;

var<workgroup> wg_sums: array<f32, 8>;

// Extract f16 from packed u32
fn unpack_f16_lo(packed: u32) -> f32 {
    return unpack2x16float(packed).x;
}

fn unpack_f16_hi(packed: u32) -> f32 {
    return unpack2x16float(packed).y;
}

// Get byte from scales array
fn get_scale_byte(scales: array<u32, 3>, byte_idx: u32) -> u32 {
    let word_idx = byte_idx / 4u;
    let byte_in_word = byte_idx % 4u;
    return (scales[word_idx] >> (byte_in_word * 8u)) & 0xFFu;
}

// llama.cpp Q4_K scale/min extraction
fn get_scale_min_k4(scales: array<u32, 3>, j: u32) -> vec2<u32> {
    var sc: u32;
    var mn: u32;

    if (j < 4u) {
        sc = get_scale_byte(scales, j) & 63u;
        mn = get_scale_byte(scales, j + 4u) & 63u;
    } else {
        let q_j = get_scale_byte(scales, j + 4u);
        let q_lo = get_scale_byte(scales, j - 4u);
        let q_hi = get_scale_byte(scales, j);
        sc = (q_j & 0xFu) | ((q_lo >> 6u) << 4u);
        mn = (q_j >> 4u) | ((q_hi >> 6u) << 4u);
    }
    return vec2<u32>(sc, mn);
}

// Extract 4-bit quantized value from qs array
fn get_q4(qs: array<u32, 32>, idx: u32) -> u32 {
    let chunk = idx / 64u;
    let pos_in_chunk = idx % 64u;
    let use_upper = pos_in_chunk >= 32u;
    let byte_in_range = select(pos_in_chunk, pos_in_chunk - 32u, use_upper);
    let byte_idx = chunk * 32u + byte_in_range;

    let word_idx = byte_idx / 4u;
    let byte_in_word = byte_idx % 4u;
    let byte_val = (qs[word_idx] >> (byte_in_word * 8u)) & 0xFFu;

    if (use_upper) {
        return (byte_val >> 4u) & 0xFu;
    } else {
        return byte_val & 0xFu;
    }
}

@compute @workgroup_size(256, 1, 1)
fn main(
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>,
    @builtin(subgroup_invocation_id) sg_id: u32,
    @builtin(subgroup_size) sg_size: u32
) {
    let col = wg_id.x;  // Output column this workgroup computes
    let local_id = lid.x;

    if (col >= uniforms.N) {
        return;
    }

    var partial_sum: f32 = 0.0;

    // Each thread processes some Q4_K blocks
    let num_blocks = uniforms.num_blocks_per_row;
    let blocks_per_thread = (num_blocks + WG_SIZE - 1u) / WG_SIZE;
    let block_start = local_id * blocks_per_thread;
    let block_end = min(block_start + blocks_per_thread, num_blocks);

    // B_q4k layout: for row `col`, blocks are at col * num_blocks + block_idx
    let row_block_offset = col * num_blocks;

    for (var b: u32 = block_start; b < block_end; b = b + 1u) {
        let block = B_q4k[row_block_offset + b];

        // Extract super-block scale and min
        let d = unpack_f16_lo(block.d_dmin);
        let dmin = unpack_f16_hi(block.d_dmin);

        // Base element index for this block
        let k_base = b * QK_K;

        // Process all 256 elements in this block
        // Unroll by sub-block (8 sub-blocks of 32 elements each)
        for (var sb: u32 = 0u; sb < 8u; sb = sb + 1u) {
            let sm = get_scale_min_k4(block.scales, sb);
            let scale = d * f32(sm.x);
            let min_val = dmin * f32(sm.y);

            let sb_base = sb * SUBBLOCK_SIZE;

            // Process 32 elements in this sub-block
            // Unroll by 4 for better ILP
            for (var i: u32 = 0u; i < SUBBLOCK_SIZE; i = i + 4u) {
                let elem0 = sb_base + i;
                let elem1 = sb_base + i + 1u;
                let elem2 = sb_base + i + 2u;
                let elem3 = sb_base + i + 3u;

                let k0 = k_base + elem0;
                let k1 = k_base + elem1;
                let k2 = k_base + elem2;
                let k3 = k_base + elem3;

                // Load activations
                let a0 = A[k0];
                let a1 = A[k1];
                let a2 = A[k2];
                let a3 = A[k3];

                // Dequantize weights on-the-fly
                let q0 = get_q4(block.qs, elem0);
                let q1 = get_q4(block.qs, elem1);
                let q2 = get_q4(block.qs, elem2);
                let q3 = get_q4(block.qs, elem3);

                let w0 = scale * f32(q0) - min_val;
                let w1 = scale * f32(q1) - min_val;
                let w2 = scale * f32(q2) - min_val;
                let w3 = scale * f32(q3) - min_val;

                // Accumulate
                partial_sum = partial_sum + a0 * w0 + a1 * w1 + a2 * w2 + a3 * w3;
            }
        }
    }

    // Subgroup reduction
    let sg_sum = subgroupAdd(partial_sum);

    // Inter-subgroup reduction via shared memory
    let subgroup_id = local_id / sg_size;
    let num_subgroups = (WG_SIZE + sg_size - 1u) / sg_size;

    if (sg_id == 0u) {
        wg_sums[subgroup_id] = sg_sum;
    }

    workgroupBarrier();

    // Thread 0 does final reduction and writes result
    if (local_id == 0u) {
        var final_sum: f32 = 0.0;
        for (var i: u32 = 0u; i < num_subgroups; i = i + 1u) {
            final_sum = final_sum + wg_sums[i];
        }
        C[col] = final_sum * uniforms.alpha;
    }
}

// Batched version for prefill (M > 1)
// Uses 2D dispatch: workgroup (x,y) computes output C[y, x*TILE_N : (x+1)*TILE_N]
const TILE_M: u32 = 4u;
const TILE_N: u32 = 4u;

@compute @workgroup_size(64, 4, 1)
fn main_batched(
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wg_id: vec3<u32>,
    @builtin(subgroup_invocation_id) sg_id: u32,
    @builtin(subgroup_size) sg_size: u32
) {
    let row = wg_id.y * TILE_M + lid.y;
    let col = wg_id.x * TILE_N + (lid.x / 16u);
    let k_thread = lid.x % 16u;

    if (row >= uniforms.M || col >= uniforms.N) {
        return;
    }

    var partial_sum: f32 = 0.0;

    let num_blocks = uniforms.num_blocks_per_row;
    let row_block_offset = col * num_blocks;

    // Each thread processes every 16th block
    for (var b: u32 = k_thread; b < num_blocks; b = b + 16u) {
        let block = B_q4k[row_block_offset + b];
        let d = unpack_f16_lo(block.d_dmin);
        let dmin = unpack_f16_hi(block.d_dmin);
        let k_base = b * QK_K;

        for (var sb: u32 = 0u; sb < 8u; sb = sb + 1u) {
            let sm = get_scale_min_k4(block.scales, sb);
            let scale = d * f32(sm.x);
            let min_val = dmin * f32(sm.y);

            for (var i: u32 = 0u; i < SUBBLOCK_SIZE; i = i + 1u) {
                let elem = sb * SUBBLOCK_SIZE + i;
                let k = k_base + elem;
                if (k < uniforms.K) {
                    let a_val = A[row * uniforms.K + k];
                    let q = get_q4(block.qs, elem);
                    let w = scale * f32(q) - min_val;
                    partial_sum = partial_sum + a_val * w;
                }
            }
        }
    }

    // Subgroup reduction across k_threads
    let sg_sum = subgroupAdd(partial_sum);

    // Write result (only thread with k_thread=0 writes)
    if (k_thread == 0u && row < uniforms.M && col < uniforms.N) {
        C[row * uniforms.N + col] = sg_sum * uniforms.alpha;
    }
}

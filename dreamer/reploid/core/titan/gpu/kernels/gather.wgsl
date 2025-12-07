/**
 * Gather Kernel - Token Embedding Lookup
 *
 * Gathers rows from an embedding matrix based on token indices.
 * Used for efficient embedding lookup on GPU without CPU readback.
 */

struct Uniforms {
    num_tokens: u32,      // Number of tokens to gather
    hidden_size: u32,     // Embedding dimension
    vocab_size: u32,      // Vocabulary size (for bounds checking)
    _pad: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> indices: array<u32>;      // Token IDs [num_tokens]
@group(0) @binding(2) var<storage, read> embeddings: array<f32>;   // Embedding matrix [vocab_size, hidden_size]
@group(0) @binding(3) var<storage, read_write> output: array<f32>; // Output [num_tokens, hidden_size]

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tid = gid.x;
    let total_elements = uniforms.num_tokens * uniforms.hidden_size;

    if (tid >= total_elements) {
        return;
    }

    // Compute token index and dimension index
    let token_idx = tid / uniforms.hidden_size;
    let dim_idx = tid % uniforms.hidden_size;

    // Get the token ID (with bounds check)
    let token_id = indices[token_idx];

    // Bounds check on vocab
    if (token_id >= uniforms.vocab_size) {
        output[tid] = 0.0;
        return;
    }

    // Gather from embedding matrix
    let embed_offset = token_id * uniforms.hidden_size + dim_idx;
    output[tid] = embeddings[embed_offset];
}

// Vectorized version for better memory throughput
@compute @workgroup_size(64, 1, 1)
fn gather_vec4(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tid = gid.x;
    let vec4_per_row = uniforms.hidden_size / 4u;
    let total_vec4s = uniforms.num_tokens * vec4_per_row;

    if (tid >= total_vec4s) {
        return;
    }

    // Compute token index and vec4 index within row
    let token_idx = tid / vec4_per_row;
    let vec4_idx = tid % vec4_per_row;

    // Get the token ID
    let token_id = indices[token_idx];

    // Bounds check
    if (token_id >= uniforms.vocab_size) {
        let out_base = tid * 4u;
        output[out_base] = 0.0;
        output[out_base + 1u] = 0.0;
        output[out_base + 2u] = 0.0;
        output[out_base + 3u] = 0.0;
        return;
    }

    // Gather 4 elements at once
    let embed_base = token_id * uniforms.hidden_size + vec4_idx * 4u;
    let out_base = tid * 4u;

    output[out_base] = embeddings[embed_base];
    output[out_base + 1u] = embeddings[embed_base + 1u];
    output[out_base + 2u] = embeddings[embed_base + 2u];
    output[out_base + 3u] = embeddings[embed_base + 3u];
}

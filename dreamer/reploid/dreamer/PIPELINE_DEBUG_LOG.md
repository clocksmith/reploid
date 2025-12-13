# Gemma 3 1B Pipeline Verification Log

## Summary
Model: Gemma 3 1B Q4_K_M
Problem: Produces garbage tokens (Telugu, Kannada, Japanese, `<unused>`) with near-uniform logits (~3% top token)

## Pipeline Steps Verification

### 1. Tokenization
- **Input:** "the color of the sky is"
- **Output:** 16 tokens: `2, 105, 2430, 107, 1437, ...`
- **Token 2:** BOS token
- **Status:** Need to verify if chat template is correct

### 2. Embedding Lookup
- **Buffer size:** 2,147,483,648 bytes (2GB, for 262144 x 1152 vocab)
- **dtype:** F32 (converted from BF16)
- **Token 0 embedding (first 64 dims):** min=-0.0859, max=0.0608, mean=-0.0074
- **Status:** VERIFIED - Values are reasonable

### 3. Gather Kernel (Token ID -> Embedding)
- **Before scaling:** min=-0.0376, max=0.0618, mean=-0.0001
- **First 8 values:** 0.0041, -0.0064, -0.0159, 0.0041, -0.0046, -0.0006, -0.0010, 0.0081
- **Status:** VERIFIED - Values are reasonable

### 4. Embedding Scaling (Gemma-specific)
- **Scale factor:** sqrt(1152) = 33.94
- **After scaling:** min=-1.2761, max=25.1907, mean=0.0519
- **First 8 values:** 0.1388, -0.2165, -0.5386, 0.1378, -0.1554, -0.0212, -0.0329, 0.2755
- **Verification:** 0.0041 * 33.94 = 0.139 matches 0.1388
- **Status:** VERIFIED - Scaling is correct

### 5. Q4_K Dequantization (q_proj layer 0)
- **GPU vs CPU comparison:** 0/256 mismatches
- **Max error:** 0.000014
- **GPU mean:** -0.002741, CPU mean: -0.002741
- **Status:** VERIFIED - Dequantization is correct

### 6. Q4_K Dequantization (gate_proj layer 0)
- **GPU vs CPU comparison:** 0/256 mismatches
- **Max error:** 0.000019
- **GPU mean:** -0.004170, CPU mean: -0.004169
- **Status:** VERIFIED - Dequantization is correct

### 7. Layer 0 Input Normalization (RMSNorm)
- **Epsilon:** 1e-6 (correct for Gemma)
- **Status:** Need to verify norm weight values

### 8. Layer 0 Attention Q Projection
- **Input:** [16, 1152]
- **Weight:** [1024, 1152] (numHeads=4, headDim=256)
- **transposeB:** true
- **Status:** Pending verification

### 9. Layer 0 Attention K Projection
- **Input:** [16, 1152]
- **Weight:** [256, 1152] (numKVHeads=1, headDim=256)
- **transposeB:** true
- **Status:** Pending verification

### 10. Layer 0 Attention V Projection
- **Input:** [16, 1152]
- **Weight:** [256, 1152]
- **transposeB:** true
- **Status:** Pending verification

### 11. Layer 0 QK-Norm (Gemma-specific)
- **Q norm:** [4 * 16, 256] batched RMSNorm
- **K norm:** [1 * 16, 256] batched RMSNorm
- **Status:** Pending verification

### 12. Layer 0 RoPE (Positional Encoding)
- **theta:** 1,000,000 (Gemma 3)
- **headDim:** 256
- **startPos:** 0 (prefill)
- **Status:** Pending verification

### 13. Layer 0 Attention Computation
- **Output:** min=-49.4, max=59.2, mean=7.38
- **First 8 values:** 2.17, 14.17, 18.38, -6.99, -2.75, -3.87, 10.69, -33.13
- **Status:** Values seem large but need reference comparison

### 14. Layer 0 Post-Attention Norm (Sandwich Norm)
- **Applied BEFORE residual add** (Gemma 3 pattern)
- **Status:** Pending verification

### 15. Layer 0 Attention Residual Add
- **Pattern:** x + normed_attn (Gemma 3)
- **Status:** Pending verification

### 16. Layer 0 Pre-FFN Norm (Sandwich Norm)
- **Applied to residual stream before FFN**
- **Status:** Pending verification

### 17. Layer 0 FFN Input
- **After pre-FFN norm**
- **Status:** TO BE CHECKED (added debug)

### 18. Layer 0 FFN Gate Projection
- **Input:** [16, 1152]
- **Weight:** [6912, 1152] (intermediateSize=6912)
- **transposeB:** true
- **Status:** TO BE CHECKED (added debug)

### 19. Layer 0 FFN Up Projection
- **Input:** [16, 1152]
- **Weight:** [6912, 1152]
- **transposeB:** true
- **Status:** TO BE CHECKED (added debug)

### 20. Layer 0 FFN Activation (GELU)
- **Formula:** GELU(gate) * up
- **tanh approximation:** 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
- **Status:** TO BE CHECKED (added debug)

### 21. Layer 0 FFN Down Projection
- **Input:** [16, 6912]
- **Weight:** [1152, 6912]
- **transposeB:** true
- **Output:** min=-3078, max=756, mean=-268
- **Status:** EXPLOSION DETECTED - Need to trace

### 22. Layer 0 Post-FFN Norm (Sandwich Norm)
- **Applied BEFORE residual add** (Gemma 3 pattern)
- **Status:** Normalizes the explosion back to reasonable range

### 23. Layer 0 FFN Residual Add
- **After layer 0:** min=-52.4, max=48.7, mean=-1.34
- **Status:** Values normalized but still seem off

### 24. Layers 1-25
- **Status:** Not individually checked yet

### 25. Final Layer Norm
- **Status:** Pending verification

### 26. LM Head Projection
- **Tied embeddings:** true
- **transposeB:** true (for tied)
- **Output:** logits [1, 262145]
- **Status:** Pending verification

### 27. Logit Statistics
- **min:** -19.57, max: 20.06
- **Top-5:** "ನ"(3.2%), "<unused16>"(1.6%), "మా"(1.3%), "マ"(1.3%), "<end_of_turn>"(0.8%)
- **Status:** PROBLEM - Near-uniform distribution, garbage tokens

### 28. Sampling
- **Top tokens:** Non-Latin scripts, unused tokens
- **Confidence:** ~3% (should be much higher for simple continuation)
- **Status:** PROBLEM - Model not producing coherent output

## Current Focus
Tracing FFN explosion at Layer 0:
- Gate projection output
- Up projection output
- Activation output
- Down projection output

## Next Steps
1. Run test with new FFN step-by-step debug
2. Identify exact step where explosion happens
3. Check if weights are systematically wrong
4. Compare against reference implementation

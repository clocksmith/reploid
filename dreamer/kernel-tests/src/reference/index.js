/**
 * Reference Implementation Exports
 */

// Matrix operations
export { matmulRef, batchMatmulRef, matvecRef } from './matmul.js';

// Activation functions
export { softmaxRef, logSoftmaxRef, softmaxInplaceRef } from './softmax.js';
export { siluRef, siluGatedRef, siluFusedRef, siluInplaceRef } from './silu.js';

// Normalization
export { rmsNormRef, rmsNormNoWeightRef } from './rmsnorm.js';

// Position embeddings
export { ropeRef, ropeInterleavedRef, computeRopeFreqs } from './rope.js';

// Attention
export { attentionRef, createCausalMask, flashAttentionRef, mqaRef } from './attention.js';

// MoE operations
export { topkRef, softmaxTopkRef } from './topk.js';
export { scatterAddRef, scatterAddAccumulateRef } from './scatter-add.js';
export { moeGatherRef, moeComputeAssignmentsRef } from './moe-gather.js';

// Memory operations
export { gatherRef, batchGatherRef, gatherWithPosRef } from './gather.js';
export { residualAddRef, residualAddInplaceRef, scaledResidualAddRef } from './residual.js';

// Quantization
export { dequantInt8Ref, dequantInt4Ref, dequantQ4_0Ref } from './dequant.js';

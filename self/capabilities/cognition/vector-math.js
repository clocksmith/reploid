/** Cognitive similarity only; model execution arithmetic belongs to Doppler. */
export function cosineSimilarity(a, b, epsilon = 0) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  const denominator = magnitude + epsilon;
  return denominator === 0 ? 0 : dot / denominator;
}

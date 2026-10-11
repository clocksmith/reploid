// Ordinary application acceptance cannot opt out of an applicable frozen gate.
export function resolveNumericalPolicy({ applicable, diagnostic, requested }) {
  if (requested !== undefined && requested !== '0' && requested !== '1') {
    throw new Error('REPLOID_REQUIRE_NUMERICAL_TOLERANCE must be 0 or 1');
  }
  if (!applicable) {
    if (requested !== undefined) throw new Error('This workload has no applicable frozen numerical comparison');
    return 'not-applicable';
  }
  if (requested === '0') {
    if (!diagnostic) throw new Error('Ordinary acceptance requires numerical tolerance; use --numerical-only for a tracked diagnostic');
    return 'tracked';
  }
  return 'required';
}

export function numericalAcceptance(policy, numerical) {
  if (policy === 'not-applicable') return 'not-applicable';
  if (!numerical?.steps) return 'not-run';
  return numerical.failed > 0 ? 'failed' : 'passed';
}

// Ordinary application acceptance cannot opt out of an applicable frozen gate.
import contract from './distributed-reference-contract.json' with { type: 'json' };
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

export function frozenReferenceAcceptance(policy, numerical) {
  if (policy === 'not-applicable') return 'not-applicable';
  if (!numerical?.steps) return 'not-run';
  return numerical.failed > 0 ? 'failed' : 'passed';
}

// Runtime captures remain regression evidence. Only the explicitly approved,
// hash-verified independent target can qualify numerical accuracy.
export function numericalEvidence(policy, numerical, reference = null) {
  const frozen = frozenReferenceAcceptance(policy, numerical);
  const independent = contract.independent?.approved === true
    && reference?.kind === 'independent-f64'
    && reference.proposalSha256 === contract.independent.proposal.sha256
    && reference.outputIndexSha256 === contract.independent.index.sha256;
  const directions = numerical?.directions || [];
  const complete = reference?.steps === 55 && numerical?.steps === 110
    && numerical.tolerance === 0.001 && Number.isFinite(numerical.maxDifference)
    && ['mac-linux', 'linux-mac'].every(name => directions.some(row => row.direction === name && row.steps === 55));
  const accuracy = policy === 'not-applicable' ? 'not-applicable'
    : !independent || !numerical?.steps ? 'not-run'
    : frozen === 'failed' || numerical.maxDifference > 0.001 ? 'failed'
    : complete ? 'passed' : 'incomplete';
  return {
    frozenReferenceAcceptance: frozen,
    independentAccuracyAcceptance: accuracy,
    numericalAcceptance: frozen === 'passed' ? accuracy === 'passed' ? 'passed' : 'not-qualified' : frozen,
  };
}

export function requireNumericalQualification(policy, numerical, reference = null) {
  if (policy !== 'required') return;
  const evidence = numericalEvidence(policy, numerical, reference);
  if (evidence.numericalAcceptance !== 'passed') {
    throw new Error(evidence.frozenReferenceAcceptance === 'failed'
      ? 'Frozen numerical tolerance exceeded'
      : 'Independent numerical qualification is not established by the captured reference');
  }
}

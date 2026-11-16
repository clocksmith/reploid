/** Pure candidate scoring and archive records; these grant no adoption authority. */
import { canonicalize as stableStringify } from '../artifacts/canonical-json.js';

export function createTaskArchivePolicy(policy, tools) {
  const { normalizeToolName, getToolExecutionMode, getToolBatchMode, getToolPath } = tools;
  const MAX_BATCH_TOOLS = policy.agent.maxBatchTools;

  const REQUIRED_ANCHOR_OBSERVATIONS = policy.agent.requiredAnchorObservations;

  const RGR_SCORE_KEYS = Object.freeze([
    'usefulness',
    'safety',
    'reversibility',
    'evidence',
    'qAnchor',
    'efficiency'
  ]);

  const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  const hashString = (value) => {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  const getCandidateKind = (entries = []) => {
    const paths = entries.map((entry) => getToolPath(entry.call)).filter(Boolean);
    const mutationPaths = entries
      .filter((entry) => getToolExecutionMode(entry.call) !== 'parallel')
      .map((entry) => getToolPath(entry.call))
      .filter(Boolean);
    if (mutationPaths.some((path) => path.startsWith('/artifacts/rgr/') || path.startsWith('opfs:/artifacts/rgr/'))) return 'rgr-artifact';
    if (mutationPaths.some((path) => path.startsWith('/self/prompts/'))) return 'prompt-candidate';
    if (mutationPaths.some((path) => path.startsWith('/self/blueprints/'))) return 'blueprint-candidate';
    if (mutationPaths.some((path) => path.startsWith('/self/tools/'))) return 'tool-candidate';
    if (mutationPaths.some((path) => path.startsWith('/self/'))) return 'self-candidate';
    if (entries.some((entry) => getToolExecutionMode(entry.call) === 'parallel')) return 'read-evidence';
    if (paths.some((path) => path.startsWith('/artifacts/rgr/') || path.startsWith('opfs:/artifacts/rgr/'))) return 'rgr-artifact';
    return 'shadow-candidate';
  };

  const summarizeToolEntries = (entries = []) => {
    const tools = entries.map((entry) => normalizeToolName(entry.call?.name) || 'unknown');
    const paths = entries.map((entry) => getToolPath(entry.call)).filter(Boolean);
    const errors = entries.filter((entry) => entry.kind === 'ERROR').length;
    const successful = Math.max(0, entries.length - errors);
    const readOnly = entries.filter((entry) => getToolExecutionMode(entry.call) === 'parallel').length;
    const ordered = entries.filter((entry) => getToolExecutionMode(entry.call) === 'ordered').length;
    const exclusive = entries.filter((entry) => getToolExecutionMode(entry.call) === 'exclusive').length;
    return {
      tools,
      paths,
      count: entries.length,
      successful,
      errors,
      readOnly,
      ordered,
      exclusive,
      kind: getCandidateKind(entries)
    };
  };

  const scoreRgrCandidate = ({ entries = [], groups = [], anchorObservations = 0 }) => {
    const summary = summarizeToolEntries(entries);
    const total = Math.max(1, summary.count);
    const selfPathWrites = entries.filter((entry) => {
      const name = normalizeToolName(entry.call?.name);
      const path = getToolPath(entry.call);
      return ['WriteFile', 'LoadModule'].includes(name) && path.startsWith('/self/');
    }).length;
    const artifactWrites = entries.filter((entry) => {
      const name = normalizeToolName(entry.call?.name);
      const path = getToolPath(entry.call);
      return name === 'WriteFile' && (
        path.startsWith('/artifacts/') ||
        path.startsWith('opfs:/artifacts/')
      );
    }).length;
    const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
    const score = {
      usefulness: clamp01((summary.successful + artifactWrites + parallelGroups) / (total + 2)),
      safety: clamp01(1 - ((summary.errors * 0.35) + (summary.exclusive * 0.45) + (selfPathWrites * 0.18))),
      reversibility: clamp01(1 - ((selfPathWrites * 0.22) + (summary.exclusive * 0.35)) + (artifactWrites * 0.12)),
      evidence: clamp01((summary.readOnly + artifactWrites) / (total + 1)),
      qAnchor: clamp01(anchorObservations / REQUIRED_ANCHOR_OBSERVATIONS),
      efficiency: clamp01(1 - ((total - 1) / (MAX_BATCH_TOOLS * 2)))
    };
    return Object.fromEntries(
      Object.entries(score).map(([key, value]) => [key, Number(value.toFixed(3))])
    );
  };

  const normalizeAnchorObservation = (observation = {}) => {
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
      return null;
    }
    const verified = observation.verified === true || observation.valid === true;
    if (!verified) return null;
    const id = String(
      observation.id ||
      observation.receiptId ||
      observation.path ||
      observation.provider ||
      ''
    ).trim();
    if (!id) return null;
    return Object.freeze({
      id,
      receiptId: observation.receiptId || id,
      provider: observation.provider || null,
      consumer: observation.consumer || null,
      jobHash: observation.jobHash || null,
      model: observation.model || null,
      timestamp: Number(observation.timestamp || 0) || null,
      path: observation.path || null,
      verified: true
    });
  };

  const normalizeAnchorObservations = (observations = []) => {
    const seen = new Set();
    const normalized = [];
    for (const observation of Array.isArray(observations) ? observations : []) {
      const next = normalizeAnchorObservation(observation);
      if (!next || seen.has(next.id)) continue;
      seen.add(next.id);
      normalized.push(next);
    }
    return normalized;
  };

  const buildRgrCandidateIdentity = ({
    cycle,
    instanceId,
    candidateText,
    summary,
    parentId
  }) => {
    const digest = hashString(stableStringify({
      cycle,
      instanceId,
      candidateText,
      summary,
      parentId
    }));
    return {
      digest,
      id: `rgr-shadow-${cycle}-${digest}`
    };
  };

  const isDominatedBy = (candidateScore = {}, archiveEntry = {}) => {
    const otherScore = archiveEntry.score || {};
    const noWorse = RGR_SCORE_KEYS.every((key) => (
      Number(otherScore[key] || 0) >= Number(candidateScore[key] || 0)
    ));
    const betterSomewhere = RGR_SCORE_KEYS.some((key) => (
      Number(otherScore[key] || 0) > Number(candidateScore[key] || 0)
    ));
    return noWorse && betterSomewhere;
  };

  const evaluatePromotionGate = ({ score, summary, pareto }) => {
    const reasons = [];
    if (summary.errors > 0) {
      reasons.push(`${summary.errors} tool error${summary.errors === 1 ? '' : 's'} present`);
    }
    if (summary.exclusive > 0) {
      reasons.push('exclusive gate/tool request requires independent governance');
    }
    if (score.qAnchor < 1) {
      reasons.push(`missing independent anchor observations (${Math.round(score.qAnchor * REQUIRED_ANCHOR_OBSERVATIONS)}/${REQUIRED_ANCHOR_OBSERVATIONS})`);
    }
    if (!pareto.survives) {
      reasons.push('candidate is Pareto-dominated by the Shadow archive');
    }

    const hardReject = summary.errors > 0 || summary.exclusive > 0 || !pareto.survives;
    let state = reasons.length > 0 ? 'pending-anchors' : 'passed';
    if (hardReject) state = 'rejected';
    return { state, reasons };
  };

  const buildRgrArchiveEntry = ({
    cycle,
    instanceId,
    candidateText,
    entries,
    groups,
    parentId,
    archive,
    anchorObservations = []
  }) => {
    const summary = summarizeToolEntries(entries);
    const verifiedAnchorObservations = normalizeAnchorObservations(anchorObservations);
    const score = scoreRgrCandidate({
      entries,
      groups,
      anchorObservations: verifiedAnchorObservations.length
    });
    const { digest, id } = buildRgrCandidateIdentity({
      cycle,
      instanceId,
      candidateText,
      summary,
      parentId
    });
    const pareto = {
      survives: !archive.some((entry) => isDominatedBy(score, entry)),
      comparedAgainst: archive.length,
      keys: [...RGR_SCORE_KEYS]
    };
    const gate = evaluatePromotionGate({ score, summary, pareto });

    return {
      version: 1,
      id,
      state: 'shadow',
      phase: 'candidate-ring',
      cycle,
      instanceId,
      parentId: parentId || 'seed',
      kind: summary.kind,
      scheduler: {
        mode: getToolBatchMode(groups),
        groups: groups.length,
        parallelGroups: groups.filter((group) => group.mode === 'parallel').length
      },
      summary,
      score,
      pareto,
      gate,
      anchor: {
        required: REQUIRED_ANCHOR_OBSERVATIONS,
        observations: verifiedAnchorObservations,
        qAnchor: score.qAnchor
      },
      validator: {
        state: 'quarantined',
        selfApprovalAllowed: false
      },
      promotion: {
        allowed: gate.state === 'passed',
        boundary: 'Promote is disabled until anchored replay evidence passes.'
      },
      digest
    };
  };
  return { MAX_BATCH_TOOLS, REQUIRED_ANCHOR_OBSERVATIONS, RGR_SCORE_KEYS, clamp01, summarizeToolEntries, normalizeAnchorObservations, buildRgrCandidateIdentity, isDominatedBy, evaluatePromotionGate, buildRgrArchiveEntry };
}

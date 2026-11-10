/** Evidence graph and text search projections over signed records. */
import {
  RESEARCH_RECORD_KINDS
} from '../evidence-record-contract.js';
import {
  compactText,
  unique
} from './primitives.js';
import {
  researchRecordTargetHashes
} from './review-state.js';
import {
  SEQUENCE_ALPHABETS
} from '../../../../shared/pool/sequence-workload.js';
import {
  exactModelContractKey
} from '../../../../shared/pool/model-contract.js';

const researchRecordLabel = (record = {}) => ({
  [RESEARCH_RECORD_KINDS.submission]: record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash,
  [RESEARCH_RECORD_KINDS.result]: record.modelContract?.id,
  [RESEARCH_RECORD_KINDS.claim]: record.claim?.text,
  [RESEARCH_RECORD_KINDS.hypothesis]: record.hypothesis?.statement,
  [RESEARCH_RECORD_KINDS.priorEvidence]: record.evidence?.summary,
  [RESEARCH_RECORD_KINDS.prediction]: record.prediction?.expectedObservation,
  [RESEARCH_RECORD_KINDS.resolutionPolicy]: `${record.policy?.conclusionLabel || 'Resolution'} criteria`,
  [RESEARCH_RECORD_KINDS.workOrder]: record.work?.title,
  [RESEARCH_RECORD_KINDS.workClaim]: record.workClaim?.laboratory?.name,
  [RESEARCH_RECORD_KINDS.outcome]: record.outcome?.summary,
  [RESEARCH_RECORD_KINDS.cohort]: record.cohort?.label,
  [RESEARCH_RECORD_KINDS.evaluation]: record.evaluation?.metricResults?.map((metric) => metric.metricId).join(', '),
  [RESEARCH_RECORD_KINDS.realizedActionValue]: `${record.realizedValue?.assessment?.status || 'Pending'} realized action value`,
  [RESEARCH_RECORD_KINDS.adjudicationExperiment]: `${record.experiment?.target?.catalogId || 'Catalog'} adjudication experiment`,
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: `${record.evaluation?.assessment?.conclusion || 'Pending'} adjudication evaluation`,
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: `${record.checkpoint?.state?.status || 'Open'} Discovery Contract checkpoint`,
  [RESEARCH_RECORD_KINDS.candidateAction]: record.action?.title,
  [RESEARCH_RECORD_KINDS.sequenceLink]: 'DNA-to-protein linkage',
  [RESEARCH_RECORD_KINDS.revocation]: record.revocation?.reason
}[record.kind] || record.recordHash);

export function buildEvidenceGraph(records = []) {
  const nodes = records.map((record) => ({
    id: record.recordHash,
    kind: record.kind,
    label: researchRecordLabel(record),
    record
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const addNode = (node) => {
    if (!node?.id || nodeIds.has(node.id)) return;
    nodes.push(node);
    nodeIds.add(node.id);
  };
  for (const record of records) {
    if (record.author?.roleId) {
      const authorNodeId = `identity:${record.author.roleId}`;
      addNode({
        id: authorNodeId,
        kind: 'participant_identity',
        label: record.author.roleId,
        author: record.author
      });
      edges.push({ from: record.recordHash, to: authorNodeId, relation: 'authored_by' });
    }
    const contract = record.modelContract;
    if (contract?.hash && contract?.manifestHash) {
      // A graph node represents an exact model contract, not a broad checkpoint
      // family. Two tokenizer or execution contracts can share weights and a
      // manifest while still producing incomparable representations.
      const modelNodeId = `model:${exactModelContractKey(contract)}`;
      addNode({
        id: modelNodeId,
        kind: 'model_artifact',
        label: contract.id,
        modelContract: contract
      });
      edges.push({
        from: record.recordHash,
        to: modelNodeId,
        relation: record.kind === RESEARCH_RECORD_KINDS.submission ? 'requests' : 'generated_by'
      });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.submission && record.sequence?.hash) {
      const sequenceNodeId = `sequence:${record.sequence.hash}`;
      addNode({
        id: sequenceNodeId,
        kind: record.sequence.alphabet === SEQUENCE_ALPHABETS.nucleotide ? 'dna_sequence' : 'protein_sequence',
        label: record.sequence.hash,
        sequenceHash: record.sequence.hash,
        sequence: record.sequence.value
      });
      edges.push({ from: record.recordHash, to: sequenceNodeId, relation: 'describes' });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.result && nodeIds.has(record.submissionHash)) {
      edges.push({ from: record.recordHash, to: record.submissionHash, relation: 'derived_from' });
      for (const receiptHash of unique(record.compute?.receiptHashes || [record.compute?.receiptHash])) {
        const receiptNodeId = `receipt:${receiptHash}`;
        addNode({ id: receiptNodeId, kind: 'compute_receipt', label: receiptHash, receiptHash });
        edges.push({ from: record.recordHash, to: receiptNodeId, relation: 'backed_by' });
      }
      if (record.compute?.providerId) {
        const providerNodeId = `provider:${record.compute.providerId}`;
        addNode({ id: providerNodeId, kind: 'compute_provider', label: record.compute.providerId });
        edges.push({ from: record.recordHash, to: providerNodeId, relation: 'produced_by' });
      }
      if (record.compute?.routeDecisionHash) {
        const routeNodeId = `route:${record.compute.routeDecisionHash}`;
        addNode({ id: routeNodeId, kind: 'route_decision', label: record.compute.routeDecisionHash });
        edges.push({ from: record.recordHash, to: routeNodeId, relation: 'routed_by' });
      }
      if (record.compute?.runtimeProfileHash) {
        const runtimeNodeId = `runtime:${record.compute.runtimeProfileHash}`;
        addNode({ id: runtimeNodeId, kind: 'runtime_profile', label: record.compute.runtimeProfileHash });
        edges.push({ from: record.recordHash, to: runtimeNodeId, relation: 'ran_on' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.claim && nodeIds.has(record.targetHash)) {
      edges.push({ from: record.recordHash, to: record.targetHash, relation: record.claim.relation });
    }
    const lifecycleRelation = {
      [RESEARCH_RECORD_KINDS.hypothesis]: 'frames',
      [RESEARCH_RECORD_KINDS.priorEvidence]: 'retrieved_for',
      [RESEARCH_RECORD_KINDS.prediction]: 'predicts',
      [RESEARCH_RECORD_KINDS.resolutionPolicy]: 'governs_resolution_for',
      [RESEARCH_RECORD_KINDS.workOrder]: 'orders',
      [RESEARCH_RECORD_KINDS.workClaim]: 'claims',
      [RESEARCH_RECORD_KINDS.outcome]: record.replicationOfHash ? 'replicates' : 'reports',
      [RESEARCH_RECORD_KINDS.cohort]: 'freezes',
      [RESEARCH_RECORD_KINDS.evaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.realizedActionValue]: 'measures_realized_value_from',
      [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: 'freezes_contract_input',
      [RESEARCH_RECORD_KINDS.candidateAction]: 'proposes_action_for',
      [RESEARCH_RECORD_KINDS.sequenceLink]: 'links_translation',
      [RESEARCH_RECORD_KINDS.revocation]: 'revokes'
    }[record.kind];
    if (lifecycleRelation) {
      for (const targetHash of researchRecordTargetHashes(record)) {
        if (nodeIds.has(targetHash)) edges.push({ from: record.recordHash, to: targetHash, relation: lifecycleRelation });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      for (const inputHash of record.checkpoint?.inputRecordHashes || []) {
        if (nodeIds.has(inputHash)) edges.push({ from: record.recordHash, to: inputHash, relation: 'freezes_contract_archive' });
      }
      for (const parentHash of record.checkpoint?.parentCheckpointHashes || []) {
        if (nodeIds.has(parentHash)) edges.push({ from: record.recordHash, to: parentHash, relation: 'supersedes_checkpoint' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.evidence?.reference) {
      const reference = record.evidence.reference;
      const sourceIdentity = reference.uri || `${reference.accession}@${reference.version}`;
      const sourceNodeId = `source:${sourceIdentity}`;
      addNode({ id: sourceNodeId, kind: 'evidence_source', label: sourceIdentity, ...reference });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'retrieved_from' });
    }
    for (const source of record.claim?.evidenceLinks || []) {
      const sourceNodeId = `source:${source.url}`;
      addNode({
        id: sourceNodeId,
        kind: 'evidence_source',
        label: source.label || source.url,
        url: source.url
      });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'cites' });
    }
  }
  return { nodes, edges };
}

export function searchEvidence(records = [], query = '') {
  const needle = compactText(query).toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) => JSON.stringify({
    sequence: record.sequence?.value,
    intent: record.requesterIntent,
    model: record.modelContract?.id,
    claim: record.claim,
    hypothesis: record.hypothesis,
    evidence: record.evidence,
    prediction: record.prediction,
    work: record.work,
    workClaim: record.workClaim,
    outcome: record.outcome,
    cohort: record.cohort,
    evaluation: record.evaluation,
    action: record.action,
    revocation: record.revocation,
    author: record.author?.roleId
  }).toLowerCase().includes(needle));
}

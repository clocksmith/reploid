/** Conditions, references, protein annotations, public protein evidence, analyses and assay protocols. */
import {
  ANNOTATION_EVIDENCE_KINDS,
  CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
  PROTEIN_ANNOTATION_COORDINATE_SYSTEMS,
  PROTEIN_ANNOTATION_IDENTITY_VERSION,
  PROTEIN_ANNOTATION_SCOPES,
  PUBLIC_FINDING_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_FINDINGS,
  PUBLIC_PROTEIN_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_FAILURE_CATEGORIES
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  compactText,
  normalizeHashList,
  normalizeTextList,
  requireHttpUrl,
  requiredInteger,
  withContentHash
} from './primitives.js';

export const normalizeConditions = (conditions = {}) => {
  const normalized = {
    organism: compactText(conditions.organism, 240),
    biologicalSystem: compactText(conditions.biologicalSystem || conditions.system, 500),
    cellType: compactText(conditions.cellType, 240),
    compartment: compactText(conditions.compartment, 240),
    background: compactText(conditions.background, 500),
    variant: compactText(conditions.variant, 500),
    partners: normalizeTextList(conditions.partners, { max: 32, itemMax: 240 }),
    ligands: normalizeTextList(conditions.ligands, { max: 32, itemMax: 240 }),
    modifications: normalizeTextList(conditions.modifications, { max: 32, itemMax: 240 }),
    concentration: compactText(conditions.concentration, 240),
    temperature: compactText(conditions.temperature, 120),
    pH: compactText(conditions.pH, 120),
    timepoint: compactText(conditions.timepoint, 240),
    notes: compactText(conditions.notes, 2000)
  };
  return normalized;
};

export const conditionsHaveContent = (conditions = {}) => Object.values(conditions).some((value) => (
  Array.isArray(value) ? value.length > 0 : Boolean(value)
));

export const normalizeUncertainty = (uncertainty = {}) => ({
  method: compactText(uncertainty.method, 240),
  value: Number.isFinite(Number(uncertainty.value)) ? Number(uncertainty.value) : null,
  unit: compactText(uncertainty.unit, 120),
  interval: compactText(uncertainty.interval, 240),
  description: compactText(uncertainty.description, 2000)
});

export const normalizeReferenceIdentity = (reference = {}, label = 'reference') => {
  const normalized = {
    uri: compactText(reference.uri || reference.url, 2000),
    accession: compactText(reference.accession, 240),
    version: compactText(reference.version, 240),
    contentHash: compactText(reference.contentHash, 160)
  };
  if (normalized.uri) normalized.uri = requireHttpUrl(normalized.uri, `${label} URI must use http or https`);
  if (!normalized.uri && !normalized.accession) throw new TypeError(`${label} URI or accession is required`);
  if (!normalized.version && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} requires a version or content hash`);
  }
  if (normalized.contentHash && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} content hash must be a SHA-256 identity`);
  }
  return normalized;
};

export const normalizeProteinAnnotationIdentity = async (annotation = {}) => {
  const scope = compactText(annotation.scope || annotation.type, 40).toLowerCase();
  if (!PROTEIN_ANNOTATION_SCOPES.includes(scope)) {
    throw new TypeError('protein annotation scope must be family or domain');
  }
  const ontology = {
    namespace: compactText(annotation.ontology?.namespace, 240),
    termId: compactText(annotation.ontology?.termId || annotation.ontology?.accession, 240),
    version: compactText(annotation.ontology?.version, 240),
    label: compactText(annotation.ontology?.label, 500)
  };
  if (!ontology.namespace || !ontology.termId || !ontology.version) {
    throw new TypeError('protein annotation ontology namespace, term id, and version are required');
  }
  const sequence = {
    hash: compactText(annotation.sequence?.hash || annotation.sequenceHash, 160).toLowerCase(),
    length: requiredInteger(annotation.sequence?.length ?? annotation.sequenceLength, 'protein annotation sequence length')
  };
  if (!SHA256_PATTERN.test(sequence.hash)) throw new TypeError('protein annotation sequence hash must be a SHA-256 identity');
  if (sequence.length < 1) throw new TypeError('protein annotation sequence length must be positive');

  const sourceSystem = compactText(
    annotation.coordinates?.sourceSystem || annotation.coordinates?.system || annotation.coordinateSystem,
    80
  ).toLowerCase();
  if (!PROTEIN_ANNOTATION_COORDINATE_SYSTEMS.includes(sourceSystem)) {
    throw new TypeError('protein annotation source coordinate system is invalid');
  }
  const sourceStart = requiredInteger(
    annotation.coordinates?.sourceStart ?? annotation.coordinates?.start ?? annotation.start,
    'protein annotation coordinate start'
  );
  const sourceEnd = requiredInteger(
    annotation.coordinates?.sourceEnd ?? annotation.coordinates?.end ?? annotation.end,
    'protein annotation coordinate end'
  );
  const start = sourceSystem === 'protein_residue_zero_based_half_open' ? sourceStart + 1 : sourceStart;
  const end = sourceEnd;
  if (sourceSystem === 'protein_residue_zero_based_half_open' && (sourceStart < 0 || sourceEnd <= sourceStart)) {
    throw new TypeError('zero-based half-open protein annotation coordinates are invalid');
  }
  if (sourceSystem === 'protein_residue_one_based_closed' && (sourceStart < 1 || sourceEnd < sourceStart)) {
    throw new TypeError('one-based closed protein annotation coordinates are invalid');
  }
  if (end > sequence.length) throw new TypeError('protein annotation coordinates exceed the bound sequence');
  return withContentHash({
    schema: PROTEIN_ANNOTATION_IDENTITY_VERSION,
    scope,
    ontology,
    sequence,
    coordinates: {
      sourceSystem,
      sourceStart,
      sourceEnd,
      canonicalSystem: CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
      start,
      end
    }
  }, 'identityHash');
};

export const normalizeTransformations = (values = []) => (Array.isArray(values) ? values : []).slice(0, 32).map((value, index) => {
  const normalized = {
    id: compactText(value.id || value.name, 240),
    version: compactText(value.version, 120),
    parametersHash: compactText(value.parametersHash, 160),
    description: compactText(value.description, 1000)
  };
  if (!normalized.id || !normalized.version) throw new TypeError(`transformation ${index + 1} requires id and version`);
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) {
    throw new TypeError(`transformation ${index + 1} parametersHash must be a SHA-256 identity`);
  }
  return normalized;
});

const normalizePublicProteinEvidenceFinding = (evidenceKind, finding = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  const defaults = kind === 'negative_result'
    ? { classification: 'negative', status: 'completed', failureCategory: 'none' }
    : kind === 'failed_attempt'
      ? { classification: 'not_observed', status: 'failed', failureCategory: '' }
      : ['assay'].includes(kind)
        ? { classification: '', status: 'completed', failureCategory: 'none' }
        : { classification: 'not_applicable', status: 'not_applicable', failureCategory: 'none' };
  const normalized = {
    classification: compactText(finding.classification, 40).toLowerCase() || defaults.classification,
    attempt: {
      status: compactText(finding.attempt?.status || finding.attemptStatus, 40).toLowerCase() || defaults.status,
      failureCategory: compactText(
        finding.attempt?.failureCategory || finding.failureCategory,
        80
      ).toLowerCase() || defaults.failureCategory
    }
  };
  if (!PUBLIC_PROTEIN_EVIDENCE_FINDINGS.includes(normalized.classification)) {
    throw new TypeError('public protein evidence finding classification is invalid');
  }
  if (!['not_applicable', 'completed', 'failed'].includes(normalized.attempt.status)) {
    throw new TypeError('public protein evidence attempt status is invalid');
  }
  if (!RESEARCH_FAILURE_CATEGORIES.includes(normalized.attempt.failureCategory)) {
    throw new TypeError('public protein evidence failure category is invalid');
  }
  if (kind === 'assay'
    && (!['positive', 'negative', 'ambiguous'].includes(normalized.classification)
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('assay evidence requires a completed positive, negative, or ambiguous finding');
  }
  if (kind === 'negative_result'
    && (normalized.classification !== 'negative'
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('negative-result evidence requires a completed negative finding');
  }
  if (kind === 'failed_attempt'
    && (normalized.classification !== 'not_observed'
      || normalized.attempt.status !== 'failed'
      || normalized.attempt.failureCategory === 'none')) {
    throw new TypeError('failed-attempt evidence requires a named failure category and no claimed observation');
  }
  if (!PUBLIC_FINDING_EVIDENCE_KINDS.includes(kind)
    && (normalized.classification !== 'not_applicable'
      || normalized.attempt.status !== 'not_applicable'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('non-assay public evidence cannot claim an assay finding');
  }
  return normalized;
};

export const normalizePublicProteinEvidenceProfile = ({
  evidenceKind,
  conditions,
  transformations,
  provenance,
  finding
} = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  if (!PUBLIC_PROTEIN_EVIDENCE_KINDS.includes(kind)) {
    throw new TypeError('public protein evidence kind is not supported');
  }
  if (!conditionsHaveContent(conditions)) {
    throw new TypeError('public protein evidence requires an explicit condition declaration');
  }
  if (!Array.isArray(transformations) || transformations.length === 0) {
    throw new TypeError('public protein evidence requires at least one versioned transformation');
  }
  if (!compactText(provenance?.sourceIdentity, 500)) {
    throw new TypeError('public protein evidence source identity is required');
  }
  if (!compactText(provenance?.license, 240)) {
    throw new TypeError('public protein evidence license is required');
  }
  if (!compactText(provenance?.retrievalMethod, 500)
    || !Number.isFinite(Date.parse(provenance?.retrievedAt || ''))) {
    throw new TypeError('public protein evidence retrieval provenance is incomplete');
  }
  return {
    schema: PUBLIC_PROTEIN_EVIDENCE_VERSION,
    access: 'public',
    finding: normalizePublicProteinEvidenceFinding(kind, finding)
  };
};

/** Re-derives the public profile a signed prior-evidence body declares; throws when it is invalid. */
export const publicProteinEvidenceProfileOf = (evidence, transformations = evidence.transformations) => (
  normalizePublicProteinEvidenceProfile({
    evidenceKind: evidence.kind,
    conditions: evidence.conditions,
    transformations,
    provenance: evidence.provenance,
    finding: evidence.finding
  })
);

/** Whether public prior evidence lacks the annotation identity its kind requires. */
export const annotationIdentityMissing = (evidence) => ANNOTATION_EVIDENCE_KINDS.includes(evidence?.kind) && !evidence?.annotation;

export const normalizeAnalysisIdentity = async (analysis = {}) => {
  const normalized = {
    methodId: compactText(analysis.methodId || analysis.id, 240),
    version: compactText(analysis.version, 120),
    artifactHash: compactText(analysis.artifactHash, 160),
    parametersHash: compactText(analysis.parametersHash, 160),
    runtimeIdentity: compactText(analysis.runtimeIdentity, 500),
    lineageHashes: normalizeHashList(analysis.lineageHashes || [], 'analysis lineage', { max: 64 })
  };
  if (!normalized.methodId || !normalized.version) throw new TypeError('analysis method id and version are required');
  if (normalized.artifactHash && !SHA256_PATTERN.test(normalized.artifactHash)) throw new TypeError('analysis artifactHash must be a SHA-256 identity');
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) throw new TypeError('analysis parametersHash must be a SHA-256 identity');
  return withContentHash(normalized, 'analysisHash');
};

export const normalizeAssayProtocol = async (protocol = {}) => {
  const normalized = {
    protocolId: compactText(protocol.protocolId || protocol.id, 240),
    version: compactText(protocol.version, 120),
    assayType: compactText(protocol.assayType, 240),
    executableUri: compactText(protocol.executableUri, 2000),
    referenceIdentities: (Array.isArray(protocol.referenceIdentities) ? protocol.referenceIdentities : [])
      .slice(0, 32)
      .map((entry, index) => normalizeReferenceIdentity(entry, `protocol reference ${index + 1}`)),
    conditions: normalizeConditions(protocol.conditions),
    controls: normalizeTextList(protocol.controls, { min: 1, max: 32, itemMax: 500, label: 'assay controls' }),
    readouts: normalizeTextList(protocol.readouts, { min: 1, max: 32, itemMax: 500, label: 'assay readouts' }),
    normalization: {
      method: compactText(protocol.normalization?.method, 240),
      version: compactText(protocol.normalization?.version, 120),
      reference: compactText(protocol.normalization?.reference, 500)
    },
    transformations: normalizeTransformations(protocol.transformations),
    uncertaintyPlan: compactText(protocol.uncertaintyPlan, 2000),
    acceptanceCriteria: compactText(protocol.acceptanceCriteria, 2000)
  };
  if (!normalized.protocolId || !normalized.version || !normalized.assayType) {
    throw new TypeError('protocol id, version, and assay type are required');
  }
  if (!conditionsHaveContent(normalized.conditions)) throw new TypeError('protocol conditions are required');
  if (!normalized.normalization.method || !normalized.normalization.version) {
    throw new TypeError('protocol normalization method and version are required');
  }
  if (!normalized.uncertaintyPlan || !normalized.acceptanceCriteria) {
    throw new TypeError('protocol uncertainty plan and acceptance criteria are required');
  }
  if (normalized.executableUri) {
    normalized.executableUri = requireHttpUrl(normalized.executableUri, 'protocol executable URI must use http or https');
  }
  return withContentHash(normalized, 'protocolHash');
};

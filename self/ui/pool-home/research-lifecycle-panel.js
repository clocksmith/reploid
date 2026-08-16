/**
 * @fileoverview Reusable Research Room lifecycle form panel.
 *
 * This module renders existing lifecycle inputs only. Record signing,
 * validation, persistence, hydration, and event binding remain owned by
 * research-view.js and the evidence network.
 */

import { optionList } from './research-panels.js';
import { renderAdjudicationExperimentForms } from './research-adjudication-panel.js';

const candidateCostFields = [
  ['compute', 'Compute', 'gpu-second'],
  ['money', 'Money', 'USD'],
  ['labor', 'Researcher labor', 'person-hour'],
  ['instrument', 'Instrument use', 'instrument-hour'],
  ['sample', 'Samples', 'sample'],
  ['elapsedTime', 'Elapsed time', 'hour']
].map(([name, label, unit]) => `
  <fieldset class="pool-research-cost-component">
    <legend>${label}</legend>
    <div class="pool-research-form-row">
      <label class="pool-field"><span>Amount</span><input name="${name}Amount" type="number" min="0" step="any" value="0" required></label>
      <label class="pool-field"><span>Unit</span><input name="${name}Unit" value="${unit}" required></label>
      <label class="pool-field"><span>Burden (0–5)</span><input name="${name}Burden" type="number" min="0" max="5" step="1" value="0" required></label>
    </div>
  </fieldset>
`).join('');

const renderCandidateActionForm = ({ questions, hypotheses, calibrationCohorts, calibrationEvaluations }) => `
  <section class="pool-research-panel" id="pool-room-candidate-actions">
    <p class="pool-dashboard-kicker">Propose</p>
    <h3 class="type-h3">Governed candidate action</h3>
    <details><summary>Propose a computation, retrieval, review, assay, or replication</summary>
      <form data-research-lifecycle-form data-research-action="candidate-action">
        <p class="type-caption">This creates a signed proposal only. Ranking cannot allocate or execute work, and a different identity must approve the exact contract.</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
          <label class="pool-field"><span>Action kind</span><select name="candidateKind"><option value="computation">Computation</option><option value="retrieval">Retrieval</option><option value="review">Review</option><option value="assay">Assay</option><option value="replication">Replication</option></select></label>
        </div>
        <label class="pool-field"><span>Affected hypotheses</span><select name="affectedHypothesisHashes" multiple size="4" required>${optionList(hypotheses)}</select></label>
        <label class="pool-field"><span>Title</span><input name="candidateTitle" required></label>
        <label class="pool-field"><span>Why this could change the decision</span><textarea name="candidateRationale" rows="3" required></textarea></label>
        <label class="pool-field"><span>Predicted observation</span><textarea name="predictedObservation" rows="2" required></textarea></label>
        <label class="pool-field"><span>Falsifying observation</span><textarea name="falsifyingObservation" rows="2" required></textarea></label>
        <fieldset>
          <legend>Exact protocol or workload</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Contract kind</span><select name="contractKind"><option value="workload">Workload</option><option value="protocol">Protocol</option></select></label>
            <label class="pool-field"><span>Contract id</span><input name="contractId" required></label>
            <label class="pool-field"><span>Version</span><input name="contractVersion" required></label>
          </div>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Artifact hash</span><input name="contractArtifactHash" required placeholder="sha256:..."></label>
            <label class="pool-field"><span>Parameters hash</span><input name="contractParametersHash" required placeholder="sha256:..."></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Uncertainty source and representation</legend>
          <label class="pool-field"><span>Sources (select every applicable category)</span><select name="uncertaintySources" multiple size="6" required><option value="measurement_variance">Measurement variance</option><option value="model_uncertainty">Model uncertainty</option><option value="cross_source_disagreement">Cross-source disagreement</option><option value="missing_alternatives">Missing alternatives</option><option value="protocol_risk">Protocol risk</option><option value="decision_change_uncertainty">Decision-change uncertainty</option></select></label>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Representation</span><select name="uncertaintyRepresentation"><option value="ordinal">Ordinal</option><option value="set_valued">Set-valued</option><option value="probability">Calibrated probability</option></select></label>
            <label class="pool-field"><span>Rationale</span><input name="uncertaintyRationale" required></label>
          </div>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Ordinal level</span><input name="ordinalLevel" value="unknown"></label>
            <label class="pool-field"><span>Ordinal scale id</span><input name="ordinalScaleId" value="poolday.uncertainty.v1"></label>
            <label class="pool-field"><span>Scale version</span><input name="ordinalScaleVersion" value="1.0.0"></label>
          </div>
          <label class="pool-field"><span>Set-valued alternatives, comma separated</span><input name="possibleValues" placeholder="family A, family B, none of the above"></label>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Probability (0–1)</span><input name="uncertaintyProbability" type="number" min="0" max="1" step="any"></label>
            <label class="pool-field"><span>Calibration method</span><input name="calibrationMethodId"></label>
            <label class="pool-field"><span>Method version</span><input name="calibrationMethodVersion"></label>
            <label class="pool-field"><span>Metric id</span><input name="calibrationMetricId"></label>
          </div>
          <label class="pool-field"><span>Independently accepted frozen calibration cohort</span><select name="calibrationCohortHash"><option value="">Required only for a numeric probability</option>${optionList(calibrationCohorts)}</select></label>
        </fieldset>
        <fieldset>
          <legend>Feasibility, independence, safety, and consent</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Feasibility status</span><input name="feasibilityStatus" value="feasible" required></label>
            <label class="pool-field"><span>Required capabilities</span><input name="requiredCapabilities" required placeholder="comma separated"></label>
            <label class="pool-field"><span>Availability</span><input name="availability" required></label>
          </div>
          <label class="pool-field"><span>Materials, comma separated</span><input name="materials"></label>
          <label class="pool-field"><span>Failure risks, comma separated</span><input name="failureRisks" required></label>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Independence dimensions</span><input name="independenceDimensions" required placeholder="provider, source, laboratory"></label>
            <label class="pool-field"><span>Independence exclusions</span><input name="independenceExclusions"></label>
            <label class="pool-field"><span>Minimum independent executions</span><input name="minimumIndependentExecutions" type="number" min="1" max="100" step="1" value="1" required></label>
          </div>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Safety classification</span><input name="safetyClassification" value="public-data-only" required></label>
            <label class="pool-field"><span>Safety requirements</span><input name="safetyRequirements" required></label>
          </div>
          <label class="pool-consent-row"><input name="candidatePublicConsent" type="checkbox" required>Confirm that the sequence and resulting evidence are explicitly public.</label>
          <label class="pool-consent-row"><input name="candidateSafetyReview" type="checkbox" required>Require human safety review before any execution.</label>
        </fieldset>
        <fieldset>
          <legend>Scientific cost vector</legend>
          ${candidateCostFields}
          <label class="pool-field"><span>Cost assumptions, comma separated</span><input name="costAssumptions" required></label>
        </fieldset>
        <fieldset>
          <legend>Declared expected value</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Method id</span><input name="valueMethodId" value="curator-declared-ordinal-value" required></label>
            <label class="pool-field"><span>Version</span><input name="valueMethodVersion" value="1.0.0" required></label>
            <label class="pool-field"><span>Status</span><select name="valueStatus"><option value="heuristic_not_calibrated">Heuristic, not calibrated</option><option value="calibrated">Calibrated</option></select></label>
          </div>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Uncertainty reduction (0–5)</span><input name="uncertaintyReduction" type="number" min="0" max="5" step="1" value="0" required></label>
            <label class="pool-field"><span>Decision relevance (0–5)</span><input name="decisionRelevance" type="number" min="0" max="5" step="1" value="0" required></label>
            <label class="pool-field"><span>Duplicate-work avoidance (0–5)</span><input name="duplicateWorkAvoidance" type="number" min="0" max="5" step="1" value="0" required></label>
          </div>
          <label class="pool-field"><span>Accepted calibration evaluations</span><select name="valueCalibrationEvidenceHashes" multiple size="3">${optionList(calibrationEvaluations)}</select></label>
        </fieldset>
        <button class="btn btn-primary" type="submit"${questions.length && hypotheses.length ? '' : ' disabled'}>Sign candidate action</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
`;

const resolutionRuleFields = (prefix, label, classification) => `
  <fieldset>
    <legend>${label}</legend>
    <div class="pool-research-form-row">
      <label class="pool-field"><span>Mapped outcome</span><select name="${prefix}Classification"><option value="${classification}">${classification}</option><option value="${classification === 'positive' ? 'negative' : 'positive'}">${classification === 'positive' ? 'negative' : 'positive'}</option></select></label>
      <label class="pool-field"><span>Minimum accepted completed outcomes</span><input name="${prefix}MinimumOutcomes" type="number" min="1" max="100" value="2" required></label>
      <label class="pool-field"><span>Minimum independent replications</span><input name="${prefix}MinimumReplications" type="number" min="0" max="100" value="1" required></label>
      <label class="pool-field"><span>Maximum ambiguous outcomes</span><input name="${prefix}MaximumAmbiguous" type="number" min="0" max="100" value="0" required></label>
      <label class="pool-field"><span>Distinct accepting reviewers</span><input name="${prefix}MinimumReviewers" type="number" min="1" max="100" value="1" required></label>
    </div>
    <div class="pool-research-form-row">
      <label class="pool-field"><span>Uncertainty method id</span><input name="${prefix}UncertaintyMethodId" required></label>
      <label class="pool-field"><span>Method version</span><input name="${prefix}UncertaintyVersion" required></label>
      <label class="pool-field"><span>Metric id</span><input name="${prefix}UncertaintyMetricId" required></label>
      <label class="pool-field"><span>Maximum uncertainty</span><input name="${prefix}MaximumUncertainty" type="number" min="0" step="any" required></label>
      <label class="pool-field"><span>Unit</span><input name="${prefix}UncertaintyUnit" required></label>
    </div>
  </fieldset>
`;

export const renderLifecycleForms = ({
  questions = [],
  priorEvidence = [],
  hypotheses = [],
  predictions = [],
  resolutionPolicies = [],
  workOrders = [],
  acceptedWorkOrders = [],
  workClaims = [],
  outcomes = [],
  cohorts = [],
  calibrationCohorts = [],
  calibrationEvaluations = [],
  adjudicationExperiments = [],
  candidateActions = [],
  evaluations = [],
  active = []
} = {}) => `
  <section class="pool-research-panel pool-research-lifecycle-actions">
    <p class="pool-dashboard-kicker">Frame</p>
    <h3 class="type-h3">Competing hypotheses and prior evidence</h3>
    <details><summary>Add versioned prior evidence</summary>
      <form data-research-lifecycle-form data-research-action="prior-evidence">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Evidence kind</span><select name="evidenceKind" data-prior-evidence-kind><option value="sequence">Sequence</option><option value="structure">Structure</option><option value="domain">Domain</option><option value="annotation">Annotation</option><option value="publication">Publication</option><option value="assay">Assay result</option><option value="negative_result">Negative result</option><option value="failed_attempt">Failed attempt</option></select></label>
          <label class="pool-field"><span>Accession</span><input name="accession" placeholder="UniProt or public record identity"></label>
          <label class="pool-field"><span>Version</span><input name="version" required placeholder="record version"></label>
        </div>
        <label class="pool-field"><span>Public source URI</span><input name="uri" type="url" placeholder="https://"></label>
        <label class="pool-field"><span>Source content hash</span><input name="sourceContentHash" pattern="sha256:[a-f0-9]{64}" placeholder="sha256:... (optional exact artifact identity)"></label>
        <label class="pool-field"><span>Declared source license</span><input name="sourceLicense" required placeholder="SPDX identifier or exact source declaration"></label>
        <fieldset class="pool-research-annotation-fields" data-protein-annotation-fields hidden>
          <legend>Normalized family or domain identity</legend>
          <p class="type-caption">Required for automatic cross-room reuse. Enter the source coordinates as published; Reploid also binds a canonical one-based closed interval.</p>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Annotation scope</span><select name="annotationScope" disabled><option value="family">Family</option><option value="domain">Domain</option></select></label>
            <label class="pool-field"><span>Ontology namespace</span><input name="ontologyNamespace" disabled placeholder="declared catalog or ontology"></label>
            <label class="pool-field"><span>Term id</span><input name="ontologyTermId" disabled placeholder="versioned term accession"></label>
            <label class="pool-field"><span>Ontology release</span><input name="ontologyVersion" disabled placeholder="release or version"></label>
          </div>
          <label class="pool-field"><span>Term label</span><input name="ontologyLabel" disabled placeholder="human-readable label (optional)"></label>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Source coordinate system</span><select name="coordinateSystem" disabled><option value="protein_residue_one_based_closed">Protein residues, one-based closed</option><option value="protein_residue_zero_based_half_open">Protein residues, zero-based half-open</option></select></label>
            <label class="pool-field"><span>Source start</span><input name="coordinateStart" type="number" step="1" disabled></label>
            <label class="pool-field"><span>Source end</span><input name="coordinateEnd" type="number" step="1" disabled></label>
          </div>
        </fieldset>
        <fieldset class="pool-research-annotation-fields" data-public-evidence-finding hidden>
          <legend>Imported assay finding</legend>
          <p class="type-caption">Negative and ambiguous findings remain evidence. They do not become biological truth or count as successful replication.</p>
          <label class="pool-field"><span>Finding classification</span><select name="findingClassification" disabled><option value="positive">Positive</option><option value="negative">Negative</option><option value="ambiguous">Ambiguous</option></select></label>
        </fieldset>
        <fieldset class="pool-research-annotation-fields" data-public-evidence-failure hidden>
          <legend>Failed attempt</legend>
          <p class="type-caption">A failed attempt claims no scientific observation. Its failure remains retrievable and does not satisfy a replica target.</p>
          <label class="pool-field"><span>Failure category</span><select name="failureCategory" disabled><option value="expression_failure">Expression failure</option><option value="folding_failure">Folding failure</option><option value="solubility_failure">Solubility failure</option><option value="binding_failure">Binding failure</option><option value="selectivity_failure">Selectivity failure</option><option value="environment_failure">Environment failure</option><option value="protocol_failure">Protocol failure</option><option value="analysis_failure">Analysis failure</option><option value="inconclusive">Inconclusive</option></select></label>
        </fieldset>
        <label class="pool-field"><span>Evidence summary</span><textarea name="summary" rows="3" required></textarea></label>
        <label class="pool-field"><span>Condition-specific context</span><input name="conditions" required placeholder="organism, partners, ligands, modification, environment, time, or explicit not-applicable rationale"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Transformation</span><input name="transformationId" required placeholder="verbatim import, coordinate normalization, or analysis step"></label>
          <label class="pool-field"><span>Transformation version</span><input name="transformationVersion" required placeholder="exact version"></label>
          <label class="pool-field"><span>Parameters hash</span><input name="transformationParametersHash" pattern="sha256:[a-f0-9]{64}" placeholder="sha256:... (optional)"></label>
        </div>
        <label class="pool-field"><span>Transformation description</span><input name="transformationDescription" required placeholder="What changed between the public source and this record?"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Retrieval method</span><input name="retrievalMethod" required placeholder="version-pinned API or archive retrieval"></label>
          <label class="pool-field"><span>Uncertainty</span><input name="uncertainty" placeholder="limitations or confidence basis"></label>
        </div>
        <button class="btn btn-primary" type="submit"${questions.length ? '' : ' disabled'}>Sign prior evidence</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Add a competing condition-specific hypothesis</summary>
      <form data-research-lifecycle-form data-research-action="hypothesis">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <label class="pool-field"><span>Hypothesis</span><textarea name="statement" rows="3" required></textarea></label>
        <label class="pool-field"><span>Declared conditions</span><input name="conditions" required placeholder="partners, ligands, background, environment, and time"></label>
        <label class="pool-field"><span>Discriminating observation</span><input name="discriminator" required placeholder="observation that distinguishes this hypothesis"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Prior evidence</span><select name="priorEvidenceHash"><option value="">None linked yet</option>${optionList(priorEvidence)}</select></label>
          <label class="pool-field"><span>Competes with</span><select name="alternativeToHash"><option value="">First hypothesis</option>${optionList(hypotheses)}</select></label>
        </div>
        <button class="btn btn-primary" type="submit"${questions.length ? '' : ' disabled'}>Sign hypothesis</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Freeze a computational prediction</summary>
      <form data-research-lifecycle-form data-research-action="prediction">
        <label class="pool-field"><span>Hypothesis</span><select name="hypothesisHash" required>${optionList(hypotheses)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Method id</span><input name="methodId" required></label>
          <label class="pool-field"><span>Method version</span><input name="methodVersion" required></label>
          <label class="pool-field"><span>Exact artifact hash</span><input name="artifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Predicted observation</span><textarea name="expectedObservation" rows="2" required></textarea></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Normalized label</span><input name="normalizedLabel" required></label>
          <label class="pool-field"><span>Conditions</span><input name="conditions" required></label>
          <label class="pool-field"><span>Confidence</span><input name="confidence" type="number" min="0" max="1" step="0.01" value="0.5" required></label>
        </div>
        <button class="btn btn-primary" type="submit"${hypotheses.length ? '' : ' disabled'}>Sign and freeze prediction</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Predeclare resolution criteria before work begins</summary>
      <form data-research-lifecycle-form data-research-action="resolution-policy">
        <p class="type-caption">This freezes future eligibility criteria only. It cannot accept, reject, or close a scientific question.</p>
        <label class="pool-field"><span>Target hypothesis</span><select name="resolutionTargetHypothesisHash" required>${optionList(hypotheses)}</select></label>
        <label class="pool-field"><span>Bounded conclusion label</span><input name="resolutionConclusionLabel" required></label>
        <label class="pool-field"><span>Decision scope</span><textarea name="resolutionDecisionScope" rows="2" required></textarea></label>
        ${resolutionRuleFields('acceptance', 'Provisional acceptance eligibility', 'positive')}
        ${resolutionRuleFields('rejection', 'Rejection eligibility', 'negative')}
        <fieldset>
          <legend>Continued uncertainty and reopening</legend>
          <label class="pool-field"><span>Continued-uncertainty triggers, comma separated</span><input name="uncertaintyTriggers" value="insufficient_accepted_outcomes, insufficient_independent_replications, ambiguous_outcome, failed_attempt, disputed_review, active_contradiction, uncertainty_above_threshold, control_failure" required></label>
          <label class="pool-field"><span>Mandatory reopening triggers, comma separated</span><input name="reopeningTriggers" value="contradiction, correction, revocation, failed_replication, policy_invalidation" required></label>
        </fieldset>
        <fieldset>
          <legend>Closure eligibility—not closure authority</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Minimum accepted outcomes</span><input name="closureMinimumOutcomes" type="number" min="1" max="100" value="3" required></label>
            <label class="pool-field"><span>Minimum independent replications</span><input name="closureMinimumReplications" type="number" min="0" max="100" value="2" required></label>
            <label class="pool-field"><span>Maximum ambiguous outcomes</span><input name="closureMaximumAmbiguous" type="number" min="0" max="100" value="0" required></label>
            <label class="pool-field"><span>Distinct accepting reviewers</span><input name="closureMinimumReviewers" type="number" min="2" max="100" value="2" required></label>
          </div>
          <label class="pool-consent-row"><input name="closureControlsPassed" type="checkbox" required>Require every declared control to pass.</label>
          <label class="pool-consent-row"><input name="closureNoDisputedReviews" type="checkbox" required>Require no disputed reviews.</label>
          <label class="pool-consent-row"><input name="closureNoContradictions" type="checkbox" required>Require no active contradictions.</label>
        </fieldset>
        <button class="btn btn-primary" type="submit"${hypotheses.length ? '' : ' disabled'}>Sign frozen criteria</button>
        <p class="type-caption">An independent reviewer must accept these criteria before a governed laboratory can claim work.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  ${renderCandidateActionForm({ questions, hypotheses, calibrationCohorts, calibrationEvaluations })}
  ${renderAdjudicationExperimentForms({ experiments: adjudicationExperiments })}
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Order</p>
    <h3 class="type-h3">Machine-verifiable assay work</h3>
    <details><summary>Propose a discriminating work order</summary>
      <form data-research-lifecycle-form data-research-action="work-order">
        <label class="pool-field"><span>Competing hypotheses</span><select name="hypothesisHashes" multiple size="4" required>${optionList(hypotheses)}</select></label>
        <label class="pool-field"><span>Work order title</span><input name="title" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Protocol id</span><input name="protocolId" required></label>
          <label class="pool-field"><span>Version</span><input name="protocolVersion" required></label>
          <label class="pool-field"><span>Assay type</span><input name="assayType" required></label>
        </div>
        <label class="pool-field"><span>Executable public protocol URI</span><input name="executableUri" type="url" placeholder="https://"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Reference accession</span><input name="referenceAccession" required></label>
          <label class="pool-field"><span>Reference version</span><input name="referenceVersion" required></label>
          <label class="pool-field"><span>Planned replicas</span><input name="replicaTarget" type="number" min="1" max="100" value="2" required></label>
        </div>
        <label class="pool-field"><span>Exact conditions</span><input name="conditions" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Controls, comma separated</span><input name="controls" required></label>
          <label class="pool-field"><span>Readouts, comma separated</span><input name="readouts" required></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Normalization method</span><input name="normalizationMethod" required></label>
          <label class="pool-field"><span>Normalization version</span><input name="normalizationVersion" required></label>
        </div>
        <fieldset>
          <legend>Frozen analysis and failure policy</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Analysis method id</span><input name="workAnalysisMethodId" required></label>
            <label class="pool-field"><span>Analysis version</span><input name="workAnalysisVersion" required></label>
            <label class="pool-field"><span>Analysis artifact hash</span><input name="workAnalysisArtifactHash" required placeholder="sha256:..."></label>
            <label class="pool-field"><span>Analysis parameters hash</span><input name="workAnalysisParametersHash" required placeholder="sha256:..."></label>
          </div>
          <label class="pool-field"><span>Allowed named failure categories, comma separated</span><input name="allowedFailureCategories" required placeholder="expression_failure, protocol_failure, analysis_failure, inconclusive"></label>
        </fieldset>
        <fieldset>
          <legend>Custody before any laboratory claim</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Custody plan id</span><input name="custodyPlanId" required></label>
            <label class="pool-field"><span>Custody plan version</span><input name="custodyPlanVersion" required></label>
            <label class="pool-field"><span>Custody artifact hash</span><input name="custodyArtifactHash" required placeholder="sha256:..."></label>
          </div>
          <label class="pool-field"><span>Permitted protocol-custody roles, comma separated</span><input name="custodyRequiredRoles" value="operator" required></label>
          <label class="pool-field"><span>Required independent replication dimensions, comma separated</span><input name="replicationIndependentDimensions" value="operator_identity, institution, instrument, sample_batch, preparation_batch, analysis_execution" required></label>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Materials custody policy</span><input name="materialsPolicy" required></label>
            <label class="pool-field"><span>Sample custody policy</span><input name="samplesPolicy" required></label>
            <label class="pool-field"><span>Instrument custody policy</span><input name="instrumentsPolicy" required></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Public non-clinical scope</legend>
          <div class="pool-research-form-row">
            <label class="pool-field"><span>Required resources</span><input name="workResources" required></label>
            <label class="pool-field"><span>Biosafety declaration</span><input name="workBiosafety" value="Public, non-pathogenic, non-clinical protocol only." required></label>
            <label class="pool-field"><span>Known limitations</span><input name="workLimitations" required></label>
          </div>
          <label class="pool-consent-row"><input name="scopePublicNonClinical" type="checkbox" required>Use only explicitly public synthetic or public-reference samples under a non-pathogenic, non-clinical protocol.</label>
          <label class="pool-consent-row"><input name="scopeNoAuthority" type="checkbox" required>This order grants no biological-interpretation, medical-use, execution, or laboratory authority.</label>
        </fieldset>
        <label class="pool-field"><span>Uncertainty plan</span><textarea name="uncertaintyPlan" rows="2" required></textarea></label>
        <label class="pool-field"><span>Acceptance criteria</span><textarea name="acceptanceCriteria" rows="2" required></textarea></label>
        <label class="pool-field"><span>Blinded allocation commitment</span><input name="allocationHash" required placeholder="sha256:..."></label>
        <fieldset>
          <legend>Public publication scope</legend>
          <label class="pool-field"><span>Evidence license</span><input name="workPublicationLicense" required></label>
          <label class="pool-consent-row"><input name="publishLaboratoryIdentity" type="checkbox" required>Publish laboratory identity.</label>
          <label class="pool-consent-row"><input name="publishQualification" type="checkbox" required>Publish the signed qualification profile.</label>
          <label class="pool-consent-row"><input name="publishProtocol" type="checkbox" required>Publish the exact protocol.</label>
          <label class="pool-consent-row"><input name="publishRawObservations" type="checkbox" required>Publish raw observations.</label>
          <label class="pool-consent-row"><input name="publishFailures" type="checkbox" required>Publish failed and inconclusive attempts.</label>
        </fieldset>
        <button class="btn btn-primary" type="submit"${hypotheses.length >= 2 ? '' : ' disabled'}>Sign proposed work order</button>
        <p class="type-caption">An independent expert must accept the signed order before a laboratory can claim it.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Claim accepted laboratory work</summary>
      <form data-research-lifecycle-form data-research-action="work-claim">
        <label class="pool-field"><span>Accepted work order</span><select name="workOrderHash" required>${optionList(acceptedWorkOrders, { empty: resolutionPolicies.length ? 'No accepted work orders covered by accepted predeclared criteria' : 'Freeze and independently review resolution criteria before laboratory claims' })}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Laboratory id</span><input name="laboratoryId" required></label>
          <label class="pool-field"><span>Laboratory name</span><input name="laboratoryName" required></label>
          <label class="pool-field"><span>Institution</span><input name="institution" required></label>
          <label class="pool-field"><span>Institution identity hash</span><input name="institutionIdentityHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>ROR or public institution id</span><input name="ror"></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Capability id</span><input name="capabilityId" required></label>
          <label class="pool-field"><span>Capability version</span><input name="capabilityVersion" required></label>
          <label class="pool-field"><span>Capability evidence hash</span><input name="capabilityEvidenceHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Capability description</span><textarea name="capabilityDescription" rows="2" required></textarea></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Protocol-custody role</span><select name="protocolCustodyRole"><option value="operator">Operator</option><option value="owner">Owner</option><option value="licensed_user">Licensed user</option><option value="contracted_executor">Contracted executor</option></select></label>
          <label class="pool-field"><span>Protocol-custody evidence hash</span><input name="protocolCustodyEvidenceHash" required placeholder="sha256:..."></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Safety classification</span><input name="laboratorySafetyClassification" value="public_non_pathogenic_non_clinical" readonly required></label>
          <label class="pool-field"><span>Oversight authority</span><input name="oversightAuthority" required></label>
          <label class="pool-field"><span>Safety approval hash</span><input name="safetyApprovalHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Safety limitations, comma separated</span><input name="safetyLimitations" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Availability</span><select name="laboratoryAvailabilityStatus"><option value="available">Available</option><option value="limited">Limited</option></select></label>
          <label class="pool-field"><span>Declared capacity</span><input name="laboratoryCapacity" required></label>
          <label class="pool-field"><span>Valid from, ISO timestamp</span><input name="laboratoryAvailableFrom" required></label>
          <label class="pool-field"><span>Valid until, ISO timestamp</span><input name="laboratoryAvailableUntil" required></label>
        </div>
        <label class="pool-field"><span>Conflict disclosure</span><textarea name="laboratoryConflictDisclosure" rows="2" required></textarea></label>
        <label class="pool-consent-row"><input name="publicConsent" type="checkbox" required>Publish laboratory attribution, qualification profile, and all positive, negative, ambiguous, or failed outcomes.</label>
        <button class="btn btn-primary" type="submit"${acceptedWorkOrders.length ? '' : ' disabled'}>Sign laboratory claim</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Observe</p>
    <h3 class="type-h3">Blinded outcomes and governed replication claims</h3>
    <form data-research-lifecycle-form data-research-action="outcome">
      <label class="pool-field"><span>Laboratory work claim</span><select name="workClaimHash" required>${optionList(workClaims)}</select></label>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Outcome</span><select name="classification"><option value="positive">Positive</option><option value="negative">Negative</option><option value="ambiguous">Ambiguous</option></select></label>
        <label class="pool-field"><span>Attempt status</span><select name="attemptStatus"><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
        <label class="pool-field"><span>Failure category</span><select name="failureCategory"><option value="none">None</option><option value="expression_failure">Expression failure</option><option value="folding_failure">Folding failure</option><option value="solubility_failure">Solubility failure</option><option value="binding_failure">Binding failure</option><option value="selectivity_failure">Selectivity failure</option><option value="environment_failure">Environment failure</option><option value="protocol_failure">Protocol failure</option><option value="analysis_failure">Analysis failure</option><option value="inconclusive">Inconclusive</option></select></label>
      </div>
      <label class="pool-field"><span>Outcome summary</span><textarea name="summary" rows="3" required></textarea></label>
      <label class="pool-field"><span>Failure detail, if any</span><input name="failureDetail"></label>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Readout</span><input name="readout" required></label>
        <label class="pool-field"><span>Raw value</span><input name="value" type="number" step="any" required></label>
        <label class="pool-field"><span>Normalized value</span><input name="normalizedValue" type="number" step="any" required></label>
        <label class="pool-field"><span>Unit</span><input name="unit" required></label>
        <label class="pool-field"><span>Uncertainty</span><input name="uncertaintyValue" type="number" step="any" min="0" required></label>
      </div>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Analysis id</span><input name="analysisId" required></label>
        <label class="pool-field"><span>Analysis version</span><input name="analysisVersion" required></label>
        <label class="pool-field"><span>Analysis artifact hash</span><input name="analysisArtifactHash" required placeholder="sha256:..."></label>
        <label class="pool-field"><span>Analysis parameters hash</span><input name="analysisParametersHash" required placeholder="sha256:..."></label>
      </div>
      <fieldset>
        <legend>Signed execution context</legend>
        <p class="type-caption">A replication is admitted only when every independence dimension frozen by the work order differs from the original.</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Instrument identity hash</span><input name="instrumentIdentityHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Sample batch hash</span><input name="sampleBatchHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Preparation batch hash</span><input name="preparationBatchHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Analysis execution hash</span><input name="analysisExecutionHash" required placeholder="sha256:..."></label>
        </div>
      </fieldset>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Blind code commitment</span><input name="codeHash" required placeholder="sha256:..."></label>
        <label class="pool-field"><span>Replication of</span><select name="replicationOfHash"><option value="">Original outcome</option>${optionList(outcomes)}</select></label>
      </div>
      <button class="btn btn-primary" type="submit"${workClaims.length ? '' : ' disabled'}>Sign outcome record</button>
      <p class="type-caption">Every attempt uses the same schema. Failures remain evidence and are never discarded.</p>
      <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
    </form>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Measure</p>
    <h3 class="type-h3">Frozen prospective cohorts</h3>
    <details><summary>Freeze a cohort before outcomes arrive</summary>
      <form data-research-lifecycle-form data-research-action="cohort">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <label class="pool-field"><span>Cohort label</span><input name="label" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Metric id</span><input name="metricId" required></label>
          <label class="pool-field"><span>Metric label</span><input name="metricLabel" required></label>
          <label class="pool-field"><span>Direction</span><select name="direction"><option value="higher_is_better">Higher is better</option><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span>Unit</span><input name="unit"></label>
        </div>
        <button class="btn btn-primary" type="submit"${predictions.length && workOrders.length ? '' : ' disabled'}>Sign and freeze cohort</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Evaluate independently accepted outcomes</summary>
      <form data-research-lifecycle-form data-research-action="evaluation">
        <label class="pool-field"><span>Frozen cohort</span><select name="cohortHash" required>${optionList(cohorts)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline value</span><input name="baselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Current value</span><input name="currentValue" type="number" step="any" required></label>
        </div>
        <label class="pool-field"><span>Disagreement summary</span><textarea name="disagreementSummary" rows="2" required></textarea></label>
        <label class="pool-field"><span>Failure analysis</span><textarea name="failureAnalysis" rows="2" required></textarea></label>
        <label class="pool-consent-row"><input name="bindNextCohort" type="checkbox" checked>Bind the measured effect to the same question in the next cohort.</label>
        <button class="btn btn-primary" type="submit"${cohorts.length ? '' : ' disabled'}>Sign measured evaluation</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Measure realized action value</summary>
      <form data-research-lifecycle-form data-research-action="realized-action-value">
        <label class="pool-field"><span>Approved candidate action</span><select name="candidateActionHash" required>${optionList(candidateActions, { empty: 'No independently approved candidate actions' })}</select></label>
        <label class="pool-field"><span>Accepted frozen evaluation</span><select name="evaluationHash" required>${optionList(evaluations, { empty: 'No independently accepted cohort evaluations' })}</select></label>
        <label class="pool-field"><span>Observed decision effect</span><select name="decisionEffect"><option value="changed_decision">Changed the bounded decision</option><option value="narrowed_uncertainty">Narrowed uncertainty</option><option value="blocked_unsafe_or_unjustified_action">Blocked an unsafe or unjustified action</option><option value="unchanged">No decision change</option></select></label>
        <label class="pool-field"><span>Evidence-bound value summary</span><textarea name="realizedValueSummary" rows="3" required></textarea></label>
        <button class="btn btn-primary" type="submit"${candidateActions.length && evaluations.length ? '' : ' disabled'}>Sign realized value record</button>
        <p class="type-caption">The record copies the complete frozen metric vector and binds exact candidate approval, evaluation review, outcome reviews, and causal contributors. No usefulness credit appears until another independent reviewer accepts this record.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Consent</p>
    <h3 class="type-h3">Append-only revocation</h3>
    <form data-research-lifecycle-form data-research-action="revocation">
      <label class="pool-field"><span>Record</span><select name="targetHash" required>${optionList(active)}</select></label>
      <label class="pool-field"><span>Reason</span><textarea name="reason" rows="2" required></textarea></label>
      <button class="btn btn-ghost" type="submit"${active.length ? '' : ' disabled'}>Revoke future reuse</button>
      <p class="type-caption">Only the original identity root can revoke a record. History remains inspectable and dependent projections stop using it.</p>
      <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
    </form>
  </section>
`;

export default { renderLifecycleForms };

/**
 * @fileoverview Forms for the frozen public-protein annotation adjudication proof.
 *
 * This panel collects explicit experiment authority and measurement inputs. It
 * deliberately supplies no default catalog, curator, baseline, or evaluator.
 */

import { optionList } from './research-panels.js';

const campaignMeasurementFields = Object.freeze([
  ['informationGain', 'Information gained per action', 'higher_is_better'],
  ['contradictionCost', 'Contradiction-resolution cost', 'lower_is_better'],
  ['duplicateWork', 'Duplicate work avoided', 'higher_is_better'],
  ['uncertaintyCalibration', 'Uncertainty calibration error', 'lower_is_better'],
  ['heldOutFamily', 'Held-out protein-family performance', 'higher_is_better']
]);

const renderCampaignMetricDefinitions = () => campaignMeasurementFields.map(([prefix, label, direction]) => `
  <p class="pool-dashboard-kicker pool-label pool-muted">${label}</p>
  <div class="pool-research-form-row">
    <label class="pool-field"><span class="pool-small pool-muted">Metric id</span><input name="${prefix}MetricId" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Label</span><input name="${prefix}MetricLabel" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Unit</span><input name="${prefix}MetricUnit" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Direction</span><select name="${prefix}Direction"><option value="${direction}">${direction.replace(/_/g, ' ')}</option></select></label>
    <label class="pool-field"><span class="pool-small pool-muted">Minimum sample</span><input name="${prefix}MinimumSample" type="number" min="2" step="1" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Confidence level</span><input name="${prefix}ConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
  </div>
  <label class="pool-field"><span class="pool-small pool-muted">Measurement source</span><input name="${prefix}MeasurementSource" required></label>
  <label class="pool-field"><span class="pool-small pool-muted">Aggregation rule</span><input name="${prefix}AggregationRule" required></label>
  <label class="pool-field"><span class="pool-small pool-muted">Validity conditions, comma separated</span><input name="${prefix}ValidityConditions" required></label>
  <label class="pool-field"><span class="pool-small pool-muted">Noise model</span><input name="${prefix}NoiseModel" required></label>
`).join('');

const renderCampaignMetricResults = () => campaignMeasurementFields.map(([prefix, label]) => `
  <p class="pool-dashboard-kicker pool-label pool-muted">${label} result</p>
  <div class="pool-research-form-row">
    <label class="pool-field"><span class="pool-small pool-muted">Baseline</span><input name="${prefix}BaselineValue" type="number" step="any" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Candidate</span><input name="${prefix}CandidateValue" type="number" step="any" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval lower</span><input name="${prefix}EffectLower" type="number" step="any" required></label>
    <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval upper</span><input name="${prefix}EffectUpper" type="number" step="any" required></label>
  </div>
`).join('');

export const renderAdjudicationExperimentForms = ({ experiments = [] } = {}) => `
  <section class="pool-research-panel pool-surface pool-research-adjudication-actions">
    <p class="pool-dashboard-kicker pool-label pool-muted">Product proof</p>
    <h3 class="type-h3">Frozen annotation-adjudication comparison</h3>
    <p class="pool-caption">This contract must name the real catalog and curator workflow. It does not infer them from repository code or product copy.</p>
    <details><summary>Freeze the first-market experiment</summary>
      <form data-research-lifecycle-form data-research-action="adjudication-experiment">
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Catalog id</span><input name="catalogId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Catalog version</span><input name="catalogVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Curator role</span><input name="curatorRole" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Recurring family/domain decision</span><textarea name="adjudicationDecision" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Disputed evidence pattern</span><textarea name="disputedEvidencePattern" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Actionable output</span><input name="actionableOutput" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Adopter or payer</span><input name="adopterOrPayer" required></label>

        <p class="pool-dashboard-kicker pool-label pool-muted">Frozen baseline and candidate</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Baseline workflow id</span><input name="baselineWorkflowId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Baseline version</span><input name="baselineVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Baseline revision hash</span><input name="baselineRevisionHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Baseline description</span><textarea name="baselineDescription" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Baseline tools and handoffs, comma separated</span><input name="baselineTools" required></label>
        <p class="pool-dashboard-kicker pool-label pool-muted">Baseline action-selection policy</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Policy id</span><input name="baselinePolicyId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Policy version</span><input name="baselinePolicyVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Policy artifact hash</span><input name="baselinePolicyArtifactHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Input contract hash</span><input name="baselineInputContractHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Budget contract hash</span><input name="baselineBudgetContractHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Ranking status</span><select name="baselineRankingStatus"><option value="heuristic_not_calibrated">Heuristic, not calibrated</option><option value="calibrated">Calibrated</option></select></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Ranking method</span><textarea name="baselineRankingMethod" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Eligible action kinds, comma separated</span><input name="baselineEligibleActionKinds" required placeholder="retrieval, review"></label>
        <label class="pool-field"><span class="pool-small pool-muted">Deterministic tie break, comma separated in order</span><input name="baselineTieBreak" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Stop rule</span><textarea name="baselineStopRule" rows="2" required></textarea></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Candidate policy id</span><input name="candidatePolicyId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate version</span><input name="candidateVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate revision hash</span><input name="candidateRevisionHash" required placeholder="sha256:..."></label>
        </div>

        <p class="pool-dashboard-kicker pool-label pool-muted">Paired family-disjoint cohort</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Cohort accession</span><input name="cohortAccession" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Cohort version</span><input name="cohortVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Cohort manifest hash</span><input name="cohortContentHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Case count</span><input name="cohortCaseCount" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Family split hash</span><input name="familySplitHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Blinded allocation hash</span><input name="allocationHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-consent-row pool-small"><input name="familyDisjoint" type="checkbox" required>Cases are held out and family-disjoint under the declared split.</label>

        <p class="pool-dashboard-kicker pool-label pool-muted">Outcome-access boundary</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Evaluation mode</span><select name="outcomeBoundaryMode"><option value="prospective_future">Prospective future outcomes — unavailable at freeze</option><option value="historical_hidden">Historical hidden outcomes — blinded at freeze</option></select></label>
          <label class="pool-field"><span class="pool-small pool-muted">Evidence cutoff, ISO timestamp</span><input name="outcomeEvidenceCutoffAt" required placeholder="2026-08-15T12:00:00.000Z"></label>
          <label class="pool-field"><span class="pool-small pool-muted">Historical outcome-manifest commitment</span><input name="outcomeManifestCommitmentHash" placeholder="Required only for historical hidden outcomes: sha256:..."></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Outcome reveal rule</span><textarea name="outcomeRevealRule" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Contamination audit method</span><textarea name="contaminationAuditMethod" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Contamination audit artifact hash</span><input name="contaminationAuditArtifactHash" required placeholder="sha256:..."></label>

        <p class="pool-dashboard-kicker pool-label pool-muted">Paired comparison controls</p>
        <label class="pool-consent-row pool-small"><input name="pairedTasks" type="checkbox" required>Baseline and candidate receive the same paired tasks.</label>
        <label class="pool-consent-row pool-small"><input name="sameInputOrder" type="checkbox" required>Baseline and candidate receive the same input order.</label>
        <label class="pool-consent-row pool-small"><input name="sameEvidenceCutoff" type="checkbox" required>Baseline and candidate use the same frozen evidence cutoff.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Resource budget hash</span><input name="comparisonResourceBudgetHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Failure policy hash</span><input name="comparisonFailurePolicyHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Timeout policy hash</span><input name="comparisonTimeoutPolicyHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Seed manifest hash</span><input name="comparisonSeedManifestHash" required placeholder="sha256:..."></label>
        </div>

        <p class="pool-dashboard-kicker pool-label pool-muted">Independent evaluator</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Evaluator authority</span><input name="evaluatorAuthority" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Evaluator identity root id</span><input name="evaluatorIdentityRootId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Evaluator method id</span><input name="evaluatorMethodId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Evaluator version</span><input name="evaluatorVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Evaluator artifact hash</span><input name="evaluatorArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-consent-row pool-small"><input name="evaluatorBlinded" type="checkbox" required>The evaluator is blinded to baseline/candidate assignment.</label>

        <p class="pool-dashboard-kicker pool-label pool-muted">Quality metric</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Quality metric id</span><input name="qualityMetricId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Label</span><input name="qualityMetricLabel" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Unit</span><input name="qualityMetricUnit" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Direction</span><select name="qualityDirection"><option value="higher_is_better">Higher is better</option><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum sample</span><input name="qualityMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Confidence level</span><input name="qualityConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Measurement source</span><input name="qualityMeasurementSource" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Aggregation rule</span><input name="qualityAggregationRule" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Validity conditions, comma separated</span><input name="qualityValidityConditions" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Noise model</span><input name="qualityNoiseModel" required></label>

        <p class="pool-dashboard-kicker pool-label pool-muted">Effort metric</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Effort metric id</span><input name="effortMetricId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Label</span><input name="effortMetricLabel" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Unit</span><input name="effortMetricUnit" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Direction</span><select name="effortDirection"><option value="lower_is_better">Lower is better</option><option value="higher_is_better">Higher is better</option></select></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum sample</span><input name="effortMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Confidence level</span><input name="effortConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Measurement source</span><input name="effortMeasurementSource" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Aggregation rule</span><input name="effortAggregationRule" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Validity conditions, comma separated</span><input name="effortValidityConditions" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Noise model</span><input name="effortNoiseModel" required></label>

        <p class="pool-caption">The supporting campaign measures remain a five-dimensional tradeoff vector. They cannot be collapsed into quality, effort, or one fitness score.</p>
        ${renderCampaignMetricDefinitions()}

        <p class="pool-dashboard-kicker pool-label pool-muted">Frozen north-star cost</p>
        <p class="pool-caption">This eighth metric is the paired median normalized cost to a predeclared independently replicated conclusion. Peer and activity counters cannot satisfy it.</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">North-star metric id</span><input name="northStarMetricId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Label</span><input name="northStarMetricLabel" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Normalized cost unit</span><input name="northStarMetricUnit" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Direction</span><select name="northStarDirection"><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum sample</span><input name="northStarMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Confidence level</span><input name="northStarConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Measurement source</span><input name="northStarMeasurementSource" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Aggregation rule</span><input name="northStarAggregationRule" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Validity conditions, comma separated</span><input name="northStarValidityConditions" required></label>
        <label class="pool-field"><span class="pool-small pool-muted">Noise model</span><input name="northStarNoiseModel" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Cost conversion policy id</span><input name="costConversionPolicyId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Cost conversion version</span><input name="costConversionPolicyVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Cost conversion artifact hash</span><input name="costConversionArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Cost stop rule</span><textarea name="northStarCostStopRule" rows="2" required></textarea></label>
        <label class="pool-consent-row pool-small"><input name="rawCostUnitsPreserved" type="checkbox" required>Raw compute, money, labor, instrument, sample, and elapsed-time amounts remain in their original units.</label>
        <label class="pool-consent-row pool-small"><input name="failedAttemptsIncluded" type="checkbox" required>Failed attempts remain charged.</label>
        <label class="pool-consent-row pool-small"><input name="unresolvedCasesIncluded" type="checkbox" required>Unresolved cases remain charged.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Conclusion policy id</span><input name="conclusionPolicyId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Conclusion policy version</span><input name="conclusionPolicyVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Conclusion policy artifact hash</span><input name="conclusionPolicyArtifactHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum independent replications</span><input name="minimumIndependentReplications" type="number" min="1" step="1" required></label>
        </div>
        <label class="pool-consent-row pool-small"><input name="conclusionFrozenBeforeActions" type="checkbox" required>Conclusion criteria are frozen before actions.</label>
        <label class="pool-consent-row pool-small"><input name="conclusionIndependentAcceptance" type="checkbox" required>Conclusion evidence requires independent acceptance.</label>
        <label class="pool-consent-row pool-small"><input name="conclusionIndependentReplication" type="checkbox" required>Conclusion evidence requires independent replication.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Independence policy id</span><input name="independencePolicyId" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Independence policy version</span><input name="independencePolicyVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Independence policy artifact hash</span><input name="independencePolicyArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Required independence dimensions, comma separated</span><input name="northStarIndependenceDimensions" required placeholder="reviewer_identity, evidence_source"></label>
        <label class="pool-consent-row pool-small"><input name="evaluatorExcludedFromCaseEvidence" type="checkbox" required>The evaluator contributes no case evidence.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Paired interval method</span><input name="northStarIntervalMethod" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum paired cases</span><input name="northStarMinimumPairedCases" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Aggregation confidence</span><input name="northStarAggregationConfidence" type="number" min="0.01" max="1" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Minimum cost improvement</span><input name="northStarMinimumImprovement" type="number" min="0" step="any" required></label>
        </div>

        <p class="pool-dashboard-kicker pool-label pool-muted">Frozen success rule</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Quality improvement threshold</span><input name="qualityImprovementThreshold" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Quality non-inferiority margin</span><input name="qualityNonInferiorityMargin" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Effort improvement threshold</span><input name="effortImprovementThreshold" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Effort comparability margin</span><input name="effortComparabilityMargin" type="number" min="0" step="any" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Acceptance rule</span><textarea name="experimentAcceptanceRule" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Rejection rule</span><textarea name="experimentRejectionRule" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Reopening rule</span><textarea name="experimentReopeningRule" rows="2" required></textarea></label>
        <button class="btn btn-primary" type="submit">Sign and freeze adjudication experiment</button>
        <p class="pool-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>

    <details><summary>Evaluate an accepted frozen experiment</summary>
      <form data-research-lifecycle-form data-research-action="adjudication-evaluation">
        <label class="pool-field"><span class="pool-small pool-muted">Frozen experiment</span><select name="adjudicationExperimentHash" required>${optionList(experiments, { empty: 'No frozen experiment available' })}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Result manifest accession</span><input name="resultManifestAccession" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Result manifest version</span><input name="resultManifestVersion" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Result manifest hash</span><input name="resultManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Paired sample count</span><input name="pairedSampleCount" type="number" min="1" step="1" required></label>
        </div>
        <p class="pool-dashboard-kicker pool-label pool-muted">Quality result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Baseline</span><input name="qualityBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate</span><input name="qualityCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval lower</span><input name="qualityEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval upper</span><input name="qualityEffectUpper" type="number" step="any" required></label>
        </div>
        <p class="pool-dashboard-kicker pool-label pool-muted">Effort result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Baseline</span><input name="effortBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate</span><input name="effortCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval lower</span><input name="effortEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval upper</span><input name="effortEffectUpper" type="number" step="any" required></label>
        </div>
        ${renderCampaignMetricResults()}
        <p class="pool-dashboard-kicker pool-label pool-muted">North-star result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Baseline median normalized cost</span><input name="northStarBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate median normalized cost</span><input name="northStarCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval lower</span><input name="northStarEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Oriented effect interval upper</span><input name="northStarEffectUpper" type="number" step="any" required></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Case evidence manifest hash</span><input name="northStarCaseEvidenceManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Raw cost manifest hash</span><input name="northStarRawCostManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Conclusion audit manifest hash</span><input name="northStarConclusionAuditHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Independence audit manifest hash</span><input name="northStarIndependenceAuditHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span class="pool-small pool-muted">Conversion audit artifact hash</span><input name="northStarConversionAuditHash" required placeholder="sha256:..."></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Baseline observed cases</span><input name="northStarBaselineObservedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Baseline replicated conclusions</span><input name="northStarBaselineReplicatedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate observed cases</span><input name="northStarCandidateObservedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Candidate replicated conclusions</span><input name="northStarCandidateReplicatedCases" type="number" min="0" step="1" required></label>
        </div>
        <label class="pool-consent-row pool-small"><input name="northStarAllCasesIncluded" type="checkbox">Every frozen case is included.</label>
        <label class="pool-consent-row pool-small"><input name="northStarRealWorldObserved" type="checkbox">Costs and conclusions were observed in the declared real workflow.</label>
        <label class="pool-consent-row pool-small"><input name="northStarCriteriaPredatedOutcomes" type="checkbox">Criteria were applied before outcome access.</label>
        <label class="pool-consent-row pool-small"><input name="northStarOperationalMetricsExcluded" type="checkbox">Peers, jobs, receipts, records, claims, and total compute were excluded from success.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span class="pool-small pool-muted">Regression count</span><input name="adjudicationRegressionCount" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span class="pool-small pool-muted">Missing case count</span><input name="adjudicationMissingCaseCount" type="number" min="0" step="1" required></label>
        </div>
        <label class="pool-field"><span class="pool-small pool-muted">Disagreement summary</span><textarea name="adjudicationDisagreementSummary" rows="2" required></textarea></label>
        <label class="pool-field"><span class="pool-small pool-muted">Failure analysis</span><textarea name="adjudicationFailureAnalysis" rows="2" required></textarea></label>
        <button class="btn btn-primary" type="submit"${experiments.length ? '' : ' disabled'}>Sign paired adjudication evaluation</button>
        <p class="pool-caption">The conclusion is derived from the frozen thresholds; the evaluator cannot select it.</p>
        <p class="pool-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
`;

export default { renderAdjudicationExperimentForms };

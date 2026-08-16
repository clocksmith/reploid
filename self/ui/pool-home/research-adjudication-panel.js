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
  <p class="pool-dashboard-kicker">${label}</p>
  <div class="pool-research-form-row">
    <label class="pool-field"><span>Metric id</span><input name="${prefix}MetricId" required></label>
    <label class="pool-field"><span>Label</span><input name="${prefix}MetricLabel" required></label>
    <label class="pool-field"><span>Unit</span><input name="${prefix}MetricUnit" required></label>
    <label class="pool-field"><span>Direction</span><select name="${prefix}Direction"><option value="${direction}">${direction.replace(/_/g, ' ')}</option></select></label>
    <label class="pool-field"><span>Minimum sample</span><input name="${prefix}MinimumSample" type="number" min="2" step="1" required></label>
    <label class="pool-field"><span>Confidence level</span><input name="${prefix}ConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
  </div>
  <label class="pool-field"><span>Measurement source</span><input name="${prefix}MeasurementSource" required></label>
  <label class="pool-field"><span>Aggregation rule</span><input name="${prefix}AggregationRule" required></label>
  <label class="pool-field"><span>Validity conditions, comma separated</span><input name="${prefix}ValidityConditions" required></label>
  <label class="pool-field"><span>Noise model</span><input name="${prefix}NoiseModel" required></label>
`).join('');

const renderCampaignMetricResults = () => campaignMeasurementFields.map(([prefix, label]) => `
  <p class="pool-dashboard-kicker">${label} result</p>
  <div class="pool-research-form-row">
    <label class="pool-field"><span>Baseline</span><input name="${prefix}BaselineValue" type="number" step="any" required></label>
    <label class="pool-field"><span>Candidate</span><input name="${prefix}CandidateValue" type="number" step="any" required></label>
    <label class="pool-field"><span>Oriented effect interval lower</span><input name="${prefix}EffectLower" type="number" step="any" required></label>
    <label class="pool-field"><span>Oriented effect interval upper</span><input name="${prefix}EffectUpper" type="number" step="any" required></label>
  </div>
`).join('');

export const renderAdjudicationExperimentForms = ({ experiments = [] } = {}) => `
  <section class="pool-research-panel pool-research-adjudication-actions">
    <p class="pool-dashboard-kicker">Product proof</p>
    <h3 class="type-h3">Frozen annotation-adjudication comparison</h3>
    <p class="type-caption">This contract must name the real catalog and curator workflow. It does not infer them from repository code or product copy.</p>
    <details><summary>Freeze the first-market experiment</summary>
      <form data-research-lifecycle-form data-research-action="adjudication-experiment">
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Catalog id</span><input name="catalogId" required></label>
          <label class="pool-field"><span>Catalog version</span><input name="catalogVersion" required></label>
          <label class="pool-field"><span>Curator role</span><input name="curatorRole" required></label>
        </div>
        <label class="pool-field"><span>Recurring family/domain decision</span><textarea name="adjudicationDecision" rows="2" required></textarea></label>
        <label class="pool-field"><span>Disputed evidence pattern</span><textarea name="disputedEvidencePattern" rows="2" required></textarea></label>
        <label class="pool-field"><span>Actionable output</span><input name="actionableOutput" required></label>
        <label class="pool-field"><span>Adopter or payer</span><input name="adopterOrPayer" required></label>

        <p class="pool-dashboard-kicker">Frozen baseline and candidate</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline workflow id</span><input name="baselineWorkflowId" required></label>
          <label class="pool-field"><span>Baseline version</span><input name="baselineVersion" required></label>
          <label class="pool-field"><span>Baseline revision hash</span><input name="baselineRevisionHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Baseline description</span><textarea name="baselineDescription" rows="2" required></textarea></label>
        <label class="pool-field"><span>Baseline tools and handoffs, comma separated</span><input name="baselineTools" required></label>
        <p class="pool-dashboard-kicker">Baseline action-selection policy</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Policy id</span><input name="baselinePolicyId" required></label>
          <label class="pool-field"><span>Policy version</span><input name="baselinePolicyVersion" required></label>
          <label class="pool-field"><span>Policy artifact hash</span><input name="baselinePolicyArtifactHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Input contract hash</span><input name="baselineInputContractHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Budget contract hash</span><input name="baselineBudgetContractHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Ranking status</span><select name="baselineRankingStatus"><option value="heuristic_not_calibrated">Heuristic, not calibrated</option><option value="calibrated">Calibrated</option></select></label>
        </div>
        <label class="pool-field"><span>Ranking method</span><textarea name="baselineRankingMethod" rows="2" required></textarea></label>
        <label class="pool-field"><span>Eligible action kinds, comma separated</span><input name="baselineEligibleActionKinds" required placeholder="retrieval, review"></label>
        <label class="pool-field"><span>Deterministic tie break, comma separated in order</span><input name="baselineTieBreak" required></label>
        <label class="pool-field"><span>Stop rule</span><textarea name="baselineStopRule" rows="2" required></textarea></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Candidate policy id</span><input name="candidatePolicyId" required></label>
          <label class="pool-field"><span>Candidate version</span><input name="candidateVersion" required></label>
          <label class="pool-field"><span>Candidate revision hash</span><input name="candidateRevisionHash" required placeholder="sha256:..."></label>
        </div>

        <p class="pool-dashboard-kicker">Paired family-disjoint cohort</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Cohort accession</span><input name="cohortAccession" required></label>
          <label class="pool-field"><span>Cohort version</span><input name="cohortVersion" required></label>
          <label class="pool-field"><span>Cohort manifest hash</span><input name="cohortContentHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Case count</span><input name="cohortCaseCount" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span>Family split hash</span><input name="familySplitHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Blinded allocation hash</span><input name="allocationHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-consent-row"><input name="familyDisjoint" type="checkbox" required>Cases are held out and family-disjoint under the declared split.</label>

        <p class="pool-dashboard-kicker">Outcome-access boundary</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Evaluation mode</span><select name="outcomeBoundaryMode"><option value="prospective_future">Prospective future outcomes — unavailable at freeze</option><option value="historical_hidden">Historical hidden outcomes — blinded at freeze</option></select></label>
          <label class="pool-field"><span>Evidence cutoff, ISO timestamp</span><input name="outcomeEvidenceCutoffAt" required placeholder="2026-08-15T12:00:00.000Z"></label>
          <label class="pool-field"><span>Historical outcome-manifest commitment</span><input name="outcomeManifestCommitmentHash" placeholder="Required only for historical hidden outcomes: sha256:..."></label>
        </div>
        <label class="pool-field"><span>Outcome reveal rule</span><textarea name="outcomeRevealRule" rows="2" required></textarea></label>
        <label class="pool-field"><span>Contamination audit method</span><textarea name="contaminationAuditMethod" rows="2" required></textarea></label>
        <label class="pool-field"><span>Contamination audit artifact hash</span><input name="contaminationAuditArtifactHash" required placeholder="sha256:..."></label>

        <p class="pool-dashboard-kicker">Paired comparison controls</p>
        <label class="pool-consent-row"><input name="pairedTasks" type="checkbox" required>Baseline and candidate receive the same paired tasks.</label>
        <label class="pool-consent-row"><input name="sameInputOrder" type="checkbox" required>Baseline and candidate receive the same input order.</label>
        <label class="pool-consent-row"><input name="sameEvidenceCutoff" type="checkbox" required>Baseline and candidate use the same frozen evidence cutoff.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Resource budget hash</span><input name="comparisonResourceBudgetHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Failure policy hash</span><input name="comparisonFailurePolicyHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Timeout policy hash</span><input name="comparisonTimeoutPolicyHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Seed manifest hash</span><input name="comparisonSeedManifestHash" required placeholder="sha256:..."></label>
        </div>

        <p class="pool-dashboard-kicker">Independent evaluator</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Evaluator authority</span><input name="evaluatorAuthority" required></label>
          <label class="pool-field"><span>Evaluator identity root id</span><input name="evaluatorIdentityRootId" required></label>
          <label class="pool-field"><span>Evaluator method id</span><input name="evaluatorMethodId" required></label>
          <label class="pool-field"><span>Evaluator version</span><input name="evaluatorVersion" required></label>
          <label class="pool-field"><span>Evaluator artifact hash</span><input name="evaluatorArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-consent-row"><input name="evaluatorBlinded" type="checkbox" required>The evaluator is blinded to baseline/candidate assignment.</label>

        <p class="pool-dashboard-kicker">Quality metric</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Quality metric id</span><input name="qualityMetricId" required></label>
          <label class="pool-field"><span>Label</span><input name="qualityMetricLabel" required></label>
          <label class="pool-field"><span>Unit</span><input name="qualityMetricUnit" required></label>
          <label class="pool-field"><span>Direction</span><select name="qualityDirection"><option value="higher_is_better">Higher is better</option><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span>Minimum sample</span><input name="qualityMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span>Confidence level</span><input name="qualityConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span>Measurement source</span><input name="qualityMeasurementSource" required></label>
        <label class="pool-field"><span>Aggregation rule</span><input name="qualityAggregationRule" required></label>
        <label class="pool-field"><span>Validity conditions, comma separated</span><input name="qualityValidityConditions" required></label>
        <label class="pool-field"><span>Noise model</span><input name="qualityNoiseModel" required></label>

        <p class="pool-dashboard-kicker">Effort metric</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Effort metric id</span><input name="effortMetricId" required></label>
          <label class="pool-field"><span>Label</span><input name="effortMetricLabel" required></label>
          <label class="pool-field"><span>Unit</span><input name="effortMetricUnit" required></label>
          <label class="pool-field"><span>Direction</span><select name="effortDirection"><option value="lower_is_better">Lower is better</option><option value="higher_is_better">Higher is better</option></select></label>
          <label class="pool-field"><span>Minimum sample</span><input name="effortMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span>Confidence level</span><input name="effortConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span>Measurement source</span><input name="effortMeasurementSource" required></label>
        <label class="pool-field"><span>Aggregation rule</span><input name="effortAggregationRule" required></label>
        <label class="pool-field"><span>Validity conditions, comma separated</span><input name="effortValidityConditions" required></label>
        <label class="pool-field"><span>Noise model</span><input name="effortNoiseModel" required></label>

        <p class="type-caption">The supporting campaign measures remain a five-dimensional tradeoff vector. They cannot be collapsed into quality, effort, or one fitness score.</p>
        ${renderCampaignMetricDefinitions()}

        <p class="pool-dashboard-kicker">Frozen north-star cost</p>
        <p class="type-caption">This eighth metric is the paired median normalized cost to a predeclared independently replicated conclusion. Peer and activity counters cannot satisfy it.</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>North-star metric id</span><input name="northStarMetricId" required></label>
          <label class="pool-field"><span>Label</span><input name="northStarMetricLabel" required></label>
          <label class="pool-field"><span>Normalized cost unit</span><input name="northStarMetricUnit" required></label>
          <label class="pool-field"><span>Direction</span><select name="northStarDirection"><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span>Minimum sample</span><input name="northStarMinimumSample" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span>Confidence level</span><input name="northStarConfidenceLevel" type="number" min="0.01" max="1" step="any" required></label>
        </div>
        <label class="pool-field"><span>Measurement source</span><input name="northStarMeasurementSource" required></label>
        <label class="pool-field"><span>Aggregation rule</span><input name="northStarAggregationRule" required></label>
        <label class="pool-field"><span>Validity conditions, comma separated</span><input name="northStarValidityConditions" required></label>
        <label class="pool-field"><span>Noise model</span><input name="northStarNoiseModel" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Cost conversion policy id</span><input name="costConversionPolicyId" required></label>
          <label class="pool-field"><span>Cost conversion version</span><input name="costConversionPolicyVersion" required></label>
          <label class="pool-field"><span>Cost conversion artifact hash</span><input name="costConversionArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Cost stop rule</span><textarea name="northStarCostStopRule" rows="2" required></textarea></label>
        <label class="pool-consent-row"><input name="rawCostUnitsPreserved" type="checkbox" required>Raw compute, money, labor, instrument, sample, and elapsed-time amounts remain in their original units.</label>
        <label class="pool-consent-row"><input name="failedAttemptsIncluded" type="checkbox" required>Failed attempts remain charged.</label>
        <label class="pool-consent-row"><input name="unresolvedCasesIncluded" type="checkbox" required>Unresolved cases remain charged.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Conclusion policy id</span><input name="conclusionPolicyId" required></label>
          <label class="pool-field"><span>Conclusion policy version</span><input name="conclusionPolicyVersion" required></label>
          <label class="pool-field"><span>Conclusion policy artifact hash</span><input name="conclusionPolicyArtifactHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Minimum independent replications</span><input name="minimumIndependentReplications" type="number" min="1" step="1" required></label>
        </div>
        <label class="pool-consent-row"><input name="conclusionFrozenBeforeActions" type="checkbox" required>Conclusion criteria are frozen before actions.</label>
        <label class="pool-consent-row"><input name="conclusionIndependentAcceptance" type="checkbox" required>Conclusion evidence requires independent acceptance.</label>
        <label class="pool-consent-row"><input name="conclusionIndependentReplication" type="checkbox" required>Conclusion evidence requires independent replication.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Independence policy id</span><input name="independencePolicyId" required></label>
          <label class="pool-field"><span>Independence policy version</span><input name="independencePolicyVersion" required></label>
          <label class="pool-field"><span>Independence policy artifact hash</span><input name="independencePolicyArtifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Required independence dimensions, comma separated</span><input name="northStarIndependenceDimensions" required placeholder="reviewer_identity, evidence_source"></label>
        <label class="pool-consent-row"><input name="evaluatorExcludedFromCaseEvidence" type="checkbox" required>The evaluator contributes no case evidence.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Paired interval method</span><input name="northStarIntervalMethod" required></label>
          <label class="pool-field"><span>Minimum paired cases</span><input name="northStarMinimumPairedCases" type="number" min="2" step="1" required></label>
          <label class="pool-field"><span>Aggregation confidence</span><input name="northStarAggregationConfidence" type="number" min="0.01" max="1" step="any" required></label>
          <label class="pool-field"><span>Minimum cost improvement</span><input name="northStarMinimumImprovement" type="number" min="0" step="any" required></label>
        </div>

        <p class="pool-dashboard-kicker">Frozen success rule</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Quality improvement threshold</span><input name="qualityImprovementThreshold" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span>Quality non-inferiority margin</span><input name="qualityNonInferiorityMargin" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span>Effort improvement threshold</span><input name="effortImprovementThreshold" type="number" min="0" step="any" required></label>
          <label class="pool-field"><span>Effort comparability margin</span><input name="effortComparabilityMargin" type="number" min="0" step="any" required></label>
        </div>
        <label class="pool-field"><span>Acceptance rule</span><textarea name="experimentAcceptanceRule" rows="2" required></textarea></label>
        <label class="pool-field"><span>Rejection rule</span><textarea name="experimentRejectionRule" rows="2" required></textarea></label>
        <label class="pool-field"><span>Reopening rule</span><textarea name="experimentReopeningRule" rows="2" required></textarea></label>
        <button class="btn btn-primary" type="submit">Sign and freeze adjudication experiment</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>

    <details><summary>Evaluate an accepted frozen experiment</summary>
      <form data-research-lifecycle-form data-research-action="adjudication-evaluation">
        <label class="pool-field"><span>Frozen experiment</span><select name="adjudicationExperimentHash" required>${optionList(experiments, { empty: 'No frozen experiment available' })}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Result manifest accession</span><input name="resultManifestAccession" required></label>
          <label class="pool-field"><span>Result manifest version</span><input name="resultManifestVersion" required></label>
          <label class="pool-field"><span>Result manifest hash</span><input name="resultManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Paired sample count</span><input name="pairedSampleCount" type="number" min="1" step="1" required></label>
        </div>
        <p class="pool-dashboard-kicker">Quality result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline</span><input name="qualityBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Candidate</span><input name="qualityCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval lower</span><input name="qualityEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval upper</span><input name="qualityEffectUpper" type="number" step="any" required></label>
        </div>
        <p class="pool-dashboard-kicker">Effort result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline</span><input name="effortBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Candidate</span><input name="effortCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval lower</span><input name="effortEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval upper</span><input name="effortEffectUpper" type="number" step="any" required></label>
        </div>
        ${renderCampaignMetricResults()}
        <p class="pool-dashboard-kicker">North-star result</p>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline median normalized cost</span><input name="northStarBaselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Candidate median normalized cost</span><input name="northStarCandidateValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval lower</span><input name="northStarEffectLower" type="number" step="any" required></label>
          <label class="pool-field"><span>Oriented effect interval upper</span><input name="northStarEffectUpper" type="number" step="any" required></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Case evidence manifest hash</span><input name="northStarCaseEvidenceManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Raw cost manifest hash</span><input name="northStarRawCostManifestHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Conclusion audit manifest hash</span><input name="northStarConclusionAuditHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Independence audit manifest hash</span><input name="northStarIndependenceAuditHash" required placeholder="sha256:..."></label>
          <label class="pool-field"><span>Conversion audit artifact hash</span><input name="northStarConversionAuditHash" required placeholder="sha256:..."></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline observed cases</span><input name="northStarBaselineObservedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span>Baseline replicated conclusions</span><input name="northStarBaselineReplicatedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span>Candidate observed cases</span><input name="northStarCandidateObservedCases" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span>Candidate replicated conclusions</span><input name="northStarCandidateReplicatedCases" type="number" min="0" step="1" required></label>
        </div>
        <label class="pool-consent-row"><input name="northStarAllCasesIncluded" type="checkbox">Every frozen case is included.</label>
        <label class="pool-consent-row"><input name="northStarRealWorldObserved" type="checkbox">Costs and conclusions were observed in the declared real workflow.</label>
        <label class="pool-consent-row"><input name="northStarCriteriaPredatedOutcomes" type="checkbox">Criteria were applied before outcome access.</label>
        <label class="pool-consent-row"><input name="northStarOperationalMetricsExcluded" type="checkbox">Peers, jobs, receipts, records, claims, and total compute were excluded from success.</label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Regression count</span><input name="adjudicationRegressionCount" type="number" min="0" step="1" required></label>
          <label class="pool-field"><span>Missing case count</span><input name="adjudicationMissingCaseCount" type="number" min="0" step="1" required></label>
        </div>
        <label class="pool-field"><span>Disagreement summary</span><textarea name="adjudicationDisagreementSummary" rows="2" required></textarea></label>
        <label class="pool-field"><span>Failure analysis</span><textarea name="adjudicationFailureAnalysis" rows="2" required></textarea></label>
        <button class="btn btn-primary" type="submit"${experiments.length ? '' : ' disabled'}>Sign paired adjudication evaluation</button>
        <p class="type-caption">The conclusion is derived from the frozen thresholds; the evaluator cannot select it.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
`;

export default { renderAdjudicationExperimentForms };

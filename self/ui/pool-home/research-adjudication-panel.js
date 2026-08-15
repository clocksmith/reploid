/**
 * @fileoverview Forms for the frozen public-protein annotation adjudication proof.
 *
 * This panel collects explicit experiment authority and measurement inputs. It
 * deliberately supplies no default catalog, curator, baseline, or evaluator.
 */

import { optionList } from './research-panels.js';

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

/**
 * @fileoverview Reusable Research Room lifecycle form panel.
 *
 * This module renders existing lifecycle inputs only. Record signing,
 * validation, persistence, hydration, and event binding remain owned by
 * research-view.js and the evidence network.
 */

import { optionList } from './research-panels.js';

export const renderLifecycleForms = ({
  questions = [],
  priorEvidence = [],
  hypotheses = [],
  predictions = [],
  workOrders = [],
  acceptedWorkOrders = [],
  workClaims = [],
  outcomes = [],
  cohorts = [],
  active = []
} = {}) => `
  <section class="pool-research-panel pool-research-lifecycle-actions">
    <p class="pool-dashboard-kicker">Frame</p>
    <h3 class="type-h3">Competing hypotheses and prior evidence</h3>
    <details><summary>Add versioned prior evidence</summary>
      <form data-research-lifecycle-form data-research-action="prior-evidence">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Evidence kind</span><select name="evidenceKind"><option value="sequence">Sequence</option><option value="structure">Structure</option><option value="domain">Domain</option><option value="annotation">Annotation</option><option value="experiment">Experiment</option><option value="publication">Publication</option></select></label>
          <label class="pool-field"><span>Accession</span><input name="accession" required placeholder="UniProt or public record identity"></label>
          <label class="pool-field"><span>Version</span><input name="version" required placeholder="record version"></label>
        </div>
        <label class="pool-field"><span>Public source URI</span><input name="uri" type="url" placeholder="https://"></label>
        <label class="pool-field"><span>Evidence summary</span><textarea name="summary" rows="3" required></textarea></label>
        <label class="pool-field"><span>Condition-specific context</span><input name="conditions" placeholder="organism, partners, ligands, modification, environment, or time"></label>
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
  </section>
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
        <label class="pool-field"><span>Uncertainty plan</span><textarea name="uncertaintyPlan" rows="2" required></textarea></label>
        <label class="pool-field"><span>Acceptance criteria</span><textarea name="acceptanceCriteria" rows="2" required></textarea></label>
        <label class="pool-field"><span>Blinded allocation commitment</span><input name="allocationHash" required placeholder="sha256:..."></label>
        <button class="btn btn-primary" type="submit"${hypotheses.length >= 2 ? '' : ' disabled'}>Sign proposed work order</button>
        <p class="type-caption">An independent expert must accept the signed order before a laboratory can claim it.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Claim accepted laboratory work</summary>
      <form data-research-lifecycle-form data-research-action="work-claim">
        <label class="pool-field"><span>Accepted work order</span><select name="workOrderHash" required>${optionList(acceptedWorkOrders, { empty: 'No independently accepted work orders' })}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Laboratory id</span><input name="laboratoryId" required></label>
          <label class="pool-field"><span>Laboratory name</span><input name="laboratoryName" required></label>
          <label class="pool-field"><span>Institution</span><input name="institution"></label>
        </div>
        <label class="pool-field"><span>Declared capability</span><input name="capability" required></label>
        <label class="pool-consent-row"><input name="publicConsent" type="checkbox" required>Publish laboratory attribution and all positive, negative, ambiguous, or failed outcomes.</label>
        <button class="btn btn-primary" type="submit"${acceptedWorkOrders.length ? '' : ' disabled'}>Sign laboratory claim</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Observe</p>
    <h3 class="type-h3">Blinded outcomes and independent replicas</h3>
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
      </div>
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

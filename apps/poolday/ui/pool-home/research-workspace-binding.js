/**
 * @fileoverview Binds the research workspace: search, similarity, review, task and candidate
 * approvals, lifecycle forms, and hydration from local and coordinator evidence.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import {
  activeResearchRecords,
  createSignedHumanClaim,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  proposeDiscoveryTasks,
  rankProposedCandidateActions,
  searchEvidence
} from '../../pool/evidence-network.js';
import {
  hydrateCrossRoomSequenceEvidence,
  hydrateProteinUncertaintyCampaignQueue,
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord
} from './research-store.js';
import { reviewTargetFromUrl, renderRecord, renderResearchWorkspace } from './research-workspace-render.js';
import { reviewActionClaims, createContextualReviewRecord } from './research-review-records.js';
import { createLifecycleRecordFromForm } from './research-lifecycle-records.js';

// Rebinding keeps the caller's publisher: a re-render must not fall back to the default store.
const replaceWorkspace = (workspace, options = {}, binding = {}) => {
  const roomId = workspace.dataset.roomId;
  const parent = workspace.parentElement;
  if (!parent) return;
  const selectedReviewTarget = workspace.querySelector('[data-research-review-form] select[name="targetHash"]')?.value || '';
  parent.innerHTML = renderResearchWorkspace(roomId, loadResearchRecords(roomId), {
    reviewTarget: reviewTargetFromUrl() || selectedReviewTarget,
    ...options
  });
  bindResearchWorkspace(parent.querySelector('[data-pool-research-workspace]'), binding);
};

const retainReviewTargetInUrl = (targetHash) => {
  if (!targetHash || !globalThis.location || !globalThis.history?.replaceState) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set('target', targetHash);
  globalThis.history.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

export function bindResearchWorkspace(
  workspace = document.querySelector('[data-pool-research-workspace]'),
  { publishRecord = publishResearchRecord } = {}
) {
  if (!workspace || workspace.dataset.researchBound === 'true') return;
  workspace.dataset.researchBound = 'true';
  const roomId = workspace.dataset.roomId;
  workspace.querySelector('[data-research-search]')?.addEventListener('input', (event) => {
    const allRecords = loadResearchRecords(roomId);
    const records = searchEvidence(allRecords, event.target.value);
    const invalidated = invalidatedResearchHashes(allRecords);
    const reviewStates = new Map(projectResearchReviewStates(allRecords).map((entry) => [entry.recordHash, entry]));
    const submissionsByHash = new Map(allRecords.filter((record) => record.kind === 'research_submission').map((record) => [record.recordHash, record]));
    const target = workspace.querySelector('[data-research-records]');
    if (target) target.innerHTML = records.length
      ? records.map((record) => renderRecord(record, { invalidated, reviewStates, submissionsByHash })).join('')
      : '<p class="pool-caption">No matching signed evidence yet.</p>';
  });
  workspace.querySelector('[data-research-similarity-target]')?.addEventListener('change', (event) => {
    replaceWorkspace(workspace, { similarityTarget: event.target.value }, { publishRecord });
  });
  const reviewTargetSelect = workspace.querySelector('[data-research-review-form] select[name="targetHash"]');
  reviewTargetSelect?.addEventListener('change', (event) => {
    workspace.querySelectorAll('[data-research-review-context-shell]').forEach((context) => {
      context.hidden = context.dataset.researchReviewContextShell !== event.target.value;
    });
    const contextFields = workspace.querySelector('[data-research-context-assessment-fields]');
    const contextSelect = contextFields?.querySelector('[name="contextDetermination"]');
    const selectedRecord = activeResearchRecords(loadResearchRecords(roomId))
      .find((record) => record.recordHash === event.target.value);
    const required = Boolean(selectedRecord?.evidence?.reuseContext);
    if (contextFields) contextFields.hidden = !required;
    if (contextSelect) {
      contextSelect.disabled = !required;
      contextSelect.required = required;
      contextSelect.value = '';
    }
    retainReviewTargetInUrl(event.target.value);
  });
  workspace.querySelector('[data-research-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-research-review-status]');
    const values = new FormData(form);
    const action = reviewActionClaims[event.submitter?.value];
    if (!action) {
      if (status) status.textContent = 'Choose accept, reject, correct, or replicate.';
      return;
    }
    form.querySelectorAll('[data-research-review-action]').forEach((button) => { button.disabled = true; });
    if (status) status.textContent = action.pending;
    try {
      const record = await createContextualReviewRecord({
        action: event.submitter.value,
        identity: createPoolIdentity('reviewer'),
        roomId,
        targetHash: values.get('targetHash'),
        text: values.get('text'),
        confidence: values.get('confidence'),
        evidenceUrl: values.get('evidenceUrl'),
        targetRecord: activeResearchRecords(loadResearchRecords(roomId))
          .find((candidate) => candidate.recordHash === values.get('targetHash')) || null,
        contextDetermination: values.get('contextDetermination')
      });
      const publication = await publishRecord(record, { roomId });
      replaceWorkspace(workspace, { reviewTarget: values.get('targetHash') }, { publishRecord });
      const nextStatus = document.querySelector('[data-research-review-status]');
      if (nextStatus) nextStatus.textContent = publication.remote ? 'Signed review record published.' : 'Signed review record saved locally; coordinator sync is pending.';
    } catch (error) {
      if (status) status.textContent = error.message;
      form.querySelectorAll('[data-research-review-action]').forEach((button) => { button.disabled = false; });
    }
  });
  workspace.querySelectorAll('[data-research-approve-task]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const task = proposeDiscoveryTasks(loadResearchRecords(roomId))
          .find((candidate) => candidate.taskId === button.dataset.researchApproveTask
            && candidate.targetHash === button.dataset.researchTaskTarget);
        if (!task) throw new Error('The projected discovery task is no longer active');
        const record = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: button.dataset.researchTaskTarget,
          claimKind: 'task_approval',
          relation: 'approves',
          text: `Approved bounded discovery task: ${button.dataset.researchApproveTask}`,
          confidence: 1,
          decision: 'approved',
          taskId: button.dataset.researchApproveTask,
          taskContract: task.taskContract
        });
        await publishRecord(record, { roomId });
        replaceWorkspace(workspace, {}, { publishRecord });
      } catch (error) {
        button.disabled = false;
        button.title = error.message;
      }
    });
  });
  workspace.querySelectorAll('[data-research-approve-candidate]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const records = loadResearchRecords(roomId);
        const candidate = activeResearchRecords(records)
          .find((record) => record.kind === 'research_candidate_action'
            && record.recordHash === button.dataset.researchApproveCandidate
            && record.action?.contractHash === button.dataset.researchCandidateContract);
        const ranked = rankProposedCandidateActions(records).admittedCandidates
          .find((entry) => entry.recordHash === candidate?.recordHash);
        if (!candidate || !ranked) throw new Error('The signed candidate action is no longer admitted');
        const record = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: candidate.recordHash,
          claimKind: 'candidate_action_approval',
          relation: 'approves',
          text: `Approved exact candidate action contract: ${candidate.action.contractHash}`,
          confidence: 1,
          decision: 'approved',
          actionContractHash: candidate.action.contractHash
        });
        await publishRecord(record, { roomId });
        replaceWorkspace(workspace, {}, { publishRecord });
      } catch (error) {
        button.disabled = false;
        button.title = error.message;
      }
    });
  });
  workspace.querySelectorAll('[data-research-lifecycle-form]').forEach((form) => {
    const kindSelect = form.querySelector('[data-prior-evidence-kind]');
    const annotationFields = form.querySelector('[data-protein-annotation-fields]');
    if (kindSelect && annotationFields) {
      const syncAnnotationFields = () => {
        const enabled = ['annotation', 'domain'].includes(kindSelect.value);
        annotationFields.hidden = !enabled;
        for (const control of annotationFields.querySelectorAll('input, select')) {
          control.disabled = !enabled;
          control.required = enabled && control.name !== 'ontologyLabel';
        }
        const scope = annotationFields.querySelector('[name="annotationScope"]');
        if (scope && kindSelect.value === 'domain') {
          scope.value = 'domain';
          scope.disabled = true;
          scope.required = false;
        }
      };
      kindSelect.addEventListener('change', syncAnnotationFields);
      syncAnnotationFields();
    }
    const findingFields = form.querySelector('[data-public-evidence-finding]');
    const failureFields = form.querySelector('[data-public-evidence-failure]');
    if (kindSelect && findingFields && failureFields) {
      const syncPublicEvidenceFinding = () => {
        const assay = kindSelect.value === 'assay';
        const negative = kindSelect.value === 'negative_result';
        const failed = kindSelect.value === 'failed_attempt';
        findingFields.hidden = !assay && !negative;
        const classification = findingFields.querySelector('[name="findingClassification"]');
        if (classification) {
          classification.disabled = !assay;
          classification.required = assay;
          if (negative) classification.value = 'negative';
        }
        failureFields.hidden = !failed;
        for (const control of failureFields.querySelectorAll('input, select')) {
          control.disabled = !failed;
          control.required = failed;
        }
      };
      kindSelect.addEventListener('change', syncPublicEvidenceFinding);
      syncPublicEvidenceFinding();
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('[data-research-lifecycle-status]');
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Signing lifecycle evidence...';
      try {
        const record = await createLifecycleRecordFromForm(
          form.dataset.researchAction,
          new FormData(form),
          roomId,
          activeResearchRecords(loadResearchRecords(roomId))
        );
        const publication = await publishRecord(record, { roomId });
        replaceWorkspace(workspace, {}, { publishRecord });
        const sync = document.querySelector('[data-pool-research-sync]');
        if (sync) sync.textContent = publication.remote ? 'Lifecycle evidence synchronized' : 'Lifecycle evidence saved locally; coordinator sync pending';
      } catch (error) {
        if (status) status.textContent = error.message;
        if (submit) submit.disabled = false;
      }
    });
  });
}

export async function hydrateAndBindResearchWorkspace(
  workspace = document.querySelector('[data-pool-research-workspace]'),
  roomId = workspace?.dataset.roomId,
  {
    hydrate = hydrateResearchRecords,
    hydrateCrossRoom = hydrateCrossRoomSequenceEvidence,
    hydrateCampaign = hydrateProteinUncertaintyCampaignQueue,
    publishRecord = publishResearchRecord
  } = {}
) {
  if (!roomId) return null;
  const sync = workspace?.querySelector('[data-pool-research-sync]');
  let localRenderCompleted = false;
  const renderLocalEvidence = () => {
    if (!workspace || !document.body.contains(workspace)) return;
    replaceWorkspace(workspace, {}, { publishRecord });
    localRenderCompleted = true;
  };
  const hydrated = workspace
    ? await hydrate(roomId, { onLocalHydrated: renderLocalEvidence })
    : await hydrate(roomId);
  if (!localRenderCompleted) renderLocalEvidence();
  const latestSubmission = activeResearchRecords(hydrated.records || [])
    .filter((record) => record.kind === 'research_submission')
    .at(-1) || null;
  const crossRoomEvidence = latestSubmission
    ? await hydrateCrossRoom(roomId, latestSubmission.sequence?.hash)
    : null;
  const campaignQueue = await hydrateCampaign(roomId);
  const currentWorkspace = document.querySelector('[data-pool-research-workspace]');
  if (workspace && currentWorkspace?.dataset.roomId === roomId) {
    replaceWorkspace(currentWorkspace, {}, { publishRecord });
  }
  const current = document.querySelector('[data-pool-research-sync]');
  if (current) {
    const rejectedCount = hydrated.rejectedRecords?.length || 0;
    current.textContent = hydrated.remote
      ? (rejectedCount
        ? `Coordinator evidence synchronized; ${rejectedCount} unadmitted or invalid record${rejectedCount === 1 ? '' : 's'} rejected by policy`
        : 'Coordinator evidence synchronized')
      : (rejectedCount
        ? `Local evidence verified; ${rejectedCount} unadmitted or invalid record${rejectedCount === 1 ? '' : 's'} rejected by policy; coordinator sync unavailable`
        : 'Local evidence verified; coordinator sync unavailable');
  }
  const result = { ...hydrated, crossRoomEvidence, campaignQueue };
  if (sync && !document.body.contains(sync)) return result;
  return result;
}
